-- Settle initial schema (SQLite + FTS5)
-- This file is applied transactionally on first run.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tags TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(local_date);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at);

CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  source_date TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  structured_data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model_used TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_summaries_date ON summaries(source_date);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  is_auto_generated INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category_entries (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  note_id TEXT REFERENCES notes(id),
  summary_id TEXT REFERENCES summaries(id),
  content TEXT NOT NULL,
  source_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ce_category ON category_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_ce_date ON category_entries(source_date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- FTS5 for notes (exactly as specified; keep in sync via triggers)
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
USING fts5(content, content=notes, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- FTS5 for category entries (for global search).
CREATE VIRTUAL TABLE IF NOT EXISTS category_entries_fts
USING fts5(content, content=category_entries, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS category_entries_ai AFTER INSERT ON category_entries BEGIN
  INSERT INTO category_entries_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS category_entries_ad AFTER DELETE ON category_entries BEGIN
  INSERT INTO category_entries_fts(category_entries_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS category_entries_au AFTER UPDATE ON category_entries BEGIN
  INSERT INTO category_entries_fts(category_entries_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO category_entries_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Seed default settings (idempotent).
INSERT OR IGNORE INTO settings(key, value) VALUES ('api_base_url', 'http://localhost:11434/v1');
INSERT OR IGNORE INTO settings(key, value) VALUES ('api_key', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('model_name', 'gpt-4o-mini');
INSERT OR IGNORE INTO settings(key, value) VALUES ('global_hotkey', 'CmdOrCtrl+Shift+Space');
INSERT OR IGNORE INTO settings(key, value) VALUES ('categorization_mode', 'auto');
INSERT OR IGNORE INTO settings(key, value) VALUES ('theme', 'system');

-- Migrations bookkeeping.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

