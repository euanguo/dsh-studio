# DSH Studio 结构重构 · 目标架构（kernel-refactor）

> 状态：计划阶段产物，revision 3（已与近期提交 `7514a69..9efaadf` 对账）。
> 本文档是 `plans/kernel-refactor/` 执行包的架构基准。
> 前序：`.unlazy/deep-refactor/`（findings 收敛轮，ROOT ALL MET）已完成逐条修复；
> 近期提交又落地了 comments 单写者、严格 hydration、git freshness push、marketplace
> push 顺序保护等能力，本轮只规划**尚未完成的结构收口**，不重做这些能力。
> 执行框架：unlazy orchestrated mode；执行入口见 [README.md](README.md)。

---

## 0. 目标与非目标

**目标**：一次性完成到最终干净形态——五服务 Workbench 内核、桌面壳生命周期状态机、
市场事务显式相位机、依赖事实单一来源、卫生收尾。完成后，新功能只需"注册 descriptor +
调 pipeline.open + 声明 scope"，不再需要懂任何历史补丁。

**非目标（显式放弃，防止范围蔓延）**：

- 中央 i18n 键表 / 抽取管线（引擎已统一，只补类型纪律）；
- any 全清零（vendor 声明豁免）；121 个 dead-export 逐个找消费者（tests-only 引用判活即可）;
- S1/S6 的静态正则守卫（误报率高，属评审纪律，留 spec 与人工门）;
- tests/ 目录重组；minified patch 的本仓运行时覆写（证据不足，走上游提案路线，见 leaf-4.3）。

## 0.1 近期提交已落地的基线（执行时不得重复实现）

| 提交 | 已落地能力 | 对本轮计划的约束 |
|---|---|---|
| `7514a69` | ui-chrome schema 递归派生已收口到 `capabilities/src/ui-chrome-schemas.ts`，host 与共享 descriptors 同源 | StateStore 直接消费现有 schema/descriptor；禁止再建第二套 zod/domain schema builder |
| `05f6543` | source-control 未变化轮次保留 history/branch，顶层 gitStatus 失败传播为 error | WorkspaceEvents/OpenPipeline 迁移不得改回空列表 fallback；保留现有回归测试 |
| `377d0b1` | GitWatchCoordinator + `/capabilities/ws/git-watch` + 客户端断线 fallback | Git freshness 是独立领域事件，不并入 WorkspaceEvents；WorkspaceEvents 只管 workspace/session 身份切换 |
| `5928e82`、`ed194ce` | 桌面品牌行隐藏、traffic-light clearance、rail toggle selector 已落地 | client CSS 抽取必须保留稳定 selector、`--dsh-studio-traffic-top` 和 dsh-dom label 语义 |
| `674392f` | persisted width 与 live viewport cap 分离：持久化上限 4096，live 取 viewport 75% | LayoutService 不接管 `clampPersistedWidth`/`clampSidebarWidth`；它只协商最终 footprint |
| `1b75b96`、`1c88b8d` | `comments-record.ts` 单写者、`loadStrict`/retry、flags sentinel merge、center persistence per-mount facade、review hydration 保留内存、顶层 gitStatus error | comments-record 是现有 canonical owner；StateStore 只能接入/补 scope 与 persistVia，不得再造 comments wrapper 或双写者 |
| `7595452` | left-rail chrome hydration 失败时禁止 save-back | left-rail 并轨必须保留 `loadStrict` 与 `chromeHydrated` 保护，不得用默认值覆盖 host |
| `9efaadf` | marketplace push snapshot 使用 monotonic token，旧异步 getSnapshot 不得覆盖新 push | 市场叶子只做 host phase/reconcile/error 语义；客户端 push 顺序保护只做回归测试 |
| `af143f1`、`d96dac5` | root-level file operation refresh 修复、官方 wrapper Input 的 Files 输入样式修复 | OpenPipeline/files 迁移必须保留 root refresh 与 wrapper-level CSS，不以“重写 files surface”为借口回退 |
| `c79b516`、`c848106` | marketplace client 已拆成 store/view/filter/notices，并修复 global class 与 busy push 语义 | 不再规划 marketplace client 大拆分；市场叶子只改 host transaction 与必要的行为测试 |

这些提交已经是当前 baseline。执行 kickoff 仍需重新跑门禁，但不应把它们再次拆成
新的兼容层或重复抽象。

## 1. 硬约束（每个叶子的完成定义都受其约束）

1. **无增容层军规**：禁止为通过阶段性类型检查/测试而留下兼容层、中间层、re-export shim、
   deprecated 别名、"保留退役名字的包装"。每个迁移叶子原子地完成：
   **新 API 落地 → 全部消费方直迁 → 旧路径删除 → 测试重写为测新行为**。
   中间波次允许服务先于消费方存在（有单元测试背书），但分支集成门禁止在旧路径未清零时
   向下游推进（由 `legacy-specs/*.json` 清零规格强制）。
2. **用户数据迁移例外且仅限数据**：持久化格式的 v(n)→v(n+1) 迁移必须幂等、非破坏、
   重启安全、崩溃安全（AGENTS.md 硬约束）。代码层不因迁移保留双读双写通道。
3. **单一事实源**：同一事实只允许一个可写点。清单类事实（插件清单/注入表/externals）
   允许"生成物 + 对拍 guard"两份物理存在，但写点唯一。
4. **平台契约不变**：DSH 注入协议、capabilities wire DTO、ui-chrome/settings/nodeFs
   三域后端、`~/.dsh-studio(-dev)` 数据根边界不动。内核是这些契约上的收敛层，不是替代层。
5. **官方 chrome 不动摇**：UI 复合件继续只用 `@deepseek-ai/dsh-client-ui-primitives`
   原子 + `--dsw-*` token；跨插件值导入继续禁止，一切经 ctx 服务注入。

## 2. 目标总览

```
dsh-studio CLI ──► AppController(src/app-controller.ts) 显式生命周期状态机
                     ├─ windows.ts / menu.ts / ipc.ts / runtime-options.ts
                     ├─ desktop-identity.ts（身份/文案单一源）
                     └─ DshRuntimeSupervisor（就绪=stdout URL + HTTP 确认 + SIGKILL 升级）
                            │ spawn pinned DSH runtime（npm 钉版 + cordis Profile/Loader）
                            ▼
        ┌──────────────────────── 客户端插件图 ────────────────────────┐
        │  @dsh-studio/workbench（纯 cordis 服务插件，本轮新增）         │
        │    SurfaceRegistry · OpenPipeline · LayoutService            │
        │    ScopeService+StateStore · WorkspaceEvents                 │
        │  sidebar / left-rail / panel-controls / pinned-summary /     │
        │  skins / marketplace —— 一律经 ctx 消费五服务                │
        │  capabilities（host 能力网关，wire DTO 不变）                 │
        └──────────────────────────────────────────────────────────────┘
                            ▼
        config/dsh-dependencies.json（依赖事实单一源）
          → 生成/对拍 dsh-source.json · inject · externals · tsconfig seeds
```

## 3. Track A：Workbench 内核（`plugins/workbench/`，新增纯 cordis 服务插件）

### 3.1 SurfaceRegistry —— 唯一 surface 描述符表

吸收现状三套互不知晓的注册（调研 A 表3）：`SidebarTabDescriptor`（contract.ts:221-270）、
`SidebarViewerDescriptor`（contract.ts:326-349）、`CenterSurfaceKind` 十类枚举 +
registerSurfaceRenderer（surfaces/types.ts:11-21, builtins/surfaces.tsx:32-62）。

```ts
interface SurfaceDescriptor {
  kind: string                       // 'file' | 'diff' | 'browser' | 'terminal' | ...
  rail?: RailSpec                    // 右栏 chip：icon/order/single/dedupeKey/settings
  center?: CenterSpec                // 中央 tab：renderer 注册 + viewer 关联
  viewer?: ViewerSpec                // exts/priority/detect/fetchStrategy（file 类专用）
  scopeNeed: 'workspace' | 'session' | null
  previewable: boolean               // rail 恒 false（workbench-contracts 已裁决）
  focusPolicy: 'never' | 'on-explicit'
}
// registry.register(descriptor) 取代 registerTab/registerViewer/registerSurfaceRenderer 三口
```

**删除物**：三套注册 API 及其重复字段；`resolveOpenPlan` 保留为纯决策核
（shared/workbench-contracts.ts 不动语义），registry/pipeline 是它唯一的调用方封装。

### 3.2 OpenPipeline —— 唯一打开入口

统一现状 13 类打开入口（调研 A 表1）。API：

```ts
open(request: { kind: string; target: OpenTarget; intent?: OpenIntent }): void
// intent: 'preview' | 'pin' | 'background'（复用现有 workbench-contracts 类型）
```

- 内部：descriptor 解析 → `resolveOpenPlan` 区域/intent 裁决 → dedupeKey 查重 →
  FocusPolicy 执行（激活≠聚焦，焦点不变式成文于 contracts）→ 渲染分派。
- **openPath 劫持收编为一处实现而非删除能力**：`intercept.ts` 的 refcount 弱映射补丁
  （intercept.ts:36-65）整体移入 pipeline 的 `installOfficialOpenHook()`，HMR 幂等
  （重复 install 先 restore），左栏 open-directory（action-dispatcher.ts:87,167）自动获得
  同一 intent 语义。外链 claim（intercept.ts:110-128）并入 pipeline linkHandler 注册表。
- **删除物**：`openFileSurface/openDiff*/openDiffAll/openCommit*` 六个散装签名及其
  `{cwd,title,intent,preview}` 样板（workspace-panel-loading.ts:297-355 等）、side-tabs
  手工 find-existing（side-tabs.tsx:56-62）、中央"+"菜单直调分支
  （center-surface-add-menu.tsx:46-100）、marketplace body-append 旁路打开
  （marketplace-view.tsx:200-204 改经 overlay 区 + pipeline）。
- store 只接收 plan 结果，`preview` 布尔不再出现在 pipeline 边界之外。

### 3.3 LayoutService —— 区域所有权与几何

五区模型（调研 A 设计输入 b）：`top-rail` / `left-rail` / `right-panel` / `center-tabs` /
`overlay`，附一张**声明式 z-index 层级表**取代注释约定
（side-tools.module.css:755-764 的 2147483647、selection-insert 200、summary 9000 等）。

- right-panel footprint：现 `claimRightPanel` 协调器（panel-controls terminal/plugin.tsx:76-134，
  写 `#root` padding-right + data 旗标）与三个写手（workspace-tools.tsx:426-434/248、
  pinned-summary service.ts:209-214/185）全部改为 `layout.claim(region, footprint)` /
  `release` / `preview(width)` 协商；`#root` DOM 写入只剩 LayoutService 一处。
- html dataset/CSS 变量旗标（`--dsh-studio-sidebar-width`、5 个 data 旗标、
  `--dsh-studio-center-col-height`）归 LayoutService 单点 set；消费方只读。
- pinned-summary `<head><style>` + body append（service.ts:138-160）改经 overlay 区挂载
  协议（挂载/卸载顺序由区域宿主保证）；marketplace root 同。
- 宽度协调与宽度策略分离：`sidebar-preferences.ts`/`DesktopSidebarService` 继续拥有
  `clampPersistedWidth`（文档上限 4096）与 `clampSidebarWidth`（live viewport 75%）
  这组 sidebar domain policy；LayoutService 只接收最终有效宽度并协商 right-panel
  footprint，不复制或接管 clamp 规则。宽度偏好的持久化通道可接入 StateStore，但
  不把 sidebar domain policy 再包一层。

### 3.4 ScopeService + StateStore —— 统一保留态层

- `ScopeKey = workspace(cwd) | session | global`（沿用 resolveScopeBucket 语义）。
- StateStore slice：`defineStateSlice({ table, scope, version, migrate })`，底层仍是
  persistVia 门面 → ui-chrome 表 / settings 命名空间（渲染进官方设置页的偏好留在 settings 域）。
  **单写者原则**：一张表一个 slice owner。
- **comments 的现有 owner 不再重造**：`plugins/shared/comments-record.ts` 已经是整张
  comments 记录的唯一 owner，并由 `putWorkbenchComments`/`putReviewComments` 保全另一半。
  StateStore 的实现必须直接让这个模块成为 comments slice（或将其逻辑原子地吸收进去并
  删除旧模块），不能再在 diff/review 两边或 workbench 插件里包一层新的 record facade。
  后续只解决三件剩余问题：comments 的 scope/version 迁移、统一 `persistVia` 后端语义、
  sanitize 与运行时上限的一致性。现有 `loadStrict`、retry、changed-before-hydrate、
  per-mount center facade 全部保留，不得重写成第二套 hydration machinery。
- 迁移输入（调研 B 表1/2 全量普查）按此归档：
  - workspace：`center_surfaces.byCwd`、`sidebar_chrome.byScope`、四个 RevisionedStore
    运行时缓存（内存态，不落盘）、terminal 实例表；**comments.workbench 从全局数组改按
    cwd 分桶**（消灭渲染期路径路由的隐式 scope）。
  - session：subagent jobs outputs（键 `sessionId:jobId` 维持）、休眠 composer 历史
    （接线时归档）。
  - global：flags、skins 偏好、left-rail 用户档、marketplace 开合布尔。
  - review 评论持久化桶统一为 `workspace×branch`；会话桶保持派生不持久化。
- **剩余结构问题**：
  - comments 双写者竞态已由 `1b75b96`/`1c88b8d` 关闭；执行叶只能验证并接入
    `comments-record.ts`，不得重新引入 `chromeRecord` 镜像。仍需处理 comments 的 cwd
    scope、version 迁移、单一 `persistVia` 写通道；
  - 版本策略二义性仍存在：terminal-sessions version!==1 硬拒（terminal-session-store.ts:330）vs
    sidebar_layouts informational version（sidebar-storage.ts:47-52）→ 统一接口同时表达
    `onIncompatible: 'migrate' | 'reset'` 两档，硬拒仅允许用于不可迁移格式；
  - sanitize 上限 500 vs 运行时上限 200（comments）→ 裁决为单一常量（人工门）。
- **left-rail 并轨**（调研 B 最大绕过面）：stores.ts:80 defineStore 切片迁 shared/runtime
  家族 + StateStore；`createUiChromeStorage(left_rail_view)` 直连与 settings.replace 直连
  改经 persistVia 后端适配器；settings 域保留（官方设置页 schema 注册不动）。
  现有 `left-rail-chrome.ts` 的 `loadStrict` 与 `useLeftRailPersistence` 的
  `chromeHydrated=false` 失败保护是已落地的数据安全契约，必须原样保留。
- **keymap localStorage 半区删除**（前轮 Q9 裁决恢复执行）：删 read/write override
  （kit/keymap.ts:150-177），guard-no-localstorage ALLOWLIST 同步收缩至 comments-migration
  一项；注册表本体保留。
- 保持纯内存不持久化（调研 B 输入 c）：marketplace client store、全部 RPC 缓存运行时、
  terminal 实例、review bridge delivery、投影适配器。

### 3.5 WorkspaceEvents —— 切换事件源

两类事件（调研 A 风险 #4：同 cwd 换 session ≠ 换 cwd）：

```ts
onWorkspaceChanged(cb: (cwd: string) => Unsubscribe)
onSessionChanged(cb: (e: { sessionId: string; cwd: string }) => Unsubscribe)
```

替换 10 个各自 `sessions.list.subscribe` 重拉点（plugin.tsx:171、workspace-tools.tsx:486、
center-surface-host.tsx:175、center-surface-tabs.tsx:44/87-140、add-menu:64、
workspace-panel.tsx:43、subagent-panel.tsx:60、review-comments.ts:509、pinned-summary
service.ts:168/224-238、marketplace-view.tsx:233）。同时接通最大缺口：runtime registry
以 cwd 为键从不过期（runtimes/registry.ts:45-47）→ 订阅 workspaceChanged 做 LRU 失效。

**与 Git freshness 分层**：`GitWatchCoordinator`（`377d0b1`）是资源新鲜度领域事件：
订阅 cwd 时做 cheap porcelain fingerprint，变化后由客户端 pull 正常 git RPC，断线才启用
4s fallback。它不是 workspace/session 身份事件，不能被 WorkspaceEvents 重写或合并；
`SourceControlRuntime` 保留 history/branch rows 与顶层 gitStatus error 语义（`05f6543`）。
WorkspaceEvents 只负责“当前 workspace/session 身份变了”这一事实。

## 4. Track B：桌面壳（src/）

### 4.1 AppController 显式状态机（调研 C 设计输入 a）

```
idle → acquiring-lock → bootstrapping → starting-runtime → ready ⇄ restarting
正交子态： preview {stopped|starting|active} · updating {none|installing-on-quit} · quitting
失败汇点：任意态 → failed-splash
转移动作映射：startRuntime/stopLiveForMarketplace=starting 入出口；restartRuntime=restarting
进入动作；second-instance/activate=ready 态 re-entry；before-quit=quitting 进入动作
（stopForApplicationQuit singleFlight 为 exit action；install-on-quit 经 updating 子态）。
```

- `transitioning/quitting/quittingForUpdate` 布尔全部消亡，成为状态判据
  （消灭 handleRuntimeExit:627 与 restartRuntime:715 的布尔竞争）。
- queuedPaths 缓冲由 ready 进入动作消费；installLocalPlugin 不再绕过 resetLiveRuntime
  直接置 `runtime=undefined`（main.ts:766）。
- 控制器为可注入纯模块（ports: spawn/window/splash），配行为测试（tests/desktop-lifecycle.test.ts）。

### 4.2 模块拆分（bootstrap 收缩为纯接线 ≤150 行）

| 新模块 | 吸收内容（main.ts 行区间） |
| --- | --- |
| src/desktop-identity.ts | PRODUCT_NAME(86)/appId(87)/repo(update-manager.ts:18-20)/标题派生(151)/assertReleaseIdentity(1096-1129)；client.ts 标题 hack 一并单源 |
| src/windows.ts | createWindow(375-479)/splash(481-488)/更新窗(546-580)/图标(350-373)/导航守卫(324-348) |
| src/menu.ts | labels()(819-866)/buildMenu(868-966)/编辑右键菜单(974-1001) |
| src/ipc.ts | installIpc 九 handler(1015-1073)/sendCommand/sendUpdateState/broadcast |
| src/runtime-options.ts | 220-322 全部选项与环境组装 |
| src/app-controller.ts | 103-122 全局收编 + 582-781 生命周期流 |

### 4.3 就绪协议加固（保留 stdout 行 + HTTP 确认）

READY_LINE 正则（runtime.ts:5）降级为"URL 候选提供者"；supervisor 对候选 URL 发起
HTTP 探测确认后才算 ready（错误匹配 fail-safe 而非误 loadURL）；start 超时路径补
SIGTERM→SIGKILL 升级并 await exit（现 190-193 只 SIGTERM 不等待）；live/preview 共用
controller 防重入。不改上游打印格式、不新增落盘文件（符合 AGENTS.md 数据根边界）。

### 4.4 client.ts 去 hack

- DESKTOP_CHROME_CSS（40-181 约141行内联 CSS 字符串）→ 独立 CSS 模块资产。抽取时
  必须保留 `5928e82` 已落地的 sidebar brand-row 隐藏 selector、collapsed rail 的
  `--dsh-studio-traffic-top` re-assert，以及 `ed194ce` 对 toggle label 的 dsh-dom 语义。
- installHeroBranding MutationObserver 文案替换（212-234）→ **默认整链删除**
  （上游拥有自己的文案；标题身份已经 bridge getInfo 单源）——产品裁决留人工门。
- findSettingsButton 三级 DOM 探测（240-258）→ 移入 plugins/sidebar dsh-dom.ts
  （唯一合法探针模块），或若调研证实存在官方 settings 打开 API 则直用（执行时定，
  人工门记录裁决）。

## 5. Track C：市场事务显式相位机（调研 D 全套设计输入）

- 相位枚举：`idle → catalog-ready → planning → previewing → applying → applied-with-undo
  → undoing`，正交 busy。applying/undoing 为**显式落盘相位**。
- **意图前置（修 W1-W5/U1-U3 崩溃窗口的根因）**：journal（current.json）v2 增加
  `{version:2, phase, committed}`，在第一次 rename **之前**写入（现缺陷：current.json
  写入 L1006 晚于 profile 换入 L974）。构造时 reconcile() 按调研 D 判定表对账：
  backup 还原 / failed-candidate 与 replaced-* 清扫 / 孤儿 tx 目录回收。
- rollback.json 兼容：缺 version 视为 `{version:1, phase:'applied', committed:true}`，
  仅在下一次成功事务时懒升级 v2，绝不批量改写（非破坏约束）。
- allowBuild 重写：不再正则手术 YAML（L255-286）——标记块之间的内容本仓全权所有，
  改为"剥块 → 校验块外无 allowBuilds 键 → 整块重生成"，无需 YAML 解析器。
- 错误留存：dispatch 成功路径立即清 error（L561）改为"保留至上一次成功操作被取代"；
  agent-gateway 二次守卫（agent-gateway.ts:117-121）与 deferMs 机制保留。
- 客户端 push 顺序保护已经由 `9efaadf` 落地：`subscribeMarketplaceHost` 使用独立
  monotonic token，旧的异步 `getSnapshot()` 不得覆盖更新 push。市场叶子只验证并保留
  这个 token/`acceptPush` 语义，不再重写 marketplace client store。

## 6. Track D：依赖工程（调研 E）

- **config/dsh-dependencies.json 单一源**：runtime pin（package/version/integrity/tarball/
  packageManager）、inject 清单、host/client externals、typePackages、bundles 映射。
- scripts/sync-dsh-dependencies.mjs 生成：dsh-source.json、package.json `dsh.client.inject`、
  build.mjs 读配置（删 L182-184/L198-207 硬编码）、tsconfig paths 种子（build-dsh.mjs
  的 sandbox 重写逻辑前移为生成器）。
- scripts/guards/guard-dsh-dependencies.mjs 对拍五处清单互为一致
  （inject ⊆ cordis.patch.yml insert ⊆ profile.ts BUNDLED_*；externals 覆盖源码全部
  `@deepseek-ai/*` import）——AGENTS.md 明文允许的 bundled-inventory 对拍场景。
- scripts/bump-dsh.mjs 半自动 bump：步骤化执行现手册五步（调研 E 表2），每步前置校验，
  失败输出结构化冲突报告 `{step, expected, actual, file, fix}[]`；patch 冲突附 minified
  目标行片段；不自动 commit。
- minified patch 清零走上游提案路线（leaf-4.3）：verify-staged-layout.mjs:106-163 已经把
  patch 语义固化为行为断言（列宽 clamp/无 center 地板/禁 auto-collapse），可直接翻译为
  上游测试 + 配置提案；本仓 patch 保留至上游接受，属外部依赖交接而非半成品。

## 7. Track E：卫生目标形态（调研 F）

- i18n：引擎维持唯一（shared/i18n.ts），键表按插件分域保留；补类型纪律
  （left-rail 双向 satisfies、skins 接 LocaleMessages）、terminal 5 个跨表重复键去重；
  cancel/confirm 类通用标签提为 shared 复合常量供各表 spread（可选）。
- 残留：删 errorMessage-sweep.list（error-idiom 规则升格为 scripts/guards/guard-error-idiom.mjs
  或随最后一处 idiom 消亡而失去必要性——执行时拍板）；173 处决策码注释改语义注释；
  21 处 `// //` 归一；dead-export allowlist 入库 + 121 候选拍板（26 个 tests-only 判活）；
  删 smoke:runtime 空跑脚本及 package.json/CI 引用；update-manager/context-types 非 vendor
  any 清零。
- 守护接线：guard-dsh-dependencies、guard-error-idiom（若立）接入 check:guards 与 CI
  core job；rescan 中有价值的局部规则（abort 三件套、arbiter、wholestore-subscribe）内迁
  guards。
- 文档双语同步：design.md/design.en.md 内核章节改写为实现态；workbench-architecture.md
  状态翻转为 implemented（含偏差记录）；plugins/AGENTS.md 增补探针模块与 LayoutService 规则。

## 8. 数据迁移语义一览（全部非破坏、幂等、重启安全）

| 迁移 | 方向 | 机制 |
| --- | --- | --- |
| comments.workbench 全局数组 → 按 cwd 分桶 | v2→v3 | 读时迁移 + 下次写落新格式；旧键不删 |
| rollback.json v1 → journal v2 | 懒升级 | 缺 version 即 v1 语义；成功事务时原子改写 |
| keymap localStorage overrides | 删除 | 无重绑 UI，无数据价值；直接删（Q9 裁决） |
| left_rail_view / settings 直连 → persistVia 后端 | 通道替换 | 数据格式不变，仅通道收口 |
| legacy localStorage 评论三键 | 已有 | comments-migration 保持（唯一保留的 localStorage 读点） |

## 9. 风险与对策（top6）

1. **openPath 补丁 refcount/HMR**（intercept.ts:36-65）：pipeline 内幂等 install/restore
   + 行为测试覆盖双 install 场景。
2. **right-panel 几何帧级时序**（三个写手 → 一个）：LayoutService preview/commit 两段式
   API 保住拖拽热路径（workspace-tools.tsx:248/237）；回归测试锁定宽度应用帧序。
3. **center strip DOM 自愈重挂**（center-surface-host.tsx:304-327）：区域宿主接管挂载点时
   保留既有 probe 模块与 MutationObserver 自愈，只换所有权不换机制。
4. **双语义切换分支**：WorkspaceEvents 必须区分 cwd 切换与会话切换，center-surface-sync
   的 retain/activate/deactivate 语义（center-surface-tabs.tsx:87-140）逐条映射后删原订阅。
5. **市场对账误伤**：reconcile 所有修复动作先 warn 后动盘；判定表七行各有 fixture 测试；
   removeTree 静默失败（platform.ts:355 不抛出）在对账路径上改为显式失败上报。
6. **大爆炸回归面**：20 叶子全部带独立 runnable oracle；每波之间驱动者跑全局
   tc/test/build/guards；分支 node 台账强制子账 --reverify 后才推进。
