use super::Action;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ncm_api_rs::{create_client, request::ApiResponse, ApiClient, Query};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    future::Future,
    io::{BufRead, BufReader, Cursor, Read, Write},
    os::unix::net::UnixStream,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;
// Retain the user-authorized feasibility session in place; never copy/export it.
const SERVICE: &str = "io.github.paige-bsg.horizon-clock.netease-probe";
const ACCOUNT: &str = "netease-session";
#[derive(Serialize, Deserialize)]
struct Session {
    cookie: String,
    device: String,
}
fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| "系统凭据存储不可用".into())
}
fn client(session: Option<&Session>) -> ApiClient {
    let mut api = create_client(session.map(|s| s.cookie.clone()));
    if let Some(s) = session {
        api.set_device_id(s.device.clone());
    }
    api
}
async fn bounded<F: Future<Output = ncm_api_rs::error::Result<ApiResponse>>>(
    future: F,
) -> Result<ApiResponse> {
    tokio::time::timeout(Duration::from_secs(12), future)
        .await
        .map_err(|_| "网易接口请求超时")?
        .map_err(|error| match error {
            ncm_api_rs::error::NcmError::Api { code, .. } => {
                format!("网易接口返回状态 {code}；停止本次请求")
            }
            ncm_api_rs::error::NcmError::AuthRequired(_) => "需要登录，或已有会话已失效".into(),
            ncm_api_rs::error::NcmError::RateLimited(_) => "网易限制了请求频率；未自动重试".into(),
            ncm_api_rs::error::NcmError::Http(error) => format!(
                "网易网络请求失败（连接：{}，超时：{}，HTTP：{:?}）",
                error.is_connect(),
                error.is_timeout(),
                error.status().map(|s| s.as_u16())
            ),
            ncm_api_rs::error::NcmError::InvalidParam(message) => {
                let reason: String = message
                    .chars()
                    .filter(|c| {
                        ('\u{4e00}'..='\u{9fff}').contains(c) || "，。：；！？（）".contains(*c)
                    })
                    .take(80)
                    .collect();
                format!("网易返回请求限制状态：{reason}")
            }
            ncm_api_rs::error::NcmError::Crypto(_) => "网易协议加解密失败".into(),
            ncm_api_rs::error::NcmError::Json(_) => "网易返回格式与 SDK 不匹配".into(),
            _ => "网易接口请求失败；未输出可能包含会话的响应详情".into(),
        })
}
fn code(body: &Value) -> i64 {
    body["code"].as_i64().unwrap_or(-1)
}
fn checked(response: ApiResponse) -> Result<Value> {
    if code(&response.body) != 200 {
        return Err(format!(
            "网易返回状态 {}，本次请求未完成",
            code(&response.body)
        ));
    }
    Ok(response.body)
}
fn session_cookie(headers: &[String]) -> Result<String> {
    let mut values = BTreeMap::new();
    for header in headers {
        let pair = header.split(';').next().unwrap_or("");
        if let Some((name, value)) = pair.split_once('=') {
            if ["MUSIC_U", "__csrf", "NMTID"].contains(&name.trim())
                && !value.is_empty()
                && value.bytes().all(|c| c.is_ascii_graphic() && c != b';')
            {
                values.insert(name.trim(), value);
            }
        }
    }
    if !values.contains_key("MUSIC_U") {
        return Err("登录响应未包含有效会话".into());
    }
    Ok(values
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; "))
}
fn new_device() -> Result<String> {
    let mut bytes = [0u8; 16];
    fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|_| "无法生成本机会话标识")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn qr_key(body: &Value) -> Option<&str> {
    body.pointer("/data/unikey")
        .or_else(|| body.get("unikey"))
        .and_then(Value::as_str)
        .filter(|key| {
            !key.is_empty()
                && key.len() < 512
                && key
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        })
}
fn media_url(raw: &str) -> Result<String> {
    let mut url = url::Url::parse(raw).map_err(|_| "音频地址无效")?;
    let host = url.host_str().unwrap_or("");
    if !["music.126.net", "music.163.com"]
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
        || !["https", "http"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("音频地址不属于允许的网易域名".into());
    }
    url.set_scheme("https")
        .map_err(|_| "音频地址必须支持 HTTPS")?;
    Ok(url.to_string())
}
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

#[derive(Clone, Serialize)]
pub struct Playlist {
    id: String,
    name: String,
    count: u64,
}
#[derive(Clone, Serialize)]
pub struct Track {
    id: String,
    name: String,
    artist: String,
    duration: f64,
}
#[derive(Serialize)]
pub struct View {
    authenticated: bool,
    login: String,
    qr: Option<String>,
    playlists: Vec<Playlist>,
    playlist: Option<String>,
    tracks: Vec<Track>,
    total: u64,
    playback: Playback,
}
#[derive(Clone, Serialize)]
pub struct Playback {
    state: String,
    track: Option<Track>,
    seconds: f64,
    duration: f64,
    volume: u8,
}
impl Default for Playback {
    fn default() -> Self {
        Self {
            state: "stopped".into(),
            track: None,
            seconds: 0.0,
            duration: 0.0,
            volume: 50,
        }
    }
}
struct Login {
    key: String,
    device: String,
    deadline: Instant,
    last_poll: Instant,
    image: String,
    confirm: bool,
}
#[derive(Default)]
struct Engine {
    api: Option<ApiClient>,
    login: Option<Login>,
    expired: bool,
    playlists: Vec<Playlist>,
    playlist: Option<String>,
    tracks: Vec<Track>,
    total: u64,
    volume: Option<u8>,
}
#[derive(Default)]
pub struct Controller {
    engine: tokio::sync::Mutex<Engine>,
    player: Mutex<Option<Player>>,
    closed: AtomicBool,
    epoch: AtomicU64,
}
impl Controller {
    pub fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.stop();
    }
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.invalidate();
    }
    fn stop(&self) {
        if let Ok(mut player) = self.player.lock() {
            *player = None;
        }
    }
    fn with_player<T>(&self, f: impl FnOnce(&mut Option<Player>) -> Result<T>) -> Result<T> {
        let mut player = self.player.lock().map_err(|_| "播放器状态不可用")?;
        if self.closed.load(Ordering::SeqCst) {
            return Err("窗口已关闭".into());
        }
        f(&mut player)
    }
    pub async fn run(&self, action: Action) -> Result<View> {
        let epoch = self.epoch.load(Ordering::SeqCst);
        let mut e = self.engine.lock().await;
        if self.closed.load(Ordering::SeqCst) {
            return Err("窗口已关闭".into());
        }
        match action {
            Action::Restore {} => {
                if e.api.is_none() {
                    // No plaintext fallback, and no access to another application's login.
                    match entry()?.get_password() {
                        Ok(text) => {
                            let session: Session =
                                serde_json::from_str(&text).map_err(|_| "会话无效，请重新扫码")?;
                            let api = client(Some(&session));
                            let lists = read_playlists(&api).await?;
                            e.api = Some(api);
                            e.playlists = lists;
                        }
                        Err(keyring::Error::NoEntry) => {}
                        Err(_) => return Err("请解锁系统钥匙串后重试".into()),
                    }
                }
            }
            Action::Login {} => {
                if e.api.is_some() {
                    return Err("请先退出当前账号".into());
                }
                if e.login
                    .as_ref()
                    .is_some_and(|l| l.deadline > Instant::now())
                {
                    return Err("请使用当前二维码，或先取消".into());
                }
                let device = new_device()?;
                let mut api = client(None);
                api.set_device_id(device.clone());
                let response = checked(bounded(api.login_qr_key(&Query::new())).await?)?;
                let key = qr_key(&response).ok_or("二维码生成失败")?.to_owned();
                let mut url = url::Url::parse("https://music.163.com/login").unwrap();
                url.query_pairs_mut().append_pair("codekey", &key);
                let image = qrcode::QrCode::new(url.as_str())
                    .map_err(|_| "二维码生成失败")?
                    .render::<image::Luma<u8>>()
                    .min_dimensions(360, 360)
                    .build();
                let mut bytes = Cursor::new(Vec::new());
                image::DynamicImage::ImageLuma8(image)
                    .write_to(&mut bytes, image::ImageFormat::Png)
                    .map_err(|_| "二维码生成失败")?;
                e.login = Some(Login {
                    key,
                    device,
                    deadline: Instant::now() + Duration::from_secs(180),
                    last_poll: Instant::now() - Duration::from_secs(3),
                    image: format!(
                        "data:image/png;base64,{}",
                        STANDARD.encode(bytes.into_inner())
                    ),
                    confirm: false,
                });
                e.expired = false;
            }
            Action::PollLogin {} => {
                if let Some(login) = &mut e.login {
                    if Instant::now() >= login.deadline {
                        e.login = None;
                        e.expired = true;
                    } else if login.last_poll.elapsed() >= Duration::from_secs(3) {
                        login.last_poll = Instant::now();
                        let mut api = client(None);
                        api.set_device_id(login.device.clone());
                        let response =
                            bounded(api.login_qr_check(&Query::new().param("key", &login.key)))
                                .await?;
                        match code(&response.body) {
                            801 => {}
                            802 => login.confirm = true,
                            800 => {
                                e.login = None;
                                e.expired = true;
                            }
                            803 => {
                                let session = Session {
                                    cookie: session_cookie(&response.cookie)?,
                                    device: login.device.clone(),
                                };
                                let api = client(Some(&session));
                                let lists = read_playlists(&api).await?;
                                let encoded =
                                    serde_json::to_string(&session).map_err(|_| "会话编码失败")?;
                                entry()?
                                    .set_password(&encoded)
                                    .map_err(|_| "系统钥匙串保存失败，请解锁后重试")?;
                                e.api = Some(api);
                                e.playlists = lists;
                                e.login = None;
                            }
                            _ => {
                                e.login = None;
                                return Err("扫码登录被限制，请稍后再试".into());
                            }
                        }
                    }
                }
            }
            Action::CancelLogin {} => {
                e.login = None;
                e.expired = false;
            }
            Action::Logout {} => {
                // Only reached from an explicit user action; no remote account mutation.
                self.stop();
                match entry()?.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => {}
                    Err(_) => return Err("系统钥匙串未能移除登录，请解锁后重试".into()),
                }
                *e = Engine::default();
            }
            Action::Tracks { playlist, offset } => {
                let list = e
                    .playlists
                    .iter()
                    .find(|p| p.id == playlist)
                    .ok_or("请先选择自己的歌单")?;
                let total = list.count;
                if offset > 0
                    && (e.playlist.as_ref() != Some(&playlist) || offset as usize != e.tracks.len())
                {
                    return Err("歌单页码已变化，请重新选择".into());
                }
                let api = e.api.as_ref().ok_or("请先扫码登录")?;
                let body = checked(
                    bounded(
                        api.playlist_track_all(
                            &Query::new()
                                .param("id", &playlist)
                                .param("limit", "100")
                                .param("offset", &offset.to_string()),
                        ),
                    )
                    .await?,
                )?;
                let songs = body["songs"].as_array().ok_or("歌单暂不可用")?;
                let tracks = songs.iter().filter_map(track).collect::<Vec<_>>();
                if offset == 0 {
                    e.tracks.clear();
                }
                e.tracks.extend(tracks);
                e.playlist = Some(playlist);
                e.total = total;
                // Some unavailable/deleted songs may be omitted by the service.
                if songs.len() < 100 {
                    e.total = e.tracks.len() as u64;
                }
            }
            Action::Play { id } => {
                self.stop();
                let track = e
                    .tracks
                    .iter()
                    .find(|t| t.id == id)
                    .ok_or("请先从歌单中选择歌曲")?
                    .clone();
                let api = e.api.as_ref().ok_or("请先扫码登录")?;
                let response = checked(
                    bounded(api.song_url(&Query::new().param("id", &id).param("br", "128000")))
                        .await?,
                )?;
                let item = response["data"]
                    .as_array()
                    .and_then(|d| d.first())
                    .ok_or("暂无可播放音源")?;
                let url = permitted_stream(item)?;
                if self.epoch.load(Ordering::SeqCst) != epoch {
                    return Err("页面已更新，播放已取消".into());
                }
                self.with_player(|p| {
                    if self.epoch.load(Ordering::SeqCst) != epoch {
                        return Err("页面已更新，播放已取消".into());
                    }
                    let volume = e.volume.unwrap_or(50);
                    *p = None;
                    *p = Some(Player::start(&url, track, volume)?);
                    Ok(())
                })?;
            }
            Action::Pause { paused } => self.with_player(|p| {
                let p = p.as_mut().ok_or("请先选择歌曲")?;
                p.ipc
                    .request(json!(["set_property", "pause", paused]), 20)?;
                p.view.state = if paused { "paused" } else { "playing" }.into();
                Ok(())
            })?,
            Action::Volume { volume } => {
                self.with_player(|p| {
                    let p = p.as_mut().ok_or("请先播放歌曲")?;
                    if volume > 100 {
                        return Err("音量超出范围".into());
                    }
                    p.ipc
                        .request(json!(["set_property", "volume", volume]), 21)?;
                    p.view.volume = volume;
                    Ok(())
                })?;
                e.volume = Some(volume);
            }
            Action::Stop {} => self.stop(),
            Action::Status {} => {}
        }
        let playback = self.with_player(|p| {
            if let Some(player) = p.as_mut() {
                if let Err(error) = player.poll() {
                    *p = None;
                    return Err(error);
                }
                Ok(player.view.clone())
            } else {
                Ok(Playback {
                    volume: e.volume.unwrap_or(50),
                    ..Playback::default()
                })
            }
        })?;
        Ok(View {
            authenticated: e.api.is_some(),
            login: if e.api.is_some() {
                "ready"
            } else if e.expired {
                "expired"
            } else if let Some(l) = &e.login {
                if l.confirm {
                    "confirm"
                } else {
                    "waiting"
                }
            } else {
                "idle"
            }
            .into(),
            qr: e.login.as_ref().map(|l| l.image.clone()),
            playlists: e.playlists.clone(),
            playlist: e.playlist.clone(),
            tracks: e.tracks.clone(),
            total: e.total,
            playback,
        })
    }
}
async fn read_playlists(api: &ApiClient) -> Result<Vec<Playlist>> {
    let account = checked(bounded(api.user_account(&Query::new())).await?)?;
    let uid = account["profile"]["userId"]
        .as_u64()
        .ok_or("登录已失效，请重新扫码")?;
    let response = checked(
        bounded(
            api.user_playlist(
                &Query::new()
                    .param("uid", &uid.to_string())
                    .param("limit", "1000"),
            ),
        )
        .await?,
    )?;
    Ok(response["playlist"]
        .as_array()
        .ok_or("歌单暂不可用")?
        .iter()
        .filter_map(|p| {
            Some(Playlist {
                id: p["id"].as_u64()?.to_string(),
                name: p["name"].as_str()?.chars().take(200).collect(),
                count: p["trackCount"].as_u64().unwrap_or(0),
            })
        })
        .collect())
}
fn track(v: &Value) -> Option<Track> {
    Some(Track {
        id: v["id"].as_u64()?.to_string(),
        name: v["name"].as_str()?.chars().take(200).collect(),
        artist: v["ar"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v["name"].as_str())
                    .collect::<Vec<_>>()
                    .join(" / ")
            })
            .unwrap_or_default()
            .chars()
            .take(300)
            .collect(),
        duration: v["dt"].as_f64()? / 1000.0,
    })
}
fn permitted_stream(item: &Value) -> Result<String> {
    if !item["freeTrialInfo"].is_null() {
        return Err("此歌曲仅支持试听，请选择其他歌曲".into());
    }
    media_url(item["url"].as_str().ok_or("当前账号无法播放此歌曲")?)
}
struct Player {
    child: Child,
    ipc: Ipc,
    _dir: tempfile::TempDir,
    view: Playback,
    started: Instant,
}
impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Player {
    fn start(url: &str, track: Track, volume: u8) -> Result<Self> {
        // tempfile creates a private 0700 directory; no signed URL is written to disk/argv.
        let dir = tempfile::Builder::new()
            .prefix("horizon-player-")
            .tempdir()
            .map_err(|_| "无法创建播放器私有目录")?;
        let socket = dir.path().join("mpv.sock");
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
                "--force-media-title=HORIZON NetEase",
            ])
            .arg(format!("--volume={volume}"))
            .arg(format!("--input-ipc-server={}", socket.display()))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "请安装 mpv 后重试")?;
        // Own the process before any fallible IPC operation, so startup failure cannot leak it.
        let mut child = ChildGuard(Some(child));
        let started = Instant::now();
        let stream = loop {
            if let Ok(s) = UnixStream::connect(&socket) {
                break s;
            }
            if started.elapsed() > Duration::from_secs(4)
                || child
                    .0
                    .as_mut()
                    .unwrap()
                    .try_wait()
                    .map_err(|_| "播放器状态不可用")?
                    .is_some()
            {
                return Err("mpv 未能启动".into());
            }
            std::thread::sleep(Duration::from_millis(25));
        };
        let mut ipc = Ipc::new(stream)?;
        ipc.request(json!(["loadfile", url, "replace"]), 1)?;
        Ok(Self {
            child: child.0.take().unwrap(),
            ipc,
            _dir: dir,
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
    #[test]
    fn qr_key_supports_direct_and_wrapped_service_responses() {
        assert_eq!(
            qr_key(&json!({"code":200,"unikey":"test-key"})),
            Some("test-key")
        );
        assert_eq!(
            qr_key(&json!({"data":{"unikey":"test-key"}})),
            Some("test-key")
        );
        for value in [
            json!({}),
            json!({"unikey":""}),
            json!({"unikey":"bad\nkey"}),
        ] {
            assert!(qr_key(&value).is_none());
        }
    }
    #[test]
    fn cookies_never_include_attributes_or_unrelated_secrets() {
        let headers = vec![
            "MUSIC_U=test-session; Path=/; HttpOnly".into(),
            "__csrf=test-csrf; Secure".into(),
            "OTHER=omit; Path=/".into(),
        ];
        assert_eq!(
            session_cookie(&headers).unwrap(),
            "MUSIC_U=test-session; __csrf=test-csrf"
        );
        assert!(session_cookie(&["MUSIC_U=bad\nvalue".into()]).is_err());
    }
    #[test]
    fn playback_urls_require_the_exact_provider_boundary() {
        assert!(media_url("http://m801.music.126.net/test.mp3")
            .unwrap()
            .starts_with("https://"));
        for url in [
            "https://music.126.net.evil.test/a",
            "https://user@music.126.net/a",
            "file:///tmp/a",
            "https://music.126.net:8080/a",
        ] {
            assert!(media_url(url).is_err());
        }
    }
    #[test]
    fn trial_and_missing_stream_permissions_are_explicit_errors() {
        assert!(permitted_stream(
            &json!({"url":"https://m.music.126.net/a","freeTrialInfo":{"start":0,"end":30}})
        )
        .is_err());
        assert!(permitted_stream(&json!({"url":null})).is_err());
        assert!(
            permitted_stream(&json!({"url":"https://m.music.126.net/a","freeTrialInfo":null}))
                .is_ok()
        );
    }
    #[test]
    fn command_boundary_rejects_arbitrary_api_urls_and_unknown_fields() {
        assert!(serde_json::from_value::<Action>(
            json!({"type":"play","url":"https://example.org"})
        )
        .is_err());
        assert!(serde_json::from_value::<Action>(json!({"type":"volume","volume":101})).is_ok());
        assert!(serde_json::from_value::<Action>(
            json!({"type":"request","endpoint":"user_update"})
        )
        .is_err());
        assert!(
            serde_json::from_value::<Action>(json!({"type":"stop","cookie":"example"})).is_err()
        );
    }
    #[test]
    fn query_defaults_do_not_override_network_identity() {
        let query = Query::new();
        assert!(query.real_ip.is_none());
        assert!(!query.random_cn_ip);
        assert!(query.proxy.is_none());
        assert!(query.domain.is_none());
    }
}
