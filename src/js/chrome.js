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
  // - Drag only after the pointer moves a few pixels (prevents "restore on click").
  // Note: `startDragging()` is more reliable when initiated from pointer events
  // tied to the drag region element itself.
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

  let dragArmed = false;
  let dragStarted = false;
  let startX = 0;
  let startY = 0;
  let pointerId = null;

  const disarm = () => {
    dragArmed = false;
    dragStarted = false;
    pointerId = null;
  };

  dragZone?.addEventListener("pointerdown", (e) => {
    // left click only (mouse). For touch/stylus, rely on default OS behavior.
    if (e.pointerType !== "mouse") return;
    if (e.button !== 0) return;
    if (isInteractive(e.target)) return;
    dragArmed = true;
    dragStarted = false;
    startX = e.clientX;
    startY = e.clientY;
    pointerId = e.pointerId;
    try {
      dragZone.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
  });

  // Use window-level move/up so we don't lose events when leaving the dragZone.
  window.addEventListener("pointermove", async (e) => {
    try {
      if (!dragArmed || dragStarted) return;
      if (e.pointerType !== "mouse") return;
      if (pointerId != null && e.pointerId !== pointerId) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx + dy < 6) return; // small threshold to avoid restoring on click
      if (!appWindow.startDragging) return;
      dragStarted = true;
      await appWindow.startDragging();
    } catch {
      // ignore
    } finally {
      // If startDragging fails or ends, don't keep it armed.
      disarm();
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (pointerId != null && e.pointerId !== pointerId) return;
    disarm();
  });
  window.addEventListener("pointercancel", (e) => {
    if (pointerId != null && e.pointerId !== pointerId) return;
    disarm();
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

