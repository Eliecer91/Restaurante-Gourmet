/**
 * Módulo: js/navigationStrategies.js
 * Implementación del Patrón Strategy para la Navegación en Catálogo.
 *
 * Compatible tanto con el esquema estándar del proyecto (name, category, description, price)
 * como con el esquema en español (nombre, categoria, descripcion, precio).
 */

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function getDishName(dish) {
    return dish?.name ?? dish?.nombre ?? '';
}

function getDishCategory(dish) {
    return dish?.category ?? dish?.categoria ?? '';
}

function getDishDescription(dish) {
    return dish?.description ?? dish?.descripcion ?? '';
}

function getDishPrice(dish) {
    return Number(dish?.price ?? dish?.precio ?? 0);
}

/**
 * Coincidencia difusa ligera (distancia de edición <= 1 para términos de >= 4 caracteres)
 * que tolera pequeños errores tipográficos del comensal en móvil.
 */
function fuzzyTokenMatch(haystackWords, token) {
    if (!token) return true;
    for (const word of haystackWords) {
        if (word.includes(token)) return true;
        if (token.length >= 4 && Math.abs(word.length - token.length) <= 1) {
            let mismatches = 0;
            let i = 0;
            let j = 0;
            while (i < word.length && j < token.length) {
                if (word[i] === token[j]) {
                    i += 1;
                    j += 1;
                } else {
                    mismatches += 1;
                    if (mismatches > 1) break;
                    if (word.length > token.length) i += 1;
                    else if (token.length > word.length) j += 1;
                    else {
                        i += 1;
                        j += 1;
                    }
                }
            }
            if (mismatches + (word.length - i) + (token.length - j) <= 1) {
                return true;
            }
        }
    }
    return false;
}

export const NavigationStrategies = {
    // 1. Estrategia por Categoría
    byCategory: {
        filter: (dishes, category) => {
            const normCategory = normalizeText(category);
            if (!normCategory || normCategory === 'todos' || normCategory === 'all') {
                return dishes;
            }
            return dishes.filter((d) => normalizeText(getDishCategory(d)) === normCategory);
        }
    },

    // 2. Estrategia por Búsqueda Predictiva con Coincidencia Difusa Ligera
    byPredictiveSearch: {
        filter: (dishes, rawQuery) => {
            const query = normalizeText(rawQuery);
            if (!query) return dishes;

            const tokens = query.split(/\s+/).filter(Boolean);
            return dishes.filter((d) => {
                const nameNorm = normalizeText(getDishName(d));
                const descNorm = normalizeText(getDishDescription(d));
                const catNorm = normalizeText(getDishCategory(d));
                const combined = `${nameNorm} ${descNorm} ${catNorm}`;

                if (combined.includes(query)) return true;

                const words = combined.split(/[^a-z0-9]+/).filter(Boolean);
                return tokens.every((token) => fuzzyTokenMatch(words, token));
            });
        }
    },

    // 3. Estrategia por Rango de Precios
    byPriceRange: {
        filter: (dishes, maxPrice) => {
            const limit = Number(maxPrice);
            if (!limit || Number.isNaN(limit) || limit <= 0) return dishes;
            return dishes.filter((d) => getDishPrice(d) <= limit);
        }
    }
};
