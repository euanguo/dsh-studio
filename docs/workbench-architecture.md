# 工作台架构演进：从「插件补丁」到「Workbench 内核」

> 状态：已实现（implemented）· 提案 2026-08-23 · 入库 2026-08-24 · 实现落地（kernel-refactor，W1–W8）
> 偏差记录：实现以 `plugins/workbench` 五服务 + `@dsh-studio/shared/workbench-contracts`
> 为准——SurfaceRegistry / OpenPipeline / LayoutService / StateStore / WorkspaceEvents；
> 身份事件源采用 runtime 的 `currentProvideInfo` 投影（本文初稿假设逐会话订阅点改造），
> GitWatch/websocket 新鲜度事件按计划保留在 source-control 域、未并入 WorkspaceEvents；
> 状态持久化经 `persistVia` 落 host 域后端，localStorage 仅作 legacy 只读迁移源。
> 前置：`docs/interaction-model.md`（交互决策 D1–D7）。本文回答：**如何调整整体架构，
> 让这些优化成为内核能力，而不是逐项打补丁。**
>
> 外部参考：VS Code Workbench services（layoutService / editorService / editorGroupsService /
> openerService / StorageScope）、Zed `crates/workspace`（workspace/dock/pane）、
> JetBrains PersistentStateComponent + Workspace Model、Eclipse workbench parts/perspectives。
> 内部证据：文末清单（file:line 均已核对）。

---

## 1. 现状地图：能力是怎么长出来的

三栏工作台的每个能力都是"插件 + 固定覆盖层 + 各自存储"的组合：

```
desktop-left-rail ── slots 注入官方 sidebar.workspaces（fork 替换）
sidebar(SideToolsPanel) ── body 下固定覆盖层 #dsh-studio-sidebar-root
sidebar(center-surface-host) ── body 下固定覆盖层 #dsh-studio-center-tabs-root
pinned-summary ── body 下固定 <aside> + <style>，claimRightPanel 挤 #root
panel-controls ── 右栏 footprint 协调器（写 #root padding-right + data 属性）
plugin-marketplace ── 自建 div + createRoot 覆盖层
```

打开路径靠劫持：`intercept.ts` 用 `acquireOpenPathPatch` 替换官方
`workspaces.openPath`，并注册 link protocol 拦截；会话文件链接、右栏点击各自为政。

状态存储（8 个 localStorage store，≥4 种作用域维度）：

| Store key | 作用域维度 | 归属 |
| --- | --- | --- |
| `dsh-studio.sidebar-preferences.v2` | cwd（workspaces 分桶） | sidebar-storage |
| `dsh-studio.center-surfaces.v2` | cwd（byCwd） | center-surface-persistence |
| `dsh-studio.sidebar.review-comments.v1` | **混合**：sessionId\0cwd\0branch + seeded workspacePath\0branch | review-comments |
| `dsh-sidebar:v1:<sessionId>` | **sessionId** | capabilities/src/client/state.ts:611 |
| diff-comments-store KEY | 独立第三套评论存储 | diff-comments-store.ts |
| `dsh-studio.keymap.v1` | 全局 | kit/keymap.ts |
| `dsh-studio.terminal-panel` | 全局（dock 已 CUT） | panel-controls/panel-store |
| panel-controls OPEN_KEY | 全局 | panel-controls/client.ts |

DOM 探测散布：`[data-slot=...]` 查询 11 处（skins/marketplace/center-surface-host/
dsh-dom.ts），`centerColumnElement/leftRailToggleButton/readLeftRailOpen` 直接读官方 DOM。
服务版本只有 sidebar 一个（SIDEBAR_SERVICE_VERSION '0.1.2' + SIDEBAR_FEATURES）。

## 2. 结构性诊断（为什么是补丁式）

- **P1 作用域无原语**：cwd / sessionId / branch / 全局四种维度由各 store 自行解释；
  "同一份状态该跟谁走"没有统一答案 → 评论分裂（interaction-model D5b）、layoutScope
  开关无处安放（D5a）都源于此。
- **P2 打开无管道**：没有统一的 openRequest 流程。谁都能 createRoot 开 tab、谁都能
  劫持 openPath；焦点不变式（D2/D3）与 preview 语义（D4）无处集中执行。
- **P3 布局靠副作用协调**：panel 几何以「写别人家 DOM 的 padding」实现（claimRightPanel
  写 `#root` padding-right）；区域所有权、层级、宽度互相不知道。
- **P4 持久化各管各的**：schema version 字段格式不一（v1/v2/v4 混用）、迁移逻辑重复、
  新增一个偏好要新开一个 key。
- **P5 事件源不统一**：worktree/会话切换的感知分散在 sessions snapshot 订阅里，
  没有 WorkspaceEvents。

## 3. 目标架构：Workbench 内核

新增一个**纯 cordis 服务插件** `@dsh-studio/workbench`（host+client），不新增 loader、
不违反「跨插件值导入禁止」——一切通过 `ctx.get()/ctx.reflect.provide()` 注入。
五个内核服务：

1. **SurfaceRegistry** —— surface kind 注册表
   （conversation/file/diff/browser/terminal/review/subagent…）：descriptor 含
   `{ scopeNeed: 'workspace'|'session'|null, previewable, pinnable, focusPolicy,
   renderer }`。右栏 tab 与中间 tab 都渲染 registry 条目，消灭 descriptor 双轨。
2. **OpenPipeline** —— 唯一打开入口
   `open({kind, target, intent: 'preview'|'pin'|'background', area?: 'auto'})`
   → scope 解析（ScopeService）→ 区域裁决（右栏快速预览 vs 中间 tab）→ FocusPolicy
   执行（永不抢焦点，除非用户显式动作）→ 渲染。D2/D3/D4 从「散在各处的行为」变成
   「管道参数」：agent file chips、会话链接、右栏点击、marketplace 打开全部走它；
   `previewTabs` 偏好在管道内生效。intercept 的 monkey-patch 改为向 pipeline
   注册 handler（官方 openPath 劫持收敛为一处，且可整体摘除）。
3. **LayoutService** —— 区域所有权与几何
   声明区域树（left-rail / right-panel / center-tabs / bottom-reserved）；
   claim/release 面板足迹改为布局树协商（替代写 `#root` padding 的副作用）；
   承载 `layoutScope: 'workspace'|'global'`（D5a）与每-worktree 宽度记忆（D7）；
   bottom 区位保留声明但默认关闭（CUT 语义显式化）。
4. **ScopeService + StateStore** —— 作用域原语与统一持久化
   `ScopeKey = workspace(cwd) | session | global` 三档枚举 + 带 schemaVersion 与
   迁移框架的持久化适配器（对齐 VS Code StorageScope 的 APPLICATION/WORKSPACE 语义与
   JetBrains PersistentStateComponent 的 component 粒度）。现有 8 个 store 迁入；
   评论桶改 `workspacePath\0branch`（D5b），`authorSessionId` 作元数据；
   `dsh-sidebar:v1:<sessionId>` 明确标注 session 维度的合理性后保留或并入。
5. **WorkspaceEvents** —— 切换事件源
   worktree(cwd) 变更 / 会话变更两类事件，所有需要跟随切换的组件订阅它，
   取代各自 watch sessions snapshot。

外部先例支撑：VS Code 把同类问题拆成 layoutService（parts 几何）+ editorGroups/editor
service（tab 模型与打开）+ openerService（导航入口）+ StorageScope（作用域存储，
近期还新增 APPLICATION_SHARED 跨应用档 PR #311317）；Zed 一个 `workspace` crate 统一
持有 dock/pane；JetBrains 以 component 为粒度声明持久化层级（project vs application）。
Eclipse perspectives 是反面教训：布局语义过度集中且僵化后被社区弃用——所以我们的
LayoutService 只管「区域与足迹」，不管内容编排。

## 4. 迁移路线（strangler，四阶段各自可发布可回滚）

| 阶段 | 内容 | 对应优化 | 回滚方式 |
| --- | --- | --- | --- |
| P0 契约周 | 定义五服务接口（类型层）；冻结新 store/key；补焦点不变式 smoke | — | 纯增量 |
| P1 Scope+State | ScopeService 上线；review-comments v1→v2 重归属迁移；center/sidebar-preferences 接入适配器；顺带清理重复注释块与 CUT 死代码 | D5b | feature flag `workbench.state` |
| P2 OpenPipeline | intercept hijack → pipeline handler；右栏快速预览短路径；previewTabs 偏好；agent file chips；删除 openPath 补丁 | D2/D3/D4 | flag `workbench.open` |
| P3 Layout | claims → 布局树协商；geometry 入 PreferenceService；layoutScope 开关；bottom 区位显式保留 | D5a/D7 | flag `workbench.layout` |
| P4 收尾 | SurfaceRegistry 吸收双 descriptor；删除 legacy 路径；design.md/design.en.md 双语更新；SIDEBAR_SERVICE_VERSION → WORKBENCH_CONTRACT_VERSION | D1 固化 | 删除 flag |

每阶段的验收复用 interaction-model.md §3 的要点（焦点不变式 smoke、worktree 往返恢复、
跨会话评论可见、迁移幂等），并遵守仓库测试纪律：测行为与契约结构，不做源码字符串 grep。

## 5. 风险与对策

- **upstream bump 冲突**：DOM 探测全部收口到 `dsh-dom.ts` 单模块 + 选择器 tripwire 测试
  （呼应 desktop-skins generated-selectors 的重钉机制），bump 时只重钉一处。
- **web 平价**：内核服务的 Electron-only 能力以 capability gate 标注（对齐
  dshStudioSurface 契约）；Web 表面走同一 pipeline 但 area 集合受限；TUI 不消费 browser 图。
- **性能回归**：retained runtime 缓存（LRU 16/32）语义原样迁入 ScopeService，
  切换零刷新行为加 smoke 锁定。
- **迁移破坏用户数据**：所有 v(n)→v(n+1) 迁移幂等、非破坏、重启安全（AGENTS.md 硬约束），
  迁移前快照原值到 `<key>.bak` 一代。
- **范围蔓延**：明确不做——无限画布、perspective 式多布局预设、命令面板（另立提案）。

## 6. 内部证据索引（关键处）

- 作用域分散：plugins/sidebar/src/client/runtimes/registry.ts:40-46（cwd）、
  surfaces/center-surface-store.ts:57-59（byCwd）、review/review-comments.ts:245-247 +
  :455（混合 vs seeded）、capabilities/src/client/state.ts:611（sessionId）
- 打开劫持：plugins/sidebar/src/client/intercept.ts（acquireOpenPathPatch /
  registerLinkHandler / registerLinkInterception / registerOpenPathHandler）
- 几何副作用：plugins/panel-controls/src/client.ts:151-209（claimRightPanel 写 #root
  padding）、pinned-summary/src/client.ts:347
- 挂载点：workspace-tools.tsx:281-302、center-surface-host.tsx:565-567、
  plugin-marketplace/client/plugin.tsx:258-261
- 存储清单：见 §1 表格（key 均已 grep 核实）

## 7. 外部参考

- VS Code：deepwiki.com/microsoft/vscode「3.1 Layout and Parts」「3.2 Editor Groups and
  Editor Service」；src/vs/platform/storage/common/storage.ts（StorageScope）；
  microsoft/vscode#311317（APPLICATION_SHARED）；src/vs/platform/opener/common/opener.ts
- Zed：crates/workspace/{workspace.rs,dock.rs,pane.rs}；deepwiki zed「3.5 Panels and Sidebar」
- JetBrains：Persisting State of Components（plugins.jetbrains.com/docs）、Workspace Model
- Eclipse：Inside the Workbench（eclipse.org articles）；Perspectives 弃用教训
