use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Occurrence {
    alarm_id: String,
    at: u64,
    label: String,
}
impl Occurrence {
    fn key(&self) -> String {
        format!("{}@{}", self.alarm_id, self.at)
    }
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Sync {
        occurrences: Vec<Occurrence>,
        enabled_ids: Vec<String>,
    },
    Status {},
    Stop {},
    Snooze {},
    Preview {},
}
#[derive(Serialize)]
pub struct View {
    active: Vec<Occurrence>,
    snoozed: Vec<Occurrence>,
    error: Option<String>,
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(unix)]
struct Sound {
    child: std::process::Child,
    _ipc: std::os::unix::net::UnixStream,
}
#[cfg(unix)]
impl Sound {
    fn start(path: &std::path::Path) -> Result<Self, String> {
        use std::{
            os::{fd::OwnedFd, unix::net::UnixStream},
            process::{Command, Stdio},
        };
        let (ipc, child_ipc) = UnixStream::pair().map_err(|_| "铃声连接失败")?;
        let child = Command::new("mpv")
            .args([
                "--no-config",
                "--no-terminal",
                "--really-quiet",
                "--load-scripts=no",
                "--input-default-bindings=no",
                "--input-terminal=no",
                "--audio-display=no",
                "--force-window=no",
                "--loop-file=inf",
                "--volume=70",
                "--input-ipc-client=fd://0",
                "--",
            ])
            .arg(path)
            .stdin(Stdio::from(OwnedFd::from(child_ipc)))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法启动铃声，请检查 mpv 是否已安装。".to_string())?;
        Ok(Self { child, _ipc: ipc })
    }
    fn running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}
#[cfg(unix)]
impl Drop for Sound {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[cfg(not(unix))]
struct Sound;
#[cfg(not(unix))]
impl Sound {
    fn start(_: &std::path::Path) -> Result<Self, String> {
        Err("当前平台不支持闹钟铃声。".into())
    }
    fn running(&mut self) -> bool {
        false
    }
}

#[derive(Default)]
struct State {
    scheduled: Vec<Occurrence>,
    snoozed: Vec<Occurrence>,
    active: Vec<Occurrence>,
    fired: HashMap<String, u64>,
    error: Option<String>,
    sound: Option<Sound>,
    started: Option<Instant>,
    preview: bool,
    closed: bool,
    path: PathBuf,
}
impl State {
    fn stop(&mut self) {
        self.sound = None;
        self.active.clear();
        self.started = None;
        self.preview = false;
        self.error = None;
    }
    fn due(&mut self, now: u64) -> Vec<Occurrence> {
        let mut due = Vec::new();
        self.fired
            .retain(|_, at| now.saturating_sub(*at) < 7 * 86400000);
        for queue in [&mut self.scheduled, &mut self.snoozed] {
            queue.retain(|item| {
                if item.at > now {
                    return true;
                }
                let key = item.key();
                if now.saturating_sub(item.at) < 60000 && !self.fired.contains_key(&key) {
                    self.fired.insert(key, item.at);
                    due.push(item.clone());
                }
                false
            });
        }
        due
    }
    fn ring(&mut self) {
        self.started = Some(Instant::now());
        self.error = None;
        self.sound = (|| {
            if let Some(parent) = self.path.parent() {
                std::fs::create_dir_all(parent).map_err(|_| "无法准备本地铃声")?;
            }
            std::fs::write(&self.path, include_bytes!("../../assets/audio/alarm.wav"))
                .map_err(|_| "无法保存本地铃声")?;
            Sound::start(&self.path)
        })()
        .map_err(|error: String| self.error = Some(error))
        .ok();
    }
    fn tick(&mut self, now: u64) {
        let due = self.due(now);
        if !due.is_empty() {
            self.preview = false;
            self.active.extend(due);
            self.ring();
        }
        if self.sound.as_mut().is_some_and(|sound| !sound.running()) {
            self.sound = None;
            self.error = Some("铃声播放已中断，请检查音频输出与 mpv。".into());
        }
        if self.started.is_some_and(|started| {
            started.elapsed() >= Duration::from_secs(if self.preview { 5 } else { 180 })
        }) {
            self.stop();
        }
    }
    fn sync(
        &mut self,
        occurrences: Vec<Occurrence>,
        enabled_ids: Vec<String>,
    ) -> Result<(), String> {
        if occurrences.len() > 700
            || enabled_ids.len() > 20
            || occurrences.iter().any(|item| {
                item.alarm_id.is_empty()
                    || item.alarm_id.len() > 64
                    || item.label.chars().count() > 40
                    || item.at > 4102444800000
                    || !enabled_ids.contains(&item.alarm_id)
            })
        {
            return Err("闹钟计划无效。".into());
        }
        let enabled: HashSet<_> = enabled_ids.into_iter().collect();
        self.active.retain(|item| enabled.contains(&item.alarm_id));
        self.snoozed.retain(|item| enabled.contains(&item.alarm_id));
        if self.active.is_empty() && !self.preview {
            self.stop();
        }
        self.scheduled = occurrences;
        Ok(())
    }
    fn view(&self) -> View {
        View {
            active: self.active.clone(),
            snoozed: self.snoozed.clone(),
            error: self.error.clone(),
        }
    }
}

pub struct Controller(Arc<Mutex<State>>);
impl Controller {
    pub fn new(path: PathBuf) -> std::io::Result<Self> {
        let shared = Arc::new(Mutex::new(State {
            path,
            ..State::default()
        }));
        let worker = shared.clone();
        thread::Builder::new()
            .name("horizon-alarm".into())
            .spawn(move || loop {
                {
                    let Ok(mut state) = worker.lock() else {
                        break;
                    };
                    if state.closed {
                        break;
                    }
                    state.tick(now_ms());
                }
                thread::sleep(Duration::from_millis(250));
            })?;
        Ok(Self(shared))
    }
    pub fn close(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.closed = true;
            state.stop();
        }
    }
    fn run(&self, action: Action) -> Result<View, String> {
        let mut state = self.0.lock().map_err(|_| "闹钟状态暂不可用")?;
        if state.closed {
            return Err("闹钟已关闭。".into());
        }
        let now = now_ms();
        state.tick(now);
        match action {
            Action::Sync {
                occurrences,
                enabled_ids,
            } => state.sync(occurrences, enabled_ids)?,
            Action::Status {} => {}
            Action::Stop {} => state.stop(),
            Action::Snooze {} => {
                let mut snoozed = state.active.clone();
                for item in &mut snoozed {
                    item.at = now + 5 * 60000;
                }
                state.snoozed.extend(snoozed);
                state.stop();
            }
            Action::Preview {} => {
                if state.active.is_empty() {
                    state.stop();
                    state.preview = true;
                    state.ring();
                }
            }
        }
        Ok(state.view())
    }
}
impl Drop for Controller {
    fn drop(&mut self) {
        self.close();
    }
}

#[tauri::command]
pub async fn alarm(action: Action, app: tauri::AppHandle) -> Result<View, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || app.state::<Controller>().run(action))
        .await
        .map_err(|_| "闹钟操作已中断".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(id: &str, at: u64) -> Occurrence {
        Occurrence {
            alarm_id: id.into(),
            at,
            label: "起床".into(),
        }
    }
    #[test]
    fn due_is_once_only_and_never_catches_up_long_missed_alarms() {
        let mut state = State {
            scheduled: vec![item("a", 100000), item("b", 100000), item("old", 1)],
            ..State::default()
        };
        assert!(state.due(99999).is_empty());
        assert_eq!(state.due(100000).len(), 2);
        state.scheduled.push(item("a", 100000));
        assert!(state.due(100001).is_empty());
        assert!(state.scheduled.is_empty());
    }
    #[test]
    fn disabling_cancels_active_and_snoozed_but_resync_keeps_enabled_snoozes() {
        let mut state = State {
            active: vec![item("a", 1)],
            snoozed: vec![item("a", 300000)],
            ..State::default()
        };
        state
            .sync(vec![item("a", 500000)], vec!["a".into()])
            .unwrap();
        assert_eq!(state.snoozed.len(), 1);
        state.sync(vec![], vec![]).unwrap();
        assert!(state.active.is_empty() && state.snoozed.is_empty());
        assert!(state.sync(vec![item("x", 1)], vec![]).is_err());
    }

    #[test]
    fn native_thread_fires_without_webview_polling_and_reports_sound_failure() {
        let root = tempfile::tempdir().unwrap();
        let blocker = root.path().join("not-a-directory");
        std::fs::write(&blocker, b"test").unwrap();
        // An invalid parent guarantees no audible process is started on any host.
        let controller = Controller::new(blocker.join("alarm.wav")).unwrap();
        controller
            .run(Action::Sync {
                occurrences: vec![item("a", now_ms() + 30)],
                enabled_ids: vec!["a".into()],
            })
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let fired = !controller.0.lock().unwrap().active.is_empty();
            if fired {
                break;
            }
            assert!(Instant::now() < deadline, "native timer did not fire");
            thread::sleep(Duration::from_millis(20));
        }
        {
            let state = controller.0.lock().unwrap();
            assert!(state.error.is_some());
            assert_eq!(state.active.len(), 1);
        }
        let snoozed = controller.run(Action::Snooze {}).unwrap();
        assert!(snoozed.active.is_empty());
        assert_eq!(snoozed.snoozed.len(), 1);
        assert!(snoozed.snoozed[0].at >= now_ms() + 299000);
        controller.close();
        assert!(controller.run(Action::Status {}).is_err());
    }
}
