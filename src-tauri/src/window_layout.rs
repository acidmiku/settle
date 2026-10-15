use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

#[derive(Default)]
pub struct WindowLayout(Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>, bool)>>);

// Sidecar is a tall capture window at the right edge; Tape is a shallow strip.
// Leaving either design restores the bounds the user had before choosing it.
pub fn apply(app: &AppHandle, design: &str) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let state = app.state::<WindowLayout>();
    let mut saved = state
        .0
        .lock()
        .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e.to_string())))?;
    if !["sidecar", "tape"].contains(&design) {
        if let Some((position, size, maximized)) = *saved {
            if window.is_maximized()? {
                window.unmaximize()?;
            }
            window.set_size(size)?;
            window.set_position(position)?;
            if maximized {
                window.maximize()?;
            }
            *saved = None;
        }
        return Ok(());
    }
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    if saved.is_none() {
        *saved = Some((
            window.outer_position()?,
            window.inner_size()?,
            window.is_maximized()?,
        ));
    }
    if window.is_maximized()? {
        window.unmaximize()?;
    }
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let margin = (16.0 * scale) as u32;
    let width = ((if design == "sidecar" { 680.0 } else { 1100.0 }) * scale) as u32;
    let height = ((if design == "sidecar" { 900.0 } else { 420.0 }) * scale) as u32;
    let width = width.min(area.size.width.saturating_sub(margin * 2));
    // Leave room for the native macOS titlebar as well as the window shadow.
    let height = height.min(
        area.size
            .height
            .saturating_sub(margin * 2 + (32.0 * scale) as u32),
    );
    window.set_size(PhysicalSize::new(width, height))?;
    let x = if design == "sidecar" {
        area.size.width.saturating_sub(width + margin)
    } else {
        area.size.width.saturating_sub(width) / 2
    };
    let y = if design == "sidecar" {
        margin
    } else {
        area.size.height.saturating_sub(height) / 2
    };
    window.set_position(PhysicalPosition::new(
        area.position.x + x as i32,
        area.position.y + y as i32,
    ))?;
    Ok(())
}
