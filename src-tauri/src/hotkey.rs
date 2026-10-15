use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

const FOCUS_EVENT: &str = "settle:focus-input";

pub fn replace_global_hotkey(app: &AppHandle, previous: &str, next: &str) -> anyhow::Result<()> {
    let parse = |s: &str| -> anyhow::Result<Option<Shortcut>> {
        if s.trim().is_empty() {
            Ok(None)
        } else {
            Ok(Some(Shortcut::from_str(s.trim())?))
        }
    };
    let old = parse(previous)?;
    let new = parse(next)?;
    if old == new {
        return Ok(());
    }
    // Register first: invalid or occupied shortcuts leave the working binding intact.
    if let Some(shortcut) = new {
        app.global_shortcut().register(shortcut)?;
    }
    if let Some(shortcut) = old {
        if let Err(error) = app.global_shortcut().unregister(shortcut) {
            if let Some(shortcut) = new {
                let _ = app.global_shortcut().unregister(shortcut);
            }
            return Err(error.into());
        }
    }
    Ok(())
}

pub fn show_and_focus(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        window.emit(FOCUS_EVENT, ())?;
    }
    Ok(())
}

pub fn hide(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide()?;
    }
    Ok(())
}

pub fn toggle_show_hide(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible()? && !window.is_minimized()? && window.is_focused()? {
            return hide(app);
        }
    }
    show_and_focus(app)
}
