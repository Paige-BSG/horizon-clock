# Development and installation

## Browser development

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The clock opens directly; weather uses system location by default and can be disabled. The browser version cannot configure desktop autostart. Browser wake lock does not prove system sleep prevention.

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run format:check
```

When testing against an existing Chrome installation, set `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`. Tests mock weather deliberately and keep fixtures under `tests/`; production screens never substitute those fixtures. An actual Open-Meteo request is recorded separately from mocked regressions.

## Omarchy / Linux source build

For the prebuilt x86_64 Omarchy preview package, see [installation](INSTALL.md). It does not require a developer toolchain. This alpha is not a fully qualified appliance release.

Developer source builds require Rust and the [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/#linux). On Arch-derived systems, prepare the documented WebKitGTK 4.1, GTK development tools, OpenSSL, librsvg, appindicator and build tools through the OS package manager. Check the actual device configuration first; this repository does not run a remote bootstrap script or upgrade the operating system.

```sh
git clone https://github.com/Paige-BSG/horizon-clock.git
cd horizon-clock
npm ci
npm run desktop:build -- --no-bundle
bash scripts/install-linux.sh
```

The source installer creates a user-local executable, icon and application launcher. Open HORIZON from the app launcher; choose login autostart and awake behavior inside the app. No root permission or global power configuration change is required by this installer. The full frontend is embedded in the executable.

To remove the installed application while retaining user settings:

```sh
bash scripts/uninstall-linux.sh
```

Only an autostart entry pointing at this exact installation is removed. Settings are intentionally retained. Do not manually delete webview data without backing up settings first.

For a Linux AppImage build, use `npm run desktop:build` on Linux after installing the distribution prerequisites. The appimage target is configured, but a successful build is not the Omarchy runtime qualification or release acceptance.

## Omarchy package build

On x86_64 Omarchy / Arch Linux with the source-build prerequisites, `base-devel`, `desktop-file-utils` and the runtime dependencies listed in `packaging/arch/PKGBUILD` already installed:

```sh
npm ci
npm run package:arch
```

This rebuilds the normal executable with locked Rust dependencies, without the `native-qa` feature, then runs `makepkg` in a temporary directory. It produces `release/horizon-clock-0.2.0alpha3-1-x86_64.pkg.tar.zst` and its SHA256 file. It does not install packages, use sudo, modify the running application or publish anything. The package includes the desktop entry, icon and asset notices, and preserves the verified executable without extra stripping. Keep its version aligned with `package.json`, Cargo and Tauri configuration. A published release must identify its source commit and record package installation/runtime verification separately from prior source-build checks.

## Linux music runtime

Native NetEase playback requires external `mpv`, PulseAudio-compatible output and an unlocked Secret Service, such as GNOME Keyring. Music is optional; the clock, backgrounds and weather remain usable without those music components. The app reports missing playback or credential-storage prerequisites and does not install packages. GStreamer radio playback is not part of the application. See [music](MUSIC.md) for account setup, playback scope and the native adapter checks below.

## Other development systems

```sh
npm run desktop:dev
npm run desktop:check
```

On macOS, `npm run desktop:build -- --bundles app` builds an application bundle for local development. It does not establish Linux support, Apple signing/notarization, or a supported macOS product release. The helper scripts discover an existing Rust toolchain through `rustup` when `cargo` is not already on PATH.

## Updates

The app currently checks GitHub release metadata when requested. To update a source installation, export settings, inspect the new release/commit, rebuild using the locked dependencies and run the installer again. There is no automatic code download or execution. Qualified binary updates, signing and rollback are tracked in [ROADMAP.md](../ROADMAP.md).

## Native WebKitGTK checks

The optional `native-qa` Cargo feature adds an embedded WebDriver server on **127.0.0.1:4445**. It is needed on distributions whose WebKitGTK package omits WebKitWebDriver. It is not enabled by default and must never be used for distributed binaries. Stop the QA application after testing, rebuild without this feature, and confirm the port is closed.

```sh
npm run desktop:build -- --no-bundle --features native-qa
```

Launch that executable in the actual graphical session, with a **new, isolated** `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`. Preserve the existing Wayland and session-bus environment. Do not reuse or clear a user's profile: the smoke check verifies direct startup/default settings, imports a licensed test photo, selects Shanghai weather and toggles integration settings.

```sh
node scripts/native-qa.mjs test tests/native/smoke.mjs result.json
node scripts/native-qa.mjs screenshot native-window.png
```

The check uses the real webview, local storage, IndexedDB, image codec and native commands. It sends DOM events for controls and injects a fixture into the file input; it does not establish hardware touch or OS-picker behavior. Test the native picker separately with an actual keyboard/pointer and a repository landscape. Restart the whole process and verify the saved photo, framing and settings.

To verify awake behavior without changing a desktop's global stay-awake setting, run `quickshell -p tests/native/idle-monitor.qml` in the graphical session. After five idle seconds both monitors should report idle. Enabling HORIZON's awake mode must resume the monitor that respects inhibitors while the input-only monitor stays idle. Disable and close separately; the respecting monitor must return to idle. Inspect logind handles separately. A compositor window flag alone is insufficient.

For a real-duration observation of an installed, normal build:

```sh
python3 scripts/soak-linux.py \
  --binary "$HOME/.local/share/horizon-clock/horizon-clock" \
  --output "$HOME/.local/state/horizon-clock/soak.jsonl" --hours 72
```

Run the observer under the user's service manager to retain it after SSH disconnects. Each sample records process-tree RSS, interval CPU, clock-window inhibition, fullscreen and display power. RSS sums can include shared pages. The script exclusively creates its evidence file and does not change power settings or restart the app. A completed record proves observation duration; it does not prove visual clock updates, weather correctness, physical readability, or login startup. Keep those checks separate.

## Native NetEase adapter

The desktop command `netease` accepts only the tagged actions in `src-tauri/src/netease.rs`. The backend validates playlist/track IDs against the restored account library and never returns cookies, device identifiers or signed stream URLs. Linux playback requires external mpv and an unlocked Secret Service; macOS uses its keychain. No local HTTP server or provider web player is started. See [MUSIC.md](MUSIC.md) for scope and credential namespace.

Run `node scripts/cargo.mjs test --locked --manifest-path src-tauri/Cargo.toml` and the browser suite. Browser NetEase tests deliberately mock the native command with fictitious account data; they prove UI behavior, not account permissions or audible playback. Real-account native tests must run in an isolated app instance and must not print API view models, QR data, playlist names or signed URLs. Never run logout during acceptance against the user's retained session unless explicitly requested.
