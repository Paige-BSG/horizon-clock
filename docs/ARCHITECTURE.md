# Architecture

## Frontend

Vanilla HTML, CSS and ECMAScript modules preserve the accepted visual design without introducing a UI framework. `app.js` owns clock rendering and interaction. `lib/backgrounds.js` owns profile previews, image transitions, playlists and the album interface; `lib/photos.js` owns local IndexedDB storage and image normalization. `lib/settings.js` validates and migrates preferences; `lib/night.js` owns local-time night scheduling; `lib/location.js` obtains and rounds system coordinates; `lib/weather.js` parses provider data and validates cache. `lib/product.js` connects weather, settings backup and release metadata checking to the interface.

`scripts/build.mjs` copies a fixed frontend file set into `dist/`. No source server, package manager or Node runtime is required by the installed app. Assets are local and embedded in the desktop distribution. `scripts/serve.mjs` is a loopback-only development server with an explicit file allowlist.

Background transitions retain an opaque outgoing image under a decoded incoming image, with the contrast mask above both. Only the incoming image fades; simultaneous fade-out/fade-in would expose the dark backdrop. Reuse of the two image layers waits for transition completion (with a bounded fallback), and superseded requests are discarded before committing. Reduced-motion settings skip the fade.

## Desktop

Tauri 2 embeds the frontend in the platform webview. Five narrow commands expose fullscreen state/control, autostart state/control and awake control. Autostart uses the maintained Tauri plugin and changes only after user interaction. Native awake requests run off the interface thread.

Native Wayland sessions use `zwp_idle_inhibit_manager_v1` on the clock window’s existing surface, plus a systemd-logind `idle` inhibitor. A separate event queue borrows GTK’s connection without owning its display or surface. Acquisition and window-close cleanup run on the GTK thread so borrowed handles cannot race window destruction. Non-Wayland Linux sessions retain the ScreenSaver D-Bus backend. Both display and logind requests must succeed; partial failure releases the first inhibitor. Disabling or closing the window releases both. Other development platforms use `keepawake`. The application does not change global power policies or block explicit manual suspend. A hidden/unmapped Wayland surface follows compositor visibility rules.

The frontend has no shell or arbitrary filesystem API. A restricted content policy allows local assets, native IPC and the two optional network hosts. Browser previews use the Screen Wake Lock API instead of native controls.

## State and networking

- `horizon-display-v1`: validated preferences, keeping compatibility with the design prototype. v0.2 adds independent day/night background, dimming and information-brightness fields. JSON backups use schema version 2 and accept older version-1 files.
- `horizon-photos-v1`: device-local IndexedDB library holding normalized JPEG copies, small thumbnails, enabled state and framing coordinates. File imports are sequential, deduplicated by SHA-256 of the source and capped at 24 photos / 64 MiB total; each input is limited to 20 MiB and 40 megapixels. Full copies are reduced to a maximum 2560-pixel edge. Canvas re-encoding strips the original metadata. No original path or raw file is retained. Settings backups contain references, not photo files. Library transactions enforce capacity across windows.
- `horizon-weather-v1:<place>`: per-city or rounded-coordinate weather snapshots, rejected after 24 hours or if malformed. Fetching occurs every 15 minutes while visible, with a 10-second timeout. Hidden pages stop periodic weather and scene work; resume checks the cache age.
- Weather defaults on, using system geolocation with high accuracy disabled. Coordinates are rounded to two decimal places before persistence or requests. Location lookup has an independent 10-second deadline and is canceled when disabled, replaced or hidden. Last-position cache is labeled when current location is unavailable; no IP-location or unrelated-city fallback is used. Manual city-center selection remains available. Native geolocation permission is scoped to the local main webview. There are no accounts or telemetry.
- Imports preserve the receiving device's network consent and awake state; native autostart is managed independently. Exports are JSON with an app identifier and schema version.
- Update checking is user-triggered HTTPS metadata retrieval from the fixed GitHub repository. No downloaded code is executed. Update installation/signing remains a release milestone.

## Build and maintenance choices

Production dependencies are confined to desktop integration: Tauri, its autostart plugin, zbus and Wayland protocol bindings on Linux, and keepawake on other platforms. Wayland bindings are necessary because Omarchy 4.5 has no ScreenSaver D-Bus service. The optional `native-qa` feature adds an embedded loopback-only WebDriver server for testing; it is absent from normal builds. Their cost is the native Rust/GTK/webview build toolchain and OS-specific testing. Development uses Node built-ins, Playwright and Prettier. Lockfiles pin dependencies. Public CI uses standard Ubuntu runners and does not upload artifacts or enable build caches.

Sources: [Tauri prerequisites](https://tauri.app/start/prerequisites/), [autostart](https://tauri.app/plugin/autostart/), [Linux distribution](https://tauri.app/distribute/), [Open-Meteo API](https://open-meteo.com/en/docs), [Omarchy idle behavior](https://omarchy.org/manual/toggles-idle-screensaver/).

## Online scenery

`lib/scenes.js` supplies the 21 bundled backgrounds and their individual credits. `gallery-model.js` validates Commons category/image metadata, URLs, licenses and bounded response bodies. `online-gallery.js` performs consent-gated daily checks, downloads and normalizes up to 24 JPEGs, and atomically replaces the separate `horizon-online-v1` IndexedDB snapshot. Up to two day/night-selected older scenes remain available. Personal-photo storage is separate and unchanged. Newest-first category IDs are retained independently of imageinfo page-ID ordering. Cache identity includes the Commons image revision SHA1; object URLs are reclaimed after crossfades.

The desktop adds the official `tauri-plugin-opener` only for user-clicked source/license pages. Frontend links invoke an HTTPS/host/path validated Rust command; arbitrary shell/filesystem opening is not exposed. CSP connect-src permits Commons metadata and thumbnail CDNs. Photos are displayed from bundled files or cached blob URLs. No image-provider key, remote configuration server or new backend is required.

## Network radio

`lib/music.js` switches the existing screen to a4:6player/information grid without duplicating or hiding time, date or weather. `lib/radio-scene.js` draws a64pointmeasured waveform, with a straight baseline when idle, stopped or muted. Silent/idle views do not continuously render. Playback frames are capped around30fps; the visual-motion preference is independent of playback. Missing canvas support leaves clock and controls usable. Logical viewport variables preserve sizing under native font scaling.

`lib/radio-meter.js` uses Web Audio for browser previews and the fixed native `set_radio_meter`/`radio_audio_levels` commands on Omarchy. `radio_meter.rs` selects exactly one playback stream belonging to the application PID or a verified descendant, resolves its sink's monitor source and starts `parec` with both that source and the specific sink-input index. No frontend process/device argument, microphone or default-monitor fallback exists. Bounded `pactl` discovery fails closed. Samples are processed in memory into RMS, an adaptive envelope,24frequency bands and64signed/downsampled waveform points, then discarded. The93numberpacketexpires after500ms. Capture workers and child processes stop on mute, view/motion changes and window close. Linux makes the existing transitive `serde_json` dependency explicit for safe parsing; other native platforms return unavailable. See MUSIC.md for platform limits.

`lib/radio.js` owns three bundled Radio Paradise stream addresses, validated channel/volume preferences and one audio attempt at a time. Only an explicit Play action starts networking. HTML media events drive connecting/playing/buffering states; a resolved `play()` promise alone does not report success. Stop and channel changes release the old source and event handlers. Late events and promise rejections from old attempts cannot affect the current stream. Start/buffer deadlines are fifteen seconds; retries use two/five/ten-second delays and stop after three attempts. Thirty seconds of sustained playback restores the retry budget.

`lib/music.js` renders the inline bar and persists channel ID/volume under `horizon-radio-v1`, independently of display settings and backups. Playback intent is never restored. Collapsing the bar preserves playback; unloading stops it. Audio uses normal media loading and the document's no-referrer policy. The provider's redirect chain is not CORS-compatible in WebKit, and no cross-origin script access to audio is needed. The native CSP permits only HTTPS Radio Paradise media hosts. There is no music account, file library, media proxy, backend music API, native player dependency or added application-library dependency.

The desktop bar gates playback on a bounded, off-thread `gst-inspect-1.0 autoaudiosink` check, preventing WebKit from attempting playback with no audio-output plugin. No user arguments enter that process.

The fixed `open_radio_source` native command reuses the existing opener plugin to show the provider's official stream-links page. It accepts no URL. The Linux `zbus` dependency is used for awake behavior. [Usage and provider boundaries](MUSIC.md).
