# Selkies Desk

Selkies 多服务器桌面客户端（macOS / Windows / Ubuntu），使用 Electron + TypeScript，提供独立会话、受控认证及证书管理。

0.5.0 增加应用内更新：自动发现、后台下载并校验、提示重启，也可手动检查和安装。0.4.1 增加统一的视频设置、可设置的连接超时与重连次数、侧栏分组折叠。0.4.0 修复远程桌面聚焦时快捷键失效的问题，增加中英文界面、亮色/暗色/跟随系统外观、设置页、快速切换、断线自动重连、连接后自动专注和可自定义快捷键，并重新整理了界面。0.3.0 增加 Intel Mac、Windows x64 和 Ubuntu amd64 安装包，快捷键、菜单和密码存储按系统适配。0.2.2 起主工具栏使用图标及悬停提示，专注模式的文字操作条通过“常规模式”恢复布局。剪贴板继续默认允许活动连接精确来源读写。保留桌面优先布局：设备卡片、可独立隐藏的侧栏与工具栏、专注模式和悬浮会话操作条。

详细安装、操作、安全边界及构建方法见 [中文使用说明](README.zh-CN.md)，实际测试范围见 [测试结果](TEST-RESULTS.zh-CN.md)。

```sh
npm ci
npm test
npm start
npm run package       # macOS arm64
npm run package:all   # macOS arm64/x64、Windows x64、Ubuntu amd64
```

只有 Apple Silicon / arm64 的 macOS 包在本机测试过；Intel Mac、Windows 和 Ubuntu 包已构建但未在对应系统运行。macOS 包采用 ad-hoc 签名，未经 Apple Developer ID 签名或公证；Windows 包未签名。已发布的版本在 [GitHub Releases](https://github.com/zinohome/Selkies-Desk/releases)，最新发布的是 0.4.1。0.5.0 的安装包已在开发机构建，尚未发布 Release。
