// Propbandhu Main JavaScript File

console.log('📱 Propbandhu Platform JS Loaded');

// DOM Ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ DOM Ready - Propbandhu Platform');
    
    // Initialize all components
    initMobileMenu();
    initNavbarDropdowns();
    initAuthButtonAnimations();
    initForms();
    initNotifications();
    initNeedsTabs();
    
    // Load properties if on home page
    if (document.querySelector('.properties-slider') || document.getElementById('property-list')) {
        loadPropertiesIfNeeded();
    }
    
    // Add button pulse animation
    addPulseAnimation();
});

// ========== MOBILE MENU FUNCTIONALITY ==========
function initMobileMenu() {
    const menuToggle = document.querySelector('.mobile-menu-toggle');
    const navLinks = document.querySelector('.nav-links');
    const hasSubmenuItems = document.querySelectorAll('.has-submenu > a');
    
    if (!menuToggle || !navLinks) {
        console.log('Mobile menu elements not found');
        return;
    }
    
    // Create overlay
    const navOverlay = document.createElement('div');
    navOverlay.className = 'nav-overlay';
    document.body.appendChild(navOverlay);
    
    // Toggle menu
    menuToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        this.classList.toggle('active');
        navLinks.classList.toggle('active');
        navOverlay.classList.toggle('active');
        document.body.style.overflow = navLinks.classList.contains('active') ? 'hidden' : '';
    });
    
    // Close menu on overlay click
    navOverlay.addEventListener('click', function() {
        menuToggle.classList.remove('active');
        navLinks.classList.remove('active');
        navOverlay.classList.remove('active');
        document.body.style.overflow = '';
        
        // Close all submenus
        hasSubmenuItems.forEach(item => {
            item.parentElement.classList.remove('active');
        });
    });
    
    // Handle submenu clicks on mobile
    hasSubmenuItems.forEach(item => {
        item.addEventListener('click', function(e) {
            if (window.innerWidth <= 768) {
                e.preventDefault();
                e.stopPropagation();
                
                const parent = this.parentElement;
                const isActive = parent.classList.contains('active');
                
                // Close all other submenus
                hasSubmenuItems.forEach(otherItem => {
                    if (otherItem !== this) {
                        otherItem.parentElement.classList.remove('active');
                    }
                });
                
                // Toggle current submenu
                parent.classList.toggle('active');
            }
        });
    });
    
    // Close menu when clicking on a regular link (excluding submenu triggers)
    const regularLinks = navLinks.querySelectorAll('a:not(.has-submenu > a)');
    regularLinks.forEach(link => {
        link.addEventListener('click', function() {
            if (window.innerWidth <= 768) {
                menuToggle.classList.remove('active');
                navLinks.classList.remove('active');
                navOverlay.classList.remove('active');
                document.body.style.overflow = '';
                
                // Close all submenus
                hasSubmenuItems.forEach(item => {
                    item.parentElement.classList.remove('active');
                });
            }
        });
    });
    
    // Close menu on ESC key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && navLinks.classList.contains('active')) {
            menuToggle.classList.remove('active');
            navLinks.classList.remove('active');
            navOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    });
    
    // Handle window resize
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            if (window.innerWidth > 768) {
                // Reset mobile menu on desktop
                menuToggle.classList.remove('active');
                navLinks.classList.remove('active');
                navOverlay.classList.remove('active');
                document.body.style.overflow = '';
                
                // Close all submenus
                hasSubmenuItems.forEach(item => {
                    item.parentElement.classList.remove('active');
                });
            }
        }, 250);
    });
}

// ========== NAVBAR DROPDOWNS (DESKTOP) ==========
function initNavbarDropdowns() {
    const hasSubmenuItems = document.querySelectorAll('.has-submenu');
    
    hasSubmenuItems.forEach(item => {
        // Desktop hover behavior
        item.addEventListener('mouseenter', function() {
            if (window.innerWidth > 768) {
                const submenu = this.querySelector('.submenu');
                if (submenu) {
                    submenu.style.display = 'block';
                    this.classList.add('hover');
                }
            }
        });
        
        item.addEventListener('mouseleave', function() {
            if (window.innerWidth > 768) {
                const submenu = this.querySelector('.submenu');
                if (submenu) {
                    submenu.style.display = 'none';
                    this.classList.remove('hover');
                }
            }
        });
    });
}

// ========== AUTH BUTTON ANIMATIONS ==========
function initAuthButtonAnimations() {
    const authButtons = document.querySelectorAll('.auth-btn');
    
    authButtons.forEach(button => {
        // Desktop hover effects
        button.addEventListener('mouseenter', function() {
            if (window.innerWidth > 768) {
                this.style.transform = 'translateY(-2px)';
                
                // Add pulse animation to signup button
                if (this.classList.contains('signup-btn')) {
                    this.style.animation = 'buttonPulse 1.5s infinite';
                }
            }
        });
        
        button.addEventListener('mouseleave', function() {
            if (window.innerWidth > 768) {
                this.style.transform = 'translateY(0)';
                this.style.animation = '';
            }
        });
        
        // Touch feedback
        button.addEventListener('touchstart', function() {
            this.style.transform = 'scale(0.95)';
            this.style.transition = 'transform 0.1s';
        });
        
        button.addEventListener('touchend', function() {
            setTimeout(() => {
                this.style.transform = '';
                this.style.transition = '';
            }, 150);
        });
        
        // Focus states for accessibility
        button.addEventListener('focus', function() {
            this.style.outline = '3px solid rgba(34, 182, 214, 0.5)';
            this.style.outlineOffset = '2px';
        });
        
        button.addEventListener('blur', function() {
            this.style.outline = '';
        });
    });
}

// Add pulse animation CSS
function addPulseAnimation() {
    if (!document.querySelector('#button-pulse-animation')) {
        const style = document.createElement('style');
        style.id = 'button-pulse-animation';
        style.textContent = `
            @keyframes buttonPulse {
                0% { box-shadow: 0 4px 15px rgba(34, 182, 214, 0.3); }
                50% { box-shadow: 0 4px 20px rgba(34, 182, 214, 0.5); }
                100% { box-shadow: 0 4px 15px rgba(34, 182, 214, 0.3); }
            }
        `;
        document.head.appendChild(style);
    }
}

// Tab switching for needs section
function initNeedsTabs() {
    const tabButtons = document.querySelectorAll('.needs-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    console.log('Initializing tabs - Found:', tabButtons.length, 'buttons,', tabContents.length, 'contents');
    
    if (tabButtons.length === 0) {
        console.log('No tab buttons found');
        return;
    }
    
    // First, hide all non-active tabs using inline styles
    tabContents.forEach(content => {
        if (!content.classList.contains('active')) {
            content.style.display = 'none';
        } else {
            content.style.display = 'flex';
        }
    });
    
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Tab clicked:', button.dataset.tab);
            
            // Remove active class from all tabs and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => {
                content.classList.remove('active');
                content.style.display = 'none'; // Hide all
            });
            
            // Add active class to clicked tab
            button.classList.add('active');
            
            // Show corresponding content
            const tabId = button.getAttribute('data-tab');
            const tabContent = document.getElementById(tabId);
            if (tabContent) {
                tabContent.classList.add('active');
                tabContent.style.display = 'flex'; // Show with inline style
                console.log('Showing tab:', tabId);
            }
        });
    });
    
    console.log('Needs tabs initialized');
}

// ========== FORM VALIDATION ==========
function initForms() {
    const forms = document.querySelectorAll('form[data-validate]');
    
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const requiredFields = this.querySelectorAll('[required]');
            let isValid = true;
            
            requiredFields.forEach(field => {
                if (!field.value.trim()) {
                    isValid = false;
                    field.classList.add('error');
                    
                    // Create error message if not exists
                    let errorMsg = field.nextElementSibling;
                    if (!errorMsg || !errorMsg.classList.contains('error-message')) {
                        errorMsg = document.createElement('div');
                        errorMsg.className = 'error-message';
                        errorMsg.textContent = 'This field is required';
                        errorMsg.style.cssText = 'color: #f44336; font-size: 0.8rem; margin-top: 5px;';
                        field.parentNode.insertBefore(errorMsg, field.nextSibling);
                    }
                } else {
                    field.classList.remove('error');
                    const errorMsg = field.nextElementSibling;
                    if (errorMsg && errorMsg.classList.contains('error-message')) {
                        errorMsg.remove();
                    }
                }
            });
            
            if (!isValid) {
                e.preventDefault();
                showNotification('Please fill all required fields', 'error');
            }
        });
    });
}

// ========== NOTIFICATION SYSTEM ==========
function initNotifications() {
    // Check for URL parameters for notifications
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get('message');
    const type = urlParams.get('type');
    
    if (message) {
        showNotification(message, type || 'info');
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existing = document.querySelector('.notification');
    if (existing) {
        existing.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span>${message}</span>
            <button class="notification-close">&times;</button>
        </div>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : type === 'warning' ? '#ff9800' : '#2196F3'};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 9999;
        animation: slideIn 0.3s ease;
        max-width: 350px;
        font-size: 14px;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
    `;
    
    // Close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    });
    
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: white;
        font-size: 1.2rem;
        cursor: pointer;
        margin-left: 10px;
        float: right;
        padding: 0 5px;
        opacity: 0.8;
        transition: opacity 0.2s;
    `;
    
    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.opacity = '1';
    });
    
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.opacity = '0.8';
    });
    
    // Auto remove after 5 seconds
    const autoRemove = setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
    
    // Pause auto-remove on hover
    notification.addEventListener('mouseenter', () => clearTimeout(autoRemove));
    notification.addEventListener('mouseleave', () => {
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);
    });
    
    document.body.appendChild(notification);
    
    // Add animation keyframes if not present
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
}

// ========== COUNTDOWN TIMER ==========
class CountdownTimer {
    constructor(elementId, endTime) {
        this.element = document.getElementById(elementId);
        this.endTime = new Date(endTime).getTime();
        this.interval = null;
    }
    
    start() {
        if (!this.element) return;
        
        this.update();
        this.interval = setInterval(() => this.update(), 1000);
    }
    
    update() {
        const now = new Date().getTime();
        const distance = this.endTime - now;
        
        if (distance < 0) {
            clearInterval(this.interval);
            this.element.innerHTML = '<span class="expired">EXPIRED</span>';
            return;
        }
        
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        this.element.innerHTML = `
            <span class="timer-digit">${days}d</span>
            <span class="timer-digit">${hours}h</span>
            <span class="timer-digit">${minutes}m</span>
            <span class="timer-digit">${seconds}s</span>
        `;
    }
    
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}

// ========== PROPERTY CART FUNCTIONALITY ==========
const CartManager = {
    items: [],
    
    addItem(propertyId) {
        if (!this.items.includes(propertyId)) {
            this.items.push(propertyId);
            this.save();
            this.updateBadge();
            showNotification('Property added to cart', 'success');
        } else {
            showNotification('Property already in cart', 'info');
        }
    },
    
    removeItem(propertyId) {
        const initialLength = this.items.length;
        this.items = this.items.filter(id => id !== propertyId);
        if (this.items.length < initialLength) {
            this.save();
            this.updateBadge();
            showNotification('Property removed from cart', 'info');
        }
    },
    
    save() {
        localStorage.setItem('propbandhu_cart', JSON.stringify(this.items));
    },
    
    load() {
        const saved = localStorage.getItem('propbandhu_cart');
        this.items = saved ? JSON.parse(saved) : [];
        this.updateBadge();
    },
    
    updateBadge() {
        const badge = document.querySelector('.cart-badge');
        if (badge) {
            badge.textContent = this.items.length;
            badge.style.display = this.items.length > 0 ? 'flex' : 'none';
            
            // Add animation for new items
            if (this.items.length > 0) {
                badge.style.animation = 'bounce 0.5s ease';
                setTimeout(() => {
                    badge.style.animation = '';
                }, 500);
            }
        }
    },
    
    clear() {
        this.items = [];
        this.save();
        this.updateBadge();
        showNotification('Cart cleared', 'info');
    },
    
    getCount() {
        return this.items.length;
    }
};

// Initialize cart on page load
CartManager.load();

// ========== PROPERTY LOADING AND DISPLAY ==========
async function loadProperties() {
    try {
        console.log('Loading properties from JSON...');
        const response = await fetch('/properties.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const properties = await response.json();
        console.log('Properties loaded:', properties.length);
        return properties;
    } catch (error) {
        console.error('Error loading properties.json:', error);
        console.log('Using sample properties instead');
        return getSampleProperties();
    }
}

function getSampleProperties() {
    return [
        {
            id: 1,
            title: "Luxury Villa in Noida",
            image: "/images/property1.jpg",
            location: "Noida, Sector 150",
            price: "₹2.5 Cr",
            featured: true,
            popular: true,
            rating: 4.8,
            short_description: "Premium 4 BHK villa with modern amenities",
            tags: ["Villa", "Luxury", "4 BHK"]
        },
        {
            id: 2,
            title: "3 BHK Apartment",
            image: "/images/property2.jpg",
            location: "Greater Noida West",
            price: "₹1.2 Cr",
            featured: true,
            popular: true,
            rating: 4.5,
            short_description: "Modern 3 BHK apartment with great view",
            tags: ["Apartment", "3 BHK", "Modern"]
        },
        {
            id: 3,
            title: "Commercial Space",
            image: "/images/property3.jpg",
            location: "Delhi",
            price: "₹3 Cr",
            featured: false,
            popular: true,
            rating: 4.7,
            short_description: "Prime commercial space in business district",
            tags: ["Commercial", "Office", "Retail"]
        },
        {
            id: 4,
            title: "2 BHK Luxury Flat",
            image: "/images/property4.jpg",
            location: "Ghaziabad",
            price: "₹85 Lakh",
            featured: true,
            popular: true,
            rating: 4.3,
            short_description: "Luxury 2 BHK with swimming pool",
            tags: ["Flat", "2 BHK", "Luxury"]
        }
    ];
}

async function displayFeaturedProperties() {
    const container = document.querySelector('.properties-slider');
    if (!container) {
        console.log('Properties slider container not found');
        return;
    }
    
    const properties = await loadProperties();
    const featured = properties.filter(p => p.featured).slice(0, 5);
    
    console.log('Featured properties to display:', featured.length);
    
    if (featured.length === 0) {
        container.innerHTML = `
            <div class="no-properties" style="text-align: center; padding: 40px; color: #ccc; width: 100%;">
                <p>No featured properties available at the moment.</p>
                <p>Check back soon!</p>
            </div>
        `;
        return;
    }
    
    // Create HTML for featured properties slider
    container.innerHTML = featured.map(property => `
        <div class="property-card">
            <div class="property-img-container">
                <img src="${property.image}" alt="${property.title}" class="property-img" 
                     onerror="this.onerror=null; this.src='/images/placeholder.jpg';">
                <button class="property-bookmark" aria-label="Bookmark" 
                        onclick="Propbandhu.CartManager.addItem(${property.id})"
                        title="Add to favorites">
                    <i class="${CartManager.items.includes(property.id) ? 'fas' : 'far'} fa-bookmark"></i>
                </button>
                <div class="property-overlay">
                    <div class="property-header">
                        <h3 class="property-title">${property.title}</h3>
                        <span class="property-price">${property.price}</span>
                    </div>
                    <p class="property-desc">${property.short_description}</p>
                    <div class="property-tags">
                        ${property.tags.map(tag => `<span class="property-tag">${tag}</span>`).join('')}
                        <span class="property-tag star">
                            <i class="fas fa-star"></i>
                            <span>${property.rating}</span>
                        </span>
                    </div>
                    <button class="property-book-btn" 
                            onclick="viewPropertyDetail(${property.id})"
                            aria-label="View details for ${property.title}">
                        View Details
                    </button>
                </div>
            </div>
        </div>
    `).join('');
    
    addSliderNavigation();
}

async function displayPopularProperties() {
    const container = document.getElementById('property-list');
    if (!container) {
        console.log('Property list container not found');
        return;
    }
    
    const properties = await loadProperties();
    const popular = properties.filter(p => p.popular).slice(0, 8);
    
    console.log('Popular properties to display:', popular.length);
    
    if (popular.length === 0) {
        container.innerHTML = `
            <div class="no-properties" style="text-align: center; padding: 40px; color: #ccc; grid-column: 1 / -1;">
                <p>No properties available at the moment.</p>
                <p>Please check back later.</p>
            </div>
        `;
        return;
    }
    
    // Create HTML for popular properties grid
    container.innerHTML = popular.map(property => `
        <div class="listing-card">
            <div class="listing-img-box">
                <img src="${property.image}" alt="${property.title}" class="listing-img"
                     onerror="this.onerror=null; this.src='/images/placeholder.jpg';">
                <div class="listing-info-overlay">
                    <div class="listing-header">
                        <h3 class="listing-title">${property.title}</h3>
                        <span class="listing-price">${property.price}</span>
                    </div>
                    <p class="listing-desc">${property.short_description}</p>
                    <div class="listing-meta-row">
                        <div class="meta-item">
                            <i class="fas fa-star star-icon"></i>
                            <span class="meta-label">${property.rating} Rating</span>
                        </div>
                        <div class="meta-item">
                            <i class="fas fa-map-marker-alt"></i>
                            <span class="meta-label">${property.location}</span>
                        </div>
                    </div>
                </div>
            </div>
            <button class="listing-action-btn" onclick="viewPropertyDetail(${property.id})"
                    aria-label="Book ${property.title}">
                View Details
            </button>
        </div>
    `).join('');
}

function addSliderNavigation() {
    const slider = document.querySelector('.properties-slider');
    if (!slider) return;
    
    // Remove existing navigation
    const existingNav = slider.parentElement.querySelector('.slider-nav');
    if (existingNav) existingNav.remove();
    
    // Create navigation container
    const navContainer = document.createElement('div');
    navContainer.className = 'slider-nav';
    navContainer.style.cssText = `
        display: flex;
        justify-content: center;
        gap: 10px;
        margin-top: 20px;
    `;
    
    // Create prev button
    const prevButton = document.createElement('button');
    prevButton.className = 'slider-nav-btn prev';
    prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevButton.setAttribute('aria-label', 'Previous properties');
    
    // Create next button
    const nextButton = document.createElement('button');
    nextButton.className = 'slider-nav-btn next';
    nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextButton.setAttribute('aria-label', 'Next properties');
    
    navContainer.appendChild(prevButton);
    navContainer.appendChild(nextButton);
    slider.parentElement.appendChild(navContainer);
    
    // Navigation functionality
    const scrollAmount = 320;
    
    prevButton.addEventListener('click', () => {
        slider.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });
    
    nextButton.addEventListener('click', () => {
        slider.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });
    
    // Update button states
    function updateNavButtons() {
        const scrollLeft = slider.scrollLeft;
        const maxScroll = slider.scrollWidth - slider.clientWidth;
        
        prevButton.disabled = scrollLeft <= 10;
        nextButton.disabled = scrollLeft >= maxScroll - 10;
    }
    
    slider.addEventListener('scroll', updateNavButtons);
    updateNavButtons();
}

// ========== UTILITY FUNCTIONS ==========
function viewPropertyDetail(propertyId) {
    // For now, show a notification
    showNotification('Property details page coming soon!', 'info');
    // In production: window.location.href = `/property/${propertyId}`;
}

async function loadPropertiesIfNeeded() {
    console.log('Loading properties for homepage...');
    try {
        await Promise.all([
            displayFeaturedProperties(),
            displayPopularProperties()
        ]);
    } catch (error) {
        console.error('Error loading properties:', error);
        showNotification('Error loading properties. Please refresh the page.', 'error');
    }
}

// ========== API HELPER ==========
const API = {
    async get(endpoint) {
        try {
            const response = await fetch(`/api${endpoint}`);
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('API GET Error:', error);
            return null;
        }
    },
    
    async post(endpoint, data) {
        try {
            const response = await fetch(`/api${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('API POST Error:', error);
            return null;
        }
    }
};

// ========== GLOBAL EXPORTS ==========
window.Propbandhu = {
    // Core
    CartManager,
    API,
    
    // Functions
    showNotification,
    CountdownTimer,
    initNeedsTabs,
    loadProperties,
    displayFeaturedProperties,
    displayPopularProperties,
    loadPropertiesIfNeeded,
    viewPropertyDetail,
    
    // New Functions
    initMobileMenu,
    initNavbarDropdowns,
    initAuthButtonAnimations,
    
    // Utilities
    getSampleProperties
};

console.log('✨ Propbandhu JS initialized successfully');