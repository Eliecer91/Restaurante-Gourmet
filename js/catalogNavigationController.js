/**
 * Módulo: js/catalogNavigationController.js
 * Contexto de Navegación (Strategy Context) con Control de Debounce.
 *
 * Orquesta las estrategias concretas de filtrado en cadena sin mutar nunca
 * el repositorio original de platillos.
 */
import { NavigationStrategies } from './navigationStrategies.js';

export class CatalogNavigationController {
    constructor(dishesRepository = []) {
        this.dishes = Array.isArray(dishesRepository) ? [...dishesRepository] : [];
        this.activeCategory = 'Todos';
        this.searchQuery = '';
        this.maxPrice = null;
        this.debounceTimer = null;
    }

    updateRepository(newDishes) {
        this.dishes = Array.isArray(newDishes) ? [...newDishes] : [];
        return this.resolveNavigation();
    }

    setCategory(category) {
        this.activeCategory = category || 'Todos';
        return this.resolveNavigation();
    }

    setSearchQueryDebounced(query, callback, delayMs = 150) {
        this.searchQuery = query || '';
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            const results = this.resolveNavigation();
            if (typeof callback === 'function') callback(results);
        }, delayMs);
    }

    setMaxPrice(price) {
        const numeric = Number(price);
        this.maxPrice = (!numeric || Number.isNaN(numeric) || numeric <= 0) ? null : numeric;
        return this.resolveNavigation();
    }

    resetFilters() {
        clearTimeout(this.debounceTimer);
        this.activeCategory = 'Todos';
        this.searchQuery = '';
        this.maxPrice = null;
        return this.resolveNavigation();
    }

    getActiveFilters() {
        return {
            category: this.activeCategory,
            searchQuery: this.searchQuery,
            maxPrice: this.maxPrice
        };
    }

    // Resolución algorítmica en cadena sin mutar el catálogo original
    resolveNavigation() {
        let results = [...this.dishes];
        results = NavigationStrategies.byCategory.filter(results, this.activeCategory);
        results = NavigationStrategies.byPredictiveSearch.filter(results, this.searchQuery);
        if (this.maxPrice) {
            results = NavigationStrategies.byPriceRange.filter(results, this.maxPrice);
        }
        return results;
    }
}
