import { listen, invoke } from "./api.js";
import { attachEditor } from "./editor.js";
import { createNotesController } from "./notes.js";
import { createBrainController } from "./brain.js";
import { createSearchController } from "./search.js";
import { createSettingsController } from "./settings.js";
import { toast } from "./toast.js";
import { todayLocalDate } from "./utils.js";
import { initWindowChrome } from "./chrome.js";
import { createConfirmController } from "./confirm.js";

const el = (id) => document.getElementById(id);

const tabNotes = el("tab-notes");
const tabBrain = el("tab-brain");
const panelNotes = el("panel-notes");
const panelBrain = el("panel-brain");
const sidebarNotes = el("sidebar-notes");
const sidebarBrain = el("sidebar-brain");

const datesListEl = el("dates-list");
const notesListEl = el("notes-list");
const notesTitleEl = el("notes-title");
const summarizeBtn = el("btn-summarize");
const inputEl = el("note-input");
const statusTextEl = el("status-text");
const llmDotEl = el("llm-dot");

const catsListEl = el("cats-list");
const brainTitleEl = el("brain-title");
const brainContentEl = el("brain-content");
const catSearchEl = el("cat-search");

const btnSearch = el("btn-search");
const btnSettings = el("btn-settings");

// shared confirm modal (used by notes/brain via window for now)
const confirmCtl = createConfirmController();
window.__SETTLE_CONFIRM__ = confirmCtl;

// Modals
const searchModal = el("search-modal");
const searchInput = el("search-input");
const searchResults = el("search-results");
const settingsModal = el("settings-modal");
const reviewModal = el("review-modal");

// Settings elements
const settings = createSettingsController({
  modalEl: settingsModal,
  btnOpen: btnSettings,
  baseUrlEl: el("set-base-url"),
  apiKeyEl: el("set-api-key"),
  modelEl: el("set-model"),
  hotkeyEl: el("set-hotkey"),
  modeEl: el("set-mode"),
  themeEl: el("set-theme"),
  btnTestConn: el("btn-test-conn"),
  connStatusEl: el("conn-status"),
  btnToggleKey: el("toggle-api-key"),
  dbInfoEl: el("db-info"),
  btnExportJson: el("btn-export-json"),
  btnExportMd: el("btn-export-md"),
  exportStatusEl: el("export-status"),
  onConnectionTestResult: ({ ok, error }) => {
    setLlmStatus(ok ? "ok" : "bad", error);
  },
  enterSaveEl: el("set-enter-save"),
});

let activeTab = "notes"; // "notes" | "brain"

const brain = createBrainController({
  catsListEl,
  brainTitleEl,
  brainContentEl,
  catSearchEl,
  onJumpToDay: async (date) => {
    switchTab("notes");
    await notes.selectDate(date, { focusInput: true });
  },
  onJumpToNote: async (noteId, date) => {
    switchTab("notes");
    await notes.jumpToNoteById(noteId, date);
  },
});

const notes = createNotesController({
  datesListEl,
  notesListEl,
  titleEl: notesTitleEl,
  summarizeBtn,
  inputEl,
  onJumpToBrain: async () => {
    switchTab("brain");
    await brain.refreshCategories();
    await brain.selectAll();
  },
});

const search = createSearchController({
  modalEl: searchModal,
  inputEl: searchInput,
  resultsEl: searchResults,
  onJumpNote: async (noteId, date) => {
    switchTab("notes");
    await notes.jumpToNoteById(noteId, date);
  },
  onJumpCategoryEntry: async (categoryId, entryId) => {
    switchTab("brain");
    await brain.refreshCategories();
    await brain.jumpToEntry(categoryId, entryId);
  },
});

function switchTab(tab) {
  activeTab = tab;
  const isNotes = tab === "notes";
  tabNotes.classList.toggle("is-active", isNotes);
  tabBrain.classList.toggle("is-active", !isNotes);
  panelNotes.classList.toggle("is-active", isNotes);
  panelBrain.classList.toggle("is-active", !isNotes);
  sidebarNotes.classList.toggle("is-active", isNotes);
  sidebarBrain.classList.toggle("is-active", !isNotes);

  if (isNotes) inputEl.focus();
}

tabNotes.addEventListener("click", () => switchTab("notes"));
tabBrain.addEventListener("click", async () => {
  switchTab("brain");
  await brain.refreshCategories();
  await brain.selectAll();
});

btnSearch.addEventListener("click", () => search.open());
btnSettings.addEventListener("click", () => settings.open());

summarizeBtn.addEventListener("click", async () => {
  const preview = await notes.summarizeSelectedDate();
  if (preview) openReview(preview);
});

attachEditor(inputEl, {
  onSave: notes.saveNoteFromInput,
  onSidebarNavigate: (delta) => {
    if (activeTab === "notes") notes.sidebarNavigate(delta);
    else brain.sidebarNavigate(delta);
  },
});

// Global keyboard shortcuts
window.addEventListener("keydown", async (e) => {
  const isMod = e.ctrlKey || e.metaKey;

  if (e.key === "Escape") {
    // Close modals first
    if (searchModal.classList.contains("is-open")) {
      e.preventDefault();
      search.close();
      return;
    }
    if (settingsModal.classList.contains("is-open")) {
      e.preventDefault();
      settings.close();
      return;
    }
    if (reviewModal.classList.contains("is-open")) {
      e.preventDefault();
      closeReview();
      return;
    }
  }

  if (!isMod) return;

  if (e.key === "1") {
    e.preventDefault();
    switchTab("notes");
    return;
  }
  if (e.key === "2") {
    e.preventDefault();
    switchTab("brain");
    await brain.refreshCategories();
    await brain.selectAll();
    return;
  }
  if (e.key.toLowerCase() === "k") {
    e.preventDefault();
    search.open();
    return;
  }
  if (e.key === ",") {
    e.preventDefault();
    settings.open();
    return;
  }
  if (e.key.toLowerCase() === "e") {
    e.preventDefault();
    const preview = await notes.summarizeSelectedDate();
    if (preview) openReview(preview);
    return;
  }
});

// Focus input on hotkey show
listen("settle:focus-input", async () => {
  switchTab("notes");
  await notes.selectDate(todayLocalDate(), { focusInput: true, scrollToBottom: true });
  inputEl.focus();
});

// Review modal (suggest mode)
let pendingReview = null;

function openReview(preview) {
  pendingReview = preview;
  el("review-title").value = preview.response.title || "";
  el("review-summary").value = preview.response.summary || "";
  renderReviewCats(preview);
  reviewModal.classList.add("is-open");
  reviewModal.setAttribute("aria-hidden", "false");
}

function closeReview() {
  reviewModal.classList.remove("is-open");
  reviewModal.setAttribute("aria-hidden", "true");
  pendingReview = null;
}

function renderReviewCats(preview) {
  const host = el("review-cats");
  host.innerHTML = "";
  preview.response.categories.forEach((c, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "review-cat";
    wrap.dataset.idx = String(idx);
    wrap.innerHTML = `
      <div class="review-cat__head">
        <input class="input" data-role="cat-name" type="text" value="${escapeAttr(c.category_name)}" />
        <span class="pill ${c.is_new_category ? "is-accent" : ""}">${c.is_new_category ? "new" : ""}</span>
      </div>
      <div class="review-cat__entries"></div>
    `;
    const entriesHost = wrap.querySelector(".review-cat__entries");
    c.entries.forEach((e, eIdx) => {
      const entry = document.createElement("div");
      entry.className = "review-entry";
      entry.innerHTML = `
        <div class="muted small" style="margin-bottom:6px;">${e.source_time}</div>
        <textarea class="textarea textarea--small" rows="3" data-role="entry" data-eidx="${eIdx}">${e.content}</textarea>
      `;
      entriesHost.appendChild(entry);
    });
    host.appendChild(wrap);
  });
}

el("btn-cancel-review").addEventListener("click", () => closeReview());
reviewModal.addEventListener("click", (e) => {
  const t = e.target;
  const closeBtn = t?.closest?.('[data-close="review"]');
  if (closeBtn) closeReview();
});

el("btn-approve").addEventListener("click", async () => {
  if (!pendingReview) return;
  const localDate = notes.getSelectedDate();

  // Apply edits from UI into preview structure
  const title = el("review-title").value.trim();
  const summary = el("review-summary").value.trim();
  pendingReview.response.title = title || pendingReview.response.title;
  pendingReview.response.summary = summary || pendingReview.response.summary;

  const catNodes = Array.from(el("review-cats").querySelectorAll(".review-cat"));
  catNodes.forEach((node, idx) => {
    const nameEl = node.querySelector('[data-role="cat-name"]');
    pendingReview.response.categories[idx].category_name = nameEl.value.trim() || pendingReview.response.categories[idx].category_name;
    const entryEls = Array.from(node.querySelectorAll('textarea[data-role="entry"]'));
    entryEls.forEach((ta) => {
      const eIdx = Number(ta.dataset.eidx);
      pendingReview.response.categories[idx].entries[eIdx].content = ta.value;
    });
  });

  try {
    const saved = await invoke("apply_summarize_preview", { localDate, preview: pendingReview });
    toast("Day summarized ✓");
    closeReview();
    await notes.refreshDates({ keepSelection: true });
    switchTab("brain");
    await brain.refreshCategories();
    await brain.selectAll();
    statusTextEl.textContent = `Last summary: ${saved.source_date}`;
  } catch (e) {
    toast(`Save failed: ${String(e)}`, { kind: "error" });
  }
});

function escapeAttr(s) {
  return String(s || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Boot
(async () => {
  try {
    initWindowChrome();
    await settings.load();
    await notes.refreshDates({ keepSelection: false });
    statusTextEl.textContent = "Ready";
    switchTab("notes");
    inputEl.focus();

    // Background LLM health check (updates status dot only).
    setLlmStatus("unknown");
    checkLlmHealth();

    // Reflect save mode hints/placeholder
    applySaveModeUI();
  } catch (e) {
    toast(`Init failed: ${String(e)}`, { kind: "error" });
  }
})();

window.addEventListener("settle:save-mode-changed", () => {
  applySaveModeUI();
});

function applySaveModeUI() {
  const mode = document.documentElement.dataset.saveMode || "shift_enter";
  if (inputEl) {
    // Don't override "editing" placeholder.
    if (!inputEl.dataset.editing) {
    const base = "Type a note... ";
    inputEl.setAttribute(
      "placeholder",
      mode === "enter" ? `${base}(Enter to save)` : `${base}(Shift+Enter to save)`
    );
    }
  }

  const keysEl = document.querySelector('[data-role="hint-save-keys"]');
  if (keysEl) {
    keysEl.innerHTML =
      mode === "enter"
        ? `<span class="key">⏎</span>`
        : `<span class="key">⇧</span><span class="key">⏎</span>`;
  }
}

function setLlmStatus(kind, details) {
  if (!llmDotEl) return;
  llmDotEl.classList.remove("is-ok", "is-bad", "is-unknown");
  if (kind === "ok") {
    llmDotEl.classList.add("is-ok");
    llmDotEl.title = "LLM: connected";
    return;
  }
  if (kind === "bad") {
    llmDotEl.classList.add("is-bad");
    llmDotEl.title = `LLM: failed${details ? ` (${details})` : ""}`;
    return;
  }
  llmDotEl.classList.add("is-unknown");
  llmDotEl.title = "LLM: checking…";
}

async function checkLlmHealth() {
  try {
    setLlmStatus("unknown");
    await invoke("test_llm_connection");
    setLlmStatus("ok");
  } catch (e) {
    setLlmStatus("bad", String(e));
  }
}

