import { invoke } from './api.js';
import { $, debounce, escapeHtml, openDialog } from './utils.js';
import { toast } from './toast.js';

export function createSearch(onOpen) {
  const dialog = $('search-dialog'), input = $('search-input'), results = $('search-results');
  let revision = 0, selected = 0, rows = [];
  function select(index) {
    selected = index;
    [...results.querySelectorAll('button')].forEach((el,i) => el.classList.toggle('is-selected', i === selected));
    results.children[selected]?.scrollIntoView({ block: 'nearest' });
  }
  async function jump(row) {
    if (!row) return;
    try {
      const notes = await invoke('list_notes_for_date', { localDate: row.local_date });
      const note = notes.find(n => n.id === row.id);
      if (!note) throw new Error('This note was deleted. Search again.');
      dialog.close();
      onOpen(note);
    } catch (e) { toast(String(e), { kind: 'error' }); }
  }
  async function search(version) {
    const query = input.value.trim();
    if (!query) { results.innerHTML = '<p class="empty">A word, a thought, something you wrote.</p>'; return; }
    try {
      const found = await invoke('search', { query, limit: 60 });
      if (version !== revision || !dialog.open) return;
      rows = found;
      results.innerHTML = rows.length ? rows.map(row => `<button class="search-result"><time>${escapeHtml(row.local_date)}</time>${row.title ? `<strong>${escapeHtml(row.title)}</strong>` : ''}<p>${escapeHtml(row.snippet)}</p></button>`).join('') : '<p class="empty">No notes found. Try another word.</p>';
      [...results.querySelectorAll('button')].forEach((button,i) => button.onclick = () => jump(rows[i]));
      select(0);
    } catch (e) { if (version === revision) results.textContent = `Search failed: ${e}`; }
  }
  const delayed = debounce(search, 140);
  input.addEventListener('input', () => { rows = []; results.textContent = 'Searching…'; delayed(++revision); });
  dialog.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (['ArrowDown','ArrowUp'].includes(e.key) && rows.length) { e.preventDefault(); select((selected + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length); }
    if (e.key === 'Enter' && e.target === input) { e.preventDefault(); jump(rows[selected]); }
  });
  return { open() { openDialog(dialog, input); input.select(); search(++revision); } };
}
