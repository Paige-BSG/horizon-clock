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

#[cfg(target_os = "linux")]
pub struct Guard {
    session: zbus::blocking::Connection,
    cookie: u32,
    idle: Option<zbus::zvariant::OwnedFd>,
}

#[cfg(target_os = "linux")]
pub fn acquire() -> Result<Guard, String> {
    const REASON: &str = "Wall clock display enabled by the user";
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
    // Construct the guard before acquiring the second inhibitor: failure releases the first one.
    let mut guard = Guard {
        session,
        cookie,
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
impl Drop for Guard {
    fn drop(&mut self) {
        // The desktop service may disappear during logout. Cleanup must not panic.
        let _ = self.session.call_method(
            Some("org.freedesktop.ScreenSaver"),
            "/org/freedesktop/ScreenSaver",
            Some("org.freedesktop.ScreenSaver"),
            "UnInhibit",
            &(self.cookie,),
        );
        // Dropping the owned descriptor releases the systemd idle inhibitor.
    }
}
