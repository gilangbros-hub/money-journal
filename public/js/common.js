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
    const trigger = document.querySelector('.user-info');
    if (menu && trigger && !trigger.contains(event.target) && !menu.contains(event.target)) {
        menu.style.display = 'none';
    }
});

// Toast Notification System
// The third argument is either a duration in ms (legacy) or
// { duration, actionLabel, onAction } to show one action button, e.g. Undo.
// A toast with an action stays up longer by default so it can be reached.
let toastTimer;
function showToast(text, type = 'success', options = 2500) {
    const messageDiv = document.getElementById('message');
    if (!messageDiv) return;

    const settings = typeof options === 'number' ? { duration: options } : (options || {});
    const hasAction = Boolean(settings.actionLabel && typeof settings.onAction === 'function');
    const duration = settings.duration || (hasAction ? 5000 : 2500);

    clearTimeout(toastTimer);
    messageDiv.className = 'toast';
    messageDiv.classList.add(type === 'success' ? 'success' : 'error');
    messageDiv.textContent = text;

    if (hasAction) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'toast-action';
        action.textContent = settings.actionLabel;
        action.addEventListener('click', () => {
            clearTimeout(toastTimer);
            messageDiv.classList.remove('show');
            settings.onAction();
        }, { once: true });
        messageDiv.appendChild(action);
    }

    messageDiv.classList.add('show');

    toastTimer = setTimeout(() => {
        messageDiv.classList.remove('show');
    }, duration);
}

// Format number to Rupiah string
function formatRupiah(num) {
    if (num === null || num === undefined || isNaN(num)) return 'Rp 0';
    return 'Rp ' + Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Shared Chart Colors - Neon Palette
const chartColors = [
    '#FF4D6D', '#7C3AED', '#22C55E', '#F59E0B', '#06B6D4',
    '#F97316', '#3B82F6', '#EC4899', '#FBBF24', '#14B8A6'
];
