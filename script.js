/* global SmartOrderProxy, html2pdf */

// --- 1. CONFIGURACIÓN DE NODOS Y ESTADO EN MEMORIA DEL CLIENTE ---
const FALLBACK_DISHES = [
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

const USERS = {
    admin: { pass: 'admin123', role: 'admin', name: 'Administrador' },
    mesero: { pass: 'mesero123', role: 'waiter', name: 'Mesero Juan' },
    cocina: { pass: 'cocina123', role: 'kds', name: 'Chef Cocina (KDS)' },
    cliente: { pass: 'cliente123', role: 'client', name: 'Cliente Comensal' }
};

let dishes = [...FALLBACK_DISHES];
let orders = [];
let reservations = [];
let customers = [];
let auditLogs = [];
let connectedNodes = [];
let workerTelemetry = null;
let brokerSummary = null;

// Carrito persistido en HTML5 LocalStorage (tolerancia a desconexión/recarga del dispositivo móvil)
let cart = JSON.parse(localStorage.getItem('ge_cart_v1') || '[]');
let currentUser = JSON.parse(sessionStorage.getItem('ge_user_v1') || 'null');
let activeCategory = 'all';
let searchQuery = '';
let activeViewId = 'view-menu';
let kdsSoundEnabled = true;

// Detectar el tipo de nodo desde la URL (/kds, /mesero, /admin, /cliente o ?node=...)
function detectInitialNodeRole() {
    const path = (window.location.pathname || '/').toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const qNode = (params.get('node') || '').toLowerCase();

    if (qNode === 'kds' || path === '/kds' || path === '/cocina') return 'kds';
    if (qNode === 'waiter' || path === '/mesero' || path === '/sala') return 'waiter';
    if (qNode === 'admin' || path === '/admin' || path === '/monitor') return 'admin';
    if (currentUser && currentUser.role) return currentUser.role;
    return 'client';
}

function getEffectiveRole() {
    if (currentUser && currentUser.role) return currentUser.role;
    return initialNodeRole;
}

function getDefaultNodeName(role) {
    if (currentUser && currentUser.name) return currentUser.name;
    if (role === 'kds') return 'Terminal Cocina (KDS)';
    if (role === 'waiter') {
        const input = document.getElementById('waiter-name-input');
        return (input && input.value.trim()) || 'Mesero Juan';
    }
    if (role === 'admin') return 'Consola Admin & Monitor EDA';
    return 'Comensal Móvil';
}

const initialNodeRole = detectInitialNodeRole();

// Si se abre directamente una ruta operativa (/kds, /mesero, /admin), inicializar sesión del nodo en esta pestaña
if (!currentUser && initialNodeRole !== 'client') {
    const defaultProfiles = {
        kds: { username: 'cocina', role: 'kds', name: 'Chef Cocina (KDS)' },
        waiter: { username: 'mesero', role: 'waiter', name: 'Mesero Juan' },
        admin: { username: 'admin', role: 'admin', name: 'Administrador' }
    };
    currentUser = defaultProfiles[initialNodeRole];
    sessionStorage.setItem('ge_user_v1', JSON.stringify(currentUser));
}

// Instancia del Proxy Inteligente (Socket.io Full-Duplex + LocalStorage Fallback)
const smartProxy = new SmartOrderProxy({
    role: getEffectiveRole(),
    nodeName: getDefaultNodeName(getEffectiveRole())
});

// Cargar menú en caché desde HTML5 LocalStorage si existe (tolerancia a desconexión)
const cachedDishes = smartProxy.getCachedMenu();
if (Array.isArray(cachedDishes) && cachedDishes.length) {
    dishes = cachedDishes;
}

// --- 2. ALERTAS SONORAS KDS (Web Audio API sin dependencias externas) ---
function playChime(type = 'new-order') {
    if (!kdsSoundEnabled) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = type === 'ready' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(type === 'ready' ? 880 : 660, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(type === 'ready' ? 1174 : 880, ctx.currentTime + 0.18);

        gain.gain.setValueAtTime(0.14, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

        osc.start();
        osc.stop(ctx.currentTime + 0.36);
    } catch (_) {
        // Algunos navegadores bloquean audio antes de la primera interacción del usuario
    }
}

// --- 3. SUSCRIPCIÓN A EVENTOS DEL BROKER CENTRAL (EDA) ---
function bindBrokerEvents() {
    smartProxy.on('proxy:status', (info) => {
        renderBrokerStatus(info);
    });

    smartProxy.on('proxy:queued', ({ queuedCount }) => {
        showToast(`Sin red: pedido salvaguardado en LocalStorage (${queuedCount} en cola)`, 'warning');
    });

    smartProxy.on('order:offline_safeguarded', () => {
        renderAllActiveViews();
    });

    smartProxy.on('proxy:queue_flushed', ({ flushedCount }) => {
        showToast(`Reconexión Socket.io: ${flushedCount} evento(s) sincronizado(s) desde LocalStorage`);
    });

    smartProxy.on('state:snapshot', (data) => {
        const snap = data.snapshot || {};
        if (Array.isArray(snap.dishes) && snap.dishes.length) dishes = snap.dishes;
        if (Array.isArray(snap.orders)) orders = snap.orders;
        if (Array.isArray(snap.reservations)) reservations = snap.reservations;
        if (Array.isArray(snap.customers)) customers = snap.customers;
        if (Array.isArray(snap.auditLogs)) auditLogs = snap.auditLogs;
        if (Array.isArray(data.connectedNodes)) connectedNodes = data.connectedNodes;
        if (data.workerTelemetry) workerTelemetry = data.workerTelemetry;
        if (data.brokerSummary) brokerSummary = data.brokerSummary;

        renderAllActiveViews();
    });

    smartProxy.on('order:ack', ({ order, deduplicated }) => {
        if (!order) return;
        upsertLocalOrder(order);
        renderAllActiveViews();
        if (!deduplicated) {
            showToast(`Comanda ${order.orderCode} recibida por el Broker Central`);
        }
    });

    smartProxy.on('order:created', ({ order }) => {
        if (!order) return;
        upsertLocalOrder(order);
        renderAllActiveViews();

        const role = getEffectiveRole();
        if (role === 'kds') {
            playChime('new-order');
            showToast(`🔥 Nueva comanda en Cocina: ${order.orderCode} (${order.table})`);
        } else if (role === 'waiter' || role === 'admin') {
            showToast(`Nueva comanda ${order.orderCode} registrada (${order.table})`);
        }
    });

    smartProxy.on('order:status_changed', ({ order, updatedBy }) => {
        if (!order) return;
        upsertLocalOrder(order);
        renderAllActiveViews();

        const role = getEffectiveRole();
        if (role === 'waiter' && order.status === 'Listo') {
            playChime('ready');
            showToast(`🔔 ¡Comanda ${order.orderCode} (${order.table}) LISTA en cocina para entregar!`);
        } else if (role === 'client') {
            showToast(`Tu pedido ${order.orderCode} ahora está: ${order.status}`);
        } else if (updatedBy) {
            showToast(`${order.orderCode} → ${order.status} (${updatedBy.nodeName})`);
        }
    });

    smartProxy.on('order:assigned', ({ order }) => {
        if (!order) return;
        upsertLocalOrder(order);
        renderAllActiveViews();
        if (getEffectiveRole() === 'client') {
            showToast(`${order.assignedWaiter} está atendiendo tu comanda ${order.orderCode}`);
        }
    });

    smartProxy.on('order:tax_liquidated', ({ orderId, orderCode, taxLiquidation }) => {
        orders = orders.map((o) => (
            o.id === orderId
                ? { ...o, taxStatus: 'Liquidado', taxLiquidation }
                : o
        ));
        renderAllActiveViews();
        if (getEffectiveRole() === 'admin') {
            showToast(`Worker Thread #${taxLiquidation.workerThreadId} liquidó INC 8% de ${orderCode}`);
        }
    });

    smartProxy.on('menu:updated', ({ dishes: updatedDishes }) => {
        if (Array.isArray(updatedDishes)) {
            dishes = updatedDishes;
            renderAllActiveViews();
            showToast('Carta actualizada en tiempo real desde el Broker');
        }
    });

    smartProxy.on('reservation:created', ({ reservations: allReservations }) => {
        if (Array.isArray(allReservations)) {
            reservations = allReservations;
            if (activeViewId === 'view-reservations') renderReservations();
        }
    });

    smartProxy.on('customers:updated', ({ customers: updatedCustomers }) => {
        if (Array.isArray(updatedCustomers)) {
            customers = updatedCustomers;
            if (activeViewId === 'view-customers') renderCustomersTable();
        }
    });

    smartProxy.on('cash:closed', () => {
        orders = [];
        renderAllActiveViews();
        showToast('Cierre de caja sincronizado por el Broker Central');
    });

    smartProxy.on('broker:topology', ({ connectedNodes: nodes, brokerSummary: summary, workerTelemetry: workers }) => {
        if (Array.isArray(nodes)) connectedNodes = nodes;
        if (summary) brokerSummary = summary;
        if (workers) workerTelemetry = workers;
        if (activeViewId === 'view-eda-monitor') renderEdaMonitor();
    });

    smartProxy.on('broker:summary', ({ brokerSummary: summary }) => {
        if (summary) brokerSummary = summary;
    });

    smartProxy.on('workers:telemetry', ({ workerTelemetry: workers }) => {
        if (workers) workerTelemetry = workers;
        if (activeViewId === 'view-eda-monitor') renderEdaMonitor();
    });

    smartProxy.on('audit:recorded', ({ record, workerTelemetry: workers }) => {
        if (record) {
            auditLogs.push(record);
            if (auditLogs.length > 120) auditLogs.shift();
        }
        if (workers) workerTelemetry = workers;
        if (activeViewId === 'view-eda-monitor') renderEdaMonitor();
    });

    smartProxy.on('broker:error', ({ error }) => {
        showToast(error || 'Error reportado por el Broker', 'danger');
    });
}

function upsertLocalOrder(order) {
    const idx = orders.findIndex((o) => o.id === order.id);
    if (idx >= 0) {
        orders[idx] = { ...orders[idx], ...order };
    } else {
        orders.push(order);
    }
}

function renderBrokerStatus(info) {
    const pill = document.getElementById('broker-status-pill');
    const text = document.getElementById('broker-status-text');
    const meta = document.getElementById('broker-meta');
    if (!pill || !text || !meta) return;

    pill.dataset.state = info.status;
    if (info.status === 'connected') {
        text.textContent = 'Broker Socket.io Conectado';
        const rtt = info.latencyMs ? ` · RTT ${info.latencyMs}ms` : '';
        const queue = info.queuedCount > 0 ? ` · Cola LocalStorage: ${info.queuedCount}` : '';
        meta.textContent = `(${info.nodeId || 'registrando...'}${rtt}${queue})`;
    } else if (info.status === 'offline-fallback') {
        text.textContent = 'Modo Fallback LocalStorage (Multi-pestaña)';
        meta.textContent = `(${info.nodeId || 'local'} · Sincronización local activa)`;
    } else if (info.status === 'reconnecting') {
        text.textContent = 'Reconectando Socket.io...';
        meta.textContent = info.queuedCount > 0 ? `(Respaldo LocalStorage: ${info.queuedCount})` : '(Fallback LocalStorage activo)';
    } else {
        text.textContent = 'Conectando al Broker Socket.io...';
        meta.textContent = '';
    }
}

// --- 4. AUTENTICACIÓN Y CAMBIO DE ROL DE NODO ---
function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('login-user').value.trim().toLowerCase();
    const pass = document.getElementById('login-pass').value;

    if (USERS[user] && USERS[user].pass === pass) {
        currentUser = { ...USERS[user], username: user };
        sessionStorage.setItem('ge_user_v1', JSON.stringify(currentUser));
        document.getElementById('login-modal').classList.remove('active');
        showToast(`Bienvenido, ${currentUser.name}`);

        smartProxy.updateIdentity({
            role: currentUser.role,
            nodeName: currentUser.name
        });

        updateNavigation();
        if (currentUser.role === 'admin') switchView('view-eda-monitor');
        else if (currentUser.role === 'kds') switchView('view-kds');
        else if (currentUser.role === 'waiter') switchView('view-waiter');
        else switchView('view-menu');
    } else {
        showToast('Credenciales incorrectas', 'danger');
    }
}

function handleLogout() {
    currentUser = null;
    sessionStorage.removeItem('ge_user_v1');
    window.location.href = '/?node=client';
}

// --- 5. NAVEGACIÓN Y VISTAS ---
function switchView(viewId) {
    activeViewId = viewId;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.main-nav a').forEach((a) => {
        a.classList.toggle('active', a.dataset.view === viewId);
    });

    renderAllActiveViews();
}

function renderAllActiveViews() {
    if (activeViewId === 'view-menu') {
        renderClientMenu();
        renderClientOrdersTracker();
    }
    if (activeViewId === 'view-kds') renderKdsBoard();
    if (activeViewId === 'view-waiter') renderWaiterBoard();
    if (activeViewId === 'view-admin-menu') renderAdminMenuTable();
    if (activeViewId === 'view-customers') renderCustomersTable();
    if (activeViewId === 'view-reservations') renderReservations();
    if (activeViewId === 'view-reports') renderReports();
    if (activeViewId === 'view-eda-monitor') renderEdaMonitor();
}

function updateNavigation() {
    const nav = document.getElementById('main-nav');
    const role = getEffectiveRole();

    const isStaff = role === 'kds' || role === 'waiter' || role === 'admin';
    const topbar = document.getElementById('eda-topbar');
    if (topbar) topbar.classList.toggle('hidden', !isStaff);

    const roleBadge = document.getElementById('active-node-badge');
    const roleLabels = { client: 'NODO COMENSAL', kds: 'NODO KDS COCINA', waiter: 'NODO SALA / MESERO', admin: 'NODO ADMIN EDA' };
    roleBadge.textContent = roleLabels[role] || 'COMENSAL';
    roleBadge.className = `node-role-badge role-${role}${isStaff ? '' : ' hidden'}`;

    document.querySelectorAll('.node-chip').forEach((chip) => {
        chip.classList.toggle('active-node', chip.dataset.nodeLink === role);
    });

    let html = '<ul>';
    html += '<li><a data-view="view-menu">Menú Comensal</a></li>';
    html += '<li><a data-view="view-reservations">Reservas</a></li>';

    if (role === 'kds' || role === 'admin') {
        html += '<li><a data-view="view-kds">Cocina (KDS)</a></li>';
    }
    if (role === 'waiter' || role === 'admin') {
        html += '<li><a data-view="view-waiter">Sala Kanban</a></li>';
    }
    if (role === 'admin') {
        html += '<li><a data-view="view-admin-menu">Gestión Menú</a></li>';
        html += '<li><a data-view="view-customers">Clientes</a></li>';
        html += '<li><a data-view="view-reports">Reportes</a></li>';
        html += '<li><a data-view="view-eda-monitor">Monitor EDA</a></li>';
    }
    html += '</ul>';
    nav.innerHTML = html;

    document.querySelectorAll('.main-nav a').forEach((a) => {
        a.classList.toggle('active', a.dataset.view === activeViewId);
    });

    const loginTrigger = document.getElementById('login-trigger');
    const userLogged = document.getElementById('user-logged');
    if (currentUser) {
        loginTrigger.classList.add('hidden');
        userLogged.classList.remove('hidden');
        document.getElementById('username-text').textContent = currentUser.name;
    } else {
        loginTrigger.classList.remove('hidden');
        userLogged.classList.add('hidden');
    }

    nav.onclick = (e) => {
        if (e.target.tagName === 'A') {
            switchView(e.target.dataset.view);
        }
    };
}

// --- 6. NODO CLIENTE COMENSAL (MENÚ + RASTREADOR EN VIVO) ---
function renderClientMenu() {
    const grid = document.getElementById('menu-grid');
    let filtered = dishes;
    if (activeCategory !== 'all') filtered = filtered.filter((d) => d.category === activeCategory);
    if (searchQuery) filtered = filtered.filter((d) => d.name.toLowerCase().includes(searchQuery));

    grid.innerHTML = filtered.map((dish) => `
        <div class="dish-card">
            <div class="dish-img-container">
                <img src="${dish.image}" alt="${dish.name}" loading="lazy">
                <span class="dish-category">${dish.category}</span>
            </div>
            <div class="dish-info">
                <h3>${dish.name}</h3>
                <p>${dish.description}</p>
                <div class="dish-footer">
                    <span class="dish-price">$${dish.price.toLocaleString('es-CO')}</span>
                    <button class="btn-add" type="button" onclick="addToCart(${dish.id})" title="Agregar al pedido">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderClientOrdersTracker() {
    const panel = document.getElementById('client-orders-tracker');
    const container = document.getElementById('client-orders-list');
    if (!panel || !container) return;

    const syncedOrders = getEffectiveRole() === 'client'
        ? orders
        : orders.filter((o) => o.clientSessionId === smartProxy.clientSessionId);

    // Combinar pedidos sincronizados con pedidos salvaguardados en LocalStorage durante cortes de red
    const syncedReqIds = new Set(syncedOrders.map((o) => o.clientRequestId).filter(Boolean));
    const localPending = smartProxy.getSafeguardedOrders()
        .filter((o) => !syncedReqIds.has(o.clientRequestId));
    const myOrders = [...syncedOrders, ...localPending];

    if (!myOrders.length) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');
    const steps = ['Pendiente', 'Preparando', 'Listo', 'Entregado'];

    container.innerHTML = [...myOrders].reverse().map((order) => {
        const currentIdx = steps.indexOf(order.status);
        const tax = order.taxLiquidation;
        let taxHtml;
        if (order.offlineSafeguarded) {
            taxHtml = '<span class="tax-pill pending"><i class="fas fa-hdd"></i> Salvaguardado en LocalStorage · Se sincronizará al volver la red</span>';
        } else if (tax) {
            taxHtml = `<span class="tax-pill"><i class="fas fa-check-circle"></i> INC 8%: $${tax.impoconsumo.toLocaleString('es-CO')} · Worker #${tax.workerThreadId}</span>`;
        } else {
            taxHtml = '<span class="tax-pill pending"><i class="fas fa-spinner fa-spin"></i> Liquidando INC en Worker Thread...</span>';
        }

        return `
            <div class="client-order-card">
                <div class="client-order-top">
                    <span class="order-code-badge">${order.orderCode || '#' + order.id.toString().slice(-4)}</span>
                    <span class="table-badge">${order.table}</span>
                </div>
                <div class="ticket-items">
                    ${order.items.map((i) => `${i.quantity}x ${i.name}`).join(' · ')}
                </div>
                <div class="status-stepper">
                    ${steps.map((st, idx) => {
                        let cls = 'step-item';
                        if (idx < currentIdx) cls += ' done';
                        else if (idx === currentIdx) cls += ' current';
                        return `<div class="${cls}">${st}</div>`;
                    }).join('')}
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px;">
                    <span style="font-size:0.82rem; color:var(--text-muted);">
                        ${order.offlineSafeguarded
                            ? '<i class="fas fa-wifi"></i> Esperando reconexión Socket.io'
                            : (order.assignedWaiter ? `<i class="fas fa-user-tie"></i> ${order.assignedWaiter}` : 'Esperando asignación de mesero')}
                    </span>
                    ${order.offlineSafeguarded ? '' : `
                        <button class="btn-secondary" style="padding:6px 12px; font-size:0.78rem;" type="button" onclick="generatePDF(${order.id})">
                            <i class="fas fa-file-pdf"></i> Comprobante
                        </button>
                    `}
                </div>
                ${taxHtml}
            </div>
        `;
    }).join('');
}

// --- 7. NODO TERMINAL DE COCINA (KDS - KITCHEN DISPLAY SYSTEM) ---
function formatElapsed(isoDate) {
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
    const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
    const secs = String(diffSec % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

function renderKdsBoard() {
    const grid = document.getElementById('kds-tickets-grid');
    if (!grid) return;

    const pending = orders.filter((o) => o.status === 'Pendiente');
    const preparing = orders.filter((o) => o.status === 'Preparando');
    const ready = orders.filter((o) => o.status === 'Listo');
    const activeKitchenOrders = [...pending, ...preparing, ...ready];

    const activeDishCount = [...pending, ...preparing].reduce(
        (sum, o) => sum + o.items.reduce((acc, i) => acc + i.quantity, 0),
        0
    );

    document.getElementById('kds-count-pending').textContent = pending.length;
    document.getElementById('kds-count-prep').textContent = preparing.length;
    document.getElementById('kds-count-ready').textContent = ready.length;
    document.getElementById('kds-count-dishes').textContent = activeDishCount;

    if (!activeKitchenOrders.length) {
        grid.innerHTML = `
            <div class="kds-empty">
                <i class="fas fa-utensils" style="font-size: 2.5rem; margin-bottom: 12px; opacity: 0.5;"></i>
                <h3>Sin comandas pendientes en cocina</h3>
                <p>Las órdenes enviadas desde los Nodos Comensal aparecerán aquí instantáneamente vía WebSocket.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = activeKitchenOrders.map((order) => {
        const statusSlug = order.status.toLowerCase();
        let actionHtml = '';
        if (order.status === 'Pendiente') {
            actionHtml = `<button class="kds-action-btn start-prep" type="button" onclick="updateOrderStatus(${order.id}, 'Preparando')">
                <i class="fas fa-fire"></i> Iniciar Preparación
            </button>`;
        } else if (order.status === 'Preparando') {
            actionHtml = `<button class="kds-action-btn mark-ready" type="button" onclick="updateOrderStatus(${order.id}, 'Listo')">
                <i class="fas fa-bell"></i> Marcar Listo (Notificar Mesero)
            </button>`;
        } else {
            actionHtml = `<div class="kds-ready-banner"><i class="fas fa-check-double"></i> LISTO · Esperando retiro de Sala</div>`;
        }

        return `
            <article class="kds-ticket status-${statusSlug}">
                <div class="kds-ticket-head">
                    <span class="kds-code">${order.orderCode || '#' + order.id.toString().slice(-4)} · ${order.table}</span>
                    <span class="kds-timer" data-created-at="${order.date}">${formatElapsed(order.date)}</span>
                </div>
                <div class="kds-meta-row">
                    <span><i class="fas fa-user"></i> ${order.customer}</span>
                    <span>${order.assignedWaiter ? `Mesero: ${order.assignedWaiter}` : 'Sin mesero'}</span>
                </div>
                <ul class="kds-items-list">
                    ${order.items.map((item) => `
                        <li>
                            <span class="kds-qty-badge">${item.quantity}</span>
                            <span>${item.name}</span>
                        </li>
                    `).join('')}
                </ul>
                ${order.notes ? `<div class="kds-notes"><i class="fas fa-sticky-note"></i> Nota: ${order.notes}</div>` : ''}
                ${actionHtml}
            </article>
        `;
    }).join('');
}

// Actualizar reloj y cronómetros del KDS cada segundo sin re-renderizar todo el DOM
setInterval(() => {
    const clock = document.getElementById('kds-clock');
    if (clock) clock.textContent = new Date().toLocaleTimeString('es-CO');
    if (activeViewId === 'view-kds') {
        document.querySelectorAll('.kds-timer[data-created-at]').forEach((el) => {
            el.textContent = formatElapsed(el.dataset.createdAt);
        });
    }
}, 1000);

// --- 8. NODO TERMINAL DE SALA / MESEROS (KANBAN INTERACTIVO) ---
function renderWaiterBoard() {
    const statuses = ['Pendiente', 'Preparando', 'Listo', 'Entregado'];
    statuses.forEach((status) => {
        const slug = status.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const list = document.getElementById(`list-${slug}`);
        const countEl = document.getElementById(`count-${slug}`);
        if (!list) return;

        const filtered = orders.filter((o) => o.status === status);
        if (countEl) countEl.textContent = filtered.length;

        list.innerHTML = filtered.map((order) => {
            const tax = order.taxLiquidation;
            return `
                <div class="order-ticket status-${slug}" draggable="true" data-order-id="${order.id}">
                    <div class="ticket-header">
                        <span>${order.orderCode || '#' + order.id.toString().slice(-4)}</span>
                        <span class="table-badge">${order.table || 'N/A'}</span>
                    </div>
                    ${order.assignedWaiter
                        ? `<div class="waiter-assigned-tag"><i class="fas fa-user-check"></i> ${order.assignedWaiter}</div>`
                        : `<button class="btn-secondary btn-block" style="padding:6px 10px; font-size:0.76rem; margin-bottom:8px; background:#0984e3;" type="button" onclick="assignOrderToMe(${order.id})">
                            <i class="fas fa-hand-paper"></i> Asignarme Comanda
                        </button>`
                    }
                    <div class="ticket-body">
                        <p style="font-weight: 700; margin-bottom: 5px; font-size: 0.88rem;"><i class="fas fa-user"></i> ${order.customer}</p>
                        <div class="ticket-items">
                            ${order.items.map((i) => `${i.quantity}x ${i.name}`).join('<br>')}
                        </div>
                        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ddd; display: flex; justify-content: space-between; font-weight: 700; color: var(--primary);">
                            <span>Total:</span>
                            <span>$${order.total.toLocaleString('es-CO')}</span>
                        </div>
                        ${tax
                            ? `<div style="font-size:0.74rem; color:#047857; margin-top:4px;">INC 8%: $${tax.impoconsumo.toLocaleString('es-CO')} · Liquidado</div>`
                            : '<div style="font-size:0.74rem; color:#92400e; margin-top:4px;">Liquidando impuestos...</div>'
                        }
                    </div>
                    <div class="ticket-actions">
                        ${getNextStatusBtn(order)}
                        <button class="btn-secondary btn-block" type="button" onclick="generatePDF(${order.id})" style="background: #57606f;">
                            <i class="fas fa-file-pdf"></i> Comprobante PDF
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    });

    bindKanbanDragAndDrop();
}

function bindKanbanDragAndDrop() {
    document.querySelectorAll('.order-ticket[draggable="true"]').forEach((card) => {
        card.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', card.dataset.orderId);
        };
    });

    document.querySelectorAll('.order-col').forEach((col) => {
        col.ondragover = (e) => {
            e.preventDefault();
            col.classList.add('drag-over');
        };
        col.ondragleave = () => col.classList.remove('drag-over');
        col.ondrop = (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const orderId = Number(e.dataTransfer.getData('text/plain'));
            const targetStatus = col.dataset.status;
            if (orderId && targetStatus) {
                window.updateOrderStatus(orderId, targetStatus);
            }
        };
    });
}

function getNextStatusBtn(order) {
    const flow = { Pendiente: 'Preparando', Preparando: 'Listo', Listo: 'Entregado' };
    const next = flow[order.status];
    if (!next) return '<span class="badge-success"><i class="fas fa-check"></i> Entregado</span>';
    const label = next === 'Entregado' ? 'Confirmar Entrega en Mesa' : `Pasar a ${next}`;
    return `<button class="btn-primary btn-block" type="button" onclick="updateOrderStatus(${order.id}, '${next}')">${label}</button>`;
}

window.updateOrderStatus = (id, newStatus) => {
    smartProxy.updateOrderStatus(id, newStatus);
};

window.assignOrderToMe = (id) => {
    const waiterInput = document.getElementById('waiter-name-input');
    const waiterName = (waiterInput && waiterInput.value.trim())
        || (currentUser && currentUser.name)
        || 'Mesero en turno';
    smartProxy.assignWaiter(id, waiterName);
};

// --- 9. ADMIN CRUD MENÚ ---
function renderAdminMenuTable() {
    const tbody = document.getElementById('admin-menu-table');
    if (!tbody) return;
    tbody.innerHTML = dishes.map((dish) => `
        <tr>
            <td><img src="${dish.image}" class="td-img" alt="${dish.name}"></td>
            <td><strong>${dish.name}</strong></td>
            <td>${dish.category}</td>
            <td>$${dish.price.toLocaleString('es-CO')}</td>
            <td>
                <button class="btn-icon" type="button" onclick="editDish(${dish.id})"><i class="fas fa-edit"></i></button>
                <button class="btn-icon delete" type="button" onclick="deleteDish(${dish.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openDishModal(dish = null) {
    const isEdit = Boolean(dish);
    openModal(isEdit ? 'Editar Platillo' : 'Nuevo Platillo', `
        <form id="dish-form">
            <input type="hidden" id="edit-id" value="${dish ? dish.id : ''}">
            <div class="form-group"><label>Nombre</label><input type="text" id="dish-name" required value="${dish ? dish.name : ''}"></div>
            <div class="form-group"><label>Categoría</label>
                <select id="dish-category">
                    <option ${dish?.category === 'Entradas' ? 'selected' : ''}>Entradas</option>
                    <option ${dish?.category === 'Platos Fuertes' ? 'selected' : ''}>Platos Fuertes</option>
                    <option ${dish?.category === 'Bebidas' ? 'selected' : ''}>Bebidas</option>
                    <option ${dish?.category === 'Postres' ? 'selected' : ''}>Postres</option>
                </select>
            </div>
            <div class="form-group"><label>Precio (COP)</label><input type="number" id="dish-price" required value="${dish ? dish.price : ''}"></div>
            <div class="form-group"><label>Imagen URL</label><input type="text" id="dish-image" required value="${dish ? dish.image : ''}"></div>
            <div class="form-group"><label>Descripción</label><textarea id="dish-desc">${dish ? dish.description : ''}</textarea></div>
            <button type="submit" class="btn-primary btn-block">Guardar y Propagar a Nodos</button>
        </form>
    `);

    document.getElementById('dish-form').onsubmit = (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-id').value;
        const dishPayload = {
            id: id ? parseInt(id, 10) : null,
            name: document.getElementById('dish-name').value,
            category: document.getElementById('dish-category').value,
            price: parseFloat(document.getElementById('dish-price').value),
            image: document.getElementById('dish-image').value,
            description: document.getElementById('dish-desc').value
        };
        smartProxy.upsertDish(dishPayload);
        closeModal();
    };
}

window.deleteDish = (id) => {
    if (confirm('¿Eliminar este platillo del catálogo global?')) {
        smartProxy.deleteDish(id);
    }
};

window.editDish = (id) => {
    const dish = dishes.find((d) => d.id === id);
    openDishModal(dish);
};

// --- 10. RESERVAS ---
function renderReservations() {
    const list = document.getElementById('reservations-list');
    if (!list) return;
    const role = getEffectiveRole();
    const filtered = role === 'client' ? reservations.slice(-5) : reservations;

    list.innerHTML = filtered.length ? [...filtered].reverse().map((res) => `
        <div class="order-ticket" style="border-left-color: var(--accent); cursor: default;">
            <div class="ticket-header">
                <span><i class="fas fa-calendar"></i> ${res.date}</span>
                <span><i class="fas fa-clock"></i> ${res.time}</span>
            </div>
            <div class="ticket-items" style="margin-bottom:0;">
                <strong>${res.name}</strong> · ${res.people} personas
            </div>
        </div>
    `).join('') : '<p style="text-align:center; color:gray;">No hay reservas registradas aún.</p>';
}

function handleReservation(e) {
    e.preventDefault();
    smartProxy.createReservation({
        name: currentUser ? currentUser.name : 'Cliente Invitado',
        date: document.getElementById('res-date').value,
        time: document.getElementById('res-time').value,
        people: document.getElementById('res-people').value
    });
    e.target.reset();
    showToast('Reserva transmitida al Broker Central');
}

// --- 11. CLIENTES ---
function renderCustomersTable() {
    const tbody = document.getElementById('customers-table');
    if (!tbody) return;
    tbody.innerHTML = customers.length ? customers.map((c) => `
        <tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.nit}</td>
            <td>${c.email || '—'}</td>
            <td>${c.phone || '—'}</td>
            <td>
                <button class="btn-icon delete" type="button" onclick="deleteCustomer(${c.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('') : '<tr><td colspan="5" style="text-align:center; color:gray;">Sin clientes registrados</td></tr>';
}

function openCustomerModal() {
    openModal('Nuevo Cliente', `
        <form id="customer-form">
            <div class="form-group"><label>Nombre / Razón Social</label><input type="text" id="cust-name" required></div>
            <div class="form-group"><label>NIT / RUT / Cédula</label><input type="text" id="cust-nit" required></div>
            <div class="form-group"><label>Email</label><input type="email" id="cust-email"></div>
            <div class="form-group"><label>Teléfono</label><input type="text" id="cust-phone"></div>
            <button type="submit" class="btn-primary btn-block">Guardar Cliente</button>
        </form>
    `);

    document.getElementById('customer-form').onsubmit = (e) => {
        e.preventDefault();
        smartProxy.createCustomer({
            name: document.getElementById('cust-name').value,
            nit: document.getElementById('cust-nit').value,
            email: document.getElementById('cust-email').value,
            phone: document.getElementById('cust-phone').value
        });
        closeModal();
        showToast('Cliente registrado en el Broker');
    };
}

window.deleteCustomer = (id) => {
    if (confirm('¿Eliminar cliente?')) {
        smartProxy.deleteCustomer(id);
    }
};

// --- 12. REPORTES Y LIQUIDACIÓN FISCAL ---
function renderReports() {
    const todaySales = orders.reduce((sum, o) => sum + o.total, 0);
    const totalBase = orders.reduce((sum, o) => sum + (o.taxLiquidation ? o.taxLiquidation.baseGravable : 0), 0);
    const totalInc = orders.reduce((sum, o) => sum + (o.taxLiquidation ? o.taxLiquidation.impoconsumo : 0), 0);

    document.getElementById('stat-today-sales').textContent = `$${todaySales.toLocaleString('es-CO')}`;
    document.getElementById('stat-tax-base').textContent = `$${totalBase.toLocaleString('es-CO')}`;
    document.getElementById('stat-tax-inc').textContent = `$${totalInc.toLocaleString('es-CO')}`;
    document.getElementById('stat-total-orders').textContent = orders.length;

    const historyTbody = document.getElementById('history-table');
    historyTbody.innerHTML = orders.length ? [...orders].reverse().map((o) => {
        const tax = o.taxLiquidation;
        const taxText = tax
            ? `Base $${tax.baseGravable.toLocaleString('es-CO')} + INC $${tax.impoconsumo.toLocaleString('es-CO')} (T#${tax.workerThreadId})`
            : 'Procesando en Worker...';
        return `
            <tr>
                <td><strong>${o.orderCode || '#' + o.id.toString().slice(-4)}</strong></td>
                <td>${o.customer} <span style="color:gray;">(${o.table})</span></td>
                <td><strong>$${o.total.toLocaleString('es-CO')}</strong></td>
                <td style="font-size:0.82rem;">${taxText}</td>
                <td>${o.status}</td>
                <td>
                    <button class="btn-icon" type="button" onclick="generatePDF(${o.id})"><i class="fas fa-file-pdf"></i></button>
                </td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6" style="text-align:center; color:gray;">Sin comandas registradas en este turno</td></tr>';
}

function handleCashClose() {
    if (confirm('¿Desea realizar el cierre de caja en el Broker Central?')) {
        smartProxy.cashClose();
    }
}

// --- 13. MONITOR EDA & WORKER THREADS ---
function renderEdaMonitor() {
    const summary = brokerSummary || { totalNodes: connectedNodes.length, nodesByRole: {}, eventsRouted: 0 };
    const counts = summary.nodesByRole || {};

    document.getElementById('eda-total-nodes').textContent = summary.totalNodes || connectedNodes.length;
    document.getElementById('eda-nodes-breakdown').textContent = `${counts.client || 0} Comensal · ${counts.kds || 0} KDS · ${counts.waiter || 0} Mesero · ${counts.admin || 0} Admin`;
    document.getElementById('eda-events-routed').textContent = summary.eventsRouted || 0;

    if (workerTelemetry) {
        const tw = workerTelemetry.taxWorker;
        const aw = workerTelemetry.auditWorker;
        document.getElementById('eda-tax-worker-tasks').textContent = tw.tasksCompleted;
        document.getElementById('eda-tax-worker-meta').textContent = `Thread #${tw.threadId} · ${tw.avgDurationMs} ms prom. · ${tw.status}`;
        document.getElementById('eda-audit-worker-tasks').textContent = aw.tasksCompleted;
        document.getElementById('eda-audit-worker-meta').textContent = `Thread #${aw.threadId} · ${aw.avgDurationMs} ms prom. · ${aw.status}`;
    }

    const nodesTable = document.getElementById('eda-nodes-table');
    nodesTable.innerHTML = connectedNodes.length ? connectedNodes.map((n) => `
        <tr>
            <td><code>${n.nodeId}</code></td>
            <td><span class="node-role-badge role-${n.role}">${n.role.toUpperCase()}</span></td>
            <td>${n.nodeName}</td>
            <td>${new Date(n.connectedAt).toLocaleTimeString('es-CO')}</td>
        </tr>
    `).join('') : '<tr><td colspan="4" style="text-align:center; color:gray;">Sin nodos registrados</td></tr>';

    const auditFeed = document.getElementById('eda-audit-feed');
    auditFeed.innerHTML = auditLogs.length ? [...auditLogs].reverse().map((rec) => `
        <div class="audit-entry type-${rec.eventType}">
            <div class="audit-entry-top">
                <span>#${rec.seq} · ${rec.eventType}</span>
                <span>${new Date(rec.timestamp).toLocaleTimeString('es-CO')}</span>
            </div>
            <div>${rec.summary}</div>
            <div class="audit-hash">
                Worker Thread #${rec.workerThreadId} (${rec.durationMs}ms) · SHA256: ${rec.hash}
            </div>
        </div>
    `).join('') : '<p style="text-align:center; color:gray; padding:20px;">Esperando eventos auditados...</p>';
}

// --- 14. CARRITO Y CHECKOUT VÍA SMART PROXY ---
window.addToCart = (id) => {
    const dish = dishes.find((d) => d.id === id);
    if (!dish) return;
    const item = cart.find((i) => i.id === id);
    if (item) item.quantity += 1;
    else cart.push({ ...dish, quantity: 1 });
    saveCart();
    updateCartUI();
    showToast(`${dish.name} añadido`);
};

function updateCartUI() {
    const container = document.getElementById('cart-items');
    let total = 0;
    container.innerHTML = cart.length ? cart.map((item) => {
        total += item.price * item.quantity;
        return `
            <div class="cart-item">
                <img src="${item.image}" alt="${item.name}" class="cart-item-img">
                <div class="cart-item-details">
                    <h4>${item.name}</h4>
                    <span>$${item.price.toLocaleString('es-CO')}</span>
                </div>
                <div class="qty-controls">
                    <button class="qty-btn" type="button" onclick="updateQty(${item.id}, -1)">-</button>
                    <span>${item.quantity}</span>
                    <button class="qty-btn" type="button" onclick="updateQty(${item.id}, 1)">+</button>
                </div>
            </div>
        `;
    }).join('') : '<p style="text-align:center; color:gray; margin-top:40px;">Tu comanda está vacía.</p>';

    document.getElementById('cart-total-price').textContent = `$${total.toLocaleString('es-CO')}`;
    document.getElementById('cart-count').textContent = cart.reduce((s, i) => s + i.quantity, 0);
}

window.updateQty = (id, delta) => {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) cart = cart.filter((i) => i.id !== id);
    saveCart();
    updateCartUI();
};

function toggleCart() {
    document.getElementById('cart-sidebar').classList.toggle('active');
    document.getElementById('cart-overlay').classList.toggle('active');
}

function openCheckoutModal() {
    if (!cart.length) return showToast('Carrito vacío', 'danger');
    const customerOptions = customers.map((c) => `<option value="${c.nit}">${c.name}</option>`).join('');

    openModal('Transmitir Comanda vía Smart Proxy', `
        <form id="checkout-form">
            ${customers.length ? `
                <div class="form-group">
                    <label>Seleccionar Cliente Guardado</label>
                    <select id="check-customer-select">
                        <option value="">-- Seleccionar --</option>
                        ${customerOptions}
                    </select>
                </div>
            ` : ''}
            <div class="form-group"><label>Nombre Facturación</label><input type="text" id="check-name" placeholder="Nombre del comensal" required></div>
            <div class="form-group"><label>NIT / Cédula</label><input type="text" id="check-nit" placeholder="Para liquidación fiscal" required></div>
            <div class="form-group"><label>Mesa / Ubicación</label><input type="text" id="check-table" placeholder="Ej. Mesa 5" required></div>
            <div class="form-group"><label>Notas para Cocina (KDS)</label><input type="text" id="check-notes" placeholder="Ej. Sin cebolla, término medio..."></div>
            <div class="form-group" style="display:flex; align-items:center; gap:10px; background:#f8f9fa; padding:10px; border-radius:12px;">
                <input type="checkbox" id="save-customer-chk" style="width:auto; margin:0;">
                <label for="save-customer-chk" style="margin:0; font-size:0.84rem; cursor:pointer;">Guardar cliente en el Broker</label>
            </div>
            <button type="submit" class="btn-primary btn-block" style="margin-top:16px;">Enviar Comanda Ahora</button>
        </form>
    `);

    const select = document.getElementById('check-customer-select');
    if (select) {
        select.onchange = (e) => {
            const selected = customers.find((c) => c.nit === e.target.value);
            if (selected) {
                document.getElementById('check-name').value = selected.name;
                document.getElementById('check-nit').value = selected.nit;
            }
        };
    }

    document.getElementById('checkout-form').onsubmit = async (e) => {
        e.preventDefault();
        const payload = {
            customer: document.getElementById('check-name').value,
            nit: document.getElementById('check-nit').value,
            table: document.getElementById('check-table').value,
            notes: document.getElementById('check-notes').value,
            saveCustomer: document.getElementById('save-customer-chk').checked,
            items: cart.map((i) => ({
                id: i.id,
                name: i.name,
                category: i.category,
                price: i.price,
                quantity: i.quantity,
                image: i.image
            }))
        };

        await smartProxy.submitOrder(payload);
        cart = [];
        saveCart();
        updateCartUI();
        closeModal();
        toggleCart();
    };
}

// --- 15. PDF CON LIQUIDACIÓN IMPOSITIVA DEL WORKER THREAD ---
window.generatePDF = (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const tax = order.taxLiquidation;
    const baseGravable = tax ? tax.baseGravable : Math.round(order.total / 1.08);
    const incAmount = tax ? tax.impoconsumo : (order.total - baseGravable);
    const tipSuggested = tax ? tax.propinaSugerida : Math.round(baseGravable * 0.10);
    const fiscalHash = tax ? tax.fiscalHash : 'PENDIENTE-WORKER';

    const element = document.createElement('div');
    element.innerHTML = `
        <div style="padding: 36px; font-family: sans-serif; color: #333;">
            <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #ff4757; margin: 0;">Gourmet Express Distribuido</h1>
                <p style="margin-top:4px;">Comprobante de Pago Electrónico · Liquidación INC 8%</p>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 24px; border-top: 1px solid #eee; border-bottom: 1px solid #eee; padding: 16px 0;">
                <div>
                    <p><strong>CLIENTE:</strong> ${order.customer}</p>
                    <p><strong>NIT/C.C:</strong> ${order.nit || 'Sin registro'}</p>
                    <p><strong>UBICACIÓN:</strong> ${order.table}</p>
                    <p><strong>MESERO:</strong> ${order.assignedWaiter || 'Asignación general'}</p>
                </div>
                <div style="text-align: right;">
                    <p><strong>COMANDA:</strong> ${order.orderCode || '#' + order.id.toString().slice(-6)}</p>
                    <p><strong>FECHA:</strong> ${new Date(order.date).toLocaleString('es-CO')}</p>
                    <p><strong>CÓDIGO FISCAL:</strong> ${fiscalHash}</p>
                </div>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                <thead>
                    <tr style="background: #1a1a2e; color: white;">
                        <th style="padding: 10px; text-align: left;">DESCRIPCIÓN</th>
                        <th style="padding: 10px; text-align: center;">CANT.</th>
                        <th style="padding: 10px; text-align: right;">TOTAL</th>
                    </tr>
                </thead>
                <tbody>
                    ${order.items.map((item) => `
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
                            <td style="padding: 10px; text-align: center; border-bottom: 1px solid #eee;">${item.quantity}</td>
                            <td style="padding: 10px; text-align: right; border-bottom: 1px solid #eee;">$${(item.price * item.quantity).toLocaleString('es-CO')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div style="margin-left: auto; max-width: 300px; font-size: 0.92rem;">
                <div style="display:flex; justify-content:space-between; padding:4px 0;"><span>Base Gravable:</span><span>$${baseGravable.toLocaleString('es-CO')}</span></div>
                <div style="display:flex; justify-content:space-between; padding:4px 0;"><span>INC (8%):</span><span>$${incAmount.toLocaleString('es-CO')}</span></div>
                <div style="display:flex; justify-content:space-between; padding:8px 0; font-weight:800; font-size:1.2rem; color:#ff4757; border-top:1px solid #ddd;">
                    <span>TOTAL FACTURA:</span><span>$${order.total.toLocaleString('es-CO')}</span>
                </div>
                <div style="display:flex; justify-content:space-between; padding:4px 0; color:#666; font-size:0.82rem;">
                    <span>Propina voluntaria sugerida (10%):</span><span>$${tipSuggested.toLocaleString('es-CO')}</span>
                </div>
            </div>
        </div>
    `;

    html2pdf().set({
        margin: 0.5,
        filename: `Comprobante_${order.orderCode || order.id}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    }).from(element).save();
};

// --- 16. UTILIDADES E INICIALIZACIÓN ---
function openModal(title, content) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-content').innerHTML = content;
    document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
}

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    if (type === 'danger') t.style.background = 'var(--danger)';
    else if (type === 'warning') t.style.background = 'var(--warning)';
    else t.style.background = 'var(--accent)';
    t.classList.add('active');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove('active'), 3200);
}

function saveCart() {
    localStorage.setItem('ge_cart_v1', JSON.stringify(cart));
}

function setupCoreListeners() {
    document.getElementById('close-modal').onclick = closeModal;
    document.getElementById('login-form').onsubmit = handleLogin;
    document.getElementById('logout-btn').onclick = handleLogout;

    document.getElementById('dish-search').oninput = (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderClientMenu();
    };

    document.getElementById('category-list').onclick = (e) => {
        if (e.target.tagName === 'LI') {
            activeCategory = e.target.dataset.category;
            document.querySelectorAll('#category-list li').forEach((li) => li.classList.toggle('active', li === e.target));
            renderClientMenu();
        }
    };

    document.getElementById('cart-btn').onclick = toggleCart;
    document.getElementById('close-cart').onclick = toggleCart;
    document.getElementById('cart-overlay').onclick = toggleCart;
    document.getElementById('checkout-btn').onclick = openCheckoutModal;
    document.getElementById('btn-add-dish').onclick = () => openDishModal();
    document.getElementById('btn-add-customer').onclick = () => openCustomerModal();
    document.getElementById('res-form').onsubmit = handleReservation;
    document.getElementById('btn-cash-close').onclick = handleCashClose;

    const refreshEda = document.getElementById('btn-refresh-eda');
    if (refreshEda) {
        refreshEda.onclick = () => smartProxy.requestSync();
    }

    const soundToggle = document.getElementById('kds-sound-toggle');
    if (soundToggle) {
        soundToggle.onclick = () => {
            kdsSoundEnabled = !kdsSoundEnabled;
            soundToggle.classList.toggle('active', kdsSoundEnabled);
            soundToggle.innerHTML = kdsSoundEnabled
                ? '<i class="fas fa-volume-up"></i> Alerta Sonora: ON'
                : '<i class="fas fa-volume-mute"></i> Alerta Sonora: OFF';
        };
    }

    const waiterInput = document.getElementById('waiter-name-input');
    if (waiterInput) {
        waiterInput.onchange = () => {
            if (getEffectiveRole() === 'waiter') {
                smartProxy.updateIdentity({ role: 'waiter', nodeName: waiterInput.value.trim() || 'Mesero' });
            }
        };
    }

    document.addEventListener('click', (e) => {
        if (e.target.id === 'login-trigger' || e.target.closest('#login-trigger')) {
            document.getElementById('login-modal').classList.add('active');
        }
        if (e.target.id === 'close-login' || e.target.closest('#close-login')) {
            document.getElementById('login-modal').classList.remove('active');
        }
    });
}

function initApp() {
    bindBrokerEvents();
    setupCoreListeners();
    updateNavigation();
    updateCartUI();

    const role = getEffectiveRole();
    if (role === 'kds') switchView('view-kds');
    else if (role === 'waiter') switchView('view-waiter');
    else if (role === 'admin') switchView('view-eda-monitor');
    else switchView('view-menu');

    smartProxy.connect();
}

try {
    initApp();
} catch (err) {
    console.error('Error iniciando Gourmet Express Distribuido:', err);
}
