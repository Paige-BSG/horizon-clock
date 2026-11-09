# HORIZON roadmap

## 0.1 — open-source development preview

- [x] Preserve the accepted landscape clock design, with adaptive layouts.
- [x] Offline local landscapes, rotation, manual selection and contrast control.
- [x] Real device-local date/time and rollover handling.
- [x] Optional city weather, bounded requests, per-city cache and explicit unavailable/stale states.
- [x] First-run setup; scheduled night dimming and manual override until the next boundary.
- [x] Validated settings, prototype migration, settings backup/import.
- [x] Tauri desktop application, native fullscreen, user-controlled autostart and lifetime-scoped awake requests.
- [x] Source install/uninstall scripts, reproducible frontend build, committed lockfiles, tests and open-source notices.
- [x] User-triggered GitHub release metadata check, with offline/no-release states.

These checkboxes describe implementation, not Omarchy physical-device qualification. See [validation](docs/VALIDATION.md).

## 0.2 — Personalization and Omarchy device qualification

- [x] Local photo import with per-photo framing, deduplication, persistence and participation controls.
- [x] Independent day/night background sources, contrast and information brightness, with temporary in-settings previews.
- [x] Versioned settings backups that accept v1 and v2; photos remain in the device library.
- [x] 21 bundled landscapes, opt-in daily Commons scenery checks/cache and per-photo source/license details; browser verified, new Linux native behavior pending.
- [x] Direct background picker, import-to-display, quick brightness/pinning and automatic return to the clock; full controls remain available. Browser validation is recorded separately from the running device build.

Implementation has browser coverage and native Omarchy picker/storage checks. Device observations and remaining acceptance gates are recorded in docs/VALIDATION.md.

- [x] Build and run the installed application on Omarchy 4.5 / Wayland, initially x86_64.
- [ ] Verify touch targets, fullscreen entry/exit, app focus and landscape/portrait rendering at the panel's actual scaling.
- [x] Verify native settings export/import and storage persistence in Linux WebKitGTK.
- [x] Verify idle/display inhibition and release with live Omarchy/Quickshell idle monitors. Actual lock timeout, lid and manual-suspend policies remain separate device checks.
- [ ] Measure CPU/memory and display behavior while rotating images and while offline.
- [ ] Readability review from the sofa by day, room light and darkness. Adjust hardware backlight if needed; interface dimming alone is not backlight control.

## 1.0 — installable product release

- [ ] Complete a documented 72-hour physical-device soak test covering sleep prevention, midnight, night transitions, network loss/recovery and process restart.
- [ ] Verify login autostart, clean exit, uninstall, data retention and reinstall on the target OS.
- [x] Produce a versioned x86_64 Omarchy / Arch Linux preview package with checksums, asset notices and user installation instructions. Full product qualification remains separate.
- [ ] Define update signing, key custody, distribution channel, data migration and rollback. Do not generate or store signing secrets as part of ordinary builds.
- [ ] Implement and verify authenticated update installation; current metadata checking is not a self-updater.
- [ ] Test update from the previous published version without losing settings.
- [ ] Publish release notes and the exact tested OS/device support matrix.

## Later candidates

- [x] Optional account-free network radio, three official Radio Paradise streams, play/stop, channel selection, local volume preferences and bounded reconnection.
- [x] Verify live radio decoding, direct channel switching and stop in the installed Omarchy build.

More cities/search, localization and additional operating systems. These are candidates, not committed features or support promises. No account, subscription or cloud control plane is required for the initial product.
