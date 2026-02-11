import { invoke } from "./api.js";
import { renderBasicMarkdown } from "./utils.js";
import { toast } from "./toast.js";
import { confirmDialog } from "./confirm.js";

export function createBrainController({ catsListEl, brainTitleEl, brainContentEl, catSearchEl, onJumpToDay, onJumpToNote }) {
  let categories = [];
  let filtered = [];
  let selected = { kind: "all", id: null, name: "All" };
  let selectedIdx = 0;
  let summariesForAll = [];
  const summaryIndexByDate = new Map(); // date -> summary card element
  const categoryIndexByKey = new Map(); // `${date}||${catName}` -> category block element
  const openDayGroups = new Set(); // dates expanded in sidebar when in "All" mode

  async function refreshCategories() {
    categories = await invoke("list_categories");
    applyFilter();
    renderSidebar();
    await selectItem(selected.kind, selected.id, { keep: true });
  }

  function applyFilter() {
    const q = (catSearchEl?.value || "").trim().toLowerCase();
    filtered = categories.filter((c) => c.name.toLowerCase().includes(q));
  }

  function renderSidebar() {
    catsListEl.innerHTML = "";

    // When "All" is selected, sidebar becomes a day index (grouped by summary date).
    const pane = catsListEl.closest(".sidebar__pane");
    const titleEl = pane?.querySelector?.(".sidebar__title");
    const searchWrap = pane?.querySelector?.(".sidebar__search");

    if (selected.kind === "all") {
      if (titleEl) titleEl.textContent = "Days";
      if (searchWrap) searchWrap.style.display = "none";

      const items = Array.isArray(summariesForAll) ? summariesForAll : [];
      items.forEach((s, idx) => {
        const date = String(s?.source_date || "");
        const cats = Array.isArray(s?.structured_data?.categories) ? s.structured_data.categories : [];

        const group = document.createElement("details");
        group.className = "day-group";
        group.open = openDayGroups.has(date) || idx === selectedIdx;
        group.addEventListener("toggle", () => {
          if (group.open) openDayGroups.add(date);
          else openDayGroups.delete(date);
        });

        const summary = document.createElement("summary");
        summary.className = `item day-item ${idx === selectedIdx ? "is-active" : ""}`;
        summary.tabIndex = -1;
        summary.innerHTML = `
          <div>
            <div>${date}</div>
            <div class="item__meta">${cats.length} categories</div>
          </div>
          <div class="item__right"><span class="pill">${cats.length}</span></div>
        `;
        summary.addEventListener("click", () => {
          selectedIdx = idx;
          const el = summaryIndexByDate.get(date);
          el?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        });
        group.appendChild(summary);

        const children = document.createElement("div");
        children.className = "day-group__children";

        // Child categories (indented)
        for (const c of cats) {
          const name = String(c?.category_name || "Category");
          const entries = Array.isArray(c?.entries) ? c.entries : [];
          const child = document.createElement("div");
          child.className = "item item--sub";
          child.tabIndex = -1;
          child.innerHTML = `
            <div>
              <div class="item__name">${escapeHtml(name)}</div>
              <div class="item__meta">${entries.length} entries</div>
            </div>
            <div class="item__right"><span class="pill">${entries.length}</span></div>
          `;
          child.addEventListener("click", () => {
            openDayGroups.add(date);
            group.open = true;
            selectedIdx = idx;
            const key = `${date}||${name}`;
            const el = categoryIndexByKey.get(key);
            if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
            else summaryIndexByDate.get(date)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
          });
          children.appendChild(child);
        }

        group.appendChild(children);
        catsListEl.appendChild(group);
      });

      return;
    }

    // Category mode
    if (titleEl) titleEl.textContent = "Categories";
    if (searchWrap) searchWrap.style.display = "";

    const allItem = renderItem({ id: "all", name: "All", entry_count: null }, selected.kind === "all");
    allItem.addEventListener("click", () => selectItem("all", null));
    catsListEl.appendChild(allItem);

    filtered.forEach((c, idx) => {
      const el = renderItem(c, selected.kind === "cat" && selected.id === c.id);
      el.addEventListener("click", () => selectItem("cat", c.id));
      catsListEl.appendChild(el);
      if (selected.kind === "cat" && selected.id === c.id) {
        selectedIdx = idx + 1; // + All
      }
    });
  }

  function renderItem(c, isActive) {
    const el = document.createElement("div");
    el.className = `item ${isActive ? "is-active" : ""}`;
    el.tabIndex = -1;
    const count = typeof c.entry_count === "number" ? `${c.entry_count}` : "";
    el.innerHTML = `
      <div>
        <div>${c.name}</div>
        ${count ? `<div class="item__meta">${count} entries</div>` : `<div class="item__meta">Summaries</div>`}
      </div>
      <div class="item__right">
        ${count ? `<span class="pill">${count}</span>` : `<span class="pill"></span>`}
        ${
          typeof c.entry_count === "number" && c.id !== "all"
            ? `<button class="item__btn" type="button" data-action="delete" title="Delete category" aria-label="Delete category">DEL</button>`
            : ""
        }
      </div>
    `;

    // Delete category from sidebar (no cascade FK; backend deletes entries first).
    if (typeof c.entry_count === "number" && c.id !== "all") {
      const del = el.querySelector('[data-action="delete"]');
      del?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog({
          title: "Delete category",
          message: `Delete category "${c.name}" and all its entries?`,
          confirmText: "Delete",
          cancelText: "Cancel",
          danger: true,
        });
        if (!ok) return;
        try {
          await invoke("delete_category", { categoryId: c.id });
          toast("Category deleted");
          selected = { kind: "all", id: null, name: "All" };
          await refreshCategories();
          await selectItem("all", null);
        } catch (err) {
          toast(`Delete failed: ${String(err)}`, { kind: "error" });
        }
      });
    }
    return el;
  }

  async function selectItem(kind, id, { keep = false } = {}) {
    if (!keep) selected = kind === "all" ? { kind: "all", id: null, name: "All" } : { kind: "cat", id, name: "" };
    renderSidebar();

    if (kind === "all") {
      brainTitleEl.textContent = "All";
      const summaries = await invoke("list_summaries_timeline", { limit: 365 });
      summariesForAll = summaries;
      renderSummaries(summaries);
      renderSidebar();
      return;
    }

    const cat = categories.find((c) => c.id === id);
    brainTitleEl.textContent = cat ? cat.name : "Category";
    const entries = await invoke("list_category_entries", { categoryId: id });
    renderEntries(entries);
  }

  function renderSummaries(summaries) {
    brainContentEl.innerHTML = "";
    summaryIndexByDate.clear();
    categoryIndexByKey.clear();
    if (!summaries.length) {
      brainContentEl.innerHTML = `<div class="muted">No summaries yet. Summarize a day to start building your second brain.</div>`;
      return;
    }
    for (const s of summaries) {
      const card = document.createElement("div");
      card.className = "summary-card";
      const cats = Array.isArray(s.structured_data?.categories) ? s.structured_data.categories : [];
      const dateKey = String(s.source_date || "");
      card.innerHTML = `
        <div class="summary-card__meta">${s.source_date} · ${s.model_used || ""}</div>
        <div class="summary-card__title">${escapeHtml(s.title)}</div>
        <div class="summary-card__body">${renderBasicMarkdown(s.summary)}</div>
        ${
          cats.length
            ? `<details class="summary-cats" style="margin-top:10px;" open>
                <summary class="muted small">Categories (${cats.length})</summary>
                <div class="summary-cats__grid"></div>
              </details>`
            : ""
        }
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-ghost" data-action="open">Open day</button>
          <button class="btn btn-ghost" data-action="delete">Delete</button>
        </div>
      `;
      card.querySelector('[data-action="open"]').addEventListener("click", () => {
        if (onJumpToDay) onJumpToDay(s.source_date);
      });
      card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "Delete summary",
          message: `Delete the summary for ${s.source_date}?`,
          confirmText: "Delete",
          cancelText: "Cancel",
          danger: true,
        });
        if (!ok) return;
        try {
          await invoke("delete_summary", { summaryId: s.id });
          toast("Summary deleted");
          const next = await invoke("list_summaries_timeline", { limit: 365 });
          renderSummaries(next);
        } catch (e) {
          toast(`Delete failed: ${String(e)}`, { kind: "error" });
        }
      });

      if (cats.length) {
        const grid = card.querySelector(".summary-cats__grid");
        for (const c of cats) {
          const name = String(c?.category_name || "Category");
          const entries = Array.isArray(c?.entries) ? c.entries : [];

          const block = document.createElement("div");
          block.className = "summary-cat";
          block.innerHTML = `
            <div class="summary-cat__head">
              <div class="summary-cat__name">${escapeHtml(name)}</div>
              <div class="summary-cat__meta">
                ${c?.is_new_category ? `<span class="pill is-accent">new</span>` : `<span class="pill"></span>`}
                <span class="pill">${entries.length}</span>
              </div>
            </div>
            <div class="summary-cat__entries"></div>
          `;

          const host = block.querySelector(".summary-cat__entries");
          for (const e of entries) {
            const time = String(e?.source_time || "—");
            const main = String(e?.content || "");
            const kps = Array.isArray(e?.key_points) ? e.key_points : [];
            const kpBlock = kps.length
              ? `<details style="margin-top:6px;">
                   <summary class="muted small">Key points</summary>
                   <div style="margin-top:6px;">${renderBasicMarkdown(kps.map((k) => `- ${String(k)}`).join("\n"))}</div>
                 </details>`
              : "";

            const row = document.createElement("div");
            row.className = "summary-entry";
            row.innerHTML = `
              <div class="summary-entry__time">${escapeHtml(time)}</div>
              <div class="summary-entry__body">${renderBasicMarkdown(main)}${kpBlock}</div>
            `;
            host.appendChild(row);
          }

          categoryIndexByKey.set(`${dateKey}||${name}`, block);
          grid.appendChild(block);
        }
      }

      summaryIndexByDate.set(dateKey, card);
      brainContentEl.appendChild(card);
    }
  }

  function renderEntries(entries) {
    brainContentEl.innerHTML = "";
    if (!entries.length) {
      brainContentEl.innerHTML = `<div class="muted">No entries in this category yet.</div>`;
      return;
    }

    // Group by date (newest first).
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.source_date)) groups.set(e.source_date, []);
      groups.get(e.source_date).push(e);
    }
    const dates = Array.from(groups.keys()).sort().reverse();

    for (const d of dates) {
      const header = document.createElement("div");
      header.className = "muted small";
      header.style.margin = "10px 0 6px";
      header.textContent = d;
      brainContentEl.appendChild(header);

      for (const e of groups.get(d)) {
        const card = document.createElement("div");
        card.className = "summary-card";
        card.dataset.entryId = e.id;

        const { main, keyPoints } = splitKeyPoints(e.content || "");
        card.innerHTML = `
          <div class="summary-card__meta">${e.source_date}</div>
          <div class="summary-card__body">${renderBasicMarkdown(main)}</div>
          ${
            keyPoints.length
              ? `<details style="margin-top:10px;"><summary class="muted small">Key points</summary><div style="margin-top:8px;">${renderBasicMarkdown(
                  keyPoints.map((k) => `- ${k}`).join("\n")
                )}</div></details>`
              : ""
          }
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            ${e.note_id ? `<button class="btn btn-ghost" data-action="note">Open raw note</button>` : ""}
            <button class="btn btn-ghost" data-action="day">Open day</button>
          </div>
        `;

        if (e.note_id) {
          card.querySelector('[data-action="note"]').addEventListener("click", () => {
            if (onJumpToNote) onJumpToNote(e.note_id, e.source_date);
          });
        }
        card.querySelector('[data-action="day"]').addEventListener("click", () => {
          if (onJumpToDay) onJumpToDay(e.source_date);
        });

        brainContentEl.appendChild(card);
      }
    }
  }

  function splitKeyPoints(content) {
    const marker = "\n\nKey points:\n";
    const idx = content.indexOf(marker);
    if (idx === -1) return { main: content, keyPoints: [] };
    const main = content.slice(0, idx).trimEnd();
    const rest = content.slice(idx + marker.length);
    const keyPoints = rest
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim())
      .filter(Boolean);
    return { main, keyPoints };
  }

  function escapeHtml(s) {
    return (s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function sidebarNavigate(delta) {
    if (selected.kind === "all") {
      const total = (summariesForAll?.length || 0);
      if (!total) return;
      selectedIdx = Math.max(0, Math.min(total - 1, selectedIdx + delta));
      renderSidebar();
      const date = summariesForAll[selectedIdx]?.source_date;
      if (date) summaryIndexByDate.get(String(date))?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      return;
    }

    const total = 1 + filtered.length; // All + categories
    selectedIdx = Math.max(0, Math.min(total - 1, selectedIdx + delta));
    if (selectedIdx === 0) selectItem("all", null);
    else {
      const cat = filtered[selectedIdx - 1];
      if (cat) selectItem("cat", cat.id);
    }
  }

  catSearchEl?.addEventListener("input", () => {
    applyFilter();
    renderSidebar();
  });

  return {
    refreshCategories,
    selectAll: () => selectItem("all", null),
    selectCategory: (id) => selectItem("cat", id),
    jumpToEntry: async (categoryId, entryId) => {
      await selectItem("cat", categoryId);
      const el = brainContentEl.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    sidebarNavigate,
  };
}

