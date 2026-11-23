'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { StateStore } = require('./state-store');
const { WorkerManager } = require('./worker-manager');
const { CentralEventBroker } = require('./ws-broker');

const ROOT_DIR = path.join(__dirname, '..');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

// Rutas SPA dedicadas para cada nodo de red del ecosistema distribuido
const SPA_NODE_ROUTES = new Set([
    '/',
    '/cliente',
    '/comensal',
    '/kds',
    '/cocina',
    '/mesero',
    '/sala',
    '/admin',
    '/monitor'
]);

function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(payload);
}

function getLocalNetworkUrls(port) {
    const urls = [`http://localhost:${port}`];
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
        for (const details of iface || []) {
            if (details.family === 'IPv4' && !details.internal) {
                urls.push(`http://${details.address}:${port}`);
            }
        }
    }
    return urls;
}

function createDistributedServer(options = {}) {
    const stateStore = options.stateStore || new StateStore();
    const workerManager = options.workerManager || new WorkerManager({
        auditFilePath: options.auditFilePath
    });
    const broker = new CentralEventBroker({
        stateStore,
        workerManager
    });

    const httpServer = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = parsedUrl.pathname;

        // Delegar todas las rutas /socket.io/* al motor de Socket.io
        if (pathname.startsWith('/socket.io/')) {
            return;
        }

        // --- Endpoints REST de diagnóstico y monitoreo del Broker ---
        if (pathname === '/api/health' && req.method === 'GET') {
            return sendJson(res, 200, {
                status: 'ok',
                architecture: 'Event-Driven Architecture (EDA)',
                stack: {
                    runtime: `Node.js ${process.version}`,
                    transport: 'WebSockets (Socket.io)',
                    concurrency: 'Worker Threads (Módulo Nativo)',
                    presentation: 'HTML5, CSS3, JavaScript ES6+ SPA',
                    offlineTolerance: 'HTML5 LocalStorage (Fallback)'
                },
                broker: broker.getPublicSummary(),
                workers: workerManager.getTelemetry(),
                uptimeSec: Math.round(process.uptime())
            });
        }

        if (pathname === '/api/nodes' && req.method === 'GET') {
            return sendJson(res, 200, {
                nodes: broker.getConnectedNodes(),
                summary: broker.getPublicSummary()
            });
        }

        if (pathname === '/api/audit' && req.method === 'GET') {
            return sendJson(res, 200, {
                total: stateStore.auditLogs.length,
                records: stateStore.auditLogs.slice(-100)
            });
        }

        if (pathname === '/api/menu' && req.method === 'GET') {
            return sendJson(res, 200, { dishes: stateStore.dishes });
        }

        // --- Enrutamiento SPA por Nodo de Red ---
        let relativePath = pathname;
        if (SPA_NODE_ROUTES.has(pathname)) {
            relativePath = '/index.html';
        }

        const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
        const absolutePath = path.join(ROOT_DIR, safePath);

        // Proteger archivos del servidor y datos internos contra lectura directa por HTTP
        const forbiddenPrefixes = [
            path.join(ROOT_DIR, 'server'),
            path.join(ROOT_DIR, 'data'),
            path.join(ROOT_DIR, 'node_modules'),
            path.join(ROOT_DIR, '.git')
        ];
        if (!absolutePath.startsWith(ROOT_DIR) || forbiddenPrefixes.some((p) => absolutePath.startsWith(p))) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Acceso denegado');
        }

        fs.stat(absolutePath, (statErr, stats) => {
            if (statErr || !stats.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Recurso no encontrado');
            }

            const ext = path.extname(absolutePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-cache'
            });
            fs.createReadStream(absolutePath).pipe(res);
        });
    });

    broker.attachToServer(httpServer);

    async function close() {
        await broker.shutdown();
        await workerManager.shutdown();
        if (httpServer.listening) {
            await new Promise((resolve) => httpServer.close(resolve));
        }
    }

    return { httpServer, broker, stateStore, workerManager, close };
}

if (require.main === module) {
    const PORT = Number(process.env.PORT) || 3000;
    const HOST = process.env.HOST || '0.0.0.0';
    const app = createDistributedServer();

    app.httpServer.listen(PORT, HOST, () => {
        const urls = getLocalNetworkUrls(PORT);
        console.log('\n==============================================================');
        console.log('  GOURMET EXPRESS DISTRIBUIDO - BROKER CENTRAL EDA (SOCKET.IO)');
        console.log('==============================================================');
        console.log(`  Runtime:        Node.js ${process.version}`);
        console.log(`  Transporte:     WebSockets (Socket.io)`);
        console.log(`  URL Base:       ${urls[0]}`);
        if (urls.length > 1) {
            console.log(`  Red Local LAN:  ${urls.slice(1).join(' | ')}`);
        }
        console.log('--------------------------------------------------------------');
        console.log('  Nodos de Red Disponibles:');
        console.log(`   • Comensal (SPA Móvil):  http://localhost:${PORT}/cliente`);
        console.log(`   • Cocina (KDS):          http://localhost:${PORT}/kds`);
        console.log(`   • Sala / Meseros Kanban: http://localhost:${PORT}/mesero`);
        console.log(`   • Admin & Monitor EDA:   http://localhost:${PORT}/admin`);
        console.log('--------------------------------------------------------------');
        const telemetry = app.workerManager.getTelemetry();
        console.log('  Worker Threads activos (Módulo Nativo):');
        console.log(`   • ${telemetry.taxWorker.name} (threadId: ${telemetry.taxWorker.threadId})`);
        console.log(`   • ${telemetry.auditWorker.name} (threadId: ${telemetry.auditWorker.threadId})`);
        console.log('==============================================================\n');
    });

    const gracefulShutdown = async () => {
        console.log('\n[Broker] Deteniendo servidor distribuido y Worker Threads...');
        await app.close();
        process.exit(0);
    };
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
}

module.exports = { createDistributedServer };
