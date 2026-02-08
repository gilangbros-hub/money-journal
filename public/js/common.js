// Common Utilities - Shared across all pages

// Toggle User Menu
function toggleMenu() {
    const menu = document.getElementById('userMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

// Close menu when clicking outside
document.addEventListener('click', function (event) {
    const menu = document.getElementById('userMenu');
    const trigger = document.querySelector('.dropdown, .user-avatar');
    if (menu && trigger && !trigger.contains(event.target) && !menu.contains(event.target)) {
        menu.style.display = 'none';
    }
});

// Toast Notification System
let toastTimer;
function showToast(text, type = 'success', duration = 2500) {
    const messageDiv = document.getElementById('message');
    if (!messageDiv) return;

    clearTimeout(toastTimer);
    messageDiv.className = '';
    messageDiv.classList.add(type === 'success' ? 'success' : 'error');
    messageDiv.innerText = text;
    messageDiv.classList.add('show');

    toastTimer = setTimeout(() => {
        messageDiv.classList.remove('show');
    }, duration);
}
