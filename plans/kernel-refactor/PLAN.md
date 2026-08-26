# PLAN — kernel-refactor（DSH Studio 结构轮一次性完整重构）

Request（用户原话要点）：基于最佳架构方向做一次完整的结构重构；不执着于前案 P0 分期；
一次性重构完整，让以后的代码更干净地接入；每个阶段/层次都有 /unlazy 台账；
**修订 3**：禁止为过阶段性检查留下增容层/中间层——最终架构必须干净直接；
并与近期提交 `7514a69..9efaadf` 对账，已落地能力不再重复规划。
执行框架：unlazy orchestrated mode；本文件 + GATES.md + gates/ 构成执行输入。

## 裁决记录

| Q | 裁决 |
|---|---|
| Q1 与前案 P0-P4 关系 | 不沿用其保守分期；以 target-design.md 的最终形态反推依赖序。resolveOpenPlan/resolveScopeBucket 纯函数保留复用，其余按本轮设计。 |
| Q2 兼容层禁令 | 硬约束 §1：叶子完成定义 = 新 API + 消费方直迁 + 旧路径删除 + 测试重写。数据迁移例外且仅限数据格式。 |
| Q3 hero 品牌文案 hack | 默认整链删除 installHeroBranding（上游拥有文案）；人工门复核产品影响。 |
| Q4 comments sanitize 上限 | 统一为一常量（现 500 vs 200 二义），取 200（运行时现值），schema 同步；人工门记录。 |
| Q5 minified patch | 本仓不做运行时覆写（证据不足）；leaf-4.3 产出上游提案包，patch 存续至外部接受。显式交接非放弃。 |
| Q6 smoke:runtime 空跑脚本 | 删除脚本本体与 package.json/CI 引用（rescan-shim 对其的依赖一并不留）。 |
| Q7 dead-export allowlist 未入库 | allowlist 入库 + 121 候选拍板（26 个 tests-only 引用判活），guard 保持非 strict 但清单收窄。 |
| Q8 error-idiom 规则 | 升格 scripts/guards/guard-error-idiom.mjs 后删 sweep.list；若实现成本超一日则改为删除 sweep.list 并在 ADR 注明规则消亡理由（二选一，人工门）。 |
| Q9 已落地 comments 基线 | `1b75b96`/`1c88b8d` 已完成 comments 单写者、strict load、per-mount center facade、flags sentinel merge；leaf-1.4 只接入/验证，不再新建 comments wrapper。 |
| Q10 Git freshness 分层 | `377d0b1`/`05f6543` 已完成 GitWatch push 与 source-control retention；WorkspaceEvents 不得吸收该领域事件。 |
| Q11 sidebar 宽度边界 | `674392f` 的 persisted 4096 与 live 75% policy 留在 sidebar domain；LayoutService 只协商最终 footprint。 |
| Q12 marketplace push 基线 | `9efaadf` 已加入 monotonic push token；leaf-3.3 只做 host phase/error/reconcile 与客户端顺序回归。 |
| Q13 ui-chrome schema 基线 | `7514a69` 已把 host schema 递归派生收口；StateStore 直接消费，不再生成第二套 zod schema。 |
| Q14 波次与 Needs 对账 | 原 W2 同列 `leaf-5.1`，但其显式 Needs 为 `leaf-1.3`；将 leaf-5.1 延后到 leaf-1.3 VERIFIED 后的 W6 微波，保持依赖事实优先。 |
| Q15 文档叶子依赖对账 | `leaf-5.4` 的 Needs 是全部分支 VERIFIED；删除 W7 的“初稿”伪波次，保留 W7 仅做 leaf-1.7，leaf-5.4 在 W8 终稿阶段一次性完成，避免把未满足依赖的草稿计作叶子进度。 |
| Q16 Web surface identity boundary | `web/src/client.ts` 的 `DSH Studio Web` 标题/hero 适配属于 Web surface 自有身份契约，不属于 Desktop O4 的 `src/client.ts` hack 清除；本轮不把 Web surface 改造成 Desktop identity 的第二读写通道，后续若改 Web identity 必须另立契约与门禁。 |
| Q17 Workbench registration ownership | `config/dsh-dependencies.json` remains the only writable dependency fact source, but the workbench leaf must add its own `@dsh-studio/workbench` registration after leaf-4.1 is VERIFIED; therefore config ownership is explicitly extended to leaf-1.1, with no concurrent config owner in W2. |

## 近期提交对账表（执行前基线，不是新增叶子）

| 提交 | 状态 | 计划处置 |
|---|---|---|
| `7514a69` | 已完成 ui-chrome schema recursive derivation + regression tests | 作为 StateStore 前置不变量，leaf-1.4/leaf-4.1 不重做 |
| `674392f` | 已完成 persisted/live width 分离与测试 | 修正 leaf-1.6：不迁移 clamp policy，只迁 footprint 协商 |
| `5928e82`、`ed194ce` | 已完成 brand row 隐藏、traffic clearance、toggle label anchor | leaf-2.1 抽取 CSS 时保留，不得删除 selector 语义 |
| `05f6543`、`377d0b1` | 已完成 source-control retention 与 Git freshness push | leaf-1.2/1.7 只保留/接入，不替换为通用事件 |
| `1b75b96`、`1c88b8d` | 已完成 comments single-owner、strict hydration、center per-mount | leaf-1.4 将 comments-record 视为 canonical owner，补 scope/persistVia/version，不造第二层 |
| `7595452` | 已完成 left-rail hydrate 失败不 save-back | leaf-1.5 保留 `loadStrict`/`chromeHydrated` 契约 |
| `9efaadf` | 已完成 marketplace push monotonic token | leaf-3.3 改为行为回归，不改 client push store |
| `af143f1`、`d96dac5` | 已完成 root refresh 与 wrapper Input Files CSS 修复 | leaf-1.2 迁移时保留，不重写其行为 |
| `c79b516`、`c848106` | marketplace client 已拆分并修复 global class/busy push | 不再新增 marketplace client 拆分叶，只测 host 与 push 行为 |

## 硬约束（全波次有效）

1. 无增容层军规（target-design.md §1.1）——每叶子原子直迁，禁止 shim/deprecated 别名/re-export 桥/双读双写代码通道。
2. 用户数据迁移幂等、非破坏、重启安全；崩溃安全点由 fixture 测试证明。
3. 并发叶 OWNS 不相交（parallel.md）；同分支内顺序由 Needs 表达。
4. 并发叶**禁止**运行 pnpm typecheck/test/build 或安装依赖——全局门禁由驱动者在波间执行（沿前轮约定）。
5. 不做 git commit；完成后统一请示。
6. 提交规范预留：最终 commit 序列 `<module>: <subject>` + DCO。

## 契约清单（成果 → owner leaf → 观察 gate）

| # | 成果（independently omittable outcome） | Owner | Gate |
|---|---|---|---|
| O1 | 依赖事实单一源 config/dsh-dependencies.json + sync 生成器 + 对拍 guard，五处手写清单收敛 | leaf-4.1 | leaf-4.1 G1-G5 |
| O2 | bump-dsh.mjs 半自动化 + 结构化冲突报告 | leaf-4.2 | leaf-4.2 G1-G2 |
| O3 | 上游 independent-columns 提案包（行为契约翻译 + PR 大纲） | leaf-4.3 | leaf-4.3 G1(manual) |
| O4 | 身份单源 src/desktop-identity.ts；hero branding 链删除；settings 探针归位 dsh-dom.ts | leaf-2.1 | leaf-2.1 G1-G4 |
| O5 | AppController 显式状态机；main.ts 全局布尔清零 | leaf-2.2 | leaf-2.2 G1-G4 |
| O6 | windows/menu/ipc/runtime-options 模块拆分；bootstrap ≤150 行 | leaf-2.3 / leaf-2.5 | 各账 G 门 |
| O7 | 就绪协议加固（HTTP 确认 + SIGKILL 升级 + exit 等待） | leaf-2.4 | leaf-2.4 G1-G3 |
| O8 | workbench 插件骨架 + 五服务契约与单测 | leaf-1.1 | leaf-1.1 G1-G4 |
| O9 | OpenPipeline 全入口收口；intercept 劫持收编；六散装签名删除 | leaf-1.2 | leaf-1.2 G1-G5 |
| O10 | SurfaceRegistry 三轨归一 | leaf-1.3 | leaf-1.3 G1-G4 |
| O11 | StateStore/ScopeService 核心上线；直接接入现有 comments-record 单写者，补 scope/version/persistVia；keymap 半区删除 | leaf-1.4 | leaf-1.4 G1-G5 |
| O12 | left-rail 平行体系并轨（shared/runtime + persistVia 通道），保留 strict hydration 防覆盖 | leaf-1.5 | leaf-1.5 G1-G4 |
| O13 | LayoutService 区域树 + z-index 表；#root padding 写手清零；覆盖层挂载协议；不迁移 sidebar clamp policy | leaf-1.6 | leaf-1.6 G1-G5 |
| O14 | WorkspaceEvents 两类身份事件；10 订阅点替换；registry 失效接通；GitWatch 保持独立 | leaf-1.7 | leaf-1.7 G1-G4 |
| O15 | 市场相位机显式化（含 applying/undoing）+ 守卫表 | leaf-3.1 | leaf-3.1 G1-G3 |
| O16 | journal v2 意图前置 + reconcile 对账 + 崩溃 fixture 测试 + v1 懒升级 | leaf-3.2 | leaf-3.2 G1-G4 |
| O17 | allowBuild 整块重生成 + 错误留存语义 | leaf-3.3 | leaf-3.3 G1-G3 |
| O18 | i18n 类型纪律 + terminal 重复键去重 | leaf-5.1 | leaf-5.1 G1-G3 |
| O19 | 残留清零（sweep.list/决策码注释/双斜杠/allowlist 入库/smoke 空跑/non-vendor any） | leaf-5.2 | leaf-5.2 G1-G5 |
| O20 | guards 接线扩展 + CI 步骤 | leaf-5.3 | leaf-5.3 G1-G3 |
| O21 | 双语文档同步 + workbench 提案状态翻转 | leaf-5.4 | leaf-5.4 G1-G3(manual 含审阅) |

## 深度树与依赖（Needs = VERIFIED 前置）

```
kernel-refactor (ROOT)
├─ B4 platform-engineering
│   ├─ leaf-4.1 依赖事实单源            Needs: —
│   ├─ leaf-4.2 bump 半自动             Needs: leaf-4.1
│   └─ leaf-4.3 上游提案包              Needs: —
├─ B2 desktop-shell（src 内严格串行）
│   ├─ leaf-2.1 身份单源                Needs: —
│   ├─ leaf-2.2 AppController           Needs: leaf-2.1
│   ├─ leaf-2.3 窗口/菜单/IPC 拆分      Needs: leaf-2.2
│   ├─ leaf-2.4 就绪协议加固            Needs: leaf-2.2
│   └─ leaf-2.5 bootstrap 收缩验收      Needs: leaf-2.3, leaf-2.4
├─ B3 marketplace-transaction（host 内串行）
│   ├─ leaf-3.1 相位机                  Needs: —
│   ├─ leaf-3.2 journal+reconcile       Needs: leaf-3.1
│   └─ leaf-3.3 allowBuild+错误留存     Needs: leaf-3.2
├─ B1 workbench-kernel
│   ├─ leaf-1.1 内核骨架+契约           Needs: leaf-4.1（注册清单走生成物）
│   ├─ leaf-1.2 OpenPipeline 收口       Needs: leaf-1.1
│   ├─ leaf-1.4 StateStore 核心         Needs: leaf-1.1
│   ├─ leaf-1.3 Registry 归一           Needs: leaf-1.2
│   ├─ leaf-1.5 left-rail 并轨          Needs: leaf-1.4
│   ├─ leaf-1.6 LayoutService           Needs: leaf-1.2, leaf-1.4
│   └─ leaf-1.7 WorkspaceEvents         Needs: leaf-1.6
├─ B5 hygiene-docs
│   ├─ leaf-5.1 i18n 类型纪律           Needs: leaf-1.3（i18n.ts 与 descriptor 文件相邻期避让）
│   ├─ leaf-5.2 残留清零                Needs: 全部分支 VERIFIED（轻触全仓）
│   ├─ leaf-5.3 guards 接线             Needs: leaf-5.2, leaf-4.1
│   └─ leaf-5.4 双语文档同步            Needs: 全部分支 VERIFIED
└─ node-1..node-5 分支集成账 → ROOT 终局账
```

## OWNS 映射（并发调度用；同格即互斥）

| Leaf | OWNS（repository-relative） |
|---|---|
| leaf-4.1 | config/dsh-dependencies.json, scripts/sync-dsh-dependencies.mjs, scripts/sync-dsh-dependencies.d.mts, scripts/build-dsh.mjs, scripts/build.mjs, package.json, tsconfig.json, dsh-source.json, scripts/guards/guard-dsh-dependencies.mjs, tests/dsh-dependencies.test.ts |
| leaf-4.2 | scripts/bump-dsh.mjs, scripts/dsh-source.mjs, plans/kernel-refactor/notes/bump-runbook.md |
| leaf-4.3 | docs/upstream/independent-columns-proposal.md（新目录仅此文件） |
| leaf-2.1 | src/desktop-identity.ts, src/desktop-chrome.*, src/main.ts, src/update-manager.ts, src/client.ts, plugins/sidebar/src/client/surfaces/dsh-dom.ts, tests/desktop-identity.test.ts |
| leaf-2.2 | src/app-controller.ts, src/main.ts, tests/desktop-lifecycle.test.ts |
| leaf-2.3 | src/windows.ts, src/menu.ts, src/ipc.ts, src/runtime-options.ts, src/main.ts |
| leaf-2.4 | src/runtime.ts, src/app-controller.ts, tests/runtime-handshake.test.ts, tests/runtime.test.ts |
| leaf-2.5 | src/main.ts, src/desktop-host.ts, src/app-controller.ts（行数验收 + 清尾） |
| leaf-3.1 | plugins/plugin-marketplace/src/host/transaction-manager.ts, tests/marketplace-phases.test.ts |
| leaf-3.2 | plugins/plugin-marketplace/src/host/transaction-manager.ts, plugins/plugin-marketplace/src/host/journal.ts(新), tests/marketplace-reconcile.test.ts |
| leaf-3.3 | plugins/plugin-marketplace/src/host/transaction-manager.ts, plugins/plugin-marketplace/src/client/store.ts(只做 push 顺序回归，不改实现), tests/marketplace-allowbuild.test.ts, tests/plugin-marketplace-store.test.ts |
| leaf-1.1 | plugins/workbench/**, plugins/shared/contracts/workbench-contracts.ts, config/dsh-dependencies.json, cordis.patch.yml, src/profile.ts, package.json(dsh.client.inject 由生成器写), scripts/build.mjs(插件表读配置), scripts/stage-dsh.mjs(桌面浏览器插件 staging 表), tests/workbench-kernel.test.ts |
| leaf-1.2 | plugins/sidebar/src/client/{open/**, intercept.ts, plugin.tsx, surfaces/center-surface-add-menu.tsx}, plugins/sidebar/src/client/{files/files-view.tsx, files/files-search.tsx, source-control/source-control-panel.tsx, workspace-panel-loading.ts, side-tabs.tsx}, plugins/plugin-marketplace/src/client/{marketplace-view.tsx, use-marketplace.ts}, tests/open-pipeline-cutover.test.ts; preserve baseline git-watch sections in workspace-panel-loading.ts and run git-watch regression |
| leaf-1.3 | plugins/shared/contracts/workbench-contracts.ts, plugins/sidebar/src/client/contract.ts, plugins/sidebar/src/client/sidebar-service.ts, plugins/sidebar/src/client/builtins/**, plugins/sidebar/src/client/surfaces/types.ts, plugins/sidebar/src/client/file-view-host.tsx, plugins/sidebar/src/client.ts, plugins/sidebar/src/client/side-tools-menu.tsx, plugins/sidebar/src/client/side-tool-row.tsx, plugins/sidebar/src/client/side-tool-helpers.tsx, plugins/sidebar/src/client/SideToolsPanel.tsx, plugins/sidebar/src/client/bottom-workbench.tsx, plugins/sidebar/src/client/settings-feature-card.tsx, plugins/sidebar/src/client/settings.tsx, plugins/sidebar/src/client/plugin.tsx, plugins/sidebar/src/client/open/pipeline.ts, plugins/sidebar-desktop/src/client/plugin.tsx, plugins/workbench/src/registry.ts, tests/surface-registry.test.ts, tests/sidebar.test.ts, tests/layout-scope.test.ts, tests/open-pipeline-cutover.test.ts, tests/workbench-kernel.test.ts |
| leaf-1.4 | plugins/workbench/src/client/state/**, plugins/shared/comments-record.ts, plugins/shared/store-persistence.ts, plugins/sidebar/src/client/runtimes/chrome-store.ts, plugins/sidebar/src/client/surfaces/center-surface-persistence.ts, plugins/sidebar/src/client/diff/diff-comments-store.ts, plugins/sidebar/src/client/review/review-comments.ts, plugins/sidebar/src/client/kit/keymap.ts, plugins/shared/ui-chrome-tables.ts, plugins/shared/comments-migration.ts, plugins/capabilities/src/ui-chrome-schemas.ts, plugins/sidebar/src/client/surfaces/file-surface.tsx, plugins/sidebar/src/client/surfaces/diff-renderers.tsx, plugins/sidebar/src/client/diff/multi-diff-file-stack.tsx, scripts/guards/guard-no-localstorage.mjs, tests/state-slice.test.ts, tests/comments-single-writer.test.ts |
| leaf-1.5 | plugins/desktop-left-rail/src/**, tests/left-rail-unify.test.ts, tests/left-rail-settings-roundtrip.test.ts |
| leaf-1.6 | plugins/workbench/src/layout.ts, plugins/shared/layout-dom.ts, plugins/panel-controls/src/client.ts, plugins/panel-controls/src/index.ts, plugins/panel-controls/src/style.d.ts, plugins/panel-controls/src/terminal/plugin.tsx, plugins/pinned-summary/src/**, plugins/sidebar/src/client/{plugin.tsx,SideToolsPanel.tsx,side-tabs.tsx,side-tools-menu.tsx,builtins/deps.ts,workspace-tools.tsx}, plugins/sidebar/src/client/side-tools.module.css, plugins/plugin-marketplace/src/client/marketplace-view.tsx, plugins/sidebar/src/client/surfaces/center-surface-host.tsx, tests/layout-service.test.ts, tests/right-panel-layout.test.ts |
| leaf-1.7 | plugins/workbench/src/events.ts, plugins/sidebar/src/client/{plugin.tsx, workspace-tools.tsx, workspace-panel.tsx, surfaces/center-surface-add-menu.tsx, subagent/subagent-panel.tsx, review/review-comments.ts, runtimes/registry.ts}, plugins/pinned-summary/src/service.ts, plugins/plugin-marketplace/src/client/session-navigation 相关订阅点, plugins/sidebar/src/client/surfaces/{center-surface-host.tsx, center-surface-tabs.tsx}, tests/workspace-events.test.ts |
| leaf-5.1 | plugins/shared/terminal-messages.ts, plugins/shared/package.json, plugins/panel-controls/src/terminal/i18n.ts, plugins/sidebar/src/client/i18n.ts, plugins/desktop-left-rail/src/client/locales.ts, plugins/desktop-skins/src/client/i18n.ts, tests/i18n-discipline.test.ts |
| leaf-5.2 | plugins/**(注释与清单轻触), plugins/capabilities/src/context-types.ts, src/update-manager.ts, src/client.ts, scripts/smoke-runtime.mjs, scripts/dead-export-allowlist.json, scripts/guards/guard-dead-exports.mjs, package.json(scripts), .github/workflows/ci.yml, .unlazy/dead-export-allowlist.json→scripts/dead-export-allowlist.json 迁移 |
| leaf-5.3 | scripts/guards/**, package.json(check:guards), .github/workflows/ci.yml |
| leaf-5.4 | docs/**, AGENTS.md, plugins/AGENTS.md |

冲突预解：leaf-1.2/1.6 都触 marketplace-view.tsx → Needs 已串行（1.6 在 1.2 后）；
leaf-1.2/1.3 都触 open/pipeline.ts → 1.3 的单注册投影修复在 1.2 VERIFIED 后串行完成；
leaf-1.1/1.3 都触 workbench/src/registry.ts 与 tests/workbench-kernel.test.ts → 1.3 的 viewer-only 校正
在 1.1 VERIFIED 后串行完成；
leaf-1.3/1.7 都触 plugin.tsx → 1.7 在 1.6 后，事件接线在 Registry 归一后串行完成；
leaf-1.4/1.7 都触 review-comments.ts → 1.7 在 1.4 后经 1.6 传递保证；
leaf-1.6/1.7 都触 center-surface-host.tsx 与 workspace-tools.tsx → 1.7 Needs leaf-1.6，事件接线在 overlay 协议之后串行完成；
package.json 四叶触及（4.1/1.1/5.2/5.3）→ 波次错开。

## 波次计划（驱动者可按 lease 情况重划分，但不得违反 Needs）

| Wave | Leaves（并行） | 说明 |
|---|---|---|
| W1 | 4.1 · 2.1 · 3.1 · 4.3 | 四向完全不相交 |
| W2 | 1.1 · 2.2 · 3.2 | VERIFIED：三叶已返回且父账复验通过；5.1 按 Q14 延后；3.2 需 3.1 VERIFIED，1.1/2.2 分别需 4.1/2.1 |
| W3 | 1.2 · 2.3 | READY：W2 已完成；3.3 因同文件串到 W4 |
| W4 | 1.4 · 2.4 · 3.3 | |
| W5 | 1.3 · 1.5 | |
| W6 | 1.6 · 2.5 · 5.1 | 5.1 在 1.3 VERIFIED 后进入；与 1.6/2.5 OWNS 不相交 |
| W7 | 1.7 | 仅做 1.7；5.4 终稿在全部分支 VERIFIED 后一次性完成 |
| W8 | 5.2 → 5.3 → 5.4 | 串行微波；5.4 等全部分支 VERIFIED |
| 终局 | node-1..node-5 逐支集成 → ROOT RG 复测 | |

## 接口与命名约定（fan-out 前 fixed）

- 新服务 ctx id：`workbench.registry` / `workbench.open` / `workbench.layout` /
  `workbench.state` / `workbench.events`（字符串键，ctx.reflect.provide 注入）。
- StateStore slice 工厂名 `defineStateSlice`；布局 API 名 `claim/release/preview`；
  事件模块导出 `onWorkspaceChanged/onSessionChanged`。
- 新 src 模块名固定：desktop-identity/app-controller/windows/menu/ipc/runtime-options。
- 市场 journal 文件名维持 `current.json`（路径不变），字段新增 version/phase/committed。
- 依赖事实源文件名 `config/dsh-dependencies.json`；同步脚本 `scripts/sync-dsh-dependencies.mjs`；
  guard `scripts/guards/guard-dsh-dependencies.mjs`。
- 错误处理约定：用户可见失败必须有 UI 反馈或显式 error 态；对账/清理动作 warn 先行。
- 测试纪律：测行为与契约结构，不做源码字符串 grep；absence 类守卫属 AGENTS.md 允许的
  inventory 对拍场景并附 self-test 正控。

## 回滚策略

- 每叶子一个原子变更集；驱动者波间全局门禁失败 ⇒ 回退最近叶子变更集后重做该叶，
  不带病推进。
- 数据迁移全部"读时迁移 + 写新保旧"，回滚代码不丢用户数据。
- 唯一外部交接（上游 patch 清零）不阻塞任何树内验收。

## 波次状态（更新于此，不重写历史）

| Wave | Leaves | State |
|---|---|---|
| W1 | 4.1 · 2.1 · 3.1 · 4.3 | VERIFIED（四叶已返回、父账复验、W1 集成门禁通过） |
| W1R | 4.1 | VERIFIED（build-dsh 单源修复；G5 父账复验通过） |
| W2 | 1.1 · 2.2 · 3.2 | VERIFIED（三叶已返回、父账复验、typecheck/test/build/guards 集成门禁通过） |
| W3 | 1.2 · 2.3 | VERIFIED（两叶已返回、父账复验、W3 集成与 DEV smoke/HMR 证据通过） |
| W4 | 1.4 · 2.4 · 3.3 | VERIFIED（3 叶均已返回；父账复验与 W4 全局集成门禁通过） |
| W5 | 1.3 · 1.5 | VERIFIED（两叶返回；单注册投影/left-rail 串线父账复验、全局 barrier 与 DEV 点验通过） |
| W6 | 1.6 · 2.5 · 5.1 | VERIFIED（三叶返回；布局/i18n 修复、全局 barrier 与 DEV 证据通过） |
| W7 | 1.7 | VERIFIED（leaf-1.7 返回；事件/registry focused checks 与 DEV worktree round-trip 通过） |
| W8 | 5.2 · 5.3 · 5.4 | VERIFIED（三叶返回；残留清零/guards 扩展/双语文档同步父账复验通过） |

> 执行 kickoff：以本目录 PLAN/GATES/gates 为唯一台账事实源，不复制出第二份；
> `.unlazy/kernel-refactor/` 只承载 dispatch.json/status.log/locks 等运行态，随后按
> orchestration.md 驱动循环推进。
