# Validation and acceptance

Validation layers are separate. A browser test or successful executable build does not prove Omarchy sleep behavior, physical readability or product acceptance.

## Local checks — 2026-11-09

| Layer                                        | Evidence / scope                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit regressions                             | `npm test`: 20 passing checks for settings validation/migration, backup boundaries, night schedules and overrides, weather parsing/units/expiry                                               |
| Browser regressions                          | `npm run test:e2e`: 42 passing browser regressions covering first-run consent, midnight/year rollover, backgrounds, weather failures/timeouts/cache, backup, updates and eight viewport sizes |
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

## Quick daily controls — browser revision

The direct background picker retains all detailed settings and adds immediate scene selection, import-to-display, brightness and pinning. Local verification passed 14 Node checks and 33 browser regressions. The nine new regressions cover the two-click selection path, current day/night group, chooser-triggered import from solid color, cancellation/failure, quick controls and detailed settings, slow-import races, logical viewport containment and pointer/keyboard focus behavior. Desktop and narrow-screen screenshots were inspected; see [interaction paths](INTERACTION.md).

The native Omarchy results above apply to commit `c1fb704`. The new picker has not replaced that installed build or its ongoing 72-hour observation. Its native chooser/touch behavior remains to be checked after this observation.

## Free scenery and online gallery — 2026-11-09

The source revision adds 18 Commons backgrounds (21 bundled total), optional daily online checks, a separate bounded cache and photo-source attribution. All 18 downloaded JPEGs were decoded and inspected in a contact sheet. Desktop/mobile gallery screenshots and a Yangshuo clock display were rendered and visually reviewed. Small-screen attribution uses its own footer row to preserve the existing status/night labels.

- 20 Node checks and 42 browser regressions passed. The nine new browser checks cover no requests before consent, bundled scene/source selection, six-image downloads, cache persistence across reload and an actual browser-process restart with external requests blocked, daily refresh/order/selected-image retention, disabling and in-flight cancellation, failure retry, atomic cache-write failure and displayed-image attribution after failed replacement, and overlapping network-recovery notifications during a failed request. The latter race was reproduced as an unhandled fetch rejection and then fixed. The cache retry regression also covers a user-forced failure while the prior successful cache is less than a day old.
- A live Chromium run with the desktop CSP returned **two actual Commons API responses and six actual JPEG downloads**, with zero background requests before consent and no page errors. A downloaded cached image decoded and displayed successfully. This is separate from deterministic mocked provider tests.
- Read-only SSH requests from `aw-omarchy` returned HTTP 200 for Commons API reachability and one actual thumbnail URL. These are network reachability checks, not a new native application runtime test.
- Frontend build, formatting/whitespace, macOS locked native check/clippy and two Rust source-URL validation tests passed. Tauri opener is added for explicitly clicked photo/license links, with automatic JS link interception disabled and no broad frontend opener permission.
- Existing 72-hour observation and installed native commit `c1fb704` were left unchanged. New gallery behavior, external browser launch and online/cache requests in Linux WebKitGTK still need native verification after the observation. No qualified binary release is implied.

## Music controls — local revision, 2026-11-09

The optional inline music bar adds song/artist/status, play/pause, previous/next and explicit selection among multiple running MPRIS players. Login and content playback remain in the user's official player. No music credentials, audio URLs, artwork requests or settings-schema changes were introduced.

- 20 Node checks and 52 browser regressions passed with the installed Chrome channel. The ten new music checks use explicit test fixtures and cover target selection, capability limits, command failure, duplicate input, stale in-flight reads, process-owner changes, disconnect/recovery, hidden/closed polling, platform limitations, safe text rendering and viewport containment. These fixtures do not establish official-player compatibility.
- Six Rust tests passed on macOS. Four new tests exercise the Linux MPRIS backend with real local D-Bus messages against an isolated test service: discovery/metadata, Play/Pause/Previous/Next, capability enforcement, closed/replaced owners, restricted targets/actions and method timeout. They need no session bus daemon. The two existing photo-source tests remain passing.
- Frontend build, locked macOS desktop check, all-target Rust clippy with warnings denied, formatting and whitespace checks passed. The Linux workflow now includes the Rust tests; no remote CI run or Linux build result is claimed for this revision.
- Desktop and narrow-screen music layouts were rendered and visually inspected. Local `previews/music-connected-*.png` use visibly labeled sample track/player data; they are interface previews, not a successful NetEase connection or audio test. Expanding the bar reduces the time size to retain the date/weather; closing restores it. Music controls remain available while the toolbar hides on idle.
- A read-only check on the Omarchy target found Chromium available and no currently exported MPRIS players. The normal clock and its ongoing 72-hour observer were active. No player was installed or launched, no account was accessed, and the installed clock/observer were not restarted or replaced.

Remaining: compile and run this revision on Linux; verify the intended official NetEase client or official web player, supported controls, background playback and reconnection. Deployment must record any interrupted soak observation separately. See [music setup and limitations](MUSIC.md).

## Background transition correction — 2026-11-09

Normal-motion tests reproduced a coverage dip when both background layers faded simultaneously. Rapid requests could also reuse a still-visible layer. Both new regressions failed before the correction: sampled combined image opacity fell below full coverage, exposing the dark backdrop.

The outgoing image now stays fully opaque beneath the incoming fade. A subsequent request waits for the current fade to finish, then checks that it is still the latest selection before reusing the hidden layer. The contrast mask remains above both images. The initial image is decoded and displayed without a separate image-opacity fade; the existing backdrop entrance remains. Reduced-motion settings still skip transitions.

All 54 browser regressions, 20 Node checks, frontend build and formatting/whitespace checks passed locally. The two new checks exercise normal-motion mid-fade coverage and rapid selection. These results establish browser behavior; Omarchy/WebKit verification is recorded separately after deployment. Paige canceled the running 72-hour observation; it was stopped, its records retained, and no new observation is to be started without a new request.

## Omarchy music and transition checks — 2026-11-09

Source `b38bca8` passed all six Rust tests, Linux all-target clippy with warnings denied, and normal/QA native release builds on the target. An isolated QA profile passed 13 native checks at the existing 1.3636 device scale: actual session D-Bus discovery through Tauri IPC, displayed test metadata, Play/Pause/Previous/Next, rejected non-media and stale-owner requests, clock updates and connected music layout. The test service was explicitly labeled as a fixture and played no audio. Stopping it removed it from discovery and disabled its old controls. This does not qualify the intended official NetEase player.

Both actual WebKit transition checks retained minimum combined image coverage of 1.0 across 55 samples each, with motion enabled, including rapid requests. This verifies the reported dark-gap mechanism in the native engine; physical visual acceptance remains with the user.

The normal installed build restored full screen, Shanghai weather and awake inhibition. Its compositor screenshot exposed an additional empty-player layout overflow: 803 CSS pixels of content in the 792-pixel logical viewport. A new browser regression reproduced that exact overflow. Reducing the expanded music view's time-height limit from 30% to 28% restored 792-pixel containment in live WebKit QA style validation and in the browser regression, including desktop and narrow-screen empty states. The collapsed clock retains its original size.

The empty-state follow-up passed all 55 browser regressions, 20 Node checks, frontend build, formatting and whitespace checks.

The previous observation was canceled after 43 samples and 2522.2 seconds, with its log retained; this is not a 72-hour pass. No replacement observation is authorized. Native evidence remains in the private handoff evidence directory. The official NetEase web player was opened in an independent Chromium window, with the clock returned to the foreground; no account or real music playback was tested.

## Account-free network radio — local revision, 2026-11-09

Paige chose channel-based live music without local files, accounts or single-song requests. The radio bar uses the official Radio Paradise stream-links page's Mellow Mix, Serenity and Main Mix addresses, with verified HTTPS variants. The provider's current page explicitly presents these URLs for WiFi radios and other players. SomaFM was excluded after its current terms were checked; network reachability alone is not an embedding permission.

- 28 Node checks and all 52 browser regressions passed. Eight controller checks cover explicit playback intent, validated preferences, stream release, stale events, bounded retries, denied autoplay, buffering deadlines and repeated stall events. A full-run timeout regression exposed late buffering events extending the connection deadline; the deadline now remains fixed until playback starts, and a targeted regression preserves that behavior.
- Eight browser radio checks use generated silent PCM to exercise the real browser media element: no requests before Play, selection/volume persistence without autoplay, background playback while collapsed, stop/retry cancellation, slow responses, the actual desktop CSP, fixed source opening and empty/playing layout across seven sizes. These fixtures are distinct from live station verification.
- A live Chromium run decoded the real Mellow Mix MP3 stream with anonymous CORS and volume zero, reaching readyState3 and the Playing event. All three official stream endpoints returned audio and matching CORS headers from Omarchy (Mellow/Main MP3; Serenity AAC). This is not yet an installed WebKit decode result.
- Frontend build, formatting/whitespace, locked macOS native check, two existing Rust source-link tests and all-target clippy with warnings denied passed. Desktop/narrow-screen screenshots were visually reviewed. No production dependency was added; music's native MPRIS commands and their direct serde/dev-zbus requirements were removed. Existing zbus remains for Linux awake behavior.

Live Omarchy decoding, controls and final installation are recorded separately. The canceled 72-hour observer is to remain off.

## Linux audio prerequisite guard — 2026-11-09

The first real radio playback attempt exposed a missing system prerequisite: `autoaudiosink` was absent, and WebKit's media process terminated instead of returning a normal media error. The running installed clock was unaffected. With Paige's explicit approval, `gst-plugins-good` and `gst-libav`1.28.8-1 and seven missing dependencies were installed: nine new packages,4.27MiB downloaded,13.55MiB installed. No existing system packages were upgraded. Subsequent checks found automatic output, PulseAudio output, MP3 and AAC decoder elements.

The desktop radio bar now checks the fixed local audio-output element before enabling Play. The inspection runs off the UI thread, takes no frontend arguments and is killed after three seconds if it stalls. Failure disables audio creation and shows a component message; reopening rechecks availability. This keeps a missing optional audio runtime from taking down the clock. Browser preflight tests cover failure, no media request/element and successful recheck. All53browser checks and28Node checks passed, along with frontend build, formatting and macOS all-target clippy. Linux build and real-stream results remain separate.

## WebKit radio transport compatibility — 2026-11-09

After installing the audio components, WebKit reported that a provider302redirect lacked the CORS headers required by the explicit anonymous-crossorigin attribute. The final audio response did provide CORS headers, so an endpoint probe and Chromium playback alone did not expose this redirect-chain difference. Normal HTML media loading needs no cross-origin script access and follows the provider's redirect correctly; the explicit crossorigin attribute was removed. The no-referrer policy and provider-only media CSP remain. Provider service cookies are managed by the webview, not read or imported by the application.

Live QA transport validation reached Playing with real Mellow Mix audio at readyState4. A two-pixel native layout overflow was also corrected by reducing only the expanded music information padding. The equivalent live style validation fits792CSSpxat1.3636scale. All53browser regressions,28Node checks, frontend build and formatting passed with the transport correction. Per-channel native reports and the installed normal binary are separate evidence.
