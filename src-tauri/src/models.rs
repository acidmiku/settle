use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
  pub id: String,
  pub content: String,
  pub local_date: String, // YYYY-MM-DD
  pub local_time: String, // HH:MM:SS
  pub created_at: String, // ISO 8601 UTC
  pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
  pub id: String,
  pub source_date: String,
  pub title: String,
  pub summary: String,
  pub structured_data: serde_json::Value,
  pub created_at: String,
  pub model_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
  pub id: String,
  pub name: String,
  pub description: String,
  pub is_auto_generated: bool,
  pub created_at: String,
  pub entry_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryEntry {
  pub id: String,
  pub category_id: String,
  pub note_id: Option<String>,
  pub summary_id: Option<String>,
  pub content: String,
  pub source_date: String,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateItem {
  pub local_date: String,
  pub note_count: i64,
  pub has_summary: bool,
  pub has_unsummarized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
  pub kind: String, // "note" | "category_entry"
  pub id: String,
  pub local_date: String,
  pub snippet: String,
  pub category_id: Option<String>, // only for kind="category_entry"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbInfo {
  pub path: String,
  pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
  pub export_dir: String,
  pub files_written: i64,
}

