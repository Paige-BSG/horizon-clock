#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;
mod awake;
mod location;
mod photo_source;
mod radio_meter;
#[cfg(target_os = "linux")]
mod wayland;

#[derive(Default)]
struct AwakeState(Mutex<Option<awake::Guard>>);

#[tauri::command]
async fn set_keep_awake(
    enabled: bool,
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<bool, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    // Serialize borrowed Wayland handles with GTK window destruction.
    app.clone()
        .run_on_main_thread(move || {
            let result = (|| {
                let state = app.state::<AwakeState>();
                let mut guard = state
                    .0
                    .lock()
                    .map_err(|_| "Awake state unavailable".to_string())?;
                if enabled && guard.is_none() {
                    *guard = Some(awake::acquire(&window)?);
                } else if !enabled {
                    if let Some(active) = guard.as_mut() {
                        awake::release(active)?;
                    }
                    *guard = None;
                }
                Ok(guard.is_some())
            })();
            let _ = sender.try_send(result);
        })
        .map_err(|e| e.to_string())?;
    receiver
        .recv()
        .await
        .ok_or_else(|| "Awake request interrupted".to_string())?
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

#[tauri::command]
fn open_photo_source(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let checked = photo_source::validated(&url)?;
    app.opener()
        .open_url(checked, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_radio_source(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(
            "https://radioparadise.com/listen/stream-links",
            None::<&str>,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_radio_audio() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            use std::process::{Command, Stdio};
            use std::time::{Duration, Instant};
            let mut child = Command::new("gst-inspect-1.0")
                .arg("autoaudiosink")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "本机缺少音频检查组件。".to_string())?;
            let started = Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) if status.success() => return Ok(()),
                    Ok(Some(_)) => return Err("本机缺少音频播放组件。".to_string()),
                    Ok(None) if started.elapsed() < Duration::from_secs(3) => {
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("本机音频组件暂不可用。".to_string());
                    }
                }
            }
        })
        .await
        .map_err(|_| "音频检查已中断。".to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    Ok(())
}

#[tauri::command]
async fn set_radio_meter(enabled: bool, app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<radio_meter::RadioMeter>().set(enabled)
    })
    .await
    .map_err(|_| "节奏分析已中断。".to_string())?
}
#[tauri::command]
fn radio_audio_levels(meter: tauri::State<'_, radio_meter::RadioMeter>) -> Vec<f32> {
    meter.read()
}

fn main() {
    let builder = tauri::Builder::default();
    // Native automation is opt-in and absent from normal desktop builds.
    #[cfg(feature = "native-qa")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .on_permission_request(|webview, kind| {
            let url = webview.url().ok();
            location::permission(webview.label(), url.as_ref(), kind)
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                window.state::<radio_meter::RadioMeter>().cancel();
                if let Ok(mut guard) = window.state::<AwakeState>().0.lock() {
                    *guard = None;
                }
            }
        })
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("HORIZON")
                .build(),
        )
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(AwakeState::default())
        .manage(radio_meter::RadioMeter::default())
        .invoke_handler(tauri::generate_handler![
            set_keep_awake,
            set_autostart,
            get_autostart,
            set_fullscreen,
            get_fullscreen,
            open_photo_source,
            open_radio_source,
            check_radio_audio,
            set_radio_meter,
            radio_audio_levels
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
