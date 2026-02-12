#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod export;
mod hotkey;
mod llm;
mod models;

use commands::AppState;
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn main() {
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_clipboard_manager::init())
    .setup(|app| {
      // DB
      let app_data_dir = app.path().app_data_dir()?;
      std::fs::create_dir_all(&app_data_dir)?;
      let db_path = app_data_dir.join("settle.sqlite3");
      let db = db::Db::new(db_path)?;
      db.migrate()?;

      // LLM
      let llm = llm::LlmClient::new().map_err(|e| anyhow::anyhow!(e))?;

      app.manage(AppState { db: db.clone(), llm });

      // Apply theme preference (best-effort).
      if let Ok(Some(theme)) = db.get_setting("theme") {
        let _ = if theme == "light" {
          app.handle().set_theme(Some(tauri::Theme::Light))
        } else if theme == "dark" {
          app.handle().set_theme(Some(tauri::Theme::Dark))
        } else {
          app.handle().set_theme(None)
        };
      }

      // Global hotkey plugin (Rust-side).
      {
        use std::str::FromStr;
        use tauri_plugin_global_shortcut::{Builder as GsBuilder, Shortcut};

        let handle = app.handle().clone();
        let plugin = GsBuilder::new()
          .with_handler(move |app, _shortcut, event| {
            // Show/focus on press.
            if event.state() == ShortcutState::Pressed {
              let _ = hotkey::toggle_show_hide(app);
            }
          })
          .build();

        handle.plugin(plugin)?;

        let accel = db
          .get_setting("global_hotkey")?
          .unwrap_or_else(|| "CmdOrCtrl+Shift+Space".into());
        if let Ok(sc) = Shortcut::from_str(&accel) {
          let _ = handle.global_shortcut().register(sc);
        }
      }

      // Tray icon + menu
      setup_tray(app.handle())?;

      // macOS: Ensure the main webview accepts the first click when inactive.
      //
      // This mitigates the common WKWebView behavior where the first click only
      // activates the window (dock click / after resize / after being inactive),
      // making the UI feel "dead" until the second click or a keypress.
      //
      // NOTE: this must be set at webview creation time, so we recreate the
      // window using the config as a template.
      #[cfg(target_os = "macos")]
      {
        if let Some(existing) = app.get_webview_window("main") {
          if let Some(conf) = app.config().app.windows.iter().find(|c| c.label == "main").cloned() {
            let _ = existing.destroy();
            let _ = tauri::WebviewWindowBuilder::from_config(app, &conf)?
              .accept_first_mouse(true)
              .build()?;
          }
        }
      }

      // Intercept close to hide instead.
      if let Some(w) = app.get_webview_window("main") {
        let handle = app.handle().clone();
        let w2 = w.clone();
        w.on_window_event(move |e| {
          match e {
            tauri::WindowEvent::CloseRequested { api, .. } => {
              api.prevent_close();
              let _ = hotkey::hide(&handle);
            }
            // macOS/WebKit can occasionally lose effective input routing after
            // resize/activate (e.g., clicking the dock icon). Re-focus and
            // re-emit the frontend focus event to keep the UI responsive.
            tauri::WindowEvent::Focused(true) | tauri::WindowEvent::Resized(_) => {
              if cfg!(target_os = "macos") {
                hotkey::focus_frontend(&w2);
              }
            }
            _ => {}
          }
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::get_db_info,
      commands::list_dates,
      commands::list_notes_for_date,
      commands::create_note,
      commands::update_note,
      commands::delete_note,
      commands::search,
      commands::list_categories,
      commands::list_category_entries,
      commands::list_summaries_timeline,
      commands::delete_summary,
      commands::delete_category,
      commands::get_settings,
      commands::set_setting,
      commands::test_llm_connection,
      commands::summarize_day,
      commands::apply_summarize_preview,
      commands::export_json,
      commands::export_markdown,
      commands::hide_main_window,
      commands::show_main_window,
      commands::copy_to_clipboard
    ])
    .build(tauri::generate_context!())
    .expect("error while running settle");

  app.run(|app_handle, event| {
    // macOS: when the app is re-activated (e.g., via the dock), WKWebView can
    // ignore the next click. Re-focus the webview to reduce "dead UI" reports.
    if cfg!(target_os = "macos") {
      if let tauri::RunEvent::Resumed = event {
        if let Some(w) = app_handle.get_webview_window("main") {
          // Don't force-show here; just try to restore focus if it is visible.
          if w.is_visible().unwrap_or(false) {
            hotkey::focus_frontend(&w);
          }
        }
      }
    }
  });
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
  let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

  let icon = app
    .default_window_icon()
    .cloned()
    .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("tray icon not available")))?;

  TrayIconBuilder::new()
    .menu(&menu)
    .icon(icon)
    .on_menu_event(|app, event| match event.id().as_ref() {
      "show" => {
        let _ = hotkey::show_and_focus(app);
      }
      "hide" => {
        let _ = hotkey::hide(app);
      }
      "quit" => {
        std::process::exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        let _ = hotkey::show_and_focus(tray.app_handle());
      }
    })
    .build(app)?;

  Ok(())
}

