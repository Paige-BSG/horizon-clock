use ncm_api_rs::{create_client, request::ApiResponse, ApiClient, Query};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    future::Future,
    io::{BufRead, BufReader, Read, Write},
    os::unix::{
        fs::{DirBuilderExt, PermissionsExt},
        net::UnixStream,
    },
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;
const SERVICE: &str = "io.github.paige-bsg.horizon-clock.netease-probe";
const ACCOUNT: &str = "netease-session";
#[derive(Serialize, Deserialize)]
struct Session {
    cookie: String,
    device: String,
}
fn emit(value: Value) {
    println!("{value}");
}
fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| "系统凭据存储不可用".into())
}
fn load_session() -> Result<Session> {
    let text = entry()?
        .get_password()
        .map_err(|_| "未找到本验证程序的登录会话，或系统钥匙串未解锁")?;
    serde_json::from_str(&text).map_err(|_| "会话格式无效，请重新扫码".into())
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
fn private_dir(path: &Path) -> Result<()> {
    if !path.is_absolute() || path == Path::new("/") {
        return Err("验证目录必须是独立的绝对路径".into());
    }
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return Err("验证目录不能是链接或文件".into());
        }
    }
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|_| "无法创建验证目录")?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "无法保护验证目录".into())
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
async fn login(dir: &Path) -> Result<()> {
    private_dir(dir)?;
    let device = new_device()?;
    let mut api = client(None);
    api.set_device_id(device.clone());
    let key_response = checked(bounded(api.login_qr_key(&Query::new())).await?)?;
    let key = qr_key(&key_response).ok_or("网易未返回二维码")?;
    let mut qr = url::Url::parse("https://music.163.com/login").unwrap();
    qr.query_pairs_mut().append_pair("codekey", key);
    let path = dir.join("login-qr.png");
    if path.exists() {
        return Err("此验证目录已有二维码，请使用新的独立目录".into());
    }
    qrcode::QrCode::new(qr.as_str())
        .map_err(|_| "二维码生成失败")?
        .render::<image::Luma<u8>>()
        .min_dimensions(480, 480)
        .build()
        .save(&path)
        .map_err(|_| "二维码文件写入失败")?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "无法保护二维码文件")?;
    emit(
        json!({"event":"scan_required","image":path,"expires_seconds":180,"session_store":"system_keyring"}),
    );
    let end = Instant::now() + Duration::from_secs(180);
    let mut previous = 0;
    loop {
        if Instant::now() >= end {
            return Err("扫码等待已结束；未自动重试登录".into());
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        let response = bounded(api.login_qr_check(&Query::new().param("key", key))).await?;
        match code(&response.body) {
            801 | 802 => {
                let state = code(&response.body);
                if state != previous {
                    emit(
                        json!({"event":if state==801 {"waiting_for_scan"} else {"waiting_for_confirmation"}}),
                    );
                    previous = state;
                }
            }
            803 => {
                let cookie = session_cookie(&response.cookie)?;
                let session = Session { cookie, device };
                let logged = client(Some(&session));
                let account = checked(bounded(logged.user_account(&Query::new())).await?)?;
                if account["profile"]["userId"].as_u64().is_none() {
                    return Err("会话验证未完成，未保存登录状态".into());
                }
                let encoded = serde_json::to_string(&session).map_err(|_| "会话编码失败")?;
                entry()?
                    .set_password(&encoded)
                    .map_err(|_| "系统钥匙串保存失败；没有写入明文后备文件")?;
                emit(json!({"event":"authenticated","stored_in":"system_keyring"}));
                return library().await;
            }
            800 => return Err("二维码已失效，请明确请求新的二维码".into()),
            other => {
                return Err(format!(
                    "登录返回状态 {other}，停止验证；没有切换网页登录或其他登录方式"
                ))
            }
        }
    }
}
async fn finish_login() -> Result<()> {
    let mut input = String::new();
    std::io::stdin()
        .take(1024)
        .read_to_string(&mut input)
        .map_err(|_| "无法读取本次二维码")?;
    let url = url::Url::parse(input.trim()).map_err(|_| "二维码无效")?;
    if url.scheme() != "https"
        || url.host_str() != Some("music.163.com")
        || url.path() != "/login"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("二维码不是本次网易登录入口".into());
    }
    let key = url
        .query_pairs()
        .find(|(key, _)| key == "codekey")
        .map(|(_, value)| value.into_owned())
        .ok_or("二维码没有登录标识")?;
    let device = new_device()?;
    let mut api = client(None);
    api.set_device_id(device.clone());
    for _ in 0..5 {
        let response = bounded(api.login_qr_check(&Query::new().param("key", &key))).await?;
        match code(&response.body) {
            803 => {
                let session = Session {
                    cookie: session_cookie(&response.cookie)?,
                    device,
                };
                let logged = client(Some(&session));
                let account = checked(bounded(logged.user_account(&Query::new())).await?)?;
                if account["profile"]["userId"].as_u64().is_none() {
                    return Err("会话验证未完成，未保存登录状态".into());
                }
                let encoded = serde_json::to_string(&session).map_err(|_| "会话编码失败")?;
                entry()?
                    .set_password(&encoded)
                    .map_err(|_| "系统钥匙串保存失败；没有写入明文后备文件")?;
                emit(json!({"event":"authenticated","stored_in":"system_keyring"}));
                return library().await;
            }
            802 => emit(json!({"event":"waiting_for_confirmation"})),
            801 => emit(json!({"event":"waiting_for_scan"})),
            other => return Err(format!("本次二维码返回状态 {other}；未切换登录方式")),
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    Err("本次扫码未收到手机确认".into())
}
async fn playlists(api: &ApiClient) -> Result<Vec<Value>> {
    emit(json!({"event":"checking_saved_session"}));
    let account = checked(bounded(api.user_account(&Query::new())).await?)?;
    let uid = account["profile"]["userId"]
        .as_u64()
        .ok_or("会话无效，请重新扫码")?;
    emit(json!({"event":"reading_user_playlists"}));
    let response = checked(
        bounded(
            api.user_playlist(
                &Query::new()
                    .param("uid", &uid.to_string())
                    .param("limit", "50"),
            ),
        )
        .await?,
    )?;
    response["playlist"]
        .as_array()
        .cloned()
        .ok_or_else(|| "网易未返回歌单".into())
}
async fn library() -> Result<()> {
    let session = load_session()?;
    let api = client(Some(&session));
    let lists = playlists(&api).await?;
    emit(
        json!({"event":"library_ready","session_restored":true,"playlist_count":lists.len(),"playlists":lists.iter().enumerate().map(|(index,p)|json!({"index":index,"name":p["name"],"tracks":p["trackCount"]})).collect::<Vec<_>>()}),
    );
    Ok(())
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
struct Player(Child);
impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
struct Ipc {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
    end_reason: Option<String>,
}
impl Ipc {
    fn new(stream: UnixStream) -> Result<Self> {
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
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
async fn play(dir: &Path, list_index: usize, track_index: usize) -> Result<()> {
    private_dir(dir)?;
    let session = load_session()?;
    let api = client(Some(&session));
    emit(json!({"event":"reading_account_and_playlists"}));
    let lists = playlists(&api).await?;
    let list = lists.get(list_index).ok_or("歌单序号无效")?;
    let id = list["id"].as_u64().ok_or("歌单编号无效")?;
    emit(json!({"event":"reading_playlist_tracks"}));
    let songs = checked(
        bounded(
            api.playlist_track_all(
                &Query::new()
                    .param("id", &id.to_string())
                    .param("limit", "20")
                    .param("offset", "0"),
            ),
        )
        .await?,
    )?;
    let song = songs["songs"]
        .as_array()
        .and_then(|s| s.get(track_index))
        .ok_or("歌曲序号无效（只验证前 20 首）")?;
    let song_id = song["id"].as_u64().ok_or("歌曲编号无效")?;
    emit(json!({"event":"requesting_track_stream"}));
    let response = checked(
        bounded(
            api.song_url(
                &Query::new()
                    .param("id", &song_id.to_string())
                    .param("br", "128000"),
            ),
        )
        .await?,
    )?;
    let item = response["data"]
        .as_array()
        .and_then(|d| d.first())
        .ok_or("没有可播放音源")?;
    if !item["freeTrialInfo"].is_null() {
        return Err("此歌曲仅返回试听权限，未当作完整播放测试".into());
    }
    let url = media_url(item["url"].as_str().ok_or("账号没有此歌曲的可播放地址")?)?;
    let socket = dir.join("mpv.sock");
    if socket.exists() {
        return Err("验证目录中已有播放控制端点".into());
    }
    let mut command = Command::new("mpv");
    if cfg!(target_os = "linux") {
        command.arg("--ao=pulse");
    }
    let player = command
        .args([
            "--no-config",
            "--idle=yes",
            "--no-video",
            "--no-terminal",
            "--volume=50",
            "--force-media-title=HORIZON NetEase verification",
        ])
        .arg(format!("--input-ipc-server={}", socket.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "本机没有可用的 mpv 播放引擎")?;
    let mut player = Player(player);
    let started = Instant::now();
    let stream = loop {
        if let Ok(stream) = UnixStream::connect(&socket) {
            break stream;
        }
        if started.elapsed() > Duration::from_secs(5) {
            return Err("播放器未能启动".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    let mut ipc = Ipc::new(stream)?;
    ipc.request(json!(["loadfile", url, "replace"]), 1)?;
    let metadata_duration = song["dt"].as_f64().unwrap_or(0.0) / 1000.0;
    let mut maximum = 0.0f64;
    let mut expected = 0.0f64;
    let mut ticks = 0u64;
    let mut announced = false;
    loop {
        tokio::select! { _=tokio::signal::ctrl_c()=>return Err("播放验证已由用户停止".into()), _=tokio::time::sleep(Duration::from_secs(1))=>{} }
        if player
            .0
            .try_wait()
            .map_err(|_| "无法检查播放器状态")?
            .is_some()
        {
            return Err("播放器提前退出".into());
        }
        if let Ok(t) = ipc.request(json!(["get_property", "time-pos"]), 10) {
            maximum = maximum.max(t.as_f64().unwrap_or(0.0));
        }
        if let Ok(d) = ipc.request(json!(["get_property", "duration"]), 11) {
            expected = d.as_f64().unwrap_or(expected);
        }
        if !announced && maximum > 0.1 {
            announced = true;
            emit(json!({"event":"playback_started","title":song["name"],"volume_percent":50}));
        }
        ticks += 1;
        if ticks.is_multiple_of(15) {
            emit(
                json!({"event":"playback_progress","seconds":maximum.round(),"duration_seconds":expected.round()}),
            );
        }
        if let Some(reason) = ipc.end_reason.as_deref() {
            if complete_track(reason, maximum, expected, metadata_duration) {
                emit(
                    json!({"event":"complete_track_verified","seconds":maximum.round(),"duration_seconds":expected.round(),"end_reason":reason}),
                );
                return Ok(());
            }
            return Err("歌曲未以正常完整结束状态结束".into());
        }
        if ticks > 900 || (ticks > 20 && maximum < 0.1) {
            return Err("播放验证超时；已停止本次播放器".into());
        }
    }
}
#[tokio::main]
async fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let result = match args.first().map(String::as_str) {
        Some("check") => {
            let api = client(None);
            match bounded(api.user_account(&Query::new())).await {
                Ok(r) => {
                    emit(
                        json!({"event":"api_reachable","upstream_code":code(&r.body),"authenticated":r.body["profile"]["userId"].is_u64()}),
                    );
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
        Some("login") => match args.get(1) {
            Some(dir) => login(Path::new(dir)).await,
            None => Err("请提供独立的二维码输出目录".into()),
        },
        Some("vault-check") => match entry().and_then(|vault| match vault.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err("系统钥匙串不可用或未解锁".into()),
        }) {
            Ok(present) => {
                emit(json!({"event":"vault_ready","session_present":present}));
                Ok(())
            }
            Err(error) => Err(error),
        },
        Some("finish-login") => finish_login().await,
        Some("forget-session") => match entry().and_then(|vault| {
            vault
                .delete_credential()
                .map_err(|_| "无法移除此验证程序的本机会话".into())
        }) {
            Ok(()) => {
                emit(json!({"event":"local_session_removed"}));
                Ok(())
            }
            Err(error) => Err(error),
        },
        Some("library") => library().await,
        Some("play") => match (
            args.get(1),
            args.get(2).and_then(|s| s.parse::<usize>().ok()),
            args.get(3).and_then(|s| s.parse::<usize>().ok()),
        ) {
            (Some(dir), Some(list), Some(track)) => play(Path::new(dir), list, track).await,
            _ => Err("用法：play 独立目录 歌单序号 歌曲序号".into()),
        },
        _ => Err("用法：check | login 独立目录 | library | play 独立目录 歌单序号 歌曲序号".into()),
    };
    if let Err(message) = result {
        emit(json!({"event":"error","message":message}));
        std::process::exit(1);
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
    fn query_defaults_do_not_override_network_identity() {
        let query = Query::new();
        assert!(query.real_ip.is_none());
        assert!(!query.random_cn_ip);
        assert!(query.proxy.is_none());
        assert!(query.domain.is_none());
    }
}
