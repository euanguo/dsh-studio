# Synara 参考项目 → Oh-DSH 右侧栏插件：组件移植探索报告

> 状态：**探索完成**（第一手 + 4 子代理，全部报告已合并）。
> 改造计划见 `docs/sidebar-rebuild-plan.md`。
> 未修改参考项目与插件功能代码。

## 0. 结论先行（第一手验证）

| 用户诉求 | 参考项目（Synara web-next） | 当前插件现状 | 移植方向 |
|---|---|---|---|
| 文件树与 Git 树同一组件不同变体 | 共享原语是 **`ListRow` 族**（非 PathTreeNav）；Explorer 与 Git 面板各自手写 ListRow 行组件；`PathTreeNav` 仅 multi-diff 使用 | `.oh-dsh-sc-row` 与 `.oh-dsh-files-row` 两套独立 CSS/组件 | 移植 `ListRow` 原语族 + `FilenameLabel`，两棵树统一构建（见 5.2） |
| 文件名中间省略 | `FilenameLabel`：Canvas 字体测量 + 二分 + 扩展名保留 | 无（CSS 尾部省略） | 整体移植 `middle-truncate-text.ts` + `filename-label.tsx` |
| 懒加载 + 外置缓存（切换秒显） | `ScopedRuntimeRegistry`（按 scope 键、LRU）+ `WorkspaceExplorerRuntime`（目录列表 phase 状态机缓存）+ `SourceControlRuntime` | `entriesByDir` 是 FilesView 组件内 state，切 Tab 即丢 | 移植 `@synara/client-runtime` 原语 + 模块级 runtime 注册表 |
| 中间 Tab 模块（会话 + 文件/Diff/浏览器 tab） | `CenterSurfaceStore`（按 workspace 分片，preview 替换/pin 固定语义）+ `SurfaceTab` + renderer registry | 侧栏顶部有 TabStrip（面板内），无中间模块 | 移植 store + tab UI，在桌面中间区域挂 overlay Tab 条 |
| 单一 Diff 组件族 | `components/diff-viewer.tsx` + `@pierre/diffs` worker 适配 + `entities/file-diff` + working-tree-diff 组合 | `diff-view.tsx` + `review-diff.ts` 两套并存 | 移植统一 DiffView，删除旧实现 |
| 树交互：点击展开而非下钻 | 目录点击 = `onToggleDirectory`（展开）；文件单击 = preview tab，双击 = pin | flat/nested 模式点击目录 = 下钻导航 | 默认树模式 + 展开语义 |
| 切换秒显（缓存） | 保留注册表 + 懒加载 Map + soft-revalidate（子代理报告 5.1） | `entriesByDir` 归组件私有，切 Tab 即丢重拉 | 移植 `ScopedRuntimeRegistry` + runtime 化（Phase B） |

## 1. 参考项目关键路径

- 右侧栏：`apps/web-next/src/chrome/inspector-host.tsx` —— `SurfaceTabStrip`（Explorer / SourceControl / Preview / Trace / TimeTravel / Terminal / Studio 图标 Tab）+ panelBody
- 共享行原语：`src/components/ui/list-row.tsx`（ListRow / Main / Leading / Body / Label / Meta / Trailing / Actions / ActionButton / Nested）
- 文件名中间省略：`src/components/filename-label.tsx` + `src/shared/middle-truncate-text.ts` + `src/shared/filename-display.ts`
- 文件树（Explorer）：`src/features/explorer/explorer-feature.tsx` + `explorer-tree-view.tsx` + `explorer-view-model.ts` + `explorer-virtualization.ts`
- Git 面板：`src/features/source-control/source-control-feature.tsx` + `source-control-panel-view.tsx` + `source-control-view-model.ts`
- 共享树导航器：`src/components/path-tree/path-tree-nav.tsx`（用于 working-tree-multi-diff-view）
- 中间 Tab：`src/surfaces/center-surface-store.ts` + `types.ts` + `surface-renderer-registry.tsx` + `src/components/ui/surface-tab.tsx`
- 缓存基座：`packages/client-runtime/src/index.ts`（RevisionedStore / GenerationGate / SubscriptionScope / ScopedRuntimeRegistry / ResourceState，269 行零依赖）
- 缓存注册表：`apps/web-next/src/scope/scope-runtimes.ts`（explorer/source-control/file/thread 等 registry + prewarm + activateScope touch）
- 目录缓存：`src/cache/workspace-explorer-runtime.ts`（phase 状态机 + generation + LRU 64 + inflight 去重）
- Diff：`src/components/diff-viewer.tsx` + `src/adapters/pierre-diff-adapter.tsx` + `src/entities/file-diff.ts` + `src/features/source-control/working-tree-*-diff-*`
- 外部依赖：`@legendapp/list`（虚拟化）、`@pierre/diffs`（diff 计算）、`@base-ui/react`（ScrollArea 等）、zustand（center-surface-store）

## 2. 第一手机制要点

### 2.1 缓存为什么"切换秒显"
1. `getWorkspaceExplorerRuntime({workspaceId, cwd, transport})` 从模块级 `explorerRuntimeRegistry` 取（key = workspace+worktree，**cwd 次索引**）；已存在且 transport/cwd 一致 → `touch` 返回同一实例。
2. `WorkspaceExplorerRuntime` 内部 `listings: Map<relativePath, ExplorerListing>`，phase ∈ Loading/Ready/Empty/Error；`ensureListing` 对 Ready/Empty 直接短路返回。
3. 视图 `useSyncExternalStore(runtime.subscribe, fingerprint)` —— 缓存命中时无网络、无 loading。
4. `prewarmSourceControl()`：inspector 挂载时后台预热；`activateScope()` 切换时 touch 所有 registry（LRU 保活）。
5. UI 状态（expandedPaths/selectedPath）在 `workspace-chrome-store`（zustand，preferences 持久化），与数据缓存分离。

### 2.2 临时 Tab 语义（center-surface-store）
- `preview: true`（单击默认）→ 替换当前预览 Tab；同一时刻只允许一个 preview Tab。
- `preview: false`（双击/固定）→ append 固定 Tab；已存在同 id 则激活并保持固定。
- `pin()`：双击清除 isPreview。
- 会话 Tab 恒为固定（isPreview: false）。
- id：`conversationSurfaceId(threadId)` / `fileSurfaceId(workspaceId, filePath)` / `diffSurfaceId(worktreeId, filePath, scope)`。

### 2.3 树交互
- Explorer 目录行单击 = `onToggleDirectory`（展开/收起，`--tree-depth` 缩进）；文件行单击 = `onSelectFile(path, true)`（preview），双击 = `(path, false)`（pin）。
- 行数 ≥ 阈值时切换 `FixedVirtualList`（`@legendapp/list`，固定行高 33px），否则 ScrollArea 平铺。

### 2.4 当前插件问题根因（对照）
- `FilesView` 的 `entriesByDir` / `expandedDirs` 是组件 state → tab 切换卸载即丢 → 重进重拉。
- `WorkspacePanel` 的 git 数据在组件内 `useState` + 4s 轮询 → 同样无跨挂载缓存。
- 两套行样式（`.oh-dsh-sc-*` / `.oh-dsh-files-*`）各自维护。
- 文件浏览 flat 模式点击目录 = 下钻（setPath），用户不想要。
- Diff 两套：`diff-view.tsx`（parseUnifiedDiff）与 `review-diff.ts`（提交审阅行内渲染）。

## 3. 移植方案骨架（待子代理报告细化）

```
plugins/desktop-sidebar/src/client/
├── kit/                        ← 新：共享原语（可提到 plugins/shared）
│   ├── runtime.ts              ← RevisionedStore/GenerationGate/ScopedRuntimeRegistry/ResourceState
│   ├── list-row.tsx + .css     ← ListRow 原语族
│   ├── filename-label.tsx + .css ← 中间省略
│   ├── file-icon.tsx           ← 基于现有 tabler-icons
│   └── path-tree-nav.tsx + .css
├── runtimes/                   ← 新：数据缓存层
│   ├── registry.ts             ← 模块级 ScopedRuntimeRegistry（key = sessionId:cwd）
│   ├── explorer-runtime.ts     ← 移植 WorkspaceExplorerRuntime（包 betterSidebarApi.fsTree）
│   ├── source-control-runtime.ts ← 移植 SourceControlRuntime（包 gitStatus/branch/log）
│   └── file-runtime.ts         ← 移植 WorkspaceFileRuntime（包 fsRead）
├── surfaces/                   ← 新：中间 Tab 模块
│   ├── center-surface-store.ts ← 移植（本地 store，去 zustand 依赖或引入）
│   ├── surface-tab.tsx + .css
│   └── renderer-registry.tsx
├── diff/                       ← 新：统一 Diff
│   ├── diff-viewer.tsx + .css  ← 移植
│   ├── file-diff.ts            ← 移植实体
│   └── pierre-adapter.ts       ← @pierre/diffs worker
└──（改造）
    ├── FilesView → explorer 树变体（点击展开，无下钻）
    ├── SourceControlPanel → 树变体（ListRow + trailing 状态 + hover actions）
    ├── WorkspacePanel → 用统一 DiffView
    └── plugin.tsx → 挂中间 Tab 条 overlay
```

## 4. 可执行分阶段计划（骨架）

### Phase A — 基座原语移植（纯搬移，不改行为）
1. `plugins/shared/runtime.ts`：从 `packages/client-runtime/src/index.ts` 移植 `RevisionedStore / GenerationGate / SubscriptionScope / ScopedRuntimeRegistry / ResourceState`（去掉 zustand/effect 依赖，纯 TS + 测试）。
2. `plugins/shared/list-row.tsx` + `list-row.css`：移植 ListRow 原语族（Main/Leading/Body/Label/LabelText/Meta/Trailing/Actions/ActionButton），token 换成 `--oh-dsh-*` 阶梯。
3. `plugins/shared/filename-label.tsx` + `middle-truncate-text.ts` + `filename-display.ts` + css：整体移植（Canvas 测量 + 二分 + 扩展名保留）。
4. `file-icon`：基于现有 `tabler-icons.tsx` 的 FileGlyph 增强或移植参考实现。

### Phase B — 数据缓存层（解决"切换秒显"）
1. `runtimes/registry.ts`：模块级 `ScopedRuntimeRegistry`，key = `sessionId:cwd`（插件无 workspace 概念，用 cwd 充当 scope）。
2. `runtimes/explorer-runtime.ts`：移植 `WorkspaceExplorerRuntime`（phase 状态机 + generation + LRU 64 + inflight 去重），transport = `betterSidebarApi.fsTree`。
3. `runtimes/source-control-runtime.ts`：移植 `SourceControlRuntime`（status/branch/log 快照 + 轮询/刷新 + generation），transport = `betterSidebarApi.gitStatus/gitBranch/gitLog`。
4. `runtimes/file-runtime.ts`：移植 `WorkspaceFileRuntime`（fsRead 缓存）。
5. UI 状态（collapsed/selected/mode）迁到持久化 chrome store（localStorage），与数据缓存分离。

### Phase C — 树组件统一（文件树 + Git 树同构）
> 修正认知（子代理报告 5.2）：参考项目共享的是 **`ListRow` 原语族**，不是 PathTreeNav；
> 两棵树 = "ListRow 手写行 + 各自纯函数构建行流"。我们的移植同构。
1. `plugins/shared/list-row.tsx` + `list-row.css`：移植 ListRow 原语族（含流式 actions 槽，hover 揭示；替换现有绝对定位 trailing/actions 体系）。
2. `plugins/shared/filename-label.tsx` + `middle-truncate-text.ts` + `filename-display.ts`：整体移植（Canvas 测量 + 二分 + 扩展名保留）。
3. `FilesView` 改造：**删除 flat/nested 下钻**，默认 tree 模式，目录点击展开/收起；行渲染改用 ListRow + FileIcon + FilenameLabel；行数 ≥ 阈值时切换简单定高虚拟列表（可选 @legendapp/list）。
4. `SourceControlPanel` 改造：行渲染改用 ListRow 原语（Section/Directory/File 三种行），trailing 状态标 + HoverOverlayActions 保留现有语义；删除 `.oh-dsh-sc-*` 与 `.oh-dsh-files-*` 两套独立 CSS，统一到 list-row.css。
5. `PathTreeNav` 移植为可选共享导航器（multi-diff 文件导航用），不作为主力。

### Phase D — 中间 Tab 模块
1. `surfaces/center-surface-store.ts`：移植（`byWorkspaceId => {open, activeId}`，id helper + `openPreviewableSurface` 语义原样保留）；store 实现：新增 zustand 依赖 或 改写为 useSyncExternalStore + 自定义 store（与插件现有风格一致，推荐后者，参考 `DesktopSidebarService` 模式）。
2. `surfaces/surface-tab.tsx` + css：移植 Tab UI（图标/标题/关闭/激活态/preview 斜体/双击 pin/hover prewarm）；图标用插件 tabler-icons。
3. `surfaces/renderer-registry.tsx`：kind → renderer 注册（conversation/file/diff/browser/terminal）。
4. 挂载：固定定位 overlay Tab 条（中间列顶部，类似 `#oh-dsh-desktop-sidebar-root`），会话 Tab 来自 `SessionsService.list`（按 cwd 过滤 = 当前项目所有对话）；文件/Diff/浏览器打开时作为 preview Tab（单击替换、双击固定）。
5. 持久化：URL bridge 剥离，改 localStorage（tab 集合 + activeId + 各 workspace 分片）。
6. 侧栏行为迁移：文件双击/右键"打开"→ 中间 file Tab；Git 变更点击 → 中间 diff Tab；浏览器 → 中间 browser Tab；`DetachedPanel` 浮窗逐步由中间 Tab 取代。

### Phase E — 单一 Diff 组件族
1. `diff/diff-viewer.tsx` + css：移植参考 `components/diff-viewer.tsx`（unified/split、行号、wrap、词级高亮）。
2. `diff/file-diff.ts`：移植实体模型。
3. `diff/pierre-adapter.ts`：`@pierre/diffs` worker 适配（新增依赖）或保留 parse-unified-diff 作为 text fallback。
4. 删除 `diff-view.tsx` 与 `review-diff.ts` 内联渲染，`WorkspacePanel` 提交审阅、变更 overlay 全部改用统一 DiffView。

### Phase F — 集成与验证
- 切换文件/Git 秒显验证（runtime 缓存命中）。
- 中间 Tab 临时/固定语义验证。
- 行样式统一后的间距审计回归（对照 docs/sidebar-spacing-audit.md）。
- 删除死代码（`.oh-dsh-change-row` 旧样式等）。

## 5. 子代理深度报告（已合并）

### 5.1 缓存层报告（已完成 ✅）

**三层结构 + 保留注册表 + 懒加载 Map + soft-revalidate**：

```
组件层（useSyncExternalStore 订阅 runtime 快照；UI 态 → workspace-chrome-store）
   ↓ getWorkspaceExplorerRuntime / getSourceControlRuntime（不 new，从 registry 取）
scope-runtimes.ts：ScopedRuntimeRegistry（模块级）
  explorer(16) / sourceControl(32) / workspaceFile(16) / gitActions(24) / preview(8) / threadSession(24)
  key = workspaceScopeKey；get() 命中不销毁；touch() 刷 LRU；超 maxEntries 才 dispose
   ↓
WorkspaceExplorerRuntime（目录列表 Map，LRU 64，根受保护）
SourceControlRuntime（git status 快照 store + fileDiffCache LRU 64）
   ↓
WorkspaceRuntime（模块级单例：CanonicalCache + ProjectDimensionCache + WorktreeStreamRuntime）
```

**"切换秒显"三要素（核心证据）**：
1. **保留注册表**：feature unmount 不 dispose runtime；切回时 `getWorkspaceExplorerRuntime` 命中同一实例，`listings` Map 未清（cwd 未变）→ ensureListing 命中缓存 0 网络。
2. **按目录懒加载 Map**：`ensureListing` 对 Ready/Empty 直接 return；inflight 去重；展开过的目录保留。
3. **soft revalidate 永不降级**：`refresh()` 在 `phase===Ready` 时不 set Loading（保留旧行直到新数据替换）；`markWorktreesLoading` ready 不降级；`ensureProjectWorktrees` ready 直接 return。`prewarmSourceControl()` 后台预热；启动 `prefetchAllProjectWorktrees()`。

**数据/UI 分界**：数据缓存在 runtime（RevisionedStore 快照），UI 态（expandedPaths/selectedPath/collapsedSections）在 zustand `workspace-chrome-store`（per-scope，可持久化）。

**失效通知**：RevisionedStore.setState → revision++ → subscribe 通知 → 组件 useSyncExternalStore + fingerprint（`phase:entries.length:branch`）只在实际变化时重渲染。

**移植到插件的最小方案**：
- 保留：① 按 scope（sessionId:cwd）保留注册表（Map + LRU + touch，unmount 不 dispose）② 数据与组件生命周期解耦（runtime 持有缓存，组件只订阅）③ soft-revalidate ready 不降级。
- 可简化：无全局路由 → 不需要 activateScope touch 联动；WorktreeStreamRuntime 事件流可去掉（改轮询/手动 refresh）；TTL 可省略；ThreadSessionRuntime 多 lane 超出需求。
- Electron 注意：registry 挂模块级 import；HMR/依赖替换用 rebindTransport 保留快照；退出时 disposeScopeRuntimes() 防泄漏。

关键文件：`cache/source-control-runtime.ts`、`cache/workspace-explorer-runtime.ts`、`scope/scope-runtimes.ts`、`scope/workspace-chrome-store.ts`、`packages/client-runtime/src/index.ts`

### 5.2 树/列表变体报告（已完成 ✅，子代理 6117c886 完整报告）

**首要发现（修正问题前提）**：Explorer 与 SourceControl 都【没有】用 `PathTreeNav` 渲染——二者各自在视图文件里用 `ListRow` 原语手写行组件。`PathTreeNav` 全仓仅 1 处消费（`working-tree-multi-diff-view.tsx`）。**真正的共享原语是 `ListRow`**。

**层级图**：
```
FileIcon(@react-symbols)  FilenameLabel(middle-truncate)  ListRow原语族
        │                          │                          │
        └──────────┬───────────────┴──────────────┬───────────┘
              PathTreeNav（纯视图，仅 multi-diff 用）│
        ┌──────────────────────┬──────────────────┴──────────────┐
    Explorer（手写 ListRow 行）│   SourceControl（手写 ListRow 行）│  MultiDiff（真用 PathTreeNav）
    explorer-tree-view.tsx     │   source-control-panel-view.tsx │  working-tree-multi-diff-view
      ├ ExplorerTreeRow        │     ├ Section/Directory/File 行 │    ├ wrapFileRow(ContextMenu)
      ├ FixedVirtualList(≥200) │     ├ ChangeMark + diffStat    │    └ MultiDiffFileStack(懒渲染)
      └ view-model 纯函数      │     └ HoverOverlayActions      │
```

**关键接口**：
- `PathTreeNavProps = { rows: PathTreeNavRow[]; ariaLabel; onToggleDirectory(key); onSelectFile(path); wrapFileRow?(path, rowNode) }`；`PathTreeNavRow = DirectoryRow{kind,key,path,name,depth,fileCount,collapsed} | FileRow{kind,key,path,name,depth,selected}`。纯受控，无内部状态/懒加载/虚拟化。
- `ListRow` 原语族：`ListRow({selected,active})` / `ListRowMain<button>` / `ListRowLeading` / `ListRowBody` / `ListRowLabel` / `ListRowLabelText` / `ListRowMeta` / `ListRowTrailing` / `ListRowActions({alwaysVisible})`（hover 揭示）/ `ListRowActionButton` / `ListRowNested` / `ListRowNestedStatus` / `ListRowItem`（组合便捷版）。
- 缩进公式三者逐字相同：`.depthMain { padding-left: calc(var(--control-pad-x-compact) + var(--tree-indent) * var(--tree-depth, 0)) }`（`--tree-depth` 经 style 内联）。

**两棵树差异点**：
| 维度 | Explorer | SourceControl |
|---|---|---|
| 渲染 | 手写 ListRow | 手写 ListRow |
| 虚拟化 | ✅ ≥200 行（@legendapp/list，固定 33px） | ❌ 全量 map |
| 懒加载 | runtime 按目录 ensureListing | runtime 整包 status + 懒渲染 diff |
| 状态标 | 无 | ✅ ChangeMark A/M/D/R/U + diffStat |
| 批量操作 | 无 | ✅ HoverOverlayActions（stage/unstage/discard） |
| ContextMenu | ✅ 直接包行 | ✅ 直接包行 |
| 折叠状态 | expandedPaths | collapsedSections + collapsedDirectoryKeys |
| 区段头 | 无 | ✅ Section 行 |

**为何两主力面板绕开 PathTreeNav 手写行**：Git 行需要 trailing 状态标 + 悬浮操作层，PathTreeNav 的行类型无法承载，需 wrapFileRow 或扩展行类型——手写 ListRow 更直接。

**FilenameLabel 复用性**：✅ 可独立复用。`middle-truncate-text.ts`/`filename-display.ts` 无 React 依赖（仅 document/getComputedStyle）；`FilenameLabel.tsx` 只依赖 `ListRowLabel` + cn + token。

**纯函数边界**：`buildExplorerPanelViewModel` / `buildSourceControlPanelViewModel` / `buildExplorerVisibleRows` / `buildGenericSourceControlTree` 一族均无副作用无 fetch；UI 态（collapsed/selected）在 chrome store，数据在 runtime，行组件纯受控。

**移植结论**：直接搬 `ListRow` 原语 + `FilenameLabel` + 树构建纯函数；`PathTreeNav` 作为"开箱即用共享树"样板（multi-diff 导航用）；虚拟化适配层（legend 契约 `dataKey/getFixedItemSize/estimatedItemSize`）可搬；runtime 模式照搬（替换 effect/client-runtime 为等价实现）；`FileIcon`/`cn`/token/i18n/command 为替换入口。

### 5.5 后端 Git 能力对比（新增 ✅ 第一手）

**现状盘点（oh-dsh-desktop，两套 Git 封装）**：
1. `plugins/better-sidebar-runtime/src/git.ts`（348 行，source-control 面板用）：每次请求 spawn 子进程（`-C cwd`），porcelain v1 -z；`status()` = `isGitRepo` → `currentBranch` + `status`（**3 次子进程，前两个串行**）；`numstat()` 独立命令但 **RPC 未接线**（`SidebarGitStatus.stats` 契约存在但 `git.status` handler 只返回 `git.status(cwd)`，**stats 永远为空 → 前端每文件 +N/−M 从未显示**）。
2. `plugins/desktop-sidebar/src/git-workspace.ts`（facts：ahead/behind/remote，execFile）：4s 轮询里每次都跑 ahead/behind 子进程。
3. 两处都**没有 `core.quotePath=false`** → 非 ASCII/特殊字符路径会被 git 转义（潜在 bug）。

**参考项目实现（apps/server/src/git/，status/patch/branch/worktree/github 六大 operations + GitManager 2800 行）**：
- `statusDetails` = **`git status --porcelain=2 --branch` 单命令**（branch + ahead/behind + 工作树变更一次拿全，1 次子进程）。
- `sourceControlStatusDetails` = porcelain=2 + staged/unstaged 两条 `diff --numstat -M`（`core.quotePath=false`）+ untracked 统计 → **一次 RPC 带每文件增删**。
- `gitStatusCache`：local/remote 拆分缓存，local fingerprint 复用（无变化不重发），remote TTL 30s（ahead/behind/PR 复用）。
- `GitStatusBroadcaster`：Effect PubSub 事件流，status 变化才广播（多端实时 UI 用）。
- `readMoveAwareWorkingTreeSummary`：复制 index 到临时文件 → `git add -A` → `diff --cached --numstat --find-renames`（**重命名感知**的整树统计，不污染真实暂存区；更准但开销大）。
- `executeGit`：timeoutMs + **maxOutputBytes** + 分类错误（isMissingGitCwdError 等）。
- patch 读取带 **status 分类**（text/patch/binary/large/missing/unsupported）→ 前端 `DiffDocument` 直接消费（Phase E 前置）。
- 前端消费：RPC（`git.sourceControlStatus` / `git.readDiff`）+ Effect Schema 解码；SourceControlRuntime 主动拉取 + soft-revalidate（非事件流订阅）。

**迁移必要性结论**：

| 项 | 参考项目 | 当前插件 | 建议 |
|---|---|---|---|
| status 读取 | porcelain=2 --branch 单命令 | v1 + 独立 branch（3 次子进程） | **迁移**：1 次子进程拿全量（含 ahead/behind） |
| 每文件增删统计 | status+numstat 合并一次 RPC | stats 契约存在但**服务端从未填充**（坏的） | **迁移**：修复契约缺口 |
| 非 ASCII 路径 | 多处 `core.quotePath=false` | 无（潜在乱码 bug） | **迁移**：低成本高正确性 |
| 输出上限/超时 | maxOutputBytes + timeoutMs 参数化 | 固定 30s SIGKILL | **迁移**：低成本 |
| remote 状态缓存 | local/remote 拆分 + TTL 30s | facts 每次轮询重跑 ahead/behind | **可选**：服务端加 remote TTL 缓存 |
| diff status 分类 | text/binary/large/missing/unsupported | 只返回 {diff}（isNoTextDiff 靠猜） | **Phase E 前置**：DiffViewer 移植需要 |
| 事件流广播 | GitStatusBroadcaster（PubSub） | 客户端轮询 4s | **不迁移**：单机插件用客户端 runtime 缓存（Phase B）覆盖 |
| 重命名感知统计 | 复制 index + 临时 add | 无 | **不迁移**：开销大，无此需求 |
| Effect 架构 / GitManager | 2800 行编排 + GitHub/PR/stash | — | **不迁移**：超出需求，Promise 风格即可 |
| 两套 git 封装 | 单一 GitCore | better-sidebar-runtime + git-workspace 两套 | **统一**：后端先收敛为一套 |

### 5.3 中间 Tab 模块报告（已完成 ✅，子代理 c5a470f9 完整报告）

**一句话结论**：Center Surface 不是通用 Tab 组件库，而是一条"**纯同步 identity store 为核心、URL 为唯一外部回显通道、command registry 为唯一写入口**"的架构约定。全部 tab 语义收敛在 `center-surface-store.ts`（483 行）。无路由插件只需移植 **store + types + renderer 注册表 + Tab UI 四块**，URL bridge 整体剥离、localStorage 替代。

**数据模型**：
- id 是"可解析的规范化字符串"（identity 唯一事实来源）：`conversation:${threadId}` / `diff:${worktreeId}:${scope}:${filePath}` / `file:${workspaceId}:${filePath}` / `multi-diff:${worktreeId}:${scope}` / `terminal:${worktreeId}` / `coordination:${workspaceId}`。
- surface 对象**只存 identity + 少量视觉状态**（isPreview、markdownPreviewEnabled），**绝不存业务数据**（title 由 runtime 派生，test 断言 conversation surface 无 title 字段）。
- state = `byWorkspaceId => {open: CenterSurface[], activeId}`；纯内存 zustand、无 persist、**刷新即丢**（持久化刻意交给 URL bridge）。

**临时/固定语义（唯一实现点 `openPreviewableSurface`，125-194 行）**：
- 已存在同 id → 只激活；以 `preview:false` 打开则升级为固定。
- `next.isPreview`（默认 true）→ **过滤掉所有其他 preview surface**，只留最新一个 → "点下一个临时替换"。
- `pin()` 清 isPreview 脱离替换池（双击触发）。
- conversation/multi-diff/terminal/coordination 恒固定（isPreview:false），**会话 Tab 永不参与临时替换**。
- 单测兜底（center-surface-store.test.ts）："replaces the preview tab on single-click open and pins on double-click open"。

**双击事件来源**：Explorer/SourceControl 行 `onClick → onSelectFile(path, true)`、`onDoubleClick → (path, false)`；Tab 条上双击 → `onPin()`（仅 preview surface 传入）。

**完整链路（点击文件 → 中间 Tab）**：
```
Explorer 单击文件 → onSelectFile(path, true) → execute(OpenWorkspaceFile, {preview:true})
  → command handler → useCenterSurfaceStore.getState().openFile({..., preview:true})
  → openPreviewableSurface（替换/追加）→ store 更新 → CenterSurfaceTabs 重渲 + CenterSurfaceBody 渲 active
```

**renderer 注册表**：`SurfaceRendererRegistry`（Map<kind, renderer>，重复注册抛错、未注册 render 返回 unavailable）；renderer 收 `surface` prop，解构业务 id 分发到 feature 组件。主机 `CenterSurfaceTabs`（tab 条：`CenterNewThreadControl` + `SurfaceTabStrip` + map open）与 `CenterSurfaceBody`（registry.render(active)）。

**SurfaceTab UI**：chip div（role=tab、data-state、data-preview、aria-selected）+ 图标（hover 换关闭 X）+ 标题（preview 斜体）+ SurfaceTabAction（data-surface-tab-action，stopPropagation）+ pointerdown/click 去抖（selectedOnPointerDownRef）+ 双击 pin + hover prewarm。CSS 全走 `var(--...)` token（`control-height-icon`、`surface-selected`、`font-size-caption`…）。

**"项目下所有对话"列表**：参考项目里在**左栏 ScopeSidebar**（Project 维 → Worktree → 会话列表），点击会话 → OpenThread 命令 → `openConversation`（固定 tab，可同时开多个）。**插件移植**：无 ScopeSidebar，可直接用 `SessionsService.list`（按 cwd 过滤）作为会话列表数据源；conversation tab 与 file/diff tab 是同一 open 数组的项，仅 isPreview 不同。

**URL bridge 剥离结论**：store 不 import router/bridge（单向依赖），剥离零改动。插件方案：删 `surface-route-search.ts` + `surface-route-bridge.ts`；持久化用 store 之上加 `subscribe → localStorage`（**不要用 zustand persist 中间件**，会污染纯 identity 设计）+ 启动时 `open*` 重建；`byWorkspaceId` 简化为固定单 key（如 `"default"`）。

**移植清单**：
- 直接搬：`types.ts`（id helper + resolveActiveSurface + isPreviewSurface）、`center-surface-store.ts` + 单测、`surface-renderer-registry.tsx`、`surface-tab.tsx` + test、theme/surface.ts 的 Tab recipes。
- 整体剥离：`surface-route-search.ts`、`surface-route-bridge.ts`、`conversation-surface-meta.ts`（插件读本地会话 model 即可）。
- 替换：持久化（localStorage KV）、单 key 化、写入口（插件直接调 `store.getState().openX({preview})`）、host 骨架（去掉 ComposerWarmPoolHost/CenterNewThreadControl/PathSurfaceChrome 等 Synara 专属壳）、token 对应插件主题。

### 5.4 Diff 组件族报告（已完成 ✅，子代理 6dc338dd 完整报告）

**一句话架构**：diff 的"数据结构/策略逻辑/渲染底层"分离——`DiffViewer` 是**唯一**渲染入口，对内用统一实体 `DiffDocument`，对外重构成 patch 文本交给 **Pierre (`@pierre/diffs`)** 做行级渲染、语法高亮与虚拟化；多文件视图外层用懒渲染 + 性能策略控制哪些文件真正 mount，已 mount 的文件再嵌入同一个 `WorkingTreeDiffFeature` → `DiffViewer`。

**层级图**：
```
source-control-panel-view.tsx ← 变更清单（不渲染 diff 行，只做入口）
  → WorkingTreeDiffFeature.tsx（RPC 取 patch + 偏好/主题）
    → WorkingTreeDiffViewModel（loadState → phase: loading/blocked/ready）
      → WorkingTreeDiffView.tsx（toolbar + header + viewer / 阻塞态）
        ├─ DiffToolbar.tsx（Unified/Split + 换行）
        ├─ DiffFileHeader.tsx（路径 + +N −M + 外部打开）
        └─ DiffViewer.tsx  ◄──── 唯一渲染组件
             ├─ buildPatch()（DiffDocument → patch 文本）
             └─ renderPierreDiff()（parsePatchFiles → <FileDiff> → <Virtualizer>）
多文件：WorkingTreeMultiDiffFeature → MultiDiffFileStack（placeholder / 已mount）
  └─ 已 mount → WorkingTreeDiffFeature(embedded) → DiffViewer(virtualize=false)
```

**渲染要点**：
- unified/split 由 Pierre `FileDiff{diffStyle: layout}` 处理，项目不手写 split 双栏。
- 词级 inline diff **显式关闭**（`lineDiffType:"none"`）；语法高亮在 Pierre worker 内（Shiki）。
- 虚拟化：`virtualize=true` 包 `<Virtualizer overscrollSize:300>`；大文件由 ViewModel `status:"large"|"binary"` 预先判停，不把超大 patch 交给渲染层。
- 缓存：`cacheKey = workspace:${path}:${layout}:${wrap}:${virtualize}`——切换布局时重建 patch 换缓存。
- fallback：解析失败降级 `RawDiff`（用 DiffDocument.lines 手写 `<ol>`）。

**worker 池**（pierre-diff-worker-pool.tsx）：`WorkerPoolContextProvider`，`poolSize = max(2, min(6, hardwareConcurrency/2))`，AST LRU 240，`tokenizeMaxLineLength:1000`；worker 经 Vite `?worker` 合成——**非 Vite 构建需替换引入方式**。

**数据模型**：`FileChangeKind`（added/modified/deleted/renamed/unchanged）、`DiffLineKind`（context/added/removed/hunk）、`DiffDocument {path, change, additions, deletions, lines}`、`buildDiffDocument(entry)`（patch 解析 + 统计覆盖）、`DiffLayoutStyle = unified|split`。

**懒渲染与性能策略**：
- `entities/lazy-file-render.ts`：INITIAL_COUNT=6、KEEP_RADIUS=10、MAX_CONCURRENT=1、OBSERVER_ROOT_MARGIN="320px 0px"；调度器带 generation 使在途完成失效。
- `multi-diff-performance-policy.ts`：≥25 文件或 ≥2000 增删行 → 默认全折叠；≥80 → capped（keepRadius=4）；正常首屏 mount 6。
- 两处 IntersectionObserver：placeholder 进入视口触发挂载（autoPrefetch=false 时不自动）；multi-diff feature 估算可视顶部文件 → `retainAround` 渲染窗口。
- **未挂载行不发 file-diff RPC**。

**偏好**：`diff-view-preferences.ts`（zustand，layout="unified"、wordWrap=false，**session 级不持久化**）——插件如需持久化需自接 storage。

**移植清单**：
| 模块 | 文件 | 依赖 |
|---|---|---|
| 纯实体 | `entities/file-kind.ts`、`file-diff.ts`、`diff-layout.ts`、`lazy-file-render.ts`、`multi-diff-performance-policy.ts` | 零外部依赖 |
| 渲染核心 | `components/diff-viewer.tsx` + css、`adapters/pierre-diff-adapter.tsx`、`pierre-diff-worker-pool.tsx` | `@pierre/diffs@^1.2.12`（+ `/react`、`/worker`） |
| 外壳 | `diff-toolbar`、`diff-file-header`、`diff-view-preferences` | zustand |
| 单文件 feature | `working-tree-diff-{feature,view,view-model}` | 数据源需替换 |
| 多文件（可选） | `multi-diff-file-stack`、`use-lazy-file-render-set`、`working-tree-multi-diff-*` | 同上 |

**需剥离/替换**：transport/RPC（`readWorkingTreeFileDiff` → 插件 `betterSidebarApi.gitDiff/gitCommitDiff`）、i18n（useLingui → 插件 i18n）、主题解析（→ DSW token 映射）、UI 原语（empty/skeleton/button/tooltip/context-menu/scroll-area/list-row/FileIcon/FilenameLabel）、CSS token、worker 引入方式。

**落地要点**：强制单入口（只允许 `DiffViewer`）；数据源接口注入（`DiffSource { readFile(path, oldPath, scope) }`）；worker 池可整体复用；若只收敛单文件场景，先搬 entities + diff-viewer + adapter + worker-pool + toolbar + header。
