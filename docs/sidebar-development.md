# 侧边栏插件开发文档（面向 Agent 与人类开发者）

> 覆盖两个可分发包：`@oh-dsh/sidebar`（通用）与 `@oh-dsh/sidebar-desktop`（桌面增强），
> 及其宿主 `@oh-dsh/sidebar-host`、公共层 `@oh-dsh/shared`。
> 通用文档见 `docs/PLUGIN-DEVELOPMENT.md`（插件模型、bundle patch、host/client 身份）。

---

## 0. 四个包各是什么

| 包 | 目录 | 角色 | 依赖 Electron? |
|---|---|---|---|
| `@oh-dsh/sidebar` | `plugins/sidebar/` | 通用侧栏面板（文件树/Git/diff/终端/设置） | ❌ 不依赖 |
| `@oh-dsh/sidebar-host` | `plugins/sidebar-host/` | 通用 host（`/sidebar/api`、`/sidebar/ws/terminal`、settings 命名空间、agent 终端工具） | ❌ 不依赖（vendor 自上游 DSH-better-sidebar，见 VENDOR.md） |
| `@oh-dsh/sidebar-desktop` | `plugins/sidebar-desktop/` | 桌面增强（Electron `<webview>` 浏览器） | ✅ 依赖 |
| `@oh-dsh/shared` | `plugins/shared/` | 公共能力 + wire 契约 + UI 原语 + i18n | ❌ 不依赖 |

**依赖方向**：`sidebar` 与 `sidebar-host` 都消费 `shared`；`sidebar-desktop` 消费 `sidebar`
（通过 `ctx.get('desktopSidebar')` 拿服务，通过 `registerTab` 注入）。

---

## 1. 架构

### 1.1 host/client 分层与数据流

```
sidebar (client 面板)                          sidebar-host (host)
├── better-sidebar-api.ts ──POST /sidebar/api──► index.ts（buildApi 方法表）
│      (callSidebarApi / callSidebarGlobalApi)     ├── fs.tree / fs.read / fs.write
│                                                  ├── git.status / diff / stage / …
│                                                  ├── settings.get / update
│                                                  └── git.worktree-list / add
├── runtimes/（缓存层：RevisionedStore + GenerationGate + LRU）
├── sidebar-service.ts（tab/viewer 注册表 + 偏好）
└── surfaces/（中间 Tab store/host/renderers）
```

- **wire 契约**：`shared/sidebar-api.ts` 是唯一事实来源（envelope `{ok,value}/{ok,error}`、DTO、方法名）。
  host 实现方法、client 调用方法，改契约必须两侧同步（否则 build 失败）。
- **能力实现**：`shared/git-core.ts`（git 命令）、`shared/fs-tree.ts`（目录列举）、`shared/wire.ts`
  （错误/JSON 信封）——host 与 client 都从这里 import，**不再有插件间源码耦合**。

### 1.2 三个扩展点（增强包如何接入）

| 扩展点 | 位置 | 用途 |
|---|---|---|
| `sidebar.registerTab` | `sidebar-service.ts` 的 `DesktopSidebarService` | 注册侧栏 tab（`sidebar-desktop` 注入 `browser` tab） |
| `sidebar.registerViewer` | 同上 | 注册文件查看器（按扩展名/嗅探匹配） |
| `centerSurfaceRendererRegistry.register` | `surfaces/center-surface-host.tsx` | 注册中间 Tab renderer（`sidebar-desktop` 注入 `browser` surface） |

> 增强包的 `client/plugin.tsx` 通过 `ctx.get('desktopSidebar')` 拿到服务后调用这些扩展点，
> 通用 sidebar 自身不含任何 `<webview>`。

### 1.3 Electron 依赖的边界（哪些属于增强包）

- **增强包**：`<webview>` 浏览器（`sidebar-desktop/src/client/browser-view.tsx`）、
  `window.dshDesktop.chooseWorkspace()`（文件对话框）。
- **通用包**：`DesktopBridge` 类型在 `shared/desktop-contracts.ts`（纯契约，非 Electron）；
  调用点用 `window.dshDesktop?.xxx()` optional-chaining，非桌面环境自然降级。

---

## 2. 开发方式（常见任务分步）

### 2.1 新增一个侧栏 tab

1. 在 `plugins/sidebar/src/client/plugin.tsx` 的 `registerBuiltinSidebarTools` 里加
   `sidebar.registerTab({ id, title, render, icon, order, ... })`。
2. 若 tab 是 **Electron 专属**，改在 `plugins/sidebar-desktop/src/client/plugin.tsx` 里注册，
   复用 `ctx.get('desktopSidebar')`。
3. 文案 key 加进 `i18n.ts` 的 `WORKSPACE_MESSAGES`（见 3.4），并在 `settings.tools` 区可开关
   （`tabsEnabled` map）。

### 2.2 新增一个文件查看器

1. 在 `plugin.tsx` 调 `sidebar.registerViewer({ id, extensions, fetchStrategy, render, ... })`。
2. 若需要嗅探二进制头，实现 `detect(path, head)`。
3. 文案进 `viewersEnabled` 开关区。

### 2.3 新增一个 API 方法（host 侧）

1. `shared/sidebar-api.ts` 加 DTO 类型（如需）。
2. `plugins/sidebar-host/src/index.ts` 的 `buildApi` 返回表里加方法（`fs.*`/`git.*`/…）。
3. 若实现落在 `shared/git-core.ts` / `shared/fs-tree.ts`，先在那里加纯函数。
4. client 在 `better-sidebar-api.ts` 加封装（`callSidebarApi('xxx', scope, {...})`）。
5. `pnpm typecheck` + `pnpm test`（加单测到 `tests/`）。

### 2.4 新增一个设置项

- **host 要读的开关**（如 agent 终端工具）：进 `shared/prefs-shared.ts` 的 `SidebarPrefs` +
  `sidebar-host/config.ts` 的 `PrefsSchema`，client 用 `runtime-settings.ts` 读。
- **纯 client UI 偏好**（宽度/开关/sessions 布局）：进 `sidebar-preferences.ts` 的
  `DesktopSidebarPreferences`，走 `LocalStorageSidebarPreferencesStorage`。

---

## 3. 命名 / 编号规范

### 3.1 包名

| 概念 | 包名 | 规则 |
|---|---|---|
| 通用侧栏本体 | `@oh-dsh/sidebar` | 无 `desktop-` 前缀（已通用） |
| 通用 host | `@oh-dsh/sidebar-host` | 后缀 `-host` 表"服务端能力" |
| 桌面增强 | `@oh-dsh/sidebar-desktop` | `-desktop` 表"Electron 专属" |
| 公共层 | `@oh-dsh/shared` | 只放无 Electron 依赖的公共能力 |

### 3.2 目录结构（`plugins/sidebar/src/client/`）

```
client/
├── plugin.tsx            # 组装层（apply + 装配）
├── client.ts             # 入口导出
├── client-types.ts       # 结构类型 + window.dshDesktop 声明
├── sidebar-service.ts    # tab/viewer 注册表 + 偏好
├── sidebar-storage.ts    # localStorage 偏好持久化
├── better-sidebar-api.ts # /sidebar/api 客户端
├── i18n.ts               # 文案
├── source-control/       # Git 面板（panel/tree/view-model/css）
├── review/               # 提交审阅（comments/diff/types）
├── files/                # 文件查看（viewers/content-viewer/tree-model/highlight）
├── diff/                 # 统一 DiffViewer（@pierre/diffs）
├── runtimes/             # 缓存层（registry/explorer/source-control/file/chrome-store）
└── surfaces/             # 中间 Tab（store/host/renderers/types）
```

### 3.3 API 方法名（`/sidebar/api` 的 method）

- 分组前缀：`fs.*`（文件）、`git.*`（Git）、`settings.*`（偏好）、`session.*`、`pty.*`、`jobs.*`、`browser.*`。
- 动作动词：`list` / `read` / `write` / `stage` / `unstage` / `commit` / `checkout` / `discard`。
- 全局（无 session 绑定）用 `callSidebarGlobalApi`，会话绑定用 `callSidebarApi`。

### 3.4 i18n key

- 命名空间 `oh-dsh.sidebar`（`locale.bind('oh-dsh.sidebar')`）。
- 分组：`browser.*`、`workspace.*`、`source-control.*`、`settings.*`、`overlay.*`、`diff.*`、`panels.*`、`summary.*`。
- 删除功能时**连带删除对应 key**（避免死文案，见 `sidebar-code-audit.md` 发现 H）。

### 3.5 CSS 类名

- 前缀 `oh-dsh-` + 组件语义名：`oh-dsh-side-*`（面板壳）、`oh-dsh-sc-*`（source-control）、
  `oh-dsh-browser-*`（浏览器，增强包）、`oh-dsh-diff-*`（diff）。
- 间距用 token（`--oh-dsh-space-*`），不硬编码 px。

---

## 4. 构建与验证

```bash
pnpm run typecheck   # tsc（含 sidebar-host 独立 tsconfig）
pnpm run test        # node --test（139 用例）
pnpm run build       # esbuild 打包全部插件到 dist/plugins/*
pnpm run check:sidebar-source  # 校验 vendored host 存在 + 基线
```

> 改动 host 侧或 `shared/` 后，`sidebar` 与 `sidebar-desktop` 的 bundle 都会重打包；
> 改契约（`shared/sidebar-api.ts`）必须同步 host 实现与 client 调用。

---

## 5. 后续优化项（已知、未阻塞分发）

- `chooseWorkspace`：通用包目前仍 `window.dshDesktop?.chooseWorkspace()`（optional，非桌面无反应）；
  理想是增强包通过扩展点注入"文件对话框"，通用包默认手动输入路径。
- `sidebar-desktop/client.js`（976KB）因 import 了 `SideToolsPanel` 的 `ToolIcon` 而把面板代码重复打进
  增强包；后续把 `ToolIcon` 下沉到 `shared` 可瘦身。
- 两套图标（`shared/icons.tsx` inline SVG vs `shared/tabler-icons.tsx` Tabler）重名，待收敛。

---

## 6. 发布（独立分发）

> 分发单元是 npm 包，经 web profile 安装（官方 0811 形态）。当前本仓库是**一个 bundle**
> （根 `package.json#dsh.bundle.patch` → `cordis.patch.yml`）打包全部插件；拆分后按下列形态各自发布。

### 6.1 两个可分发单元

| 单元 | 组成 | 形态 |
|---|---|---|
| 通用侧栏 bundle | `@oh-dsh/sidebar` + `@oh-dsh/sidebar-host`（+ `@oh-dsh/shared`） | `dsh.bundle`（`cordis.patch.yml` insert 两行 host + client） |
| 桌面增强 bundle | `@oh-dsh/sidebar-desktop` | `dsh.bundle`（依赖通用 bundle，insert 自身 client） |

### 6.2 发布要点（后续执行）

1. 给 `plugins/sidebar/package.json` 加 `dsh.bundle.patch` → 自己的 `cordis.patch.yml`
   （`insert: oh-sidebar-host` + `insert: oh-sidebar`）。
2. 给 `plugins/sidebar-desktop/package.json` 加 `dsh.bundle.patch` → `cordis.patch.yml`
   （`insert: oh-sidebar-desktop`，依赖通用 bundle）。
3. 校验严格注入：每个 client 的 `inject` 声明其 `ctx.get` 的全部服务；`dsh.client.inject`
   声明其依赖的 DSH 模块（`@deepseek-ai/*` + 兄弟包）。
4. 安装验证：`dsh plugin --profile web add <包路径>` → 重启 web → boot log 干净。

> 执行发布前读 `make-dsh-plugin` skill 的 `references/bundle-plugins.md` 与
> `references/install-and-verify.md` 获取权威契约与验证步骤。
