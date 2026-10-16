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
      if (e.target !== dialog || dialog.dataset.busy === 'true') return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
  });
}

export function noteLabel(note) {
  return note.title || (note.content ?? note.text ?? '').split('\n')[0].trim() || 'Untitled';
}

export function editItem({heading, label = 'Name', value = '', hint = '', placeholder = '', maxLength = 160, required = false, options, saveLabel = 'Save', onSave}) {
  const dialog = $('edit-item-dialog'), input = options ? $('edit-item-folder') : $('edit-item-name');
  if (dialog.open) return;
  $('edit-item-title').textContent = heading;
  $('edit-item-label').textContent = options ? 'Folder' : label;
  $('edit-item-name').hidden = Boolean(options);
  $('edit-item-name').required = !options && required;
  $('edit-item-folder').hidden = !options;
  if (options) input.replaceChildren(...options.map(o => new Option(o.name, o.id)));
  else { input.maxLength = maxLength; input.placeholder = placeholder; }
  input.value = value;
  $('edit-item-hint').textContent = hint;
  $('edit-item-error').textContent = '';
  $('edit-item-submit').textContent = saveLabel;
  dialog.oncancel = e => { if (dialog.dataset.busy === 'true') e.preventDefault(); };
  $('edit-item-form').onsubmit = async e => {
    e.preventDefault();
    if (dialog.dataset.busy === 'true') return;
    dialog.dataset.busy = 'true';
    input.disabled = $('edit-item-submit').disabled = $('edit-item-cancel').disabled = true;
    try { await onSave(input.value.trim()); dialog.close(); }
    catch (error) { $('edit-item-error').textContent = String(error); }
    finally { dialog.dataset.busy = 'false'; input.disabled = $('edit-item-submit').disabled = $('edit-item-cancel').disabled = false; }
  };
  openDialog(dialog, input);
  if (!options) input.select();
}

export function confirmClose(label) {
  const dialog = $('close-tab-dialog');
  if (dialog.open) return Promise.resolve('cancel');
  $('close-tab-message').textContent = `“${label}” has unsaved changes. Save them before closing?`;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  $('close-tab-save').focus();
  return new Promise(resolve => {
    for (const action of ['cancel','discard','save']) $('close-tab-' + action).onclick = () => dialog.close(action);
    dialog.addEventListener('close', () => resolve(dialog.returnValue), {once:true});
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
