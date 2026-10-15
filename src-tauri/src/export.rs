use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};

use crate::db::{Db, DbResult};
use crate::models::ExportResult;

pub fn export_json_to_dir(db: &Db, export_root: &Path) -> DbResult<ExportResult> {
    fs::create_dir_all(export_root)?;
    let payload = db.export_all_json()?;
    let file_path = export_root.join("export.json");
    fs::write(&file_path, serde_json::to_vec_pretty(&payload)?)?;

    Ok(ExportResult {
        export_dir: export_root.to_string_lossy().to_string(),
        files_written: 1,
    })
}

pub fn export_markdown_to_dir(db: &Db, export_root: &Path) -> DbResult<ExportResult> {
    fs::create_dir_all(export_root)?;
    let daily_dir = export_root.join("daily");
    let cat_dir = export_root.join("categories");
    fs::create_dir_all(&daily_dir)?;
    fs::create_dir_all(&cat_dir)?;

    let export = db.export_all_json()?;

    // Daily notes
    let mut files = 0i64;
    if let Some(notes) = export.get("notes").and_then(|v| v.as_array()) {
        let mut by_date: std::collections::BTreeMap<String, Vec<&serde_json::Value>> =
            std::collections::BTreeMap::new();
        for n in notes {
            if let Some(d) = n.get("local_date").and_then(|v| v.as_str()) {
                by_date.entry(d.to_string()).or_default().push(n);
            }
        }
        for (date, items) in by_date {
            let mut md = String::new();
            md.push_str(&format!("# {date}\n\n"));
            let mut items_sorted = items;
            items_sorted
                .sort_by_key(|n| n.get("local_time").and_then(|v| v.as_str()).unwrap_or(""));
            for n in items_sorted {
                let time = n
                    .get("local_time")
                    .and_then(|v| v.as_str())
                    .unwrap_or("00:00:00");
                let content = n.get("content").and_then(|v| v.as_str()).unwrap_or("");
                md.push_str(&format!(
                    "## {}\n\n{}\n\n---\n\n",
                    &time[0..5.min(time.len())],
                    content
                ));
            }
            let path = daily_dir.join(format!("{}.md", sanitize_filename(&date)));
            fs::write(path, md)?;
            files += 1;
        }
    }

    // Categories
    if let Some(categories) = export.get("categories").and_then(|v| v.as_array()) {
        for (index, c) in categories.iter().enumerate() {
            let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("category");
            let filename = format!("category-{}-{}", index + 1, sanitize_filename(name));
            let mut md = String::new();
            md.push_str(&format!("# {name}\n\n"));

            let mut by_date: std::collections::BTreeMap<String, Vec<&serde_json::Value>> =
                std::collections::BTreeMap::new();
            if let Some(entries) = c.get("entries").and_then(|v| v.as_array()) {
                for e in entries {
                    if let Some(d) = e.get("source_date").and_then(|v| v.as_str()) {
                        by_date.entry(d.to_string()).or_default().push(e);
                    }
                }
            }
            for (date, entries) in by_date.into_iter().rev() {
                md.push_str(&format!("## {date}\n\n"));
                for e in entries {
                    let content = e.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    md.push_str(content);
                    md.push_str("\n\n---\n\n");
                }
            }

            let path = cat_dir.join(format!("{filename}.md"));
            fs::write(path, md)?;
            files += 1;
        }
    }

    // Include working buffers, even when they have not been saved as notes.
    if let Some(buffers) = export
        .pointer("/workspace/buffers")
        .and_then(|v| v.as_array())
    {
        let drafts_dir = export_root.join("buffers");
        fs::create_dir_all(&drafts_dir)?;
        for (index, buffer) in buffers.iter().enumerate() {
            let text = buffer.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if text.is_empty() {
                continue;
            }
            fs::write(drafts_dir.join(format!("draft-{}.md", index + 1)), text)?;
            files += 1;
        }
    }

    // Historical generated content is archived, never regenerated.
    if let Some(summaries) = export.get("summaries").and_then(|v| v.as_array()) {
        if !summaries.is_empty() {
            let archive = export_root.join("legacy-summaries");
            fs::create_dir_all(&archive)?;
            for (index, summary) in summaries.iter().enumerate() {
                let title = summary.get("title").and_then(|v| v.as_str()).unwrap_or("");
                let text = summary
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                fs::write(
                    archive.join(format!("summary-{}.md", index + 1)),
                    format!("# {title}\n\n{text}\n"),
                )?;
                files += 1;
            }
        }
    }

    // Add a small manifest.
    let manifest = serde_json::json!({
      "exported_at": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
      "format": "markdown",
      "files_written": files
    });
    fs::write(
        export_root.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    files += 1;

    Ok(ExportResult {
        export_dir: export_root.to_string_lossy().to_string(),
        files_written: files,
    })
}

pub fn new_export_dir(app_data_dir: &Path) -> PathBuf {
    let ts = format!(
        "{}-{}",
        Utc::now().format("%Y%m%d-%H%M%S"),
        uuid::Uuid::new_v4()
    );
    app_data_dir.join("exports").join(ts)
}

fn sanitize_filename(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        let ok = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ';
        out.push(if ok { ch } else { '-' });
    }
    out.trim().replace(' ', "-").to_lowercase()
}
