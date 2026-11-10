# Selkies Desk 0.2.0

macOS 上的 Selkies 多服务器客户端。使用 Electron 内嵌服务器自己的网页，保留 Selkies 的视频、输入、显示设置、剪贴板和文件入口。左侧管理连接，右侧显示当前网页；同时只保留一个活动页面。

此版为 **Apple Silicon / arm64 本机测试版**，没有 Apple Developer ID 签名或公证。采用本地 ad-hoc 临时签名保证应用包内部一致性，不代表 Apple 验证了开发者身份。项目仓库由 ZhangJun 创建：[zinohome/Selkies-Desk](https://github.com/zinohome/Selkies-Desk)。安装包通过任务附件交付，未发布 GitHub Release 或商店。

## 安装与首次连接

1. 下载附件中的 DMG，使用同附的 `SHA256SUMS.txt` 核对文件。
2. 打开 DMG，将 **Selkies Desk.app** 拖到“应用程序”，弹出磁盘映像后启动。也可解压 `.app.zip` 使用。
3. 下载的未公证应用可能被 Gatekeeper 阻止。确认附件来源、校验和与风险后，可使用 macOS 系统提供的单个应用“仍要打开”流程；无需也不要全局关闭 Gatekeeper。若系统报告文件损坏，先重新下载核对校验和，或自行从源码构建。
4. 点击“新增连接”，填写名称和服务器地址，例如 `https://服务器地址:8443`。不带协议时默认 HTTPS。8443 与 8444 可以分别保存为两个条目。
5. 点击左侧条目连接。首次自签名证书会显示完整来源（含端口）、错误和 SHA-256 指纹；通过可信渠道核对后再确认。密码只在出现“服务器认证”时输入。

“页面已加载”表示网页加载完成，**不表示已经确认视频或远端键鼠正常**。视频连接、画质、分辨率、DPI 与流状态以 Selkies 自带面板为准。连接不自动重试，避免错误凭据造成认证循环。

## 日常操作

- 在名称、地址、分组和备注中搜索；点击条目切换连接。切换、断开和重连都会销毁旧 WebContents，并关闭旧会话的网络连接，不主动结束远端应用。
- 工具栏的齿轮可编辑、删除连接、清除记住的密码和撤销证书信任。删除需二次确认，并清理该连接的网页数据。清除密码也会清除 Basic 认证缓存。
- 连接中心提供设备卡片，点击卡片连接，点击 `···` 编辑。侧栏宽 232 DIP，顶部只有一行 52 DIP 工具栏，桌面下方不设状态栏。
- 顶部左侧按钮或 `⌘⌥B` 独立隐藏/显示侧栏；右侧收起按钮或 `⌘⌥T` 隐藏/显示顶部工具栏。“专注”或 `⌘⌥Enter` 同时收起两栏，让远程桌面占满窗口内容区。布局改变只调整现有视图，不重载网页或重连视频流。
- 顶部隐藏后，桌面上缘保留一个 64×22 DIP 手柄。移入或点击可展开会话操作条，恢复布局、显示侧栏/工具栏、进入/退出全屏、重连和断开；点击收起或按 Escape 收回。macOS 的“显示”菜单始终提供恢复完整布局。
- 布局偏好在重启后保留。未连接、失败或认证/证书/编辑弹窗期间会临时显露管理界面；恢复活动桌面后回到原偏好。布局偏好不包含在导出的服务器配置中。
- 全屏时工具栏或悬浮操作条提供“退出全屏”。快捷键 `⌃⌘F` 切换全屏，`⌘⌥N` 新增连接，`⌘⌥L` 搜索连接（自动显示侧栏），`⌘⌥R` 重连。
- 常规复制、粘贴、撤销等使用 macOS 菜单角色，作用于当前聚焦网页。管理快捷键使用额外的 Option 修饰键，避免抢占常规远端输入。
- 保留远端原有剪贴板、文件上传和下载入口。下载会提示选择保存位置。读取剪贴板、摄像头、麦克风等权限按连接来源询问；授权不跨来源、不跨连接，不在退出后保留。允许麦克风不会同时允许摄像头。
- 新窗口链接会先确认，再交给系统浏览器打开；不允许其替换本地管理页。跨来源的顶层跳转会被阻止，请为新来源另建连接。

## 会话、密码与证书

每个连接 ID 对应独立的持久分区。同一地址上的两个账号也需保存为两个条目，才能分别保留 Cookie、localStorage、认证缓存与 Selkies 设置。持久 Cookie 的期限由服务器决定；服务器设置的会话 Cookie 不会被客户端擅自延长。

密码只在主进程处理。勾选“加密记住密码”使用 Electron 45 的异步 safeStorage API，将密文保存到用户数据目录。safeStorage 使用 macOS Keychain 保护加密密钥，**不是每个服务器密码各占一条 Keychain 记录**。不可用或加密失败时，只保留本次会话密码，不保存明文。更新应用签名、身份或迁移到另一台 Mac 可能要求 Keychain 重新授权或重新输入密码；配置导出不迁移密钥。

信任绑定连接 ID、精确 HTTP(S) 来源和证书 SHA-256 指纹；对应的 WS/WSS 握手遵循同一来源规则。证书更换须重新确认。修改来源会撤销原证书信任并清除旧凭据；修改用户名也会清除旧凭据及认证缓存。网页设置仍按连接保留，账号需要完全分离时请建立新连接。

远端页面启用 sandbox、contextIsolation 和 webSecurity，关闭 Node integration，没有本地 preload 或管理 IPC。管理 IPC 验证主窗口、主 frame、精确本地页面 URL 和字段。悬浮操作条是独立本地 WebContentsView，只能调用布局与当前会话操作，不能编辑连接、读取文件或提交认证答案。向其他来源的请求会剥离 Authorization 与 Cookie，不向代理提供服务器凭据，不全局忽略 TLS。

用户数据默认位于 `~/Library/Application Support/Selkies Desk/`：

- `connections.json`：连接、窗口尺寸、布局偏好和固定证书的指纹；不含密码。旧版文件无需手动迁移。
- `credentials.enc.json`：加密凭据；不要当成可跨设备直接解密的备份。
- `Partitions/`：各连接的网页存储；可能含服务器 Cookie 等敏感会话数据，请妥善保护。

上述路径是本机使用说明；交付文件以 issue 附件为准。应用打不开且配置校验报错时，先退出应用并备份整个数据目录，再检查 `connections.json` 的格式或恢复已知良好的备份；应用不会静默覆盖损坏配置。

## 配置导入导出

通过左下角按钮选择 JSON 文件。导出排除密码、认证缓存、Cookie、权限和证书信任；保留连接名称、地址、用户名、分组、备注及 ID。

导入先校验版本和字段，确认后全部作为新连接添加，重新生成 ID。已有连接保持原样，重名条目加“（导入 2）”等后缀；不会复用原会话。最多 200 条连接，文件不超过 1 MB。地址仅接受 HTTP(S)，不接受 URL 用户名、密码、查询参数或片段；需要令牌等额外登录流程的服务暂不在此版范围内。

```json
{
  "version": 1,
  "connections": [
    {
      "name": "研发工作台",
      "url": "https://server.example:8443/",
      "group": "开发",
      "notes": "",
      "username": ""
    }
  ]
}
```

## 从源码构建

在 Apple Silicon Mac 上解压源码 ZIP，进入 `selkies-desk` 目录，或克隆上述仓库并进入仓库根目录：

```sh
npm ci
npm test
npm start
npm run package
```

依赖已由 `package-lock.json` 锁定。开发机使用 Node 26.9.0、npm 11.19.1、Xcode Command Line Tools；Electron 固定 45.2.3。Electron 首次使用可能需要下载运行时。开发依赖的安装脚本若被 npm 策略阻止，请审查对应包后按本机策略批准；不要在公共环境全局放开所有安装脚本。

`npm run package` 只构建 arm64 DMG 和 ZIP，使用 ad-hoc 签名且 `--publish never`。不会创建远程仓库、发布或调用 Apple 公证服务。安装包的系统版本下限设为 Electron 自带的 macOS 13；**实际只在本机 macOS 27.2 / arm64 验证，未声称 macOS 13–26 或 Intel 实测通过**。

重建图标可运行 `node scripts/make-icon.mjs`（需要系统 Swift、sips 和 iconutil）；图标产物已包含在源码中，正常构建无需运行此命令。

完整 Electron 测试仅使用两个本地 HTTP 模拟端及一个可轮换证书的 HTTPS 模拟端，不连接用户服务器、不使用真实密码。测试期间临时备份并恢复系统剪贴板，测试配置和临时证书在结束时清理。原生文件/权限确认在自动化中替换为确定的选择；下载内容和配置落盘由实际 Electron API 完成。

## 验证范围

详见同附的 `TEST-RESULTS.zh-CN.md`。已经验证的是客户端及本地模拟服务行为。真实 Selkies 的视频解码、音频、端到端输入法组合、剪贴板通道、文件协议和视频缩放坐标仍需在用户登录后逐项验收；插入中文文本的自动化测试不能代替 macOS 输入法组合实测。

## 官方参考

- [Selkies Web Client](https://docs.selkies.io/latest/components/web-client/)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron Session](https://www.electronjs.org/docs/latest/api/session)
- [Electron app 认证与证书事件](https://www.electronjs.org/docs/latest/api/app)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
