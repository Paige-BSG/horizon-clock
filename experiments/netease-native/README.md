# 网易云音乐原生接入验证

独立的 Rust 验证程序，用于验证「手机扫码 → 读取自己的歌单 → 原生完整播放 → 新进程恢复会话」。它不启动 HTTP 服务，不打开网易云网页播放器，不接入已发布的时钟应用。

## 依赖与运行

需要 Rust。Linux 使用已安装的 mpv 播放音频，并通过系统 Secret Service 保存登录会话；macOS 使用系统钥匙串保存会话，但播放检查仍需要 mpv。系统凭据存储不可用时停止，不回退到明文文件。

所有依赖只属于此实验的 Cargo manifest，主应用的依赖和构建不变。SDK 固定到 [SPlayer-Dev/ncm-api-rs](https://github.com/SPlayer-Dev/ncm-api-rs) 提交 `133b65bfe482e41ebccf018870d3fce07bf58eb3`，使用其 Rust 库模式，未启用服务器功能。该 SDK 声明 WTFPL，协议实现源自采用 MIT 许可的 [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)。正式集成和分发前仍需整理完整的依赖声明。此实验使用标准 128 kbps 播放地址接口，不请求超出账号权限的音源；会员和高音质能力须另外验证。

从项目根目录运行：

```sh
node scripts/cargo.mjs test --locked --manifest-path experiments/netease-native/Cargo.toml
node scripts/cargo.mjs run --locked --manifest-path experiments/netease-native/Cargo.toml -- check
node scripts/cargo.mjs run --locked --manifest-path experiments/netease-native/Cargo.toml -- vault-check
```

准备独立的绝对路径目录后开始扫码，例如 `/tmp/horizon-ncm-login-001`：

```sh
node scripts/cargo.mjs run --locked --manifest-path experiments/netease-native/Cargo.toml -- login /tmp/horizon-ncm-login-001
```

程序输出二维码图片路径。使用手机网易云音乐 App 扫码并确认；最多等待 180 秒，每 3 秒检查一次，不自动生成新二维码。登录被限制时停止，不切换网页登录、短信或 Cookie 导入。

若手机确认恰好晚于本地等待期限，可由验证操作者将**这一次生成的二维码内容通过标准输入**传入 `finish-login`，最多补查 5 次；不打印二维码内容、不切换其他登录方式，也不重新生成登录授权。服务端判定失效时停止。

确认登录后，以新进程验证会话恢复和读取歌单：

```sh
node scripts/cargo.mjs run --locked --manifest-path experiments/netease-native/Cargo.toml -- library
```

输出歌单序号。以下示例使用第 0 个歌单中的第 0 首歌曲；只读取该歌单前 20 首：

```sh
node scripts/cargo.mjs run --locked --manifest-path experiments/netease-native/Cargo.toml -- play /tmp/horizon-ncm-play-001 0 0
```

播放使用独立的 mpv 子进程，初始音量 50%，不改变系统总音量。Linux 明确使用 PulseAudio 兼容输出，以复用时钟已验证的音频路径。按 Ctrl+C 停止。程序记录播放器的实际 `end-file/eof` 事件，核对播放时间、音源时长及歌单元数据时长；试听音源不算完整播放，播放器异常、无进度或超时均失败。此检查证明解码/播放进度，不替代人工听音。

需要移除此验证程序的本地登录记录时，由用户主动执行 `forget-session`；该命令只删除本验证服务的系统钥匙串条目。当前验证不会自动移除已确认保存的会话。

## 会话与网络边界

- 只使用此次手机确认产生的登录会话，不读取浏览器或其他网易客户端的 Cookie。
- 凭据保存到本机系统钥匙串的独立服务 `io.github.paige-bsg.horizon-clock.netease-probe`，不进入源码、普通文件、命令行参数或日志。
- 二维码只写入独立私有目录；目录权限 0700，图片权限 0600。不要把二维码目录放进仓库或共享文件夹。
- 默认网络身份，不设置伪造 IP、不使用代理池、不自动重试受限登录。请求最多等待 12 秒。SDK 的共享 reqwest 客户端显式启用 HTTP/2；当前目标网络的 HTTP/1.1 网易请求可能超时。
- 不输出接口原始响应、Cookie 或签名播放地址；mpv 使用私有目录里的本机 IPC 接收播放地址。
- 音频只接受网易音乐域名的 HTTPS 地址；不接受任意网址。播放不把登录 Cookie 传给 mpv。
- 只读取自己的歌单，不执行收藏、签到、下载、上传或账号设置操作。

## 验证记录

通用检查与真实账号验收分开记录。单元测试使用明确的虚构会话字符串，不能作为真实扫码、会员曲目权限或完整播放成功的证据。真实验证进展见项目交接；登录、歌单、播放和重启恢复须分别有证据后才能进入正式集成。
