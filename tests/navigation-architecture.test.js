'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

function createMemoryStorage() {
    const store = new Map();
    return {
        getItem(k) { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
        clear() { store.clear(); }
    };
}

test('Arquitectura de Navegación ES6+ (Strategy + Debounce Controller + Distributed Proxy)', async (t) => {
    const strategiesUrl = pathToFileURL(path.join(__dirname, '..', 'js', 'navigationStrategies.js')).href;
    const controllerUrl = pathToFileURL(path.join(__dirname, '..', 'js', 'catalogNavigationController.js')).href;
    const proxyUrl = pathToFileURL(path.join(__dirname, '..', 'js', 'navigationProxy.js')).href;

    const { NavigationStrategies } = await import(strategiesUrl);
    const { CatalogNavigationController } = await import(controllerUrl);
    const { DistributedNavigationProxy } = await import(proxyUrl);

    const sampleDishes = [
        { id: 1, name: 'Empanadas de Yuca', category: 'Entradas', price: 12500, description: 'Crujientes y rellenas de carne' },
        { id: 2, name: 'Ajiaco Santafereño', category: 'Platos Fuertes', price: 32000, description: 'Sopa tradicional con pollo y guascas' },
        { id: 3, name: 'Limonada de Coco', category: 'Bebidas', price: 12500, description: 'Bebida insignia refrescante' },
        { id: 4, nombre: 'Lomo al Trapo', categoria: 'Platos Fuertes', precio: 45000, descripcion: 'Corte fino sellado en lienzo' }
    ];

    await t.test('NavigationStrategies filtra por categoría, búsqueda predictiva (con acentos/fuzzy) y precio máximo', () => {
        // 1. Categoría (compatible con esquema EN y ES)
        assert.equal(NavigationStrategies.byCategory.filter(sampleDishes, 'Todos').length, 4);
        assert.equal(NavigationStrategies.byCategory.filter(sampleDishes, 'Platos Fuertes').length, 2);
        assert.equal(NavigationStrategies.byCategory.filter(sampleDishes, 'bebidas').length, 1);

        // 2. Búsqueda predictiva: acentos, descripción y tolerancia tipográfica (fuzzy 1 char)
        const byAccent = NavigationStrategies.byPredictiveSearch.filter(sampleDishes, 'santafereno');
        assert.equal(byAccent.length, 1);
        assert.equal(byAccent[0].id, 2);

        const byDesc = NavigationStrategies.byPredictiveSearch.filter(sampleDishes, 'guascas');
        assert.equal(byDesc.length, 1);
        assert.equal(byDesc[0].id, 2);

        const byFuzzy = NavigationStrategies.byPredictiveSearch.filter(sampleDishes, 'limonad');
        assert.equal(byFuzzy.length, 1);
        assert.equal(byFuzzy[0].id, 3);

        const byTypo = NavigationStrategies.byPredictiveSearch.filter(sampleDishes, 'empanadaz');
        assert.equal(byTypo.length, 1);
        assert.equal(byTypo[0].id, 1);

        // 3. Rango de precios
        const under20k = NavigationStrategies.byPriceRange.filter(sampleDishes, 20000);
        assert.equal(under20k.length, 2);
    });

    await t.test('CatalogNavigationController encadena estrategias sin mutar el catálogo original y aplica debounce', async () => {
        const snapshotBefore = JSON.stringify(sampleDishes);
        const controller = new CatalogNavigationController(sampleDishes);

        controller.setCategory('Platos Fuertes');
        const under35k = controller.setMaxPrice(35000);
        assert.equal(under35k.length, 1);
        assert.equal(under35k[0].id, 2);

        // El catálogo original jamás fue mutado
        assert.equal(JSON.stringify(sampleDishes), snapshotBefore);

        // Debounce: múltiples invocaciones rápidas solo disparan el último callback
        let calls = 0;
        const debouncedResults = await new Promise((resolve) => {
            controller.setCategory('Todos');
            controller.setMaxPrice(null);
            controller.setSearchQueryDebounced('e', () => { calls += 1; }, 40);
            controller.setSearchQueryDebounced('em', () => { calls += 1; }, 40);
            controller.setSearchQueryDebounced('yuca', (res) => {
                calls += 1;
                resolve(res);
            }, 40);
        });

        assert.equal(calls, 1);
        assert.equal(debouncedResults.length, 1);
        assert.equal(debouncedResults[0].id, 1);

        // Reset devuelve todos los platillos
        assert.equal(controller.resetFilters().length, 4);
    });

    await t.test('DistributedNavigationProxy resuelve caché Memoria -> LocalStorage -> Default y despacha en modo degradado', async () => {
        const mockStorage = createMemoryStorage();
        globalThis.localStorage = mockStorage;

        try {
            // 1. Sin caché previa devuelve catálogo por defecto
            const proxy = new DistributedNavigationProxy('http://localhost:3000');
            const initial = proxy.fetchCatalog();
            assert.ok(initial.length >= 4);

            // 2. syncCatalog actualiza Memoria y LocalStorage
            proxy.syncCatalog(sampleDishes);
            assert.equal(proxy.fetchCatalog().length, 4);
            assert.equal(JSON.parse(mockStorage.getItem('rest_dishes')).length, 4);

            // 3. Una nueva instancia lee desde LocalStorage
            const proxy2 = new DistributedNavigationProxy('http://localhost:3000');
            assert.equal(proxy2.fetchCatalog().length, 4);

            // 4. Despacho en modo degradado (sin Socket.io conectado) guarda en localStorage('rest_orders')
            const res = await proxy2.dispatchOrder({ id: 999, table: 'Mesa 3', total: 32000 });
            assert.equal(res.mode, 'localStorage');
            const storedOrders = JSON.parse(mockStorage.getItem('rest_orders'));
            assert.equal(storedOrders.length, 1);
            assert.equal(storedOrders[0].table, 'Mesa 3');
        } finally {
            delete globalThis.localStorage;
        }
    });
});
