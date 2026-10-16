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
    assert_eq!(db.search("Original", 30).unwrap().len(), 1);
    assert!(db.list_notes(None, false, 0, 100).unwrap()[0]
        .title
        .is_none());
    assert!(db.list_notes(None, true, 0, 100).unwrap()[0]
        .folder_id
        .is_none());
    db.delete_note("n1").unwrap();
    let data = db.export_all_json().unwrap();
    assert_eq!(data["summaries"][0]["summary"], "Old summary");
    assert_eq!(data["categories"][0]["entries"][0]["content"], "Old entry");
    assert!(data["categories"][0]["entries"][0]["note_id"].is_null());
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn folders_names_search_and_exports_survive_reopen_without_touching_content() {
    let (db, dir) = database();
    let work = db.create_folder("Work").unwrap();
    let ideas = db.create_folder("Ideas").unwrap();
    assert!(db.create_folder("work").is_err());
    assert!(db.create_folder("  ").is_err());
    let note = db
        .create_note("# Original\n\n**Keep this**\n", None, Some(&work.id))
        .unwrap();
    db.rename_note(&note.id, Some("  Project Aurora  "))
        .unwrap();
    assert_eq!(
        db.search("aurora", 10).unwrap()[0].title.as_deref(),
        Some("Project Aurora")
    );
    assert_eq!(db.search("original", 10).unwrap().len(), 1);
    assert_eq!(
        db.list_folders()
            .unwrap()
            .iter()
            .find(|f| f.id == work.id)
            .unwrap()
            .note_count,
        1
    );
    db.move_note(&note.id, Some(&ideas.id)).unwrap();
    assert!(db
        .list_notes(Some(&work.id), false, 0, 100)
        .unwrap()
        .is_empty());
    assert_eq!(
        db.list_notes(Some(&ideas.id), false, 0, 100).unwrap()[0].content,
        note.content
    );
    assert!(db.move_note(&note.id, Some("missing")).is_err());
    assert!(db.rename_note("missing", Some("Name")).is_err());
    assert!(db.rename_note(&note.id, Some("bad\nname")).is_err());
    assert!(db.create_note("Keep", None, Some("missing")).is_err());
    db.rename_folder(&ideas.id, "Personal").unwrap();
    let export = db.export_all_json().unwrap();
    assert_eq!(export["notes"][0]["title"], "Project Aurora");
    assert_eq!(export["notes"][0]["folder_id"], ideas.id);
    let md = export::new_export_dir(&dir);
    export::export_markdown_to_dir(&db, &md).unwrap();
    let text =
        std::fs::read_to_string(md.join("daily").join(format!("{}.md", note.local_date))).unwrap();
    assert!(text.contains("Project Aurora"));
    assert!(text.contains("Folder: Personal"));
    assert!(text.contains(&note.content));
    drop(db);
    let db = Db::new(dir.join("settle.sqlite3")).unwrap();
    db.migrate().unwrap();
    assert_eq!(
        db.list_notes(None, false, 0, 100).unwrap()[0]
            .title
            .as_deref(),
        Some("Project Aurora")
    );
    db.delete_folder(&ideas.id).unwrap();
    assert_eq!(
        db.list_notes(None, true, 0, 100).unwrap()[0].content,
        note.content
    );
    db.rename_note(&note.id, Some(" ")).unwrap();
    assert!(db.search("Aurora", 10).unwrap().is_empty());
    assert!(db.list_notes(None, true, 0, 100).unwrap()[0]
        .title
        .is_none());
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn library_pages_are_ordered_by_local_date_and_never_skip_equal_timestamps() {
    let (db, dir) = database();
    let conn = Connection::open(dir.join("settle.sqlite3")).unwrap();
    for index in 0..125 {
        conn.execute("INSERT INTO notes(id,content,local_date,local_time,created_at,tags) VALUES (?1,'Text',?2,'12:00:00','2026-10-15T12:00:00Z','[]')", params![format!("n-{index:03}"), if index < 60 {"2026-10-14"} else {"2026-10-15"}]).unwrap();
    }
    let first = db.list_notes(None, false, 0, 100).unwrap();
    let second = db.list_notes(None, false, 100, 100).unwrap();
    assert_eq!(first.len(), 100);
    assert_eq!(second.len(), 25);
    assert_eq!(first[0].id, "n-124");
    assert_eq!(second[24].id, "n-000");
    let ids: std::collections::HashSet<_> = first.iter().chain(&second).map(|n| &n.id).collect();
    assert_eq!(ids.len(), 125);
    drop(conn);
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn note_lifecycle_searches_literal_input_and_preserves_plain_text() {
    let (db, dir) = database();
    let text = "Desk rebuild #work #work\nПривет 世界\n  ";
    let note = db.create_note(text, None, None).unwrap();
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
    assert!(db.create_note(" \n ", None, None).is_err());
    db.delete_note(&note.id).unwrap();
    assert!(db.search("Changed", 10).unwrap().is_empty());
    assert!(db.update_note(&note.id, "Missing").is_err());
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn exports_notes_buffers_and_legacy_without_filename_collisions() {
    let (db, dir) = database();
    let note = db.create_note("A note", None, None).unwrap();
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
