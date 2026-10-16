import { invoke } from './api.js';
import { toast } from './toast.js';
import { normalizeSyntax } from './languages.js';

const CACHE_KEY = 'settle.workspace.v3';
const LEGACY_CACHE_KEY = 'settle.workspace.v2';
export function newBuffer() {
  return { id: crypto.randomUUID(), text: '', noteId: null, original: '', syntax: 'auto', preview: false };
}
export function parseWorkspace(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || ![2,3].includes(value.version) || !Array.isArray(value.buffers) || !Number.isFinite(value.updatedAt)) return null;
    const ids = new Set();
    value.buffers = value.buffers.filter(b => {
      if (!b || typeof b.id !== 'string' || ids.has(b.id) || typeof b.text !== 'string') return false;
      ids.add(b.id);
      return true;
    });
    if (!value.buffers.length) return null;
    // Keep every former Note/Scratch buffer and the currently visible selection.
    const selected = value.version === 2 ? value.active?.[value.mode] : value.activeId;
    const activeId = value.buffers.find(b => b.id === selected)?.id
      || (value.version === 2 && value.buffers.find(b => b.mode === value.mode)?.id)
      || value.buffers[0].id;
    return {
      version: 3, updatedAt: value.updatedAt, activeId,
      buffers: value.buffers.map(b => ({
        id: b.id, text: b.text,
        noteId: typeof b.noteId === 'string' ? b.noteId : null,
        original: typeof b.original === 'string' ? b.original : '',
        syntax: normalizeSyntax(b.syntax), preview: b.preview === true,
      })),
    };
  } catch { return null; }
}
export function createWorkspace(remote, onStatus) {
  const candidates = [parseWorkspace(remote)];
  try { for (const key of [CACHE_KEY, LEGACY_CACHE_KEY]) candidates.push(parseWorkspace(localStorage.getItem(key))); }
  catch { /* SQLite remains available. */ }
  const state = candidates.filter(Boolean).sort((a,b) => b.updatedAt - a.updatedAt)[0] || {
    version: 3, updatedAt: 0, activeId: null, buffers: [newBuffer()],
  };
  let timer, pending, inFlight = null, failed = false;
  const current = () => {
    let buffer = state.buffers.find(b => b.id === state.activeId) || state.buffers[0];
    if (!buffer) { buffer = newBuffer(); state.buffers.push(buffer); }
    state.activeId = buffer.id;
    return buffer;
  };
  function flush() {
    clearTimeout(timer);
    if (inFlight) return inFlight;
    if (!pending) return Promise.resolve();
    inFlight = drain().finally(() => { inFlight = null; });
    return inFlight;
  }
  async function drain() {
    while (pending) {
      const snapshot = pending;
      pending = null;
      try {
        await invoke('set_setting', { key: 'workspace', value: snapshot });
        failed = false;
        if (!pending) onStatus('Backed up locally');
      } catch (e) {
        pending ??= snapshot;
        onStatus('Backup pending');
        if (!failed) toast(`Draft backup failed: ${e}. Keep Settle open and retry.`, { kind: 'error', timeoutMs: 8000 });
        failed = true;
        break;
      }
    }
  }
  function persist() {
    state.updatedAt = Math.max(Date.now(), state.updatedAt + 1);
    pending = JSON.stringify(state);
    try {
      localStorage.setItem(CACHE_KEY, pending);
      localStorage.removeItem(LEGACY_CACHE_KEY);
    }
    catch { onStatus('Backing up to database…'); }
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('blur', () => { flush(); });
  // Retry failed writes without losing the most recent snapshot.
  setInterval(() => { if (failed) flush(); }, 5000);
  current();
  persist();
  async function flushRequired() {
    await flush();
    if (pending) throw new Error('Draft backup is pending. Please retry after the database is available.');
  }
  return { state, current, persist, flush, flushRequired };
}
