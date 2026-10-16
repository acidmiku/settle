import { invoke } from './api.js';
import { $, escapeHtml, confirmAction, editItem, noteLabel } from './utils.js';
import { toast } from './toast.js';
import { createContextMenu } from './context-menu.js';

export function createNotes({onOpen, onDelete, onChange, onNew, onFolderDelete}) {
  let request = 0, selected = 'all', folders = [], rows = [], activeId = null, loading = false;
  const menu = createContextMenu($('notes-menu'));
  const folderId = () => ['all','unfiled'].includes(selected) ? null : selected;
  function setActive(id) {
    activeId = id;
    document.querySelectorAll('.history-item').forEach(el => el.classList.toggle('is-active', el.dataset.noteId === id));
  }
  function rename(note) {
    editItem({heading:'Rename note', value:note.title || '', placeholder:noteLabel(note),
      hint:'Leave blank to use the first line. The note text stays unchanged.',
      onSave:async title => {
        await invoke('rename_note', {noteId:note.id, title:title || null});
        onChange(note.id, {title:title || null}); await refresh();
      }});
  }
  async function move(note) {
    try {
      const destinations = await invoke('list_folders');
      editItem({heading:`Move “${noteLabel(note)}”`, value:note.folder_id || '', saveLabel:'Move',
        options:[{id:'',name:'Unfiled'}, ...destinations],
        onSave:async id => {
          await invoke('move_note', {noteId:note.id, folderId:id || null});
          onChange(note.id, {folderId:id || null}); await refresh();
        }});
    } catch (error) { toast(`Could not load folders: ${error}`, {kind:'error'}); }
  }
  async function remove(note) {
    if (!await confirmAction('Delete saved note?', 'This removes the saved note from this device. Open draft copies will be kept.', 'Delete')) return;
    try { await invoke('delete_note', {noteId:note.id}); onDelete(note.id); await refresh(); }
    catch (error) { toast(`Delete failed: ${error}`, {kind:'error'}); }
  }
  function noteMenu(event, note, anchor) {
    menu.open(event, [
      {label:'Rename note…', action:() => rename(note)},
      {label:'Move to folder…', action:() => move(note)},
      {label:'Delete note…', action:() => remove(note)},
    ], anchor);
  }
  function editFolder(folder) {
    editItem({heading:folder ? 'Rename folder' : 'New folder', value:folder?.name || '', maxLength:80, required:true,
      saveLabel:folder ? 'Save' : 'Create folder',
      onSave:async name => {
        if (folders.some(f => f.id !== folder?.id && f.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A folder with this name already exists.');
        if (folder) await invoke('rename_folder', {folderId:folder.id, name});
        else selected = (await invoke('create_folder', {name})).id;
        await refresh();
      }});
  }
  async function deleteFolder(folder) {
    if (!await confirmAction('Delete folder?', `Notes in “${folder.name}” will move to Unfiled. Your notes will be kept.`, 'Delete folder')) return;
    try {
      await invoke('delete_folder', {folderId:folder.id});
      if (selected === folder.id) selected = 'unfiled';
      onFolderDelete(folder.id); await refresh();
    } catch (error) { toast(`Could not delete folder: ${error}`, {kind:'error'}); }
  }
  function folderMenu(event, folder, anchor) {
    menu.open(event, [
      {label:'Rename folder…', action:() => editFolder(folder)},
      {label:'Delete folder…', action:() => deleteFolder(folder)},
    ], anchor);
  }
  function keyboardMenu(element, open) {
    element.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) open(event);
    });
  }
  function renderFolders() {
    $('folder-list').replaceChildren();
    for (const folder of [{id:'all',name:'All notes'}, {id:'unfiled',name:'Unfiled'}, ...folders]) {
      const row = document.createElement('div'); row.className = 'folder-row';
      const button = document.createElement('button'); button.className = 'folder-button'; button.dataset.folderId = folder.id;
      button.setAttribute('aria-current', String(selected === folder.id));
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2-3h8v16H3z"/></svg><span>${escapeHtml(folder.name)}</span>${folder.note_count !== undefined ? `<small>${folder.note_count}</small>` : ''}`;
      button.title = folder.name;
      button.onclick = () => { if (selected !== folder.id) { selected = folder.id; refresh(); } };
      row.append(button);
      if (!['all','unfiled'].includes(folder.id)) {
        const actions = document.createElement('button'); actions.className = 'folder-actions'; actions.textContent = '⋯'; actions.setAttribute('aria-label', `Actions for ${folder.name}`);
        actions.onclick = event => folderMenu(event, folder, actions);
        button.oncontextmenu = event => folderMenu(event, folder, button);
        button.ondblclick = () => editFolder(folder);
        keyboardMenu(button, event => folderMenu(event, folder, button));
        row.append(actions);
      }
      $('folder-list').append(row);
    }
    $('notes-heading').textContent = selected === 'all' ? 'All notes' : selected === 'unfiled' ? 'Unfiled' : folders.find(f => f.id === selected)?.name || 'Notes';
  }
  function dateLabel(date) {
    const localDate = new Date(`${date}T12:00:00`), today = new Date(), yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const formatted = localDate.toLocaleDateString(undefined, {month:'short', day:'numeric', year:localDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined});
    return `${localDate.toDateString() === today.toDateString() ? 'Today · ' : localDate.toDateString() === yesterday.toDateString() ? 'Yesterday · ' : ''}${formatted}`;
  }
  function renderNotes() {
    const list = $('history-list'); list.replaceChildren();
    if (!rows.length) {
      list.innerHTML = '<p class="empty">No notes here yet.<br>Create a note, or move one into this folder.</p>';
      return;
    }
    let date, group;
    for (const note of rows) {
      if (note.local_date !== date) {
        date = note.local_date;
        group = document.createElement('section'); group.className = 'note-date-group';
        const heading = document.createElement('h4'); heading.className = 'note-date-label'; heading.textContent = dateLabel(date);
        group.append(heading); list.append(group);
      }
      const item = document.createElement('article'); item.className = 'history-item'; item.dataset.noteId = note.id;
      const lines = note.content.split('\n');
      if (!note.title || lines[0].replace(/^#{1,6}\s+/, '').trim() === note.title) lines.shift();
      const body = lines.filter(line => line.trim()).join(' ');
      const folderName = folders.find(f => f.id === note.folder_id)?.name;
      item.innerHTML = `<button class="history-open" title="${escapeHtml(noteLabel(note))}"><strong>${escapeHtml(noteLabel(note))}</strong><p>${escapeHtml(body.slice(0,140))}</p></button><div class="history-meta"><time>${escapeHtml(note.local_time.slice(0,5))}</time><span class="note-folder">${escapeHtml(folderName || 'Unfiled')}</span><button class="note-actions" aria-label="Note actions" title="Rename, move, or delete">⋯</button></div>`;
      const button = item.querySelector('.history-open');
      button.onclick = () => onOpen(note);
      button.ondblclick = () => rename(note);
      item.oncontextmenu = event => noteMenu(event, note, button);
      keyboardMenu(button, event => noteMenu(event, note, button));
      const actions = item.querySelector('.note-actions'); actions.onclick = event => noteMenu(event, note, actions);
      group.append(item);
    }
    setActive(activeId);
  }
  async function loadMore() {
    if (loading) return;
    const version = request; loading = true; $('history-more').disabled = true;
    try {
      const next = await invoke('list_notes', {folderId:folderId(), unfiled:selected === 'unfiled', offset:rows.length, limit:100});
      if (version !== request) return;
      rows.push(...next); renderNotes(); $('history-more').hidden = next.length < 100;
    } catch (error) { toast(`Could not load more notes: ${error}`, {kind:'error'}); }
    finally { if (version === request) { loading = false; $('history-more').disabled = false; } }
  }
  async function refresh() {
    const version = ++request; loading = true; menu.close(false);
    $('history-scroll').setAttribute('aria-busy','true'); $('history-more').hidden = true;
    try {
      const found = await invoke('list_folders');
      if (version !== request) return;
      folders = found;
      if (folderId() && !folders.some(f => f.id === selected)) selected = 'all';
      renderFolders();
      const notes = await invoke('list_notes', {folderId:folderId(), unfiled:selected === 'unfiled', offset:0, limit:100});
      if (version !== request) return;
      rows = notes; renderNotes(); $('history-scroll').scrollTop = 0;
      $('history-more').hidden = notes.length < 100; $('history-more').disabled = false;
    } catch (error) {
      if (version === request) {
        $('history-list').textContent = `Could not load notes: ${error}`;
        const retry = document.createElement('button'); retry.className = 'button'; retry.textContent = 'Retry'; retry.onclick = refresh; $('history-list').append(retry);
      }
    } finally { if (version === request) { loading = false; $('history-scroll').setAttribute('aria-busy','false'); } }
  }
  function toggle() {
    $('history').hidden = !$('history').hidden; menu.close(false);
    document.querySelectorAll('[data-action="history"]').forEach(el => el.setAttribute('aria-expanded', String(!$('history').hidden)));
    if (!$('history').hidden) refresh();
  }
  $('new-folder').onclick = () => editFolder();
  $('folder-new-note').onclick = () => onNew(folderId());
  $('history-more').onclick = loadMore;
  $('close-history').onclick = toggle;
  return {toggle, refresh, setActive, folderId};
}
