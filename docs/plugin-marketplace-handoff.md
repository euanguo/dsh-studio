<p align="center">
  <strong>简体中文</strong> ·
  <a href="./plugin-marketplace-handoff.en.md">English</a>
</p>

# Oh-DSH 插件市场改造交接文档

> 交接对象：下一位实现 Agent / 工程师
>
> 当前状态：P0 产品代码已接入当前分支，正在进行静态验证和只读审查；没有启动真实 DSH 或执行真实插件安装。

## 1. 先读什么

按以下顺序阅读：

1. 本文；
2. [`docs/plugin-marketplace-expansion-plan.md`](./plugin-marketplace-expansion-plan.md)；
3. `.agent-workflows/dsh-market-research/feature-comparison.md`；
4. `.agent-workflows/dsh-market-research/dsh-marketplace-assessment.md`；
5. `.agent-workflows/dsh-market-research/audit.md`；
6. 仓库根目录 `AGENTS.md`、`plugins/AGENTS.md`、`docs/design.md`。

`.agent-workflows/` 已由现有 exclude 规则忽略。不要删除、重复添加或改写这些 exclude 条目。

## 2. 当前代码事实

### 2.1 产品入口

- marketplace protocol：`plugins/plugin-marketplace/src/protocol.ts`
- catalog parser：`plugins/plugin-marketplace/src/catalog.ts`
- Host platform：`plugins/plugin-marketplace/src/host/platform.ts`
- transaction owner：`plugins/plugin-marketplace/src/host/transaction-manager.ts`
- Agent gateway：`plugins/plugin-marketplace/src/host/agent-gateway.ts`
- Agent tools：`src/marketplace-tools.ts`
- Desktop bridge：`src/main.ts`、`src/preload.ts`
- Desktop UI：`plugins/plugin-marketplace/src/client/plugin.tsx`
- marketplace tests：`tests/plugin-marketplace.test.ts`
- Agent tests：`tests/plugin.test.ts`
- Web omission test：`tests/web-profile.test.ts`

### 2.2 已经存在，不要重复造

1. catalog raw fetch、ETag、两小时 TTL、stale fallback；
2. 三种旧 catalog schema 的读取；
3. protected plugin 判断；
4. exact commit manifest 读取；
5. macOS Seatbelt preview sandbox；
6. build script 白名单和逐脚本执行；
7. isolated candidate profile；
8. bundle `dsh plugin` reconcile；
9. runtime preview；
10. atomic profile rename；
11. apply failure recovery；
12. single Undo point；
13. loopback token gateway；
14. UI/Agent 共用 transaction owner。

新实现应该加深这些模块背后的 seam，而不是另起一个安装器、Loader、profile root 或 UI kit。

## 3. 当前最危险的假象

### 3.1 repository plugin 是 dead path

当前 pinned DSH 是 `deepseek-harness` commit `99f6f02fecdb…` / `0.1.0-rc.7`。

上游 `app-boot/profile.ts` 和 `apps/cli/src/plugin.ts` 只消费：

- `package.json#dsh.bundle.patch`；
- `dsh.profile.bundles`；
- 声明 `dsh.bundle` 的 package dependency。

它不消费 Oh-DSH 写入的 `repository-plugins` / `config.repositories` patch。当前 `transaction-manager.ts:392-423,852-854` 的 repository branch 可能写文件、更新 state 或在 FakePlatform 中返回成功，但真实 Loader 会跳过不存在的 entry。

处理规则：

- `.dsh-plugin` 可读取用于返回精确不兼容原因；
- candidate 必须是 `guide-only` 或 `blocked`；
- 不得生成可 apply 的 repository plan；
- 必须有真实 pinned DSH contract test 防止回归。

### 3.2 当前命令只接受 pluginId

`protocol.ts:160-173` 的 command 没有 `SourceRef`。`transaction-manager.ts:735-785` 的 install/update 要求 plugin 已经在当前 catalog。

因此当前系统不能证明“任意公开仓库可安装”，只能证明“catalog row 可安装”。这是 P0 改造，不是 UI 小改。

### 3.3 current source adapter 强制 gh

`platform.ts:535-584` 的 commit/read/clone 走 GitHub CLI。公开仓库不应强制用户安装或登录 `gh`；需要一个 public GitHub HTTPS Adapter，并保留 authenticated fallback。

## 4. 强制验收仓库

### 4.1 身份和 pin

- URL：`https://github.com/JUSTMONIKA2022/dsh-sandbox-escalation-fix`
- commit：`19f2cb4cecc178313d2f54458badfc1bcb8bc816`
- clone：`.agent-workflows/dsh-market-research/output/repos/sandbox-escalation-fix`

不要把它和公开索引中的同名 `inmny/dsh-sandbox-escalation-fix` 混淆。交接验收使用上面完整 URL 和完整 commit。

### 4.2 为什么它必须可安装

该 fixture 在 pinned commit 中：

- `package.json:53-56` 有 `dsh.bundle.patch`；
- `package.json:45-48` 有 `build` 和 `prepare`，所以必须测试脚本确认；
- `package.json:58-68` 有 DSH peer compatibility；
- `package.json:70-86` 使用 rc.7 开发依赖；
- `cordis.patch.yml:1-3` 是可加载的 insert patch；
- `src/index.ts:17-27` 有 bundle Host entry；
- README 说明支持 rc.7。

它是当前 runtime 支持的 bundle candidate，不应被归类为 repository-plugin 或 manual-only。

### 4.3 接手后的第一条验收命令

实现 direct source resolver 后，必须先添加 fixture contract test，再做 UI。测试必须能表达：

```text
resolveRepository("https://github.com/JUSTMONIKA2022/dsh-sandbox-escalation-fix")
  -> resolvedCommit = 19f2cb4cecc178313d2f54458badfc1bcb8bc816
  -> packageName = dsh-sandbox-escalation-fix
  -> mechanism = bundle
  -> execution = installable
  -> manifestPath = package.json
  -> patchPath = cordis.patch.yml
  -> buildScripts includes prepare
```

之后才允许进入 `MarketplacePlan` 和 `PluginMarketplaceManager`。

## 5. 推荐实现顺序

### Step 1：建立 source/candidate seam

建议新模块位于 `plugins/plugin-marketplace/src/host/`，候选命名：

- `source-types.ts`：SourceRef、CatalogSource、Candidate、evidence；
- `source-resolver.ts`：小接口、复杂实现隐藏；
- `github-source-adapter.ts`：public HTTPS + authenticated fallback；
- `catalog-source-manager.ts`：多个 catalog 的 load/cache/merge；
- `candidate-validator.ts`：manifest/patch/entry/script/compatibility；
- `source-lock.ts`：v3 lock/migration/provenance。

不要让 `client/plugin.tsx`、`src/marketplace-tools.ts`、catalog parser 和 transaction manager 各自解析 URL 或 manifest。它们只能提交 SourceRef，消费同一种 candidate。

### Step 2：扩展 protocol 和 state migration

需要加入：

- `CatalogSourceRef`；
- `RepositorySourceRef`；
- `MarketplaceCandidate`；
- `MarketplaceInstallSpec`；
- admission/result error codes；
- `catalogSourceId`、`requestedRef`、`installSpec`、`manifestPath`、`subpath`、`artifactDigest`、`signatureStatus`。

旧 `marketplace.json` v1/v2 必须非破坏迁移：

- 能读旧 entries/locks；
- 缺少新字段时标为 legacy/unknown，不猜测 trust；
- migration 可重复执行；
- migration 失败不破坏旧文件。

### Step 3：实现 direct public GitHub bundle probe

必须先实现以下顺序：

1. normalize URL/slug；
2. 解析 requested ref/default branch；
3. 得到 exact 40-char SHA；
4. 读取 root `package.json`；
5. 验证 `dsh.bundle.patch`；
6. 读取并解析 patch；
7. 解析 main/exports/dsh.client entry；
8. 验证目标文件存在于 exact commit；
9. 提取 package name/version/license/peer compatibility；
10. 提取 `prepare/install/postinstall/preinstall/prepack` 原文；
11. 计算 manifest/patch/artifact hash；
12. 生成 normalized installSpec 和 candidate。

`.dsh-plugin/package.json` 只作为 fallback diagnosis；发现它不能证明 installable。

### Step 4：把 candidate 接到现有 preview

安装行为必须满足：

- materialization 阶段 `--ignore-scripts`；
- 用户确认前不执行 `prepare`；
- 用户确认后只在可用的 write-restricted sandbox 中运行允许脚本；
- candidate profile 内完成 DSH reconcile；
- candidate runtime 启动后才能显示 preview ready；
- live profile 在 preview/discard 期间完全不变；
- apply 仍走现有 atomic rename；
- apply failure/Undo 仍保留旧 profile。

对强制 fixture，预览结束时应能确认 `sandbox-escalation-fix` patch entry 已加载，而不是只确认 `pnpm` 命令成功。

### Step 5：统一 UI 和 Agent

UI 和 Agent 都应支持：

- `sourceRef` 输入；
- candidate detail；
- risk/evidence 展示；
- script confirmation；
- same plan id / source lock；
- same apply/recover approval policy。

Agent 后续可以增加 manual guide、detail、compatibility、dependency 和 composition tools，但这些工具默认只读。

### Step 6：加入 catalog/scanner/trust/recovery

P1 顺序：

1. 多 CatalogSource、digest、ETag、LKG；
2. w211 scanner Adapter；
3. Ed25519 registry；
4. provenance/update relation；
5. release `.tgz` + SHA-256；
6. current/previous/pending/failed generation；
7. boot readiness 和 crash recovery。

不要在 direct resolver 还不能通过强制 fixture 前先做 ratings、packs 或复杂推荐排序。

## 6. 交接验收矩阵

| 场景 | 预期结果 |
|---|---|
| 输入强制 fixture URL，catalog 没有 row | 可解析并生成 candidate |
| 默认 branch 改变 | requestedRef 可变，execution SHA 必须固定 |
| 同一 commit manifest hash 改变 | blocked，提示 same-pin content change |
| 缺 `dsh.bundle.patch` | guide-only/blocked |
| 只有 `.dsh-plugin` | guide-only/blocked，不能 apply |
| 有 `prepare` | 原文进入 plan，未确认不能执行 |
| macOS preview | 在 Seatbelt root 内 build/start |
| Linux/Windows 无 sandbox Adapter | 稳定 blocked，不执行脚本 |
| preview 期间 | live profile/lock/node_modules 不变 |
| discard | candidate 全部清理，live 不变 |
| apply 成功 | bundle/profile contract 可被 pinned DSH Loader 消费 |
| apply 失败 | 旧 profile 启动，失败 candidate 保留诊断 |
| Undo | 恢复 apply 前 profile |
| Agent apply | 与 UI 使用同一 approval decision |
| catalog source signature invalid | 浏览可选，自动 install blocked |
| catalog stale | 可浏览，install 前重新验证 source/commit |

## 7. 不要做的事

- 不要把 `.dsh-plugin` 分支重新标成可执行；
- 不要恢复 `config.repositories` patch；
- 不要把 `pluginId` 继续当作唯一身份；
- 不要复制 w211 或 omdsh 的完整安装器；
- 不要引入 `@omdsh/runtime`；
- 不要直接改 live profile 以“简化”流程；
- 不要把 build script consent 持久化为永久许可；
- 不要执行第三方 `install.sh`/PowerShell 安装器；
- 不要把 profile rollback 描述成撤销外部网络、数据库或系统副作用；
- 不要为了 Web/TUI 形式完整而绕过当前 Host transport 和 Loader 边界。

## 8. 代码审查清单

提交实现前必须回答：

- 新接口是否比调用方自己解析更深？
- UI、Agent、catalog 和 transaction 是否共享同一 candidate？
- 是否所有依赖都通过 Adapter 注入，Fake Adapter 能否覆盖错误路径？
- 是否有 exact commit、manifest hash、patch hash 和 installSpec？
- 是否有真实 pinned DSH contract test？
- 是否证明 preview 没有修改 live profile？
- 是否测试了失败 apply、进程重启、Undo 和 migration？
- 是否保持官方 `@deepseek-ai/dsh-client-ui-primitives` 和 `--dsw-*` tokens？
- 是否保留第三方 MIT attribution？

## 9. 交接状态

当前已完成：

- `SourceRef`、CatalogSource、MarketplaceCandidate 和 normalized installSpec；
- public GitHub HTTPS exact-commit Adapter，以及 authenticated fallback；
- exact manifest、patch、entry、metadata、peer compatibility 和 lifecycle validation；
- source-lock v3 migration/provenance 和 catalog snapshot merge/dedupe；
- direct repository 与 catalog 共用现有 preview/apply/rollback/Undo 事务；
- `.dsh-plugin`/repository-plugin 的 guide-only/blocked gate；
- Host approval decision 的 UI/Agent projection；
- 强制 fixture 的固定 SHA、静态 manifest/patch/entry 和隔离合同测试；
- 中英文规划、交接文档和实现状态。

当前未完成或明确延期：

- generation/readiness recovery；
- release/signature/provenance 的签名和 artifact release 扩展；
- Web marketplace transport；
- Linux/Windows scripted sandbox；
- 真实 pinned DSH runtime 启动和真实插件安装验证（本任务禁止执行）。

研究 clone 和审计资料位于：

`.agent-workflows/dsh-market-research/`

本轮修改了 marketplace Host、协议、UI、Agent 工具、测试和文档；工作区中已有的 sidebar/terminal 等未相关修改必须保留，不要用 reset 或 checkout 清理。
