# Oh-DSH 右侧栏组件重构 / 移植改造计划

> 依据：`docs/synara-port-exploration.md`（探索报告，含全部代码证据）。
> 目标：把参考项目（Synara web-next）成熟的组件架构移植进 oh-dsh-desktop 右侧栏插件，
> 统一组件、引入外置缓存、收敛 Diff 实现、新增中间 Tab 模块。
> 状态：**实施中** — Phase A ✅ / B2 ✅ / B ✅ / C ✅ / D ✅ / E ✅ / F ✅（2025-08-15）。

---

## 进度看板

| 阶段 | 状态 | 交付 |
|------|------|------|
| A 基座原语 | ✅ 完成 | `plugins/shared/runtime.ts`、`middle-truncate-text.ts`、`filename-display.ts`、`list-row.tsx/.css`、`filename-label.tsx/.css` + 16 用例 |
| B2 后端 Git | ✅ 完成 | `plugins/shared/git-core.ts`（porcelain v2 单命令 + quotePath + maxOutputBytes）、git.ts re-export、sidebar-api statusV2、git-workspace 统一 + 6 用例 |
| B 客户端缓存 | ✅ 完成 | `runtimes/`（registry/explorer/source-control/file/chrome-store）+ FilesView/WorkspacePanel 订阅改造 + 9 用例 |
| C 树统一 | ✅ 完成 | FilesView 固定树（删下钻）、两树统一 ListRow+FilenameLabel、file-tree-model 纯树展开、删两套行 CSS |
| D 中间 Tab | ✅ 完成 | `surfaces/`（store preview-pin 语义 + localStorage + Tab UI + host overlay + renderers）+ 写入口 + DetachedPanel 删除 + 6 用例 |
| E 统一 Diff | ✅ 完成 | `diff/`（file-diff 实体 + pierre-adapter worker 池 + DiffViewer 单一渲染入口 + RawDiff 评论面）+ 中间 Tab diff renderer 切换 + 提交审阅切换（行点击评论保留）+ **删除 diff-view.tsx / parse-unified-diff.ts** + 5 用例 |
| F 收尾 | ✅ 完成 | 删死代码（files.mode i18n、review-diff-lines 旧行样式、chrome-store fileBrowseMode）、文档更新、全量回归 |

> 全量验证：typecheck 0 错误 / 133 测试 132 通过 / build 成功。

---

## 零、已定稿的决策（用户批准 / 技术裁决）

| 决策点 | 定稿 | 理由 |
|--------|------|------|
| `zustand` | **引入 ^5** | 与参考实现保持最小 diff（center-surface-store/chrome-store/diff-preferences 全部用它），后续同步上游时 diff 小；纯 JS 无构建负担 |
| `@pierre/diffs` | **引入 ^1.2.12** | 统一 Diff 渲染核心（行号/高亮/虚拟化），Phase E 使用；worker 用 `new Worker(new URL(...))` 适配 esbuild |
| `@legendapp/list` | **延后**（Phase C 二期） | 先 ScrollArea 全量；≥200 行阈值再上虚拟化 |
| Git 库 | **不引入现成库** | nodegit（native 编译/ABI/维护风险）、isomorphic-git（性能差 1-2 个数量级）、simple-git/dugite（纯封装无性能提升）。性能提升来自**命令合并 + 缓存**（porcelain v2 单命令 + runtime 缓存，GitHub Desktop 同款模式） |
| Git 抽离 | **`plugins/shared/git-core.ts` 共享模块** | 左栏插件已共用 `git.worktree-list`/worktree 创建路由——左右插件服务端统一 import 同一实现；沿用现有 shared 源码 import 模式，无新构建管线 |
| DetachedPanel | **删除**（Phase D 落地时） | 用户裁决：悬浮窗体验差；文件/Diff 预览改为中间 Tab 显示（`overlay.*` i18n 文案随组件删除清理） |

---

## 一、改造目标（对应用户诉求）

| # | 目标 | 现状问题 | 改造方向 |
|---|------|---------|---------|
| G1 | 通用列表/树组件，两棵树同一组件不同变体 | `.oh-dsh-sc-row` 与 `.oh-dsh-files-row` 两套独立 CSS/组件 | 移植 `ListRow` 原语族，Explorer 与 Git 面板统一构建 |
| G2 | 文件名中间省略 | CSS 尾部省略 | 移植 `FilenameLabel`（Canvas 测量 + 二分 + 扩展名保留） |
| G3 | 目录树外置缓存，切换秒显 | `entriesByDir` 归组件私有，切 Tab 即丢重拉 | 移植 runtime 保留注册表 + 懒加载缓存 + soft-revalidate |
| G4 | 中间 Tab 模块（会话 + 文件/Diff/浏览器 tab，临时替换语义） | 无中间模块；文件/Diff 在侧栏内或浮窗 | 移植 CenterSurfaceStore + SurfaceTab，中间列挂 Tab 条 |
| G5 | 单一 Diff 组件族 | `diff-view.tsx` + `review-diff.ts` 两套并存 | 引入 `@pierre/diffs` + 移植 DiffViewer 管线，删除旧实现 |
| G6 | 树交互：点击展开而非下钻 | flat/nested 模式点击目录 = 下钻导航 | 默认树模式，目录点击展开/收起 |

---

## 二、引入的依赖（决策点）

| 依赖 | 用途 | 版本（参考项目） | 决策 |
|------|------|-----------------|------|
| `@pierre/diffs` | diff 行级渲染 / 语法高亮 / 虚拟化（G5 核心） | ^1.2.12 | **建议引入**（含 `/react` 与 `/worker` 子路径；worker 需适配 esbuild 构建） |
| `@legendapp/list` | 行级虚拟化（G1/G6，≥200 行时启用） | ^3.3.3 | **可延后**（Phase C 二期；先用 ScrollArea 全量渲染） |
| `zustand` | CenterSurfaceStore / chrome store / diff 偏好（G4） | ^5.0.14 | **待定**：引入则移植代码改动最小；不引入则改写为 useSyncExternalStore 自定义 store（插件现有风格） |
| `@react-symbols/icons` | 文件图标 | 已有（^1.4.1） | ✅ 无需新增（`FileGlyph` 已基于它） |
| `@tabler/icons-react` | UI 图标 | 已有 | ✅ 无需新增 |

> 不引入：`@base-ui/react`（ScrollArea 用原生 overflow 替代）、`@lingui/react`（用插件 i18n）、`effect`（用自写 runtime 原语）、`clsx/tailwind-merge`（用模板字符串拼类名）。

---

## 三、分阶段改造计划

### Phase A — 基座原语移植（纯搬移，无行为变化）
**新文件（plugins/shared/）**：
- `runtime.ts` — 移植 `RevisionedStore / GenerationGate / SubscriptionScope / ScopedRuntimeRegistry / ResourceState`（纯 TS，零依赖）
- `middle-truncate-text.ts` + `filename-display.ts` — 移植中间省略纯函数
- `list-row.tsx` + `list-row.css` — 移植 ListRow 原语族（token 映射到 `--oh-dsh-*` / `--dsw-alias-*`）
- `filename-label.tsx` + `filename-label.css` — 移植中间省略组件（基于 ListRowLabel）
- `tests/runtime.test.ts` — 原语单测

**验证**：`pnpm typecheck` + `pnpm test`（node --test）。
**验收**：无插件行为变化；新原语可被 Phase C 引用。

### Phase B — 数据缓存层（解决"切换秒显"）
**新文件（plugins/desktop-sidebar/src/client/runtimes/）**：
- `registry.ts` — 模块级 `ScopedRuntimeRegistry`，key = `sessionId:cwd`
- `explorer-runtime.ts` — 移植 `WorkspaceExplorerRuntime`（phase 状态机 + generation + LRU 64 + inflight 去重），transport = `betterSidebarApi.fsTree`
- `source-control-runtime.ts` — 移植 `SourceControlRuntime`（status/branch/log 快照 + soft-revalidate），transport = `betterSidebarApi.gitStatus/gitBranch/gitLog`
- `file-runtime.ts` — 移植 `WorkspaceFileRuntime`（fsRead 缓存）
- `chrome-store.ts` — UI 态（collapsed/selected/mode）持久化（localStorage 或沿用偏好 HTTP 路由）

**改动**：`FilesView` / `WorkspacePanel` 改为订阅 runtime 快照（`useSyncExternalStore` + fingerprint），删除组件内 `entriesByDir` / 轮询 state。
**验收**：文件列表 ↔ Git 列表切换零网络命中缓存；Ready 状态刷新不闪 loading。

### Phase B2 — 后端 Git 能力升级 + 抽离共享模块（参考项目对比结论，见探索报告 5.5）
**动机**：参考项目 Git 后端在"status 读取、每文件统计、非 ASCII 路径、diff 分类"上明显更优；当前插件还有两个坏点（stats 契约从未填充、两套 git 封装并存、无 quotePath 处理）。左栏插件也依赖 `git.worktree-list`/worktree 创建 → **git 能力抽为共享模块**。

**新文件（plugins/shared/git-core.ts）**：从 `better-sidebar-runtime/src/git.ts` 抽出并升级：
- spawn 封装（timeoutMs + maxOutputBytes + 分类错误）
- porcelain v2 解析（`status --porcelain=2 --branch` 单命令：branch + ahead/behind + 变更一次拿全）
- porcelain v1 -z 解析保留（兼容现契约）→ 统一升级 v2
- numstat 解析（`-M` 重命名检测）
- 命令构造全部带 `-c core.quotePath=false`
- worktreeList/worktreeAdd 一并迁入（左栏共用）

**改动**：
1. `better-sidebar-runtime/src/git.ts` 改为 re-export / 薄接线 `shared/git-core`，`git.status` RPC **合并 numstat**（修复 stats 契约缺口：每文件 +N/−M 真正返回）。
2. `desktop-sidebar/src/git-workspace.ts` 的 facts（ahead/behind/remote）复用 status 单命令结果，删除重复子进程。
3. `desktop-left-rail` 服务端切到 `shared/git-core`（worktree-list/worktree-add）。
4. 可选：remote 部分（ahead/behind）服务端 TTL 缓存（30s）。

**Phase E 前置**：`git.diff` RPC 增加 status 分类（text/patch/binary/large/missing/unsupported），供统一 DiffViewer 消费（对齐参考项目 `SourceControlFileDiffSnapshot`）。

**不迁移**：GitStatusBroadcaster 事件流（客户端 Phase B 缓存覆盖）、readMoveAwareWorkingTreeSummary（过重）、Effect 架构 / GitManager / GitHub/PR/stash（超出需求）。

### Phase C — 树组件统一（G1/G6）
**改动（plugins/desktop-sidebar/src/client/）**：
- `FilesView`：删除 flat/nested 下钻，默认树模式，目录点击展开/收起；行渲染改用 ListRow + FileGlyph + FilenameLabel
- `SourceControlPanel`：行渲染改用 ListRow 原语（Section/Directory/File 三行），trailing 状态标 + hover 动作层保留语义
- 删除两套独立行 CSS（`.oh-dsh-sc-*` 行样式与 `.oh-dsh-files-*` 行样式），统一到 list-row.css
- （二期）`@legendapp/list` 虚拟化（阈值 200 行）

**验收**：两棵树同一原语构建；间距审计（docs/sidebar-spacing-audit.md）回归通过。

### Phase D — 中间 Tab 模块（G4，含 DetachedPanel 删除）
**新文件（plugins/desktop-sidebar/src/client/surfaces/）**：
- `types.ts` — 移植 id helper（`conversationSurfaceId/diffSurfaceId/fileSurfaceId/...`）+ `resolveActiveSurface` + `isPreviewSurface`（纯类型+函数，零依赖）
- `center-surface-store.ts` — 移植核心 store（`byWorkspaceId => {open, activeId}` + `openPreviewableSurface` preview/pin 语义），基于 **zustand**（已定稿引入）
- `surface-renderer-registry.tsx` — 移植 kind → renderer 注册表
- `surface-tab.tsx` + css — 移植 Tab chip/strip UI（图标/关闭/preview 斜体/双击 pin/hover prewarm；图标用插件 tabler-icons，token 映射 `--oh-dsh-*`）
- `center-surface-host.tsx` — 移植 host 骨架（Tab 条 + body），去掉 Synara 专属壳
- 中间列顶部固定定位 Tab 条 overlay（类似 `#oh-dsh-desktop-sidebar-root` 挂载方式）
- `tests/surface-tab.test.tsx` / store 单测 — 移植"preview 替换/pin 固定"语义验收

**改动**：
- 持久化：**剥离 URL bridge**（删 surface-route-search/bridge），store 之上加 `subscribe → localStorage` + 启动时 `open*` 重建（不用 zustand persist 中间件）；`byWorkspaceId` 简化为固定单 key `"default"`
- 会话 Tab：来自 `SessionsService.list`（按 cwd 过滤 = 当前项目所有对话），恒固定（isPreview:false），可同时开多个
- 写入口：文件双击/右键"打开"→ `openFile({preview:false})`、单击预览 → `openFile({preview:true})`；Git 变更点击 → `openDiff`；浏览器 → 中间 browser Tab
- **删除 `DetachedPanel`**（detached-panel.tsx/.css + FilesView 预览弹窗 + WorkspacePanel overlay 弹窗 + `overlay.*`/`workspace.*` 相关 i18n）：文件/Diff 一律改为中间 Tab 显示（`openFile`/`openDiff`），`onSelectFile` 语义对齐参考项目（单击 preview / 双击固定）

**验收**：单击文件 = 临时 Tab（下一个替换）、双击 = 固定；切换会话 Tab 激活对应会话；重启后 tab 集合还原；**DetachedPanel 相关代码与样式完全移除**。

### Phase E — 单一 Diff 组件族（G5）
**新文件（plugins/desktop-sidebar/src/client/diff/）**：
- `file-diff.ts` — 移植 `DiffDocument` 实体
- `diff-viewer.tsx` + css — 移植薄壳（buildPatch + meta + RawDiff fallback）
- `pierre-adapter.ts(x)` — 移植 `renderPierreDiff`（worker 池；esbuild 构建下 worker 需 `new Worker(new URL(...))` 方式引入）
- `diff-toolbar.tsx` + `diff-file-header.tsx`（偏好：布局/换行）

**改动**：`WorkspacePanel` 变更 overlay 与提交审阅改用统一 DiffViewer；**删除** `diff-view.tsx` 与 `review-diff.ts` 内联渲染（保留 parse-unified-diff 作为 RawDiff fallback 的输入或删除）。
**验收**：全插件仅一种 Diff 渲染组件；提交审阅行级评论功能保留（评论目标仍可挂在 DiffViewer 行上）。

### Phase F — 集成与验证
- 秒显验证（缓存命中）、临时/固定 Tab 语义、间距审计回归、快捷键/设置项回归
- 删除死代码（`.oh-dsh-change-row` 旧样式等）
- 更新文档（sidebar-architecture-analysis.md / 本计划）

---

## 四、每阶段风险与决策点

| 阶段 | 风险/决策 |
|------|----------|
| A | 无（纯搬移）；注意 tsconfig `exactOptionalPropertyTypes` 下 props 写法 |
| B | scope key 语义：插件用 `sessionId:cwd`；会话切换时 key 变化需正确处理 |
| B2 | porcelain v2 解析与 v1 兼容性（rename/copy/子模块）；stats 修复后前端行徽章行为变化需验收 |
| C | 行样式统一可能引入视觉回归 → 用 CDP 实测对照（沿用 spacing-audit 方法） |
| D | **zustand 引入与否**（用户拍板）；中间 Tab 条与 DSH 会话区 DOM 的遮挡关系需实测 |
| E | `@pierre/diffs` worker 在 esbuild（非 Vite）构建下的引入方式；`review-diff` 行级评论功能需在 DiffViewer 上保留点击目标；依赖 B2 的 diff status 分类 |
| F | DetachedPanel 退场节奏（先保留，后移除） |

---

## 五、执行顺序（定稿）

1. **Phase A** — 基座原语（runtime.ts / ListRow / FilenameLabel / 中间省略纯函数，纯搬移无行为变化）
2. **Phase B2** — 后端 Git 升级 + `shared/git-core.ts` 抽离（独立可验收：status 更快、行统计显示、左栏共用）
3. **Phase B** — 客户端缓存层（独立可验收"秒显"）
4. **Phase C** — 树统一（依赖 A+B）
5. **Phase D** — 中间 Tab（含 **DetachedPanel 删除**；依赖 A；diff tab 先临时复用现有 DiffView）
6. **Phase E** — 统一 Diff（依赖 A+B2 的 diff 分类；替换 D 中临时 DiffView）
7. **Phase F** — 收尾（死代码清理、文档、回归）

> 质量纪律：每阶段独立验证（`pnpm typecheck` + `pnpm test` + dev 实测），
> 不为了赶进度牺牲可维护性；新代码带单测；删代码连带清 i18n/样式/文档。
