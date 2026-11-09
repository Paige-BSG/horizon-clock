#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'Build this package on x86_64 Omarchy / Arch Linux.' >&2
  exit 1
fi
for tool in node npm makepkg sha256sum desktop-file-validate; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing build tool: $tool" >&2
    exit 1
  fi
done

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p -- "${1:-$project_root/release}"
output_root="$(cd -- "${1:-$project_root/release}" && pwd)"
stage="$(mktemp -d /tmp/horizon-arch.XXXXXXXX)"
trap 'rm -rf -- "$stage"' EXIT

cd -- "$project_root"
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('package.json'));
const match = /^(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(version);
if (!match) throw new Error('Unsupported Arch package version');
const expected = match[1] + (match[2] ? match[2] + match[3] : '');
const pkgbuild = readFileSync('packaging/arch/PKGBUILD', 'utf8');
if (!pkgbuild.includes(`\npkgver=${expected}\n`)) throw new Error('PKGBUILD version mismatch');
JS

# Always rebuild without native-qa; do not package an arbitrary previous executable.
npm run desktop:build -- --no-bundle --ci -- --locked
install -m755 "${CARGO_TARGET_DIR:-$project_root/src-tauri/target}/release/horizon-clock" "$stage/horizon-clock"
install -m644 packaging/arch/PKGBUILD "$stage/PKGBUILD"
install -m644 packaging/arch/horizon-clock.desktop "$stage/horizon-clock.desktop"
install -m644 src-tauri/icons/128x128@2x.png "$stage/icon.png"
install -m644 LICENSE "$stage/LICENSE"
install -m644 docs/INSTALL.md "$stage/README.md"
for name in THIRD_PARTY_NOTICES.md assets/OFL.txt assets/landscapes/CREDITS.md assets/landscapes/commons/CREDITS.md assets/landscapes/commons/CATALOG.json; do
  install -Dm644 "$name" "$stage/$name"
done
desktop-file-validate "$stage/horizon-clock.desktop"

cd -- "$stage"
# System build configuration is trusted; distribution identity contains no user details.
printf 'source /etc/makepkg.conf\nPACKAGER="HORIZON maintainers"\nPKGEXT=".pkg.tar.zst"\nPKGDEST=%q\n' "$output_root" > makepkg.conf
makepkg --config "$stage/makepkg.conf" --noconfirm
mapfile -t packages < <(makepkg --config "$stage/makepkg.conf" --packagelist)
for package in "${packages[@]}"; do
  (cd -- "$output_root" && sha256sum -- "$(basename -- "$package")" > "$(basename -- "$package").sha256")
  echo "Package: $package"
done
