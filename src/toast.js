/**
 * Show a toast notification.
 * @param {string} message - The message to display
 * @param {string} type - 'info' (default) or 'error'
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'error') {
    toast.classList.add('toast--error');
  }
  toast.textContent = message;

  container.appendChild(toast);

  // Trigger reflow for transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('toast--visible');
    });
  });

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, { once: true });

    // Fallback: remove after transition + buffer
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 400);
  }, 3000);
}
