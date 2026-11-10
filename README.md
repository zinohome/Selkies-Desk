# Selkies Desk

Selkies 多服务器桌面客户端（macOS / Windows / Ubuntu），使用 Electron + TypeScript，提供独立会话、受控认证及证书管理。

0.3.0 增加 Intel Mac、Windows x64 和 Ubuntu amd64 安装包，快捷键、菜单和密码存储按系统适配。0.2.2 起主工具栏使用图标及悬停提示，专注模式的文字操作条通过“常规模式”恢复布局。剪贴板继续默认允许活动连接精确来源读写。保留桌面优先布局：设备卡片、可独立隐藏的侧栏与工具栏、专注模式和悬浮会话操作条。

详细安装、操作、安全边界及构建方法见 [中文使用说明](README.zh-CN.md)，实际测试范围见 [测试结果](TEST-RESULTS.zh-CN.md)。

```sh
npm ci
npm test
npm start
npm run package       # macOS arm64
npm run package:all   # macOS arm64/x64、Windows x64、Ubuntu amd64
```

只有 Apple Silicon / arm64 的 macOS 包在本机测试过；Intel Mac、Windows 和 Ubuntu 包已构建但未在对应系统运行。macOS 包采用 ad-hoc 签名，未经 Apple Developer ID 签名或公证；Windows 包未签名。本次安装包仅保留在 Mac 开发环境，等待用户另行要求，不上传 Multica 或发布 Release。
