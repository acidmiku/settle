use std::str::FromStr;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const FOCUS_EVENT: &str = "settle:focus-input";

pub fn register_global_hotkey(app: &AppHandle, accelerator: &str) -> tauri::Result<()> {
  let accel = accelerator.trim();
  if accel.is_empty() {
    return Ok(());
  }

  // Best-effort: clear existing registrations, then register.
  let _ = app
    .global_shortcut()
    .unregister_all()
    .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)));

  let shortcut =
    Shortcut::from_str(accel).map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)))?;
  app
    .global_shortcut()
    .register(shortcut)
    .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)))?;
  Ok(())
}

pub fn reregister_global_hotkey(app: &AppHandle, accelerator: &str) -> tauri::Result<()> {
  register_global_hotkey(app, accelerator)
}

pub fn install_handler(app: &AppHandle) {
  // The plugin handler is configured in `main.rs` (Builder::with_handler). This helper is used
  // by that handler to show/focus the window.
  let _ = show_and_focus(app);
}

pub fn handle_shortcut_event(app: &AppHandle, event: ShortcutState) {
  if matches!(event, ShortcutState::Pressed) {
    let _ = toggle_show_hide(app);
  }
}

pub fn show_and_focus(app: &AppHandle) -> tauri::Result<()> {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.unminimize();
    let _ = w.emit(FOCUS_EVENT, ());
  }
  Ok(())
}

pub fn hide(app: &AppHandle) -> tauri::Result<()> {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.hide();
  }
  Ok(())
}

pub fn toggle_show_hide(app: &AppHandle) -> tauri::Result<()> {
  if let Some(w) = app.get_webview_window("main") {
    match w.is_visible() {
      Ok(true) => {
        let _ = w.hide();
      }
      Ok(false) => {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.unminimize();
        let _ = w.emit(FOCUS_EVENT, ());
      }
      Err(_) => {
        // Best-effort fallback: show & focus.
        return show_and_focus(app);
      }
    }
  }
  Ok(())
}

