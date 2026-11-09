use serde::Serialize;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub supported: bool,
    pub players: Vec<Player>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    pub owner: String,
    pub name: String,
    pub title: String,
    pub artist: String,
    pub status: String,
    pub can_toggle: bool,
    pub can_previous: bool,
    pub can_next: bool,
}

#[derive(Default)]
pub struct MediaState {
    #[cfg(target_os = "linux")]
    pub connection: std::sync::Mutex<Option<zbus::blocking::Connection>>,
}

#[tauri::command]
pub async fn get_media_players(app: tauri::AppHandle) -> Result<Snapshot, String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            with_connection(&app, crate::media_mpris::snapshot)
        })
        .await
        .map_err(|_| "音乐连接已中断，请重试。".to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Ok(Snapshot::default())
    }
}

#[tauri::command]
pub async fn control_media(
    app: tauri::AppHandle,
    player: String,
    owner: String,
    action: String,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            with_connection(&app, |connection| {
                crate::media_mpris::control(connection, &player, &owner, &action)
            })
        })
        .await
        .map_err(|_| "音乐控制已中断，请重试。".to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, player, owner, action);
        Err("音乐联动目前支持 Linux 桌面版。".into())
    }
}

#[cfg(target_os = "linux")]
fn with_connection<T>(
    app: &tauri::AppHandle,
    operation: impl FnOnce(&zbus::blocking::Connection) -> Result<T, String>,
) -> Result<T, String> {
    use tauri::Manager;
    let state = app.state::<MediaState>();
    let mut slot = state
        .connection
        .lock()
        .map_err(|_| "音乐连接暂不可用。".to_string())?;
    if slot.is_none() {
        *slot = Some(
            zbus::blocking::connection::Builder::session()
                .and_then(|builder| {
                    builder
                        .method_timeout(std::time::Duration::from_millis(700))
                        .build()
                })
                .map_err(|_| "无法连接系统媒体服务，请检查桌面会话。".to_string())?,
        );
    }
    let result = operation(slot.as_ref().expect("Connection initialized"));
    if result.is_err() {
        // Reconnect on the next user request after a bus/player failure.
        *slot = None;
    }
    result
}
