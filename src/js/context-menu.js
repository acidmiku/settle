// Shared positioning and keyboard navigation for library menus.
export function createContextMenu(menu) {
  let returnFocus;
  function close(restore = true) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (restore && returnFocus?.isConnected) returnFocus.focus();
  }
  function open(event, items, anchor = event.currentTarget) {
    event.preventDefault(); event.stopPropagation();
    returnFocus = document.activeElement;
    menu.replaceChildren(...items.map(item => {
      const button = document.createElement('button');
      button.setAttribute('role', 'menuitem'); button.textContent = item.label;
      button.onclick = () => { close(); item.action(); };
      return button;
    }));
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const pointer = event.type === 'contextmenu' && event.button === 2;
    const x = pointer ? event.clientX : rect.left, y = pointer ? event.clientY : rect.bottom;
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
    menu.querySelector('button')?.focus();
  }
  menu.addEventListener('keydown', e => {
    e.stopPropagation();
    const buttons = [...menu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
    else if (['ArrowUp','ArrowDown','Home','End'].includes(e.key)) {
      e.preventDefault();
      buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  });
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) close(false); });
  window.addEventListener('blur', () => close(false));
  window.addEventListener('resize', () => close(false));
  return {open, close};
}
