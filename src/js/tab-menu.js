import { $ } from './utils.js';

export function createTabMenu(actions, isBusy, currentId) {
  const bar = document.querySelector('.buffer-bar'), menu = $('tab-menu');
  let targetId, returnFocus;
  function close(restore = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (restore && returnFocus?.isConnected) returnFocus.focus();
  }
  function open(event, keyboard = false) {
    if (isBusy()) return;
    event.preventDefault();
    const tab = event.target.closest('.buffer-tab-shell')?.querySelector('.buffer-tab');
    targetId = tab?.dataset.bufferId || currentId();
    returnFocus = document.activeElement;
    menu.hidden = false;
    const rect = (tab || bar).getBoundingClientRect();
    const x = keyboard ? rect.left : event.clientX, y = keyboard ? rect.bottom : event.clientY;
    menu.style.left = `${Math.max(4,Math.min(x,innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4,Math.min(y,innerHeight - menu.offsetHeight - 4))}px`;
    menu.querySelector('button').focus();
  }
  bar.addEventListener('contextmenu',open);
  bar.addEventListener('keydown', e => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.stopPropagation(); open(e,true); }
  });
  menu.addEventListener('click', e => {
    const action = e.target.closest('[data-tab-action]')?.dataset.tabAction;
    if (action) { close(); actions[action](targetId); }
  });
  menu.addEventListener('keydown', e => {
    e.stopPropagation();
    const buttons = [...menu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
    else if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  });
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) close(false); });
  window.addEventListener('blur', () => close(false));
  window.addEventListener('resize', () => close(false));
  return {close};
}
