// Exercise the real SQLite layer without starting a desktop app.
#[path = "../src/db.rs"]
mod db;
#[path = "../src/export.rs"]
mod export;
#[path = "../src/models.rs"]
mod models;

use db::Db;
use rusqlite::{params, Connection};

fn database() -> (Db, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("settle-test-{}", uuid::Uuid::new_v4()));
    let db = Db::new(dir.join("settle.sqlite3")).unwrap();
    db.migrate().unwrap();
    assert!(db.db_info().unwrap().size_bytes > 0);
    assert!(!db.get_all_settings().unwrap().is_empty());
    (db, dir)
}

#[test]
fn migrates_existing_data_and_preserves_archived_content() {
    let dir = std::env::temp_dir().join(format!("settle-upgrade-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("settle.sqlite3");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();
        conn.execute_batch("INSERT INTO schema_migrations VALUES (1, '2026-01-01');
      INSERT INTO notes VALUES ('n1', 'Original note', '2026-01-01', '10:00:00', '2026-01-01T10:00:00Z', '[]');
      INSERT INTO summaries VALUES ('s1','2026-01-01','Old title','Old summary','{}','2026-01-01','old');
      INSERT INTO categories VALUES ('c1','Old category','',1,'2026-01-01');
      INSERT INTO category_entries VALUES ('e1','c1','n1','s1','Old entry','2026-01-01','2026-01-01');
      UPDATE settings SET value = 'secret' WHERE key = 'api_key';").unwrap();
    }
    let db = Db::new(path).unwrap();
    db.migrate().unwrap();
    db.migrate().unwrap();
    assert_eq!(
        db.get_setting("design").unwrap().as_deref(),
        Some("scratch")
    );
    assert!(db.get_setting("api_key").unwrap().is_none());
    assert_eq!(db.list_dates(100).unwrap()[0].note_count, 1);
    assert_eq!(
        db.list_notes_for_date("2026-01-01").unwrap()[0].content,
        "Original note"
    );
    assert!(db.search("Old entry", 30).unwrap().is_empty());
    db.delete_note("n1").unwrap();
    let data = db.export_all_json().unwrap();
    assert_eq!(data["summaries"][0]["summary"], "Old summary");
    assert_eq!(data["categories"][0]["entries"][0]["content"], "Old entry");
    assert!(data["categories"][0]["entries"][0]["note_id"].is_null());
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn note_lifecycle_searches_literal_input_and_preserves_plain_text() {
    let (db, dir) = database();
    let text = "Desk rebuild #work #work\nПривет 世界\n  ";
    let note = db.create_note(text).unwrap();
    assert_eq!(note.content, text);
    assert_eq!(note.tags, vec!["work"]);
    assert_eq!(db.search("desk reb", 10).unwrap().len(), 1);
    for query in ["\"", "(", "a:b", "NEAR(", "*", "x OR y", "---"] {
        db.search(query, 10).unwrap();
    }
    assert_eq!(db.search("Привет", 10).unwrap().len(), 1);
    db.update_note(&note.id, "Changed note\n\n").unwrap();
    assert!(db.search("desk", 10).unwrap().is_empty());
    assert_eq!(db.search("Changed", 10).unwrap().len(), 1);
    assert_eq!(
        db.list_notes_for_date(&note.local_date).unwrap()[0].content,
        "Changed note\n\n"
    );
    assert!(db.create_note(" \n ").is_err());
    db.delete_note(&note.id).unwrap();
    assert!(db.search("Changed", 10).unwrap().is_empty());
    assert!(db.update_note(&note.id, "Missing").is_err());
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn exports_notes_buffers_and_legacy_without_filename_collisions() {
    let (db, dir) = database();
    let note = db.create_note("A note").unwrap();
    db.set_setting(
        "workspace",
        r#"{"version":2,"buffers":[{"mode":"scratch","text":"Unsaved scratch"}]}"#,
    )
    .unwrap();
    let conn = Connection::open(dir.join("settle.sqlite3")).unwrap();
    for (id, name) in [("c1", "CON"), ("c2", "../CON"), ("c3", "世界")] {
        conn.execute(
            "INSERT INTO categories VALUES (?1,?2,'',1,'2026-01-01')",
            params![id, name],
        )
        .unwrap();
    }
    drop(conn);
    let json_dir = export::new_export_dir(&dir);
    let md_dir = export::new_export_dir(&dir);
    assert_ne!(json_dir, md_dir);
    export::export_json_to_dir(&db, &json_dir).unwrap();
    let data: serde_json::Value =
        serde_json::from_slice(&std::fs::read(json_dir.join("export.json")).unwrap()).unwrap();
    assert_eq!(data["workspace"]["buffers"][0]["text"], "Unsaved scratch");
    let result = export::export_markdown_to_dir(&db, &md_dir).unwrap();
    assert_eq!(result.files_written, 6);
    assert!(md_dir
        .join("daily")
        .join(format!("{}.md", note.local_date))
        .exists());
    assert_eq!(
        std::fs::read_to_string(md_dir.join("buffers/draft-1.md")).unwrap(),
        "Unsaved scratch"
    );
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}
