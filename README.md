# Selkies Desk

macOS Selkies 多服务器客户端，使用 Electron + TypeScript，提供独立会话、受控认证及证书管理。

0.2.2 主工具栏使用图标及悬停提示，专注模式的文字操作条通过“常规模式”恢复布局。剪贴板继续默认允许活动连接精确来源读写。保留桌面优先布局：设备卡片、可独立隐藏的侧栏与工具栏、专注模式和悬浮会话操作条。

详细安装、操作、安全边界及构建方法见 [中文使用说明](README.zh-CN.md)，实际测试范围见 [测试结果](TEST-RESULTS.zh-CN.md)。

```sh
npm ci
npm test
npm start
npm run package
```

当前交付为 Apple Silicon / arm64 本机测试版，采用 ad-hoc 签名，未经 Apple Developer ID 签名或公证。本次安装包仅保留在 Mac 开发环境，等待用户另行要求，不上传 Multica 或发布 Release。
