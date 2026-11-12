#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;
mod alarm;
mod awake;
mod location;
mod music_meter;
mod netease;
mod photo_source;
#[cfg(target_os = "linux")]
mod wayland;

#[tauri::command]
async fn set_keep_awake(
    enabled: bool,
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<bool, String> {
    awake::set(enabled, app, window).await
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
async fn set_music_meter(enabled: bool, app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<music_meter::MusicMeter>().set(enabled)
    })
    .await
    .map_err(|_| "节奏分析已中断。".to_string())?
}
#[tauri::command]
fn music_audio_levels(meter: tauri::State<'_, music_meter::MusicMeter>) -> Vec<f32> {
    meter.read()
}

fn main() {
    let builder = tauri::Builder::default();
    // Native automation is opt-in and absent from normal desktop builds.
    #[cfg(feature = "native-qa")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                webview.state::<netease::Controller>().invalidate();
            }
        })
        .on_permission_request(|webview, kind| {
            let url = webview.url().ok();
            location::permission(webview.label(), url.as_ref(), kind)
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                window.state::<music_meter::MusicMeter>().cancel();
                window.state::<netease::Controller>().close();
                window.state::<awake::Controller>().close();
                if let Some(alarm) = window.try_state::<alarm::Controller>() {
                    alarm.close();
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
        .manage(awake::Controller::default())
        .manage(netease::Controller::default())
        .manage(music_meter::MusicMeter::default())
        .invoke_handler(tauri::generate_handler![
            set_keep_awake,
            set_autostart,
            get_autostart,
            set_fullscreen,
            get_fullscreen,
            open_photo_source,
            set_music_meter,
            music_audio_levels,
            alarm::alarm,
            netease::netease
        ])
        .setup(|app| {
            app.manage(alarm::Controller::new(
                app.path().app_cache_dir()?.join("alarm.wav"),
            )?);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("HORIZON · 环境时钟");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Unable to start HORIZON");
}
