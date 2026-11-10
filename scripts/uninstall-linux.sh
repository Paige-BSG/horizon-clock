#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != Linux ]]; then echo 'This uninstaller is for Linux.' >&2; exit 1; fi
data_root="${XDG_DATA_HOME:-$HOME/.local/share}"
config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
install_root="$data_root/horizon-clock"
autostart_entry="$config_root/autostart/HORIZON.desktop"
if [[ -f "$autostart_entry" ]] && grep -Fq -- "$install_root/horizon-clock" "$autostart_entry"; then rm -- "$autostart_entry"; fi
rm -f -- "$data_root/applications/horizon-clock.desktop" "$data_root/icons/hicolor/256x256/apps/horizon-clock.png"
for name in horizon-clock LICENSE THIRD_PARTY_NOTICES.md NETEASE_NATIVE_LICENSES.txt OFL.txt PHOTO_CREDITS.md; do rm -f -- "$install_root/$name"; done
if [[ -d "$install_root" ]]; then rmdir -- "$install_root" 2>/dev/null || true; fi
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$data_root/applications" || true; fi
echo 'Removed HORIZON application files. Personal settings and weather cache were retained.'
