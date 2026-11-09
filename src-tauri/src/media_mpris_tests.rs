use super::*;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Mutex};
use zbus::blocking::connection::Builder;
use zbus::zvariant::{Str, Value};

const ID: &str = "org.mpris.MediaPlayer2.netease";
const OWNER: &str = ":1.22";

struct State {
    present: bool,
    owner: String,
    playing: bool,
    can_control: bool,
    can_next: bool,
    can_pause: bool,
    calls: Vec<&'static str>,
    slow: bool,
}

impl Default for State {
    fn default() -> Self {
        Self {
            present: true,
            owner: OWNER.into(),
            playing: true,
            can_control: true,
            can_next: true,
            can_pause: true,
            calls: vec![],
            slow: false,
        }
    }
}

struct Bus(Arc<Mutex<State>>);
#[zbus::interface(name = "org.freedesktop.DBus")]
impl Bus {
    fn list_names(&self) -> Vec<String> {
        let mut names = vec!["org.example.private".into()];
        if self.0.lock().unwrap().present {
            names.push(ID.into());
        }
        names
    }

    fn get_name_owner(&self, name: &str) -> zbus::fdo::Result<String> {
        let state = self.0.lock().unwrap();
        if state.present && name == ID {
            Ok(state.owner.clone())
        } else {
            Err(zbus::fdo::Error::NameHasNoOwner("closed".into()))
        }
    }
}

struct Root;
#[zbus::interface(name = "org.mpris.MediaPlayer2")]
impl Root {
    #[zbus(property)]
    fn identity(&self) -> &str {
        "网易云音乐"
    }
}

struct TestPlayer(Arc<Mutex<State>>);
#[zbus::interface(name = "org.mpris.MediaPlayer2.Player")]
impl TestPlayer {
    fn play(&self) {
        let mut state = self.0.lock().unwrap();
        state.playing = true;
        state.calls.push("Play");
    }
    fn pause(&self) {
        let mut state = self.0.lock().unwrap();
        state.playing = false;
        state.calls.push("Pause");
    }
    fn next(&self) {
        self.0.lock().unwrap().calls.push("Next");
    }
    fn previous(&self) {
        self.0.lock().unwrap().calls.push("Previous");
    }
    #[zbus(property)]
    fn playback_status(&self) -> &'static str {
        let (slow, playing) = {
            let state = self.0.lock().unwrap();
            (state.slow, state.playing)
        };
        if slow {
            std::thread::sleep(Duration::from_millis(350));
        }
        if playing {
            "Playing"
        } else {
            "Paused"
        }
    }
    #[zbus(property)]
    fn metadata(&self) -> Properties {
        HashMap::from([
            (
                "xesam:title".into(),
                OwnedValue::from(Str::from("本地\n测试歌曲")),
            ),
            (
                "xesam:artist".into(),
                Value::from(vec!["歌手甲", "歌手乙"])
                    .try_to_owned()
                    .unwrap(),
            ),
        ])
    }
    #[zbus(property)]
    fn can_control(&self) -> bool {
        self.0.lock().unwrap().can_control
    }
    #[zbus(property)]
    fn can_play(&self) -> bool {
        true
    }
    #[zbus(property)]
    fn can_pause(&self) -> bool {
        self.0.lock().unwrap().can_pause
    }
    #[zbus(property)]
    fn can_go_next(&self) -> bool {
        self.0.lock().unwrap().can_next
    }
    #[zbus(property)]
    fn can_go_previous(&self) -> bool {
        true
    }
}

fn fixture(timeout: Duration) -> (Connection, Connection, Arc<Mutex<State>>) {
    let state = Arc::new(Mutex::new(State::default()));
    let service_state = state.clone();
    let (service_socket, client_socket) = UnixStream::pair().unwrap();
    let service = std::thread::spawn(move || {
        Builder::async_io_unix_stream(service_socket)
            .server(zbus::Guid::generate())
            .unwrap()
            .p2p()
            .serve_at("/org/freedesktop/DBus", Bus(service_state.clone()))
            .unwrap()
            .serve_at(PATH, Root)
            .unwrap()
            .serve_at(PATH, TestPlayer(service_state))
            .unwrap()
            .build()
            .unwrap()
    });
    let client = Builder::async_io_unix_stream(client_socket)
        .p2p()
        .method_timeout(timeout)
        .build()
        .unwrap();
    (client, service.join().unwrap(), state)
}

#[test]
fn discovery_and_commands_use_real_dbus_messages() {
    let (client, _service, state) = fixture(Duration::from_secs(1));
    let snapshot = snapshot(&client).unwrap();
    assert!(snapshot.supported);
    assert_eq!(snapshot.players.len(), 1);
    let player = &snapshot.players[0];
    assert_eq!(player.id, ID);
    assert_eq!(player.owner, OWNER);
    assert_eq!(player.name, "网易云音乐");
    assert_eq!(player.title, "本地测试歌曲");
    assert_eq!(player.artist, "歌手甲 / 歌手乙");
    assert!(player.can_toggle && player.can_previous && player.can_next);
    for action in ["toggle", "toggle", "previous", "next"] {
        control(&client, ID, OWNER, action).unwrap();
    }
    assert_eq!(
        state.lock().unwrap().calls,
        ["Pause", "Play", "Previous", "Next"]
    );
}

#[test]
fn permissions_and_player_lifecycle_reject_stale_or_arbitrary_commands() {
    let (client, _service, state) = fixture(Duration::from_secs(1));
    assert!(control(&client, "org.freedesktop.DBus", OWNER, "next").is_err());
    assert!(control(&client, "org.mpris.MediaPlayer2.", OWNER, "next").is_err());
    assert!(control(&client, ID, OWNER, "OpenUri").is_err());
    assert!(control(&client, ID, ":1.99", "next").is_err());
    state.lock().unwrap().can_next = false;
    assert!(!snapshot(&client).unwrap().players[0].can_next);
    assert!(control(&client, ID, OWNER, "next").is_err());
    state.lock().unwrap().can_control = false;
    assert!(control(&client, ID, OWNER, "toggle").is_err());
    assert!(control(&client, ID, OWNER, "previous").is_err());
    state.lock().unwrap().present = false;
    assert!(snapshot(&client).unwrap().players.is_empty());
    assert!(control(&client, ID, OWNER, "toggle").is_err());
    {
        let mut state = state.lock().unwrap();
        state.present = true;
        state.owner = ":1.99".into();
    }
    assert!(control(&client, ID, OWNER, "toggle").is_err());
    assert!(state.lock().unwrap().calls.is_empty());
}

#[test]
fn play_does_not_require_pause_capability_when_stopped_or_paused() {
    let (client, _service, state) = fixture(Duration::from_secs(1));
    {
        let mut state = state.lock().unwrap();
        state.playing = false;
        state.can_pause = false;
    }
    control(&client, ID, OWNER, "toggle").unwrap();
    assert_eq!(state.lock().unwrap().calls, ["Play"]);
    assert!(control(&client, ID, OWNER, "toggle").is_err());
}

#[test]
fn an_unresponsive_player_has_a_bounded_timeout() {
    let (client, _service, state) = fixture(Duration::from_millis(100));
    state.lock().unwrap().slow = true;
    let start = Instant::now();
    assert!(control(&client, ID, OWNER, "toggle").is_err());
    assert!(start.elapsed() < Duration::from_secs(1));
    assert!(state.lock().unwrap().calls.is_empty());
}
