'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

/**
 * Administra los hilos concurrentes secundarios (Worker Threads) del servidor central:
 * - Tax Worker: liquidación impositiva colombiana (INC 8% + hash fiscal)
 * - Audit Worker: trazabilidad inmutable con cadena SHA-256 y escritura en disco
 */
class WorkerManager {
    constructor(options = {}) {
        this.auditFilePath = options.auditFilePath
            || path.join(__dirname, '..', 'data', 'audit.log.jsonl');
        this.pendingTasks = new Map();
        this.taskCounter = 0;
        this.closed = false;

        this.metrics = {
            taxWorker: {
                name: 'TaxLiquidationWorker',
                threadId: null,
                status: 'starting',
                tasksCompleted: 0,
                totalDurationMs: 0,
                avgDurationMs: 0,
                lastTaskAt: null
            },
            auditWorker: {
                name: 'AuditTrailWorker',
                threadId: null,
                status: 'starting',
                tasksCompleted: 0,
                totalDurationMs: 0,
                avgDurationMs: 0,
                lastTaskAt: null
            }
        };

        this.taxWorker = this._spawnWorker(
            'taxWorker',
            path.join(__dirname, 'workers', 'tax-worker.js')
        );
        this.auditWorker = this._spawnWorker(
            'auditWorker',
            path.join(__dirname, 'workers', 'audit-worker.js'),
            { auditFilePath: this.auditFilePath }
        );
    }

    _spawnWorker(key, scriptPath, workerData = {}) {
        const worker = new Worker(scriptPath, { workerData });
        this.metrics[key].threadId = worker.threadId;
        this.metrics[key].status = 'ready';

        worker.on('message', (msg) => {
            const { taskId, ok, result, error } = msg || {};
            const pending = this.pendingTasks.get(taskId);
            if (!pending) return;

            this.pendingTasks.delete(taskId);
            const stat = this.metrics[key];
            stat.tasksCompleted += 1;
            const dur = (result && typeof result.durationMs === 'number') ? result.durationMs : 0;
            stat.totalDurationMs += dur;
            stat.avgDurationMs = Number((stat.totalDurationMs / stat.tasksCompleted).toFixed(3));
            stat.lastTaskAt = new Date().toISOString();

            if (ok) pending.resolve(result);
            else pending.reject(new Error(error || `Worker ${key} error`));
        });

        worker.on('error', (err) => {
            this.metrics[key].status = 'error';
            console.error(`[WorkerManager] Error en ${key}:`, err);
        });

        worker.on('exit', (code) => {
            if (this.closed) {
                this.metrics[key].status = 'stopped';
                return;
            }
            this.metrics[key].status = 'restarting';
            if (code !== 0) {
                console.warn(`[WorkerManager] ${key} salió con código ${code}. Reiniciando hilo...`);
            }
            const restarted = this._spawnWorker(key, scriptPath, workerData);
            if (key === 'taxWorker') this.taxWorker = restarted;
            if (key === 'auditWorker') this.auditWorker = restarted;
        });

        return worker;
    }

    _dispatch(worker, payload) {
        if (this.closed) {
            return Promise.reject(new Error('WorkerManager detenido'));
        }
        const taskId = `task-${++this.taskCounter}-${Date.now()}`;
        return new Promise((resolve, reject) => {
            this.pendingTasks.set(taskId, { resolve, reject });
            worker.postMessage({ taskId, ...payload });
        });
    }

    liquidateOrderTaxes(order) {
        return this._dispatch(this.taxWorker, { order });
    }

    recordAudit(entry) {
        return this._dispatch(this.auditWorker, { entry });
    }

    getTelemetry() {
        return {
            taxWorker: { ...this.metrics.taxWorker },
            auditWorker: { ...this.metrics.auditWorker }
        };
    }

    async shutdown() {
        this.closed = true;
        for (const [, pending] of this.pendingTasks) {
            pending.reject(new Error('WorkerManager shutting down'));
        }
        this.pendingTasks.clear();
        await Promise.all([
            this.taxWorker ? this.taxWorker.terminate() : Promise.resolve(),
            this.auditWorker ? this.auditWorker.terminate() : Promise.resolve()
        ]);
    }
}

module.exports = { WorkerManager };
