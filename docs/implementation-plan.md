# Selkies Desk Implementation Plan

**Goal:** 完成 ZHJ-7 指定的 macOS 多连接客户端与本机 arm64 安装包。

**Architecture:** 中文本地管理窗口只使用受限 preload。主进程创建一个活动 WebContentsView，每个连接 UUID 对应持久分区；切换销毁旧 WebContents。配置、加密凭据、证书固定分离管理。远端没有 preload、Node 或 IPC。

**Tech Stack:** Electron 45.2.3、TypeScript、esbuild、Zod、Playwright Electron。

**Spec:** ZHJ-7 issue 的首版范围及验收条目（2026-11-10 读取）。

## Global Constraints

- 独立目录，不修改 RTMultica，不创建远程仓库。ZhangJun 于 2026-11-10 提供现有仓库 `zinohome/Selkies-Desk` 并授权完成后提交推送；不发布 GitHub Release 或商店。
- 只交付实测的 macOS arm64；无 Apple 签名身份，包标为未公证测试包。
- 先写关键行为测试，再实现。所有自身构建和测试前台收集结果。
- 不采用全局忽略证书，不向远端提供本地 IPC，不导入个人浏览器数据。
- 源码归档排除依赖、测试运行数据、Cookie、真实凭据。

## Tasks

1. **连接模型与保存**：`src/model.ts` 提供 `parseConnection`、`parseImport`、`Store`；`src/vault.ts` 提供加密凭据管理。先运行 `tests/model.test.ts` 的失败用例，覆盖协议、URL 凭据、重复 ID、导入冲突、证书范围、密码回退与清理，再实现到全绿。
2. **安全远端生命周期**：`src/remote.ts` 管理精确 origin Basic 认证、证书提示、下载、权限和单流关闭；`src/main.ts` 注册验证 sender 的 IPC 与菜单。先写 Electron 集成用例，使用两个本地 Basic/流模拟端验证同源账号隔离、错误重试、旧连接关闭、远端无 IPC、跨源凭据剥离及 TLS 变更/撤销。
3. **中文交互界面**：`src/ui/index.html`、`style.css`、`renderer.ts` 与 `src/preload.ts`。实现新增/编辑/删除、分组搜索、状态、认证/证书对话框、全屏、导入导出；GUI 自动化通过可见控件操作并截图。
4. **构建与交付**：运行全部测试和 arm64 打包；在本机启动打包后的应用，验证关键行为；探测明确授权的四个真实服务目标，按网络与凭据情况准确区分未验证项。附源码 ZIP、DMG、ZIP、SHA256、使用说明、测试证据。

## Review Focus

- 切换与待确认认证/证书的竞争：过期 token 不得用于新连接。
- 同源两个账号：Cookie、localStorage、HTTP auth、用户设置均独立。
- 跨源跳转与子请求：不带出 Authorization，不给远端本地 IPC。
- 证书更换和撤销：旧信任不能静默延续。
- 应用关闭/重启：配置与窗口恢复，活动流释放，无明文密码。

## Execution Ledger

- 2026-11-10：已有详尽需求及直接实施授权，使用 native 执行；无子代理工具，最后进行单独自审。新独立目录不涉及已有 Git 分支/工作树。
- 设计选择：页面加载完成标记为“页面已加载”，不冒充实际视频流已连接；导入一律生成新 ID 并保留原配置，重复名称加“导入”后缀。
- 2026-11-10 试用修订：根据“桌面空间优先”反馈实现设备卡片、独立隐藏两栏、专注模式、浮动会话操作条与原生菜单恢复，详见 `layout-design.md`。
