/**
 * Módulo: js/navigationProxy.js
 * Patrón Proxy Distribuido: Caché en Memoria → HTML5 LocalStorage → Sincronización WebSocket (Socket.io)
 * + Modo Degradado ante desconexión.
 *
 * Puede operar de forma autónoma con una URL del Broker o enlazarse a la instancia compartida
 * de SmartOrderProxy para evitar duplicar conexiones Socket.io en la SPA.
 */

const DEFAULT_FALLBACK_CATALOG = [
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

const CACHE_KEYS = ['ge_local_menu_cache_v1', 'rest_dishes'];
const DEGRADED_ORDERS_KEY = 'rest_orders';

function readStorage(key) {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
        // Ignora errores de cuota o entorno sin localStorage
    }
}

export class DistributedNavigationProxy {
    constructor(brokerUrl, options = {}) {
        this.brokerUrl = brokerUrl;
        this.smartProxy = options.smartProxy || null;
        this.socket = null;
        this.isOnline = false;
        this.memoryCatalog = null;
        this.onCatalogSync = typeof options.onCatalogSync === 'function' ? options.onCatalogSync : null;

        if (this.smartProxy) {
            this._bindSharedSmartProxy();
        } else {
            this.initConnection();
        }
    }

    _bindSharedSmartProxy() {
        this.isOnline = this.smartProxy.isConnected();
        this.smartProxy.on('proxy:status', (info) => {
            this.isOnline = info.status === 'connected';
        });
        this.smartProxy.on('state:snapshot', (data) => {
            const snapDishes = data?.snapshot?.dishes;
            if (Array.isArray(snapDishes) && snapDishes.length) {
                this.syncCatalog(snapDishes);
            }
        });
        this.smartProxy.on('menu:updated', ({ dishes }) => {
            if (Array.isArray(dishes)) {
                this.syncCatalog(dishes);
            }
        });
    }

    initConnection() {
        try {
            const ioFactory = typeof globalThis !== 'undefined' ? globalThis.io : undefined;
            if (typeof ioFactory === 'function') {
                this.socket = ioFactory(this.brokerUrl, {
                    reconnectionAttempts: 4,
                    timeout: 2000
                });
                this.socket.on('connect', () => {
                    this.isOnline = true;
                    console.log('[Proxy Navegación] Enlace establecido con Broker Central.');
                });
                this.socket.on('disconnect', () => {
                    this.isOnline = false;
                    console.warn('[Proxy Navegación] Red desconectada. Modo degradado activo.');
                });
                this.socket.on('menu:updated', ({ dishes }) => {
                    if (Array.isArray(dishes)) this.syncCatalog(dishes);
                });
            }
        } catch (_) {
            this.isOnline = false;
        }
    }

    syncCatalog(dishes) {
        if (!Array.isArray(dishes)) return;
        this.memoryCatalog = [...dishes];
        CACHE_KEYS.forEach((key) => writeStorage(key, this.memoryCatalog));
        if (this.onCatalogSync) {
            this.onCatalogSync(this.memoryCatalog);
        }
    }

    // Obtención transparente del catálogo: Memoria -> LocalStorage -> Catálogo por defecto
    fetchCatalog() {
        if (Array.isArray(this.memoryCatalog) && this.memoryCatalog.length) {
            return [...this.memoryCatalog];
        }

        for (const key of CACHE_KEYS) {
            const cached = readStorage(key);
            if (Array.isArray(cached) && cached.length) {
                this.memoryCatalog = [...cached];
                return [...this.memoryCatalog];
            }
        }

        this.memoryCatalog = DEFAULT_FALLBACK_CATALOG.map((d) => ({ ...d }));
        return [...this.memoryCatalog];
    }

    // Despacho de comanda con tolerancia a fallos (Socket.io -> Modo degradado LocalStorage)
    dispatchOrder(orderData) {
        if (this.smartProxy) {
            return this.smartProxy.submitOrder(orderData);
        }

        if (this.isOnline && this.socket) {
            this.socket.emit('order:create', orderData);
            return Promise.resolve({ dispatched: true, mode: 'socket.io' });
        }

        // Modo degradado (HTML5 LocalStorage fallback)
        const orders = readStorage(DEGRADED_ORDERS_KEY) || [];
        orders.push(orderData);
        writeStorage(DEGRADED_ORDERS_KEY, orders);
        return Promise.resolve({ dispatched: false, mode: 'localStorage', queuedCount: orders.length });
    }
}
