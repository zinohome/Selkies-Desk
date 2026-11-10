# 桌面优先布局修订

2026-11-10，依据 ZhangJun 本机试用反馈：减少装饰与长期占用的界面，侧栏及顶部操作栏各自可以隐藏，参考 Windows App 的连接中心、设备卡片与紧凑会话操作。

采用中性灰、系统字体、蓝色操作色。未连接时显示可直接连接和编辑的服务器卡片，去掉大型宣传插画及口号。连接后采用 232 DIP 侧栏与 52 DIP 单行工具栏，不再占用底部状态栏。

支持独立收起侧栏、独立收起工具栏、一键专注模式，以及菜单/键盘恢复。布局选择保存在本机配置，不导出到服务器配置。改变布局只调整原 WebContentsView 的 DIP 边界，不销毁或重新载入活动远端。

全部收起时，远端视图覆盖全部窗口内容区域。顶端仅保留 64×22 DIP 的悬浮手柄；点击/移入后展开可访问的操作条，提供恢复布局、显示侧栏、显示顶部栏、全屏、重连与断开。操作条是独立本地 WebContentsView，置于远端之上，不向远端注入脚本，也不开放连接编辑或文件 IPC。

认证和证书等安全确认出现时自动露出本地管理界面，但不覆盖用户已保存的布局选择；处理完成后回到原布局。使用 macOS 菜单和 ⌘⌥B / ⌘⌥T / ⌘⌥Enter 即使所有栏已隐藏也能恢复。

验收：四种布局的真实视图边界；同一 WebContents 和 WebSocket/SSE 在切换布局后保持存活；悬浮入口恢复；控制条 IPC 权限拒绝编辑连接；布局重启持久化；继续运行已有认证、证书和隔离测试。

设计参考（独立实现，不复用 Microsoft 资产）：
- https://learn.microsoft.com/en-us/windows-app/get-started-connect-devices-desktops-apps?tabs=macos
- https://learn.microsoft.com/en-us/windows-app/device-actions?tabs=macos
- https://learn.microsoft.com/en-us/windows-app/whats-new
