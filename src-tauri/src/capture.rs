use base64::Engine;
use crate::window::is_screen_share_protection_enabled;
use image::codecs::png::PngEncoder;
use image::{ColorType, GenericImageView, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::{thread, time::Duration};
use tauri::Emitter;
use tauri::{Manager, Monitor as TauriMonitor, WebviewUrl, WebviewWindowBuilder};
use xcap::Monitor as CaptureMonitor;

#[cfg(target_os = "linux")]
use dbus::{
    arg::{AppendAll, Iter, IterAppend, PropMap, ReadAll, RefArg, TypeMismatchError, Variant},
    blocking::Connection,
    message::{MatchRule, SignalArgs},
};
#[cfg(target_os = "linux")]
use std::env::{temp_dir, var_os};
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::path::PathBuf;
#[cfg(target_os = "linux")]
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(target_os = "linux")]
use url::Url;
#[cfg(target_os = "linux")]
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct SelectionCoords {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct MonitorInfo {
    pub image: image::RgbaImage,
}

#[derive(Debug, Clone)]
struct OverlayWindowPlacement {
    logical_width: f64,
    logical_height: f64,
    logical_x: f64,
    logical_y: f64,
    is_primary: bool,
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone)]
struct MonitorRegion {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy)]
struct DesktopBounds {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
}

#[cfg(target_os = "linux")]
#[derive(Debug)]
struct PortalRequestResponse {
    status: u32,
    results: PropMap,
}

#[cfg(target_os = "linux")]
impl AppendAll for PortalRequestResponse {
    fn append(&self, i: &mut IterAppend) {
        RefArg::append(&self.status, i);
        RefArg::append(&self.results, i);
    }
}

#[cfg(target_os = "linux")]
impl ReadAll for PortalRequestResponse {
    fn read(i: &mut Iter) -> Result<Self, TypeMismatchError> {
        Ok(Self {
            status: i.read()?,
            results: i.read()?,
        })
    }
}

#[cfg(target_os = "linux")]
impl SignalArgs for PortalRequestResponse {
    const NAME: &'static str = "Response";
    const INTERFACE: &'static str = "org.freedesktop.portal.Request";
}

// Store captured images from all monitors temporarily for cropping
pub struct CaptureState {
    pub captured_monitors: Arc<Mutex<HashMap<usize, MonitorInfo>>>,
    pub overlay_active: Arc<AtomicBool>,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self {
            captured_monitors: Arc::default(),
            overlay_active: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn encode_png_base64(image: &image::RgbaImage) -> Result<String, String> {
    let mut png_buffer = Vec::new();
    PngEncoder::new(&mut png_buffer)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|e| format!("Failed to encode to PNG: {}", e))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(png_buffer))
}

fn is_cancelled_message(message: &str) -> bool {
    let normalized = message.to_lowercase();
    normalized.contains("cancelled") || normalized.contains("canceled")
}

fn destroy_capture_overlays(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("capture-overlay-") {
            window.destroy().ok();
        }
    }
}

fn overlay_placement_from_tauri(
    monitor: &TauriMonitor,
    is_primary: bool,
) -> OverlayWindowPlacement {
    let scale_factor = monitor.scale_factor();
    let size = monitor.size();
    let position = monitor.position();

    OverlayWindowPlacement {
        logical_width: size.width as f64 / scale_factor,
        logical_height: size.height as f64 / scale_factor,
        logical_x: position.x as f64 / scale_factor,
        logical_y: position.y as f64 / scale_factor,
        is_primary,
    }
}

fn overlay_placement_from_capture_monitor(monitor: &CaptureMonitor) -> OverlayWindowPlacement {
    OverlayWindowPlacement {
        logical_width: monitor.width() as f64,
        logical_height: monitor.height() as f64,
        logical_x: monitor.x() as f64,
        logical_y: monitor.y() as f64,
        is_primary: monitor.is_primary(),
    }
}

fn same_tauri_monitor(left: &TauriMonitor, right: &TauriMonitor) -> bool {
    let left_position = left.position();
    let right_position = right.position();
    let left_size = left.size();
    let right_size = right.size();

    left.name() == right.name()
        && left_position.x == right_position.x
        && left_position.y == right_position.y
        && left_size.width == right_size.width
        && left_size.height == right_size.height
}

fn create_capture_overlays(
    app: &tauri::AppHandle,
    placements: &[OverlayWindowPlacement],
) -> Result<(), String> {
    destroy_capture_overlays(app);

    for (idx, placement) in placements.iter().enumerate() {
        let window_label = format!("capture-overlay-{}", idx);

        let overlay =
            WebviewWindowBuilder::new(app, &window_label, WebviewUrl::App("index.html".into()))
                .title("Screen Capture")
                .inner_size(placement.logical_width, placement.logical_height)
                .position(placement.logical_x, placement.logical_y)
                .transparent(true)
                .always_on_top(true)
                .decorations(false)
                .skip_taskbar(true)
                .resizable(false)
                .closable(false)
                .minimizable(false)
                .maximizable(false)
                .visible(false)
                .focused(true)
                .accept_first_mouse(true)
                .content_protected(is_screen_share_protection_enabled(app))
                .build()
                .map_err(|e| format!("Failed to create overlay window {}: {}", idx, e))?;

        thread::sleep(Duration::from_millis(100));

        overlay.show().ok();
        overlay.set_always_on_top(true).ok();

        if placement.is_primary {
            overlay.set_focus().ok();
            overlay
                .request_user_attention(Some(tauri::UserAttentionType::Critical))
                .ok();
        }
    }

    thread::sleep(Duration::from_millis(100));

    if let Some(primary_idx) = placements.iter().position(|placement| placement.is_primary) {
        let window_label = format!("capture-overlay-{}", primary_idx);
        if let Some(window) = app.get_webview_window(&window_label) {
            window.set_focus().ok();
        }
    }

    Ok(())
}

fn capture_monitors_with_xcap(
    app: &tauri::AppHandle,
) -> Result<(HashMap<usize, MonitorInfo>, Vec<OverlayWindowPlacement>), String> {
    let capture_monitors =
        CaptureMonitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if capture_monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let tauri_monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitor layout: {}", e))?;
    let primary_monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get primary monitor: {}", e))?;

    if !tauri_monitors.is_empty() && tauri_monitors.len() != capture_monitors.len() {
        eprintln!(
            "Monitor count mismatch between capture ({}) and layout ({})",
            capture_monitors.len(),
            tauri_monitors.len()
        );
    }

    let mut captured_monitors = HashMap::new();
    let mut placements = Vec::with_capacity(capture_monitors.len());

    for (idx, monitor) in capture_monitors.iter().enumerate() {
        let captured_image = monitor
            .capture_image()
            .map_err(|e| format!("Failed to capture monitor {}: {}", idx, e))?;

        captured_monitors.insert(
            idx,
            MonitorInfo {
                image: captured_image,
            },
        );

        let placement = if let Some(display) = tauri_monitors.get(idx) {
            let is_primary = primary_monitor
                .as_ref()
                .map(|primary| same_tauri_monitor(primary, display))
                .unwrap_or_else(|| monitor.is_primary());
            overlay_placement_from_tauri(display, is_primary)
        } else {
            overlay_placement_from_capture_monitor(monitor)
        };

        placements.push(placement);
    }

    Ok((captured_monitors, placements))
}

#[cfg(target_os = "linux")]
fn is_wayland_session() -> bool {
    let session_type = var_os("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let wayland_display = var_os("WAYLAND_DISPLAY")
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    session_type == "wayland" || wayland_display.contains("wayland")
}

#[cfg(target_os = "linux")]
fn monitor_region_from_tauri(monitor: &TauriMonitor) -> MonitorRegion {
    let position = monitor.position();
    let size = monitor.size();

    MonitorRegion {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

#[cfg(target_os = "linux")]
fn desktop_bounds(regions: &[MonitorRegion]) -> Option<DesktopBounds> {
    let left = regions.iter().map(|region| region.x).min()?;
    let top = regions.iter().map(|region| region.y).min()?;
    let right = regions
        .iter()
        .map(|region| {
            region
                .x
                .saturating_add(region.width.min(i32::MAX as u32) as i32)
        })
        .max()?;
    let bottom = regions
        .iter()
        .map(|region| {
            region
                .y
                .saturating_add(region.height.min(i32::MAX as u32) as i32)
        })
        .max()?;

    Some(DesktopBounds {
        left,
        top,
        width: right.saturating_sub(left) as u32,
        height: bottom.saturating_sub(top) as u32,
    })
}

#[cfg(target_os = "linux")]
fn crop_region_from_desktop(
    desktop_image: &image::RgbaImage,
    region: &MonitorRegion,
    bounds: DesktopBounds,
) -> Result<image::RgbaImage, String> {
    if desktop_image.width() == 0 || desktop_image.height() == 0 {
        return Err("Captured desktop image was empty".to_string());
    }

    if bounds.width == 0 || bounds.height == 0 {
        return Err("Computed desktop bounds were empty".to_string());
    }

    let scale_x = desktop_image.width() as f64 / bounds.width as f64;
    let scale_y = desktop_image.height() as f64 / bounds.height as f64;

    let left = (((region.x - bounds.left) as f64) * scale_x)
        .floor()
        .max(0.0) as u32;
    let top = (((region.y - bounds.top) as f64) * scale_y)
        .floor()
        .max(0.0) as u32;
    let right = ((((region.x - bounds.left) as f64) + region.width as f64) * scale_x)
        .ceil()
        .min(desktop_image.width() as f64) as u32;
    let bottom = ((((region.y - bounds.top) as f64) + region.height as f64) * scale_y)
        .ceil()
        .min(desktop_image.height() as f64) as u32;

    if right <= left || bottom <= top {
        return Err("Captured desktop image did not include the selected monitor".to_string());
    }

    Ok(desktop_image
        .view(left, top, right - left, bottom - top)
        .to_image())
}

#[cfg(target_os = "linux")]
fn temp_capture_path(prefix: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros();

    temp_dir().join(format!("{prefix}-{timestamp}.png"))
}

#[cfg(target_os = "linux")]
fn resolve_screenshot_path(path_or_uri: &str) -> Result<PathBuf, String> {
    if path_or_uri.starts_with("file://") {
        Url::parse(path_or_uri)
            .map_err(|e| format!("Invalid screenshot URI: {}", e))?
            .to_file_path()
            .map_err(|_| "Screenshot API returned a non-file URI".to_string())
    } else {
        Ok(PathBuf::from(path_or_uri))
    }
}

#[cfg(target_os = "linux")]
fn read_screenshot_image(path_or_uri: &str, context: &str) -> Result<image::RgbaImage, String> {
    let output_path = resolve_screenshot_path(path_or_uri)?;
    let image = image::open(&output_path)
        .map_err(|e| format!("Failed to read {} screenshot: {}", context, e))?
        .to_rgba8();
    let _ = fs::remove_file(output_path);

    Ok(image)
}

#[cfg(target_os = "linux")]
fn capture_gnome_shell_desktop_image(conn: &Connection) -> Result<image::RgbaImage, String> {
    let output_path = temp_capture_path("cidio-screen");
    let output_path_str = output_path.to_string_lossy().to_string();
    let proxy = conn.with_proxy(
        "org.gnome.Shell.Screenshot",
        "/org/gnome/Shell/Screenshot",
        Duration::from_secs(10),
    );

    let (success, saved_path): (bool, String) = proxy
        .method_call(
            "org.gnome.Shell.Screenshot",
            "Screenshot",
            (false, false, &output_path_str),
        )
        .map_err(|e| format!("GNOME Shell screenshot API unavailable: {}", e))?;

    if !success {
        let _ = fs::remove_file(&output_path);
        return Err("GNOME Shell screenshot service returned failure".to_string());
    }

    let final_path = if saved_path.is_empty() {
        output_path.to_string_lossy().to_string()
    } else {
        saved_path
    };

    read_screenshot_image(&final_path, "GNOME Shell")
}

#[cfg(target_os = "linux")]
fn capture_gnome_shell_interactive_image(conn: &Connection) -> Result<image::RgbaImage, String> {
    let proxy = conn.with_proxy(
        "org.gnome.Shell.Screenshot",
        "/org/gnome/Shell/Screenshot",
        Duration::from_secs(120),
    );

    let (success, screenshot_uri): (bool, String) = proxy
        .method_call("org.gnome.Shell.Screenshot", "InteractiveScreenshot", ())
        .map_err(|e| format!("GNOME interactive screenshot API unavailable: {}", e))?;

    if !success {
        return Err("Interactive screenshot was cancelled".to_string());
    }

    if screenshot_uri.is_empty() {
        return Err("Interactive screenshot did not return an image".to_string());
    }

    read_screenshot_image(&screenshot_uri, "GNOME interactive")
}

#[cfg(target_os = "linux")]
fn capture_portal_screenshot_image(
    conn: &Connection,
    interactive: bool,
) -> Result<image::RgbaImage, String> {
    let status: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
    let screenshot_uri: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let status_handle = status.clone();
    let uri_handle = screenshot_uri.clone();

    let mut match_rule = MatchRule::new_signal("org.freedesktop.portal.Request", "Response");
    match_rule.eavesdrop = false;
    conn.add_match(
        match_rule,
        move |response: PortalRequestResponse, _conn, _msg| {
            if let Ok(mut status_guard) = status_handle.lock() {
                *status_guard = Some(response.status);
            }

            let uri = response
                .results
                .get("uri")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());

            if let (Some(uri), Ok(mut uri_guard)) = (uri, uri_handle.lock()) {
                *uri_guard = Some(uri);
            }

            true
        },
    )
    .map_err(|e| format!("Failed to listen for portal screenshot response: {}", e))?;

    let proxy = conn.with_proxy(
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        Duration::from_secs(10),
    );

    let mut options: PropMap = HashMap::new();
    options.insert(
        "handle_token".to_string(),
        Variant(Box::new(format!("cidio{}", Uuid::new_v4().simple()))),
    );
    options.insert("modal".to_string(), Variant(Box::new(true)));
    options.insert("interactive".to_string(), Variant(Box::new(interactive)));

    proxy
        .method_call::<(), _, _, _>(
            "org.freedesktop.portal.Screenshot",
            "Screenshot",
            ("", options),
        )
        .map_err(|e| format!("xdg-desktop-portal screenshot request failed: {}", e))?;

    for _ in 0..60 {
        conn.process(Duration::from_secs(1))
            .map_err(|e| format!("Failed waiting for portal screenshot response: {}", e))?;

        if status
            .lock()
            .map_err(|_| "Failed to read portal screenshot status".to_string())?
            .is_some()
        {
            break;
        }
    }

    let status = *status
        .lock()
        .map_err(|_| "Failed to read portal screenshot status".to_string())?;
    let screenshot_uri = screenshot_uri
        .lock()
        .map_err(|_| "Failed to read portal screenshot URI".to_string())?
        .clone();

    match status {
        Some(0) => {}
        Some(1) => return Err("Screenshot request was cancelled".to_string()),
        Some(2) if interactive => return Err("Interactive screenshot was cancelled".to_string()),
        Some(code) => return Err(format!("Portal screenshot failed with status {}", code)),
        None => return Err("Timed out waiting for the screenshot portal".to_string()),
    }

    let screenshot_uri = screenshot_uri
        .ok_or_else(|| "Portal screenshot did not return an image URI".to_string())?;
    read_screenshot_image(&screenshot_uri, "portal")
}

#[cfg(target_os = "linux")]
fn capture_wayland_desktop_image() -> Result<image::RgbaImage, String> {
    let conn = Connection::new_session()
        .map_err(|e| format!("Failed to connect to the desktop session bus: {}", e))?;

    capture_gnome_shell_desktop_image(&conn).or_else(|gnome_error| {
        capture_portal_screenshot_image(&conn, false).map_err(|portal_error| {
            format!(
                "Wayland screenshot capture failed. GNOME Shell error: {}. Portal error: {}",
                gnome_error, portal_error
            )
        })
    })
}

#[cfg(target_os = "linux")]
fn capture_wayland_interactive_image() -> Result<image::RgbaImage, String> {
    let conn = Connection::new_session()
        .map_err(|e| format!("Failed to connect to the desktop session bus: {}", e))?;

    capture_gnome_shell_interactive_image(&conn).or_else(|gnome_error| {
        capture_portal_screenshot_image(&conn, true).map_err(|portal_error| {
            format!(
                "Wayland interactive screenshot failed. GNOME Shell error: {}. Portal error: {}",
                gnome_error, portal_error
            )
        })
    })
}

#[cfg(target_os = "linux")]
fn capture_monitors_with_wayland(
    app: &tauri::AppHandle,
) -> Result<(HashMap<usize, MonitorInfo>, Vec<OverlayWindowPlacement>), String> {
    let tauri_monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitor layout: {}", e))?;

    if tauri_monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let primary_monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get primary monitor: {}", e))?;
    let desktop_image = capture_wayland_desktop_image()?;
    let regions = tauri_monitors
        .iter()
        .map(monitor_region_from_tauri)
        .collect::<Vec<_>>();
    let bounds =
        desktop_bounds(&regions).ok_or_else(|| "Unable to determine monitor bounds".to_string())?;

    let mut captured_monitors = HashMap::new();
    let mut placements = Vec::with_capacity(tauri_monitors.len());

    for (idx, monitor) in tauri_monitors.iter().enumerate() {
        let region = monitor_region_from_tauri(monitor);
        let image = crop_region_from_desktop(&desktop_image, &region, bounds)?;
        let is_primary = primary_monitor
            .as_ref()
            .map(|primary| same_tauri_monitor(primary, monitor))
            .unwrap_or(idx == 0);

        captured_monitors.insert(idx, MonitorInfo { image });
        placements.push(overlay_placement_from_tauri(monitor, is_primary));
    }

    Ok((captured_monitors, placements))
}

#[tauri::command]
pub async fn start_screen_capture(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<CaptureState>();
    if state.overlay_active.load(Ordering::SeqCst) {
        let _ = close_overlay_window(app.clone());
    }
    state.overlay_active.store(true, Ordering::SeqCst);

    let capture_result = {
        #[cfg(target_os = "linux")]
        {
            if is_wayland_session() {
                let interactive_result =
                    tauri::async_runtime::spawn_blocking(capture_wayland_interactive_image)
                        .await
                        .map_err(|e| format!("Task panicked: {}", e))?;

                match interactive_result {
                    Ok(image) => {
                        let base64_str = encode_png_base64(&image)?;
                        state.captured_monitors.lock().unwrap().clear();
                        state.overlay_active.store(false, Ordering::SeqCst);
                        app.emit("captured-selection", &base64_str).map_err(|e| {
                            format!("Failed to emit captured-selection event: {}", e)
                        })?;
                        return Ok(());
                    }
                    Err(interactive_error) => {
                        if is_cancelled_message(&interactive_error) {
                            state.captured_monitors.lock().unwrap().clear();
                            state.overlay_active.store(false, Ordering::SeqCst);
                            if let Some(main_window) = app.get_webview_window("main") {
                                main_window.emit("capture-closed", ()).ok();
                            }
                            return Ok(());
                        }

                        capture_monitors_with_wayland(&app).map_err(|direct_error| {
                            format!(
                                "{}. Direct capture fallback error: {}",
                                interactive_error, direct_error
                            )
                        })
                    }
                }
            } else {
                capture_monitors_with_xcap(&app)
            }
        }

        #[cfg(not(target_os = "linux"))]
        {
            capture_monitors_with_xcap(&app)
        }
    };

    let (captured_monitors, placements) = match capture_result {
        Ok(result) => result,
        Err(error) => {
            state.overlay_active.store(false, Ordering::SeqCst);
            return Err(error);
        }
    };

    *state.captured_monitors.lock().unwrap() = captured_monitors;

    if let Err(error) = create_capture_overlays(&app, &placements) {
        state.captured_monitors.lock().unwrap().clear();
        state.overlay_active.store(false, Ordering::SeqCst);
        return Err(error);
    }

    Ok(())
}

// close overlay window
#[tauri::command]
pub fn close_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    // Get all webview windows and close those that are capture overlays
    let webview_windows = app.webview_windows();

    for (label, window) in webview_windows.iter() {
        if label.starts_with("capture-overlay-") {
            window.destroy().ok();
        }
    }

    // Clear captured monitors from state
    let state = app.state::<CaptureState>();
    state.captured_monitors.lock().unwrap().clear();
    state.overlay_active.store(false, Ordering::SeqCst);

    // Emit an event to the main window to signal that the overlay has been closed
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.emit("capture-closed", ()).unwrap();
    }

    Ok(())
}

#[tauri::command]
pub async fn capture_selected_area(
    app: tauri::AppHandle,
    coords: SelectionCoords,
    monitor_index: usize,
) -> Result<String, String> {
    let state = app.state::<CaptureState>();
    let mut captured_monitors = state.captured_monitors.lock().unwrap();

    let monitor_info = captured_monitors.remove(&monitor_index).ok_or({
        state.overlay_active.store(false, Ordering::SeqCst);
        format!("No captured image found for monitor {}", monitor_index)
    })?;

    if coords.width == 0 || coords.height == 0 {
        return Err("Invalid selection dimensions".to_string());
    }

    let img_width = monitor_info.image.width();
    let img_height = monitor_info.image.height();

    let x = coords.x.min(img_width.saturating_sub(1));
    let y = coords.y.min(img_height.saturating_sub(1));
    let width = coords.width.min(img_width - x);
    let height = coords.height.min(img_height - y);

    let cropped = monitor_info.image.view(x, y, width, height).to_image();
    let base64_str = encode_png_base64(&cropped)?;

    captured_monitors.clear();
    drop(captured_monitors);

    destroy_capture_overlays(&app);

    app.emit("captured-selection", &base64_str)
        .map_err(|e| format!("Failed to emit captured-selection event: {}", e))?;

    state.overlay_active.store(false, Ordering::SeqCst);

    Ok(base64_str)
}

#[tauri::command]
pub async fn capture_to_base64(window: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    if is_wayland_session() {
        let target_monitor = window
            .current_monitor()
            .map_err(|e| format!("Failed to get current monitor: {}", e))?
            .or_else(|| window.primary_monitor().ok().flatten())
            .ok_or_else(|| "No monitors found".to_string())?;
        let monitor_regions = window
            .available_monitors()
            .map_err(|e| format!("Failed to get monitor layout: {}", e))?
            .iter()
            .map(monitor_region_from_tauri)
            .collect::<Vec<_>>();
        let target_region = monitor_region_from_tauri(&target_monitor);

        return tauri::async_runtime::spawn_blocking(move || {
            let bounds = desktop_bounds(&monitor_regions)
                .ok_or_else(|| "Unable to determine monitor bounds".to_string())?;
            match capture_wayland_desktop_image()
                .and_then(|desktop_image| {
                    crop_region_from_desktop(&desktop_image, &target_region, bounds)
                })
                .and_then(|image| encode_png_base64(&image))
            {
                Ok(base64) => Ok(base64),
                Err(direct_error) => match capture_wayland_interactive_image() {
                    Ok(image) => encode_png_base64(&image),
                    Err(interactive_error) if is_cancelled_message(&interactive_error) => {
                        Err("Screenshot capture cancelled".to_string())
                    }
                    Err(interactive_error) => Err(format!(
                        "{}. Interactive capture fallback error: {}",
                        direct_error, interactive_error
                    )),
                },
            }
        })
        .await
        .map_err(|e| format!("Task panicked: {}", e))?;
    }

    let monitor_fallback = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let geometry = match (window.outer_position(), window.outer_size()) {
        (Ok(position), Ok(size)) => {
            let width = size.width.min(i32::MAX as u32) as i32;
            let height = size.height.min(i32::MAX as u32) as i32;
            let left = position.x;
            let top = position.y;
            (
                left,
                top,
                left.saturating_add(width),
                top.saturating_add(height),
                left.saturating_add(width / 2),
                top.saturating_add(height / 2),
            )
        }
        _ => {
            if let Some(monitor) = &monitor_fallback {
                let position = monitor.position();
                let size = monitor.size();
                let width = size.width.min(i32::MAX as u32) as i32;
                let height = size.height.min(i32::MAX as u32) as i32;
                let left = position.x;
                let top = position.y;
                (
                    left,
                    top,
                    left.saturating_add(width),
                    top.saturating_add(height),
                    left.saturating_add(width / 2),
                    top.saturating_add(height / 2),
                )
            } else {
                (0, 0, 0, 0, 0, 0)
            }
        }
    };

    let (window_left, window_top, window_right, window_bottom, window_center_x, window_center_y) =
        geometry;

    tauri::async_runtime::spawn_blocking(move || {
        let monitors =
            CaptureMonitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;
        if monitors.is_empty() {
            return Err("No monitors found".to_string());
        }

        let mut best_idx: Option<usize> = None;
        let mut best_area: i64 = 0;

        for (idx, monitor) in monitors.iter().enumerate() {
            let monitor_left = monitor.x();
            let monitor_top = monitor.y();
            let monitor_right = monitor_left.saturating_add(monitor.width() as i32);
            let monitor_bottom = monitor_top.saturating_add(monitor.height() as i32);

            let overlap_width =
                (window_right.min(monitor_right) - window_left.max(monitor_left)).max(0);
            let overlap_height =
                (window_bottom.min(monitor_bottom) - window_top.max(monitor_top)).max(0);
            let area = (overlap_width as i64) * (overlap_height as i64);

            if area > best_area {
                best_area = area;
                best_idx = Some(idx);
            }
        }

        let target_idx = if let Some(idx) = best_idx {
            idx
        } else {
            let mut closest_idx = 0usize;
            let mut closest_distance = i128::MAX;

            for (idx, monitor) in monitors.iter().enumerate() {
                let monitor_center_x = monitor.x().saturating_add(monitor.width() as i32 / 2);
                let monitor_center_y = monitor.y().saturating_add(monitor.height() as i32 / 2);
                let dx = (window_center_x - monitor_center_x) as i128;
                let dy = (window_center_y - monitor_center_y) as i128;
                let distance = dx * dx + dy * dy;

                if distance < closest_distance {
                    closest_distance = distance;
                    closest_idx = idx;
                }
            }

            closest_idx
        };

        let monitor = monitors
            .into_iter()
            .enumerate()
            .find_map(|(idx, monitor)| {
                if idx == target_idx {
                    Some(monitor)
                } else {
                    None
                }
            })
            .ok_or_else(|| "Failed to determine target monitor".to_string())?;

        let image = monitor
            .capture_image()
            .map_err(|e| format!("Failed to capture image: {}", e))?;

        encode_png_base64(&image)
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))?
}
