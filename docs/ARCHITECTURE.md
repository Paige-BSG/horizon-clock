# Architecture

## Frontend

Vanilla HTML, CSS and ECMAScript modules preserve the accepted visual design without introducing a UI framework. `app.js` owns clock rendering and interaction. `lib/backgrounds.js` owns profile previews, image transitions, playlists and the album interface; `lib/photos.js` owns local IndexedDB storage and image normalization. `lib/settings.js` validates and migrates preferences; `lib/night.js` owns local-time night scheduling; `lib/weather.js` parses provider data and validates cache. `lib/product.js` connects onboarding, weather, settings backup and release metadata checking to the interface.

`scripts/build.mjs` copies a fixed frontend file set into `dist/`. No source server, package manager or Node runtime is required by the installed app. Assets are local and embedded in the desktop distribution. `scripts/serve.mjs` is a loopback-only development server with an explicit file allowlist.

Background transitions retain an opaque outgoing image under a decoded incoming image, with the contrast mask above both. Only the incoming image fades; simultaneous fade-out/fade-in would expose the dark backdrop. Reuse of the two image layers waits for transition completion (with a bounded fallback), and superseded requests are discarded before committing. Reduced-motion settings skip the fade.

## Desktop

Tauri 2 embeds the frontend in the platform webview. Five narrow commands expose fullscreen state/control, autostart state/control and awake control. Autostart uses the maintained Tauri plugin and changes only after user interaction. Native awake requests run off the interface thread.

Native Wayland sessions use `zwp_idle_inhibit_manager_v1` on the clock window’s existing surface, plus a systemd-logind `idle` inhibitor. A separate event queue borrows GTK’s connection without owning its display or surface. Acquisition and window-close cleanup run on the GTK thread so borrowed handles cannot race window destruction. Non-Wayland Linux sessions retain the ScreenSaver D-Bus backend. Both display and logind requests must succeed; partial failure releases the first inhibitor. Disabling or closing the window releases both. Other development platforms use `keepawake`. The application does not change global power policies or block explicit manual suspend. A hidden/unmapped Wayland surface follows compositor visibility rules.

The frontend has no shell or arbitrary filesystem API. A restricted content policy allows local assets, native IPC and the two optional network hosts. Browser previews use the Screen Wake Lock API instead of native controls.

## State and networking

- `horizon-display-v1`: validated preferences, keeping compatibility with the design prototype. v0.2 adds independent day/night background, dimming and information-brightness fields. JSON backups use schema version 2 and accept older version-1 files.
- `horizon-photos-v1`: device-local IndexedDB library holding normalized JPEG copies, small thumbnails, enabled state and framing coordinates. File imports are sequential, deduplicated by SHA-256 of the source and capped at 24 photos / 64 MiB total; each input is limited to 20 MiB and 40 megapixels. Full copies are reduced to a maximum 2560-pixel edge. Canvas re-encoding strips the original metadata. No original path or raw file is retained. Settings backups contain references, not photo files. Library transactions enforce capacity across windows.
- `horizon-weather-v1:<city>`: per-city weather snapshots, rejected after 24 hours or if malformed. Fetching occurs every 15 minutes while visible, with a 10-second timeout. Hidden pages stop periodic weather and scene work; resume checks the cache age.
- Weather is opt-in. Only known, rounded city-center coordinates are sent to Open-Meteo. No GPS, accounts or telemetry.
- Imports preserve the receiving device's network consent and awake state; native autostart is managed independently. Exports are JSON with an app identifier and schema version.
- Update checking is user-triggered HTTPS metadata retrieval from the fixed GitHub repository. No downloaded code is executed. Update installation/signing remains a release milestone.

## Build and maintenance choices

Production dependencies are confined to desktop integration: Tauri, its autostart plugin, zbus and Wayland protocol bindings on Linux, and keepawake on other platforms. Wayland bindings are necessary because Omarchy 4.5 has no ScreenSaver D-Bus service. The optional `native-qa` feature adds an embedded loopback-only WebDriver server for testing; it is absent from normal builds. Their cost is the native Rust/GTK/webview build toolchain and OS-specific testing. Development uses Node built-ins, Playwright and Prettier. Lockfiles pin dependencies. Public CI uses standard Ubuntu runners and does not upload artifacts or enable build caches.

Sources: [Tauri prerequisites](https://tauri.app/start/prerequisites/), [autostart](https://tauri.app/plugin/autostart/), [Linux distribution](https://tauri.app/distribute/), [Open-Meteo API](https://open-meteo.com/en/docs), [Omarchy idle behavior](https://omarchy.org/manual/toggles-idle-screensaver/).

## Online scenery

`lib/scenes.js` supplies the 21 bundled backgrounds and their individual credits. `gallery-model.js` validates Commons category/image metadata, URLs, licenses and bounded response bodies. `online-gallery.js` performs consent-gated daily checks, downloads and normalizes up to six JPEGs, and atomically replaces the separate `horizon-online-v1` IndexedDB snapshot. Up to two day/night-selected older scenes remain available. Personal-photo storage is separate and unchanged. Newest-first category IDs are retained independently of imageinfo page-ID ordering. Cache identity includes the Commons image revision SHA1; object URLs are reclaimed after crossfades.

The desktop adds the official `tauri-plugin-opener` only for user-clicked source/license pages. Frontend links invoke an HTTPS/host/path validated Rust command; arbitrary shell/filesystem opening is not exposed. CSP connect-src permits Commons metadata and thumbnail CDNs. Photos are displayed from bundled files or cached blob URLs. No image-provider key, remote configuration server or new backend is required.

## Local music controls

`lib/music.js` owns an optional inline control bar, player selection and serialized UI actions. It polls only while the bar and document are visible, waiting three seconds after each request. Native readback supplies playback state; failed commands do not optimistically report success. A selection includes both the MPRIS bus name and its unique owner. Disappearance or process replacement disables controls until the user selects a new connection.

`media.rs` exposes two Tauri commands and serializes local DTOs with `serde`, already present in the dependency tree. On Linux, blocking workers reuse a bounded-timeout session connection through the existing `zbus` dependency. `media_mpris.rs` discovers running MPRIS names and reads metadata/capabilities with `GetAll`. Control accepts only toggle/previous/next, checks the current owner and capabilities, and sends Play/Pause/Previous/Next to that unique owner. It does not launch players or access accounts, audio, media URLs, art or lyrics. Other platforms return an unsupported state. `media_mpris_tests.rs` exercises actual D-Bus messages against an isolated test service over a local socket pair; it requires no system D-Bus changes. See [music behavior and platform limits](MUSIC.md).
