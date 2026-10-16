use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState(tauri::async_runtime::Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[tauri::command]
pub async fn get_start_with_os(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || app.autolaunch().is_enabled())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_start_with_os(app: AppHandle, enabled: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.autolaunch();
        if enabled {
            manager.enable()?;
        } else {
            manager.disable()?;
        }
        manager.is_enabled()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<AvailableUpdate>, String> {
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "An update is already busy")?;
    *pending = None;
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let available = update.as_ref().map(|update| AvailableUpdate {
        version: update.version.clone(),
        notes: update.body.clone(),
    });
    *pending = update;
    Ok(available)
}

#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    // Keep the checked update in Rust; the frontend cannot choose a URL or signature.
    // Serializing check/install also prevents duplicate installers and stale results.
    let pending = state
        .0
        .try_lock()
        .map_err(|_| "An update is already busy")?;
    let mut update = pending.clone().ok_or("Check for an update first")?;
    update.timeout = Some(Duration::from_secs(300));
    let mut downloaded = 0_u64;
    let bytes = update
        .download(
            |length, total| {
                downloaded += length as u64;
                let _ = app.emit(
                    "settle:update-progress",
                    serde_json::json!({"phase":"downloading", "downloaded":downloaded, "total":total}),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    // download verifies the release signature before returning any bytes to install.
    let _ = app.emit(
        "settle:update-progress",
        serde_json::json!({"phase":"installing"}),
    );
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    // Windows hands off to NSIS and exits during install; macOS restarts here.
    app.restart();
}
