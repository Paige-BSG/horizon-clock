# Validation and acceptance

Validation layers are separate. A browser test or successful executable build does not prove Omarchy sleep behavior, physical readability or product acceptance.

## Local checks — 2026-11-09

| Layer                                        | Evidence / scope                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit regressions                             | `npm test`: 11 passing checks for settings validation/migration, backup boundaries, night schedules and overrides, weather parsing/units/expiry                                               |
| Browser regressions                          | `npm run test:e2e`: 14 passing browser regressions covering first-run consent, midnight/year rollover, backgrounds, weather failures/timeouts/cache, backup, updates and eight viewport sizes |
| Real weather request                         | An actual Open-Meteo response for Shanghai was retrieved and parsed successfully; this is separate from mocked weather regressions                                                            |
| Frontend distribution                        | `npm run build` produces the fixed asset set in `dist/`                                                                                                                                       |
| Native compilation                           | Local macOS ARM64 `cargo check` and application bundle build succeeded; not Linux runtime proof                                                                                               |
| Linux compilation/install                    | Automated by the public repository's **Checks** workflow; inspect its result for the relevant commit                                                                                          |
| Visual inspection                            | Current browser-rendered screenshots are under `docs/images/`; they do not establish distant viewing or hardware brightness acceptance                                                        |
| Omarchy physical qualification               | Pending                                                                                                                                                                                       |
| 72-hour soak and update/reinstall acceptance | Pending                                                                                                                                                                                       |

The local macOS release build emitted a Rust toolchain symbol-stripping warning (`rust-objcopy` could not load `libLLVM.dylib`). The build exited successfully and produced the application bundle. This does not establish native runtime behavior. `cargo check` and `cargo clippy -- -D warnings` passed.

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
