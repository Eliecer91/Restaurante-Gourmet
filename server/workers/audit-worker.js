'use strict';

const { parentPort, threadId, workerData } = require('worker_threads');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUDIT_FILE = (workerData && workerData.auditFilePath)
    || path.join(__dirname, '..', '..', 'data', 'audit.log.jsonl');

let sequence = 0;
let lastHash = 'GENESIS_GOURMET_EXPRESS_EDA';

function ensureAuditDirectory() {
    const dir = path.dirname(AUDIT_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function initChainFromDisk() {
    try {
        ensureAuditDirectory();
        if (!fs.existsSync(AUDIT_FILE)) return;
        const content = fs.readFileSync(AUDIT_FILE, 'utf8').trim();
        if (!content) return;
        const lines = content.split('\n');
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
            const parsed = JSON.parse(lastLine);
            if (typeof parsed.seq === 'number') sequence = parsed.seq;
            if (parsed.hash) lastHash = parsed.hash;
        }
    } catch (_) {
        // Si el archivo previo no es legible, inicia una nueva cadena en memoria sin detener el worker.
    }
}

initChainFromDisk();

/**
 * Construye un registro de auditoría con hash SHA-256 encadenado y lo persiste
 * de forma asíncrona desde el Worker Thread para no bloquear el Event Loop principal.
 */
function processAuditEntry(entry) {
    const startHr = process.hrtime.bigint();
    sequence += 1;

    const timestamp = new Date().toISOString();
    const baseRecord = {
        id: `AUD-${Date.now()}-${sequence}`,
        seq: sequence,
        timestamp,
        eventType: entry.eventType || 'SYSTEM_EVENT',
        actorNodeId: entry.actorNodeId || 'broker-central',
        actorRole: entry.actorRole || 'broker',
        summary: entry.summary || '',
        metadata: entry.metadata || {},
        prevHash: lastHash
    };

    const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(baseRecord))
        .digest('hex')
        .slice(0, 20);

    lastHash = hash;

    const fullRecord = {
        ...baseRecord,
        hash,
        workerThreadId: threadId
    };

    ensureAuditDirectory();
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(fullRecord)}\n`, 'utf8');

    const elapsedNs = process.hrtime.bigint() - startHr;
    fullRecord.durationMs = Number((Number(elapsedNs) / 1e6).toFixed(3));

    return fullRecord;
}

if (parentPort) {
    parentPort.on('message', (message) => {
        const { taskId, entry } = message || {};
        try {
            const record = processAuditEntry(entry || {});
            parentPort.postMessage({
                taskId,
                ok: true,
                result: record
            });
        } catch (err) {
            parentPort.postMessage({
                taskId,
                ok: false,
                error: err.message || 'Error registrando auditoría'
            });
        }
    });
}

module.exports = { processAuditEntry };
