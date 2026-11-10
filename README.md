# Selkies Desk

macOS Selkies 多服务器客户端，使用 Electron + TypeScript，提供独立会话、受控认证及证书管理。

0.2.0 采用桌面优先布局：设备卡片、可独立隐藏的侧栏与工具栏、专注模式和悬浮会话操作条。

详细安装、操作、安全边界及构建方法见 [中文使用说明](README.zh-CN.md)，实际测试范围见 [测试结果](TEST-RESULTS.zh-CN.md)。

```sh
npm ci
npm test
npm start
npm run package
```

当前交付为 Apple Silicon / arm64 本机测试版，采用 ad-hoc 签名，未经 Apple Developer ID 签名或公证。安装包通过项目任务附件交付。
