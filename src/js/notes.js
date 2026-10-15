import { invoke } from './api.js';
import { $, escapeHtml, confirmAction } from './utils.js';
import { toast } from './toast.js';

export function createNotes(onOpen, onDelete) {
  let request = 0;
  async function loadDay() {
    const version = ++request, date = $('history-date').value;
    if (!date) { $('history-list').innerHTML = '<p class="empty">Nothing saved yet.<br>Write a note and press Shift+Enter.</p>'; return; }
    try {
      const notes = await invoke('list_notes_for_date', { localDate: date });
      if (version !== request) return;
      $('history-list').replaceChildren();
      for (const note of notes.slice().reverse()) {
        const item = document.createElement('article');
        item.className = 'history-item';
        const [title,...body] = note.content.split('\n');
        item.innerHTML = `<button class="history-open"><strong>${escapeHtml(title || 'Untitled')}</strong><p>${escapeHtml(body.join('\n').slice(0,140))}</p></button><div class="history-meta"><time>${escapeHtml(note.local_time.slice(0,5))}</time><button class="delete-note" aria-label="Delete note">Delete</button></div>`;
        item.querySelector('.history-open').onclick = () => onOpen(note);
        item.querySelector('.delete-note').onclick = async () => {
          if (!await confirmAction('Delete saved note?', 'This removes the saved note from this device. Open draft copies will be kept.', 'Delete')) return;
          try { await invoke('delete_note', { noteId: note.id }); onDelete(note.id); await refresh(); }
          catch (e) { toast(`Delete failed: ${e}`, { kind: 'error' }); }
        };
        $('history-list').append(item);
      }
    } catch (e) { if (version === request) $('history-list').textContent = `Could not load notes: ${e}`; }
  }
  async function refresh() {
    const selected = $('history-date').value;
    try {
      const dates = await invoke('list_dates', { limit: 10000 });
      $('history-date').innerHTML = dates.map(d => `<option value="${escapeHtml(d.local_date)}">${escapeHtml(d.local_date)} · ${d.note_count} note${d.note_count === 1 ? '' : 's'}</option>`).join('');
      if (dates.some(d => d.local_date === selected)) $('history-date').value = selected;
      await loadDay();
    } catch (e) { $('history-list').textContent = `Could not load dates: ${e}`; }
  }
  function toggle() {
    $('history').hidden = !$('history').hidden;
    $('btn-history').setAttribute('aria-expanded', String(!$('history').hidden));
    if (!$('history').hidden) refresh();
  }
  $('history-date').onchange = loadDay;
  $('close-history').onclick = toggle;
  return { toggle, refresh };
}
