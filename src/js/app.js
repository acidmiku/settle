import { invoke, listen } from './api.js';
import { $, isMod, initDialogs, confirmAction } from './utils.js';
import { toast } from './toast.js';
import { createWorkspace, newBuffer } from './workspace.js';
import { createEditor, createFind } from './editor.js';
import { createSettings } from './settings.js';
import { createNotes } from './notes.js';
import { createSearch } from './search.js';
import { initWindowChrome } from './chrome.js';
import { createTabMenu } from './tab-menu.js';

async function boot() {
  $('note-input').readOnly = true;
  initDialogs();
  const [settingsData, runtime] = await Promise.all([invoke('get_settings'), invoke('get_runtime_info')]);
  initWindowChrome(runtime.platform);
  const workspace = createWorkspace(settingsData.workspace, message => { $('buffer-state').textContent = message; });
  const { state, current, persist } = workspace;
  let busy = false, closingAll = false, installingUpdate = false;
  const editor = createEditor(text => {
    current().text = text;
    persist();
    renderTabs();
    find.refresh();
  }, options => { Object.assign(current(), options); persist(); }, settingsData);
  const find = createFind(editor);
  const settings = createSettings(settingsData, workspace.flush, runtime, async () => {
    if (busy) throw new Error('Wait for the current save to finish.');
    busy = true; closingAll = true; installingUpdate = true;
    $('app').inert = true; $('settings-dialog').inert = true;
    editor.input.readOnly = true; editor.title.readOnly = true;
    try {
      persist();
      await workspace.flushRequired();
      await invoke('install_update');
    } catch (error) {
      busy = false; closingAll = false; installingUpdate = false;
      $('app').inert = false; $('settings-dialog').inert = false;
      editor.input.readOnly = false; editor.title.readOnly = false;
      throw error;
    }
  });
  $('settings-dialog').addEventListener('cancel', event => { if (installingUpdate) event.preventDefault(); });
  const notes = createNotes(openNote, id => {
    for (const buffer of state.buffers) if (buffer.noteId === id) { buffer.noteId = null; buffer.original = ''; }
    persist(); renderTabs();
  });
  const search = createSearch(openNote);
  createTabMenu({new:addBuffer, close:closeBuffer, 'save-all':() => closeAll(true), 'discard-all':() => closeAll(false)}, () => busy, () => current().id);

  function renderTabs() {
    const buffer = current();
    $('buffer-tabs').replaceChildren();
    state.buffers.forEach((b,i) => {
      const button = document.createElement('button');
      button.className = 'buffer-tab';
      button.dataset.bufferId = b.id;
      button.setAttribute('role','tab');
      button.setAttribute('aria-selected', String(b.id === buffer.id));
      button.tabIndex = b.id === buffer.id ? 0 : -1;
      const title = b.text.split('\n')[0].trim();
      button.textContent = title || 'New note';
      button.title = title || button.textContent;
      button.onclick = () => { if (closingAll) return; state.activeId = b.id; showBuffer(); persist(); };
      button.onkeydown = e => {
        if (closingAll || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault();
        const buffers = state.buffers;
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? buffers.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buffers.length) % buffers.length;
        state.activeId = buffers[index].id; showBuffer(); persist();
        $('buffer-tabs').querySelector('[aria-selected="true"]').focus();
      };
      $('buffer-tabs').append(button);
    });
    $('buffer-state').textContent = buffer.noteId ? 'Editing saved note' : 'Draft · local';
    $('save-label').textContent = buffer.noteId ? 'Update' : 'Save';
  }
  function showBuffer() {
    editor.setBuffer(current());
    renderTabs(); find.refresh(); editor.focus();
  }
  function addBuffer() {
    if (closingAll) return;
    const buffer = newBuffer();
    state.buffers.push(buffer); state.activeId = buffer.id; showBuffer(); persist();
  }
  function openNote(note) {
    if (closingAll) return;
    let buffer = state.buffers.find(b => b.noteId === note.id);
    if (!buffer) {
      buffer = { ...newBuffer(), text: note.content, original: note.content, noteId: note.id };
      state.buffers.push(buffer);
    }
    state.activeId = buffer.id;
    showBuffer(); persist();
  }
  async function closeBuffer(id = current().id) {
    if (busy) return;
    const buffer = state.buffers.find(b => b.id === id);
    if (!buffer) return;
    if (buffer.noteId ? buffer.text !== buffer.original : Boolean(buffer.text)) {
      if (!await confirmAction('Discard buffer?', 'This buffer has text that will be removed. Saved notes are kept.')) return;
    }
    if (busy) return;
    state.buffers = state.buffers.filter(b => b.id !== buffer.id);
    showBuffer(); persist();
  }
  async function writeBuffer(buffer) {
    const text = buffer.text;
    if (!text.trim()) {
      if (buffer.noteId && text !== buffer.original) throw new Error('A saved note cannot be updated to empty text. Keep text in it or close without saving.');
      return;
    }
    if (buffer.noteId) {
      if (text !== buffer.original) await invoke('update_note', {noteId:buffer.noteId,content:text});
    } else {
      const saved = await invoke('create_note', {content:text});
      buffer.noteId = saved.id;
    }
    buffer.original = text;
    // Persist each successful save so a retry after a later failure updates it.
    persist();
  }
  async function closeAll(withSaving) {
    if (busy) return;
    if (!withSaving && !await confirmAction('Close all without saving?', 'All open tabs will close and their unsaved text or edits will be discarded. Previously saved notes are kept.', 'Close all')) return;
    if (busy) return;
    busy = true; closingAll = true;
    document.querySelector('.workspace').inert = true;
    document.querySelector('.buffer-bar').inert = true;
    document.querySelector('.actionbar').inert = true;
    editor.input.readOnly = true; editor.title.readOnly = true;
    try {
      if (withSaving) for (const buffer of state.buffers) await writeBuffer(buffer);
      state.buffers = [newBuffer()]; state.activeId = state.buffers[0].id;
      persist(); showBuffer();
      if (withSaving) toast('All tabs saved and closed');
    } catch (e) {
      persist(); renderTabs();
      toast(`Could not save every tab. All tabs are still open. ${e}`, {kind:'error',timeoutMs:10000});
    } finally {
      busy = false; closingAll = false;
      for (const selector of ['.workspace','.buffer-bar','.actionbar']) document.querySelector(selector).inert = false;
      editor.input.readOnly = false; editor.title.readOnly = false; editor.focus();
      if (!$('history').hidden) notes.refresh();
    }
  }
  async function save() {
    if (busy) return;
    const buffer = current(), text = buffer.text, updating = Boolean(buffer.noteId);
    if (!text.trim()) { toast('Write something first.'); editor.focus(); return; }
    busy = true; $('btn-save').disabled = true;
    try {
      await writeBuffer(buffer);
      if (!updating && buffer.text === text) { buffer.text = ''; buffer.noteId = null; buffer.original = ''; }
      persist();
      if (current().id === buffer.id) {
        if (editor.getText() !== buffer.text) editor.setText(buffer.text);
        if (!buffer.text) editor.revealSource();
        renderTabs(); find.refresh();
      }
      toast(updating ? 'Note updated' : 'Note saved');
      if (!document.querySelector('dialog[open]')) editor.focus();
      if (!$('history').hidden) notes.refresh();
    } catch (e) { toast(`Save failed: ${e}`, { kind: 'error' }); }
    finally { busy = false; $('btn-save').disabled = false; }
  }
  async function copyClear() {
    if (busy) return;
    const buffer = current(), text = buffer.text;
    if (!text) return;
    busy = true; $('btn-copy').disabled = true;
    try {
      await invoke('copy_to_clipboard', { text });
      if (buffer.text === text) { buffer.text = ''; buffer.noteId = null; buffer.original = ''; }
      persist();
      if (current().id === buffer.id) { editor.setText(buffer.text); if (!buffer.text) editor.revealSource(); renderTabs(); find.refresh(); }
      toast('Copied to clipboard');
      if (!document.querySelector('dialog[open]')) editor.focus();
    } catch (e) { toast(`Copy failed; your text is still here. ${e}`, { kind: 'error' }); }
    finally { busy = false; $('btn-copy').disabled = false; }
  }
  async function hide() {
    await workspace.flush();
    try { await invoke('hide_main_window'); } catch (e) { toast(`Could not hide: ${e}`, { kind:'error' }); }
  }
  $('btn-new').onclick = addBuffer;
  $('btn-close-buffer').onclick = () => closeBuffer();
  $('btn-search').onclick = search.open;
  $('btn-save').onclick = save;
  $('btn-copy').onclick = copyClear;
  $('btn-hide').onclick = hide;
  document.querySelectorAll('[data-action="settings"]').forEach(button => button.onclick = settings.open);
  document.querySelectorAll('[data-action="history"]').forEach(button => button.onclick = notes.toggle);
  window.addEventListener('keydown', e => {
    if (installingUpdate) { e.preventDefault(); return; }
    if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return; // Native dialog handles Esc and focus trapping.
    const mod = isMod(e), key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (find.isOpen()) find.close();
      else if (!$('history').hidden) { notes.toggle(); editor.focus(); }
      else hide();
      return;
    }
    if (e.key === 'F3') { e.preventDefault(); if (!find.isOpen()) find.open(); else find.step(e.shiftKey ? -1 : 1); return; }
    if (mod && !e.altKey) {
      if (key === 'h' && e.shiftKey) { e.preventDefault(); notes.toggle(); return; }
      const actions = { n: addBuffer, k: search.open, f: find.open, ',': settings.open, s: save };
      if (actions[key]) { e.preventDefault(); actions[key](); return; }
    }
    if (e.target !== editor.input && e.target !== editor.title) return;
    if (e.key === 'Enter' && mod) { e.preventDefault(); copyClear(); return; }
    if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && (document.documentElement.dataset.saveMode === 'enter' ? !e.shiftKey : e.shiftKey)) { e.preventDefault(); save(); }
  });
  await listen('settle:focus-input', () => { if (!document.querySelector('dialog[open]')) editor.focus(); });
  $('note-input').readOnly = false;
  showBuffer();
  document.documentElement.dataset.ready = 'true';
  if (runtime.hotkey_error) toast(`Global shortcut unavailable: ${runtime.hotkey_error}. Change it in Settings.`, { kind:'error', timeoutMs:10000 });
  const tick = () => {
    const time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
    $('clock').textContent = time; document.querySelector('.heading-time').textContent = time;
  };
  tick(); setInterval(tick, 30000);
}
boot().catch(e => {
  $('buffer-state').textContent = 'Could not open local data';
  toast(`Settle could not start: ${e}. Reopen the app to retry.`, { kind:'error', timeoutMs:30000 });
});
