import { invoke } from "./api.js";
import { debounce } from "./utils.js";
import { toast } from "./toast.js";

export function createSearchController({ modalEl, inputEl, resultsEl, onJumpNote, onJumpCategoryEntry }) {
  let results = [];
  let activeIdx = 0;

  const doSearch = debounce(async () => {
    const q = inputEl.value.trim();
    if (!q) {
      results = [];
      render();
      return;
    }
    try {
      results = await invoke("search", { query: q, limit: 50 });
      activeIdx = 0;
      render();
    } catch (e) {
      toast(`Search failed: ${String(e)}`, { kind: "error" });
    }
  }, 120);

  function open() {
    modalEl.classList.add("is-open");
    modalEl.setAttribute("aria-hidden", "false");
    inputEl.value = "";
    results = [];
    render();
    setTimeout(() => inputEl.focus(), 0);
  }

  function close() {
    modalEl.classList.remove("is-open");
    modalEl.setAttribute("aria-hidden", "true");
  }

  function render() {
    resultsEl.innerHTML = "";
    if (!results.length) {
      resultsEl.innerHTML = `<div class="result"><div class="result__meta muted">No results</div></div>`;
      return;
    }
    results.forEach((r, idx) => {
      const el = document.createElement("div");
      el.className = `result ${idx === activeIdx ? "is-active" : ""}`;
      el.dataset.idx = String(idx);
      const kind = r.kind === "note" ? "Raw note" : "Second brain";
      el.innerHTML = `
        <div class="result__meta">${kind} · ${r.local_date}</div>
        <div class="result__text">${safeSnippet(r.snippet || "")}</div>
      `;
      el.addEventListener("click", () => jump(idx));
      resultsEl.appendChild(el);
    });
  }

  function jump(idx) {
    const r = results[idx];
    if (!r) return;
    close();
    if (r.kind === "note") {
      onJumpNote?.(r.id, r.local_date);
      return;
    }
    if (r.kind === "category_entry") {
      if (!r.category_id) return;
      onJumpCategoryEntry?.(r.category_id, r.id);
      return;
    }
  }

  inputEl.addEventListener("input", doSearch);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(results.length - 1, activeIdx + 1);
      render();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      render();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      jump(activeIdx);
    }
  });

  modalEl.addEventListener("click", (e) => {
    const t = e.target;
    const closeBtn = t?.closest?.('[data-close="search"]');
    if (closeBtn) close();
  });

  return { open, close };
}

function safeSnippet(htmlish) {
  // Only allow <mark> tags produced by SQLite snippet(). Everything else is escaped.
  const s = String(htmlish);
  const OPEN = "__MARK_OPEN__";
  const CLOSE = "__MARK_CLOSE__";
  const tmp = s.replaceAll("<mark>", OPEN).replaceAll("</mark>", CLOSE);
  const escaped = tmp
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped.replaceAll(OPEN, "<mark>").replaceAll(CLOSE, "</mark>");
}

