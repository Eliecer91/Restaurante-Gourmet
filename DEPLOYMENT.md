# Manual de Despliegue (Gourmet Express Distribuido) 

El sistema opera sobre **Node.js LTS (v18+)** sirviendo la SPA (HTML5/CSS3/ES6+), el Broker de Eventos sobre **Socket.io** y los **Worker Threads** nativos de liquidación impositiva y auditoría.

## Requisitos
- **Node.js LTS v18 o superior**
- Dependencias instaladas vía `npm install` (`socket.io`)

## Ejecución Local y en Red LAN (Multi-dispositivo)

```bash
npm install
npm start
```

El servidor escucha en `0.0.0.0:3000` (configurable con `PORT` y `HOST`). Al iniciar muestra las direcciones LAN para conectar dispositivos reales en la misma red Wi-Fi:

- Comensales (móviles): `http://<IP_DEL_SERVIDOR>:3000/cliente`
- Pantalla en Cocina (KDS): `http://<IP_DEL_SERVIDOR>:3000/kds`
- Terminal de Sala / Meseros (Kanban): `http://<IP_DEL_SERVIDOR>:3000/mesero`
- Consola Admin & Monitor EDA: `http://<IP_DEL_SERVIDOR>:3000/admin`

## Modo Desarrollo

```bash
npm run dev
```

## Verificación de Despliegue

1. Consulta `GET /api/health` para validar runtime, transporte `WebSockets (Socket.io)`, estado de los `Worker Threads` y telemetría del Broker.
2. Verifica `GET /socket.io/socket.io.js` para confirmar la entrega del cliente Socket.io hacia la SPA.
