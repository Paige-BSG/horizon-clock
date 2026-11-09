# Validation and acceptance

Validation layers are separate. A browser test or successful executable build does not prove Omarchy sleep behavior, physical readability or product acceptance.

## Local checks — 2026-11-09

| Layer                                        | Evidence / scope                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit regressions                             | `npm test`: 14 passing checks for settings validation/migration, backup boundaries, night schedules and overrides, weather parsing/units/expiry                                               |
| Browser regressions                          | `npm run test:e2e`: 24 passing browser regressions covering first-run consent, midnight/year rollover, backgrounds, weather failures/timeouts/cache, backup, updates and eight viewport sizes |
| Real weather request                         | An actual Open-Meteo response for Shanghai was retrieved and parsed successfully; this is separate from mocked weather regressions                                                            |
| Frontend distribution                        | `npm run build` produces the fixed asset set in `dist/`                                                                                                                                       |
| Native compilation                           | Local macOS ARM64 `cargo check` and application bundle build succeeded; not Linux runtime proof                                                                                               |
| Linux compilation/install                    | Automated by the public repository's **Checks** workflow; inspect its result for the relevant commit                                                                                          |
| Visual inspection                            | Current browser-rendered screenshots are under `docs/images/`; they do not establish distant viewing or hardware brightness acceptance                                                        |
| Omarchy physical qualification               | Pending                                                                                                                                                                                       |
| 72-hour soak and update/reinstall acceptance | Pending                                                                                                                                                                                       |

The local macOS release build emitted a Rust toolchain symbol-stripping warning (`rust-objcopy` could not load `libLLVM.dylib`). The build exited successfully and produced the application bundle. This does not establish native runtime behavior. `cargo check` and `cargo clippy -- -D warnings` passed.

## v0.2 personalization scope

Browser regressions include photo import, actual Chromium-process restart recovery, deduplication, framing persistence, participation, invalid/spoofed inputs, EXIF removal, unavailable storage, capacity limits, slow-image selection races and temporary day/night previews. Personalization screenshots use only the repository’s existing licensed landscapes as sample imports; no personal photos were published. Native picker, IndexedDB durability and initial resource observations are recorded below. Long-duration behavior remains pending.

## Physical-device checklist

Record OS/version, CPU architecture, compositor/session, application version and scaling. Avoid publishing private hostnames or network addresses.

1. Install from a clean user profile; complete first-run setup; verify launch icon, touch controls and fullscreen exit.
2. Compare actual wall/sofa readability by daylight, room light and darkness. Check weather/date contrast against all bundled landscapes.
3. Enable awake mode and verify both inhibitor state and actual display behavior over idle periods. Disable it and confirm release; exit and confirm normal OS policies resume.
4. Enable autostart and log out/in; reboot and distinguish disk/login authentication from application startup. Do not weaken authentication to pass this check.
5. Verify settings backup/import, persistence and recovery in the native webview.
6. Run offline with and without weather cache; restore connectivity; test a city change while offline. No old city or expired data may appear as current weather.
7. Run for 72 real hours, including midnight and night/day transitions. Record memory/CPU, display state, failures and restart behavior. Simulated clock tests are not the soak test.
8. Upgrade from the previous published version; retain settings; verify rollback/uninstall/reinstall. Keep personal settings unless deletion is separately requested.

Only after all release gates in [ROADMAP.md](../ROADMAP.md) pass should a version be described as the supported 1.0 product.

## Omarchy native session — 2026-11-09

Tested on Omarchy 4.5.0, x86_64, Hyprland 0.56.2 with its Lua configuration, GTK 3.24.52 and WebKitGTK 2.54.1. The built-in panel reports 1920 × 1080 at scale 1. This is a laptop panel; tablet touch and other panel/scaling combinations remain unqualified.

- A clean isolated native profile passed all 17 checks in `tests/native/smoke.mjs`: actual ticking/local time, offline first-run consent, onboarding persistence, native fullscreen entry/exit, night dimming, autostart toggle/readback/restoration, photo import/decode/render/deduplication/IndexedDB, saved framing, backup consent boundaries and a real Shanghai weather response.
- A complete native-process restart retained the selected imported photo, its JPEG bytes and 30% horizontal framing, settings, weather city and fullscreen startup.
- A separate keyboard interaction with the GTK file chooser imported the repository's `mountain.jpg`. Native settings export produced a valid schema-2 JSON file on disk; importing it through the OS chooser restored an altered theme. Only licensed repository photos were used.
- The original ScreenSaver D-Bus request reproduced `ServiceUnknown`. The Wayland implementation was checked against two live Quickshell `IdleMonitor` instances with five-second timeouts. Enabling inhibition resumed only the monitor that respected inhibitors; the input-only monitor stayed idle. Explicit disable and native window close released inhibition; the respecting monitor became idle again. The HORIZON logind `idle` handle appeared while enabled and disappeared after close.
- The desktop's existing global stay-awake setting was left unchanged. Consequently these checks prove the live compositor protocol and handle release, not the user's actual lock-screen timeout or lid/manual-suspend behavior.

The real user profile additionally passed all 18 native checks at WebKit device scale 1.3636 after fixing the viewport-unit mismatch. Logical viewport and content heights were both 792 CSS pixels, with no vertical overflow. The fix preserves the system text-scaling setting and uses logical webview dimensions for desktop viewport units. Browser coverage includes resize/fullscreen dimensions.

The normal installed build, long-duration observations and login-cycle results must be recorded separately. Exported JSON and screenshots do not qualify a binary release. No 72-hour result or human acceptance is implied by the checks above.

The normal build was installed, removed and reinstalled while retaining the application data directory, then launched through its installed desktop entry. Fullscreen, Shanghai weather, automatic night scheduling and awake mode recovered from the retained profile. The native autostart checkbox created an entry pointing at the installed executable; a full logout/login cycle remains pending. The normal process had no listener on the QA port. The original Pi console was retained and the temporary Herdr/Pi pane was closed.

![Installed Omarchy clock at the user's existing fractional scale](images/omarchy-native.png)
