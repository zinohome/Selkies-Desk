# Selkies Desk 本机测试结果

## 0.4.0（当前版本）

测试日期 2026-11-10，构建和测试机为 macOS 27.2 / Apple Silicon arm64，Electron 45.2.3。

已运行并通过：

- 22 项单元测试：快捷键按物理按键匹配、自定义快捷键校验和查重、中英文词条一一对应、设置默认值与持久化、修改一项设置不影响其他设置、旧版配置文件可读、自动连接只能指定一个连接、自动重连的错误分类与等待时间、macOS 全屏时工具栏与操作条的位置计算，以及原有的模型、凭据和权限测试。
- 源码 Electron E2E 25 项，新增 6 项：
  - 远端网页截走全部按键并取消默认行为时，管理快捷键仍然生效且只触发一次；普通按键照常到达远端；自定义、查重、恢复默认。
  - 设置页切换中英文（界面、原生菜单、状态说明）和亮色/暗色/跟随系统，并写入配置；在界面上录制快捷键。
  - 从远程桌面呼出快速切换面板，方向键选择，回车连接。
  - 连接后自动专注；断开时保存缩略图，关闭该设置后文件被删除。
  - 服务器不可达时进入“等待重连”并显示原因和进度，可停止；服务恢复后自动连上；关闭该设置后只报告一次失败。
  - 标记为启动时自动连接的条目在重启后无需点击即开始连接。
- 打包后的 arm64 应用（`release/mac-arm64`）同样运行全部 25 项 E2E 并通过，没有跳过的步骤。
- macOS 全屏：进入全屏后顶部工具栏不再显示、桌面从屏幕最上方开始、工具栏偏好保持不变；悬浮操作条展开后“退出全屏”按钮位于顶端下方 56 DIP 以外并可点击；退出后布局恢复。源码和打包应用各验证一次。
- `npm run package:all` 生成四种安装包，无错误。两个 DMG 的 `hdiutil verify` 和两个 macOS 应用的 `codesign --verify --deep --strict` 通过。

说明与未验证项：

- 测试中途这台 Mac 的屏幕一度锁定。锁屏时 macOS 无法切换全屏，新签名的应用也无法取得钥匙串授权；E2E 会跳过全屏步骤并在结果里记录 `skipped-step`。最终提交的结果是在解锁后重新运行的，没有跳过项。期间发现并修复了一个问题：旧代码在等待钥匙串时不创建窗口，现在窗口先显示，加密存储可用后再启用“记住密码”。
- **没有用真实键盘验证快捷键。** 测试通过 Electron 的原生输入事件接口注入按键，走的是与真实键盘相同的主进程拦截路径，但不是系统级按键；本环境没有辅助功能权限。
- **全屏时系统菜单栏滑下后的实际遮挡范围没有实测。** 自动化无法触发菜单栏滑出，56 DIP 是按“24 DIP 菜单栏 + 28 DIP 标题条”留出的余量。
- **macOS 窗口按钮（红黄绿）与工具栏的对齐没有截图确认。** 本环境没有屏幕录制权限，应用内截图不包含系统绘制的窗口按钮。
- Intel Mac、Windows、Ubuntu 安装包没有在对应系统运行；真实 Selkies 服务没有复测。

0.4.0 安装包 SHA256：

```text
411ba6ed609136e715015dfde4ce09a0ae92a2fc57bf90820f0be719db9738ad  Selkies-Desk-0.4.0-mac-arm64.dmg
41877bf5c34d63ecc901605c6b843456f20c13a1c4f2bec71955ae78cf95ca51  Selkies-Desk-0.4.0-mac-arm64.zip
d7d793679cabcce355939f3c505d2731294144cc1f6b8786ee0f814e630b1646  Selkies-Desk-0.4.0-mac-x64.dmg
badfd56a28183dd8a3dbc1d12a40735158b717b0ddbb172a573d288c75e6af74  Selkies-Desk-0.4.0-mac-x64.zip
8769bb262323fa82f75bed2675cdb98f60fbda887a5b25772a50582032a81b3f  Selkies-Desk-0.4.0-windows-x64-setup.exe
ccdeff75220f20ad2362a25b1e9db8b1f9ff033626004dd6953c757ba9e41d17  selkies-desk_0.4.0_amd64.deb
```

## 0.3.0


测试日期 2026-11-10，构建和测试机为 macOS 27.2 / Apple Silicon arm64，Electron 45.2.3。本次增加 Intel Mac、Windows x64、Ubuntu amd64 安装包，并按系统适配快捷键、菜单、字体和密码存储说明。

已运行：

- 15 项单元测试通过，新增两项：各系统快捷键带 Alt 修饰、互不重复且避开 Ubuntu 的 `Ctrl+Alt+T`；Linux 没有系统密钥环时不把密码写入磁盘。
- 源码 Electron E2E 19 项通过；打包后的 arm64 应用（`release/mac-arm64`）E2E 19 项通过。
- `npm run package:all` 在本机一次生成四种安装包，无错误。两个 DMG 的 `hdiutil verify` 通过，两个 macOS 应用的 `codesign --verify --deep --strict` 通过。
- 文件结构检查：Intel Mac 应用主程序为 `x86_64`；Windows 主程序为 PE32+ x86-64，安装程序为 NSIS；deb 为 `amd64`，主程序为 x86-64 ELF，包含桌面入口、16–512 像素图标和 `libsecret-1-0` 等依赖声明。

未运行：

- **Intel Mac、Windows、Ubuntu 的安装包没有在对应系统安装或启动过。** 开发机没有 Rosetta，也没有 Windows 或 Linux 环境。
- 这三个系统上的菜单栏隐藏后快捷键是否生效、字体和图标显示、DPAPI 与系统密钥环、Wayland/X11 输入法、硬件解码、多显示器 DPI 均未验证。
- 真实 Selkies 服务本次没有登录或复测。

0.3.0 安装包 SHA256：

```text
e0e937c18427fe593a3f7fbf2b9670f64e2585548332cfb9e3f844f95525db56  Selkies-Desk-0.3.0-mac-arm64.dmg
61e9b959b9b40f2c99838ebc78200a8603d7775e8de4cc3c644726faa287df3f  Selkies-Desk-0.3.0-mac-arm64.zip
c14ac6748723319f48156f0afcc731e32a48e6647a6a32135fef4e759b507e80  Selkies-Desk-0.3.0-mac-x64.dmg
0212202c16f983631c61adbf7f65fc6385f1c745544d8b2388039edf803a95c2  Selkies-Desk-0.3.0-mac-x64.zip
3d570ac3a0ccc49ac4c7ccfaab80c4f0f294fc91fe42ad5578aaae0c20bcfadc  Selkies-Desk-0.3.0-windows-x64-setup.exe
6154a750648015385782e4589d44132e88678f14c264d19b02095d871b108963  selkies-desk_0.3.0_amd64.deb
```

## 0.2.2


测试日期 2026-11-10，macOS 27.2 / Apple Silicon arm64，Electron 45.2.3。本次是工具栏外观和提示文案调整：主工具栏全部使用 SVG 图标，包含连接、断开、重连、专注模式、全屏、设置和两栏切换；每个按钮有中文 title 和无障碍名称。专注模式提示精确为“专注模式”。专注顶部操作条保留文字，“恢复布局”改为“常规模式”，原生显示菜单也使用“常规模式”。

- `npm test`：13 项单元测试和 19 项源码 Electron E2E 通过。
- `SELKIES_PACKAGED_PATH=… npm run test:e2e`：只读挂载修正图标后的 0.2.2 DMG 内的应用，全部 19 项 E2E 通过，无失败、跳过或 flaky。
- 实际 GUI 检查确认主工具栏八个按钮无可见文字、各有一个 SVG 图标和中文悬停提示；在 960、1280、1600 DIP 宽窗口，分别设置 1× 和 2× 缩放进行几何测量和截图，八个 SVG 均为 20×20 DIP；专注栏保留文字，“常规模式”可恢复侧栏和工具栏。连接、重连、断开、全屏及布局快捷键行为沿用原实现。
- 已检查设备页和专注操作条的实际截图；统一使用 Lucide 1.71.0 标准路径、currentColor、20×20 DIP 图标和 32×32 DIP 按钮。SVG 固定宽高比，禁止被 flex 压缩，不依赖字体符号或外部图标服务。图标库按需打包，许可证包含在应用中。
- `npm run package` 成功；`hdiutil verify` 和本机/DMG 内应用的 `codesign --verify --deep --strict` 通过。ad-hoc 签名、未公证。
- 本机与 DMG 内的 `app.asar` SHA256 均为 `bfe7702fe9433f7c932335df2a73d797e092fd77a8f9da74757780e1067bde87`。
- 现有配置及数据目录未迁移或清除。验证使用临时独立配置；剪贴板默认允许及其持续/并发读写回归继续通过。此次未登录或复测真实 Selkies 服务。
- DMG、应用 ZIP 和源码归档仅留在 Mac 开发环境，不上传 Multica，不发布 Release；可提供的附件仅为测试证据或截图。

0.2.2 安装包 SHA256：

```text
14e08bbd1776938963dacb28febea9117d28032fd8d599cdabc91776452d5981  Selkies-Desk-0.2.2-arm64.dmg
89e12de4f5a528134ec81b63dc9109601aeae51efdf92bd51eee6caf90834314  Selkies-Desk-0.2.2-arm64.zip
```

## 0.2.1（历史记录）

测试日期：2026-11-10。macOS 27.2（26B123）、Apple Silicon arm64、Electron 45.2.3。没有在 Intel 或其他 macOS 版本上实测。

### 变更与复现

0.2.0 的权限请求入口每次调用都弹窗，没有复用允许/拒绝结果或合并并发请求。在本机真实 Electron 中，首次拒绝后执行 20 次并发读取及 10 次定时轮询，累计出现 **31 次询问**，新回归因此失败。

按 ZhangJun 最新要求，0.2.1 对当前活动连接的精确来源**默认允许剪贴板读写，零剪贴板确认框**。此要求替代旧的剪贴板允许/拒绝交互要求。其他权限继续询问：按连接、精确来源、权限及媒体类型缓存允许/拒绝结果，合并相同并发请求，并依次显示不同权限的询问。

页面刷新、重连、断开、切换、进程退出和页面销毁会清除其他权限决定、完成待决请求并取消旧弹窗。单个询问两分钟超时后拒绝；使用“重连”重新授权。页面被独立销毁后会移除旧原生视图并显示可重连状态，避免引用已经消失的 WebContents。

### 执行结果

| 检查 | 结果 |
| --- | --- |
| `npm run test:unit` | 13 项通过，0 失败 |
| TypeScript 与 esbuild | 通过 |
| 源码 Electron E2E | 19 项通过，0 失败、跳过或 flaky |
| 只读挂载 0.2.1 DMG 内应用的 E2E | 19 项通过，0 失败、跳过或 flaky，包含 16 次并发写入断言 |
| `npm run package` | arm64 DMG、ZIP 构建完成，未发布 |
| 本机及 DMG 内 `.app` | `codesign --verify --deep --strict` 通过，ad-hoc 签名、未公证 |
| DMG | `hdiutil verify` 通过，挂载只读验证 |
| 两份 `app.asar` SHA-256 | `191d304d5c3142fe8733eeda6a1381b79127fd71cf44c4efbc1cdc2b12f1910e`，一致 |

### 剪贴板及生命周期行为

- 每轮 32 次并发读取和 50 次、间隔 20ms 的轮询；重连后再执行一轮，合计 **164 次读取**。全部读取到合成文本，**0 次剪贴板弹窗**。
- 一次页面按钮写入和 **16 次并发写入**全部成功；实际系统剪贴板内容匹配，原生 `WebContents.paste()` 将中文文本粘贴到输入框。
- Electron 45.2.3 实际记录：164 次 `clipboard-read` 请求、17 次 `clipboard-sanitized-write` 请求；另有两次被拒绝的 `background-sync` 检查。记录仅含权限名、阶段、本地模拟 origin，不含剪贴板内容、密码或 Cookie。
- 此 Chromium 中 `document.execCommand('paste')` 返回 false，未触发 `deprecated-sync-clipboard-read` 事件。没有把它宣称为可用；该旧式权限名通过注册处理器边界测试，检查和请求均按同一剪贴板默认策略处理。
- 注册处理器边界测试逐个验证三种剪贴板权限：当前连接精确来源允许；跨来源、本地管理 WebContents、null/worker 均拒绝。断开后原处理器拒绝访问。
- 非剪贴板权限：20 次并发及后续一次鼠标锁定请求只有一次询问，拒绝结果复用；不支持的定位权限直接拒绝，未授权媒体检查为 false。单元回归覆盖音频/摄像头分离、连接及 origin 隔离、迟到允许不能覆盖新会话。
- 生命周期回归调用应用实际注册的权限处理器、真实远端 WebContents 和**真实 macOS 原生权限弹窗**。刷新、断开、销毁各有 10 个同类待决请求；均取消原生弹窗、触发 AbortSignal、每个回调仅收到一次 false，随后可重连。
- 测试临时备份/恢复系统剪贴板，仅在内存保存备份，过滤空 MIME 项，未把个人剪贴板保存到文件。

### 其他功能回归与配置保留

两台本地 HTTP 模拟服务器及轮换证书的 HTTPS 模拟服务器使用合成凭据。回归通过 Basic 错误密码重试、safeStorage 加密及重启解密、清除认证缓存、同源不同账号 Cookie/localStorage/DPI 隔离、切换断开旧 SSE/WebSocket、跨源凭据剥离、远端无 Node/管理 IPC、证书首次确认及轮换撤销、下载上传入口、中文文本插入、Retina DOM 落点、全屏、侧栏/工具栏隐藏、专注模式、配置导入导出与重启持久化。

所有自动化及交互检查均使用独立临时 user-data-dir；没有读取、迁移或重置用户现有连接、凭据或浏览器会话。存储格式、appId 及默认数据目录保持不变。DOM 中文文本测试不能代替真实输入法组合或视频坐标实测。

### 真实服务限制

L13 `192.168.99.105:8443` TCP 端口可达。使用 agent-browser 在打包应用独立临时配置中新增该地址，连接后显示“核对服务器证书”。未信任该证书，未登录，应用和临时配置已关闭清理。本次未读取或使用用户凭据。真实 Selkies 视频、音频、键鼠、端到端剪贴板和输入法仍未验收，不能用模拟端通过代替 L13 循环问题的端到端实测。

### 产物与复查

安装包只保留在 Mac 开发环境，不上传 Multica，不发布 GitHub Release。源码与测试提交至 `zinohome/Selkies-Desk`。SHA-256：

```text
8bf69edbf1d6a5c05bb10915b3b7583cc0bd02ac27f6e2540e232683a4200010  Selkies-Desk-0.2.1-arm64.dmg
0888fff5c09591991827c000f8241d0e5b10082c13dba65cef9b1eafd37d69c1  Selkies-Desk-0.2.1-arm64.zip
```

测试统计和本地模拟端截图可作为测试证据提供，不含编译产物或真实桌面画面。本次由作者自审；运行时没有独立审查子代理工具。重点检查了默认剪贴板策略的范围、两种处理器的一致性、其他权限边界、过期弹窗取消、回调单次完成和现有配置兼容性。
