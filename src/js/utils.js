export const $ = (id) => document.getElementById(id);
export const isMac = () => document.documentElement.dataset.platform === 'macos';
export const isMod = (e) => isMac() ? e.metaKey : e.ctrlKey;
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
export function openDialog(dialog, focus) {
  document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
  if (!dialog.open) dialog.showModal();
  focus?.focus();
}
export function initDialogs() {
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelectorAll('[data-close-dialog]').forEach(btn => btn.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', e => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
  });
}
export function confirmAction(title, message, action = 'Discard') {
  const dialog = $('confirm-dialog');
  if (dialog.open) return Promise.resolve(false);
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-ok').textContent = action;
  dialog.returnValue = '';
  dialog.showModal();
  $('confirm-cancel').focus();
  return new Promise(resolve => {
    $('confirm-ok').onclick = () => dialog.close('yes');
    $('confirm-cancel').onclick = () => dialog.close('no');
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
  });
}
