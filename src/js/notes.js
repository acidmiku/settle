import { invoke } from "./api.js";
import { renderBasicMarkdown, todayLocalDate } from "./utils.js";
import { toast } from "./toast.js";
import { confirmDialog } from "./confirm.js";

export function createNotesController({
  datesListEl,
  notesListEl,
  titleEl,
  summarizeBtn,
  inputEl,
  onJumpToBrain,
}) {
  let dates = [];
  let selectedDate = todayLocalDate();
  let selectedIdx = 0;
  let editingNoteId = null;
  const defaultPlaceholder = inputEl?.getAttribute?.("placeholder") || "";

  async function refreshDates({ keepSelection = true } = {}) {
    const data = await invoke("list_dates", { limit: 365 });
    dates = data;

    if (!keepSelection) {
      selectedDate = todayLocalDate();
    } else if (!dates.some((d) => d.local_date === selectedDate)) {
      selectedDate = todayLocalDate();
    }

    // Ensure today exists in list even if 0 notes (pinned).
    const today = todayLocalDate();
    const hasToday = dates.some((d) => d.local_date === today);
    const todayItem = hasToday ? dates.find((d) => d.local_date === today) : null;
    const pinned = {
      local_date: today,
      note_count: todayItem ? todayItem.note_count : 0,
      has_summary: todayItem ? todayItem.has_summary : false,
      has_unsummarized: todayItem ? todayItem.has_unsummarized : false,
    };
    dates = [pinned, ...dates.filter((d) => d.local_date !== today)];

    renderDates();
    await selectDate(selectedDate, { focusInput: false, scrollToBottom: false });
  }

  function renderDates() {
    datesListEl.innerHTML = "";
    dates.forEach((d, idx) => {
      const item = document.createElement("div");
      item.className = `item ${d.local_date === selectedDate ? "is-active" : ""}`;
      item.dataset.date = d.local_date;
      item.tabIndex = -1;

      const left = document.createElement("div");
      left.innerHTML = `<div>${d.local_date}</div><div class="item__meta">${d.note_count} notes</div>`;
      const right = document.createElement("div");
      const pill = document.createElement("span");
      pill.className = `pill ${d.local_date === todayLocalDate() ? "is-accent" : ""}`;
      pill.textContent = d.has_summary ? (d.has_unsummarized ? "●" : "✓") : "";
      right.appendChild(pill);

      item.appendChild(left);
      item.appendChild(right);

      item.addEventListener("click", async () => {
        await selectDate(d.local_date, { focusInput: true });
      });

      datesListEl.appendChild(item);

      if (d.local_date === selectedDate) {
        selectedIdx = idx;
      }
    });
  }

  async function selectDate(date, { focusInput = true, scrollToBottom = false } = {}) {
    // Switching dates should never keep an "edit" armed.
    clearEditing();
    selectedDate = date;
    titleEl.textContent = date === todayLocalDate() ? "Today" : date;
    renderDates();

    const notes = await invoke("list_notes_for_date", { localDate: date });
    renderNotes(notes);

    const dateInfo = dates.find((d) => d.local_date === date);
    const isToday = date === todayLocalDate();
    const hasNotes = notes.length > 0;
    const hasUnsummarized = dateInfo ? !!dateInfo.has_unsummarized : true;
    summarizeBtn.style.display = isToday && hasNotes && hasUnsummarized ? "inline-flex" : "none";

    if (scrollToBottom) {
      notesListEl.scrollTop = notesListEl.scrollHeight;
    }
    if (focusInput && inputEl) inputEl.focus();
  }

  function setEditing(note) {
    if (!inputEl) return;
    editingNoteId = note?.id || null;
    inputEl.dataset.editing = editingNoteId || "";
    inputEl.value = note?.content || "";
    inputEl.setAttribute("placeholder", "Editing note… (Shift+Enter to update)");
    // Trigger autosize (editor.js listens to input).
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.focus();
    toast("Editing in input ↓");
  }

  function clearEditing() {
    if (!inputEl) return;
    editingNoteId = null;
    delete inputEl.dataset.editing;
    inputEl.setAttribute("placeholder", defaultPlaceholder);
  }

  function renderNotes(notes) {
    notesListEl.innerHTML = "";
    for (const n of notes) {
      const el = document.createElement("div");
      el.className = "note";
      el.dataset.noteId = n.id;

      const time = n.local_time?.slice?.(0, 5) || "—";
      const actions = document.createElement("div");
      actions.className = "note__actions";

      const btnCopy = mkAction("Copy", async () => {
        await invoke("copy_to_clipboard", { text: n.content });
        toast("Copied");
      });
      const btnEdit = mkAction("Edit", async () => {
        setEditing(n);
      });
      const btnDel = mkAction("Delete", async () => {
        const ok = await confirmDialog({
          title: "Delete note",
          message: "Delete this note?",
          confirmText: "Delete",
          cancelText: "Cancel",
          danger: true,
        });
        if (!ok) return;
        try {
          await invoke("delete_note", { noteId: n.id });
          await refreshDates({ keepSelection: true });
          toast("Deleted");
        } catch (e) {
          toast(String(e), { kind: "error" });
        }
      });

      actions.append(btnCopy, btnEdit, btnDel);

      el.innerHTML = `
        <div class="note__row">
          <div class="note__time">${time}</div>
        </div>
        <div class="note__content"></div>
        <div class="note__tags"></div>
      `;
      el.querySelector(".note__row").appendChild(actions);

      const contentEl = el.querySelector(".note__content");
      contentEl.innerHTML = renderBasicMarkdown(n.content);

      const tagsEl = el.querySelector(".note__tags");
      if (Array.isArray(n.tags)) {
        for (const t of n.tags) {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = `#${t}`;
          tagsEl.appendChild(tag);
        }
      }

      notesListEl.appendChild(el);
    }
  }

  function mkAction(label, onClick) {
    const b = document.createElement("button");
    b.className = "btn btn-ghost";
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  async function saveNoteFromInput() {
    const text = inputEl.value;
    if (text.trim() === "") return;

    try {
      if (editingNoteId) {
        const noteId = editingNoteId;
        await invoke("update_note", { noteId, content: text });
        inputEl.value = "";
        clearEditing();
        toast("Updated");
        await refreshDates({ keepSelection: true });
        await selectDate(selectedDate, { focusInput: true, scrollToBottom: true });
        flashNote(noteId);
      } else {
        const created = await invoke("create_note", { content: text });
        inputEl.value = "";
        toast("Saved");

        await refreshDates({ keepSelection: true });
        await selectDate(created.local_date, { focusInput: true, scrollToBottom: true });

        flashNote(created.id);
      }
    } catch (e) {
      toast(`Save failed: ${String(e)}`, { kind: "error" });
      // keep input intact on error (data integrity requirement)
    }
  }

  function flashNote(noteId) {
    const el = notesListEl.querySelector(`[data-note-id="${CSS.escape(noteId)}"]`);
    if (!el) return;
    el.classList.add("is-flash");
    window.setTimeout(() => el.classList.remove("is-flash"), 650);
  }

  async function summarizeSelectedDate() {
    summarizeBtn.disabled = true;
    const old = summarizeBtn.textContent;
    summarizeBtn.textContent = "Summarizing…";
    try {
      const res = await invoke("summarize_day", { localDate: selectedDate });
      if (res.status === "nothing_to_do") {
        toast("Nothing to summarize");
      } else if (res.mode === "auto" && res.status === "saved") {
        toast("Day summarized ✓");
        await refreshDates({ keepSelection: true });
        if (onJumpToBrain) onJumpToBrain();
      } else if (res.mode === "suggest" && res.status === "preview") {
        // handled by app.js
        return res.preview;
      }
    } catch (e) {
      toast(`Summarize failed: ${String(e)}`, { kind: "error" });
    } finally {
      summarizeBtn.disabled = false;
      summarizeBtn.textContent = old;
    }
    return null;
  }

  function sidebarNavigate(delta) {
    if (!dates.length) return;
    selectedIdx = Math.max(0, Math.min(dates.length - 1, selectedIdx + delta));
    const next = dates[selectedIdx];
    if (next) selectDate(next.local_date, { focusInput: true });
  }

  async function jumpToNoteById(noteId, localDate) {
    await selectDate(localDate, { focusInput: true });
    const el = notesListEl.querySelector(`[data-note-id="${CSS.escape(noteId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("is-flash");
      window.setTimeout(() => el.classList.remove("is-flash"), 650);
    }
  }

  return {
    refreshDates,
    selectDate,
    saveNoteFromInput,
    summarizeSelectedDate,
    sidebarNavigate,
    jumpToNoteById,
    getSelectedDate: () => selectedDate,
  };
}

