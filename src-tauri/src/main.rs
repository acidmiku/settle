#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod export;
mod hotkey;
mod models;
mod system;
mod window_layout;

use commands::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::ShortcutState;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = hotkey::show_and_focus(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(system::UpdateState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Err(e) = hotkey::toggle_show_hide(app) {
                            eprintln!("Window shortcut: {e}");
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db = db::Db::new(app_data_dir.join("settle.sqlite3"))?;
            db.migrate()?;
            commands::apply_design(
                app.handle(),
                &db.get_setting("design")?
                    .unwrap_or_else(|| "scratch".into()),
            );
            let accelerator = db
                .get_setting("global_hotkey")?
                .unwrap_or_else(|| "CmdOrCtrl+Shift+Space".into());
            let hotkey_error = hotkey::replace_global_hotkey(app.handle(), "", &accelerator)
                .err()
                .map(|e| e.to_string());
            let registered = if hotkey_error.is_none() {
                accelerator
            } else {
                String::new()
            };
            app.manage(AppState {
                db,
                hotkey: std::sync::Mutex::new(registered),
                hotkey_error,
            });
            app.manage(window_layout::WindowLayout::default());

            #[cfg(target_os = "macos")]
            {
                // Native Edit menu supplies Cmd+C/V/X/Z/A to WKWebView.
                app.set_menu(Menu::default(app.handle())?)?;
                if let Some(window) = app.get_webview_window("main") {
                    window.set_decorations(true)?;
                }
            }
            setup_tray(app.handle())?;
            let design = app
                .state::<AppState>()
                .db
                .get_setting("design")?
                .unwrap_or_else(|| "scratch".into());
            window_layout::apply(app.handle(), &design)?;
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Err(e) = hotkey::hide(&handle) {
                            eprintln!("Hide window: {e}");
                        }
                    }
                });
            }
            hotkey::show_and_focus(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_runtime_info,
            commands::get_db_info,
            commands::list_dates,
            commands::list_notes_for_date,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::search,
            commands::get_settings,
            commands::set_setting,
            commands::export_json,
            commands::export_markdown,
            commands::hide_main_window,
            commands::show_main_window,
            commands::copy_to_clipboard,
            commands::open_preview_link,
            system::get_start_with_os,
            system::set_start_with_os,
            system::check_for_update,
            system::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Settle");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            if let Err(e) = hotkey::show_and_focus(_app) {
                eprintln!("Reopen window: {e}");
            }
        }
    });
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Settle", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide Settle", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Settle", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("tray icon not available")))?;
    TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Settle")
        .icon(icon)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                let _ = hotkey::show_and_focus(app);
            }
            "hide" => {
                let _ = hotkey::hide(app);
            }
            "quit" => app.exit(0),
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
