#[cfg(not(target_os = "linux"))]
pub type Guard = keepawake::KeepAwake;

#[cfg(not(target_os = "linux"))]
pub fn acquire(_window: &tauri::WebviewWindow) -> Result<Guard, String> {
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
    Wayland(crate::wayland::Inhibitor),
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
pub fn acquire(window: &tauri::WebviewWindow) -> Result<Guard, String> {
    const REASON: &str = "Wall clock display enabled by the user";
    let display = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        DisplayInhibitor::Wayland(crate::wayland::Inhibitor::acquire(window)?)
    } else {
        let session = zbus::blocking::Connection::session().map_err(|e| e.to_string())?;
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
        DisplayInhibitor::ScreenSaver { session, cookie }
    };
    // Construct the guard first so a failed logind request releases the display inhibitor.
    let mut guard = Guard {
        display: Some(display),
        idle: None,
    };
    let system = zbus::blocking::Connection::system().map_err(|e| e.to_string())?;
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
            DisplayInhibitor::Wayland(inhibitor) => inhibitor.release()?,
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
