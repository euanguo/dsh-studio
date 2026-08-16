# 侧边栏插件「独立分发」改造规划

> 状态：**实施中** — 目标已定稿，正在执行。
> 关联：`docs/sidebar-code-audit.md`（代码卫生审查）、`docs/sidebar-structure-plan.md`（架构清晰化）。
> 决策（用户已拍板）：
> 1. Electron 专属能力 → **剥离成可选增强层**。
> 2. 通用版与桌面版 → **拆成两个独立插件**。
>
> **已落地**：
> - ✅ S1 能力下沉（fs-tree/wire/prefs-shared/git → shared）、S2 磁盘偏好 → localStorage、
>   S3 client 切通用 host `/sidebar/api`。
> - ✅ `@oh-dsh/sidebar-desktop` 增强包已创建，webview 浏览器（`browser-view.tsx` + browser tab
>   + browser surface renderer）已移入，通用 sidebar 不再含 `<webview>`。
> - ✅ `DesktopBridge` 契约下沉到 `shared/desktop-contracts.ts`。
> - ⏳ 待办：chooseWorkspace（DesktopBridge 调用）拆入增强包、插件重命名、开发文档、打包。

---

## 1. 目标

把当前"桌面端专用"的侧边栏，拆成**两个可独立分发的插件**：

| 插件 | 形态 | 内容 | 依赖 |
|---|---|---|---|
| **通用 sidebar 插件** | `dsh.bundle`（任何 DSH 直接装） | 文件树 / Git 面板 / diff / 终端 / 设置 | 仅 DSH 通用服务，**不依赖 Electron** |
| **desktop 增强插件** | 独立包（桌面端额外装） | 内嵌浏览器(webview) / DesktopBridge 工作区·文件对话框 / 磁盘偏好持久化 | Electron |

**核心矛盾**（已确认）：现在有**两套 host**，而 desktop 的 client 面板绕开了本就 framework-agnostic 的通用
host（`better-sidebar-runtime` 的 `/sidebar/api`），只消费 desktop 专属 host（`/oh-dsh-desktop/*`）。
所以"支持分发"不是造新 host，而是**让 client 回到通用 host + 拆掉 4 处 Electron 硬依赖**。

---

## 2. 现状盘点：模块归属

### 2.1 通用 host（已有，直接复用）——`better-sidebar-runtime`

`plugins/better-sidebar-runtime/src/index.ts` 挂载的能力里，**已经 framework-agnostic** 的部分：

| 能力 | 路由/位置 | 依赖 | 归属 |
|---|---|---|---|
| git / fs / settings JSON API | `/sidebar/api` | `webServer`/`sessions`/`settings` | ✅ 通用 |
| 终端 WebSocket | `/sidebar/ws/terminal` | `ws` + `node-pty`（native 但跨平台） | ✅ 通用 |
| 设置命名空间 | `SIDEBAR_PREFS_NS`（settings 服务） | `settings` | ✅ 通用 |
| agent 终端工具 | `tools.ts`/`agent-pty.ts` | `tools`/`sessions` | ✅ 通用（门控开关） |
| 媒体/HTML 预览路由 | `/sidebar/file`、`/sidebar/html` | `webServer`/`sessions` | ✅ 通用 |
| trust-fence / bundle 路由 | — | `loader`/`webServer` | ✅ 通用 |

> 结论：**通用 host 已经存在，`better-sidebar-runtime` 就是它。** 无需新写。

### 2.2 通用 client —— `desktop-sidebar` 的面板 UI（去掉 Electron 后）

| 模块 | 文件 | 依赖 | 归属 |
|---|---|---|---|
| 面板服务/注册表 | `client/sidebar-service.ts`、`client.ts` | 无 Electron | ✅ 通用 |
| 文件树 / Git 面板 | `SideToolsPanel.tsx`(FilesView)、`source-control-*`、`workspace-panel.tsx` | `betterSidebarApi` | ✅ 通用 |
| diff 组件族 | `client/diff/`（`@pierre/diffs`） | 无 Electron | ✅ 通用 |
| 中间 Tab（file/diff） | `client/surfaces/`（除 browser renderer） | 无 Electron | ✅ 通用 |
| 缓存层 | `client/runtimes/` | 无 Electron | ✅ 通用 |
| 设置区 | `client/settings.tsx`、`runtime-settings.ts` | `slots`/`settings` | ✅ 通用 |
| openPath 拦截 | `client/intercept.ts` | `workspaces`（通用服务） | ✅ 通用 |
| API 客户端 | `client/better-sidebar-api.ts` | fetch | ✅ 通用（改 base） |

client 侧依赖的 DSH 服务（`plugin.tsx:590-624`）：`locale`/`slots`/`sessions`/`inputTriggers`/`workspaces`
均为通用服务；但 `desktopPanels`、`pinnedSummary` 是**兄弟插件**提供的 desktop 专属服务，需移出或降级。

### 2.3 desktop 增强插件（Electron 专属，拆出来）

| 能力 | 文件 | Electron 依赖点 |
|---|---|---|
| 内嵌浏览器 | `SideToolsPanel.tsx:217-298`（`BrowserView`）+ `surfaces/renderers.tsx:329-355`（`BrowserSurfaceView`） | `<webview>` |
| 工作区文件对话框 | `workspace-panel.tsx:428`（`window.dshDesktop?.chooseWorkspace()`） | `DesktopBridge` |
| DesktopBridge 类型 | `client-types.ts:6,15`、`src/contracts.ts:41` | preload IPC |
| 磁盘偏好持久化 | `preferences-server.ts` + `sidebar-preferences.ts` | `appDataPath` |
| desktop 专属 host 路由 | `desktop-sidebar/src/index.ts`（`/oh-dsh-desktop/sidebar/api`、`/oh-dsh-desktop/workspace`、`/oh-dsh-desktop/sidebar/preferences`） | `desktop` 服务（`appDataPath`） |
| 面板控件 / 置顶摘要 | `panel-controls`、`pinned-summary`（`desktopPanels`/`pinnedSummary` 服务） | 桌面端专属 UI |

---

## 3. Electron 依赖逐项降级

| # | 依赖 | 现状 | 通用化方案 |
|---|---|---|---|
| 1 | `<webview>` 内嵌浏览器 | `SideToolsPanel.tsx` + `surfaces/renderers.tsx` 两处 | 通用版降级为 **iframe**（或移出核心、仅 desktop 增强层提供 webview）；`browser.*` 相关 i18n/开关进增强层 |
| 2 | `window.dshDesktop?.chooseWorkspace()` | `workspace-panel.tsx:428` | 改用 DSH 通用 `workspaces.create({path})` 服务（client-types 里已有）；文件对话框能力进增强层 |
| 3 | `appDataPath` 磁盘偏好 | `preferences-server.ts` + `sidebar-preferences.ts` | **合并进 settings 服务**（`SIDEBAR_PREFS_NS`，见审查文档发现 A）；磁盘持久化仅增强层保留 |
| 4 | `DesktopBridge` 类型/preload | `client-types.ts`、`src/contracts.ts` | 类型移入增强插件；通用 client 不再 `declare global window.dshDesktop` |
| 5 | `desktopPanels`/`pinnedSummary` 服务 | `plugin.tsx:620-621` | 移出通用 client；作为增强层注入的 tab/viewer，通过 `registerTab`/`registerViewer` 扩展点接入 |

---

## 4. client API 切回通用 host

当前 client 只调 `/oh-dsh-desktop/sidebar/api`（`shared/sidebar-api.ts:106` 的 `SIDEBAR_API_BASE`）。
切回通用 `/sidebar/api` 需要处理**方法差异**：

| 方法 | desktop host（`sidebar-api.ts`） | 通用 host（`better-sidebar-runtime/index.ts`） | 处理 |
|---|---|---|---|
| `git.worktree-list` / `git.worktree-add` | ✅ 有 | ❌ 缺 | **补到通用 host**（left-rail 也依赖） |
| `fs.write` / `git.revert` / `cherry-pick` / `show` / `pty.*` / `jobs.*` / `browser.probe` | ❌ 无 | ✅ 有 | 通用版多出的方法，client 按需用 |
| 其余 fs/git/settings | ✅ 同 | ✅ 同 | 直接对齐 |

> 关键点：desktop 版 `sidebar-api.ts` 是通用版 `index.ts` 的**精简子集 + worktree 扩展**，
> 不是两套独立协议。切回通用 host 的实质是"把 worktree 两个方法补进通用 host，删掉 desktop 那套精简 host"。

---

## 5. 拆分顺序（分阶段，建议）

| 阶段 | 内容 | 前置 | 验收 |
|---|---|---|---|
| **S1 能力下沉** | `fs-tree`/`wire`/`prefs-shared` 从 `better-sidebar-runtime` 迁到 `shared`，删 `git.ts` re-export 垫片（= 审查文档 P0/P1） | 无 | 跨插件 import 归零；`SidebarError` 单实例 |
| **S2 合并偏好** | 磁盘偏好并入 settings 服务，删 `preferences-server`（= 审查文档 P0） | S1 | 单一 schema；默认值一致 |
| **S3 client 切通用 host** | `SIDEBAR_API_BASE` 改 `/sidebar/api`；`git.worktree-list/add` 补进通用 host；删 desktop 精简 host | S1 | client 在非 Electron DSH 能跑通 fs/git/settings/terminal |
| **S4 拆 browser** | webview 浏览器 → 通用版 iframe（或移出核心）；webview 实现进增强层 | S3 | 通用版无 `<webview>` |
| **S5 拆 DesktopBridge** | `chooseWorkspace` 改走 `workspaces`；`DesktopBridge` 类型移增强层 | S3 | 通用 client 零 `window.dshDesktop` |
| **S6 拆出 desktop 增强包** | 浏览器(webview)/磁盘偏好/DesktopBridge/工作区 独立成 `dsh.bundle` 增强插件 | S4+S5 | 桌面端 = 通用包 + 增强包 |
| **S7 打包分发** | 通用 sidebar 打 `dsh.bundle`（`cordis.patch.yml` + `dsh.client.inject`），增强包同样；补 `desktop-left-rail` 进 profile | S6 | 第三方 DSH 装通用包即用 |

> S1–S2 就是审查文档 `sidebar-code-audit.md` 里的 P0 改造项——**分发目标与审查结论完全同构**，
> 先做 S1/S2 顺带把最深的架构债一起还掉。

---

## 6. 风险与待确认

1. **`desktopPanels`/`pinnedSummary`**（panel-controls/pinned-summary 两个兄弟插件）是否也一起通用化？它们当前是
   desktop 专属 UI；若通用版不需要，则通过 `registerTab`/`registerViewer` 扩展点由增强层注入，需确认这两个插件
   最终归属（通用 or 增强）。
2. **终端**（`node-pty`）在非 Electron 的 DSH 宿主里要能编译/加载 —— `node-pty` 是 native 模块，需确认通用 DSH
   运行时的 node ABI 兼容（`better-sidebar-runtime` 已在 `build-config.mjs` 把它 external，运行时由宿主提供）。
3. **皮肤 `desktop-skins`** 是否随增强层走（它依赖 `appDataPath` 磁盘偏好），还是也通用化（皮肤本身是纯 CSS token，
   可通用）。
4. **left-rail**（`desktop-left-rail`，fork 上游 ui-workspace）不在本次"侧边栏分发"范围，但它也依赖
   `shared/sidebar-api` + `git-core`，S1/S3 会波及它，需同步回归。

---

## 7. 命名与开发文档（需求已记录，待启动时执行）

> 用户追加的两个需求，先记录、不启动。

### 7.1 插件命名重设计

现状命名在"通用化拆分"后不再合适，需要重起（方向建议，最终名待拍板）：

| 现状 | 问题 | 建议方向 |
|---|---|---|
| `@oh-dsh/desktop-sidebar` | `desktop` 前缀在通用化后**误导** | `@oh-dsh/sidebar`（通用侧栏本体） |
| `@oh-dsh/better-sidebar-runtime` | `better` 是上游 `DSH-better-sidebar` 的继承名，无实义 | `@oh-dsh/sidebar-host`（通用 host，或并入 sidebar 包） |
| （新）desktop 增强插件 | 待命名 | `@oh-dsh/sidebar-desktop`（或 `desktop-sidebar-addons`） |
| `@oh-dsh/shared` | 尚可，但可更明确 | 维持，或改 `@oh-dsh/sidebar-shared` |

> 原则：包名应体现**职责与边界**（sidebar 本体 / host 能力 / desktop 增强），
> 不再用 `desktop-`/`better-` 这类历史前缀去描述一个已经通用化的东西。

### 7.2 开发文档（面向 Agent + Markdown）

拆分落地时，为**两个包各维护一份开发文档**，让后续开发者（人类与 Agent）能读懂并继续开发，内容至少包括：

1. **这个包是什么**：职责、边界、依赖的 DSH 服务清单（`inject` / `ctx.get`）。
2. **架构**：host/client 分层、路由表、模块归属图（哪些在通用包、哪些在增强包）。
3. **如何开发**：新增一个 tab/viewer 的步骤、新增一个 API 方法的步骤、如何跑 typecheck/test/build。
4. **命名/编号规范**：包名前缀、目录结构、API 方法名（`git.*`/`fs.*`）、i18n key、CSS 类名前缀（`--oh-dsh-*`）等，统一约定。
5. **契约与漂移防线**：`shared/sidebar-api.ts` 是唯一 wire 契约；谁改契约必须同步 host/client 两侧（否则 build 失败）。

> 与既有文档分工：`sidebar-architecture-analysis.md`（功能/布局）、`sidebar-code-audit.md`（卫生审查）、
> 本文档（拆分规划）、`sidebar-structure-plan.md`（**架构清晰化：文件/目录拆分清单**，开发文档的「架构」部分）；
> 开发文档是**给后续开发者看的"怎么继续写"**，而非"现在改成什么样"。

## 8. 一句话总结

> 通用 host 已经存在（`better-sidebar-runtime`），要做的是**把 client 从桌面专属 host 切回通用 host**，
> 并把 webview / DesktopBridge / appDataPath 三处 Electron 依赖拆成独立的增强插件。
> S1–S2 先还架构债，S3–S6 做拆分，S7 打两个 `dsh.bundle` 完成分发。
