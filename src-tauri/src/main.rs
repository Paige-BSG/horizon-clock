#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;
mod awake;

#[derive(Default)]
struct AwakeState(Mutex<Option<awake::Guard>>);

#[tauri::command]
async fn set_keep_awake(enabled: bool, app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AwakeState>();
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "Awake state unavailable".to_string())?;
        if enabled && guard.is_none() {
            *guard = Some(awake::acquire()?);
        } else if !enabled {
            *guard = None;
        }
        Ok(guard.is_some())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    }
    .map_err(|e| e.to_string())?;
    launcher.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_fullscreen(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    window.set_fullscreen(enabled).map_err(|e| e.to_string())?;
    Ok(enabled)
}

#[tauri::command]
fn get_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("HORIZON")
                .build(),
        )
        .manage(AwakeState::default())
        .invoke_handler(tauri::generate_handler![
            set_keep_awake,
            set_autostart,
            get_autostart,
            set_fullscreen,
            get_fullscreen
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("HORIZON · 环境时钟");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Unable to start HORIZON");
}
