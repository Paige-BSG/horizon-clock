# Architecture

## Frontend

Vanilla HTML, CSS and ECMAScript modules preserve the accepted visual design without introducing a UI framework. `app.js` owns clock rendering and interaction. `lib/backgrounds.js` owns profile previews, image transitions, playlists and the album interface; `lib/photos.js` owns local IndexedDB storage and image normalization. `lib/settings.js` validates and migrates preferences; `lib/night.js` owns local-time night scheduling; `lib/weather.js` parses provider data and validates cache. `lib/product.js` connects onboarding, weather, settings backup and release metadata checking to the interface.

`scripts/build.mjs` copies a fixed frontend file set into `dist/`. No source server, package manager or Node runtime is required by the installed app. Assets are local and embedded in the desktop distribution. `scripts/serve.mjs` is a loopback-only development server with an explicit file allowlist.

## Desktop

Tauri 2 embeds the frontend in the platform webview. Five narrow commands expose fullscreen state/control, autostart state/control and awake control. Autostart uses the maintained Tauri plugin and changes only after user interaction. Native awake requests run off the interface thread.

Linux uses D-Bus `org.freedesktop.ScreenSaver.Inhibit` plus a systemd-logind `idle` inhibitor. Both requests must succeed; partial failure cleans up the first request. Closing or disabling releases the handles. Service disappearance during logout is handled without a cleanup panic. Other development platforms use `keepawake`. This backend deliberately does not block explicit manual suspend or rewrite system power policies. Compatibility with the actual Omarchy service must be verified on-device.

The frontend has no shell or arbitrary filesystem API. A restricted content policy allows local assets, native IPC and the two optional network hosts. Browser previews use the Screen Wake Lock API instead of native controls.

## State and networking

- `horizon-display-v1`: validated preferences, keeping compatibility with the design prototype. v0.2 adds independent day/night background, dimming and information-brightness fields. JSON backups use schema version 2 and accept older version-1 files.
- `horizon-photos-v1`: device-local IndexedDB library holding normalized JPEG copies, small thumbnails, enabled state and framing coordinates. File imports are sequential, deduplicated by SHA-256 of the source and capped at 24 photos / 64 MiB total; each input is limited to 20 MiB and 40 megapixels. Full copies are reduced to a maximum 2560-pixel edge. Canvas re-encoding strips the original metadata. No original path or raw file is retained. Settings backups contain references, not photo files. Library transactions enforce capacity across windows.
- `horizon-weather-v1:<city>`: per-city weather snapshots, rejected after 24 hours or if malformed. Fetching occurs every 15 minutes while visible, with a 10-second timeout. Hidden pages stop periodic weather and scene work; resume checks the cache age.
- Weather is opt-in. Only known, rounded city-center coordinates are sent to Open-Meteo. No GPS, accounts or telemetry.
- Imports preserve the receiving device's network consent and awake state; native autostart is managed independently. Exports are JSON with an app identifier and schema version.
- Update checking is user-triggered HTTPS metadata retrieval from the fixed GitHub repository. No downloaded code is executed. Update installation/signing remains a release milestone.

## Build and maintenance choices

Production dependencies are confined to desktop integration: Tauri, its autostart plugin, zbus on Linux and keepawake on other platforms. Their cost is the native Rust/GTK/webview build toolchain and OS-specific testing. Development uses Node built-ins, Playwright and Prettier. Lockfiles pin dependencies. Public CI uses standard Ubuntu runners and does not upload artifacts or enable build caches.

Sources: [Tauri prerequisites](https://tauri.app/start/prerequisites/), [autostart](https://tauri.app/plugin/autostart/), [Linux distribution](https://tauri.app/distribute/), [Open-Meteo API](https://open-meteo.com/en/docs), [Omarchy idle behavior](https://omarchy.org/manual/toggles-idle-screensaver/).
