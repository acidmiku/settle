import { invoke } from "./api.js";

export function attachEditor(textarea, { onSave, onAfterSave, onSidebarNavigate }) {
  if (!textarea) throw new Error("textarea missing");

  const autosize = () => {
    textarea.style.height = "auto";
    const max = 170; // ~6 lines
    textarea.style.height = Math.min(textarea.scrollHeight, max) + "px";
  };
  textarea.addEventListener("input", autosize);
  autosize();

  textarea.addEventListener("keydown", async (e) => {
    const isMod = e.ctrlKey || e.metaKey;
    const saveMode = document.documentElement?.dataset?.saveMode || "shift_enter";

    // Cmd/Ctrl+Enter => copy & clear
    if (e.key === "Enter" && isMod) {
      e.preventDefault();
      const text = textarea.value;
      if (text.trim().length > 0) {
        await invoke("copy_to_clipboard", { text });
      }
      textarea.value = "";
      autosize();
      return;
    }

    // Save behavior:
    // - default: Shift+Enter saves
    // - toggled: Enter saves, Shift+Enter inserts newline
    const shouldSave =
      e.key === "Enter" &&
      (saveMode === "enter" ? !e.shiftKey : e.shiftKey);

    if (shouldSave) {
      e.preventDefault();
      await onSave();
      autosize();
      if (onAfterSave) onAfterSave();
      return;
    }

    // Escape => hide
    if (e.key === "Escape") {
      e.preventDefault();
      await invoke("hide_main_window");
      return;
    }

    // Sidebar navigation when input empty
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && textarea.value.trim() === "") {
      if (onSidebarNavigate) {
        e.preventDefault();
        onSidebarNavigate(e.key === "ArrowDown" ? 1 : -1);
      }
    }
  });
}

