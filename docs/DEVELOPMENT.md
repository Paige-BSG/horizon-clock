# Development and installation

## Browser development

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The first-run form allows offline use. The browser version cannot configure desktop autostart. Browser wake lock does not prove system sleep prevention.

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run format:check
```

When testing against an existing Chrome installation, set `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`. Tests mock weather deliberately and keep fixtures under `tests/`; production screens never substitute those fixtures. An actual Open-Meteo request is recorded separately from mocked regressions.

## Omarchy / Linux source build

This alpha has no qualified prebuilt Linux release yet. Developer source builds require Rust and the [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/#linux). On Arch-derived systems, prepare the documented WebKitGTK 4.1, GTK development tools, OpenSSL, librsvg, appindicator and build tools through the OS package manager. Check the actual device configuration first; this repository does not run a remote bootstrap script or upgrade the operating system.

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

Launch that executable in the actual graphical session, with a **new, isolated** `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`. Preserve the existing Wayland and session-bus environment. Do not reuse or clear a user's profile: the smoke check completes onboarding, imports a licensed test photo, enables Shanghai weather and toggles integration settings.

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
