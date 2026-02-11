use std::{fs, path::PathBuf};

use chrono::{Local, SecondsFormat, Utc};
use regex::Regex;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
use serde_json::json;
use uuid::Uuid;

use crate::models::{Category, CategoryEntry, DateItem, DbInfo, Note, SearchResult, Summary};

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
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        "#,
      )?;
      Ok(())
    });
    let pool = Pool::new(mgr)?;

    let tag_re = Regex::new(r"#([\w-]+)") // captures without '#'
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

    let already: Option<i64> = conn
      .query_row(
        "SELECT version FROM schema_migrations WHERE version = 1",
        [],
        |r| r.get(0),
      )
      .optional()?;
    if already.is_some() {
      return Ok(());
    }

    let sql = include_str!("../migrations/001_initial.sql");
    let tx = conn.transaction()?;
    tx.execute_batch(sql)?;
    tx.execute(
      "INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?1)",
      params![Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)],
    )?;
    tx.commit()?;
    Ok(())
  }

  pub fn get_setting(&self, key: &str) -> DbResult<Option<String>> {
    let conn = self.pool.get()?;
    let v: Option<String> = conn
      .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
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
      r#"
      SELECT
        n.local_date,
        COUNT(*) AS note_count,
        MAX(n.created_at) AS last_note_at,
        (SELECT MAX(created_at) FROM summaries s WHERE s.source_date = n.local_date) AS last_summary_at
      FROM notes n
      GROUP BY n.local_date
      ORDER BY n.local_date DESC
      LIMIT ?1
      "#,
    )?;
    let rows = stmt.query_map(params![limit], |r| {
      let last_note_at: String = r.get(2)?;
      let last_summary_at: Option<String> = r.get(3)?;
      let has_summary = last_summary_at.is_some();
      let has_unsummarized = match last_summary_at {
        None => true,
        Some(s) => last_note_at > s,
      };
      Ok(DateItem {
        local_date: r.get(0)?,
        note_count: r.get(1)?,
        has_summary,
        has_unsummarized,
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
    let content = content.trim_end();
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
    let new_content = new_content.trim_end();
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
    let changed = tx.execute("DELETE FROM notes WHERE id = ?1", params![note_id])?;
    if changed == 0 {
      return Err(DbError::InvalidInput("note not found".into()));
    }
    tx.commit()?;
    Ok(())
  }

  pub fn get_unsummarized_notes_for_date(&self, local_date: &str) -> DbResult<Vec<Note>> {
    let conn = self.pool.get()?;
    // Aggregate queries always return a row; the value can be NULL.
    let last_summary_at: Option<String> = conn.query_row(
      "SELECT MAX(created_at) FROM summaries WHERE source_date = ?1",
      params![local_date],
      |r| r.get::<_, Option<String>>(0),
    )?;
    let Some(last_summary_at) = last_summary_at else {
      return self.list_notes_for_date(local_date);
    };

    let has_new: Option<i64> = conn
      .query_row(
        "SELECT 1 FROM notes WHERE local_date = ?1 AND created_at > ?2 LIMIT 1",
        params![local_date, last_summary_at],
        |r| r.get(0),
      )
      .optional()?;
    if has_new.is_none() {
      return Ok(vec![]);
    }

    // Re-summarize the full day if new notes appeared after last summary.
    self.list_notes_for_date(local_date)
  }

  pub fn upsert_summary_and_entries(
    &self,
    local_date: &str,
    title: &str,
    summary: &str,
    structured_data: serde_json::Value,
    model_used: &str,
    categories: Vec<(String, bool, Vec<(String, String, Vec<String>)>)>, // name, is_new, entries(content, source_time, key_points)
  ) -> DbResult<Summary> {
    let conn = self.pool.get()?;
    let tx = conn.unchecked_transaction()?;

    // Replace existing summary + entries for this date (so "Summarize Day" can be re-run
    // after adding more notes).
    tx.execute(
      "DELETE FROM category_entries WHERE source_date = ?1",
      params![local_date],
    )?;
    tx.execute(
      "DELETE FROM summaries WHERE source_date = ?1",
      params![local_date],
    )?;

    // Create summary row.
    let summary_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    tx.execute(
      r#"
      INSERT INTO summaries(id, source_date, title, summary, structured_data, created_at, model_used)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      "#,
      params![
        summary_id,
        local_date,
        title,
        summary,
        structured_data.to_string(),
        created_at,
        model_used
      ],
    )?;

    // Ensure categories exist and insert entries.
    for (cat_name, _is_new, entries) in categories {
      let existing_id: Option<String> = tx
        .query_row(
          "SELECT id FROM categories WHERE name = ?1",
          params![cat_name],
          |r| r.get(0),
        )
        .optional()?;

      let category_id = match existing_id {
        Some(id) => id,
        None => {
          let id = Uuid::new_v4().to_string();
          tx.execute(
            "INSERT INTO categories(id, name, description, is_auto_generated, created_at)
             VALUES (?1, ?2, '', 1, ?3)",
            params![id, cat_name, created_at],
          )?;
          id
        }
      };

      for (content, source_time, key_points) in entries {
        let entry_id = Uuid::new_v4().to_string();
        let note_id = self.find_note_id_by_time_tx(&tx, local_date, &source_time)?;
        let entry_content = normalize_entry_content(&content, &key_points);

        tx.execute(
          r#"
          INSERT INTO category_entries(id, category_id, note_id, summary_id, content, source_date, created_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          "#,
          params![
            entry_id,
            category_id,
            note_id,
            summary_id,
            entry_content,
            local_date,
            created_at
          ],
        )?;
      }
    }

    tx.commit()?;

    Ok(Summary {
      id: summary_id,
      source_date: local_date.to_string(),
      title: title.to_string(),
      summary: summary.to_string(),
      structured_data,
      created_at,
      model_used: model_used.to_string(),
    })
  }

  pub fn list_categories(&self) -> DbResult<Vec<Category>> {
    let conn = self.pool.get()?;
    let mut stmt = conn.prepare(
      r#"
      SELECT c.id, c.name, c.description, c.is_auto_generated, c.created_at,
        (SELECT COUNT(*) FROM category_entries ce WHERE ce.category_id = c.id) AS entry_count
      FROM categories c
      ORDER BY lower(c.name) ASC
      "#,
    )?;
    let rows = stmt.query_map([], |r| {
      Ok(Category {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        is_auto_generated: r.get::<_, i64>(3)? == 1,
        created_at: r.get(4)?,
        entry_count: r.get(5)?,
      })
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn list_category_entries(&self, category_id: &str) -> DbResult<Vec<CategoryEntry>> {
    let conn = self.pool.get()?;
    let mut stmt = conn.prepare(
      r#"
      SELECT id, category_id, note_id, summary_id, content, source_date, created_at
      FROM category_entries
      WHERE category_id = ?1
      ORDER BY source_date DESC, created_at DESC
      "#,
    )?;
    let rows = stmt.query_map(params![category_id], |r| {
      Ok(CategoryEntry {
        id: r.get(0)?,
        category_id: r.get(1)?,
        note_id: r.get(2)?,
        summary_id: r.get(3)?,
        content: r.get(4)?,
        source_date: r.get(5)?,
        created_at: r.get(6)?,
      })
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn list_summaries_timeline(&self, limit: i64) -> DbResult<Vec<Summary>> {
    let conn = self.pool.get()?;
    let mut stmt = conn.prepare(
      r#"
      SELECT id, source_date, title, summary, structured_data, created_at, model_used
      FROM summaries
      ORDER BY source_date DESC, created_at DESC
      LIMIT ?1
      "#,
    )?;
    let rows = stmt.query_map(params![limit], |r| {
      let raw: String = r.get(4)?;
      let structured_data: serde_json::Value = serde_json::from_str(&raw).unwrap_or(json!({}));
      Ok(Summary {
        id: r.get(0)?,
        source_date: r.get(1)?,
        title: r.get(2)?,
        summary: r.get(3)?,
        structured_data,
        created_at: r.get(5)?,
        model_used: r.get(6)?,
      })
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn delete_summary(&self, summary_id: &str) -> DbResult<()> {
    let conn = self.pool.get()?;
    let tx = conn.unchecked_transaction()?;

    // Remove derived entries first (no ON DELETE CASCADE).
    tx.execute(
      "DELETE FROM category_entries WHERE summary_id = ?1",
      params![summary_id],
    )?;

    let changed = tx.execute("DELETE FROM summaries WHERE id = ?1", params![summary_id])?;
    if changed == 0 {
      return Err(DbError::InvalidInput("summary not found".into()));
    }

    tx.commit()?;
    Ok(())
  }

  pub fn delete_category(&self, category_id: &str) -> DbResult<()> {
    let conn = self.pool.get()?;
    let tx = conn.unchecked_transaction()?;

    // Remove entries first (no ON DELETE CASCADE).
    tx.execute(
      "DELETE FROM category_entries WHERE category_id = ?1",
      params![category_id],
    )?;

    let changed = tx.execute("DELETE FROM categories WHERE id = ?1", params![category_id])?;
    if changed == 0 {
      return Err(DbError::InvalidInput("category not found".into()));
    }

    tx.commit()?;
    Ok(())
  }

  pub fn search(&self, query: &str, limit: i64) -> DbResult<Vec<SearchResult>> {
    let q = query.trim();
    if q.is_empty() {
      return Ok(vec![]);
    }
    let conn = self.pool.get()?;

    let mut out: Vec<SearchResult> = Vec::new();

    // Notes FTS
    {
      let mut stmt = conn.prepare(
        r#"
        SELECT n.id, n.local_date,
          snippet(notes_fts, 0, '<mark>', '</mark>', '…', 12) AS snip
        FROM notes_fts
        JOIN notes n ON notes_fts.rowid = n.rowid
        WHERE notes_fts MATCH ?1
        ORDER BY bm25(notes_fts) ASC
        LIMIT ?2
        "#,
      )?;
      let rows = stmt.query_map(params![q, limit], |r| {
        Ok(SearchResult {
          kind: "note".to_string(),
          id: r.get(0)?,
          local_date: r.get(1)?,
          snippet: r.get(2)?,
          category_id: None,
        })
      })?;
      for row in rows {
        out.push(row?);
      }
    }

    // Category entries FTS
    {
      let remaining = (limit - out.len() as i64).max(0);
      if remaining > 0 {
        let mut stmt = conn.prepare(
          r#"
          SELECT ce.id, ce.source_date, ce.category_id,
            snippet(category_entries_fts, 0, '<mark>', '</mark>', '…', 12) AS snip
          FROM category_entries_fts
          JOIN category_entries ce ON category_entries_fts.rowid = ce.rowid
          WHERE category_entries_fts MATCH ?1
          ORDER BY bm25(category_entries_fts) ASC
          LIMIT ?2
          "#,
        )?;
        let rows = stmt.query_map(params![q, remaining], |r| {
          Ok(SearchResult {
            kind: "category_entry".to_string(),
            id: r.get(0)?,
            local_date: r.get(1)?,
            category_id: Some(r.get(2)?),
            snippet: r.get(3)?,
          })
        })?;
        for row in rows {
          out.push(row?);
        }
      }
    }

    Ok(out)
  }

  pub fn export_all_json(&self) -> DbResult<serde_json::Value> {
    let conn = self.pool.get()?;

    let notes = {
      let mut stmt =
        conn.prepare("SELECT id, content, local_date, local_time, created_at, tags FROM notes")?;
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

    Ok(json!({
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

  fn find_note_id_by_time_tx(
    &self,
    tx: &rusqlite::Transaction<'_>,
    local_date: &str,
    source_time_hhmm: &str,
  ) -> DbResult<Option<String>> {
    // Match "HH:MM" against stored "HH:MM:SS".
    let pattern = format!("{source_time_hhmm}:%");
    let id: Option<String> = tx
      .query_row(
        r#"
        SELECT id FROM notes
        WHERE local_date = ?1 AND local_time LIKE ?2
        ORDER BY local_time ASC
        LIMIT 1
        "#,
        params![local_date, pattern],
        |r| r.get(0),
      )
      .optional()?;
    Ok(id)
  }
}

fn normalize_entry_content(content: &str, key_points: &[String]) -> String {
  let c = content.trim();
  if key_points.is_empty() {
    return c.to_string();
  }
  let mut out = String::new();
  out.push_str(c);
  out.push_str("\n\nKey points:\n");
  for kp in key_points {
    let kp = kp.trim();
    if kp.is_empty() {
      continue;
    }
    out.push_str("- ");
    out.push_str(kp);
    out.push('\n');
  }
  out.trim_end().to_string()
}

