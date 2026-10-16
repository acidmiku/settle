CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);
ALTER TABLE notes ADD COLUMN title TEXT;
ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_notes_folder_date ON notes(folder_id, local_date DESC, local_time DESC, created_at DESC, id DESC);
CREATE INDEX idx_notes_library_date ON notes(local_date DESC, local_time DESC, created_at DESC, id DESC);

-- Include user-assigned names in search without changing the original note text.
DROP TRIGGER notes_ai;
DROP TRIGGER notes_ad;
DROP TRIGGER notes_au;
DROP TABLE notes_fts;
CREATE VIRTUAL TABLE notes_fts USING fts5(content, title, content=notes, content_rowid=rowid);
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, content, title) VALUES (new.rowid, new.content, new.title);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content, title) VALUES ('delete', old.rowid, old.content, old.title);
END;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content, title) VALUES ('delete', old.rowid, old.content, old.title);
  INSERT INTO notes_fts(rowid, content, title) VALUES (new.rowid, new.content, new.title);
END;
INSERT INTO notes_fts(notes_fts) VALUES ('rebuild');
