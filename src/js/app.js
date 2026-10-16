import { invoke, listen } from './api.js';
import { $, isMod, initDialogs, confirmAction, confirmClose, editItem, noteLabel } from './utils.js';
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
  const notes = createNotes({onOpen:openNote, onNew:addBuffer, onDelete:id => {
    for (const buffer of state.buffers) if (buffer.noteId === id) { buffer.noteId = null; buffer.original = ''; }
    persist(); renderTabs();
  }, onChange:(id, changes) => {
    for (const buffer of state.buffers) if (buffer.noteId === id) Object.assign(buffer, changes);
    persist(); renderTabs();
  }, onFolderDelete:id => {
    for (const buffer of state.buffers) if (buffer.folderId === id) buffer.folderId = null;
    persist();
  }});
  const search = createSearch(openNote);
  createTabMenu({new:() => addBuffer(), rename:renameBuffer, close:closeBuffer, 'save-all':() => closeAll(true), 'discard-all':() => closeAll(false)}, () => busy, () => current().id);

  function renderTabs() {
    const buffer = current();
    const existing = new Map([...$('buffer-tabs').children].map(el => [el.dataset.bufferId, el]));
    state.buffers.forEach((b,i) => {
      const shell = existing.get(b.id) || document.createElement('div');
      if (!existing.has(b.id)) {
        shell.className = 'buffer-tab-shell'; shell.dataset.bufferId = b.id; shell.setAttribute('role','presentation');
        shell.innerHTML = '<button class="buffer-tab"><span class="tab-label"></span></button><button class="tab-close" title="Close tab" aria-label="Close tab">×</button>';
      }
      existing.delete(b.id);
      const button = shell.querySelector('.buffer-tab'), close = shell.querySelector('.tab-close');
      button.dataset.bufferId = b.id;
      button.setAttribute('role','tab');
      button.setAttribute('aria-selected', String(b.id === buffer.id));
      button.tabIndex = b.id === buffer.id ? 0 : -1;
      const title = b.title || b.text.split('\n')[0].trim() || 'New note';
      button.querySelector('.tab-label').textContent = title;
      button.title = title;
      close.setAttribute('aria-label', `Close ${title}`);
      close.onclick = () => closeBuffer(b.id);
      button.ondblclick = () => renameBuffer(b.id);
      button.onclick = () => {
        if (closingAll) return;
        if (state.activeId === b.id) { editor.focus(); return; }
        state.activeId = b.id; showBuffer(); persist();
      };
      button.onkeydown = e => {
        if (closingAll || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault();
        const buffers = state.buffers;
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? buffers.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buffers.length) % buffers.length;
        state.activeId = buffers[index].id; showBuffer(); persist();
        $('buffer-tabs').querySelector('[aria-selected="true"]').focus();
      };
      $('buffer-tabs').append(shell);
    });
    existing.forEach(el => el.remove());
    $('buffer-state').textContent = buffer.noteId ? 'Editing saved note' : 'Draft · local';
    $('save-label').textContent = buffer.noteId ? 'Update' : 'Save';
    const saved = Boolean(buffer.noteId) && buffer.text === buffer.original;
    $('note-save-status').dataset.saved = String(saved);
    $('note-save-status').textContent = saved ? 'Saved' : 'Not saved';
    $('note-save-status').title = saved ? 'This note is saved to your library.' : 'This tab has not been saved to your library. Draft backup is separate.';
    notes.setActive(buffer.noteId);
  }
  function showBuffer() {
    editor.setBuffer(current());
    renderTabs(); find.refresh(); editor.focus();
  }
  function addBuffer(folderId = null) {
    if (closingAll) return;
    const buffer = newBuffer(folderId);
    state.buffers.push(buffer); state.activeId = buffer.id; showBuffer(); persist();
  }
  function openNote(note) {
    if (closingAll) return;
    let buffer = state.buffers.find(b => b.noteId === note.id);
    if (!buffer) {
      buffer = { ...newBuffer(note.folder_id), text: note.content, title:note.title || null, original: note.content, noteId: note.id };
      state.buffers.push(buffer);
    }
    buffer.title = note.title || null; buffer.folderId = note.folder_id || null;
    state.activeId = buffer.id;
    showBuffer(); persist();
  }
  async function closeBuffer(id = current().id) {
    if (busy) return;
    const buffer = state.buffers.find(b => b.id === id);
    if (!buffer) return;
    const choice = (buffer.noteId ? buffer.text !== buffer.original : Boolean(buffer.text || buffer.title)) ? await confirmClose(noteLabel(buffer)) : 'discard';
    if (!['save','discard'].includes(choice)) return;
    if (busy) return;
    if (choice === 'save') {
      busy = true; closingAll = true; $('app').inert = true;
      try {
        if (!buffer.text.trim()) throw new Error('Write something in this note before saving.');
        await writeBuffer(buffer);
      } catch (error) {
        toast(`Could not save. The tab is still open. ${error}`, {kind:'error'}); return;
      } finally { busy = false; closingAll = false; $('app').inert = false; renderTabs(); }
    }
    const index = state.buffers.indexOf(buffer);
    state.buffers = state.buffers.filter(b => b.id !== buffer.id);
    if (state.activeId === buffer.id) state.activeId = state.buffers[Math.min(index, state.buffers.length - 1)]?.id;
    showBuffer(); persist();
    if (!$('history').hidden) notes.refresh();
  }
  function renameBuffer(id = current().id) {
    if (busy) return;
    const buffer = state.buffers.find(b => b.id === id);
    if (!buffer) return;
    editItem({heading:'Rename note', value:buffer.title || '', placeholder:noteLabel(buffer),
      hint:'Leave blank to use the first line. The note text stays unchanged.',
      onSave:async title => {
        if (buffer.noteId) await invoke('rename_note', {noteId:buffer.noteId, title:title || null});
        buffer.title = title || null; persist(); renderTabs();
        if (!$('history').hidden) await notes.refresh();
      }});
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
      const saved = await invoke('create_note', {content:text, title:buffer.title, folderId:buffer.folderId});
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
    $('wysiwyg-toolbar').inert = true;
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
      $('wysiwyg-toolbar').inert = false;
      editor.input.readOnly = false; editor.title.readOnly = false; editor.focus();
      if (!$('history').hidden) notes.refresh();
    }
  }
  async function save() {
    if (busy) return;
    const buffer = current(), updating = Boolean(buffer.noteId);
    if (!buffer.text.trim()) { toast('Write something first.'); editor.focus(); return; }
    busy = true; $('btn-save').disabled = true;
    try {
      await writeBuffer(buffer);
      if (current().id === buffer.id) {
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
      if (buffer.text === text) { buffer.text = ''; buffer.noteId = null; buffer.original = ''; buffer.title = null; }
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
  $('btn-new').onclick = () => addBuffer();
  $('btn-search').onclick = search.open;
  $('btn-save').onclick = save;
  $('btn-copy').onclick = copyClear;
  $('btn-hide').onclick = hide;
  document.querySelectorAll('[data-action="settings"]').forEach(button => button.onclick = settings.open);
  document.querySelectorAll('[data-action="history"]').forEach(button => button.onclick = notes.toggle);
  $('rich-editor').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229 || e.key !== 'Enter') return;
    if (isMod(e)) { e.preventDefault(); e.stopPropagation(); copyClear(); }
    else if (!e.altKey && !e.ctrlKey && !e.metaKey && (document.documentElement.dataset.saveMode === 'enter' ? !e.shiftKey : e.shiftKey)) {
      e.preventDefault(); e.stopPropagation(); save();
    }
  }, true);
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
