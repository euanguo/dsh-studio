# DSH Studio 持久化架构

> 本文件被源码多处注释引用(`docs/persistence-architecture.md`,`decision B`、存储边界),此前一直缺失,
> 现补齐。它回答两个问题:
>
> 1. 运行时官方暴露了哪些持久化能力,各自落在哪、语义是什么;
> 2. **什么数据进什么层**——特别是哪些数据**禁止**写进 `settings.yaml`。
>
> 目标是让后续实现(如 decision C 的通用 UI 存储)有据可依,不再"做着做着又把
> 状态塞进设置文件"。

## 1. 数据根与总览

- 共享状态根:`~/.dsh-studio`(稳定通道)/ `~/.dsh-studio-dev`(开发通道)。
- `DSH_STUDIO_HOME` 绝对覆盖,`DSH_STUDIO_CHANNEL` 选通道;单源定义在
  `src/data-root.ts` 与 `@dsh-studio/shared/data-root-names`(AGENTS.md: 禁止再造数据根)。
- Electron userData 经 `desktopElectronDataRoot()` 钉死在 `{dataRoot}/desktop`,Chromium
  缓存/存储不泄漏到系统默认位置(`src/data-root.ts`)。

所有栏位插件(左栏 `desktop-left-rail`、右栏 `sidebar`、中栏 `center-surface`、
`pinned-summary`、`plugin-marketplace`、`desktop-skins`)的持久数据都在这一个数据根之下,
分四个持久化层,见下。

## 2. 官方暴露的持久化能力(按层)

### 2.1 层 1:settings 命名空间 → `settings.yaml`

| 项 | 值 |
|---|---|
| 组件 | `@deepseek-ai/dsh-settings` + `@deepseek-ai/dsh-settings-file` |
| 落盘 | `<dataRoot>/settings.yaml`,每次提交**整段原子重写**(temp + fsync + rename,文件锁,watcher 外部编辑热载) |
| 能力 | 任意 `^[a-z][a-z0-9-]*$` 命名空间;`register(ns, schema)` 获得默认值/校验/设置页渲染;`get / update / replace / mutate` + `expectedRevision` 乐观锁(409);**replace 才能表达删除** |
| 宿主接线 | `plugins/capabilities/src/index.ts` 注册 schema;`/capabilities/api settings.*` 路由(`routes/settings.ts`)走同一 trust-fence;运行时 RPC 域(api-proxy)只服务白名单,插件命名空间经自有 fenced 路由 |
| 读写方 | 浏览器插件经 `/capabilities/api`;托管进程直接 `sctx.settings` |

**适合**:用户可感知的偏好/开关/配置(主题、语言、权限预设、模型选择、分组映射、别名、图标、目录偏好、终端字体等)。
**不适合**:高频变化的 UI 瞬态(展开/折叠、拖拽顺序、面板宽度)——见 §3。

已用命名空间(本仓库):`dsh-studio-left-rail`(左栏视图切片)、`dsh-better-sidebar`(右栏功能偏好)、
`source-control-ai`;官方: `ui-theme`、`locale`、`permission`、`agent-default-model`、`ui-conversation`、
`agent-presets`、`llm-pi-ai` 等。

### 2.2 层 2:storageDomain 领域存储 → `storages/<domain>.json`(官方通用 KV)

| 项 | 值 |
|---|---|
| 组件 | `@deepseek-ai/dsh-storage`(hub `ctx.storage`)+ `@deepseek-ai/dsh-storage-domain`(facility `ctx.storageDomain`)+ `@deepseek-ai/dsh-storage-json`(backend `json`) |
| 落盘 | `<dataRoot>/storages/<domain>.json`,格式 `{ unit:{name,version}, global, tables }`;每次写**整文件原子重写**(temp + fsync + rename + POSIX 目录 fsync);读回做 version 校验(`version-mismatch` 拒绝)和 shape 校验(`malformed-medium`) |
| 能力 | `defineDomain({ name, version, tables, global? })`;表值为 **zod 强校验**;领域版本化迁移;读同步(内存权威)、写异步串行(单域写链);**持久化优先**(先落盘 → 改内存 → 发 `domain/changed` 事件,失败不改内存);`open/close` 生命周期,单写者 |
| 表操作 | `domain.table(n).get/put/delete/update/entries/keys/size`;`domain.global.get/set` |
| 命名约束 | 领域/表名 `^[a-z][a-z0-9_]*$`;global schema 不得接受 `null`(null 是"从未写入"哨兵) |
| 官方使用 | `workspace`(→ `workspace.json`)、`session_projcache`(→ `session_projcache.json`)——插件对这些只读/只经官方 API |

**适合**:任何持久的、结构化的、需要强校验与版本迁移动力的数据——尤其是**插件 UI chrome 状态**。
**这是本仓库"通用 UI 存储"的目标层(decision C)**,见 §4。

### 2.3 层 3:dataRoot 自有文件 + fenced 路由(宿主插件文件存储)

- 模式:宿主插件读取 `dshStudioSurface.dataRoot`(== `DSH_STUDIO_DESKTOP_APP_DATA` == 数据根,
  `src/plugin.ts` + `plugins/shared/surface.ts`),在自有子目录/文件写 JSON,经 `webServer`
  注册同名源 HTTP 路由(GET/PUT)供浏览器端读写。
- 先例:
  - `desktop-skins.json` —— `plugins/desktop-skins/src/preferences-server.ts`(temp+rename 原子写,0600,同源校验);
  - `plugin-marketplace/catalog-cache.json`、`rollbacks/`、`previews/`、`gitconfig` —— `plugins/plugin-marketplace/src/host/platform.ts`;
  - `terminal-sessions/sessions.json` —— `plugins/capabilities/src/terminal/terminal-session-store.ts`;
  - `environment-cache.json` —— `src/main.ts` / `src/user-environment-cache.ts`。
- **适合**:宿主插件自有格式的整文件数据、大 blob、与官方领域无关的介质。
- **注意**:这是"模式"而非共享库——每个用家手撸原子写 + 路由;重复超过两处时应抽
  `@dsh-studio/shared` 工具(如 `host-json-store`)。

### 2.4 层 4:localStorage(浏览器插件 UI 会话态)

- 落点:`{dataRoot}/desktop/Local Storage/leveldb`(Electron userData)。
- 本计划范围内的 chrome key 已全部退役;仍保留的明确后续范围是
  `dsh-studio.sidebar.diff-comments.v2` 与 `dsh-studio.keymap.v1`。
- **适合**:无宿主进程的浏览器插件 UI 瞬态;**定位是"每浏览器会话态"**,不跨浏览器/不跨表面。
- **边界**:只保留尚未纳入官方领域/设置归属的功能;新的持久 UI chrome 必须先进入
  `dsh_studio_ui` 领域设计。

### 2.5 不该用的口子

| 口子 | 为什么不用 |
|---|---|
| `dsh-spill` / `dsh-spill-local` | Agent 工具输出暂存,会话作用域,语义不对 |
| `dsh-attachment` / `-local` | 用户附件 + 图片处理管线 |
| `dsh-fs` / `dsh-fs-local` | AGENTS.md 限定只能访问活动 **Session/Workspace**,不允许写数据根 |
| `dsh-credentials-local` | 密钥专用;读了会污染 redact 语义 |
| Chromium 缓存区(`Cache`/`GPUCache`/`Session Storage`/`blob_storage`) | 缓存不是数据,随时可清 |

### 2.6 官方领域数据(只读)

`storages/workspace.json`、`storages/session_projcache.json`、`sessions/*.jsonl`、
`terminal-sessions/`、`.credentials.yaml` 归属运行时能力,插件**不得直写**,只经官方 API
(`workspaceRegistry`、会话持久化、`dsh-credentials` 等)。

## 3. 归属决策表(防误写,核心)

原则:**用户有意的配置 → 层 1;持久 UI 状态 → 层 2(过渡期层 4);宿主自有整文件 → 层 3;
瞬态 → 内存。** 禁止把前者的实现写进后者的介质。

| 数据类别 | 层 | 理由 / 反例 |
|---|---|---|
| 功能开关、偏好、模型、权限、语言、主题 | 1 | 用户可感知,需跨浏览器/表面同步 |
| 左栏分组映射、别名、图标覆盖、目录偏好 | 1 | 用户**有意**的配置切片(`dsh-studio-left-rail`);走 whole-section replace 表达删除 |
| **展开/折叠状态、拖拽顺序、面板宽度、打开集、commit 草稿** | **2** | UI chrome,非用户配置;**禁止进层 1**——统一写入 `dsh_studio_ui` 领域 |
| 市场目录缓存、皮肤、终端历史、环境缓存 | 3 | 宿主自有格式整文件 |
| 会话内存态、实时 PTY | 内存 | 瞬态;历史分别进 `sessions/`、`terminal-sessions/` |
| 密钥 | credentials | 不进 settings(redact 场景) |

> **红线(写代码前必读)**:`dsh-studio-left-rail` 命名空间只保留"用户有意的配置切片",
> 不接纳展开/顺序等 chrome 字段。chrome 的去处是层 2 领域,不是 layer 1 的设置文档。

## 4. 决策记录

### decision B(已落地,本文件补齐说明)

左栏视图切片从 `dsh-better-sidebar` 合并段迁出到独立命名空间 `dsh-studio-left-rail`
(`plugins/shared/left-rail-preferences.ts` + `plugins/capabilities/src/left-rail-settings-migration.ts`,
迁移幂等、restart-safe、每次启动检查一次)。原因:合并段无自有 schema/版本、merge 无法表达删除;
目标命名空间用 versioned DTO + whole-section `replace`,**删除能持久化**。文档引用:左栏客户端
`left-rail-settings.ts`、宿主 `index.ts`。

### decision C(已实施)

**目标**:浏览器插件(左栏/右栏/中栏)的持久 UI chrome 状态统一进官方领域存储,不再散落
localStorage 与设置文档。

- **领域**:`dsh_studio_ui`,version 1,backend `json`,文件为 `storages/dsh_studio_ui.json`。
  - 五张表固定使用 `state` 记录:`left_rail_view`、`center_surfaces`、`sidebar_chrome`、`sidebar_layouts`、`flags`。


  - 整 DTO 单 key 与 json 后端的整文件原子写一致,客户端按表 hydrate、防抖和串行写入;
    字段演进依靠 zod 默认值与领域版本。
- **宿主接线**(`plugins/capabilities`):
  - `storageDomain` 注入并打开 `UI_CHROME_DOMAIN`,插件生命周期关闭 domain;
  - `ui-chrome.get/put/delete` 复用 capabilities API 封装,只接受固定表白名单;
  - **缺失回退**:`storageDomain` 不可用 → 路由 503 → 客户端保持内存态,不双写。
- **客户端**:左栏视图、中间 surfaces、右栏 chrome/layouts 和 flags 均通过
  `@dsh-studio/shared/ui-chrome-storage`; `tabsEnabled`/`viewersEnabled` 只经
  `dsh-better-sidebar` settings 的 `runtime-settings` 读写。
- **旧数据策略**:本计划范围内旧 localStorage 数据直接作废,不读取、不搬运、不兼容、不双写。
  仅 `keymap.v1` 与 diff comments 保留在各自后续架构范围内。

## 5. 附录:磁盘速查

| 路径(相对数据根) | 内容 | 维护者 |
|---|---|---|
| `settings.yaml` | 层 1 全部命名空间 | dsh-settings-file(官方) |
| `storages/workspace.json`、`session_projcache.json` | 官方领域 | dsh-workspace / dsh-session-projection-cache(官方) |
| `storages/dsh_studio_ui.json` | 本仓库 UI chrome 领域 | capabilities + `@dsh-studio/*` |
| `desktop-skins.json` | 皮肤偏好 | desktop-skins |
| `plugin-marketplace/` | 目录缓存/回滚/预览 | plugin-marketplace |
| `terminal-sessions/sessions.json` | 终端会话历史 | capabilities |
| `sessions/` | 会话 JSONL | 官方会话持久化 |
| `environment-cache.json` | 用户环境缓存 | src |
| `.credentials.yaml` | 密钥 | dsh-credentials-local(官方) |
| `desktop/Local Storage` | 层 4 浏览器 UI 态(过渡) | 各浏览器插件 |
| `worktrees/` | 默认 linked worktree 存储根 | capabilities(`worktreeDir` 可覆盖) |