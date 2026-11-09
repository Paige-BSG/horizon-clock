#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
  echo 'This installer is for Linux. Build and install on the target Linux device.' >&2
  exit 1
fi
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
binary="$project_root/src-tauri/target/release/horizon-clock"
data_root="${XDG_DATA_HOME:-$HOME/.local/share}"
install_root="$data_root/horizon-clock"
if [[ ! -x "$binary" ]]; then
  echo 'Build first: npm ci && npm run desktop:build -- --no-bundle' >&2
  exit 1
fi
install -Dm755 "$binary" "$install_root/horizon-clock"
install -Dm644 "$project_root/src-tauri/icons/128x128@2x.png" "$data_root/icons/hicolor/256x256/apps/horizon-clock.png"
install -Dm644 "$project_root/LICENSE" "$install_root/LICENSE"
install -Dm644 "$project_root/THIRD_PARTY_NOTICES.md" "$install_root/THIRD_PARTY_NOTICES.md"
install -Dm644 "$project_root/assets/OFL.txt" "$install_root/OFL.txt"
install -Dm644 "$project_root/assets/landscapes/CREDITS.md" "$install_root/PHOTO_CREDITS.md"
mkdir -p "$data_root/applications"
desktop_exec="${install_root//\\/\\\\}/horizon-clock"
desktop_exec="${desktop_exec//\"/\\\"}"
desktop_exec="${desktop_exec//%/%%}"
printf '[Desktop Entry]\nType=Application\nName=HORIZON\nComment=Ambient wall clock\nExec="%s"\nIcon=horizon-clock\nCategories=Utility;Clock;\nTerminal=false\n' "$desktop_exec" > "$data_root/applications/horizon-clock.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$data_root/applications" || true; fi
echo 'Installed HORIZON. Open it from the application launcher.'
echo 'Login autostart and awake behavior remain under your control in the app.'
