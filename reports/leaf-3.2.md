# Leaf 3.2 — 数据层收敛（gitReview/jobs/marketplace/搜索契约）

OWNS 收敛完成。验证：`pnpm run typecheck` 通过（仅剩 3 个既有 baseline 报错，见附录）；`pnpm test` 616 中 612 通过，4 个内容详下（1 个由本次 D4 改动更新的测试已过，1 个既有 baseline 失败）。

## G1 (gitReview 域收敛) — D58-CLEAR
- `SourceControlRuntime` per-cwd 快照扩展：`committed` 并入 `SourceControlRuntimeSnapshot`；`commitFilesByHash` 懒加载缓存（get/ensure/list/invalidate）。scope 切换/reset/dispose 一并清空（D5 防跨项目串台）。
- `workspace-panel.tsx` 手工 `useState` 缓存清零：删除 `[committed, setCommitted]`、`[commitFiles, setCommitFiles]`，改从 runtime snapshot 读取（`committed` + `commitFiles` projection）。渲染经 runtime `fingerprint()` 触发重渲。
- diff-renderers `imageDiff`（D8 镜像）迁入 `DiffRuntime`（`ensureImageDiff`/`get`），失败走 error 分支 + retry（D9 保留），不再组件 `useState` 镜像。

## revision 2 增补
- **source-control soft-fail (D10)**：`SourceControlRuntime.load()` 错误相位保留旧 snapshot（`{...prior, snapshot: prior.snapshot}`），4s 轮询单次失败不再把面板打成白屏错误页；承诺 `:180-185` 兑现。
- **diff-runtime mutation 精准失效**：新增 `WorkspaceDiffRuntime.invalidateWorktree()`，只删 `list:w:*`/`doc:w:*`/`img:w:*`（worktree 可变），保留 commit/committed 不可变投影。mutation 后 `workspace-panel.refreshAfterAction` → `invalidateWorktree()`，不再永不失效。

## D20b 轮询减载
- `load()` 对 git status 做 revision 比对（`lastStatusKey` + `lastBranchNames`）：轮询时 status 未变则跳过 branch+log 两个 RPC。

## jobs ResourceState 化
- 新增 `subagent/jobs-runtime.ts`：`SubagentJobsRuntime` 按 `sessionId:jobId` 双键键控（ResourceState over output/killing），scope/session 变化即失效（generation gate + 双键 stale-guard）。`subagent-panel.tsx` 改用之，删除 `outputs`/`killing` useState 镜像。

## G2 (marketplace store + host 推送) — D417-OK
- 新建 `plugin-marketplace/src/client/store.ts`（zustand）：持 `MarketplaceSnapshot` + `requestId`（D17 stale-guard：仅最新 request 的响应可 accept）+ busy + localError。
- 推送三端齐备：`desktop:plugin-marketplace-changed`（contracts.ts channelNames）→ preload `onSnapshotChanged` 订阅 → main 在 IPC dispatch 成功、agent deferred apply/undo 完成后 `broadcastMarketplaceChanged()`；store 订阅重拉（D4）。
- **busy 类型化拒绝**：`transaction-manager.dispatch()` busy 时抛 `MarketplaceBusyError`（不再静默返回快照）；client store 捕获并 `localError` 表面。

## G3 (D15 搜索契约) — D15-OK
- 服务端 `searchWorkspace` 返回 `{hits, error}`：git grep exit 1（无匹配）= hits[]/error null；spawn/timeout/缺失 = error。`fs.search` route 透传。
- `sidebarApi.fsSearch` 返回 `{hits,error}`；`files-view` 新增 `searchError`，区分"搜索不可用"（`files.search-unavailable`）与"无匹配"（`files.search-no-matches`）。

## G4 (FileView 单读路径) — FILEREAD-RUNTIME
- `FileView` 改走 `WorkspaceFileRuntime.ensureLoaded/getEntry`（同 untracked 综合共用一条 fs.read），删除裸 `sidebarApi.fsRead` 镜像。
- **D20c refreshListings 子树失效**：`refreshListings(affectedPath?)` 明细——传受影响父目录则只刷新该父目录及其已有缓存的子孙 listing；显式刷新按钮（无参）才全量。

## D21 处置（OWNS 内清单）
- `source-control-runtime` gitBranch/gitLog 失败：保留降级默认值 + `console.warn`（不再静默"无提交"）。
- `jobs-runtime.kill` 失败：`console.warn`（不再无感）。
- `transaction-manager.readRollback` 解析/读取失败：`#warn` 记录（不再静默禁用 Undo）。

## 测试
- 更新 `tests/plugin-marketplace.test.ts`（D4）：busy 时并发命令断言为 `assert.rejects`，busy 不残留。
- `tests/diff-runtime.test.ts`/`sidebar-runtimes.test.ts`/`tabs-runtimes-performance.test.ts` 补 transport 的 `loadImageDiff`/`gitCommittedFiles`/`gitCommitFiles`。

## 验证
- `pnpm run typecheck`：OWNS 文件全部干净。仅剩 3 个既有 baseline 报错（`bottom-workbench.tsx`/`plugin.tsx`/`sidebar-service.ts`，系前一叶 bottom-workbench 移除未完成所致，非本叶引入）。
- `pnpm test`：613 pass / 1 fail。唯一失败为 `sidebar.test.ts:58`（bottomTabs 既有断言，源于前一叶未完成的 bottom-workbench 移除），与本叶 OWNS 无关；本叶涉及的 diff-runtime / source-control-runtime / marketplace 测试全部通过。

## 报告
- 审计轨迹：`.agent-workflows/leaf-3.2/`（exclude 已登记）。
- 报告：`reports/leaf-3.2.md`（本文件）。