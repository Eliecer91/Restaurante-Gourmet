'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: ioClient } = require('socket.io-client');
const { createDistributedServer } = require('../server/index');

function createSocketClient(url) {
    return new Promise((resolve, reject) => {
        const socket = ioClient(url, {
            transports: ['websocket'],
            reconnection: false
        });
        const queue = [];
        const waiters = [];

        socket.onAny((eventName, payload) => {
            const msg = { type: eventName, payload };
            const waiterIdx = waiters.findIndex((w) => w.predicate(msg));
            if (waiterIdx >= 0) {
                const waiter = waiters.splice(waiterIdx, 1)[0];
                clearTimeout(waiter.timer);
                waiter.resolve(msg);
            } else {
                queue.push(msg);
            }
        });

        const client = {
            socket,
            emit(eventName, payload, ack) {
                if (typeof ack === 'function') socket.emit(eventName, payload, ack);
                else socket.emit(eventName, payload);
            },
            waitFor(predicate, timeoutMs = 5000) {
                const queuedIdx = queue.findIndex(predicate);
                if (queuedIdx >= 0) {
                    return Promise.resolve(queue.splice(queuedIdx, 1)[0]);
                }
                return new Promise((res, rej) => {
                    const timer = setTimeout(() => {
                        const idx = waiters.findIndex((w) => w.resolve === res);
                        if (idx >= 0) waiters.splice(idx, 1);
                        rej(new Error('Timeout esperando evento Socket.io'));
                    }, timeoutMs);
                    waiters.push({ predicate, resolve: res, reject: rej, timer });
                });
            },
            close() {
                socket.disconnect();
            }
        };

        socket.on('connect', () => resolve(client));
        socket.on('connect_error', reject);
    });
}

function createMemoryStorage() {
    const store = new Map();
    return {
        getItem(k) { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
        clear() { store.clear(); }
    };
}

test('Gourmet Express Distribuido (Node.js + Socket.io + Worker Threads + LocalStorage Fallback)', async (t) => {
    const tempAuditFile = path.join(os.tmpdir(), `ge-audit-socketio-${Date.now()}.jsonl`);
    const app = createDistributedServer({
        auditFilePath: tempAuditFile
    });

    await new Promise((resolve) => {
        app.httpServer.listen(0, '127.0.0.1', resolve);
    });

    const { port } = app.httpServer.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    t.after(async () => {
        await app.close();
        if (fs.existsSync(tempAuditFile)) {
            fs.unlinkSync(tempAuditFile);
        }
    });

    await t.test('expone bundle cliente Socket.io, rutas SPA por nodo y /api/health con stack tecnológico', async () => {
        const healthRes = await fetch(`${baseUrl}/api/health`);
        assert.equal(healthRes.status, 200);
        const health = await healthRes.json();
        assert.equal(health.status, 'ok');
        assert.equal(health.stack.transport, 'WebSockets (Socket.io)');
        assert.equal(health.stack.offlineTolerance, 'HTML5 LocalStorage (Fallback)');
        assert.ok(health.workers.taxWorker.threadId > 0);
        assert.ok(health.workers.auditWorker.threadId > 0);

        const sioBundleRes = await fetch(`${baseUrl}/socket.io/socket.io.js`);
        assert.equal(sioBundleRes.status, 200);
        const sioScript = await sioBundleRes.text();
        assert.ok(sioScript.length > 1000);

        for (const route of ['/cliente', '/kds', '/mesero', '/admin']) {
            const res = await fetch(`${baseUrl}${route}`);
            assert.equal(res.status, 200);
            const html = await res.text();
            assert.ok(html.includes('/socket.io/socket.io.js'));
        }
    });

    await t.test('enruta comandas por salas Socket.io con desacoplamiento espaciotemporal y Worker Threads', async () => {
        const diner = await createSocketClient(baseUrl);
        const kds = await createSocketClient(baseUrl);
        const waiter = await createSocketClient(baseUrl);
        const admin = await createSocketClient(baseUrl);

        try {
            diner.emit('node:register', { role: 'client', nodeName: 'Mesa 5', clientSessionId: 'sess-mesa-5' });
            kds.emit('node:register', { role: 'kds', nodeName: 'Cocina Principal' });
            waiter.emit('node:register', { role: 'waiter', nodeName: 'Mesero Juan' });
            admin.emit('node:register', { role: 'admin', nodeName: 'Monitor Admin' });

            const dinerSnap = await diner.waitFor((m) => m.type === 'state:snapshot');
            await kds.waitFor((m) => m.type === 'state:snapshot');
            await waiter.waitFor((m) => m.type === 'state:snapshot');
            const adminSnap = await admin.waitFor((m) => m.type === 'state:snapshot');

            // Principio de desacoplamiento espaciotemporal
            assert.equal(dinerSnap.payload.connectedNodes, undefined);
            assert.ok(Array.isArray(dinerSnap.payload.snapshot.dishes));
            assert.ok(Array.isArray(adminSnap.payload.connectedNodes));

            const orderPayload = {
                clientRequestId: 'req-sio-001',
                customer: 'Ana Gómez',
                nit: '1012345678',
                table: 'Mesa 5',
                notes: 'Sin cebolla',
                items: [
                    { id: 4, name: 'Carne Asada Especial', price: 42000, quantity: 1 },
                    { id: 7, name: 'Limonada de Coco', price: 12500, quantity: 2 }
                ]
            };

            diner.emit('order:create', orderPayload);

            const [ack, kdsEvent, waiterEvent, taxEvent, auditEvent] = await Promise.all([
                diner.waitFor((m) => m.type === 'order:ack'),
                kds.waitFor((m) => m.type === 'order:created'),
                waiter.waitFor((m) => m.type === 'order:created'),
                diner.waitFor((m) => m.type === 'order:tax_liquidated'),
                admin.waitFor((m) => m.type === 'audit:recorded' && m.payload.record.eventType === 'TAX_LIQUIDATED')
            ]);

            assert.equal(ack.payload.deduplicated, false);
            const orderId = ack.payload.order.id;
            assert.equal(ack.payload.order.total, 67000);
            assert.equal(kdsEvent.payload.order.id, orderId);
            assert.equal(waiterEvent.payload.order.id, orderId);

            // Worker Thread 1: Liquidación INC 8%
            const tax = taxEvent.payload.taxLiquidation;
            assert.equal(tax.baseGravable + tax.impoconsumo, 67000);
            assert.ok(tax.impoconsumo > 0);
            assert.equal(tax.fiscalHash.length, 24);
            assert.ok(tax.workerThreadId > 0);

            // Worker Thread 2: Auditoría SHA-256
            assert.ok(auditEvent.payload.record.hash);
            assert.ok(auditEvent.payload.record.workerThreadId > 0);
            assert.equal(fs.existsSync(tempAuditFile), true);

            // Idempotencia ante retransmisión
            diner.emit('order:create', orderPayload);
            const dupAck = await diner.waitFor((m) => m.type === 'order:ack');
            assert.equal(dupAck.payload.deduplicated, true);
            assert.equal(dupAck.payload.order.id, orderId);

            // Flujo KDS -> Sala/Mesero -> Comensal
            kds.emit('order:update_status', { orderId, status: 'Preparando' });
            const [dinerPrep, waiterPrep] = await Promise.all([
                diner.waitFor((m) => m.type === 'order:status_changed' && m.payload.order.status === 'Preparando'),
                waiter.waitFor((m) => m.type === 'order:status_changed' && m.payload.order.status === 'Preparando')
            ]);
            assert.equal(dinerPrep.payload.order.status, 'Preparando');
            assert.equal(waiterPrep.payload.order.status, 'Preparando');

            waiter.emit('order:assign_waiter', { orderId, waiterName: 'Mesero Juan' });
            const dinerAssigned = await diner.waitFor((m) => m.type === 'order:assigned');
            expectAssigned(dinerAssigned.payload.order.assignedWaiter, 'Mesero Juan');

            kds.emit('order:update_status', { orderId, status: 'Listo' });
            await waiter.waitFor((m) => m.type === 'order:status_changed' && m.payload.order.status === 'Listo');

            waiter.emit('order:update_status', { orderId, status: 'Entregado' });
            const dinerDelivered = await diner.waitFor(
                (m) => m.type === 'order:status_changed' && m.payload.order.status === 'Entregado'
            );
            assert.equal(dinerDelivered.payload.order.status, 'Entregado');
        } finally {
            diner.close();
            kds.close();
            waiter.close();
            admin.close();
        }
    });

    await t.test('SmartOrderProxy salvaguarda pedidos en HTML5 LocalStorage sin red y los sincroniza al reconectar Socket.io', async () => {
        const mockLocalStorage = createMemoryStorage();
        const mockSessionStorage = createMemoryStorage();

        globalThis.localStorage = mockLocalStorage;
        globalThis.sessionStorage = mockSessionStorage;
        globalThis.io = ioClient;

        delete require.cache[require.resolve('../smart-proxy.js')];
        require('../smart-proxy.js');

        const proxy = new globalThis.SmartOrderProxy({
            role: 'client',
            nodeName: 'Mesa 9 Offline',
            brokerUrl: baseUrl
        });

        // 1. Enviar pedido estando DESCONECTADO -> debe salvaguardarse en localStorage
        const offlineRes = await proxy.submitOrder({
            customer: 'Carlos Ruiz',
            nit: '900111222',
            table: 'Mesa 9',
            items: [{ id: 1, name: 'Empanadas de Yuca', price: 12500, quantity: 2 }]
        });

        assert.equal(offlineRes.queued, true);
        assert.equal(offlineRes.fallback, 'localStorage');
        assert.equal(proxy.getSafeguardedOrders().length, 1);

        const persistedQueue = JSON.parse(mockLocalStorage.getItem('ge_local_proxy_queue_v1'));
        assert.equal(persistedQueue.length, 1);
        assert.equal(persistedQueue[0].type, 'order:create');

        // 2. Conectar Socket.io -> el Smart Proxy vacía la cola de LocalStorage y recibe ACK del Broker
        const ackPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout esperando sincronización desde LocalStorage')), 5000);
            proxy.on('order:ack', (data) => {
                clearTimeout(timer);
                resolve(data);
            });
        });

        proxy.connect();
        const ackData = await ackPromise;

        assert.equal(ackData.order.table, 'Mesa 9');
        assert.equal(ackData.order.total, 25000);
        assert.equal(proxy.getSafeguardedOrders().length, 0);
        assert.equal(JSON.parse(mockLocalStorage.getItem('ge_local_proxy_queue_v1')).length, 0);

        // Verificar que también guardó caché del menú en LocalStorage
        assert.ok(Array.isArray(proxy.getCachedMenu()));
        assert.ok(proxy.getCachedMenu().length > 0);

        if (proxy.socket) proxy.socket.disconnect();
        proxy._stopHeartbeat();
        delete globalThis.localStorage;
        delete globalThis.sessionStorage;
        delete globalThis.io;
    });
});

function expectAssigned(actual, expected) {
    assert.equal(actual, expected);
}
