use std::collections::HashMap;

use tauri::{AppHandle, Manager, State};

use crate::{
    db::Db,
    export,
    models::{DateItem, DbInfo, Note, SearchResult},
};

pub struct AppState {
    pub db: Db,
    pub hotkey: std::sync::Mutex<String>,
    pub hotkey_error: Option<String>,
}

#[tauri::command]
pub fn get_runtime_info(state: State<'_, AppState>) -> serde_json::Value {
    serde_json::json!({"platform": std::env::consts::OS, "hotkey_error": state.hotkey_error})
}

fn err_to_string(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn get_db_info(state: State<'_, AppState>) -> Result<DbInfo, String> {
    state.db.db_info().map_err(err_to_string)
}

#[tauri::command]
pub async fn list_dates(state: State<'_, AppState>, limit: i64) -> Result<Vec<DateItem>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.list_dates(limit))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn list_notes_for_date(
    state: State<'_, AppState>,
    local_date: String,
) -> Result<Vec<Note>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.list_notes_for_date(&local_date))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn create_note(state: State<'_, AppState>, content: String) -> Result<Note, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.create_note(&content))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn update_note(
    state: State<'_, AppState>,
    note_id: String,
    content: String,
) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.update_note(&note_id, &content))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn delete_note(state: State<'_, AppState>, note_id: String) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.delete_note(&note_id))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn search(
    state: State<'_, AppState>,
    query: String,
    limit: i64,
) -> Result<Vec<SearchResult>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.search(&query, limit))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.get_all_settings())
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
        .map(|rows| rows.into_iter().collect())
}

#[tauri::command]
pub fn set_setting(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    match key.as_str() {
        "design"
            if ![
                "kiln", "blackbox", "optic", "phosphor", "sidecar", "cobalt", "scratch", "redline",
                "frost", "tape",
            ]
            .contains(&value.as_str()) =>
        {
            return Err("Unknown design".into())
        }
        "save_key_mode" if !["enter", "shift_enter"].contains(&value.as_str()) => {
            return Err("Unknown save key mode".into())
        }
        "line_numbers" if !["true", "false"].contains(&value.as_str()) => {
            return Err("Line numbers must be true or false".into())
        }
        "workspace" => {
            serde_json::from_str::<serde_json::Value>(&value).map_err(err_to_string)?;
        }
        "design" | "save_key_mode" | "global_hotkey" | "line_numbers" => {}
        _ => return Err("Unknown setting".into()),
    }
    if key == "global_hotkey" {
        let mut current = state.hotkey.lock().map_err(err_to_string)?;
        crate::hotkey::replace_global_hotkey(&app, &current, &value).map_err(err_to_string)?;
        if let Err(e) = state.db.set_setting(&key, &value) {
            let _ = crate::hotkey::replace_global_hotkey(&app, &value, &current);
            return Err(e.to_string());
        }
        *current = value;
    } else if key == "design" {
        let previous = state
            .db
            .get_setting("design")
            .map_err(err_to_string)?
            .unwrap_or_else(|| "scratch".into());
        crate::window_layout::apply(&app, &value).map_err(err_to_string)?;
        if let Err(error) = state.db.set_setting(&key, &value) {
            let _ = crate::window_layout::apply(&app, &previous);
            return Err(error.to_string());
        }
        apply_design(&app, &value);
    } else {
        state.db.set_setting(&key, &value).map_err(err_to_string)?;
    }
    Ok(())
}

pub fn apply_design(app: &AppHandle, design: &str) {
    let theme = if ["optic", "redline", "frost"].contains(&design) {
        tauri::Theme::Light
    } else {
        tauri::Theme::Dark
    };
    app.set_theme(Some(theme));
}

#[tauri::command]
pub async fn export_json(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::models::ExportResult, String> {
    let app_data_dir = app.path().app_data_dir().map_err(err_to_string)?;
    let export_dir = export::new_export_dir(&app_data_dir);
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || export::export_json_to_dir(&db, &export_dir))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn export_markdown(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::models::ExportResult, String> {
    let app_data_dir = app.path().app_data_dir().map_err(err_to_string)?;
    let export_dir = export::new_export_dir(&app_data_dir);
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || export::export_markdown_to_dir(&db, &export_dir))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn hide_main_window(app: AppHandle) -> Result<(), String> {
    crate::hotkey::hide(&app).map_err(err_to_string)
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    crate::hotkey::show_and_focus(&app).map_err(err_to_string)
}

#[tauri::command]
pub async fn copy_to_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(err_to_string)
}

#[tauri::command]
pub async fn open_preview_link(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(err_to_string)?;
    if !["https", "http", "mailto"].contains(&parsed.scheme()) {
        return Err("Only web and email links can be opened from a preview".into());
    }
    tauri::async_runtime::spawn_blocking(move || open::that(parsed.as_str()))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}
