use tauri::webview::{PermissionKind, PermissionResponse};

fn local_page(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let origin = (url.scheme(), url.host_str(), url.port());
    matches!(
        origin,
        ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None)
    ) || (cfg!(debug_assertions) && matches!(origin, ("http", Some("127.0.0.1"), Some(5174))))
}

pub fn permission(
    label: &str,
    url: Option<&tauri::Url>,
    kind: PermissionKind,
) -> PermissionResponse {
    if kind == PermissionKind::Geolocation && label == "main" && url.is_some_and(local_page) {
        // Only the bundled clock can request weather location; OS policy still applies.
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_is_limited_to_the_local_main_clock() {
        for value in [
            "tauri://localhost/",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
        ] {
            let url = tauri::Url::parse(value).unwrap();
            assert_eq!(
                permission("main", Some(&url), PermissionKind::Geolocation),
                PermissionResponse::Allow
            );
            assert_eq!(
                permission("other", Some(&url), PermissionKind::Geolocation),
                PermissionResponse::Default
            );
            assert_eq!(
                permission("main", Some(&url), PermissionKind::Microphone),
                PermissionResponse::Default
            );
        }
        for value in [
            "https://example.com/",
            "https://tauri.localhost.evil.test/",
            "http://127.0.0.1:5173/",
            "tauri://user@localhost/",
            "tauri://localhost:443/",
        ] {
            let url = tauri::Url::parse(value).unwrap();
            assert_eq!(
                permission("main", Some(&url), PermissionKind::Geolocation),
                PermissionResponse::Default
            );
        }
        assert_eq!(
            permission("main", None, PermissionKind::Geolocation),
            PermissionResponse::Default
        );
    }
}
