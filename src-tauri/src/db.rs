use std::{fs, path::PathBuf};

use chrono::{Local, SecondsFormat, Utc};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde_json::json;
use uuid::Uuid;

use crate::models::{DateItem, DbInfo, Note, SearchResult};

#[derive(thiserror::Error, Debug)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("pool error: {0}")]
    Pool(#[from] r2d2::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

pub type DbResult<T> = Result<T, DbError>;

#[derive(Clone)]
pub struct Db {
    pool: Pool<SqliteConnectionManager>,
    db_path: PathBuf,
    tag_re: Regex,
}

impl Db {
    pub fn new(db_path: PathBuf) -> DbResult<Self> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mgr = SqliteConnectionManager::file(&db_path).with_init(|c| {
            c.execute_batch(
                r#"
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        "#,
            )?;
            Ok(())
        });
        let pool = Pool::new(mgr)?;

        let tag_re =
            Regex::new(r"#([\w-]+)") // captures without '#'
                .map_err(|e| DbError::InvalidInput(format!("tag regex failed: {e}")))?;

        Ok(Self {
            pool,
            db_path,
            tag_re,
        })
    }

    pub fn db_info(&self) -> DbResult<DbInfo> {
        let size_bytes = match fs::metadata(&self.db_path) {
            Ok(m) => m.len(),
            Err(_) => 0,
        };
        Ok(DbInfo {
            path: self.db_path.to_string_lossy().to_string(),
            size_bytes,
        })
    }

    pub fn migrate(&self) -> DbResult<()> {
        let mut conn = self.pool.get()?;
        conn.execute_batch(
            r#"
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      "#,
        )?;

        for (version, sql) in [
            (1, include_str!("../migrations/001_initial.sql")),
            (2, include_str!("../migrations/002_editor.sql")),
        ] {
            let applied: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                params![version],
                |r| r.get(0),
            )?;
            if applied {
                continue;
            }
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
                params![
                    version,
                    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
                ],
            )?;
            tx.commit()?;
        }
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> DbResult<Option<String>> {
        let conn = self.pool.get()?;
        let v: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v)
    }

    pub fn get_all_settings(&self) -> DbResult<Vec<(String, String)>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> DbResult<()> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn list_dates(&self, limit: i64) -> DbResult<Vec<DateItem>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
      "SELECT local_date, COUNT(*) FROM notes GROUP BY local_date ORDER BY local_date DESC LIMIT ?1"
    )?;
        let rows = stmt.query_map(params![limit.clamp(1, 10000)], |r| {
            Ok(DateItem {
                local_date: r.get(0)?,
                note_count: r.get(1)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn list_notes_for_date(&self, local_date: &str) -> DbResult<Vec<Note>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            r#"
      SELECT id, content, local_date, local_time, created_at, tags
      FROM notes
      WHERE local_date = ?1
      ORDER BY local_time ASC, created_at ASC
      "#,
        )?;
        let rows = stmt.query_map(params![local_date], |r| {
            let tags_json: String = r.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(Note {
                id: r.get(0)?,
                content: r.get(1)?,
                local_date: r.get(2)?,
                local_time: r.get(3)?,
                created_at: r.get(4)?,
                tags,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn create_note(&self, content: &str) -> DbResult<Note> {
        if content.trim().is_empty() {
            return Err(DbError::InvalidInput("note content is empty".into()));
        }

        let local = Local::now();
        let local_date = local.format("%Y-%m-%d").to_string();
        let local_time = local.format("%H:%M:%S").to_string();
        let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let id = Uuid::new_v4().to_string();

        let tags = self.extract_tags(content);
        let tags_json = serde_json::to_string(&tags)?;

        let conn = self.pool.get()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO notes(id, content, local_date, local_time, created_at, tags)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, content, local_date, local_time, created_at, tags_json],
        )?;
        tx.commit()?;

        Ok(Note {
            id,
            content: content.to_string(),
            local_date,
            local_time,
            created_at,
            tags,
        })
    }

    pub fn update_note(&self, note_id: &str, new_content: &str) -> DbResult<()> {
        if new_content.trim().is_empty() {
            return Err(DbError::InvalidInput("note content is empty".into()));
        }
        let tags = self.extract_tags(new_content);
        let tags_json = serde_json::to_string(&tags)?;

        let conn = self.pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE notes SET content = ?1, tags = ?2 WHERE id = ?3",
            params![new_content, tags_json, note_id],
        )?;
        if changed == 0 {
            return Err(DbError::InvalidInput("note not found".into()));
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_note(&self, note_id: &str) -> DbResult<()> {
        let conn = self.pool.get()?;
        let tx = conn.unchecked_transaction()?;
        // Legacy generated records remain exportable but must not prevent deleting a note.
        tx.execute(
            "UPDATE category_entries SET note_id = NULL WHERE note_id = ?1",
            params![note_id],
        )?;
        let changed = tx.execute("DELETE FROM notes WHERE id = ?1", params![note_id])?;
        if changed == 0 {
            return Err(DbError::InvalidInput("note not found".into()));
        }
        tx.commit()?;
        Ok(())
    }

    pub fn search(&self, query: &str, limit: i64) -> DbResult<Vec<SearchResult>> {
        // Treat user input as literal terms, never as executable FTS syntax.
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
            .collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT n.id, n.local_date, snippet(notes_fts, 0, '', '', '…', 24)
       FROM notes_fts JOIN notes n ON notes_fts.rowid = n.rowid
       WHERE notes_fts MATCH ?1 ORDER BY bm25(notes_fts), n.created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![terms.join(" AND "), limit.clamp(1, 200)], |r| {
            Ok(SearchResult {
                id: r.get(0)?,
                local_date: r.get(1)?,
                snippet: r.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn export_all_json(&self) -> DbResult<serde_json::Value> {
        let conn = self.pool.get()?;

        let notes = {
            let mut stmt =
        conn.prepare("SELECT id, content, local_date, local_time, created_at, tags FROM notes ORDER BY created_at, id")?;
            let rows = stmt.query_map([], |r| {
                let tags_json: String = r.get(5)?;
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
                Ok(json!({
                  "id": r.get::<_, String>(0)?,
                  "content": r.get::<_, String>(1)?,
                  "local_date": r.get::<_, String>(2)?,
                  "local_time": r.get::<_, String>(3)?,
                  "created_at": r.get::<_, String>(4)?,
                  "tags": tags
                }))
            })?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            out
        };

        let summaries = {
            let mut stmt = conn.prepare(
        "SELECT id, source_date, title, summary, structured_data, created_at, model_used FROM summaries",
      )?;
            let rows = stmt.query_map([], |r| {
                let structured_raw: String = r.get(4)?;
                let structured: serde_json::Value =
                    serde_json::from_str(&structured_raw).unwrap_or(json!({}));
                Ok(json!({
                  "id": r.get::<_, String>(0)?,
                  "source_date": r.get::<_, String>(1)?,
                  "title": r.get::<_, String>(2)?,
                  "summary": r.get::<_, String>(3)?,
                  "structured_data": structured,
                  "created_at": r.get::<_, String>(5)?,
                  "model_used": r.get::<_, String>(6)?,
                }))
            })?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            out
        };

        // categories with entries
        let categories = {
            let mut stmt = conn.prepare(
                r#"
        SELECT id, name, description, is_auto_generated, created_at
        FROM categories
        ORDER BY lower(name) ASC
        "#,
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)? == 1,
                    r.get::<_, String>(4)?,
                ))
            })?;
            let mut out = Vec::new();
            for row in rows {
                let (id, name, description, is_auto_generated, created_at) = row?;
                let entries = {
                    let mut e_stmt = conn.prepare(
                        r#"
            SELECT id, note_id, summary_id, content, source_date, created_at
            FROM category_entries
            WHERE category_id = ?1
            ORDER BY source_date DESC, created_at DESC
            "#,
                    )?;
                    let e_rows = e_stmt.query_map(params![id], |er| {
                        Ok(json!({
                          "id": er.get::<_, String>(0)?,
                          "note_id": er.get::<_, Option<String>>(1)?,
                          "summary_id": er.get::<_, Option<String>>(2)?,
                          "content": er.get::<_, String>(3)?,
                          "source_date": er.get::<_, String>(4)?,
                          "created_at": er.get::<_, String>(5)?,
                        }))
                    })?;
                    let mut e_out = Vec::new();
                    for e in e_rows {
                        e_out.push(e?);
                    }
                    e_out
                };
                out.push(json!({
                  "id": id,
                  "name": name,
                  "description": description,
                  "is_auto_generated": is_auto_generated,
                  "created_at": created_at,
                  "entries": entries
                }));
            }
            out
        };

        let workspace: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'workspace'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let workspace = workspace.and_then(|v| serde_json::from_str::<serde_json::Value>(&v).ok());
        Ok(json!({
          "workspace": workspace,
          "exported_at": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
          "notes": notes,
          "summaries": summaries,
          "categories": categories
        }))
    }

    fn extract_tags(&self, content: &str) -> Vec<String> {
        let mut tags = Vec::<String>::new();
        for cap in self.tag_re.captures_iter(content) {
            if let Some(m) = cap.get(1) {
                let t = m.as_str().to_string();
                if !tags.contains(&t) {
                    tags.push(t);
                }
            }
        }
        tags
    }
}
