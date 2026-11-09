# Security and privacy

HORIZON has no account system, telemetry or analytics. Weather is off until enabled. If enabled, it sends only the selected city's rounded center coordinates to Open-Meteo; it never reads GPS. Network providers can still see the requesting IP address. Checking for updates contacts GitHub only when the user presses the button.

Preferences, recent weather and imported photo copies are stored on the device. Photos are never sent to the weather provider or GitHub. The importer accepts raster JPG/PNG/WebP after file-signature validation, applies file/pixel/library limits, re-encodes copies without original EXIF metadata and creates small thumbnails. Removing an entry deletes the library copy only, never its original file. Clearing the app/browser data can remove the library; settings JSON backups do not contain photos. The desktop frontend is embedded in the application. The development server listens on `127.0.0.1` and only serves frontend files; it is not a production or public hosting server.

Native commands are limited to the local application window and specific fullscreen, autostart and awake operations. No arbitrary shell execution or filesystem commands are exposed. Keep-awake inhibitors are scoped to the application lifetime. HORIZON does not disable authentication, change global sleep policies, or install itself at login without a user's choice.

Settings imports validate a versioned schema, accept known fields only, cap input size, and preserve this device's network consent and power choices. Updates currently check release metadata only: they do not download or execute code. Signed application updates are a future release gate; never place signing keys in this repository.

Report non-sensitive defects through GitHub Issues. For a vulnerability, use GitHub's private vulnerability reporting if available, or contact the maintainer through their GitHub profile before disclosing technical exploit details. Do not publish credentials or private data in an issue.

This is an alpha project. The 1.0 security and reliability acceptance gates are recorded in [ROADMAP.md](ROADMAP.md).
