-- The migration runner adds missing folders/columns before executing this file.
-- Only the derived search index is rebuilt; note text and metadata stay intact.
CREATE INDEX IF NOT EXISTS idx_notes_folder_date ON notes(folder_id, local_date DESC, local_time DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notes_library_date ON notes(local_date DESC, local_time DESC, created_at DESC, id DESC);

DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;
DROP TABLE IF EXISTS notes_fts;
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
