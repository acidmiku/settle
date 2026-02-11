use std::collections::HashMap;

use tauri::{AppHandle, Manager, State};

use crate::{
  db::Db,
  export,
  llm::{DailySummaryResponse, LlmClient, LlmConfig},
  models::{Category, CategoryEntry, DateItem, DbInfo, Note, SearchResult, Summary},
};

#[derive(Clone)]
pub struct AppState {
  pub db: Db,
  pub llm: LlmClient,
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
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
  let db = state.db.clone();
  tauri::async_runtime::spawn_blocking(move || db.list_categories())
    .await
    .map_err(err_to_string)?
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn list_category_entries(
  state: State<'_, AppState>,
  category_id: String,
) -> Result<Vec<CategoryEntry>, String> {
  let db = state.db.clone();
  tauri::async_runtime::spawn_blocking(move || db.list_category_entries(&category_id))
    .await
    .map_err(err_to_string)?
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn list_summaries_timeline(
  state: State<'_, AppState>,
  limit: i64,
) -> Result<Vec<Summary>, String> {
  let db = state.db.clone();
  tauri::async_runtime::spawn_blocking(move || db.list_summaries_timeline(limit))
    .await
    .map_err(err_to_string)?
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn delete_summary(state: State<'_, AppState>, summary_id: String) -> Result<(), String> {
  let db = state.db.clone();
  tauri::async_runtime::spawn_blocking(move || db.delete_summary(&summary_id))
    .await
    .map_err(err_to_string)?
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn delete_category(state: State<'_, AppState>, category_id: String) -> Result<(), String> {
  let db = state.db.clone();
  tauri::async_runtime::spawn_blocking(move || db.delete_category(&category_id))
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
pub async fn set_setting(
  app: AppHandle,
  state: State<'_, AppState>,
  key: String,
  value: String,
) -> Result<(), String> {
  // persist
  let db = state.db.clone();
  let key_for_db = key.clone();
  let value_for_db = value.clone();
  tauri::async_runtime::spawn_blocking(move || db.set_setting(&key_for_db, &value_for_db))
    .await
    .map_err(err_to_string)?
    .map_err(err_to_string)?;

  // side-effects
  if key == "theme" {
    let _ = apply_theme(&app, &value);
  }
  if key == "global_hotkey" {
    let _ = crate::hotkey::reregister_global_hotkey(&app, &value);
  }

  Ok(())
}

#[tauri::command]
pub async fn test_llm_connection(state: State<'_, AppState>) -> Result<(), String> {
  let cfg = load_llm_config(&state).map_err(err_to_string)?;
  state.llm.test_connection(&cfg).await.map_err(err_to_string)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SummarizePreview {
  pub response: DailySummaryResponse,
  pub structured_data: serde_json::Value,
  pub model_used: String,
}

#[tauri::command]
pub async fn summarize_day(
  state: State<'_, AppState>,
  local_date: String,
) -> Result<serde_json::Value, String> {
  let mode = state
    .db
    .get_setting("categorization_mode")
    .map_err(err_to_string)?
    .unwrap_or_else(|| "auto".into());

  let notes = tauri::async_runtime::spawn_blocking({
    let db = state.db.clone();
    let d = local_date.clone();
    move || db.get_unsummarized_notes_for_date(&d)
  })
  .await
  .map_err(err_to_string)?
  .map_err(err_to_string)?;

  if notes.is_empty() {
    return Ok(serde_json::json!({ "mode": mode, "status": "nothing_to_do" }));
  }

  let mut notes_chrono: Vec<(String, String)> = Vec::new();
  for n in &notes {
    let hhmm = n.local_time.get(0..5).unwrap_or("00:00").to_string();
    notes_chrono.push((hhmm, n.content.clone()));
  }

  let existing_categories = tauri::async_runtime::spawn_blocking({
    let db = state.db.clone();
    move || db.list_categories()
  })
  .await
  .map_err(err_to_string)?
  .map_err(err_to_string)?
  .into_iter()
  .map(|c| c.name)
  .collect::<Vec<_>>();

  let cfg = load_llm_config(&state).map_err(err_to_string)?;
  let (resp, structured_data) = state
    .llm
    .summarize_day(&cfg, &local_date, &notes_chrono, &existing_categories)
    .await
    .map_err(err_to_string)?;

  if mode == "suggest" {
    return Ok(serde_json::json!({
      "mode": "suggest",
      "status": "preview",
      "preview": SummarizePreview { response: resp, structured_data, model_used: cfg.model }
    }));
  }

  // auto mode: persist
  let categories_for_db = resp
    .categories
    .iter()
    .map(|c| {
      let entries = c
        .entries
        .iter()
        .map(|e| (e.content.clone(), e.source_time.clone(), e.key_points.clone()))
        .collect::<Vec<_>>();
      (c.category_name.clone(), c.is_new_category, entries)
    })
    .collect::<Vec<_>>();

  let summary = tauri::async_runtime::spawn_blocking({
    let db = state.db.clone();
    let d = local_date.clone();
    let title = resp.title.clone();
    let summary_txt = resp.summary.clone();
    let structured = structured_data.clone();
    let model = cfg.model.clone();
    move || db.upsert_summary_and_entries(&d, &title, &summary_txt, structured, &model, categories_for_db)
  })
  .await
  .map_err(err_to_string)?
  .map_err(err_to_string)?;

  Ok(serde_json::json!({
    "mode": "auto",
    "status": "saved",
    "summary": summary
  }))
}

#[tauri::command]
pub async fn apply_summarize_preview(
  state: State<'_, AppState>,
  local_date: String,
  preview: SummarizePreview,
) -> Result<Summary, String> {
  let categories_for_db = preview
    .response
    .categories
    .iter()
    .map(|c| {
      let entries = c
        .entries
        .iter()
        .map(|e| (e.content.clone(), e.source_time.clone(), e.key_points.clone()))
        .collect::<Vec<_>>();
      (c.category_name.clone(), c.is_new_category, entries)
    })
    .collect::<Vec<_>>();

  let model_used = preview.model_used.clone();
  let title = preview.response.title.clone();
  let summary_txt = preview.response.summary.clone();
  let structured = preview.structured_data.clone();

  tauri::async_runtime::spawn_blocking({
    let db = state.db.clone();
    move || db.upsert_summary_and_entries(&local_date, &title, &summary_txt, structured, &model_used, categories_for_db)
  })
  .await
  .map_err(err_to_string)?
  .map_err(err_to_string)
}

#[tauri::command]
pub async fn export_json(app: AppHandle, state: State<'_, AppState>) -> Result<crate::models::ExportResult, String> {
  let app_data_dir = app.path().app_data_dir().map_err(err_to_string)?;
  let export_dir = export::new_export_dir(&app_data_dir);
  let db = state.db.clone();
  tauri::async_runtime::spawn_blocking(move || export::export_json_to_dir(&db, &export_dir))
    .await
    .map_err(err_to_string)?
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn export_markdown(app: AppHandle, state: State<'_, AppState>) -> Result<crate::models::ExportResult, String> {
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
  app
    .clipboard()
    .write_text(text)
    .map_err(err_to_string)
}

fn load_llm_config(state: &AppState) -> Result<LlmConfig, crate::llm::LlmError> {
  let base_url = state
    .db
    .get_setting("api_base_url")
    .map_err(|e| crate::llm::LlmError::MissingConfig(e.to_string()))?
    .unwrap_or_default();
  let api_key = state
    .db
    .get_setting("api_key")
    .map_err(|e| crate::llm::LlmError::MissingConfig(e.to_string()))?
    .unwrap_or_default();
  let model = state
    .db
    .get_setting("model_name")
    .map_err(|e| crate::llm::LlmError::MissingConfig(e.to_string()))?
    .unwrap_or_default();

  Ok(LlmConfig {
    base_url,
    api_key,
    model,
  })
}

fn apply_theme(app: &AppHandle, theme_value: &str) -> tauri::Result<()> {
  // Frontend applies the actual CSS theme; we just set OS theme preference when possible.
  // If unsupported, ignore.
  let theme_value = theme_value.to_lowercase();
  if theme_value == "light" {
    let _ = app.set_theme(Some(tauri::Theme::Light));
  } else if theme_value == "dark" {
    let _ = app.set_theme(Some(tauri::Theme::Dark));
  } else {
    let _ = app.set_theme(None);
  }
  Ok(())
}

