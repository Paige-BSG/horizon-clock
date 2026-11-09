<p align="center"><img src="assets/icon.png" width="88" alt="HORIZON icon"></p>
<h1 align="center">HORIZON · 环境时钟</h1>
<p align="center">把此刻，留在你的空间。<br>An open-source ambient wall clock for Omarchy and Linux tablets.</p>
<p align="center"><a href="https://github.com/Paige-BSG/horizon-clock/actions/workflows/checks.yml"><img src="https://github.com/Paige-BSG/horizon-clock/actions/workflows/checks.yml/badge.svg" alt="Checks"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/code-MIT-7de4d3" alt="Code: MIT"></a> <img src="https://img.shields.io/badge/status-alpha-orange" alt="Alpha"></p>

![HORIZON landscape clock](docs/images/clock.png)

HORIZON 把闲置平板变成客厅里的环境时钟：远处一眼看清时间，靠近时调整风景、天气与夜间显示。

**当前是 `0.1.0-alpha.1` 开发预览版。** 界面和桌面应用已实现，首个目标平台为 Omarchy 4.5。目标平板上的运行、长期常亮和 72 小时验收仍待完成。当前版本没有正式认证的 Linux 下载包，也没有自动安装更新的能力。

## 已有功能

- **清晰的时间与日期**：超大数字、秒数开关、星期与全天进度，使用设备本地时间。
- **本地风景**：湖泊、雪山、海面，淡入淡出、手动切换、轮换间隔、背景压暗与纯色模式；无需在线图片服务。
- **可选当地天气**：五个城市，Open-Meteo 数据；首次使用明确选择是否联网，每 15 分钟刷新，失败时显示缓存或不可用状态。
- **昼夜显示**：自定义夜间时段，20 分钟渐进调暗/恢复；临时手动调整持续到下一次昼夜切换。
- **完整设置**：三种环境色、首次使用引导、设置迁移、JSON 备份和导入。
- **桌面集成**：Tauri 应用，原生全屏、用户自选登录启动、应用存续期间的系统唤醒请求；退出后释放。
- **版本检查**：用户主动检查 GitHub 正式版本信息；不下载或执行更新。

## 本地预览

需要 Node.js 22 或更新版本：

```sh
git clone https://github.com/Paige-BSG/horizon-clock.git
cd horizon-clock
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173>。字体、图标和风景均已包含。不启用天气且不检查更新时，应用无需访问外网。

快捷键：`F` 全屏、`N` 夜间、`B` 换景、`S` 设置、`Esc` 关闭设置/退出全屏。无操作 8 秒后控制按钮隐藏，触摸、鼠标或键盘操作后恢复。

## Omarchy 桌面版

当前提供开发者源码构建流程，见 **[开发与安装说明](docs/DEVELOPMENT.md)**。准备 Rust 和 Tauri Linux 系统依赖后：

```sh
npm ci
npm run desktop:build -- --no-bundle
bash scripts/install-linux.sh
```

应用安装到当前用户目录，并创建启动图标。登录自启动和常亮在应用内选择。卸载脚本保留个人设置。源代码构建和 Linux CI 通过，均不能替代 Omarchy / Wayland 的实际运行验收。

## 项目方向

第一版围绕“一块能够长期挂墙的时钟”完善安装、昼夜体验、离线恢复、维护和更新。保留已确认的视觉设计，先把 Omarchy 做好。

- [产品定义与验收标准](docs/PRODUCT.md)
- [路线图与尚未完成的发行门槛](ROADMAP.md)
- [架构与依赖选择](docs/ARCHITECTURE.md)
- [验证记录与实机检查](docs/VALIDATION.md)
- [参与贡献](CONTRIBUTING.md) · [安全与隐私](SECURITY.md)

## 开源许可与数据来源

原创代码、界面和应用图标采用 **[MIT](LICENSE)**。字体采用 SIL OFL；风景照片采用 Unsplash License，分别保留授权与来源，不能按 MIT 重新授权。详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

天气来自 [Open-Meteo](https://open-meteo.com/)，数据为模型估算，采用 CC BY 4.0。其免费托管接口限个人及非商业使用；商用采用者需自行取得合适的服务授权。开启天气只发送所选城市的市中心坐标，不获取 GPS。没有账号、统计分析或遥测。

## English

HORIZON is a local-first ambient clock for a wall-mounted tablet. It combines large readable time, bundled landscape backgrounds, optional city weather, scheduled night dimming, settings backup, and a Tauri desktop application. Omarchy 4.5 is the first qualification target.

This is an **alpha**, not a qualified appliance release. Native build success and browser regressions are recorded separately from Omarchy runtime, physical readability and the required 72-hour soak test. Start with `npm ci && npm run dev`; native build instructions and release gates are linked above. Original code is MIT; bundled fonts/photos and the optional weather service have separate licenses and terms.
