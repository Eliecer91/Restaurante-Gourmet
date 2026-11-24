/**
 * SmartOrderProxy - Proxy Inteligente del lado Cliente / Terminal.
 *
 * Implementa:
 * - Transporte WebSockets mediante Socket.io (comunicación full-duplex de baja sobrecarga).
 * - Principio de Desacoplamiento Espaciotemporal: ningún cliente conoce la IP/ubicación de Cocina o Meseros.
 * - Tolerancia a Desconexión mediante HTML5 LocalStorage (Fallback perimetral):
 *     * Con Broker Socket.io activo: salvaguarda pedidos en localStorage si se interrumpe la red y
 *       los retransmite con idempotencia al reconectar.
 *     * En hosting estático sin Broker Node.js (ej. Vercel/GitHub Pages): activa automáticamente un
 *       Broker de respaldo local sobre HTML5 LocalStorage + BroadcastChannel para sincronizar
 *       pestañas (Comensal, KDS, Meseros y Monitor EDA) en tiempo real.
 */
(function attachSmartProxy(globalScope) {
    const LOCAL_QUEUE_KEY = 'ge_local_proxy_queue_v1';
    const LOCAL_MENU_CACHE_KEY = 'ge_local_menu_cache_v1';
    const LOCAL_SAFEGUARDED_ORDERS_KEY = 'ge_local_safeguarded_orders_v1';
    const LOCAL_FALLBACK_STATE_KEY = 'ge_static_fallback_state_v1';
    const LOCAL_FALLBACK_NODES_KEY = 'ge_static_fallback_nodes_v1';
    const SESSION_ID_KEY = 'ge_node_session_id_v1';

    const FALLBACK_DEFAULT_DISHES = [
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

    const BROKER_EVENTS = [
        'broker:connected',
        'state:snapshot',
        'order:ack',
        'order:created',
        'order:status_changed',
        'order:assigned',
        'order:tax_liquidated',
        'menu:updated',
        'reservation:created',
        'customers:updated',
        'cash:closed',
        'broker:topology',
        'broker:summary',
        'workers:telemetry',
        'audit:recorded',
        'broker:error'
    ];

    function generateId(prefix) {
        const rand = Math.random().toString(36).slice(2, 9);
        return `${prefix}-${Date.now().toString(36)}-${rand}`;
    }

    function simpleHash(input) {
        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;
        for (let i = 0; i < input.length; i += 1) {
            const ch = input.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
        const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
        return `${p1}${p2}${p1}`.slice(0, 24).toUpperCase();
    }

    function readJsonStorage(storage, key, fallback) {
        try {
            const raw = storage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJsonStorage(storage, key, value) {
        try {
            storage.setItem(key, JSON.stringify(value));
        } catch (_) {
            // Ignora errores por cuota de almacenamiento o modo privado
        }
    }

    function getOrCreateTabSessionId() {
        try {
            let sid = sessionStorage.getItem(SESSION_ID_KEY);
            if (!sid) {
                sid = generateId('sess');
                sessionStorage.setItem(SESSION_ID_KEY, sid);
            }
            return sid;
        } catch (_) {
            return generateId('sess');
        }
    }

    class SmartOrderProxy {
        constructor(options = {}) {
            this.role = options.role || 'client';
            this.nodeName = options.nodeName || 'Comensal Móvil';
            this.tableId = options.tableId || null;
            this.clientSessionId = options.clientSessionId || getOrCreateTabSessionId();
            this.brokerUrl = options.brokerUrl || this._resolveBrokerUrl();

            this.socket = null;
            this.nodeId = null;
            this.status = 'disconnected'; // disconnected | connecting | connected | reconnecting | offline-fallback
            this.heartbeatTimer = null;
            this.latencyMs = null;

            this.staticFallbackMode = false;
            this.fallbackChannel = null;
            this.fallbackHeartbeatTimer = null;

            this.listeners = new Map();
            this.offlineQueue = readJsonStorage(globalScope.localStorage, LOCAL_QUEUE_KEY, []);
            this.safeguardedOrders = readJsonStorage(globalScope.localStorage, LOCAL_SAFEGUARDED_ORDERS_KEY, []);
        }

        _resolveBrokerUrl() {
            if (typeof window === 'undefined' || !window.location || window.location.protocol === 'file:') {
                return 'http://localhost:3000';
            }
            const params = new URLSearchParams(window.location.search);
            const customBroker = params.get('broker');
            if (customBroker) return customBroker;
            return window.location.origin;
        }

        _persistQueue() {
            writeJsonStorage(globalScope.localStorage, LOCAL_QUEUE_KEY, this.offlineQueue);
        }

        _persistSafeguardedOrders() {
            writeJsonStorage(globalScope.localStorage, LOCAL_SAFEGUARDED_ORDERS_KEY, this.safeguardedOrders);
        }

        getCachedMenu() {
            return readJsonStorage(globalScope.localStorage, LOCAL_MENU_CACHE_KEY, null);
        }

        saveCachedMenu(dishes) {
            if (Array.isArray(dishes) && dishes.length) {
                writeJsonStorage(globalScope.localStorage, LOCAL_MENU_CACHE_KEY, dishes);
            }
        }

        getSafeguardedOrders() {
            return [...this.safeguardedOrders];
        }

        _removeSafeguardedOrder(clientRequestId) {
            if (!clientRequestId) return;
            const before = this.safeguardedOrders.length;
            this.safeguardedOrders = this.safeguardedOrders.filter((o) => o.clientRequestId !== clientRequestId);
            if (this.safeguardedOrders.length !== before) {
                this._persistSafeguardedOrders();
            }
        }

        on(eventType, handler) {
            if (!this.listeners.has(eventType)) {
                this.listeners.set(eventType, new Set());
            }
            this.listeners.get(eventType).add(handler);
            return () => {
                const set = this.listeners.get(eventType);
                if (set) set.delete(handler);
            };
        }

        _emitLocal(eventType, payload) {
            const set = this.listeners.get(eventType);
            if (set) {
                set.forEach((fn) => {
                    try {
                        fn(payload);
                    } catch (err) {
                        console.error(`[SmartProxy] Error en listener "${eventType}":`, err);
                    }
                });
            }
        }

        _setStatus(newStatus) {
            this.status = newStatus;
            this._emitLocal('proxy:status', this.getStatusInfo());
        }

        getStatusInfo() {
            return {
                status: this.status,
                transport: this.staticFallbackMode ? 'LocalStorage + BroadcastChannel' : 'Socket.io',
                nodeId: this.nodeId,
                role: this.role,
                nodeName: this.nodeName,
                clientSessionId: this.clientSessionId,
                queuedCount: this.offlineQueue.length,
                safeguardedOrdersCount: this.safeguardedOrders.length,
                latencyMs: this.latencyMs,
                brokerUrl: this.brokerUrl
            };
        }

        connect() {
            if (typeof globalScope.io !== 'function') {
                // Entorno estático (ej. Vercel/GitHub Pages sin servidor Node.js): activar Broker de respaldo LocalStorage
                this._activateStaticFallbackBroker();
                return;
            }

            if (this.socket) {
                if (!this.socket.connected) this.socket.connect();
                return;
            }

            this._setStatus('connecting');

            this.socket = globalScope.io(this.brokerUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 15000
            });

            this.socket.on('connect', () => {
                this._setStatus('connected');
                this._registerNode();
                this._startHeartbeat();
            });

            this.socket.on('disconnect', () => {
                this._stopHeartbeat();
                this._setStatus('reconnecting');
            });

            this.socket.on('connect_error', () => {
                this._setStatus('reconnecting');
            });

            BROKER_EVENTS.forEach((eventName) => {
                this.socket.on(eventName, (payload) => this._handleBrokerEvent(eventName, payload));
            });

            if (typeof window !== 'undefined') {
                window.addEventListener('online', () => {
                    if (this.socket && !this.socket.connected) {
                        this.socket.connect();
                    } else if (this.isConnected()) {
                        this._flushOfflineQueue();
                    }
                });
                window.addEventListener('offline', () => {
                    this._setStatus('reconnecting');
                });
            }
        }

        // ================= BROKER FALLBACK MULTI-PESTAÑA (VERCEL / ESTÁTICO) =================
        _getFallbackState() {
            const state = readJsonStorage(globalScope.localStorage, LOCAL_FALLBACK_STATE_KEY, null);
            if (state && Array.isArray(state.dishes)) return state;
            const fresh = {
                dishes: FALLBACK_DEFAULT_DISHES.map((d) => ({ ...d })),
                orders: [],
                reservations: [],
                customers: [],
                auditLogs: [],
                orderSeq: 1000,
                eventsRouted: 0,
                taxTasks: 0,
                auditTasks: 0,
                startedAt: new Date().toISOString()
            };
            writeJsonStorage(globalScope.localStorage, LOCAL_FALLBACK_STATE_KEY, fresh);
            return fresh;
        }

        _saveFallbackState(state) {
            writeJsonStorage(globalScope.localStorage, LOCAL_FALLBACK_STATE_KEY, state);
            this.saveCachedMenu(state.dishes);
        }

        _registerFallbackNodePresence() {
            const now = Date.now();
            const map = readJsonStorage(globalScope.localStorage, LOCAL_FALLBACK_NODES_KEY, {});
            Object.keys(map).forEach((id) => {
                if (now - map[id].lastSeen > 20000) delete map[id];
            });
            map[this.nodeId] = {
                nodeId: this.nodeId,
                role: this.role,
                nodeName: this.nodeName,
                connectedAt: map[this.nodeId] ? map[this.nodeId].connectedAt : new Date().toISOString(),
                lastSeen: now
            };
            writeJsonStorage(globalScope.localStorage, LOCAL_FALLBACK_NODES_KEY, map);
            return Object.values(map);
        }

        _buildFallbackTelemetry(state) {
            return {
                taxWorker: {
                    name: 'TaxLiquidationWorker (Fallback)',
                    threadId: 1,
                    status: 'ready',
                    tasksCompleted: state.taxTasks || 0,
                    avgDurationMs: 0.4
                },
                auditWorker: {
                    name: 'AuditTrailWorker (Fallback)',
                    threadId: 2,
                    status: 'ready',
                    tasksCompleted: state.auditTasks || 0,
                    avgDurationMs: 0.3
                }
            };
        }

        _emitFallbackSnapshot() {
            const state = this._getFallbackState();
            const nodes = this._registerFallbackNodePresence();
            const counts = { client: 0, kds: 0, waiter: 0, admin: 0 };
            nodes.forEach((n) => {
                if (counts[n.role] !== undefined) counts[n.role] += 1;
            });

            const snapshot = this.role === 'client'
                ? {
                    dishes: state.dishes,
                    orders: state.orders.filter((o) => o.clientSessionId === this.clientSessionId),
                    reservations: state.reservations.slice(-5),
                    customers: []
                }
                : {
                    dishes: state.dishes,
                    orders: state.orders,
                    reservations: state.reservations,
                    customers: state.customers,
                    auditLogs: state.auditLogs.slice(-80)
                };

            this._emitLocal('state:snapshot', {
                node: { nodeId: this.nodeId, role: this.role, nodeName: this.nodeName },
                snapshot,
                connectedNodes: this.role === 'admin' ? nodes : undefined,
                workerTelemetry: this.role === 'admin' ? this._buildFallbackTelemetry(state) : undefined,
                brokerSummary: {
                    totalNodes: nodes.length,
                    nodesByRole: counts,
                    eventsRouted: state.eventsRouted || 0,
                    startedAt: state.startedAt
                }
            });
        }

        _broadcastFallbackEvent(eventName, payload) {
            if (this.fallbackChannel) {
                try {
                    this.fallbackChannel.postMessage({ sender: this.nodeId, eventName, payload });
                } catch (_) {
                    // ignore
                }
            }
        }

        _activateStaticFallbackBroker() {
            if (this.staticFallbackMode) return;
            this.staticFallbackMode = true;
            this.nodeId = `local-${generateId('node').slice(-6)}`;
            this._setStatus('offline-fallback');

            if (typeof BroadcastChannel !== 'undefined') {
                this.fallbackChannel = new BroadcastChannel('gourmet-express-eda');
                this.fallbackChannel.onmessage = (ev) => {
                    const { sender, eventName, payload } = ev.data || {};
                    if (!eventName || sender === this.nodeId) return;
                    if (eventName === 'sync:ping') {
                        this._emitFallbackSnapshot();
                        return;
                    }
                    this._emitLocal(eventName, payload);
                    if (this.role === 'admin') this._emitFallbackSnapshot();
                };
            }

            if (typeof window !== 'undefined') {
                window.addEventListener('storage', (ev) => {
                    if (ev.key === LOCAL_FALLBACK_STATE_KEY || ev.key === LOCAL_FALLBACK_NODES_KEY) {
                        this._emitFallbackSnapshot();
                    }
                });
                window.addEventListener('beforeunload', () => {
                    const map = readJsonStorage(globalScope.localStorage, LOCAL_FALLBACK_NODES_KEY, {});
                    delete map[this.nodeId];
                    writeJsonStorage(globalScope.localStorage, LOCAL_FALLBACK_NODES_KEY, map);
                });
            }

            this._emitFallbackSnapshot();
            this._broadcastFallbackEvent('sync:ping', {});

            this.fallbackHeartbeatTimer = setInterval(() => {
                this._registerFallbackNodePresence();
            }, 8000);
        }

        _handleStaticFallbackCommand(type, payload) {
            const state = this._getFallbackState();
            state.eventsRouted = (state.eventsRouted || 0) + 1;

            const pushAudit = (eventType, summary) => {
                state.auditTasks = (state.auditTasks || 0) + 1;
                const seq = (state.auditLogs.length ? state.auditLogs[state.auditLogs.length - 1].seq : 0) + 1;
                const prevHash = state.auditLogs.length ? state.auditLogs[state.auditLogs.length - 1].hash : 'GENESIS';
                const rec = {
                    id: `AUD-L-${Date.now()}-${seq}`,
                    seq,
                    timestamp: new Date().toISOString(),
                    eventType,
                    actorNodeId: this.nodeId,
                    actorRole: this.role,
                    summary,
                    prevHash,
                    hash: simpleHash(`${seq}|${eventType}|${summary}|${prevHash}`),
                    workerThreadId: 2,
                    durationMs: 0.3
                };
                state.auditLogs.push(rec);
                if (state.auditLogs.length > 100) state.auditLogs.shift();
                return rec;
            };

            if (type === 'order:create') {
                state.orderSeq += 1;
                const total = (payload.items || []).reduce((s, i) => s + (Number(i.price) * Number(i.quantity)), 0);
                const baseGravable = Math.round(total / 1.08);
                const impoconsumo = total - baseGravable;
                const propinaSugerida = Math.round(baseGravable * 0.10);
                state.taxTasks = (state.taxTasks || 0) + 1;

                const order = {
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    orderCode: `GE-${state.orderSeq}`,
                    clientRequestId: payload.clientRequestId || generateId('ord'),
                    clientSessionId: this.clientSessionId,
                    customer: payload.customer || 'Comensal',
                    nit: payload.nit || '222222222222',
                    table: payload.table || 'Mesa General',
                    notes: payload.notes || '',
                    items: payload.items || [],
                    total,
                    status: 'Pendiente',
                    assignedWaiter: null,
                    taxStatus: 'Liquidado',
                    taxLiquidation: {
                        regime: 'Impuesto Nacional al Consumo (INC 8% - Colombia)',
                        baseGravable,
                        impoconsumo,
                        totalFacturado: total,
                        propinaSugerida,
                        totalConPropina: total + propinaSugerida,
                        fiscalHash: simpleHash(`${state.orderSeq}|${total}|${Date.now()}`),
                        workerThreadId: 1,
                        durationMs: 0.4
                    },
                    date: new Date().toISOString()
                };

                state.orders.push(order);
                if (payload.saveCustomer && order.nit) {
                    const exists = state.customers.find((c) => c.nit === order.nit);
                    if (!exists) {
                        state.customers.push({ id: Date.now(), name: order.customer, nit: order.nit, email: '', phone: '' });
                    }
                }
                const rec = pushAudit('ORDER_CREATED', `Nueva comanda ${order.orderCode} (${order.table}) por $${total.toLocaleString('es-CO')}`);
                this._saveFallbackState(state);

                this._emitLocal('order:ack', { order, deduplicated: false });
                this._broadcastFallbackEvent('order:created', { order });
                this._broadcastFallbackEvent('audit:recorded', { record: rec, workerTelemetry: this._buildFallbackTelemetry(state) });
                this._emitFallbackSnapshot();
                return Promise.resolve({ order, deduplicated: false });
            }

            if (type === 'order:update_status') {
                const order = state.orders.find((o) => o.id === Number(payload.orderId));
                if (order) {
                    const previousStatus = order.status;
                    order.status = payload.status;
                    const rec = pushAudit('ORDER_STATUS_UPDATED', `Comanda ${order.orderCode}: ${previousStatus} → ${order.status}`);
                    this._saveFallbackState(state);
                    const evPayload = { order, previousStatus, updatedBy: { role: this.role, nodeName: this.nodeName } };
                    this._emitLocal('order:status_changed', evPayload);
                    this._broadcastFallbackEvent('order:status_changed', evPayload);
                    this._broadcastFallbackEvent('audit:recorded', { record: rec, workerTelemetry: this._buildFallbackTelemetry(state) });
                }
                return Promise.resolve({ ok: true });
            }

            if (type === 'order:assign_waiter') {
                const order = state.orders.find((o) => o.id === Number(payload.orderId));
                if (order) {
                    order.assignedWaiter = payload.waiterName || this.nodeName;
                    pushAudit('ORDER_ASSIGNED', `Comanda ${order.orderCode} asignada a ${order.assignedWaiter}`);
                    this._saveFallbackState(state);
                    this._emitLocal('order:assigned', { order });
                    this._broadcastFallbackEvent('order:assigned', { order });
                }
                return Promise.resolve({ ok: true });
            }

            if (type === 'menu:upsert') {
                const d = payload.dish || payload;
                const parsedId = d.id ? Number(d.id) : Date.now();
                const dish = { ...d, id: parsedId, price: Number(d.price) || 0 };
                if (state.dishes.some((x) => x.id === parsedId)) {
                    state.dishes = state.dishes.map((x) => (x.id === parsedId ? dish : x));
                } else {
                    state.dishes.push(dish);
                }
                pushAudit('MENU_UPDATED', `Catálogo actualizado: ${dish.name}`);
                this._saveFallbackState(state);
                this._emitLocal('menu:updated', { dishes: state.dishes });
                this._broadcastFallbackEvent('menu:updated', { dishes: state.dishes });
                return Promise.resolve({ ok: true });
            }

            if (type === 'menu:delete') {
                state.dishes = state.dishes.filter((x) => x.id !== Number(payload.dishId));
                pushAudit('MENU_DELETED', `Platillo #${payload.dishId} eliminado`);
                this._saveFallbackState(state);
                this._emitLocal('menu:updated', { dishes: state.dishes });
                this._broadcastFallbackEvent('menu:updated', { dishes: state.dishes });
                return Promise.resolve({ ok: true });
            }

            if (type === 'reservation:create') {
                const reservation = { id: Date.now(), ...payload, createdAt: new Date().toISOString() };
                state.reservations.push(reservation);
                pushAudit('RESERVATION_CREATED', `Reserva de ${reservation.name} (${reservation.people} personas)`);
                this._saveFallbackState(state);
                this._emitLocal('reservation:created', { reservation, reservations: state.reservations });
                this._broadcastFallbackEvent('reservation:created', { reservation, reservations: state.reservations });
                return Promise.resolve({ ok: true });
            }

            if (type === 'customer:create') {
                state.customers.push({ id: Date.now(), ...payload });
                this._saveFallbackState(state);
                this._emitLocal('customers:updated', { customers: state.customers });
                this._broadcastFallbackEvent('customers:updated', { customers: state.customers });
                return Promise.resolve({ ok: true });
            }

            if (type === 'customer:delete') {
                state.customers = state.customers.filter((c) => c.id !== Number(payload.customerId));
                this._saveFallbackState(state);
                this._emitLocal('customers:updated', { customers: state.customers });
                this._broadcastFallbackEvent('customers:updated', { customers: state.customers });
                return Promise.resolve({ ok: true });
            }

            if (type === 'cash:close') {
                state.orders = [];
                pushAudit('CASH_CLOSE', 'Cierre de caja ejecutado (Modo Fallback)');
                this._saveFallbackState(state);
                this._emitLocal('cash:closed', {});
                this._broadcastFallbackEvent('cash:closed', {});
                return Promise.resolve({ ok: true });
            }

            if (type === 'state:sync_request') {
                this._emitFallbackSnapshot();
                return Promise.resolve({ ok: true });
            }

            return Promise.resolve({ ok: true });
        }

        // ================= GESTIÓN DE EVENTOS SOCKET.IO =================

        _handleBrokerEvent(eventName, payload) {
            if (eventName === 'broker:connected' && payload && payload.nodeId) {
                this.nodeId = payload.nodeId;
                this._emitLocal('proxy:status', this.getStatusInfo());
            }

            if (eventName === 'state:snapshot') {
                if (payload && payload.node && payload.node.nodeId) {
                    this.nodeId = payload.node.nodeId;
                }
                if (payload && payload.snapshot && Array.isArray(payload.snapshot.dishes)) {
                    this.saveCachedMenu(payload.snapshot.dishes);
                }
                this._emitLocal('proxy:status', this.getStatusInfo());
                this._flushOfflineQueue();
            }

            if (eventName === 'menu:updated' && payload && Array.isArray(payload.dishes)) {
                this.saveCachedMenu(payload.dishes);
            }

            if (eventName === 'order:ack' && payload && payload.order) {
                this._removeSafeguardedOrder(payload.order.clientRequestId);
                this._emitLocal('proxy:status', this.getStatusInfo());
            }

            this._emitLocal(eventName, payload);
        }

        _registerNode() {
            if (!this.isConnected()) return;
            this.socket.emit('node:register', {
                role: this.role,
                nodeName: this.nodeName,
                tableId: this.tableId,
                clientSessionId: this.clientSessionId
            });
        }

        updateIdentity({ role, nodeName, tableId }) {
            if (role) this.role = role;
            if (nodeName) this.nodeName = nodeName;
            if (tableId !== undefined) this.tableId = tableId;

            if (this.staticFallbackMode) {
                this._emitFallbackSnapshot();
                this._broadcastFallbackEvent('sync:ping', {});
                return;
            }

            if (this.isConnected()) {
                this._registerNode();
            } else {
                this._emitLocal('proxy:status', this.getStatusInfo());
            }
        }

        _startHeartbeat() {
            this._stopHeartbeat();
            const measureRtt = () => {
                if (!this.isConnected()) return;
                const sentAt = Date.now();
                this.socket.emit('ping:client', { sentAt }, () => {
                    this.latencyMs = Math.max(1, Date.now() - sentAt);
                    this._emitLocal('proxy:status', this.getStatusInfo());
                });
            };
            measureRtt();
            this.heartbeatTimer = setInterval(measureRtt, 10000);
        }

        _stopHeartbeat() {
            if (this.heartbeatTimer) {
                clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = null;
            }
        }

        isConnected() {
            return Boolean(this.socket && this.socket.connected);
        }

        publish(type, payload = {}, { queueIfOffline = true } = {}) {
            if (this.staticFallbackMode) {
                return this._handleStaticFallbackCommand(type, payload);
            }

            if (!this.isConnected()) {
                if (queueIfOffline) {
                    const entry = {
                        id: generateId('q'),
                        type,
                        payload,
                        queuedAt: new Date().toISOString()
                    };
                    this.offlineQueue.push(entry);
                    this._persistQueue();
                    this._emitLocal('proxy:status', this.getStatusInfo());
                    this._emitLocal('proxy:queued', {
                        type,
                        payload,
                        queuedCount: this.offlineQueue.length
                    });
                    return Promise.resolve({ queued: true, fallback: 'localStorage', entry });
                }
                return Promise.reject(new Error('Sin conexión con el Broker Central'));
            }

            return new Promise((resolve) => {
                this.socket.emit(type, payload, (ack) => {
                    resolve(ack || { sent: true });
                });
            });
        }

        _flushOfflineQueue() {
            if (!this.isConnected() || !this.offlineQueue.length) return;
            const pending = [...this.offlineQueue];
            this.offlineQueue = [];
            this._persistQueue();

            pending.forEach((entry) => {
                this.socket.emit(entry.type, entry.payload, (ack) => {
                    if (entry.type === 'order:create' && ack && ack.order) {
                        this._removeSafeguardedOrder(ack.order.clientRequestId);
                        this._emitLocal('proxy:status', this.getStatusInfo());
                    }
                });
            });

            this._emitLocal('proxy:queue_flushed', { flushedCount: pending.length });
            this._emitLocal('proxy:status', this.getStatusInfo());
        }

        // --- API de Alto Nivel (Desacoplada del Transporte y de la Topología) ---

        submitOrder(orderPayload) {
            const clientRequestId = orderPayload.clientRequestId || generateId('ord');
            const enriched = {
                ...orderPayload,
                clientRequestId,
                clientSessionId: this.clientSessionId
            };

            if (!this.staticFallbackMode && !this.isConnected()) {
                const total = (enriched.items || []).reduce((s, i) => s + (Number(i.price) * Number(i.quantity)), 0);
                const localOrder = {
                    id: `local-${Date.now()}`,
                    orderCode: 'LOCAL-COLA',
                    clientRequestId,
                    clientSessionId: this.clientSessionId,
                    customer: enriched.customer,
                    nit: enriched.nit,
                    table: enriched.table,
                    notes: enriched.notes || '',
                    items: enriched.items || [],
                    total,
                    status: 'Pendiente',
                    assignedWaiter: null,
                    taxStatus: 'En espera de conexión',
                    taxLiquidation: null,
                    offlineSafeguarded: true,
                    date: new Date().toISOString()
                };
                this.safeguardedOrders.push(localOrder);
                this._persistSafeguardedOrders();
                this._emitLocal('order:offline_safeguarded', { order: localOrder });
            }

            return this.publish('order:create', enriched, { queueIfOffline: true });
        }

        updateOrderStatus(orderId, status) {
            return this.publish('order:update_status', { orderId, status }, { queueIfOffline: true });
        }

        assignWaiter(orderId, waiterName) {
            return this.publish('order:assign_waiter', { orderId, waiterName }, { queueIfOffline: true });
        }

        upsertDish(dish) {
            return this.publish('menu:upsert', { dish }, { queueIfOffline: true });
        }

        deleteDish(dishId) {
            return this.publish('menu:delete', { dishId }, { queueIfOffline: true });
        }

        createReservation(reservation) {
            return this.publish('reservation:create', reservation, { queueIfOffline: true });
        }

        createCustomer(customer) {
            return this.publish('customer:create', customer, { queueIfOffline: true });
        }

        deleteCustomer(customerId) {
            return this.publish('customer:delete', { customerId }, { queueIfOffline: true });
        }

        cashClose() {
            return this.publish('cash:close', {}, { queueIfOffline: false });
        }

        requestSync() {
            return this.publish('state:sync_request', {}, { queueIfOffline: false });
        }
    }

    globalScope.SmartOrderProxy = SmartOrderProxy;
})(typeof window !== 'undefined' ? window : globalThis);
