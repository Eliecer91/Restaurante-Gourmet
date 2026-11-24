# Gourmet Express Distribuido (EDA) 🍽️⚡

**Gourmet Express Distribuido** es un sistema de gestión de restaurante estructurado bajo una **Arquitectura Orientada a Eventos (Event-Driven Architecture - EDA)** con comunicación **full-duplex en tiempo real** mediante **Socket.io**, procesamiento concurrente en **Worker Threads** nativos de Node.js y tolerancia a desconexión con **HTML5 LocalStorage (Fallback)**.

## 🧰 Supuestos Arquitectónicos y Herramientas Tecnológicas

| Criterio Tecnológico | Herramienta Seleccionada | Justificación Arquitectónica |
|---|---|---|
| **Runtime del Servidor** | Node.js LTS (v18+) | Provee un modelo de E/S no bloqueante optimizado para miles de conexiones simultáneas. |
| **Transporte de Red** | WebSockets (`Socket.io`) | Comunicación persistente y bidireccional con baja sobrecarga de paquetes y enrutamiento por salas. |
| **Concurrencia y Multihilo** | `Worker Threads` (Módulo Nativo) | Permite aislar la ejecución de código intensivo en CPU (impuestos y auditoría) en hilos separados. |
| **Capa de Presentación** | HTML5, CSS3, JavaScript ES6+ | Arquitectura SPA de respuesta ultrarrápida sin renderizado del lado del servidor. |
| **Tolerancia a Desconexión** | HTML5 `LocalStorage` (Fallback) | Mecanismo perimetral para salvaguardar pedidos, carrito y caché del menú si se interrumpe la red. |

## 🏗️ Principio de Desacoplamiento Espaciotemporal

Los clientes (comensales) desconocen la ubicación de red de las pantallas de cocina (KDS) o de los terminales de sala. Toda interacción se delega al **Broker Central** sobre **Socket.io**, que enruta eventos asíncronamente mediante salas (`role:kds`, `role:waiter`, `role:admin`, `session:<clientSessionId>`), preservando la independencia operativa de cada nodo.

## 🧩 Componentes Funcionales y Nodos de Red

1. **Nodo Cliente Comensal (`/cliente` o `/`)**
   - SPA ligera orientada a dispositivos móviles.
   - Consulta el menú sincronizado en vivo y transmite órdenes a través del **Proxy Inteligente** ([smart-proxy.js](smart-proxy.js)), con respaldo perimetral en `localStorage` ante cortes de red, retransmisión idempotente y rastreador de estado en tiempo real.
2. **Nodo Terminal de Cocina - KDS (`/kds` o `/cocina`)**
   - Pantalla operativa de alto contraste que recibe notificaciones instantáneas de nuevos pedidos (con alerta sonora opcional y cronómetro) y actualiza el estado culinario en un clic (`Pendiente` → `Preparando` → `Listo`).
3. **Nodo Terminal de Sala / Meseros (`/mesero` o `/sala`)**
   - Tablero interactivo tipo **Kanban** (`Pendiente`, `Preparando`, `Listo`, `Entregado`) con Drag & Drop, asignación de mesero, alertas instantáneas cuando cocina marca un pedido listo y factura PDF con desglose INC 8%.
4. **Nodo Servidor Central / Broker de Eventos ([server/index.js](server/index.js), [server/ws-broker.js](server/ws-broker.js))**
   - Servidor Node.js con **Socket.io** que orquesta el enrutamiento de eventos, mantiene el estado global en memoria ([server/state-store.js](server/state-store.js)) y administra los canales full-duplex.
5. **Hilos de Procesamiento Secundario - Worker Threads ([server/worker-manager.js](server/worker-manager.js))**
   - **Tax Worker** ([server/workers/tax-worker.js](server/workers/tax-worker.js)): Liquidación impositiva colombiana (Base Gravable, INC 8%, propina sugerida 10% y hash fiscal SHA-256).
   - **Audit Worker** ([server/workers/audit-worker.js](server/workers/audit-worker.js)): Registro de auditoría concurrente con hash encadenado SHA-256 persistido en `data/audit.log.jsonl`.

## 🚀 Instalación y Ejecución

Requiere **Node.js LTS v18+**.

```bash
npm install
npm start
```

Abre cada nodo en pestañas o dispositivos distintos de tu red:

- **Nodo Comensal (SPA Móvil):** `http://localhost:3000/cliente`
- **Nodo Terminal de Cocina (KDS):** `http://localhost:3000/kds`
- **Nodo Terminal de Sala / Meseros:** `http://localhost:3000/mesero`
- **Consola Admin & Monitor EDA:** `http://localhost:3000/admin`
- **Diagnóstico REST del Broker:** `http://localhost:3000/api/health`

### Credenciales por Rol
- `admin` / `admin123` (Administración, Menú, Reportes y Monitor EDA)
- `mesero` / `mesero123` (Terminal de Sala / Meseros Kanban)
- `cocina` / `cocina123` (Terminal de Cocina KDS)
- `cliente` / `cliente123` (Nodo Cliente Comensal)

## 🧪 Pruebas Automatizadas

Ejecuta la suite de pruebas de integración (Socket.io full-duplex, desacoplamiento espaciotemporal, Worker Threads y Fallback de LocalStorage):

```bash
npm test
```

## 🧑‍💻 Desarrollado por
- **Jorge Eliecer Castillo** · 2026
