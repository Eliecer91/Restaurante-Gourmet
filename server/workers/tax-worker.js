'use strict';

const { parentPort, threadId } = require('worker_threads');
const crypto = require('crypto');

const INC_RATE = 0.08; // Impuesto Nacional al Consumo (Restaurantes Colombia - 8%)
const SUGGESTED_TIP_RATE = 0.10; // Propina voluntaria sugerida (10%)

/**
 * Calcula la liquidación impositiva colombiana de una comanda de forma concurrente
 * en un hilo secundario (Worker Thread) sin bloquear el hilo principal del Broker.
 */
function calculateTaxLiquidation(order) {
    const startHr = process.hrtime.bigint();

    const items = Array.isArray(order.items) ? order.items : [];
    const itemBreakdown = items.map((item) => {
        const unitPrice = Number(item.price) || 0;
        const quantity = Number(item.quantity) || 1;
        const grossLine = unitPrice * quantity;
        // Los precios de carta en Colombia incluyen INC del 8%
        const baseGravable = Math.round(grossLine / (1 + INC_RATE));
        const incAmount = grossLine - baseGravable;

        return {
            dishId: item.id,
            name: item.name,
            quantity,
            unitPrice,
            grossLine,
            baseGravable,
            incAmount
        };
    });

    const totalBruto = itemBreakdown.reduce((acc, i) => acc + i.grossLine, 0);
    const baseGravableTotal = itemBreakdown.reduce((acc, i) => acc + i.baseGravable, 0);
    const impoconsumoTotal = totalBruto - baseGravableTotal;
    const propinaSugerida = Math.round(baseGravableTotal * SUGGESTED_TIP_RATE);
    const totalConPropina = totalBruto + propinaSugerida;

    const processedAt = new Date().toISOString();
    const fiscalPayload = JSON.stringify({
        orderId: order.id,
        orderCode: order.orderCode,
        nit: order.nit || '222222222222',
        baseGravableTotal,
        impoconsumoTotal,
        totalBruto,
        processedAt
    });

    // Genera un código de validación fiscal determinístico (estilo CUFE simplificado)
    const fiscalHash = crypto
        .createHash('sha256')
        .update(fiscalPayload)
        .digest('hex')
        .slice(0, 24)
        .toUpperCase();

    const elapsedNs = process.hrtime.bigint() - startHr;
    const durationMs = Number((Number(elapsedNs) / 1e6).toFixed(3));

    return {
        orderId: order.id,
        orderCode: order.orderCode,
        regime: 'Impuesto Nacional al Consumo (INC 8% - Colombia)',
        incRate: INC_RATE,
        tipRate: SUGGESTED_TIP_RATE,
        baseGravable: baseGravableTotal,
        impoconsumo: impoconsumoTotal,
        totalFacturado: totalBruto,
        propinaSugerida,
        totalConPropina,
        fiscalHash,
        itemBreakdown,
        processedAt,
        durationMs,
        workerThreadId: threadId
    };
}

if (parentPort) {
    parentPort.on('message', (message) => {
        const { taskId, order } = message || {};
        try {
            const liquidation = calculateTaxLiquidation(order);
            parentPort.postMessage({
                taskId,
                ok: true,
                result: liquidation
            });
        } catch (err) {
            parentPort.postMessage({
                taskId,
                ok: false,
                error: err.message || 'Error calculando liquidación impositiva'
            });
        }
    });
}

module.exports = { calculateTaxLiquidation };
