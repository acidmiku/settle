import { $ } from './utils.js';
import { toast } from './toast.js';

export function initWindowChrome(platform) {
  document.documentElement.dataset.platform = platform;
  const mod = platform === 'macos' ? 'Cmd' : 'Ctrl';
  document.querySelectorAll('[data-shortcut]').forEach(el => { el.textContent = `${mod} ${el.dataset.shortcut}`; });
  document.querySelectorAll('[title]').forEach(el => { el.title = el.title.replaceAll('Ctrl/Cmd', mod); });
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!win) return;
  const run = fn => async () => { try { await fn(); } catch (e) { toast(`Window action failed: ${e}`, { kind: 'error' }); } };
  $('win-min').onclick = run(() => win.minimize());
  $('win-max').onclick = run(() => win.toggleMaximize());
  $('win-close').onclick = run(() => win.close());
  // Tauri's data-tauri-drag-region handles dragging and double-click maximize.
  // Do not install a second competing pointer handler.
}
