# Oh-DSH 右侧栏插件体系 — 代码卫生审查报告（兼容/死代码/冗余/绕圈专项）

> 审查日期：2025-08-15（工作区含未提交 WIP，以下发现以当前磁盘状态为准）
> 审查性质：**只审查，不改代码**。目标：找出从上游插件 `DSH-better-sidebar` 改造演进至今，
> 修修补补留下的**兼容性代码、无用/死代码、多余中间层、重复实现、绕圈的调用链**。
> 与既有文档分工：`sidebar-architecture-analysis.md`（功能/布局）、`sidebar-rebuild-plan.md`（改造计划）
> 讲"是什么、要改成什么"；本文档只讲"哪里脏了、为什么脏、怎么清"。

---

## 0. TL;DR 结论

代码整体**不是脏乱**（139 测试全绿、无死测试、无未使用依赖、无提交的构建残留），但"从一个上游插件改造"的过程中
确实留下一批清晰的**演进残渣**。按影响从大到小：

1. **跨插件源码 import 蔓延**（最深的架构耦合）：不止 `desktop-sidebar → better-sidebar-runtime`，
   `pinned-summary` / `plugin-marketplace` / root `src/` 也都用相对源码路径互引，`@oh-dsh/*` 包边界形同虚设。
2. **两套偏好设置系统并存**，且磁盘偏好这套 HTTP 持久化模式被**整份复制**到 `desktop-skins`（同一模式出现 3 次）。
3. **一批重复实现**：`readText` / `sameOrigin` / `sendJson` / `readJson` / `call()` / 终端控制帧解析 各自写了 2–4 遍，
   且 body 上限互不一致。
4. **约 1868 行 vendored 死代码**（上游 client 层）躺在 `better-sidebar-runtime/src/client/`，无人运行。
5. **一批死 i18n key（约 29 个）、死 CSS（含 120 行孤儿 diff 样式）、死路由、死导出**。
6. **工程链路的真实隐患**：`verify-skin-tokens.mjs` 硬编码本机绝对路径、dev 态改 `.module.css` 不生效
   （生成物 `styles.ts` 入库但不进 dev 流程）、`desktop-left-rail` 未入 profile 清单导致覆盖黑洞。

好消息：`git` 能力已经统一到 `shared/git-core.ts`（上游 `git.ts` 只剩 12 行 re-export），说明
"能力下沉 `shared`"的方向已经走对，只是**没走完**——`fs-tree`/`wire`/`prefs-shared` 还在上游包里。

---

## 1. 审查范围与方法

- 核心：`plugins/better-sidebar-runtime`、`plugins/desktop-sidebar`、`plugins/shared`
- 关联：`plugins/desktop-skins`、`plugins/desktop-left-rail`、`plugins/panel-controls`、`plugins/pinned-summary`、`plugins/plugin-marketplace`
- 工程：`src/`（主进程）、`scripts/`（构建）、`tests/`、各 `package.json` / `tsconfig`
- 方法：git 历史考古 + 全量 grep 引用关系 + 死 key/死 CSS 脚本检测 + 交叉验证"谁 import 谁、谁被谁 import"

> 演进脉络（`git log --oneline` 已确认）：这是一个从 **Synara web-next 参考项目移植组件**的改造，
> Phase A–F 已全部完成（`docs/sidebar-rebuild-plan.md` 看板）。关键历史节点：
> `extract git-core` → `runtimes registry` → `ListRow/FilenameLabel` → `shared SurfaceTab`
> → `unified DiffViewer on @pierre/diffs, drop legacy diff parser` → `drop DetachedPanel`。

---

## 2. 核心发现（按严重度）

### 🔴 A. 两套偏好设置系统并存，且磁盘偏好模式被复制 3 份

**这是本次审查最重的一条。** 桌面端同时维护了两套"侧栏偏好"，字段重叠、默认值相反，且其中一套的
持久化模式被**整文件复制**到了另一个插件。

| | settings 服务（`dsh-better-sidebar` 命名空间） | 磁盘 JSON 文件（`desktop-sidebar.json`） |
|---|---|---|
| 定义 | `plugins/better-sidebar-runtime/src/prefs-shared.ts` + `config.ts` | `plugins/desktop-sidebar/src/sidebar-preferences.ts` |
| 服务端 | settings 服务注册（`better-sidebar-runtime`） | `plugins/desktop-sidebar/src/preferences-server.ts`（GET/PUT 路由） |
| 客户端 | `client/runtime-settings.ts` → `settings.get/update` | `client/sidebar-storage.ts` → HTTP GET/PUT |
| 字段 | 13 个（含 openByDefault、defaultWidthPercent、autoOpen*、htmlViewer*、browser*、tabsEnabled、viewersEnabled） | 6 个（defaultWidth、openByDefault、sessions、tabsEnabled、viewersEnabled、version） |
| 宽度语义 | **百分比** 20–60，默认 30% | **像素** 280–480，默认 300px |
| openByDefault 默认 | **true** | **false** |

- **重叠字段**：`openByDefault`、`tabsEnabled`、`viewersEnabled` 两边都有，默认值/语义不一致。
- **实际消费**：磁盘管"宽度 / 是否默认打开 / 每会话 tabs 布局 / tab·viewer 开关"；
  settings 管 4 个运行时开关（agentTerminalTools / bottomPanelAutoTerminal / browserInterceptLinks / interceptOpenPath）。
  settings 里其余 9 个上游字段在 desktop 里**没被消费**，是原样 vendor 进来的。

**最糟的是扩散**：`desktop-skins` 又复制了一套同样的磁盘偏好模式——
`plugins/desktop-skins/src/preferences.ts` + `preferences-server.ts` + `client/preferences-storage.ts`
与 sidebar 的三个文件**同构**（只是业务字段换成 skin id/fallbackTheme）。于是
`sameOrigin` / `sendJson` / `readJson` 这套 HTTP 持久化样板在仓库里出现了 **3 份**：

```
plugins/desktop-sidebar/src/preferences-server.ts   （sidebar 磁盘偏好）
plugins/desktop-sidebar/src/index.ts                （workspace API，又写了一遍 sendJson/sameOrigin/readJsonBody）
plugins/desktop-skins/src/preferences-server.ts      （skins 磁盘偏好，第 36/44/55 行再写一遍）
```

**建议**：收敛为**一个 schema + 一个存储 + 一份 HTTP 样板**。要么全部走 settings 服务（已有 revision 守卫 +
schema 校验 + open-map 语义），要么全部走磁盘，二选一；并把 `preferences-server` 这个"磁盘偏好 HTTP 服务"
抽成 `shared` 的一个可复用模块，让 sidebar 和 skins 各自只提供 schema。

---

### 🔴 B. 跨插件源码 import（绕过 package 边界）

`plugins/desktop-sidebar/src/sidebar-api.ts` 直接伸手进另一个插件的源码：

```ts
import * as git from '../../better-sidebar-runtime/src/git.ts'          // :17
import { isWithin, listDirectory, requireAbsolute } from '../../better-sidebar-runtime/src/fs-tree.ts'  // :22
import { readJsonBody, requireString, SidebarError, writeError, writeOk } from '../../better-sidebar-runtime/src/wire.ts'  // :29
import { SIDEBAR_PREFS_NS } from '../../better-sidebar-runtime/src/prefs-shared.ts'  // :30
```

问题：
1. `desktop-sidebar/package.json` 的 `dependencies` **没有声明** `@oh-dsh/better-sidebar-runtime`，却靠相对路径依赖其源码。
2. 构建上（`scripts/build-config.mjs`，每个插件独立 `bundle: true`）同一份 `fs-tree`/`wire`/`prefs-shared`
   源码被**同时打进多个产物**（`better-sidebar-runtime/index.js`、`desktop-sidebar/index.js`）。
3. `SidebarError` 是 `wire.ts` 里的 class，跨 bundle 出现多份实例；一旦未来错误对象跨 bundle 传递，
   `instanceof SidebarError` 会静默失效（当前各自内部消化，未触发纯属侥幸）。
4. `scripts/check-sidebar-source.mjs` 只做"目录存在 + 打印基线"检查，**并不真正 diff fork 文件**，防漂移是纸面的。

**建议**：把 `fs-tree.ts`、`wire.ts`、`prefs-shared.ts` 迁到 `shared`（`git.ts` 已经这么做了，见 C），
让 `desktop-sidebar` 和 `better-sidebar-runtime` 都从 `shared` import，彻底切断插件间源码耦合。

---

### 🔴 C. 硬编码本机绝对路径（构建脚本可移植性 bug）

`scripts/verify-skin-tokens.mjs:50`：

```js
const skinsSrc = readFileSync('/Users/verger/code_source/front_end/important_project/oh-dsh-desktop/plugins/desktop-skins/src/client/skins.ts', 'utf8')
```

这是 `/Users/verger/...` 的绝对路径。换任何一台机器、任何 CI，这个脚本都会在 `readFileSync` 抛 ENOENT。
应该用 `fileURLToPath(import.meta.url)` 相对定位到仓库根。

---

### 🟠 D. 兼容 re-export 垫片（`better-sidebar-runtime/src/git.ts`）

`plugins/better-sidebar-runtime/src/git.ts` 现在只剩 12 行：

```ts
// The implementation moved to plugins/shared/git-core.ts ...
export * from '../../shared/git-core.ts'
```

它的**唯一消费者**是 `desktop-sidebar/src/sidebar-api.ts:17`（grep 全仓库确认）。
因此这个"兼容 re-export"已经没有存在必要——`sidebar-api.ts` 完全可以直接 import `shared/git-core.ts`，
然后删掉这个垫片。这是"下沉没走完"的典型残留。

---

### 🟠 E. `readText` 重复实现（2 份）

- `plugins/desktop-sidebar/src/sidebar-api.ts:109` —— 带 base64 `data` 字段（供图片/PDF 内联预览）
- `plugins/better-sidebar-runtime/src/index.ts:139` —— 不带 `data`

两份都是"带 cap 读文件 + NUL 探针二进制检测"，语义几乎相同。desktop 版是上游版的超集。
应抽到 `shared` 一份，上游版作为参数化（是否内联 base64）的同一函数。

---

### 🟠 F. HTTP 工具样板重复（4+ 处，body 上限还不一致）

| 函数 | 出现位置 | body 上限 |
|---|---|---|
| `readJsonBody` | `better-sidebar-runtime/src/wire.ts:44` | **1 MB** |
| `readJson` | `desktop-sidebar/src/preferences-server.ts:49` | **256 KB** |
| `readJsonBody` | `desktop-sidebar/src/index.ts:52` | **32 KB** |
| `readJson` | `desktop-skins/src/preferences-server.ts:55` | 待核 |
| `sameOrigin` | `sidebar-api.ts:316` / `preferences-server.ts:38` / `index.ts:41` / `desktop-skins/preferences-server.ts:44` | — |
| `sendJson` | `preferences-server.ts:30` / `index.ts:33` / `desktop-skins/preferences-server.ts:36` | — |
| `writeJson` | `better-sidebar-runtime/src/wire.ts:65`（响应头与 `sendJson` 不同） | — |

同一套"解析 JSON 请求体 / 校验同源 / 写 JSON 响应"的样板被反复手写，且 **body 上限从 32KB 到 1MB 不等**。
建议统一到 `shared` 一份，带显式上限参数。

---

### 🟠 G. vendored 死代码：`better-sidebar-runtime/src/client/`（约 1868 行）

`plugins/better-sidebar-runtime/src/client/` 共 5 个文件：`state.ts`(1048) + `service.ts`(434) +
`api.ts`(216) + `browser.ts`(119) + `breakpoints.ts`(51) ≈ **1868 行**。

grep 全仓库，**没有任何一个运行时 import 它们**；只有两处类型 re-export 引用：
- `better-sidebar-runtime/src/index.ts:56`（`export type { BetterSidebarService, ... } from './client/service.ts'`）
- `better-sidebar-runtime/src/context-types.ts:23`（`import type { BetterSidebarService }`）

desktop 实际用的是**自己重写的** `desktop-sidebar/src/client/sidebar-service.ts`（527 行）里的
`DesktopSidebarTabDescriptor` 等，与上游 `BetterSidebarService` 是两套平行类型。

`VENDOR.md` 声明"仅保留 type-contract 文件供 host entry re-export"，但当前仓库是封闭自包含的 desktop，
没有任何第三方插件通过 `BetterSidebarService.registerTab` 扩展。这 1868 行是**纯维护负担**：
要么裁掉，要么在 `VENDOR.md` 明确标注"零运行时消费者，升级时跳过"。

---

### 🟠 H. 死 i18n key（约 29 个）

脚本对 `desktop-sidebar/src/client/i18n.ts` 的 114 个 key 做引用检测，**29 个疑似未使用**，重点：

```
workspace.comment-commit / comment-line / comment-placeholder / add-comment / cancel
workspace.comment-added / comment-saved / pending-comments / remove-comment
workspace.staged / title / refresh / loading-diff / execution-environment / commit-or-push / close-review
panels.label / summary.toggle / diff.wrap / source-control.op-pending ...
```

这些是**历史功能重构后的文案残留**：行级评论功能仍在（`review-comments.ts` 活跃），但其文案 key
已经换名，旧的 `workspace.comment-*` 系列没被清掉（`sidebar-rebuild-plan.md` Phase F 声称清理了死文案，
实际只清了一部分）。建议脚本化：构建期比对 `i18n.ts` 的 key 与 `t('...')` 调用，未引用的 key 报错。

---

### 🟠 I. 死 CSS

`plugins/desktop-sidebar/src/client/source-control.css:166` 里 `.oh-dsh-diff-view` 规则仍在，
但对应组件 `diff-view.tsx` 已在 Phase E 删除（新的是 `diff/diff-viewer.tsx` 的 `.oh-dsh-diff-viewer`）。
属死 CSS。类似地，`sidebar-architecture-analysis.md` 第 205 行已指出旧 `.oh-dsh-change-*` 网格行样式
与新 `.oh-dsh-sc-*` 重叠的风险。

---

### 🟡 J. 魔法常量重复（可能漂移）

`desktop-sidebar/src/sidebar-api.ts` 硬编码 `LIST_LIMIT=1000`、`READ_LIMIT=512*1024`、
`PREVIEW_LIMIT=2MB`、`READ_HEAD_LIMIT=4096`，与 `better-sidebar-runtime/src/config.ts` 里的
`listLimit=1000`、`readLimit=512*1024` 默认值**重复定义**。改一处不改另一处就会漂移。

---

### 🟡 K. 上游完整路由在 desktop 下是"死路由"

`better-sidebar-runtime/src/index.ts` 挂载的 `/sidebar/api`（完整版，含 pty/jobs/browser.probe 等）、
`/sidebar/file`、`/sidebar/html`、`/sidebar/bundle` 在 desktop 场景下**没有客户端消费**——
desktop client 只调自己 host 的 `/oh-dsh-desktop/sidebar/api`。真正被消费的只有：
- `/sidebar/ws/terminal` —— 被 `plugins/panel-controls/src/terminal/terminal-socket.ts:14` 连接
- settings 命名空间 —— 被 desktop host 复用（读写同一个 `SIDEBAR_PREFS_NS`）

其余是"上游完整功能"的保留。是否裁剪取决于"保留上游可升级性"与"砍维护面"的取舍，需显式决策。

---

### 🟡 L. 巨型文件（中间层/职责未拆的信号）

> 400 行的文件（上帝文件候选）：

```
1669 plugins/desktop-left-rail/src/client/WorkspaceBrowser.tsx
1118 plugins/plugin-marketplace/src/host/transaction-manager.ts
 897 plugins/better-sidebar-runtime/src/index.ts        ← apply() 塞进全部路由+pty+settings+工具
 819 src/main.ts
 806 plugins/desktop-sidebar/src/client/SideToolsPanel.tsx
 800 plugins/desktop-sidebar/src/client/plugin.tsx       ← 组装层 800 行
 647 plugins/desktop-sidebar/src/client/workspace-panel.tsx
 631 plugins/desktop-left-rail/src/client/tree.ts
 587 plugins/desktop-sidebar/src/client/surfaces/center-surface-store.ts
 527 plugins/desktop-sidebar/src/client/sidebar-service.ts
```

`better-sidebar-runtime/src/index.ts`（897 行）把 API 方法表、媒体路由、HTML 路由、bundle 路由、
两个 WebSocket、settings 门控、工具注册、pty 生命周期**全塞在一个 `apply()`** 里，是"中间层没拆"的重灾区。

---

### 🟡 L2. 插件注册三处不一致（`desktop-left-rail`）

`desktop-left-rail` 在四处的处理**互相对不上**：

| 位置 | 是否包含 left-rail |
|---|---|
| `cordis.patch.yml`（host 注册，slot 替换 ui-workspace） | ✅ |
| `scripts/build-config.mjs`（构建产物 index.js + client.js） | ✅ |
| `scripts/stage-dsh.mjs`（packages 部署列表） | ✅ |
| `scripts/stage-dsh.mjs`（required 产物校验列表） | ❌ 缺 |
| `src/profile.ts` 的 `BUNDLED_DESKTOP_CLIENT_PLUGINS` / `HOST_PLUGINS` | ❌ 缺 |

可能是有意为之（left-rail 走 `cordis.patch.yml` 的 slot 注入，不靠 profile bundle），但
`desktop-skins` 同样是 cordis.patch.yml 注册、却又出现在 profile.ts 里——两条注册路径并存，规则不统一。
建议明确：slot 注入的插件与 profile bundle 的插件到底各走哪条路，二选一。

### 🟡 M. 遗留兼容分支（有意保留，但需登记）

- `plugins/desktop-sidebar/src/client/source-control-tree.ts:197` —— 同时接受 prefixed key 与 bare key（legacy 存储条目）
- `plugins/desktop-sidebar/src/client/better-sidebar-api.ts:171` —— porcelain v1 的 `' '` XY 仍被接受（"legacy callers"）
- `plugins/panel-controls/src/terminal/panel-store.ts:223` —— `LEGACY_STORAGE_KEYS` 迁移旧 localStorage
- `plugins/plugin-marketplace/src/catalog.ts:83,168` —— `legacyRows()` 解析旧目录格式
- `plugins/plugin-marketplace/src/protocol.ts:167` —— `@deprecated` 兼容字段

这些是有意为之的向后兼容，本身不是 bug，但**没有统一的登记/移除期限**，容易变成永久包袱。

---

## 3. 辅助区域发现（src/scripts · 其余 5 插件 · tests/依赖）

> 以下三块由并行子代理审查：`src/` + `scripts/`、其余 5 个插件、`tests/` + 依赖元数据。

### src/ 与 scripts/（子代理审查结果）

- 🟠 `scripts/build.mjs:10` 向 `generatePluginStyles('desktop-left-rail', '[data-oh-dsh-left-rail]')` 传入第二参数，
  但 `plugin-styles.mjs` 的函数签名只有一个形参，第二参被**静默忽略**（疑似早期"作用域选择器"遗留）。
- 🟠 `scripts/dev.mjs:108` 的 `WATCH_ROOTS` 第三项 `plugins/better-sidebar-runtime/src` 已被第二项 `plugins`（recursive）覆盖，
  一次变更触发**两次重建排队**。
- 🟠 开发态热更新**不重新生成已提交的 `styles.ts`**：`plugins/desktop-left-rail/src/client/styles.ts` 是 `*.module.css` 的
  编译产物且已被 git 跟踪；`build.mjs` 构建前会重生成，但 `dev.mjs` 的增量重建从不跑它 → dev 下改 left-rail 的
  `.module.css` 不生效。
- ~~`scripts/dsh-source.d.mts`、`scripts/install-mac.d.mts`~~ **更正**：这两个是给 `.mjs` 提供类型的**必要声明文件**
  （TS 通过 `.d.mts ↔ .mjs` 文件名自动关联，`tests/dsh-source.test.ts` / `tests/install-mac.test.ts` 依赖它们），
  **不是死垫片**，删除会导致 TS7016。请勿删。
- 🟠 `src/client.ts:13-26` 与 `plugins/desktop-sidebar/src/client/client-types.ts:76-92` 各保留一份**重复的结构类型**
  （`WorkspaceView`/`WorkspacesService`/`ClientContext`），靠结构类型手抄对齐。
- 🟡 `src/client.ts:43-245` 的 DOM 适配层：`MutationObserver` 替换 DSH hero 文案、多层 selector 探测定位设置按钮、
  散落的 `rc.5` 版本号硬编码——为贴合官方 UI 打的脆性兼容层。
- 🟡 `src/marketplace-tools.ts`：`desktop_plugin_*` Agent 工具走 loopback HTTP → agent-gateway → 主进程 → manager 的
  **双传输绕圈**（UI 走 IPC、Agent 走 HTTP，两套共享同一 manager）；`credentialsFromEnvironment` 还会 `delete`
  用户传入的 env 对象（副作用，应改拷贝后删）。
- 🟡 `src/runtime.ts:44-54` 与 `scripts/smoke-runtime.mjs:107-119` **重复实现 lineReader**（缓冲 + 按 `\n` 拆行 + 去 `\r`），
  且重复同一条 `^dsh web: (http://127.0.0.1:\d+)` 就绪正则。
- 🟡 `scripts/smoke-runtime.mjs:200-210` 对已删除的 legacy 包（`dsh-web-terminal`/`@dsh-external/dsh-web-panel`/
  `@oh-dsh/desktop-shell`）做负向断言——历史遗留校验，仅此一处出现。
- 🟡 `scripts/build.mjs:6` 以 `import './check-sidebar-source.mjs'` **副作用方式**执行检查（该脚本不导出函数、
  纯靠模块顶层执行），应改显式导出 `verifySidebarSource()` 调用。

> 评价：`src/` 主进程（main.ts/runtime.ts/profile.ts/permissions.ts/runtime-paths.ts）职责清晰、几乎无死导出；
> 遗留集中在 **scripts 构建链路**（生成物入库不进 dev 流程、隐式副作用 import、死参数、硬编码绝对路径）和
> **client.ts 的 DOM 适配层 + 双份类型**。
### 其余 5 个插件（子代理审查结果）

- 🔴 **源码跨包相对 import 蔓延（结构化债务）**：这 5 个插件与 root 之间普遍用相对源码路径互引，
  绕开 `@oh-dsh/*` 包边界（各自 `package.json` 只暴露 `dist/*.js`）：
  - `plugins/pinned-summary/src/client.ts:6` → `../../panel-controls/src/client.ts`
  - `plugins/plugin-marketplace/src/client/plugin.tsx:9` → `../../../../src/contracts.ts`
  - 反向：root `src/client.ts:4-6` → 三个插件源码；`src/main.ts:30`、`src/contracts.ts:1` → `plugin-marketplace/src/protocol.ts`
  - `plugins/desktop-left-rail/src/client/worktree-api.ts:5` → 同族源码
  与我上文发现的 `desktop-sidebar → better-sidebar-runtime` 是**同一种耦合**，且范围更大。esbuild `bundle:true`
  让它们"能跑"，但包边界形同虚设。建议把跨插件类型（`DesktopPanels`/`PinnedSummary`/`MarketplaceCommand` 等）
  下沉 `shared`，双向源码 import 改 `@oh-dsh/*` 包名。
- 🔴 **重复实现 HTTP wire**：`desktop-left-rail/src/client/worktree-api.ts:13-27` 与
  `left-rail-settings.ts:8-37` 各写一份 `call()`（POST `/oh-dsh-desktop/sidebar/api/` + unwrap `{ok,error}`），
  与 `shared/sidebar-api.ts:128` 的 `callSidebarGlobalApi` **能力完全相同**。应统一改用 shared，删两份私有 `call`。
- 🟠 **`dsh.client.inject` 声明与实际消费不一致**：`panel-controls` / `pinned-summary` / `plugin-marketplace`
  的 client 代码都 `ctx.get('locale')`（panel-controls 还有 `sessions`/`layout`），但其 `dsh.client.inject`
  只写 `dsh-client-runtime`（未声明 `@deepseek-ai/dsh-client-locale`）。反观 `desktop-skins` 正确声明了 locale。
  建议三处补 `dsh-client-locale`。
- 🟠 **死代码 `pluginMarketplaceHost`**：`plugin-marketplace/src/index.ts:8,11-16` 里 `ctx.provide('pluginMarketplaceHost', ...)`
  提供 `{catalog, preview}`，但全仓无任何 `get` 消费者。
- 🟠 **兼容垫片 `allowBuildScripts` 双重回退（@deprecated）**：`protocol.ts:164-168,215-223` 标记 `@deprecated`，
  客户端已只发 `confirmations`，但 host 仍在 `transaction-manager.ts:615-617` 读 `command.allowBuildScripts === true`
  做回退，protocol 仍把布尔转成 `['allow-build-scripts']`。若确认无旧 renderer，可删 host 回退分支。
- 🟠 **兼容垫片 `LEGACY_STORAGE_KEYS`**：`panel-controls/src/terminal/panel-store.ts:36-40` 逐条回退读取
  旧上游插件（`dsh-external.dsh-web-panel/terminal`）存的面板状态。若不再兼容上游，可删。
- 🟠 **脆弱字符串协议**：`panel-controls/src/terminal/terminal-socket.ts:53-59` 用正则
  `/\[process exited with code (-?\d+)\]/` 从 PTY 字符流判断进程退出，而该标记是 runtime `index.ts:784,850`
  注入的**明文**。用户 shell 输出相同文本会被误判（仅靠末 256 字符缓解）。应改显式 `{type:'exit', code}` 控制帧。
- 🟡 **死代码 `terminal.toggle` 键**：`panel-controls/src/terminal/i18n.ts:21,45,68` 定义了但全模块无调用，
  真正的 toggle 入口在 desktop-sidebar（独立键）。
- 🟡 **死字段 `DesktopSkin.css`**：`desktop-skins/src/client/skins.ts:13` 定义 `css?: string`，
  `skin-dom.ts:29-31` 专门处理 `css === undefined` 分支，但 6 个皮肤**无一设置 css**，整条分支死。
- 🟡 **冗余 re-export**：`skin-controller.ts:8` 再导出 `ACTIVE_SKIN_KEY/FALLBACK_THEME_KEY`，无外部消费。
- 🟡 **过度导出 + 扩展名混用**：`desktop-left-rail/src/client/tree.ts` 的 `workspaceLabel`/`UNGROUPED_LABEL`/
  `DEFAULT_GROUP_ID` 仅内部用却 `export`；`styles.js` 与 `styles.ts` 同时被引用（WorkspaceBrowser.tsx:39 用 `.js`，
  index.ts:19 用 `.ts`），指向同一生成文件。
- 🟡 **图标系统重复**：`shared/icons.tsx`（inline SVG）与 `shared/tabler-icons.tsx`（Tabler）两套并存，
  多个图标**同名不同实现**（`IconPlus`/`IconChevronDown`/`IconRefresh`/`IconHistory`/`IconMinus`）。
  另 `icons.tsx:4` 注释称官方 primitives "NOT exposed"，但 left-rail 已成功 import 官方 primitives——
  注释与实际能力不符，应统一单图标源并更正注释。
- 🟡 **终端控制帧解析两端重复**：`terminal-socket.ts:51-66,87-94`（client）与 runtime
  `index.ts:788-817,854-888`（host 的 UI-tab 与 agent 两路）各写一遍同一套"非 JSON=输入 / resize / close"帧协议。
  建议抽共享帧编解码，host 两路 pump 合并。

> 总体：5 插件职责划分清晰、i18n/持久化自洽、theme token 走统一 `shared/theme.css`，无"换路由绕大圈"式调用链；
> 问题集中在**包边界形同虚设、wire 层重复、过渡期垫片未清理、极少数死导出**。
### tests/ 与依赖元数据（子代理审查结果，实跑 `node --test`：139 通过 / 0 失败 / 1 skipped）

**先报好消息**：本仓库**没有死测试**——27 个测试文件全部指向现存模块，全绿。任务预设的
`DetachedPanel` / `parse-unified-diff` / `diff-view` 已在之前的删除提交里**连同测试一起清掉**，无孤儿测试。
四个重点嫌疑依赖（`@pierre/diffs` / `zustand` / `prismjs` / `react-markdown`）**全部真实在用**，无未使用依赖。

仍发现以下问题：

- 🟠 `plugins/desktop-sidebar/src/client/source-control.css:148-269` 有约 **120 行孤儿 diff 样式**
  （`.oh-dsh-diff-view*` / `.oh-dsh-diff-hunk-header` / `.oh-dsh-diff-line*` / 配色块），来自已删除的
  `diff-view.tsx`；新组件用 `diff/diff-viewer.css` 的 `.oh-dsh-diff-viewer`，两者无交集，死样式随包发布。
  （本条补强了上文发现 I。）
- 🟠 `desktop-left-rail` 是**测试覆盖黑洞**：已由 `cordis.patch.yml` 装入发行版，但不在 `src/profile.ts` 清单，
  `tests/plugin-collection.test.ts` 只遍历 profile 清单、从不校验它，`tests/` 里也没有任何 left-rail 用例。
  （与上文发现 L2 是同一根因的两个表现。）
- 🟡 `scripts/build-windows.mjs` 是**孤儿脚本**：完整 Windows 打包器，但 `package.json` 无 `dist:win*` 命令、
  无 CI 引用；而 `build.win` 配置与 `win` 目标又存在，互相矛盾。
- 🟡 `plugins/desktop-sidebar/package.json:38-44` 的依赖分类**颠倒**：运行时被 esbuild bundle 的
  `zustand` / `@pierre/diffs` 放在 `devDependencies`，同样被 bundle 的 `prismjs` / `@types/prismjs` /
  `react-markdown` 却放在 `dependencies`。因 `private:true` 无功能影响，但方向互相矛盾。
- 🟡 `pnpm-workspace.yaml` 有两处重复/失效配置：`allowBuilds` 是 pnpm 11 不认的旧字段（与
  `onlyBuiltDependencies` 重复且被静默忽略）；`minimumReleaseAgeExclude` 与 `.npmrc` 重复。
- 🟡 `tests/dsh-source.test.ts:8-14` 对 `0.1.0-rc.5` 版本字符串**硬编码**，每升级 DSH 源就得改测试。
- 🟡 大量**字符串/正则快照式测试**（`desktop-chrome.test.ts`、`plugin.test.ts`、`right-panel-layout.test.ts`、
  `terminal-style.test.ts`、`plugin-marketplace.test.ts` 的 footer 段）直接 `assert.match` 源码文本/CSS；
  git `7981b38` 已显示这类测试在重构中被迫反复改——典型的"实现一改、测试跟着改仍绿"的失效风险源。
- 🟡 **覆盖缺口**：`better-sidebar-runtime` 的 14 个 host 模块（agent-pty/pty-manager/fs-tree/wire/tools/
  trust-fence/browser-probe/jobs-routes/index/config 等，仅 git.ts 有测）、`desktop-left-rail` 全部、
  `src/main.ts`/`preload.ts`/`contracts.ts`、desktop-sidebar 的 UI 渲染层（diff-viewer/pierre-adapter/
  content-viewer/settings/source-control-panel 等）**无单测**。
- ✅ 无构建产物残留：`dist/`/`.stage/`/`.cache/`/`.pnpm-store/`/`release/` 均在 `.gitignore`，`git ls-files`
  确认无任何被提交。tsconfig 无指向已删目录的冗余 include（`paths` 指向 `.cache/dsh-source` 属预期开发期通道）。

---

## 4. 改造建议（分优先级，均"先审查、后动手"）

| 优先级 | 事项 | 收益 |
|---|---|---|
| P0 | 合并两套偏好系统 + 把磁盘偏好 HTTP 样板抽到 `shared`（消 3 份复制） | 消最大冗余 + 消字段/默认值不一致 |
| P0 | `fs-tree`/`wire`/`prefs-shared` 下沉 `shared`，断掉**所有**跨包源码 import（desktop-sidebar→better-sidebar-runtime，以及 pinned-summary/marketplace/root 的互引） | 消最深架构耦合 + 消 SidebarError 多实例隐患 + 恢复包边界 |
| P0 | 修 `verify-skin-tokens.mjs` 硬编码绝对路径 | 修可移植性 bug |
| P0 | dev 态重新生成 `styles.ts`（或把生成物 `gitignore`），修"改 `.module.css` 不生效" | 修真实功能断裂 |
| P1 | 删 `git.ts` 兼容垫片（唯一消费者直接改指 `shared/git-core`） | 消残留垫片 |
| P1 | 统一 `readText`/`sameOrigin`/`sendJson`/`readJson` 到 `shared` 一份，left-rail 的私有 `call()` 改用 `callSidebarGlobalApi` | 消 4+ 份重复 |
| P1 | 终端退出改显式 `{type:'exit'}` 控制帧，抽共享帧编解码（host 两路 pump 合并） | 消脆弱字符串协议 + 消重复 |
| P1 | 裁掉/登记 vendored `client/` 1868 行死代码 | 砍维护面 |
| P1 | 脚本化清理死 i18n key + 死 CSS（含 `source-control.css` 120 行孤儿 diff 样式） | 消死代码 |
| P1 | `desktop-left-rail` 补入 profile 清单 + 补单测，消除覆盖黑洞 | 堵校验缺口 |
| P1 | 清理 scripts 冗余：`build.mjs` 死参数、`dev.mjs` WATCH_ROOTS 重复、`.d.mts` 死垫片、`build-windows.mjs` 孤儿、`import` 副作用 | 消构建链路残留 |
| P2 | 常量单一来源（`config.ts` 默认值唯一） | 防漂移 |
| P2 | 显式决策上游 `/sidebar/*` 死路由去留 | 消死路由 |
| P2 | 拆分 `index.ts`/`plugin.tsx`/`WorkspaceBrowser.tsx` 等巨型文件 | 提可读性 |
| P2 | 给遗留兼容分支加登记/移除期限 | 防永久包袱 |
| P2 | 收敛 `pnpm-workspace.yaml` 重复/失效配置、desktop-sidebar 依赖 dev/prod 分类、`dsh-source.test` 硬编码版本、快照式测试 | 消元数据/测试脆弱性 |
| P2 | 补 `panel-controls`/`pinned-summary`/`plugin-marketplace` 的 `dsh.client.inject` locale 声明；清 `pluginMarketplaceHost`/`terminal.toggle`/`DesktopSkin.css`/`skin-controller` re-export/`tree.ts` 过度导出等死代码；统一 `icons.tsx` 与 `tabler-icons.tsx` 图标源 | 消声明不一致 + 消死导出/重复图标 |

> **不建议**把 `better-sidebar-runtime` 和 `desktop-sidebar` 合并成一个 package：
> 前者是 vendored 上游（要追踪升级），后者是桌面自有产品（要独立演进），生命周期不同。
> 正确方向是**把公共能力继续下沉 `shared`**，让两者都变成 `shared` 的消费者。
