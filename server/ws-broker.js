'use strict';

const crypto = require('crypto');
const { Server } = require('socket.io');

const VALID_ROLES = new Set(['client', 'kds', 'waiter', 'admin']);

/**
 * Broker Central Orientado a Eventos (EDA) sobre Socket.io.
 *
 * Implementa el Principio de Desacoplamiento Espaciotemporal mediante salas (rooms):
 * - role:kds, role:waiter, role:admin, role:client
 * - session:<clientSessionId> para notificaciones privadas al comensal dueño de cada comanda
 *
 * Delega liquidación impositiva y auditoría a Worker Threads sin bloquear el Event Loop.
 */
class CentralEventBroker {
    constructor({ stateStore, workerManager }) {
        this.stateStore = stateStore;
        this.workerManager = workerManager;
        this.io = null;
        this.nodes = new Map(); // socket.id -> nodeInfo
        this.shuttingDown = false;
    }

    attachToServer(httpServer) {
        this.io = new Server(httpServer, {
            cors: { origin: '*' },
            transports: ['websocket', 'polling']
        });

        this.io.on('connection', (socket) => this._onSocketConnection(socket));
        return this.io;
    }

    _onSocketConnection(socket) {
        const nodeInfo = {
            socketId: socket.id,
            nodeId: `node-${crypto.randomBytes(3).toString('hex')}`,
            role: 'client',
            nodeName: 'Comensal Móvil',
            clientSessionId: null,
            tableId: null,
            connectedAt: new Date().toISOString()
        };
        this.nodes.set(socket.id, nodeInfo);

        socket.emit('broker:connected', {
            nodeId: nodeInfo.nodeId,
            transport: 'socket.io',
            message: 'Conectado al Broker Central Gourmet Express EDA (Socket.io)'
        });

        socket.on('node:register', (payload = {}, ack) => {
            this._runSafe(socket, 'node:register', () => this._onNodeRegister(socket, nodeInfo, payload, ack));
        });

        socket.on('ping:client', (payload = {}, ack) => {
            const response = {
                clientSentAt: payload.sentAt || Date.now(),
                serverTime: Date.now()
            };
            if (typeof ack === 'function') ack(response);
            else socket.emit('pong:broker', response);
        });

        socket.on('order:create', (payload = {}, ack) => {
            this._runSafe(socket, 'order:create', () => this._onOrderCreate(socket, nodeInfo, payload, ack));
        });

        socket.on('order:update_status', (payload = {}, ack) => {
            this._runSafe(socket, 'order:update_status', () => this._onOrderUpdateStatus(socket, nodeInfo, payload, ack));
        });

        socket.on('order:assign_waiter', (payload = {}, ack) => {
            this._runSafe(socket, 'order:assign_waiter', () => this._onOrderAssignWaiter(socket, nodeInfo, payload, ack));
        });

        socket.on('menu:upsert', (payload = {}, ack) => {
            this._runSafe(socket, 'menu:upsert', () => this._onMenuUpsert(socket, nodeInfo, payload, ack));
        });

        socket.on('menu:delete', (payload = {}, ack) => {
            this._runSafe(socket, 'menu:delete', () => this._onMenuDelete(socket, nodeInfo, payload, ack));
        });

        socket.on('reservation:create', (payload = {}, ack) => {
            this._runSafe(socket, 'reservation:create', () => this._onReservationCreate(socket, nodeInfo, payload, ack));
        });

        socket.on('customer:create', (payload = {}, ack) => {
            this._runSafe(socket, 'customer:create', () => this._onCustomerCreate(socket, nodeInfo, payload, ack));
        });

        socket.on('customer:delete', (payload = {}, ack) => {
            this._runSafe(socket, 'customer:delete', () => this._onCustomerDelete(socket, nodeInfo, payload, ack));
        });

        socket.on('cash:close', (_payload, ack) => {
            this._runSafe(socket, 'cash:close', () => this._onCashClose(socket, nodeInfo, ack));
        });

        socket.on('state:sync_request', (_payload, ack) => {
            this._runSafe(socket, 'state:sync_request', () => {
                const snapPayload = this._buildSnapshotPayload(nodeInfo);
                socket.emit('state:snapshot', snapPayload);
                if (typeof ack === 'function') ack({ ok: true });
            });
        });

        socket.on('disconnect', () => {
            this.nodes.delete(socket.id);
            if (this.shuttingDown) return;
            this._broadcastTopology();
            this._dispatchAudit({
                eventType: 'NODE_DISCONNECTED',
                actorNodeId: nodeInfo.nodeId,
                actorRole: nodeInfo.role,
                summary: `Nodo ${nodeInfo.role.toUpperCase()} (${nodeInfo.nodeName}) desconectado`,
                metadata: { nodeId: nodeInfo.nodeId, role: nodeInfo.role }
            });
        });
    }

    _runSafe(socket, eventType, handler) {
        this.stateStore.eventsRouted += 1;
        try {
            handler();
        } catch (err) {
            socket.emit('broker:error', {
                eventType,
                error: err.message || 'Error procesando evento'
            });
        }
    }

    _onNodeRegister(socket, nodeInfo, payload, ack) {
        // Retirar salas anteriores si el nodo cambia de rol en la misma conexión
        if (nodeInfo.role) socket.leave(`role:${nodeInfo.role}`);
        if (nodeInfo.clientSessionId) socket.leave(`session:${nodeInfo.clientSessionId}`);

        const requestedRole = VALID_ROLES.has(payload.role) ? payload.role : 'client';
        nodeInfo.role = requestedRole;
        nodeInfo.nodeName = String(payload.nodeName || this._defaultNodeName(requestedRole)).slice(0, 60);
        nodeInfo.clientSessionId = payload.clientSessionId ? String(payload.clientSessionId) : nodeInfo.nodeId;
        nodeInfo.tableId = payload.tableId ? String(payload.tableId) : null;

        socket.join(`role:${nodeInfo.role}`);
        socket.join(`session:${nodeInfo.clientSessionId}`);

        const snapPayload = this._buildSnapshotPayload(nodeInfo);
        socket.emit('state:snapshot', snapPayload);
        if (typeof ack === 'function') ack({ ok: true, node: this._toPublicNode(nodeInfo) });

        this._broadcastTopology();
        this._dispatchAudit({
            eventType: 'NODE_CONNECTED',
            actorNodeId: nodeInfo.nodeId,
            actorRole: nodeInfo.role,
            summary: `Nodo ${nodeInfo.role.toUpperCase()} (${nodeInfo.nodeName}) suscrito vía Socket.io`,
            metadata: { nodeId: nodeInfo.nodeId, role: nodeInfo.role, tableId: nodeInfo.tableId }
        });
    }

    _defaultNodeName(role) {
        if (role === 'kds') return 'Terminal Cocina (KDS)';
        if (role === 'waiter') return 'Terminal Sala / Meseros';
        if (role === 'admin') return 'Consola Admin & EDA';
        return 'Comensal Móvil';
    }

    _toPublicNode(nodeInfo) {
        return {
            nodeId: nodeInfo.nodeId,
            role: nodeInfo.role,
            nodeName: nodeInfo.nodeName,
            tableId: nodeInfo.tableId,
            connectedAt: nodeInfo.connectedAt
        };
    }

    _buildSnapshotPayload(nodeInfo) {
        const snapshot = this.stateStore.getSnapshotForNode(nodeInfo.role, nodeInfo.clientSessionId);
        const payload = {
            node: this._toPublicNode(nodeInfo),
            snapshot,
            brokerSummary: this.getPublicSummary()
        };

        if (nodeInfo.role === 'admin') {
            payload.connectedNodes = this.getConnectedNodes();
            payload.workerTelemetry = this.workerManager.getTelemetry();
        }
        return payload;
    }

    _onOrderCreate(socket, nodeInfo, payload, ack) {
        const { order, deduplicated } = this.stateStore.createOrder(payload, {
            nodeId: nodeInfo.nodeId,
            clientSessionId: nodeInfo.clientSessionId || payload.clientSessionId
        });

        const ackPayload = {
            order,
            deduplicated,
            routedTo: ['role:kds', 'role:waiter', 'role:admin']
        };

        // ACK inmediato al emisor (desacoplado de Cocina y de los Worker Threads)
        socket.emit('order:ack', ackPayload);
        if (typeof ack === 'function') ack(ackPayload);

        if (deduplicated) return;

        // Enrutamiento asíncrono EDA mediante salas de Socket.io
        this.io.to('role:kds').to('role:waiter').to('role:admin').emit('order:created', { order });
        if (order.clientSessionId) {
            socket.to(`session:${order.clientSessionId}`).emit('order:created', { order });
        }

        if (payload.saveCustomer) {
            this.io.to('role:waiter').to('role:admin').emit('customers:updated', {
                customers: this.stateStore.customers
            });
        }

        // Hilo secundario 1: Liquidación Impositiva (INC 8% + Hash Fiscal) en Worker Thread
        this.workerManager.liquidateOrderTaxes(order)
            .then((liquidation) => {
                if (this.shuttingDown) return null;
                const updated = this.stateStore.attachTaxLiquidation(order.id, liquidation);
                if (!updated) return null;

                const taxEvent = {
                    orderId: updated.id,
                    orderCode: updated.orderCode,
                    taxLiquidation: liquidation
                };

                let target = this.io.to('role:waiter').to('role:admin');
                if (updated.clientSessionId) target = target.to(`session:${updated.clientSessionId}`);
                target.emit('order:tax_liquidated', taxEvent);

                this._broadcastWorkerTelemetry();

                return this._dispatchAudit({
                    eventType: 'TAX_LIQUIDATED',
                    actorNodeId: `tax-worker-thread-${liquidation.workerThreadId}`,
                    actorRole: 'worker',
                    summary: `Liquidación INC 8% completada para ${updated.orderCode} (Hash ${liquidation.fiscalHash.slice(0, 10)}...)`,
                    metadata: {
                        orderId: updated.id,
                        orderCode: updated.orderCode,
                        baseGravable: liquidation.baseGravable,
                        impoconsumo: liquidation.impoconsumo,
                        totalFacturado: liquidation.totalFacturado,
                        workerThreadId: liquidation.workerThreadId,
                        durationMs: liquidation.durationMs
                    }
                });
            })
            .catch((err) => {
                if (!this.shuttingDown) console.error('[Broker] Fallo en Tax Worker:', err.message);
            });

        // Hilo secundario 2: Registro de Auditoría Inmutable en Worker Thread
        this._dispatchAudit({
            eventType: 'ORDER_CREATED',
            actorNodeId: nodeInfo.nodeId,
            actorRole: nodeInfo.role,
            summary: `Nueva comanda ${order.orderCode} (${order.table}) por $${order.total.toLocaleString('es-CO')}`,
            metadata: {
                orderId: order.id,
                orderCode: order.orderCode,
                table: order.table,
                customer: order.customer,
                itemCount: order.items.length,
                total: order.total
            }
        });
    }

    _onOrderUpdateStatus(socket, nodeInfo, payload, ack) {
        const { orderId, status } = payload;
        const { order, previousStatus } = this.stateStore.updateOrderStatus(orderId, status, {
            nodeId: nodeInfo.nodeId,
            role: nodeInfo.role,
            nodeName: nodeInfo.nodeName
        });

        const ackData = { action: 'order:update_status', orderId: order.id, status: order.status };
        if (typeof ack === 'function') ack(ackData);

        const eventData = {
            order,
            previousStatus,
            updatedBy: { role: nodeInfo.role, nodeName: nodeInfo.nodeName }
        };

        let target = this.io.to('role:kds').to('role:waiter').to('role:admin');
        if (order.clientSessionId) target = target.to(`session:${order.clientSessionId}`);
        target.emit('order:status_changed', eventData);

        this._dispatchAudit({
            eventType: 'ORDER_STATUS_UPDATED',
            actorNodeId: nodeInfo.nodeId,
            actorRole: nodeInfo.role,
            summary: `Comanda ${order.orderCode} cambió de ${previousStatus} → ${order.status} (${nodeInfo.nodeName})`,
            metadata: {
                orderId: order.id,
                orderCode: order.orderCode,
                previousStatus,
                newStatus: order.status,
                table: order.table
            }
        });
    }

    _onOrderAssignWaiter(socket, nodeInfo, payload, ack) {
        const { orderId, waiterName } = payload;
        const order = this.stateStore.assignWaiter(orderId, waiterName || nodeInfo.nodeName);

        const ackData = { action: 'order:assign_waiter', orderId: order.id, assignedWaiter: order.assignedWaiter };
        if (typeof ack === 'function') ack(ackData);

        let target = this.io.to('role:kds').to('role:waiter').to('role:admin');
        if (order.clientSessionId) target = target.to(`session:${order.clientSessionId}`);
        target.emit('order:assigned', { order });

        this._dispatchAudit({
            eventType: 'ORDER_ASSIGNED',
            actorNodeId: nodeInfo.nodeId,
            actorRole: nodeInfo.role,
            summary: `Comanda ${order.orderCode} asignada a ${order.assignedWaiter}`,
            metadata: { orderId: order.id, orderCode: order.orderCode, assignedWaiter: order.assignedWaiter }
        });
    }

    _onMenuUpsert(_socket, nodeInfo, payload, ack) {
        const dish = this.stateStore.upsertDish(payload.dish || payload);
        if (typeof ack === 'function') ack({ action: 'menu:upsert', dishId: dish.id });

        this.io.emit('menu:updated', { dishes: this.stateStore.dishes });

        this._dispatchAudit({
            eventType: 'MENU_UPDATED',
            actorNodeId: nodeInfo.nodeId,
            actorRole: nodeInfo.role,
            summary: `Catálogo actualizado: ${dish.name} ($${dish.price.toLocaleString('es-CO')})`,
            metadata: { dishId: dish.id, name: dish.name, category: dish.category, price: dish.price }
        });
    }

    _onMenuDelete(_socket, nodeInfo, payload, ack) {
        const removed = this.stateStore.deleteDish(payload.dishId);
        if (typeof ack === 'function') ack({ action: 'menu:delete', dishId: payload.dishId });

        this.io.emit('menu:updated', { dishes: this.stateStore.dishes });

        if (removed) {
            this._dispatchAudit({
                eventType: 'MENU_DELETED',
                actorNodeId: nodeInfo.nodeId,
                actorRole: nodeInfo.role,
                summary: `Platillo eliminado del catálogo: ${removed.name}`,
                metadata: { dishId: removed.id, name: removed.name }
            });
        }
    }

    _onReservationCreate(_socket, nodeInfo, payload, ack) {
        const reservation = this.stateStore.createReservation(payload);
        if (typeof ack === 'function') ack({ action: 'reservation:create', reservation });

        this.io.emit('reservation:created', {
            reservation,
            reservations: this.stateStore.reservations
        });

        this._dispatchAudit({
            eventType: 'RESERVATION_CREATED',
            actorNodeId: nodeInfo.nodeId,
            actorRole: nodeInfo.role,
            summary: `Nueva reserva de ${reservation.name} para ${reservation.people} personas (${reservation.date} ${reservation.time})`,
            metadata: reservation
        });
    }

    _onCustomerCreate(_socket, nodeInfo, payload, ack) {
        const customer = this.stateStore.upsertCustomer(payload);
        if (typeof ack === 'function') ack({ action: 'customer:create', customer });

        this.io.to('role:waiter').to('role:admin').emit('customers:updated', {
            customers: this.stateStore.customers
        });

        this._dispatchAudit({
            eventType: 'CUSTOMER_REGISTERED',
            actorNodeId: nodeInfo.nodeId,
            actorRole: nodeInfo.role,
            summary: `Cliente registrado: ${customer.name} (NIT/CC: ${customer.nit})`,
            metadata: { customerId: customer.id, nit: customer.nit }
        });
    }

    _onCustomerDelete(_socket, nodeInfo, payload, ack) {
        const removed = this.stateStore.deleteCustomer(payload.customerId);
        if (typeof ack === 'function') ack({ action: 'customer:delete', customerId: payload.customerId });

        this.io.to('role:waiter').to('role:admin').emit('customers:updated', {
            customers: this.stateStore.customers
        });

        if (removed) {
            this._dispatchAudit({
                eventType: 'CUSTOMER_DELETED',
                actorNodeId: nodeInfo.nodeId,
                actorRole: nodeInfo.role,
                summary: `Cliente eliminado: ${removed.name}`,
                metadata: { customerId: removed.id }
            });
        }
    }

    _onCashClose(_socket, nodeInfo, ack) {
        const summary = this.stateStore.cashClose();
        if (typeof ack === 'function') ack({ action: 'cash:close', summary });

        this.io.to('role:kds').to('role:waiter').to('role:admin').emit('cash:closed', { summary });

        this._dispatchAudit({
            eventType: 'CASH_CLOSE',
            actorNodeId: nodeInfo.nodeId,
            actorRole: nodeInfo.role,
            summary: `Cierre de caja ejecutado: ${summary.closedOrdersCount} comandas, total $${summary.totalRevenue.toLocaleString('es-CO')}`,
            metadata: summary
        });
    }

    _dispatchAudit(entry) {
        if (this.shuttingDown) return Promise.resolve(null);
        return this.workerManager.recordAudit(entry)
            .then((record) => {
                if (this.shuttingDown) return record;
                this.stateStore.addAuditRecord(record);
                if (this.io) {
                    this.io.to('role:admin').emit('audit:recorded', {
                        record,
                        workerTelemetry: this.workerManager.getTelemetry()
                    });
                }
                return record;
            })
            .catch((err) => {
                if (!this.shuttingDown) {
                    console.error('[Broker] Fallo en Audit Worker:', err.message);
                }
            });
    }

    _broadcastTopology() {
        if (!this.io || this.shuttingDown) return;
        const connectedNodes = this.getConnectedNodes();
        const summary = this.getPublicSummary();
        this.io.to('role:admin').emit('broker:topology', {
            connectedNodes,
            brokerSummary: summary,
            workerTelemetry: this.workerManager.getTelemetry()
        });
        this.io.to('role:kds').to('role:waiter').emit('broker:summary', { brokerSummary: summary });
    }

    _broadcastWorkerTelemetry() {
        if (!this.io || this.shuttingDown) return;
        this.io.to('role:admin').emit('workers:telemetry', {
            workerTelemetry: this.workerManager.getTelemetry()
        });
    }

    getConnectedNodes() {
        return Array.from(this.nodes.values()).map((n) => this._toPublicNode(n));
    }

    getPublicSummary() {
        const counts = { client: 0, kds: 0, waiter: 0, admin: 0 };
        for (const [, node] of this.nodes) {
            if (counts[node.role] !== undefined) counts[node.role] += 1;
        }
        return {
            transport: 'Socket.io (WebSockets)',
            totalNodes: this.nodes.size,
            nodesByRole: counts,
            activeOrders: this.stateStore.orders.filter((o) => o.status !== 'Entregado').length,
            eventsRouted: this.stateStore.eventsRouted,
            startedAt: this.stateStore.startedAt
        };
    }

    async shutdown() {
        this.shuttingDown = true;
        this.nodes.clear();
        if (this.io) {
            await new Promise((resolve) => this.io.close(resolve));
        }
    }
}

module.exports = { CentralEventBroker };
