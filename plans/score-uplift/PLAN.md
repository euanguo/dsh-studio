# PLAN: score-uplift — 架构评分 7.3 → ≥8.0 提升计划

> 来源：2026-08-26 三路只读深审（架构/质量、测试/工程化/性能、安全/跨平台/可维护性）
> 综合评分 **7.3/10**。本计划只修评审实锤的薄弱点，不夹带无关重构；
> 全程守卫链保持绿色、无兼容层/shim/双写路径（沿用 kernel-refactor 契约）。
> 执行时按 unlazy 纪律为每个 leaf 另立 gates 台账；本文是唯一计划事实源。

## 调研结论（接缝均已核实到 file:line）

| # | 发现 | 位置 | 定论 |
|---|---|---|---|
| R1 | `cwdOf/cwdScopeOf` 接受客户端任意绝对路径，无服务端工作区校验 | plugins/capabilities/src/routes.ts:76-89 | 需要新的服务端 scope 注册表接缝 |
| R2 | `fs.tree/read/tail` 读类路由不过 `assertWithinSession` | routes/fs.ts:26-48, shared.ts:108-115 | 与 R1 同一接缝一并修 |
| R3 | fence 三原语零行为测试 | shared/fs-tree.ts:101(isWithin)、routes/shared.ts:115(assertWithinSession)、capabilities/src/trust-fence.ts:63(isTrustedApiRequest) | 纯新增测试 |
| R4 | 市场网格全量直渲染 ~1761 个按钮，无窗口化 | plugin-marketplace/src/client/marketplace-filters.tsx:394（PluginCard 定义 browse.tsx:62） | react-virtual 已在根 package.json:94，left-rail 有现成用法可复制 |
| R5 | `transaction-manager.ts` 1301 行混四职 | 同文件 :216-273 状态 I/O、:318-403 yaml/allowBuild、:442-498 fs 手术、其余相位编排 | 天然四段拆分线 |
| R6 | `capabilities/src/index.ts apply()` 单函数 496 行 | index.ts:151 起 | 按 terminal/settings/ui-chrome/tool 四工厂拆 |
| R7 | `workbench.state` 零消费者（内存适配器）+ composer-history 四件套 ~410 行休眠 | workbench/src/state.ts:92-110; sidebar/client/input-history*.ts | keep-or-cut 裁决 |
| R8 | 无 linter；guard 链 `&&` 首错遮蔽；dead-export CI 未 strict | package.json check:guards; .github/workflows/ci.yml | 引入 biome + run-all 聚合器 |
| R9 | pnpm 版本手工钉在 3 个 workflow（ci/dev-dmg/release 各 `version: 11.20.0`），package.json 无 `packageManager` 字段 | .github/workflows/*.yml | 单源化 + 与 dsh-source.json 一致性断言 |
| R10 | Electron 主进程 menu/ipc 为纯工厂（stub host 即可测）但零测试 | src/menu.ts:87,197; src/ipc.ts:58,69 | 低成本新测试 |
| R11 | 双语仅 4/12 成对；interaction-model.en.md:85 引用损坏；两个 agent-workflows 目录缺 audit.md | docs/ | 收口策略见 W4 |

## 波次总览

| Wave | Leaves(ledger=gates/leaf-*.md) | 目标维度 | 状态 |
|---|---|---|---|
| W1 | S1 · S2 · S3 | F 7→8.5 | VERIFIED（node-security ALL MET） |
| W2 | P1 · P2 | E 7→8.0 | VERIFIED（node-perf ALL MET；DOM 1764→24 实测） |
| W3 | M1 · M2 · M3 | A/B 7→7.5 | VERIFIED（node-structure 全仓三连；M1/M2/M3 全部复验） |
| W4 | TG（=T1+T2+T3 合并） | D 7.5→8.5 | VERIFIED（biome 0 错误 / 聚合器负控退出码 1 / pin 单源 guard 绿） |
| W5 | T4 · T5 · T6 | C/H/G 收口 | VERIFIED（T4 4 个 chrome 行为测试；T5/T6 独立复验；node-eng ALL MET） |

> 执行布局：计划与门禁唯一事实源在 plans/score-uplift/**；租约/波次运行态在
> .unlazy/score-uplift/**（经 .agent-workflows/kernel-refactor-execution/scripts/
> claim-plan-leaf.mjs 桥接认领，验证用 gate-check 显式传台账路径）。

---

## W1 安全收口

### leaf-S1 服务端 workspace scope 注册表
Scope: capabilities 新增 `WorkspaceScopeRegistry`：允许集 = DSH session store 内 session 的 cwd ∪ worktree-orchestration 注册的 worktree 根（attach 时快照 + 变更事件刷新）；`cwdOf/cwdScopeOf` 先查注册表，未注册 cwd → `CapabilityError('forbidden')`；`fs.tree/read/tail` 一律过 `assertWithinSession`（读取域 = 该 cwd 本身；如需更多只读目录，走显式 config 白名单而非放开绝对路径）。同步修订 docs/design.md/design.en.md 安全边界措辞使名实一致。
Gates: 未注册 cwd 被拒 / 已注册放行 / `..` 与分隔符穿越被拒（新单测）；routes 全部既有测试绿；typecheck+build 绿。
OWNS: plugins/capabilities/src/routes* , routes/shared.ts , 新 registry 模块, tests/scope-registry.test.ts, docs/design{,.en}.md 安全段落。

### leaf-S2 fence 三件套行为测试
Scope: isWithin（大小写不敏感分支、尾分隔符、前缀串陷阱 `/-a` vs `/a`、跨平台参数）、assertWithinSession、isTrustedApiRequest（DNS-rebinding host、Origin 不匹配、host 大小写）、process-tree-killer 的 PID 回收 + root 信号语义。
Gates: 新增 tests/boundaries.test.ts 全绿；覆盖上述每条分支至少一断言。

### leaf-S3 push 类路由的服务端闸（决策叶）
Scope: 二选一落账——(a) git.push/force-push 增加 requireConfirm(confirmation token) 服务端闸；(b) ADR 说明同源围栏足够并写入 design 安全节。禁止不选。
Gates: 决策记录 + 对应实现或文档 diff。

## W2 性能

### leaf-P1 市场网格虚拟化
Scope: `marketplace-filters.tsx` 卡片网格改 `useVirtualizer`（复制 desktop-left-rail/workspace-browser-views 模式；grid 布局用 lane/列宽计算）；保持分类过滤、选中、详情打开行为不变；跑 `sync-dsh-dependencies.mjs` 使五清单吸收新 import 并过 guard-dsh-dependencies。
Gates: DEV 实机 eval 断言挂载卡片数 ≤ 视口行 × 列 + overscan（chrome-use 取证截图）；marketplace 全部既有测试绿；deps guard 绿。

### leaf-P2 目录拉取分页（可选）
Scope: github-source-adapter 增量/分页合并，避免首开全量。若首屏实测无可感知卡顿可降级为 ADR 记录不改。
Gates: 实现则附网络层 mock 测试；降级则 ADR。

## W3 结构性可维护性

### leaf-M1 transaction-manager 四拆
Scope: 按 :216-273/:318-403/:442-498 天然边界拆出 state-file.ts / allowbuild-yaml.ts / fs-ops.ts，原文件保留相位编排并 <500 行；公共门面签名零变化。
Gates: marketplace-phases/reconcile/store 三套测试不改一行全绿（证明行为锁定）；wc -l 断言编排层预算。

### leaf-M2 capabilities apply() 工厂化
Scope: 496 行 apply() 拆为 createTerminalAssembly / createSettingsDomain / createUiChromeDomain / createToolGateSync 等 {face, dispose} 工厂；闭包共享可变态改为显式传参。
Gates: capabilities-wire-contract/dsh-dependencies 测试绿；全仓 typecheck/test/build 三连。

### leaf-M3 投机面 keep-or-cut
Scope: workbench.state（零消费者）与 composer/history 四件套逐个裁决：接入真实消费者（需给出具体 surface）或删除并在本账留 ADR。禁止"继续休眠"选项。
Gates: ADR + 代码动作一致；死代码规格（若删）转绿或更新。

## W4 工程与文档

### leaf-T1 引入 biome
Scope: devDependencies + `biome check` 进 check:guards 链首；存量问题一次性 safe-fix，不可自动修复项建白名单文件表入 scripts/guards/README.md。
Gates: biome check 全绿；CI 绿。

### leaf-T2 guard 链聚合器
Scope: scripts/guards/run-all.mjs 顺序执行并汇总全部失败后统一退出非零；package.json 改用之；dead-export 默认加 `--strict`。
Gates: 注入双违规 fixture 时输出同时包含两条；正常路径 GUARD-OK。

### leaf-T3 pnpm pin 单源
Scope: package.json 增加 `"packageManager": "pnpm@11.20.0"`；三个 workflow 删除 `version:` 输入改由 action-setup 读字段；guard-dsh-dependencies 增断言 dsh-source.json.packageManager 与之一致。
Gates: 全仓 grep 仅剩单一事实点；guard 绿；CI 语法校验过。

### leaf-T4 主进程 chrome 测试
Scope: stub MenuHost/IpcHost 测 createMenuModule 模板构造（含 Settings/Toggle 通道映射）、createIpcModule 通道注册、normalizeWorkspacePaths 边界、windows.ts 上下文开关再断言。
Gates: 新 tests/desktop-chrome.test.ts 全绿并覆盖三模块全部导出工厂。

### leaf-T5 双语与审计收口
Scope: 【需裁决】默认方案 = 核心 3 篇（PLUGIN-DEVELOPMENT / persistence-architecture / workbench-architecture）补 EN，其余声明 zh-only 层级并修订 AGENTS.md 双语规则措辞；修复 interaction-model.en.md:85 损坏引用；补两个缺失 audit.md 骨架。
Gates: docs 配对清点脚本输出符合声明层级；损坏行 grep 清零。

### leaf-T6 runtime smoke 多平台（可选，nightly）
Scope: 现有 xvfb smoke 以 nightly workflow 跑 windows/macos leg，不占 PR 时间。
Gates: nightly 手动触发一次全绿留档。

---

## 评分投影（加权模型同基线报告）

| 维度 | 现 | 目标 | 驱动叶 |
|---|---|---|---|
| A 架构 | 7.0 | 7.5 | M1 M2（+S1 类型化 scope 接缝） |
| B 代码质量 | 7.0 | 7.5 | M2 M3 |
| C 测试 | 8.0 | 8.5 | S2 T4（+M1 行为锁定红利） |
| D 工程 | 7.5 | 8.5 | T1 T2 T3 |
| E 性能 | 7.0 | 8.0 | P1(P2) |
| F 安全 | 7.0 | 8.5 | S1 S2 S3 |
| G 跨平台 | 8.0 | 8.0~8.5 | T3(T6) |
| H 文档 | 7.5 | 8.0 | T5 |

**最终复测：8.07（报告值 8.1/10）**（权重同基线：A.18/B.15/C.15/D.12/E.12/F.13/G.07/H.08；保守分项 A7.5/B7.5/C8.5/D8.5/E8.0/F8.5/G8.5/H8.0）。

## 明确不做

- 不借机重构 W3 之外的任何大文件；不加运行时依赖（biome 仅 devDep；react-virtual 已存在）；
- 不动 GitWatch/source-control retention 等已验证契约；全程无 commit/push 授权时仅本地验证。
