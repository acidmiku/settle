function getAppWindow() {
  const t = window.__TAURI__;
  if (!t) return null;

  // Tauri v2 (withGlobalTauri) typically exposes a `window` namespace.
  if (t.window?.getCurrentWindow) {
    try {
      return t.window.getCurrentWindow();
    } catch {
      // ignore
    }
  }

  // Tauri v1 style global (common fallback).
  if (t.window?.appWindow) return t.window.appWindow;
  if (t.appWindow) return t.appWindow;

  return null;
}

export function initWindowChrome() {
  const appWindow = getAppWindow();
  const root = document.documentElement;
  root.classList.toggle("has-custom-chrome", !!appWindow);

  const byId = (id) => document.getElementById(id);
  const btnMin = byId("win-min");
  const btnMax = byId("win-max");
  const btnClose = byId("win-close");

  if (!appWindow) {
    // Running in a browser / without Tauri window APIs; hide controls gracefully.
    [btnMin, btnMax, btnClose].forEach((b) => b && (b.style.display = "none"));
    return;
  }

  btnMin?.addEventListener("click", async () => {
    try {
      await appWindow.minimize();
    } catch {
      // ignore
    }
  });

  btnMax?.addEventListener("click", async () => {
    try {
      if (appWindow.toggleMaximize) {
        await appWindow.toggleMaximize();
      } else {
        const isMax = (await appWindow.isMaximized?.()) ?? false;
        if (isMax && appWindow.unmaximize) await appWindow.unmaximize();
        else await appWindow.maximize();
      }
    } catch {
      // ignore
    }
  });

  btnClose?.addEventListener("click", async () => {
    try {
      await appWindow.close();
    } catch {
      // ignore
    }
  });

  // Titlebar interactions:
  // - Double click to toggle maximize.
  //
  // IMPORTANT (macOS): Avoid implementing custom `startDragging()` logic.
  // On macOS/WebKit this can make the whole UI feel unclickable/unfocusable
  // (clicks interpreted as drags). We rely on Tauri's built-in
  // `data-tauri-drag-region` handling instead.
  const dragZone = document.querySelector("[data-role='titlebar-drag']");
  const isInteractive = (t) => t?.closest?.("button,a,input,textarea,select,summary,details,[role='button']");

  dragZone?.addEventListener("dblclick", async (e) => {
    try {
      if (e.button !== 0) return;
      if (isInteractive(e.target)) return;
      if (appWindow.toggleMaximize) {
        await appWindow.toggleMaximize();
      } else {
        const isMax = (await appWindow.isMaximized?.()) ?? false;
        if (isMax && appWindow.unmaximize) await appWindow.unmaximize();
        else await appWindow.maximize();
      }
    } catch {
      // ignore
    }
  });

  // Keep maximize button state in sync if available
  const syncMaxState = async () => {
    try {
      const isMax = (await appWindow.isMaximized?.()) ?? false;
      btnMax?.classList.toggle("is-max", isMax);
    } catch {
      // ignore
    }
  };
  syncMaxState();
  appWindow.onResized?.(() => syncMaxState());
}

