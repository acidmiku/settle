import { invoke } from "./api.js";
import { toast } from "./toast.js";

export function createSettingsController({
  modalEl,
  btnOpen,
  baseUrlEl,
  apiKeyEl,
  modelEl,
  hotkeyEl,
  modeEl,
  themeEl,
  btnTestConn,
  connStatusEl,
  btnToggleKey,
  dbInfoEl,
  btnExportJson,
  btnExportMd,
  exportStatusEl,
  onConnectionTestResult,
  enterSaveEl,
}) {
  let settings = {};

  function open() {
    modalEl.classList.add("is-open");
    modalEl.setAttribute("aria-hidden", "false");
    setTimeout(() => baseUrlEl.focus(), 0);
  }

  function close() {
    modalEl.classList.remove("is-open");
    modalEl.setAttribute("aria-hidden", "true");
  }

  async function load() {
    settings = await invoke("get_settings");
    baseUrlEl.value = settings.api_base_url || "";
    apiKeyEl.value = settings.api_key || "";
    modelEl.value = settings.model_name || "";
    hotkeyEl.value = settings.global_hotkey || "";
    modeEl.value = settings.categorization_mode || "auto";
    const rawTheme = settings.theme || "system";
    const normalizedTheme =
      rawTheme === "dark"
        ? "terminal-dark-phosphor"
        : rawTheme === "light"
          ? "terminal-light-graphite"
          : rawTheme;
    themeEl.value = normalizedTheme;
    applyTheme(normalizedTheme);

    const saveMode = settings.save_key_mode || "shift_enter";
    applySaveMode(saveMode);
    if (enterSaveEl) {
      enterSaveEl.checked = saveMode === "enter";
    }

    const info = await invoke("get_db_info");
    dbInfoEl.textContent = `${info.path} (${prettyBytes(info.size_bytes)})`;
  }

  async function save(key, value) {
    settings[key] = value;
    try {
      await invoke("set_setting", { key, value: String(value) });
    } catch (e) {
      toast(`Failed to save setting: ${String(e)}`, { kind: "error" });
    }
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme && theme.startsWith("terminal-")) {
      root.dataset.theme = theme;
      return;
    }
    if (theme === "dark") {
      // Back-compat for older saved values.
      root.dataset.theme = "terminal-dark-phosphor";
      return;
    }
    if (theme === "light") {
      // Back-compat for older saved values.
      root.dataset.theme = "terminal-light-graphite";
      return;
    }

    // system (default)
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    root.dataset.theme = prefersDark ? "terminal-dark-phosphor" : "terminal-light-graphite";
  }

  function applySaveMode(mode) {
    const root = document.documentElement;
    const normalized = mode === "enter" ? "enter" : "shift_enter";
    root.dataset.saveMode = normalized;
    window.dispatchEvent(new CustomEvent("settle:save-mode-changed", { detail: { mode: normalized } }));
  }

  baseUrlEl.addEventListener("change", () => save("api_base_url", baseUrlEl.value.trim()));
  apiKeyEl.addEventListener("change", () => save("api_key", apiKeyEl.value));
  modelEl.addEventListener("change", () => save("model_name", modelEl.value.trim()));
  hotkeyEl.addEventListener("change", () => save("global_hotkey", hotkeyEl.value.trim()));
  modeEl.addEventListener("change", () => save("categorization_mode", modeEl.value));
  themeEl.addEventListener("change", () => {
    applyTheme(themeEl.value);
    save("theme", themeEl.value);
  });

  enterSaveEl?.addEventListener("change", () => {
    const mode = enterSaveEl.checked ? "enter" : "shift_enter";
    applySaveMode(mode);
    save("save_key_mode", mode);
  });

  btnTestConn.addEventListener("click", async () => {
    connStatusEl.textContent = "Testing…";
    try {
      await invoke("test_llm_connection");
      connStatusEl.textContent = "Connected ✓";
      toast("Connection OK");
      onConnectionTestResult?.({ ok: true });
    } catch (e) {
      connStatusEl.textContent = "Failed";
      toast(`Connection failed: ${String(e)}`, { kind: "error" });
      onConnectionTestResult?.({ ok: false, error: String(e) });
    }
  });

  btnToggleKey.addEventListener("click", () => {
    const isPw = apiKeyEl.getAttribute("type") === "password";
    apiKeyEl.setAttribute("type", isPw ? "text" : "password");
    btnToggleKey.textContent = isPw ? "Hide" : "Show";
  });

  btnExportJson.addEventListener("click", async () => {
    exportStatusEl.textContent = "Exporting JSON…";
    try {
      const res = await invoke("export_json");
      exportStatusEl.textContent = `Exported to ${res.export_dir}`;
      toast("Exported JSON");
    } catch (e) {
      exportStatusEl.textContent = "Export failed";
      toast(`Export failed: ${String(e)}`, { kind: "error" });
    }
  });

  btnExportMd.addEventListener("click", async () => {
    exportStatusEl.textContent = "Exporting Markdown…";
    try {
      const res = await invoke("export_markdown");
      exportStatusEl.textContent = `Exported to ${res.export_dir}`;
      toast("Exported Markdown");
    } catch (e) {
      exportStatusEl.textContent = "Export failed";
      toast(`Export failed: ${String(e)}`, { kind: "error" });
    }
  });

  modalEl.addEventListener("click", (e) => {
    const t = e.target;
    const closeBtn = t?.closest?.('[data-close="settings"]');
    if (closeBtn) close();
  });

  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if ((settings.theme || "system") === "system") applyTheme("system");
  });

  return { open, close, load, applyTheme };
}

function prettyBytes(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

