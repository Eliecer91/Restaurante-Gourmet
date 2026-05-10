// Data: Dishes
const dishes = [
    {
        id: 1,
        name: "Bruschetta Pomodoro",
        description: "Pan tostado con tomate fresco, albahaca, ajo y aceite de oliva extra virgen.",
        price: 8.50,
        category: "Entradas",
        image: "https://images.unsplash.com/photo-1572656631137-7935297eff55?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 2,
        name: "Calamares Fritos",
        description: "Anillos de calamar crujientes servidos con salsa tártara de la casa.",
        price: 12.00,
        category: "Entradas",
        image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 3,
        name: "Empanadas de Carne",
        description: "Tres empanadas tradicionales rellenas de carne de res picada y especias.",
        price: 6.00,
        category: "Entradas",
        image: "https://images.unsplash.com/photo-1614088685112-0a760b71a3c8?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 4,
        name: "Hamburguesa Premium",
        description: "Carne Angus, queso cheddar, tocino, cebolla caramelizada y papas fritas.",
        price: 15.50,
        category: "Platos Fuertes",
        image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 5,
        name: "Pasta Carbonara",
        description: "Espagueti con salsa cremosa de huevo, pecorino romano, guanciale y pimienta negra.",
        price: 14.00,
        category: "Platos Fuertes",
        image: "https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 6,
        name: "Salmón al Grill",
        description: "Filete de salmón fresco con espárragos, puré de papa y salsa de limón.",
        price: 22.00,
        category: "Platos Fuertes",
        image: "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 7,
        name: "Tacos de Al Pastor",
        description: "Cuatro tacos de cerdo marinado con piña, cebolla, cilantro y salsa picante.",
        price: 13.50,
        category: "Platos Fuertes",
        image: "https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 8,
        name: "Risotto de Setas",
        description: "Arroz arborio cremoso con una mezcla de hongos silvestres y aceite de trufa.",
        price: 18.00,
        category: "Platos Fuertes",
        image: "https://images.unsplash.com/photo-1476124369491-e7addf5db371?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 9,
        name: "Limonada de Coco",
        description: "Refrescante mezcla de limón, leche de coco y hielo granizado.",
        price: 4.50,
        category: "Bebidas",
        image: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 10,
        name: "Vino Tinto Malbec",
        description: "Copa de vino tinto argentino con notas de frutos rojos y madera.",
        price: 7.00,
        category: "Bebidas",
        image: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 11,
        name: "Cheesecake de Fresa",
        description: "Tarta de queso cremosa sobre base de galleta con coulis de fresas frescas.",
        price: 6.50,
        category: "Postres",
        image: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&q=80&w=800"
    },
    {
        id: 12,
        name: "Brownie con Helado",
        description: "Brownie de chocolate caliente con una bola de helado de vainilla y fudge.",
        price: 7.50,
        category: "Postres",
        image: "https://images.unsplash.com/photo-1624353339193-2f039f82a1f7?auto=format&fit=crop&q=80&w=800"
    }
];

// State
let cart = JSON.parse(localStorage.getItem('restaurant_cart')) || [];
let activeCategory = 'all';
let searchQuery = '';

// DOM Elements
const menuGrid = document.getElementById('menu-grid');
const categoryList = document.getElementById('category-list');
const categoryTitle = document.getElementById('category-title');
const searchInput = document.getElementById('dish-search');
const cartBtn = document.getElementById('cart-btn');
const closeCartBtn = document.getElementById('close-cart');
const cartSidebar = document.getElementById('cart-sidebar');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsContainer = document.getElementById('cart-items');
const cartCount = document.getElementById('cart-count');
const cartTotalPrice = document.getElementById('cart-total-price');
const checkoutBtn = document.getElementById('checkout-btn');
const modalOverlay = document.getElementById('modal-overlay');
const closeModalBtn = document.getElementById('close-modal');
const orderForm = document.getElementById('order-form');
const orderTypeSelect = document.getElementById('order-type');
const tableGroup = document.getElementById('table-group');
const addressGroup = document.getElementById('address-group');
const toast = document.getElementById('toast');

// Initialize
function init() {
    renderMenu();
    updateCartUI();
    setupEventListeners();
}

// Setup Event Listeners
function setupEventListeners() {
    // Category Filtering
    categoryList.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI') {
            const category = e.target.dataset.category;
            activeCategory = category;
            
            // Update UI
            document.querySelectorAll('#category-list li').forEach(li => li.classList.remove('active'));
            e.target.classList.add('active');
            categoryTitle.textContent = category === 'all' ? 'Todos los Platillos' : category;
            
            renderMenu();
        }
    });

    // Search
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderMenu();
    });

    // Cart Sidebar Toggle
    cartBtn.addEventListener('click', toggleCart);
    closeCartBtn.addEventListener('click', toggleCart);
    cartOverlay.addEventListener('click', toggleCart);

    // Checkout Modal
    checkoutBtn.addEventListener('click', () => {
        if (cart.length === 0) {
            showToast("Tu carrito está vacío", "error");
            return;
        }
        toggleModal();
        renderModalSummary();
    });

    closeModalBtn.addEventListener('click', toggleModal);

    // Order Type Toggle
    orderTypeSelect.addEventListener('change', (e) => {
        if (e.target.value === 'mesa') {
            tableGroup.classList.remove('hidden');
            addressGroup.classList.add('hidden');
        } else {
            tableGroup.classList.add('hidden');
            addressGroup.classList.remove('hidden');
        }
    });

    // Submit Order
    orderForm.addEventListener('submit', (e) => {
        e.preventDefault();
        confirmOrder();
    });
}

// Render Menu
function renderMenu() {
    let filteredDishes = dishes;
    
    if (activeCategory !== 'all') {
        filteredDishes = filteredDishes.filter(dish => dish.category === activeCategory);
    }
    
    if (searchQuery) {
        filteredDishes = filteredDishes.filter(dish => 
            dish.name.toLowerCase().includes(searchQuery) || 
            dish.description.toLowerCase().includes(searchQuery)
        );
    }
    
    menuGrid.innerHTML = '';
    
    if (filteredDishes.length === 0) {
        menuGrid.innerHTML = '<p class="no-results">No se encontraron platillos.</p>';
        return;
    }
    
    filteredDishes.forEach(dish => {
        const card = document.createElement('div');
        card.className = 'dish-card';
        card.innerHTML = `
            <div class="dish-img-container">
                <img src="${dish.image}" alt="${dish.name}">
                <span class="dish-category">${dish.category}</span>
            </div>
            <div class="dish-info">
                <h3>${dish.name}</h3>
                <p>${dish.description}</p>
                <div class="dish-footer">
                    <span class="dish-price">$${dish.price.toFixed(2)}</span>
                    <button class="btn-add" onclick="addToCart(${dish.id})">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </div>
        `;
        menuGrid.appendChild(card);
    });
}

// Cart Logic
window.addToCart = function(id) {
    const dish = dishes.find(d => d.id === id);
    const existingItem = cart.find(item => item.id === id);
    
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ ...dish, quantity: 1 });
    }
    
    saveCart();
    updateCartUI();
    showToast(`${dish.name} añadido al pedido`);
};

function updateCartUI() {
    cartItemsContainer.innerHTML = '';
    let total = 0;
    let count = 0;
    
    cart.forEach(item => {
        total += item.price * item.quantity;
        count += item.quantity;
        
        const itemEl = document.createElement('div');
        itemEl.className = 'cart-item';
        itemEl.innerHTML = `
            <img src="${item.image}" alt="${item.name}" class="cart-item-img">
            <div class="cart-item-details">
                <h4>${item.name}</h4>
                <div class="cart-item-price">$${(item.price * item.quantity).toFixed(2)}</div>
                <div class="cart-item-controls">
                    <button class="qty-btn" onclick="updateQuantity(${item.id}, -1)">-</button>
                    <span>${item.quantity}</span>
                    <button class="qty-btn" onclick="updateQuantity(${item.id}, 1)">+</button>
                    <i class="fas fa-trash remove-item" onclick="removeFromCart(${item.id})"></i>
                </div>
            </div>
        `;
        cartItemsContainer.appendChild(itemEl);
    });
    
    cartCount.textContent = count;
    cartTotalPrice.textContent = `$${total.toFixed(2)}`;
    
    // Animate cart count if changed
    if (count > 0) {
        cartCount.style.animation = 'none';
        cartCount.offsetHeight; // trigger reflow
        cartCount.style.animation = 'bounce 0.4s ease';
    }
}

window.updateQuantity = function(id, delta) {
    const item = cart.find(i => i.id === id);
    if (item) {
        item.quantity += delta;
        if (item.quantity <= 0) {
            removeFromCart(id);
        } else {
            saveCart();
            updateCartUI();
        }
    }
};

window.removeFromCart = function(id) {
    cart = cart.filter(item => item.id !== id);
    saveCart();
    updateCartUI();
};

function saveCart() {
    localStorage.setItem('restaurant_cart', JSON.stringify(cart));
}

function toggleCart() {
    cartSidebar.classList.toggle('active');
    cartOverlay.classList.toggle('active');
}

function toggleModal() {
    modalOverlay.classList.toggle('active');
}

// Order Management
function renderModalSummary() {
    const summaryContainer = document.getElementById('modal-summary-items');
    const modalTotal = document.getElementById('modal-total-price');
    let total = 0;
    
    summaryContainer.innerHTML = '';
    cart.forEach(item => {
        total += item.price * item.quantity;
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.marginBottom = '5px';
        div.style.fontSize = '0.9rem';
        div.innerHTML = `
            <span>${item.quantity}x ${item.name}</span>
            <span>$${(item.price * item.quantity).toFixed(2)}</span>
        `;
        summaryContainer.appendChild(div);
    });
    
    modalTotal.textContent = `$${total.toFixed(2)}`;
}

function confirmOrder() {
    const customerName = document.getElementById('customer-name').value;
    const orderType = document.getElementById('order-type').value;
    const tableNumber = document.getElementById('table-number').value;
    const address = document.getElementById('address').value;
    
    const orderData = {
        customerName,
        orderType,
        tableNumber: orderType === 'mesa' ? tableNumber : null,
        address: orderType === 'domicilio' ? address : null,
        items: cart,
        total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        date: new Date().toISOString()
    };
    
    console.log("Pedido confirmado:", orderData);
    
    // Save to order history (optional but good)
    let history = JSON.parse(localStorage.getItem('restaurant_history')) || [];
    history.push(orderData);
    localStorage.setItem('restaurant_history', JSON.stringify(history));
    
    // Clear cart
    cart = [];
    saveCart();
    updateCartUI();
    
    // UI Effects
    toggleModal();
    showToast("¡Pedido confirmado con éxito! Gracias por su preferencia.", "success");
    orderForm.reset();
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add('active');
    setTimeout(() => {
        toast.classList.remove('active');
    }, 3000);
}

// Animations for CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes bounce {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.3); }
    }
    .no-results {
        grid-column: 1 / -1;
        text-align: center;
        padding: 40px;
        color: var(--text-muted);
        font-size: 1.1rem;
    }
`;
document.head.appendChild(style);

init();
