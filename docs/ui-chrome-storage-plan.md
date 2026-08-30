# DSH Studio UI 状态统一存储 Plan(decision C 实施计划)

> 状态:已实施(implemented)· 2026-08-24
> 配套架构文档:`docs/persistence-architecture.md`(四层存储模型、归属决策表、decision B/C)。
> 本文件是 decision C 的**详细实施计划**:怎么把多个插件(左栏/右栏/中间 tab/钉子件)的持久
> UI 状态抽离进运行时官方领域存储(`storageDomain`),以及每个阶段做什么、怎么验收。

## 0. 决策摘要(已拍板)

1. **走 C**:统一 UI 状态存进 `storageDomain` 领域存储(`storages/dsh_studio_ui.json`),不再
   依赖浏览器 localStorage,也不往 `settings.yaml` 塞 chrome 状态。
2. **每表一个 key,存全量 DTO**:json 后端每次写都是整文件原子重写,细粒度 key 无写放大
   收益;每表一个记录、一次 hydrate、一次防抖写,与现有 `center_surfaces.v2` 文档同构。
3. **旧 localStorage 数据直接作废**:不读、不搬、不兼容、不双写。代码中删除旧 key 常量与
   读写路径,首次运行即按新存储默认值。
4. **面向最终架构,不留中间逻辑**:不引入过渡层、不做"既读旧又写新"的混合期;能力一次
   到位,演进只靠领域版本(zod 默认值)与 schema。
5. HTTP 层复用既有统一封装(`callCapabilitiesApi` / `callCapabilitiesGlobalApi`),新方法
   只扩展 `CapabilitiesApiRequests` DTO 表,不新写请求逻辑(已核实 client 插件 0 处手写 fetch)。

## 1. 目标架构(最终形态)

```
[浏览器插件 UI store]        zustand / defineStore(内存权威,瞬态)
        │  subscribe + hydrate
        ▼
[共享客户端 ChromeStorage]   @dsh-studio/shared/ui-chrome-storage.ts
        │  防抖 / 串行 / sanitize / 降级
        ▼
[/capabilities/api ui-chrome.*]   HTTP POST,复用 callCapabilitiesGlobalApi
        │  trust-fence + session 作用域
        ▼
[capabilities 宿主插件]      ctx.storageDomain.open(spec) → domain.table(ns)
        │  zod 强校验 · 持久化优先写 · domain/changed
        ▼
[dsh-storage-json 后端]      storages/dsh_studio_ui.json(原子整文件重写)
```

- **localStorage 层退役**:迁移完成后仓库内不再有 `dsh-studio.sidebar-preferences.v2` /
  `dsh-studio.center-surfaces.v2` / `dsh-studio.sidebar-chrome` /
  `dsh-studio.pinned-summary.open` / `dsh-studio.plugin-marketplace.open` 等读写代码。
- **settings.yaml 保持纯配置**:chrome 状态一律不进设置文档;`dsh-studio-left-rail` 只保留
  用户有意的配置切片(见 §3)。

## 2. 领域模型:`dsh_studio_ui` v1

一个 `defineDomain` spec、五张表、一个 json 文件;表名 = `/capabilities` 路由的 `ns`。

```ts
// capabilities 宿主侧(domain spec,记录 schema 用 zod)
defineDomain({
  name: 'dsh_studio_ui',
  version: 1,
  tables: {
    'left_rail_view':   domainTable(leftRailViewSchema),   // §2.1
    'center_surfaces':  domainTable(centerSurfacesSchema), // §2.2
    'sidebar_chrome':   domainTable(sidebarChromeSchema),  // §2.3
    'sidebar_layouts':  domainTable(sidebarLayoutsSchema), // §2.4
    flags:              domainTable(flagsSchema),          // §2.5
  },
})
```

每张表是**单一记录表**:路由层固定 key(不暴露 key 维度),读返回整条记录,写整条替换,
删即删除该表记录(`undefined` = 从未写入 → 客户端用默认值)。加字段靠 zod `.default()`
与客户端 sanitizer 的缺省回退,不产生兼容分支。

### 2.1 `left_rail_view` —— 左栏视图状态(从内存迁入)

```ts
// 只持久化"用户可再现的视图状态";sessionUpdatedAtByAccount(一次 promotion 的
// 观测时间戳)是运行期派生态,不持久化,挂载时重建。
{
  groupBy: 'workspace' | 'flat',
  orderBy: 'manual' | 'updated',
  groupExpansion: Record<string, boolean>,          // ws:/repo:/wt:/ungrouped 展开
  sessionOrder: Record<string, string[]>,           // order-account key → 有序会话 id
}
```

现状:`stores.ts` 的 `WorkspaceViewState` 里 `groupExpansion`/`sessionOrderByAccount`/
`groupBy`/`orderBy` 均为内存态。`activeTab`(当前选中分组)与 `projectGroup`/
`groupIds`/`groupLabels`/别名/图标/目录偏好**继续留在 settings** 不动(见 §3)。

### 2.2 `center_surfaces` —— 中间 tab 每项目打开集

```ts
{
  byCwd: Record<string, {
    activeId: string | null,
    open: Array<{           // 持久化投影:kind + 重建所需字段(与现 v4 文档同构)
      id: string, kind: 'conversation'|'file'|'diff'|'diff-all'|'commit'
         |'commit-file'|'committed'|'conflict'|'browser'|'terminal',
      title: string, cwd: string,
      filePath?: string, sessionId?: string, staged?: boolean,
      hash?: string, baseRef?: string, resource?: string,
      markdownPreview?: boolean,
    }>,
  }>,
}
```

实现:`center-surface-persistence.ts` 以 `byCwd` DTO 经领域存储 hydrate/save;
store 数据模型保持按 workspace 分桶,不再依赖浏览器 localStorage。

### 2.3 `sidebar_chrome` —— 右栏 chrome 态

```ts
{
  byScope: Record<string, {        // scopeKey = `sessionId:cwd`(沿用现状)
    explorer:    { expandedPaths: string[], selectedPath: string | null },
    sourceControl: { collapsedSections: string[], collapsedDirectories: string[],
                     selectedPath: string | null, commitMessage: string },
    gitListMode: 'tree' | 'flat',
  }>,
}
```

实现:`chrome-store.ts` 去掉 zustand `persist` 中间件;zustand 只做内存 store,
持久化由领域存储订阅层承担。

### 2.4 `sidebar_layouts` —— 右栏每项目布局

```ts
{
  defaultWidth: number,
  openByDefault: boolean,
  layoutScope: 'workspace' | 'global',
  centerPreviewTabs: 'default' | 'disabled',
  workspaces: Record<string, {   // cwd → 布局
    activeId: string | null, lastUsed: number, width?: number,
    tabs: Array<{ id, type, title, resource?, meta? }>,
    bottomTabs?: Array<{ id, type, title, resource?, meta? }>,
    bottomActiveId?: string | null,
  }>,
}
```

- 布局类字段(defaultWidth/openByDefault/layoutScope/centerPreviewTabs/workspaces)
  → 本表(domain)。
- **`tabsEnabled` / `viewersEnabled` 归位 settings**:"每 tab/viewer 类型开关"是用户
  偏好,由 `dsh-better-sidebar` settings 命名空间拥有,sidebar 经 `runtime-settings`
  读写;布局 DTO 不再携带这两个字段。旧开关值作废,默认全开(缺席即启用,语义不变)。

### 2.5 `flags` —— 面板开关布尔

```ts
{
  pinnedSummaryOpen: boolean,
  pluginMarketplaceOpen: boolean,
}
```

实现:`pinned-summary` 与 `plugin-marketplace` 共享 `flags` 表的全量 DTO;
两者通过共享 flags facade 更新各自字段。

## 3. 状态最终归属表(不许写错层)

| 状态 | 归属 | 说明 |
|---|---|---|
| `dsh-studio-left-rail` 配置切片:`projectGroup`/`groupIds`/`groupLabels`/`projectAlias`/`worktreeAlias`/`projectIconOverrides`/`activeTab`/`worktreeDir`/`nestWorktrees` | **settings(不动)** | 用户有意的配置;whole-section replace 表达删除 |
| 左栏 `groupBy`/`orderBy`/`groupExpansion`/`sessionOrder` | **domain `left_rail_view`** | 本次从内存迁入 |
| 中间 tab 每项目打开集 | **domain `center_surfaces`** | 按 workspace 持久化 |
| 右栏 chrome(展开/折叠/草稿/gitListMode) | **domain `sidebar_chrome`** | 按 scope 持久化 |
| 右栏布局(宽度/tab 队列/layoutScope/……) | **domain `sidebar_layouts`** | 按布局 DTO 持久化 |
| 右栏 `tabsEnabled`/`viewersEnabled` | **settings `dsh-better-sidebar`** | 用户开关,归位 settings(字段已存在) |
| pinned-summary / marketplace 开关 | **domain `flags`** | 共享 flags DTO 持久化 |
| `keymap.v1`(键位覆盖) | **后续归 settings** | 本期不改写路径(见 §9 开放问题) |
| diff 评论 | **后续归评论架构** | 与 `comment-architecture.md` 联动,本期不动 |
| 会话/工作区/终端历史 | **官方领域/官方文件,只读** | 不碰 |

## 4. 宿主端改造(plugins/capabilities)

1. **依赖**:`package.json` 的 `dshStudio.hostDependencies` 增加
   `@deepseek-ai/dsh-storage-domain` 与 `zod`(与既有 `@deepseek-ai/dsh-workspace` 同一
   机制,均属运行时冻结模块)。
2. **接线**(`src/index.ts`):新增内层 `ctx.inject(['storageDomain'], ...)`(镜像 settings
   缝的结法);其中 `ctx.effect` 内 `open(spec)` 拿 `Domain` 句柄,disposer 里 `close()`
   排水;暴露 `chromeFace = { get(ns), put(ns, value), delete(ns) }`。
3. **缺失回退**:`storageDomain` 未挂载 → `chromeFace = undefined` → 路由 503 → 客户端
   ChromeStorage 回落到内存态(与现状一致),**不做 localStorage 双写**。
4. **路由**(新 `src/routes/ui-chrome.ts`,入 `/capabilities/api` 路由表):
   - `ui-chrome.get {ns}` → `{ value? }`(记录或 undefined);
   - `ui-chrome.put {ns, value}` → 整条替换(src 为 zod parse 后值,失败 400);
   - `ui-chrome.delete {ns}` → 删除记录;
   - `ns` 必须命中国内声明的表名(白名单查表,防注入);走既有 fence 与错误信封。
5. **DTO 表**(`plugins/shared/contracts/capabilities-api.ts`):
   `CapabilitiesApiRequests` 增加三个方法名与请求类型;客户端经
   `callCapabilitiesGlobalApi` 调用,**不新增 fetch/解析代码**。

## 5. 客户端改造

### 5.1 共享客户端(新增 `@dsh-studio/shared/ui-chrome-storage.ts`)

```ts
const storage = createUiChromeStorage<T>({
  table: UiChromeTableName,       // 固定表名
  defaults: () => T,              // 缺失记录的默认值
  sanitize: (v: unknown) => T,    // 读取时收窄为合法 DTO
  debounceMs: 250,                // 防抖写
})

await storage.load()             // hydrate(不可用 → defaults)
storage.save(value)              // 防抖 + 串行写,失败保留待重试
await storage.flush()            // 立即冲刷并等待写链排空
storage.availability()           // 'available' | 'unavailable'
```

- hydrate 走 `ui-chrome.get`,缺失/损坏 → sanitizer 兜底默认值;
- put 每表 250–300ms 防抖(与现状节奏一致),串行队列防乱序;
- 503/不可用 → `available=false`,只写内存,不抛错。

### 5.2 表 DTO + sanitizer(新增 `@dsh-studio/shared/ui-chrome-tables.ts`)

每张表:表名字面量 + DTO 类型 + `sanitize`(手写 JSON 安全校验,风格同
`sanitizeLeftRailSettings`,shared 不引入 zod 以保持浏览器包轻量)。
host 的 zod schema 与 shared sanitizer 以契约测试保证同步(见 §8)。

### 5.3 各插件接入点

| 插件 | 改动 |
|---|---|
| `desktop-left-rail` | `WorkspaceBrowser.tsx`:`groupExpansion`/`sessionOrder` 由 ChromeStorage hydrate + 300ms 防抖 put;`retainAccountKeys` 保留(内存回收),数据源改为领域;其余 settings 切片逻辑不动 |
| `sidebar` | `center-surface-persistence.ts` 订阅领域存储(`center_surfaces`);`chrome-store.ts` 去掉 zustand persist,换领域订阅(`sidebar_chrome`);`sidebar-storage.ts` 保留为 `DomainSidebarPreferencesStorage`,布局写入 `sidebar_layouts`;`tabsEnabled`/`viewersEnabled` 改走 `runtime-settings` |
| `pinned-summary` | `service.ts` 开关读写改 ChromeStorage(`flags`) |
| `plugin-marketplace` | `client/plugin.tsx` 开关改 ChromeStorage(`flags`) |

### 5.4 已完成的 localStorage 清理

- 删除:`CENTER_SURFACES_STORAGE_KEY`、`chrome-store` persist `name`、`STORAGE_KEY`
  (sidebar-preferences v2)、`OPEN_KEY`(pinned-summary)、`OPEN_KEY`(marketplace);
- 不保留任何"读旧 key"逻辑;验证 `grep localStorage` 在待迁移插件中归零
  (`keymap.v1`、diff-comments 除外,见 §9)。

## 6. 数据策略(拍板:旧数据作废,不搬运)

- 旧 localStorage 数据**不读取、不复制、不转换**;首启即按新存储默认值。
- 领域演进只靠两条路径,不产生兼容分支:
  - 加字段:zod `.default()` + sanitizer 缺省回退(旧记录自动补齐);
  - 破坏性变更:domain `version` 自增 + host 一次性迁移函数(未来才可能出现)。
- 无过渡期、无双写、无"既读旧又写新"。

## 7. 分期里程碑(依赖排序)

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M1 底座** | shared `ui-chrome-storage` + `ui-chrome-tables`;host deps/inject/domain/routes/DTO;左栏 `left_rail_view` 落地 | 已验证:左栏状态可写入 domain;settings 未新增 chrome 键;契约测试通过 |
| **M2 中间 tab** | `center_surfaces` 使用领域存储 | 已验证:按 workspace 恢复打开集;无旧 center localStorage 读写 |
| **M3 右栏** | `sidebar_chrome`、`sidebar_layouts` 使用领域存储;`tabsEnabled`/`viewersEnabled` 归位 settings | 已验证:布局/chrome 可恢复;开关经 settings 生效 |
| **M4 钉子件** | `flags` 由 pinned-summary/marketplace 共享 facade 使用 | 已验证: marketplace flag 写入 domain;无旧 flags localStorage 读写 |
| **M5 收尾** | 文档同步、全量验证、DEV 桌面 smoke | 已完成: typecheck、617 项通过/2 项跳过、build、DEV smoke |

每期独立可合并、可回滚;M1 先验证 `storageDomain` 在 web 面的可用性(见 §9)。

## 8. 测试

- **路由契约**:`ui-chrome.*` 与 `CapabilitiesApiRequests` DTO 对齐、错误信封(code/message)、
  ns 白名单拒绝(仿现有 settings 路由测试);
- **领域 spec**:表名/version/命名合法性、zod 解析、缺失记录默认值;
- **sanitizer 同步**:host zod schema 与 shared sanitizer 对同一批样本给出等价结果
  (契约测试,思路同既有 settings sanitizer 测试);
- **行为测试**:左栏展开顺序 hydrate/save 往返、center_surfaces 打开集往返、
  flags 开关往返(纯函数 seam 处断言,不 grep 源码字符串);
- **废弃守卫**:迁移后 `grep -rn "localStorage"` 指定插件目录(除 keymap/comments)为空。

## 9. 风险与开放问题

1. **storageDomain 在 web 面可用性**:数据根共享、workspace 注册表在 web 面也运行,预期
   可用;M1 用探针测试确认,不可用则 web 面保持内存降级(桌面不受影响)。
2. **`tabsEnabled`/`viewersEnabled` 归属已完成**:settings schema 与 `runtime-settings`
   共同拥有开关;布局 DTO 不再携带这两个字段,旧开关值作废。Settings 页渲染
   (`settings.tsx`)直接消费 settings 快照。
3. **`domain/changed` 推送本期不做**:跨表面实时同步(多窗口)靠 hydrate;如需要,后续在
   宿主加推送通道,不在本期引入。
4. **`keymap.v1` 与 diff 评论本期不动**:各自有明确的后续归属(keymap→settings 用户配置;
   diff 评论→`comment-architecture.md` 定稿后)。它们仍是 localStorage,但不属于本计划
   的作废范围,避免范围爆炸与评论架构抢跑。
5. **数据量**:每表整 DTO 原子重写,单文件 KB 级、防抖限频,无性能风险(与现状同等量级)。

## 10. 配套文档

- `docs/persistence-architecture.md` 已同步 decision C 的实际领域名、表名和退役范围。

- 本文件在 M5 完成后保留为已实施记录;后续 schema 演进只更新领域版本与契约。