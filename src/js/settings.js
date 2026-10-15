import { invoke } from './api.js';
import { $, escapeHtml, openDialog } from './utils.js';
import { toast } from './toast.js';

export const DESIGNS = [
  ['kiln','Kiln','#242422','#e5e3dd','#ff681b'],
  ['blackbox','Blackbox','#0b0d09','#f1f0e5','#b6f321'],
  ['optic','Optic','#fafaf8','#101219','#1837ff'],
  ['phosphor','Phosphor','#061b16','#d1f4e8','#8bf1c9'],
  ['sidecar','Sidecar','#131e26','#f1f4f8','#ff813e'],
  ['cobalt','Cobalt','#1738ee','#fff','#e2ff48'],
  ['scratch','Scratch','#202329','#f0f0f3','#ff5579'],
  ['redline','Redline','#f2f0e9','#10100f','#ed2b20'],
  ['frost','Frost','#f2f5f8','#252e38','#0087a6'],
  ['tape','Tape','#ebf23e','#181b08','#181b08'],
];
export function createSettings(settings, flushWorkspace) {
  const dialog = $('settings-dialog');
  let savingDesign = false;
  $('design-picker').innerHTML = DESIGNS.map(([id,name,bg,fg,accent],i) => `<button class="design-option" data-value="${id}" aria-label="${name}${id === 'scratch' ? ' (default)' : ''}" aria-pressed="false" style="--preview-bg:${bg};--preview-fg:${fg};--preview-accent:${accent}"><span class="design-preview" aria-hidden="true"><i></i><i></i><i></i></span><span class="design-name">${escapeHtml(name)}<small>${String(i+1).padStart(2,'0')}</small></span></button>`).join('');
  function applyDesign(id) {
    const design = DESIGNS.some(d => d[0] === id) ? id : 'scratch';
    document.documentElement.dataset.design = design;
    document.querySelectorAll('.design-option').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === design)));
    window.dispatchEvent(new CustomEvent('settle:design-changed'));
  }
  function applySaveMode(mode) {
    document.documentElement.dataset.saveMode = mode === 'enter' ? 'enter' : 'shift_enter';
    $('set-enter-save').checked = mode === 'enter';
    $('btn-save').title = `Save (Ctrl/Cmd+S or ${mode === 'enter' ? 'Enter' : 'Shift+Enter'})`;
  }
  $('design-picker').addEventListener('click', async e => {
    const button = e.target.closest('.design-option');
    if (!button || savingDesign) return;
    savingDesign = true;
    const value = button.dataset.value, previous = settings.design || 'scratch';
    applyDesign(value);
    try { await invoke('set_setting', { key: 'design', value }); settings.design = value; }
    catch (error) { applyDesign(previous); toast(`Design could not be saved: ${error}`, { kind: 'error' }); }
    finally { savingDesign = false; }
  });
  $('set-enter-save').addEventListener('change', async () => {
    const control = $('set-enter-save'), value = control.checked ? 'enter' : 'shift_enter';
    control.disabled = true;
    try { await invoke('set_setting', { key: 'save_key_mode', value }); settings.save_key_mode = value; applySaveMode(value); }
    catch (e) { applySaveMode(settings.save_key_mode); toast(`Setting failed: ${e}`, { kind: 'error' }); }
    finally { control.disabled = false; }
  });
  $('set-hotkey').value = settings.global_hotkey ?? 'CmdOrCtrl+Shift+Space';
  $('hotkey-form').addEventListener('submit', async e => {
    e.preventDefault();
    const value = $('set-hotkey').value.trim(), button = e.target.querySelector('button');
    button.disabled = true;
    try { await invoke('set_setting', { key: 'global_hotkey', value }); settings.global_hotkey = value; $('hotkey-status').textContent = value ? 'Shortcut registered.' : 'Global shortcut disabled.'; }
    catch (error) { $('hotkey-status').textContent = `Could not apply: ${error}`; }
    finally { button.disabled = false; }
  });
  for (const [id, command] of [['btn-export-json','export_json'],['btn-export-md','export_markdown']]) {
    $(id).onclick = async () => {
      $(id).disabled = true;
      $('export-status').textContent = 'Exporting…';
      try { await flushWorkspace(); const result = await invoke(command); $('export-status').textContent = `Saved ${result.files_written} file(s) to ${result.export_dir}`; }
      catch (e) { $('export-status').textContent = `Export failed: ${e}`; }
      finally { $(id).disabled = false; }
    };
  }
  async function open() {
    openDialog(dialog, dialog.querySelector('[aria-pressed="true"]'));
    try { const info = await invoke('get_db_info'); $('db-info').textContent = `${info.path} · ${(info.size_bytes / 1024).toFixed(1)} KB`; }
    catch (e) { $('db-info').textContent = `Database information unavailable: ${e}`; }
  }
  applyDesign(settings.design);
  applySaveMode(settings.save_key_mode);
  return { open };
}
