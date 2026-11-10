# Omarchy 安装 / Installation

## 支持范围

当前安装包是 **0.2.0-alpha.4 预览版**，面向 **Omarchy 4.5、x86_64、Wayland / Hyprland**。其他 Arch Linux 版本可能可用，但没有实机验证。ARM 平板、Windows 和 macOS 不在本安装包的支持范围内。

安装包包含应用、离线字体、21 张风景、桌面启动图标和第三方声明。不需要安装 Node.js、Rust 或克隆源码。系统组件由 pacman 检查；安装时可能需要联网取得缺少的依赖。

## 网易云音乐

本安装包包含网易云音乐原生播放，使用本机 mpv 和系统钥匙串。底部选歌菜单提供「我的歌单」和「随心听」，随机与循环分别控制。使用方法和范围见 [MUSIC.md](MUSIC.md)。

Linux 音乐功能需要可用的 `mpv`、PulseAudio 兼容输出和已解锁的 Secret Service（例如 GNOME Keyring）；这些可选组件由用户通过系统包管理器准备。缺失时应用提示安装或解锁，不自动修改系统。时钟与背景不依赖网易云登录。当前使用普通128kbps音源，按账号权限播放；不支持下载，不绕过会员、版权或试听限制，不保证全曲库、高音质或接口长期可用。

## 下载与安装

1. 打开 [GitHub Releases](https://github.com/Paige-BSG/horizon-clock/releases/tag/v0.2.0-alpha.4)。
2. 下载 `horizon-clock-0.2.0alpha4-1-x86_64.pkg.tar.zst` 和同名的 `.sha256` 文件，放在同一个文件夹。
3. 在该文件夹打开终端，执行：

```sh
sha256sum -c horizon-clock-0.2.0alpha4-1-x86_64.pkg.tar.zst.sha256
sudo pacman -U ./horizon-clock-0.2.0alpha4-1-x86_64.pkg.tar.zst
```

校验结果必须是 `OK`，再继续安装。校验用于发现文件损坏；本预览包没有独立的发布签名。不要为安装而关闭系统签名检查。若本机策略拒绝未签名的本地安装包，请停止安装并反馈。

从应用列表打开 **HORIZON**，也可以在终端执行 `horizon-clock`。首次启动直接显示时钟，默认启用系统定位天气和 22:00–07:00 自动调暗；系统可能要求定位授权。可在设置里关闭天气或手动选择城市。登录自启动、全屏和常亮由用户在应用内选择；安装本身不修改电源设置。网易云在打开音乐或账号设置后恢复登录并获取歌单，不会自动播放。

系统定位依赖 WebKitGTK 的可选组件 `geoclue` 和系统允许的位置服务。未安装、权限被拒绝或服务不可用时，应用会显示定位状态，可在「设置 → 天气」手动选择城市；不会自动猜测城市。时钟和背景不受影响。

若 `pacman` 报依赖不存在、版本冲突或下载失败，请先停止安装，按 Omarchy 官方维护方式处理系统状态后重试。不要为了这个应用单独升级系统底层库。

## 已有源码安装的用户

如果之前运行过 `scripts/install-linux.sh`，请先退出 HORIZON，导出设置备份，再在原源码目录执行 `bash scripts/uninstall-linux.sh`，然后安装本安装包。旧的用户目录启动图标会覆盖系统图标；卸载旧入口可避免继续打开旧程序。

旧卸载脚本保留个人设置和照片。安装后检查设置，并重新选择一次登录自启动，让入口指向 `/usr/bin/horizon-clock`。若曾自行建立常驻服务，请先按自己的服务配置停用旧入口。

## 更新与卸载

更新前退出应用并导出设置备份。下载新版本，校验后使用 `sudo pacman -U ./新版本文件.pkg.tar.zst`。当前仅支持手动更新，应用内的版本检查只查询正式发行版，不显示本 Alpha 预览版，也不自动安装更新。

卸载前退出应用，并在设置中关闭登录自启动，然后执行：

```sh
sudo pacman -R horizon-clock
```

卸载保留当前用户的个人设置、相册和缓存。升级、回退和重新安装前均建议导出设置；跨版本兼容性以对应版本说明为准。

## 验证边界

项目已有 Omarchy 4.5 上的原生时钟、照片、设置、常亮协议和原生网易云播放验证。触屏、完整退出登录再登录的自启动、72 小时持续运行和实际远距离可读性仍待验收。此前的 72 小时观察已取消，不表示通过，也不会因本次发布重新启动。

## English

This unsigned alpha package targets Omarchy 4.5 on x86_64 with Wayland / Hyprland. Download the `.pkg.tar.zst` and matching `.sha256` from the linked release, verify with `sha256sum -c`, then install with `sudo pacman -U ./horizon-clock-0.2.0alpha4-1-x86_64.pkg.tar.zst`. Launch HORIZON from the application menu. Node.js and Rust are not required. Optional NetEase playback requires external mpv, a PulseAudio-compatible output and an unlocked Secret Service; see MUSIC.md. Pacman checks system dependencies; do not disable signature policy or partially upgrade system libraries to install this preview.

For an existing source installation, quit, export settings and run the source uninstaller first; personal data is retained. Re-enable autostart after migration. Before removal, disable autostart and quit, then run `sudo pacman -R horizon-clock`. Settings and photos are retained. Updates are manual. Touch, a full login-cycle autostart test, physical readability and a 72-hour soak remain unqualified. Original code is MIT; bundled assets and online providers have their own terms; see `THIRD_PARTY_NOTICES.md`.
