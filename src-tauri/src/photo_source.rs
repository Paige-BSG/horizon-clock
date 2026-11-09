pub fn validated(value: &str) -> Result<String, String> {
    let url = tauri::Url::parse(value).map_err(|_| "Invalid photo source".to_string())?;
    let path = url.path();
    let allowed = match url.host_str() {
        Some("commons.wikimedia.org") => path.starts_with("/wiki/File:"),
        Some("creativecommons.org") => {
            path.starts_with("/licenses/") || path.starts_with("/publicdomain/")
        }
        Some("unsplash.com") => path == "/license" || path.starts_with("/photos/"),
        Some("images.unsplash.com") => path.starts_with("/photo-"),
        _ => false,
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !allowed
    {
        return Err("Unsupported photo source".to_string());
    }
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::validated;

    #[test]
    fn accepts_photo_and_license_pages() {
        for url in [
            "https://commons.wikimedia.org/wiki/File:Lake.jpg",
            "https://creativecommons.org/licenses/by-sa/4.0/",
            "https://unsplash.com/license",
            "https://images.unsplash.com/photo-1518837695005-2083093ee35b",
        ] {
            assert!(validated(url).is_ok(), "{url}");
        }
    }

    #[test]
    fn rejects_commands_and_unrelated_destinations() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://commons.wikimedia.org.evil.test/wiki/File:X.jpg",
            "https://user@commons.wikimedia.org/wiki/File:X.jpg",
            "https://commons.wikimedia.org:444/wiki/File:X.jpg",
            "https://commons.wikimedia.org/wiki/File:X.jpg?redirect=1",
            "https://commons.wikimedia.org/wiki/Main_Page",
            "https://unsplash.com/login",
        ] {
            assert!(validated(url).is_err(), "{url}");
        }
    }
}
