use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Restore {},
    Login {},
    PollLogin {},
    CancelLogin {},
    Logout {},
    Tracks {
        playlist: String,
        offset: u32,
        #[serde(default)]
        from_queue: bool,
    },
    Fm {
        append: bool,
    },
    Play {
        id: String,
        #[serde(default)]
        from_queue: bool,
    },
    Pause {
        paused: bool,
    },
    Volume {
        volume: u8,
    },
    Stop {},
    Status {},
}

#[cfg(unix)]
mod engine;
#[cfg(unix)]
pub use engine::Controller;
#[cfg(not(unix))]
#[derive(Default)]
pub struct Controller;
#[cfg(not(unix))]
impl Controller {
    pub fn close(&self) {}
    pub fn invalidate(&self) {}
}

#[tauri::command]
pub async fn netease(action: Action, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(unix)]
    {
        use tauri::Manager;
        // Keyring and mpv IPC may block briefly; keep them off GTK and async workers.
        let runtime = tauri::async_runtime::handle();
        tauri::async_runtime::spawn_blocking(move || {
            runtime.block_on(async {
                let state = app.state::<Controller>();
                let view = state.run(action).await?;
                serde_json::to_value(view).map_err(|_| "音乐状态暂不可用".into())
            })
        })
        .await
        .map_err(|_| "音乐操作已中断".to_string())?
    }
    #[cfg(not(unix))]
    {
        let _ = (action, app);
        Err("当前平台暂不支持网易云原生播放".into())
    }
}
