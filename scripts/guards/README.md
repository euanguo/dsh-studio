# scripts/guards — 防再犯守护（CI / 预提交）

本目录承载把「全仓收敛重构」确立的约定固化为可执行守则的 Node 守护脚本。
每个脚本约定同一套输出契约：打印违规清单（`file:line` + 规则名）后 `exit 1`；
全净时打印 `GUARD-OK` 并 `exit 0`。供 CI 与预提交钩子调用
（`pnpm run check:guards`）。

| 脚本 | 守护规则 | 说明 |
| --- | --- | --- |
| `guard-no-localstorage.mjs` | S2 持久化 | 扫描 `plugins/*/src/client/**`，禁止组件直接读写 `localStorage`/`sessionStorage`。白名单：`plugins/shared/comments-migration.ts`（legacy 只读迁移）、`plugins/sidebar/src/client/kit/keymap.ts`（leaf-R1 ③ 恢复的 override 持久化半）。 |
| `guard-no-inline-probe.mjs` | S4 上游探针 | 扫描 sidebar / marketplace / left-rail 三个 feature client 树，上游 DOM 探针（`[data-slot="conversation"/"sidebar"]`、`[class*=`/`[aria-*=`）只能出现在各插件唯一探针模块与生成物（`dsh-dom.ts`、`marketplace-dom.ts`、`skin-dom.ts`、`generated-selectors.ts`、`styles.ts`、`chunk-loader.ts`）。查询自有 `data-slot`（如 `surface-tab`、`[data-line]`）不算违规。 |
| `guard-dead-exports.mjs` | 死导出告警 | 提取 `@dsh-studio/shared` 命名导出，全仓词边界计数，外部引用 ≤1 且无 tests/ 引用的告警（警告模式 `exit 0`；仅被 `tests/` 引用视为存活待接产线）；`--strict` 下非白名单者 `exit 1`。白名单 `scripts/dead-export-allowlist.json`（逐模块裁决理由见下表）。 |
| `guard-dsh-dependencies.mjs` | 依赖事实源（leaf-4.1） | 对拍五清单：inject ⊆ cordis.patch.yml insert ⊆ profile.ts BUNDLED_*；externals 覆盖全部 @deepseek-ai import；config/dsh-dependencies.json 为唯一可写事实源，派生产物必须一致。 |
| `guard-effect-abort.mjs` | S6 竞态纪律（leaf-5.3 内迁 rescan d7） | `plugins/sidebar/src/client/runtimes/*.ts` 中含异步传输（async/Promise 链/WebSocket）的模块必须携带显式取消/清理机制（AbortController/AbortSignal/GenerationGate/转发 signal/.close()）；无异步工作的纯同步模块豁免。只验存在性，不证接线——接线正确性由测试与评审承担。 |
| `guard-overlay-arbiter.mjs` | S6 单例纪律（leaf-5.3 内迁 rescan c16） | 悬浮评论 arbiter 必须经 `createOverlayArbiter()` 工厂创建；禁止模块级可变单例（`let currentOwner`）与模块级共享实例导出，实例一律走 React context。 |
| `guard-whole-store-subscribe.mjs` | zustand 选择器纪律（leaf-5.3 内迁 rescan c9 并泛化） | 全部插件 client 树与 src/ 禁止整店身份选择器（`useX(state => state)` / `(s => s)`），必须按字段订阅。 |

## 放弃清单（不可低误报静态化 → 人工评审归属）

以下军规项**不**落地为守卫脚本，理由与评审归属如下：

| 军规项 | 放弃理由 | 人工评审归属 |
| --- | --- | --- |
| S6 dialog/promise-service 必须排队 | 「是否被队列化」取决于运行时组合方式（谁调用、是否经 context 工厂），静态扫描只能匹配个别调用形状，误报率高且易被重命名绕过 | `.workflow/specs` S6 规格 + PR 评审 |
| S1 可推导值不得二次存储 | 需要跨文件数据流分析才能区分「派生」与「独立事实」，grep 级规则只能覆盖孤立模式 | `.workflow/specs` S1 规格 + PR 评审 |
| abort signal 接线正确性（signal 是否真正传至 transport 并生效） | 守卫只能证明符号在场；传播链正确性是行为属性，由 runtimes 相关 node:test 与代码评审承担 | tests/ 行为用例 + PR 评审 |

### dead-export 白名单裁决（leaf-5.2）

白名单内的导出均为**有意保留的声明式契约面**（当前仓内消费者 ≤1 或暂无，
但作为跨插件契约发布），按模块裁决如下：

| 模块（`plugins/shared/src/…`） | 裁决理由 |
| --- | --- |
| `contracts/capabilities-api.ts`、`contracts/workbench-contracts.ts` | 内核五服务与 capabilities DTO 的唯一契约面；workbench 类型由 leaf-1.x 的服务实现与其消费方共享。 |
| `git/git-core.ts` | Host 侧 git 门面的完整能力 API（含 revert/cherry-pick/show、fast-forward 族与全部结果类型）；routes/git.ts 与 worktree-routes.ts 是其薄封装。 |
| `terminal/terminal-*`（activity/ime-anchor/output-scheduler/recovery/resize-hold/runtime-owner/scroll-intent/scroll-snapshot/scrollback-policy/socket/theme/webgl-atlas） | 终端运行时契约簇：类型/常量在 shared 定义、sidebar runtime 与 shared terminal 视图共同消费；scrollback policy 常量同时被 capabilities config 校验。 |
| `panel-geometry.ts`、`stable-pane-id.ts`、`layout-dom.ts`、`column-mount.ts`、`tab-drag-image.ts` | 布局/面板/拖拽几何契约：sidebar 宽度预算、pane id、overlay 挂载（leaf-1.6）与拖拽图像（body-append 例外）的唯一事实源。 |
| `middle-truncate-text.ts`、`filename-display.ts`、`time.ts`、`i18n.ts` | 共享展示工具及其返回类型；filename-label / selected-text-action 等多表面复用。 |
| `fs-tree.ts`、`bundle-names.ts` | capabilities fs 树契约与 bundle chunk 名常量。 |
| `ui-chrome-schema.ts:TableSchema`、`ui/menu-anchor.ts`、`ui/styles.ts:sharedUiStyles` | ui-chrome 表 schema、菜单锚定状态与 barrel 再导出的样式入口。 |
| `worktree-preferences.ts:WorktreeLocationInput`、`prefs-shared.ts`、`left-rail-preferences.ts`、`data-root-names.ts`、`runtime/runtime.ts` | 各持久化/运行时域的既有契约类型（沿用首轮裁决）。 |

新增候选时的流程：先找真实消费者；确属契约面则加入
`scripts/dead-export-allowlist.json` 并在本表补一行理由。

## 运行

```sh
pnpm run check:guards            # 三个守卫全部要求 GUARD-OK
node scripts/guards/guard-dead-exports.mjs --strict   # 死导出严格模式
```

## rescan.mjs（RG5 终扫 oracle）

`rescan.mjs` 位于 `.agent-workflows/deep-refactor-exec/scripts/rescan.mjs`，
是当初「重扫一次应找不到本轮任何问题」的终扫守护（ROOT RG6 的 oracle），
逐条断言 wave1–wave5 的 absent/present/countMax 规则。本目录通过薄封装暴露其
CLI，供从仓库根独立调用：

```sh
node scripts/guards/rescan-shim.mjs [--stage final|w1|w2|w3|w4|w5]
```

薄封装仅透传参数并委托 `.agent-workflows/deep-refactor-exec/scripts/rescan.mjs`，
因为该脚本以 `process.cwd()` 解析仓库根，不能在自己的目录里裸跑。它打印
`RESCAN-CLEAN`（退出 0）或违规清单（退出 1），与三只守卫一起构成 `--stage
final` 的完整防再犯门。注意 `rescan.mjs` 与守卫按同一批 rescan `UNWIRED_ALLOWLIST`
共享豁免语义（如 keymap.ts 的 localStorage 半），不要在这些脚本间复制豁免表。