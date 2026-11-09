use crate::media::{Player, Snapshot};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::OwnedValue;

#[cfg(all(test, unix))]
#[path = "media_mpris_tests.rs"]
mod tests;

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
type Properties = HashMap<String, OwnedValue>;

fn bus(connection: &Connection) -> zbus::Result<Proxy<'_>> {
    Proxy::new(
        connection,
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
    )
}

fn valid_player(id: &str) -> bool {
    id.starts_with(PREFIX)
        && id.len() > PREFIX.len()
        && id.len() <= 255
        && zbus::names::WellKnownName::try_from(id).is_ok()
}

fn text(value: Option<&OwnedValue>) -> String {
    value
        .and_then(|value| <&str>::try_from(value).ok())
        .unwrap_or_default()
        .chars()
        .filter(|ch| !ch.is_control())
        .take(256)
        .collect()
}

fn flag(properties: &Properties, name: &str) -> bool {
    properties
        .get(name)
        .and_then(|value| bool::try_from(value).ok())
        .unwrap_or(false)
}

fn read_player(connection: &Connection, id: &str, owner: String) -> zbus::Result<Player> {
    // Address the current unique owner. Never activate a closed application.
    let properties = Proxy::new(
        connection,
        owner.as_str(),
        PATH,
        "org.freedesktop.DBus.Properties",
    )?;
    let values: Properties = properties.call("GetAll", &(PLAYER,))?;
    let identity: String = properties
        .call::<_, _, OwnedValue>("Get", &("org.mpris.MediaPlayer2", "Identity"))
        .map(|value| text(Some(&value)))
        .unwrap_or_default();
    let metadata: Properties = values
        .get("Metadata")
        .and_then(|value| value.try_clone().ok())
        .and_then(|value| Properties::try_from(value).ok())
        .unwrap_or_default();
    let artist = metadata
        .get("xesam:artist")
        .and_then(|value| value.try_clone().ok())
        .and_then(|value| Vec::<String>::try_from(value).ok())
        .map(|names| names.into_iter().take(8).collect::<Vec<_>>().join(" / "))
        .unwrap_or_default()
        .chars()
        .filter(|ch| !ch.is_control())
        .take(256)
        .collect();
    let status = text(values.get("PlaybackStatus"));
    let can_control = flag(&values, "CanControl");
    drop(properties);
    Ok(Player {
        id: id.to_string(),
        owner,
        name: if identity.is_empty() {
            id[PREFIX.len()..].to_string()
        } else {
            identity
        },
        title: text(metadata.get("xesam:title")),
        artist,
        can_toggle: can_control
            && flag(
                &values,
                if status == "Playing" {
                    "CanPause"
                } else {
                    "CanPlay"
                },
            ),
        can_previous: can_control && flag(&values, "CanGoPrevious"),
        can_next: can_control && flag(&values, "CanGoNext"),
        status,
    })
}

pub fn snapshot(connection: &Connection) -> Result<Snapshot, String> {
    let bus = bus(connection).map_err(|_| "无法连接系统媒体服务。".to_string())?;
    let mut names: Vec<String> = bus
        .call("ListNames", &())
        .map_err(|_| "无法读取播放器，请重试。".to_string())?;
    names.retain(|name| valid_player(name));
    names.sort();
    let started = Instant::now();
    let mut players = Vec::new();
    for id in names.into_iter().take(16) {
        if started.elapsed() > Duration::from_secs(3) {
            break;
        }
        let Ok(owner) = bus.call::<_, _, String>("GetNameOwner", &(&id,)) else {
            continue;
        };
        if let Ok(player) = read_player(connection, &id, owner) {
            players.push(player);
        }
    }
    Ok(Snapshot {
        supported: true,
        players,
    })
}

pub fn control(connection: &Connection, id: &str, owner: &str, action: &str) -> Result<(), String> {
    if !valid_player(id) || !matches!(action, "toggle" | "previous" | "next") {
        return Err("无效的音乐控制请求。".into());
    }
    let bus = bus(connection).map_err(|_| "无法连接系统媒体服务。".to_string())?;
    let current: String = bus
        .call("GetNameOwner", &(id,))
        .map_err(|_| "播放器已关闭，请重新打开后再试。".to_string())?;
    if current != owner || zbus::names::UniqueName::try_from(owner).is_err() {
        return Err("播放器已重新连接，请确认后再试。".into());
    }
    let player = read_player(connection, id, current)
        .map_err(|_| "无法读取播放器状态，请重试。".to_string())?;
    let (allowed, method) = match action {
        "toggle" => (
            player.can_toggle,
            if player.status == "Playing" {
                "Pause"
            } else {
                "Play"
            },
        ),
        "previous" => (player.can_previous, "Previous"),
        "next" => (player.can_next, "Next"),
        _ => unreachable!(),
    };
    if !allowed {
        return Err("当前播放器不支持此操作。".into());
    }
    Proxy::new(connection, owner, PATH, PLAYER)
        .and_then(|proxy| proxy.call::<_, _, ()>(method, &()))
        .map_err(|_| "播放指令未能完成，请检查播放器后重试。".to_string())
}
