# Estado Global en Memoria, Auditoría y Fallback LocalStorage 🗄️

Gourmet Express Distribuido combina tres niveles de almacenamiento optimizados para alta concurrencia y tolerancia a desconexiones:

## 1. Estado Global en Memoria del Broker (`server/state-store.js`)

El Servidor Central Node.js mantiene en memoria el estado operativo compartido y lo sincroniza en tiempo real vía salas de **Socket.io**:

- **`dishes`**: Catálogo del menú propagado mediante `menu:updated`.
- **`orders`**: Comandas activas e históricas con `orderCode`, `clientRequestId` (idempotencia), `assignedWaiter`, estado (`Pendiente | Preparando | Listo | Entregado`) y el objeto `taxLiquidation` calculado por el `TaxLiquidationWorker` (Base Gravable, INC 8%, propina sugerida 10% y `fiscalHash` SHA-256).
- **`reservations` y `customers`**: Reservas y clientes frecuentes sincronizados según rol.

## 2. Persistencia de Auditoría en Worker Thread (`data/audit.log.jsonl`)

El hilo concurrente `AuditTrailWorker` (`server/workers/audit-worker.js`) registra cada evento crítico (`ORDER_CREATED`, `ORDER_STATUS_UPDATED`, `ORDER_ASSIGNED`, `TAX_LIQUIDATED`, `MENU_UPDATED`, `NODE_CONNECTED`, `CASH_CLOSE`) en formato JSON Lines con cadena criptográfica `prevHash` → `hash` (SHA-256), sin bloquear el Event Loop principal.

## 3. Tolerancia a Desconexión: HTML5 LocalStorage (Fallback Perimetral)

Administrado por el **Proxy Inteligente** (`smart-proxy.js`) en el navegador del comensal:

- **`ge_local_proxy_queue_v1`**: Cola FIFO de eventos/pedidos en espera cuando se interrumpe la red; se vacía automáticamente al reconectar Socket.io con idempotencia por `clientRequestId`.
- **`ge_local_safeguarded_orders_v1`**: Pedidos salvaguardados localmente mientras el dispositivo está sin conexión para mostrarlos en el rastreador del comensal hasta recibir confirmación (`order:ack`) del Broker.
- **`ge_local_menu_cache_v1`**: Caché del último catálogo del menú para permitir navegación sin red.
- **`ge_cart_v1`**: Carrito de compras persistente ante recargas del navegador móvil.
