use super::{Playback, Track};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    net::Shutdown,
    os::{fd::OwnedFd, unix::net::UnixStream},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
type Result<T> = std::result::Result<T, String>;

struct Ipc {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
    end_reason: Option<String>,
}
impl Ipc {
    fn new(stream: UnixStream) -> Result<Self> {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|_| "播放器超时设置失败")?;
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|_| "播放器超时设置失败")?;
        let reader = BufReader::new(stream.try_clone().map_err(|_| "播放器连接失败")?);
        Ok(Self {
            stream,
            reader,
            end_reason: None,
        })
    }
    fn request(&mut self, command: Value, id: u64) -> Result<Value> {
        writeln!(
            self.stream,
            "{}",
            json!({"command":command,"request_id":id})
        )
        .map_err(|_| "播放器连接已关闭")?;
        loop {
            let mut line = String::new();
            self.reader
                .read_line(&mut line)
                .map_err(|_| "播放器响应超时")?;
            if line.is_empty() {
                return Err("播放器已退出".into());
            }
            let value: Value = serde_json::from_str(&line).map_err(|_| "播放器返回无效状态")?;
            if value["event"] == "end-file" {
                self.end_reason = Some(value["reason"].as_str().unwrap_or("unknown").to_owned());
            }
            if value["request_id"].as_u64() == Some(id) {
                if value["error"] != "success" {
                    return Err("播放器尚未准备好".into());
                }
                return Ok(value["data"].clone());
            }
        }
    }
}
fn complete_track(reason: &str, elapsed: f64, duration: f64, metadata_duration: f64) -> bool {
    reason == "eof"
        && duration > 1.0
        && metadata_duration > 1.0
        && (duration - metadata_duration).abs() < 5.0
        && elapsed >= duration - 3.0
}

enum Control {
    Pause(bool, mpsc::Sender<Result<()>>),
    Volume(u8, mpsc::Sender<Result<()>>),
    Close,
}

pub(super) struct Player {
    child: Arc<Mutex<Child>>,
    view: Arc<Mutex<Result<Playback>>>,
    sender: mpsc::Sender<Control>,
    interrupt: UnixStream,
    worker: Option<JoinHandle<()>>,
}
fn kill(child: &Mutex<Child>) {
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
impl Player {
    pub(super) fn start(url: &str, track: Track, volume: u8) -> Result<Self> {
        Self::monitor(Session::start(url, track, volume)?)
    }
    fn monitor(mut session: Session) -> Result<Self> {
        let child = session.child.clone();
        let interrupt = session.ipc.stream.try_clone().map_err(|_| {
            kill(&child);
            "播放器连接失败".to_string()
        })?;
        let view = Arc::new(Mutex::new(Ok(session.view.clone())));
        let shared = view.clone();
        let (sender, receiver) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("horizon-playback".into())
            .spawn(move || {
                loop {
                    let command = receiver.recv_timeout(Duration::from_millis(250));
                    let reply = match command {
                        Ok(Control::Close) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Ok(Control::Pause(paused, reply)) => {
                            let result = session
                                .ipc
                                .request(json!(["set_property", "pause", paused]), 20);
                            if result.is_ok() {
                                session.view.state =
                                    if paused { "paused" } else { "playing" }.into();
                            }
                            Some((reply, result.map(|_| ())))
                        }
                        Ok(Control::Volume(volume, reply)) => {
                            let result = session
                                .ipc
                                .request(json!(["set_property", "volume", volume]), 21);
                            if result.is_ok() {
                                session.view.volume = volume;
                            }
                            Some((reply, result.map(|_| ())))
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => None,
                    };
                    let result = match &reply {
                        Some((_, Err(error))) => Err(error.clone()),
                        _ => session.poll(),
                    };
                    if let Ok(mut shared) = shared.lock() {
                        *shared = result.clone().map(|_| session.view.clone());
                    }
                    if let Some((reply, _)) = reply {
                        let _ = reply.send(result.clone());
                    }
                    if result.is_err() {
                        break;
                    }
                }
                kill(&session.child);
            })
            .map_err(|_| {
                kill(&child);
                "无法启动播放状态监测".to_string()
            })?;
        Ok(Self {
            child,
            view,
            sender,
            interrupt,
            worker: Some(worker),
        })
    }
    pub(super) fn snapshot(&self) -> Result<Playback> {
        self.view
            .lock()
            .map_err(|_| "播放器状态不可用".to_string())?
            .clone()
    }
    fn command(&self, make: impl FnOnce(mpsc::Sender<Result<()>>) -> Control) -> Result<()> {
        let (sender, receiver) = mpsc::channel();
        self.sender.send(make(sender)).map_err(|_| "播放器已停止")?;
        receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "播放器控制超时")?
    }
    pub(super) fn pause(&self, paused: bool) -> Result<()> {
        self.command(|reply| Control::Pause(paused, reply))
    }
    pub(super) fn volume(&self, volume: u8) -> Result<()> {
        self.command(|reply| Control::Volume(volume, reply))
    }
}
impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.sender.send(Control::Close);
        let _ = self.interrupt.shutdown(Shutdown::Both);
        kill(&self.child);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct Session {
    child: Arc<Mutex<Child>>,
    ipc: Ipc,
    view: Playback,
    started: Instant,
}
impl Session {
    fn start(url: &str, track: Track, volume: u8) -> Result<Self> {
        // mpv exits when this anonymous IPC connection closes, including when the
        // app is killed. No socket path or signed URL is written to disk/argv.
        let (stream, socket) = UnixStream::pair().map_err(|_| "无法创建播放器连接")?;
        let mut command = Command::new("mpv");
        if cfg!(target_os = "linux") {
            command.arg("--ao=pulse");
        }
        let child = command
            .args([
                "--no-config",
                "--idle=yes",
                "--no-video",
                "--no-terminal",
                "--input-terminal=no",
                "--input-ipc-client=fd://0",
                "--force-media-title=HORIZON NetEase",
            ])
            .arg(format!("--volume={volume}"))
            .stdin(Stdio::from(OwnedFd::from(socket)))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "请安装 mpv 后重试")?;
        // Own the process before any fallible IPC operation, so startup failure cannot leak it.
        let mut child = ChildGuard(Some(child));
        // Command retains its stdin handle after spawn; only mpv may keep this end.
        drop(command);
        let mut ipc = Ipc::new(stream)?;
        ipc.request(json!(["loadfile", url, "replace"]), 1)?;
        Ok(Self {
            child: Arc::new(Mutex::new(child.0.take().unwrap())),
            ipc,
            view: Playback {
                state: "connecting".into(),
                duration: track.duration,
                track: Some(track),
                volume,
                seconds: 0.0,
            },
            started: Instant::now(),
        })
    }
    fn poll(&mut self) -> Result<()> {
        if self.view.state == "ended" {
            return Ok(());
        }
        if self
            .child
            .lock()
            .map_err(|_| "播放器状态不可用")?
            .try_wait()
            .map_err(|_| "播放器状态不可用")?
            .is_some()
        {
            return Err("mpv 意外退出，请重试".into());
        }
        if let Ok(v) = self.ipc.request(json!(["get_property", "time-pos"]), 10) {
            self.view.seconds = v.as_f64().unwrap_or(self.view.seconds);
        }
        if let Ok(v) = self.ipc.request(json!(["get_property", "duration"]), 11) {
            let duration = v.as_f64().unwrap_or(0.0);
            let expected = self.view.track.as_ref().map_or(0.0, |t| t.duration);
            if duration > 1.0 && (duration - expected).abs() > 5.0 {
                return Err("音源时长不符，已停止播放".into());
            }
            if duration > 1.0 {
                self.view.duration = duration;
            }
        }
        if let Some(reason) = self.ipc.end_reason.as_deref() {
            if complete_track(
                reason,
                self.view.seconds,
                self.view.duration,
                self.view.track.as_ref().map_or(0.0, |t| t.duration),
            ) {
                self.view.state = "ended".into();
            } else {
                return Err("播放中断，请重试或选择其他歌曲".into());
            }
        } else if self.view.seconds > 0.0 && self.view.state == "connecting" {
            self.view.state = "playing".into();
        } else if self.view.state == "connecting"
            && self.started.elapsed() > Duration::from_secs(20)
        {
            return Err("播放连接超时，请重试".into());
        }
        Ok(())
    }
}
struct ChildGuard(Option<Child>);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(child) = self.0.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    mod lifecycle {
        use super::*;

        const HELPER: &str = "netease::engine::player::tests::lifecycle::mpv_parent";

        #[test]
        #[ignore = "subprocess entry point for the real-mpv lifecycle tests"]
        fn mpv_parent() {
            let root = std::env::var("HORIZON_TEST_PLAYER_ROOT").unwrap();
            // A local silent WAV needs no account, network or audible playback.
            let path = std::path::Path::new(&root).join("silence.wav");
            let mut wav = Vec::new();
            wav.extend_from_slice(b"RIFF");
            wav.extend_from_slice(&8036_u32.to_le_bytes());
            wav.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0\x01\0");
            wav.extend_from_slice(&8000_u32.to_le_bytes());
            wav.extend_from_slice(&8000_u32.to_le_bytes());
            wav.extend_from_slice(b"\x01\0\x08\0data");
            wav.extend_from_slice(&8000_u32.to_le_bytes());
            wav.extend_from_slice(&[128; 8000]);
            std::fs::write(&path, wav).unwrap();
            // Starting from a short-lived thread must not bind playback to that thread.
            let mut session = thread::spawn(move || {
                Session::start(
                    path.to_str().unwrap(),
                    Track {
                        id: "11".into(),
                        name: "Silent lifecycle fixture".into(),
                        artist: "Test".into(),
                        duration: 1.0,
                    },
                    0,
                )
                .unwrap()
            })
            .join()
            .unwrap();
            thread::sleep(Duration::from_millis(100));
            session
                .ipc
                .request(json!(["set_property", "pause", true]), 40)
                .unwrap();
            session
                .ipc
                .request(json!(["set_property", "volume", 0]), 41)
                .unwrap();
            assert_eq!(
                session
                    .ipc
                    .request(json!(["get_property", "pause"]), 42)
                    .unwrap(),
                json!(true)
            );
            let pid = session.child.lock().unwrap().id();
            let player = Player::monitor(session).unwrap();
            println!("HORIZON_TEST_MPV_PID={pid}");
            std::io::stdout().flush().unwrap();
            // The caller closes stdin for normal shutdown, or kills this process.
            let mut line = String::new();
            std::io::stdin().read_line(&mut line).unwrap();
            drop(player);
        }

        fn running(pid: u32) -> bool {
            std::fs::read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|stat| {
                    stat.rsplit_once(") ")
                        .map(|(_, rest)| !rest.starts_with('Z'))
                })
                .unwrap_or(false)
        }

        fn check(signal: Option<&str>) {
            let root = tempfile::tempdir().unwrap();
            let mut parent = ChildGuard(Some(
                Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", HELPER, "--ignored", "--nocapture"])
                    .env("HORIZON_TEST_PLAYER_ROOT", root.path())
                    .env("TMPDIR", root.path())
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .spawn()
                    .unwrap(),
            ));
            let mut output = BufReader::new(parent.0.as_mut().unwrap().stdout.take().unwrap());
            let pid = loop {
                let mut line = String::new();
                assert!(
                    output.read_line(&mut line).unwrap() > 0,
                    "player helper failed before readiness"
                );
                if let Some(pid) = line.trim().strip_prefix("HORIZON_TEST_MPV_PID=") {
                    break pid.parse::<u32>().unwrap();
                }
            };
            assert!(running(pid));
            let parent_process = parent.0.as_mut().unwrap();
            if let Some(signal) = signal {
                assert!(Command::new("/bin/kill")
                    .args([signal, &parent_process.id().to_string()])
                    .status()
                    .unwrap()
                    .success());
            } else {
                drop(parent_process.stdin.take());
            }
            let status = parent_process.wait().unwrap();
            assert_eq!(status.success(), signal.is_none());
            let deadline = Instant::now() + Duration::from_secs(5);
            while running(pid) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(20));
            }
            let leaked = running(pid);
            if leaked {
                // Reclaim only the exact mpv created by this test, even on failure.
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", &pid.to_string()])
                    .status();
            }
            let stale = std::fs::read_dir(root.path()).unwrap().any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("horizon-player-")
            });
            assert!(!leaked, "mpv survived parent {signal:?}");
            assert!(
                !stale,
                "private player socket directory survived parent {signal:?}"
            );
        }

        #[test]
        fn mpv_exits_after_normal_close() {
            check(None);
        }
        #[test]
        fn mpv_exits_after_parent_sigterm() {
            check(Some("-TERM"));
        }
        #[test]
        fn mpv_exits_after_parent_sigkill() {
            check(Some("-KILL"));
        }
    }
    fn fixture(stream: UnixStream) -> Session {
        Session {
            child: Arc::new(Mutex::new(
                Command::new("/bin/sleep").arg("30").spawn().unwrap(),
            )),
            ipc: Ipc::new(stream).unwrap(),
            view: Playback {
                state: "playing".into(),
                track: Some(Track {
                    id: "11".into(),
                    name: "Fixture".into(),
                    artist: "Test".into(),
                    duration: 173.0,
                }),
                duration: 173.0,
                ..Playback::default()
            },
            started: Instant::now(),
        }
    }

    #[test]
    fn duration_mismatch_stops_playback_without_frontend_requests() {
        let (stream, peer) = UnixStream::pair().unwrap();
        let server = thread::spawn(move || {
            let mut reader = BufReader::new(peer.try_clone().unwrap());
            let mut peer = peer;
            for (id, data) in [(10, 1.0), (11, 30.0)] {
                let mut request = String::new();
                reader.read_line(&mut request).unwrap();
                writeln!(
                    peer,
                    "{}",
                    json!({"request_id":id,"error":"success","data":data})
                )
                .unwrap();
            }
        });
        let player = Player::monitor(fixture(stream)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while player.snapshot().is_ok() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(player.snapshot().err().unwrap().contains("时长不符"));
        while player.child.lock().unwrap().try_wait().unwrap().is_none()
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(player.child.lock().unwrap().try_wait().unwrap().is_some());
        server.join().unwrap();
    }

    #[test]
    fn closing_interrupts_a_stalled_ipc_read_and_reaps_the_owned_process() {
        let (stream, peer) = UnixStream::pair().unwrap();
        let (ready, waiting) = mpsc::channel();
        let server = thread::spawn(move || {
            let mut reader = BufReader::new(peer);
            let mut request = String::new();
            reader.read_line(&mut request).unwrap();
            ready.send(()).unwrap();
            request.clear();
            let _ = reader.read_line(&mut request);
        });
        let player = Player::monitor(fixture(stream)).unwrap();
        let child = player.child.clone();
        waiting.recv_timeout(Duration::from_secs(3)).unwrap();
        let started = Instant::now();
        drop(player);
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(child.lock().unwrap().try_wait().unwrap().is_some());
        server.join().unwrap();
    }
    #[test]
    fn playback_completion_does_not_require_frontend_polling() {
        let (stream, peer) = UnixStream::pair().unwrap();
        let worker = std::thread::spawn(move || {
            let mut reader = BufReader::new(peer.try_clone().unwrap());
            let mut peer = peer;
            for seconds in [160.0, 172.0, 173.0] {
                for id in [10, 11] {
                    let mut request = String::new();
                    if reader.read_line(&mut request).unwrap_or(0) == 0 {
                        return;
                    }
                    if seconds == 173.0 && id == 10 {
                        writeln!(peer, "{}", json!({"event":"end-file","reason":"eof"})).unwrap();
                    }
                    let response = if seconds == 173.0 {
                        json!({"request_id":id,"error":"property unavailable"})
                    } else {
                        json!({"request_id":id,"error":"success","data":if id == 10 {seconds} else {173.0}})
                    };
                    if writeln!(peer, "{response}").is_err() {
                        return;
                    }
                }
            }
        });
        let player = Player::monitor(Session {
            child: Arc::new(Mutex::new(
                Command::new("/bin/sleep").arg("30").spawn().unwrap(),
            )),
            ipc: Ipc::new(stream).unwrap(),
            view: Playback {
                state: "playing".into(),
                track: Some(Track {
                    id: "11".into(),
                    name: "Fixture".into(),
                    artist: "Test".into(),
                    duration: 173.0,
                }),
                duration: 173.0,
                ..Playback::default()
            },
            started: Instant::now(),
        })
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while player.snapshot().unwrap().state != "ended" && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        let state = player.snapshot().unwrap().state;
        drop(player);
        worker.join().unwrap();
        assert_eq!(state, "ended");
    }
    #[test]
    fn end_event_survives_a_property_becoming_unavailable_after_playback() {
        let (stream, peer) = UnixStream::pair().unwrap();
        let worker = std::thread::spawn(move || {
            let mut reader = BufReader::new(peer.try_clone().unwrap());
            let mut request = String::new();
            reader.read_line(&mut request).unwrap();
            let mut peer = peer;
            writeln!(peer, "{}", json!({"event":"end-file","reason":"eof"})).unwrap();
            writeln!(
                peer,
                "{}",
                json!({"request_id":10,"error":"property unavailable"})
            )
            .unwrap();
        });
        let mut ipc = Ipc::new(stream).unwrap();
        assert!(ipc
            .request(json!(["get_property", "time-pos"]), 10)
            .is_err());
        assert_eq!(ipc.end_reason.as_deref(), Some("eof"));
        worker.join().unwrap();
        assert!(complete_track("eof", 172.0, 173.0, 173.0));
        assert!(!complete_track("stop", 172.0, 173.0, 173.0));
        assert!(!complete_track("eof", 30.0, 30.0, 173.0));
    }
}
