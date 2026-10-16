use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: Option<String>,
    pub folder_id: Option<String>,
    pub content: String,
    pub local_date: String,
    pub local_time: String,
    pub created_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub note_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateItem {
    pub local_date: String,
    pub note_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: Option<String>,
    pub local_date: String,
    pub snippet: String,
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
