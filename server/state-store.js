'use strict';

const DEFAULT_DISHES = [
    { id: 1, name: 'Empanadas de Yuca', description: '3 tradicionales empanadas de masa de yuca, crujientes y rellenas de carne.', price: 12500, category: 'Entradas', image: 'https://images.pexels.com/photos/37025262/pexels-photo-37025262.jpeg' },
    { id: 2, name: 'Arepa de Choclo', description: 'Maíz tierno con generosa capa de queso campesino.', price: 9500, category: 'Entradas', image: 'https://media.istockphoto.com/id/1837269165/photo/corn-cachapas-with-white-cheese-typical-venezuelan-dish.jpg?s=2048x2048&w=is&k=20&c=TCDogiZYq-fKciHWZn0z2JjMwUOVx5teDQqhqGEeKYk=' },
    { id: 3, name: 'Dedos de Yuca', description: '6 palitos de yuca crocantes rellenos de queso hilado con salsa de la casa.', price: 12000, category: 'Entradas', image: 'https://images.pexels.com/photos/29450676/pexels-photo-29450676.jpeg' },
    { id: 4, name: 'Carne Asada Especial', description: 'Corte de res a la parrilla, arroz, papa salada y ensalada fresca.', price: 42000, category: 'Platos Fuertes', image: 'https://images.pexels.com/photos/36850059/pexels-photo-36850059.jpeg' },
    { id: 5, name: 'Ajiaco Santafereño', description: 'Sopa tradicional con pollo, tres tipos de papas y guascas.', price: 32000, category: 'Platos Fuertes', image: 'https://images.pexels.com/photos/37024898/pexels-photo-37024898.jpeg?auto=compress&cs=tinysrgb&w=1260' },
    { id: 6, name: 'Pasta a la Bolognesa', description: 'Pasta artesanal con salsa de carne y parmesano.', price: 29000, category: 'Platos Fuertes', image: 'https://images.pexels.com/photos/12667658/pexels-photo-12667658.jpeg?auto=compress&cs=tinysrgb&w=1260' },
    { id: 7, name: 'Limonada de Coco', description: 'Bebida insignia refrescante y cremosa.', price: 12500, category: 'Bebidas', image: 'https://images.pexels.com/photos/32512485/pexels-photo-32512485.jpeg?auto=compress&cs=tinysrgb&w=1260' },
    { id: 8, name: 'Sodas', description: 'Refrescantes sodas saborizadas de frutos rojos, maracuyá y lulo.', price: 10500, category: 'Bebidas', image: 'https://images.pexels.com/photos/28525184/pexels-photo-28525184.jpeg' },
    { id: 9, name: 'Brownie con Helado', description: 'Brownie melcochudo con helado de vainilla.', price: 15000, category: 'Postres', image: 'https://images.pexels.com/photos/33674421/pexels-photo-33674421.jpeg?auto=compress&cs=tinysrgb&w=1260' }
];

const VALID_STATUSES = ['Pendiente', 'Preparando', 'Listo', 'Entregado'];

/**
 * Estado global en memoria administrado exclusivamente por el Servidor Central / Broker.
 */
class StateStore {
    constructor() {
        this.dishes = DEFAULT_DISHES.map((d) => ({ ...d }));
        this.orders = [];
        this.reservations = [];
        this.customers = [];
        this.auditLogs = [];
        this.orderSeq = 1000;
        this.requestIdIndex = new Map(); // Idempotencia para colas de Smart Proxy
        this.eventsRouted = 0;
        this.startedAt = new Date().toISOString();
    }

    createOrder(input, originMeta = {}) {
        // Idempotencia: si el Smart Proxy reenvía el mismo clientRequestId tras reconectar, devolvemos el pedido existente
        if (input.clientRequestId && this.requestIdIndex.has(input.clientRequestId)) {
            const existingId = this.requestIdIndex.get(input.clientRequestId);
            const existing = this.orders.find((o) => o.id === existingId);
            if (existing) {
                return { order: existing, deduplicated: true };
            }
        }

        const rawItems = Array.isArray(input.items) ? input.items : [];
        if (!rawItems.length) {
            throw new Error('La comanda debe incluir al menos un plato.');
        }

        const normalizedItems = rawItems.map((item) => {
            const catalogDish = this.dishes.find((d) => d.id === Number(item.id));
            const price = catalogDish ? catalogDish.price : (Number(item.price) || 0);
            const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
            return {
                id: catalogDish ? catalogDish.id : Number(item.id),
                name: catalogDish ? catalogDish.name : String(item.name || 'Plato'),
                category: catalogDish ? catalogDish.category : (item.category || 'General'),
                price,
                quantity,
                image: catalogDish ? catalogDish.image : (item.image || '')
            };
        });

        const total = normalizedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
        const now = new Date().toISOString();
        const id = Date.now() + Math.floor(Math.random() * 1000);
        this.orderSeq += 1;

        const order = {
            id,
            orderCode: `GE-${this.orderSeq}`,
            clientRequestId: input.clientRequestId || null,
            clientSessionId: originMeta.clientSessionId || input.clientSessionId || null,
            originNodeId: originMeta.nodeId || null,
            customer: String(input.customer || 'Comensal').trim(),
            nit: String(input.nit || '222222222222').trim(),
            table: String(input.table || 'Mesa General').trim(),
            notes: String(input.notes || '').trim(),
            items: normalizedItems,
            total,
            status: 'Pendiente',
            assignedWaiter: null,
            taxStatus: 'Procesando',
            taxLiquidation: null,
            date: now,
            timestamps: {
                createdAt: now,
                prepStartedAt: null,
                readyAt: null,
                deliveredAt: null
            }
        };

        this.orders.push(order);
        if (order.clientRequestId) {
            this.requestIdIndex.set(order.clientRequestId, order.id);
        }

        if (input.saveCustomer && order.nit) {
            this.upsertCustomer({
                name: order.customer,
                nit: order.nit,
                email: input.email || '',
                phone: input.phone || ''
            });
        }

        return { order, deduplicated: false };
    }

    updateOrderStatus(orderId, newStatus, actor = {}) {
        if (!VALID_STATUSES.includes(newStatus)) {
            throw new Error(`Estado inválido: ${newStatus}`);
        }
        const order = this.orders.find((o) => o.id === Number(orderId));
        if (!order) {
            throw new Error(`Pedido ${orderId} no encontrado`);
        }

        const previousStatus = order.status;
        order.status = newStatus;
        const now = new Date().toISOString();
        if (newStatus === 'Preparando' && !order.timestamps.prepStartedAt) {
            order.timestamps.prepStartedAt = now;
        } else if (newStatus === 'Listo') {
            order.timestamps.readyAt = now;
        } else if (newStatus === 'Entregado') {
            order.timestamps.deliveredAt = now;
        }

        order.lastUpdatedBy = actor.nodeName || actor.role || 'Sistema';
        order.lastUpdatedAt = now;

        return { order, previousStatus };
    }

    assignWaiter(orderId, waiterName) {
        const order = this.orders.find((o) => o.id === Number(orderId));
        if (!order) {
            throw new Error(`Pedido ${orderId} no encontrado`);
        }
        order.assignedWaiter = String(waiterName || 'Mesero en turno').trim();
        order.lastUpdatedAt = new Date().toISOString();
        return order;
    }

    attachTaxLiquidation(orderId, liquidation) {
        const order = this.orders.find((o) => o.id === Number(orderId));
        if (!order) return null;
        order.taxLiquidation = liquidation;
        order.taxStatus = 'Liquidado';
        return order;
    }

    upsertDish(dishInput) {
        const parsedId = dishInput.id ? Number(dishInput.id) : null;
        const dish = {
            id: parsedId || Date.now(),
            name: String(dishInput.name || '').trim(),
            category: String(dishInput.category || 'Platos Fuertes').trim(),
            price: Number(dishInput.price) || 0,
            image: String(dishInput.image || '').trim(),
            description: String(dishInput.description || '').trim()
        };

        const exists = parsedId && this.dishes.some((d) => d.id === parsedId);
        if (exists) {
            this.dishes = this.dishes.map((d) => (d.id === parsedId ? dish : d));
        } else {
            this.dishes.push(dish);
        }
        return dish;
    }

    deleteDish(dishId) {
        const id = Number(dishId);
        const target = this.dishes.find((d) => d.id === id);
        this.dishes = this.dishes.filter((d) => d.id !== id);
        return target || null;
    }

    createReservation(resInput) {
        const reservation = {
            id: Date.now() + Math.floor(Math.random() * 100),
            name: String(resInput.name || 'Cliente Invitado').trim(),
            date: String(resInput.date || ''),
            time: String(resInput.time || ''),
            people: Number(resInput.people) || 2,
            createdAt: new Date().toISOString()
        };
        this.reservations.push(reservation);
        return reservation;
    }

    upsertCustomer(custInput) {
        const nit = String(custInput.nit || '').trim();
        const existing = nit ? this.customers.find((c) => c.nit === nit) : null;
        if (existing) {
            existing.name = String(custInput.name || existing.name).trim();
            if (custInput.email) existing.email = String(custInput.email).trim();
            if (custInput.phone) existing.phone = String(custInput.phone).trim();
            return existing;
        }
        const customer = {
            id: Date.now() + Math.floor(Math.random() * 100),
            name: String(custInput.name || '').trim(),
            nit,
            email: String(custInput.email || '').trim(),
            phone: String(custInput.phone || '').trim()
        };
        this.customers.push(customer);
        return customer;
    }

    deleteCustomer(customerId) {
        const id = Number(customerId);
        const target = this.customers.find((c) => c.id === id);
        this.customers = this.customers.filter((c) => c.id !== id);
        return target || null;
    }

    cashClose() {
        const summary = {
            closedOrdersCount: this.orders.length,
            totalRevenue: this.orders.reduce((s, o) => s + o.total, 0),
            totalIncTax: this.orders.reduce(
                (s, o) => s + (o.taxLiquidation ? o.taxLiquidation.impoconsumo : 0),
                0
            ),
            closedAt: new Date().toISOString()
        };
        this.orders = [];
        this.requestIdIndex.clear();
        return summary;
    }

    addAuditRecord(record) {
        this.auditLogs.push(record);
        if (this.auditLogs.length > 200) {
            this.auditLogs.shift();
        }
    }

    getSnapshotForNode(role, clientSessionId = null) {
        if (role === 'client') {
            // Desacoplamiento espaciotemporal: el cliente solo recibe catálogo, sus propias órdenes y reservas recientes.
            // Desconoce topología, IPs o estado interno de Cocina/Meseros.
            const ownOrders = clientSessionId
                ? this.orders.filter((o) => o.clientSessionId === clientSessionId)
                : [];
            return {
                dishes: this.dishes,
                orders: ownOrders,
                reservations: this.reservations.slice(-5),
                customers: []
            };
        }

        if (role === 'kds') {
            return {
                dishes: this.dishes,
                orders: this.orders,
                reservations: [],
                customers: []
            };
        }

        if (role === 'waiter') {
            return {
                dishes: this.dishes,
                orders: this.orders,
                reservations: this.reservations,
                customers: this.customers
            };
        }

        // admin / monitor
        return {
            dishes: this.dishes,
            orders: this.orders,
            reservations: this.reservations,
            customers: this.customers,
            auditLogs: this.auditLogs.slice(-80)
        };
    }
}

module.exports = { StateStore, DEFAULT_DISHES, VALID_STATUSES };
