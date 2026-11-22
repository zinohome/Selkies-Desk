# Selkies Desk

Selkies 多服务器桌面客户端（macOS / Windows / Ubuntu），使用 Electron + TypeScript，提供独立会话、受控认证及证书管理。

0.6.1 修复 0.6.0 新增连接类型标签引用错误导致设置页文案为空的问题。源码与 macOS arm64 / x64 安装包发布在 [v0.6.1 Release](https://github.com/zinohome/Selkies-Desk/releases/tag/v0.6.1)。

0.6.0 新增 Magpie Web 连接类型：地址仅允许一个 `k` 查询参数；每个节点使用独立会话分区，主窗口中最多 12 个标签同时打开，关闭应用后下次启动可一键恢复上次标签。`k` 作为本机凭据处理，界面不显示完整值，配置导出不包含 Magpie 连接。Selkies 连接继续只保留一个活跃桌面。源码与 macOS arm64 / x64 安装包发布在 [v0.6.0 Release](https://github.com/zinohome/Selkies-Desk/releases/tag/v0.6.0)。

0.5.4 将 macOS 菜单栏图标更换为与应用 Dock 图标相同的彩色双波浪图标；左键打开主窗口，右键提供打开、重连、断开、设置和退出。源码与 macOS arm64 / x64 安装包发布在 [v0.5.4 Release](https://github.com/zinohome/Selkies-Desk/releases/tag/v0.5.4)。

0.5.3 在 macOS“设置 → 通用”增加“隐藏 Dock 图标”：默认关闭，开启后立即隐藏并记住设置，重启后沿用；通过菜单栏图标打开窗口或退出。隐藏时也不出现在 `⌘Tab` 中，关闭选项恢复 Dock 图标。源码与 macOS arm64 安装包发布在 [v0.5.3 Release](https://github.com/zinohome/Selkies-Desk/releases/tag/v0.5.3)。

0.5.2 增加 macOS 菜单栏图标：关闭窗口后继续驻留并保留会话；左键打开主窗口，右键提供打开、重连、断开、设置和退出。默认保留 Dock 图标，退出应用会关闭活动连接。

0.5.1 修复 macOS 顶栏显示和隐藏时右侧按钮跳位：两种状态共用同一组按钮及固定横向位置，只缩小标题条高度和图标。

0.5.0 增加应用内更新：自动发现、后台下载并校验、提示重启，也可手动检查和安装。0.4.1 增加统一的视频设置、可设置的连接超时与重连次数、侧栏分组折叠。0.4.0 修复远程桌面聚焦时快捷键失效的问题，增加中英文界面、亮色/暗色/跟随系统外观、设置页、快速切换、断线自动重连、连接后自动专注和可自定义快捷键，并重新整理了界面。0.3.0 增加 Intel Mac、Windows x64 和 Ubuntu amd64 安装包，快捷键、菜单和密码存储按系统适配。0.2.2 起主工具栏使用图标及悬停提示，专注模式的文字操作条通过“常规模式”恢复布局。剪贴板继续默认允许活动连接精确来源读写。保留桌面优先布局：设备卡片、可独立隐藏的侧栏与工具栏、专注模式和悬浮会话操作条。

详细安装、操作、安全边界及构建方法见 [中文使用说明](README.zh-CN.md)，实际测试范围见 [测试结果](TEST-RESULTS.zh-CN.md)。

GNOME Wayland 远端若双向剪贴板均无效，且服务日志包含缺少 `ext_data_control_manager_v1` / `zwlr_data_control_manager_v1` 的错误，请参阅 [Linux 服务端剪贴板兼容补丁](compat/gnome-clipboard/README.zh-CN.md)。该补丁单独发布，不改变客户端版本。

```sh
npm ci
npm test
npm start
npm run package       # macOS arm64
npm run package:all   # macOS arm64/x64、Windows x64、Ubuntu amd64
```

只有 Apple Silicon / arm64 的 macOS 包在本机完整运行测试过；本次 macOS x64 包已构建并完成架构、签名与 DMG 校验，但未在 Intel Mac 或本机 Rosetta 环境启动。Windows 和 Ubuntu 的历史版本包已构建但未在对应系统运行。macOS 包采用 ad-hoc 签名，未经 Apple Developer ID 签名或公证；Windows 包未签名。本次 macOS arm64 / x64 安装包发布在 [GitHub Releases](https://github.com/zinohome/Selkies-Desk/releases/tag/v0.5.4)，附 `SHA256SUMS-0.5.4.txt` 供核对。
