#[cfg(not(target_os = "linux"))]
pub type Guard = keepawake::KeepAwake;

#[cfg(not(target_os = "linux"))]
pub fn acquire() -> Result<Guard, String> {
    keepawake::Builder::default()
        .display(true)
        .idle(true)
        .app_name("HORIZON")
        .app_reverse_domain("io.github.paige-bsg.horizon-clock")
        .reason("Wall clock display enabled by the user")
        .create()
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "linux"))]
pub fn release(_guard: &mut Guard) -> Result<(), String> {
    // The caller drops the platform guard immediately after this returns.
    Ok(())
}

#[cfg(target_os = "linux")]
enum DisplayInhibitor {
    ScreenSaver {
        session: zbus::blocking::Connection,
        cookie: u32,
    },
}

#[cfg(target_os = "linux")]
pub struct Guard {
    display: Option<DisplayInhibitor>,
    idle: Option<zbus::zvariant::OwnedFd>,
}

#[cfg(target_os = "linux")]
pub fn acquire() -> Result<Guard, String> {
    const REASON: &str = "Wall clock display enabled by the user";
    let display = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        None
    } else {
        let session = zbus::blocking::connection::Builder::session()
            .map_err(|e| e.to_string())?
            .method_timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| e.to_string())?;
        let cookie = session
            .call_method(
                Some("org.freedesktop.ScreenSaver"),
                "/org/freedesktop/ScreenSaver",
                Some("org.freedesktop.ScreenSaver"),
                "Inhibit",
                &("HORIZON", REASON),
            )
            .map_err(|e| e.to_string())?
            .body()
            .deserialize::<u32>()
            .map_err(|e| e.to_string())?;
        Some(DisplayInhibitor::ScreenSaver { session, cookie })
    };
    // Construct the guard first so a failed logind request releases the display inhibitor.
    let mut guard = Guard {
        display,
        idle: None,
    };
    let system = zbus::blocking::connection::Builder::system()
        .map_err(|e| e.to_string())?
        .method_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    guard.idle = Some(
        system
            .call_method(
                Some("org.freedesktop.login1"),
                "/org/freedesktop/login1",
                Some("org.freedesktop.login1.Manager"),
                "Inhibit",
                &("idle", "HORIZON", REASON, "block"),
            )
            .map_err(|e| e.to_string())?
            .body()
            .deserialize::<zbus::zvariant::OwnedFd>()
            .map_err(|e| e.to_string())?,
    );
    Ok(guard)
}

#[cfg(target_os = "linux")]
pub fn release(guard: &mut Guard) -> Result<(), String> {
    if let Some(display) = guard.display.as_mut() {
        match display {
            DisplayInhibitor::ScreenSaver { session, cookie } => {
                session
                    .call_method(
                        Some("org.freedesktop.ScreenSaver"),
                        "/org/freedesktop/ScreenSaver",
                        Some("org.freedesktop.ScreenSaver"),
                        "UnInhibit",
                        &(*cookie,),
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    guard.display = None;
    guard.idle = None;
    Ok(())
}

#[cfg(target_os = "linux")]
impl Drop for Guard {
    fn drop(&mut self) {
        // Cleanup must not panic during logout; a destroyed window also loses its property.
        let _ = release(self);
    }
}

#[derive(Default)]
pub struct Controller {
    guard: std::sync::Mutex<Option<Guard>>,
    operation: tokio::sync::Mutex<()>,
    closed: std::sync::atomic::AtomicBool,
    #[cfg(target_os = "linux")]
    display: std::sync::Mutex<Option<crate::wayland::Inhibitor>>,
}
impl Controller {
    // Called on GTK before the borrowed window surface is destroyed.
    pub fn close(&self) {
        self.closed.store(true, std::sync::atomic::Ordering::SeqCst);
        #[cfg(target_os = "linux")]
        if let Ok(mut display) = self.display.lock() {
            *display = None;
        }
        if let Ok(mut guard) = self.guard.lock() {
            if let Some(guard) = guard.take() {
                tauri::async_runtime::spawn_blocking(move || drop(guard));
            }
        }
    }
}
async fn release_pending(
    pending: std::sync::Arc<std::sync::Mutex<Option<Guard>>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(mut guard) = pending
            .lock()
            .map_err(|_| "Awake state unavailable")?
            .take()
        {
            release(&mut guard)?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "Awake cleanup interrupted".to_string())?
}
pub async fn set(
    enabled: bool,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<bool, String> {
    use std::sync::{atomic::Ordering, Arc, Mutex};
    use tauri::Manager;
    let state = app.state::<Controller>();
    let _operation = state.operation.lock().await;
    if state.closed.load(Ordering::SeqCst) {
        return Err("Clock window closed".into());
    }
    if enabled
        && state
            .guard
            .lock()
            .map_err(|_| "Awake state unavailable")?
            .is_some()
    {
        return Ok(true);
    }
    let pending = Arc::new(Mutex::new(if enabled {
        Some(
            tauri::async_runtime::spawn_blocking(acquire)
                .await
                .map_err(|_| "Awake request interrupted")??,
        )
    } else {
        None
    }));
    let transferred = pending.clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let main_app = app.clone();
    let dispatched = app.run_on_main_thread(move || {
        let state = main_app.state::<Controller>();
        let result = (|| {
            if state.closed.load(Ordering::SeqCst) {
                return Err("Clock window closed".to_string());
            }
            #[cfg(target_os = "linux")]
            {
                let mut display = state
                    .display
                    .lock()
                    .map_err(|_| "Awake state unavailable")?;
                if enabled && std::env::var_os("WAYLAND_DISPLAY").is_some() {
                    *display = Some(crate::wayland::Inhibitor::acquire(&window)?);
                } else if !enabled {
                    if let Some(display) = display.as_mut() {
                        display.release()?;
                    }
                    *display = None;
                }
            }
            #[cfg(not(target_os = "linux"))]
            let _ = window;
            let mut guard = state.guard.lock().map_err(|_| "Awake state unavailable")?;
            if enabled {
                *guard = transferred
                    .lock()
                    .map_err(|_| "Awake state unavailable")?
                    .take();
            } else {
                *transferred.lock().map_err(|_| "Awake state unavailable")? = guard.take();
            }
            Ok(enabled)
        })();
        let _ = sender.try_send(result);
    });
    let result = match dispatched {
        Ok(()) => receiver
            .recv()
            .await
            .ok_or_else(|| "Awake request interrupted".to_string())
            .and_then(|r| r),
        Err(error) => Err(error.to_string()),
    };
    release_pending(pending).await?;
    result
}
