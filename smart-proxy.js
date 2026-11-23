/**
 * SmartOrderProxy - Proxy Inteligente del lado Cliente / Terminal.
 *
 * Implementa:
 * - Transporte WebSockets mediante Socket.io (comunicación full-duplex de baja sobrecarga).
 * - Principio de Desacoplamiento Espaciotemporal: ningún cliente conoce la IP/ubicación de Cocina o Meseros.
 * - Tolerancia a Desconexión mediante HTML5 LocalStorage (Fallback perimetral):
 *     * Salvaguarda pedidos y comandos en localStorage si se interrumpe la red.
 *     * Mantiene caché local del menú para consulta sin conectividad.
 *     * Retransmite automáticamente con idempotencia (clientRequestId) al restablecerse Socket.io.
 */
(function attachSmartProxy(globalScope) {
    const LOCAL_QUEUE_KEY = 'ge_local_proxy_queue_v1';
    const LOCAL_MENU_CACHE_KEY = 'ge_local_menu_cache_v1';
    const LOCAL_SAFEGUARDED_ORDERS_KEY = 'ge_local_safeguarded_orders_v1';
    const SESSION_ID_KEY = 'ge_node_session_id_v1';

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

            this.listeners = new Map();
            // Cola perimetral en HTML5 LocalStorage para tolerancia a desconexiones
            this.offlineQueue = readJsonStorage(globalScope.localStorage, LOCAL_QUEUE_KEY, []);
            this.safeguardedOrders = readJsonStorage(globalScope.localStorage, LOCAL_SAFEGUARDED_ORDERS_KEY, []);
        }

        _resolveBrokerUrl() {
            if (typeof window === 'undefined' || !window.location || window.location.protocol === 'file:') {
                return 'http://localhost:3000';
            }
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
                transport: 'Socket.io',
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
                // Modo perimetral LocalStorage Fallback si se abre sin el Broker Node.js
                this._setStatus('offline-fallback');
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

            // Reintentar sincronización inmediatamente cuando el dispositivo móvil recupera señal
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

        /**
         * Emite un evento vía Socket.io o lo salvaguarda en HTML5 LocalStorage
         * si existe una interrupción temporal de red.
         */
        publish(type, payload = {}, { queueIfOffline = true } = {}) {
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

            if (!this.isConnected()) {
                // Fallback perimetral en HTML5 LocalStorage para salvaguardar la comanda offline
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
