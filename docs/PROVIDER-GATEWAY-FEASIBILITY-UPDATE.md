# PROVIDER-GATEWAY-PLAN 可行性复评（2026-08-13）

> 对 `docs/PROVIDER-GATEWAY-PLAN.md` 的可行性复评。复评基于两个仓库的
> 实测现状（全部结论带 file:line 证据）：
> - Oh-DSH-Desktop 工作区（DSH 已升级到 0.1.0-rc.5，未提交）
> - Synara fork `agent-driver-refactor`（HEAD `d3ae2cdc6`，2026-08-13）
>
> 复评人：评估 agent（加载 make-dsh-plugin skill 后执行）；文档日期：2026-08-13。

---

## 0. 结论摘要

**原计划的核心判断仍然成立，且整体可行性上调一档**——因为最大的前置风险
（Phase 0 版本升级）事实上已经完成。但出现了**一个新的关键决策点**：
Synara 侧 provider 层正处于大规模重构迁移中（双层并存），vendoring 目标
层的选择决定了工期与维护成本。

| 维度 | 原计划结论 | 复评结论 |
| --- | --- | --- |
| 路径 C（网关插件承载供应商运行时） | 🟡 中高可行 | 🟢 **高可行**（Phase 0 已实际完成） |
| DSH rc.2 → 0.1.x 升级 | 高风险的 Phase 0 前置 | ✅ **已发生**（工作区 dsh-source.json = 0.1.0-rc.5 / 47f94385） |
| conversation-node / subagent-acp / llm-pi-ai 可用性 | 需实测 | ✅ 全部可用（且 llm-pi-ai 已在 profile 运行中） |
| Synara provider 层可 vendored | 直接搬移 9 家 | ⚠️ **可 vendored，但对象是「迁移中的双层结构」，必须 pin revision 并选层** |
| 前端会话体验（Phase 3） | 工作量最大 | 不变——conversation-node 机制可用，但渲染仍是自建工作 |
| 总工期（单人全栈） | 约 7–9 周 | **约 6.5–8 周**（Phase 0 已省 0.5–1 周；vendoring 选型增加 ~0.5 周） |

---

## 1. 前提变化（相对原计划撰写时）

### 1.1 DSH 升级已完成（最大前置风险消除）

- `dsh-source.json`（工作区未提交改动）：
  `deepseek-ai/deepseek-harness` @ master @ `47f943859b` = **0.1.0-rc.5**
  （原计划写的是私有仓库 `dsh2026/test-zevorn.git` 0.0.1-rc.2）
- 本地 harness checkout 恰为该 revision（`git rev-parse HEAD` = 47f943859b）
- 构建脚本已适配 rc.5：`scripts/build-dsh.mjs` 改 `corepack pnpm` +
  `build:lib` + 单独构建 `@deepseek-ai/dsh-web-frontend`；新增
  `scripts/dev.mjs`、`scripts/build-config.mjs`
- 皮肤插件已有适配工作（`plugins/desktop-skins/src/client/skins.ts` +118 行）、
  测试已同步（`tests/desktop-skins.test.ts`、`tests/plugin-marketplace.test.ts`）

> 结论：Phase 0 的「确认 rc.2 是否具备新能力 + 规划升级」已实质完成，
> 剩余工作是**升级回归验证**（冒烟 + 各插件适配确认），不再是可行性风险。

### 1.2 Synara provider 层正在重构迁移（新出现的核心变量）

`agent-driver-refactor`（verger-guo/synara fork）在 **2026-08-11 → 08-13
两天半内约 40 条 commit**（HEAD `d3ae2cdc6` "merge: 合并 conversation-v2 并
修复 Provider Runtime GAP"），provider 层从「单一 host 文件家族」裂解为：

- `packages/agent-driver/`（新：能力 / 进程 / 协议适配 / L3 有状态运行时）
- `packages/provider-protocol/`（新：供应商无关契约层，L0-L4 分层）
- `apps/server/src/agentDriverHost/`（新：10 个 `Provider*PortAdapter` 反向端口）

docs/rebuild-architecture 41–47 全部自标 **Wave 0 设计基线**；47 runbook 明示
shared lifecycle reducer = **Conditional Go 且至今未实现**；46 的 F1-F6 门禁
未全过；milo/部分 ACP 标 unknown；测试有引用缺口（`TransportConformance.ts`
缺失、`CredentialPort` 缺失）。

> 结论：原计划「vendored Synara 层」的假设对象已经从「一份稳定实现」变成
> 「双层并存、上层迁移进行中」。vendoring 必须**选层 + pin revision**。

---

## 2. DSH 侧验证结果（rc.5 / 47f94385）

| 原计划引用的证据 | 复评状态 | 位置 |
| --- | --- | --- |
| LlmRuntime / LlmAdapter / registerAdapter | ✅ 成立 | harness `packages/llm/llm/src/index.ts:171,232,338` |
| AgentOptions 仅模型路由（无外部后端 seam） | ✅ 成立 | harness `packages/core/agent/src/runtime-types.ts` |
| conversation-node 教程 | ✅ 成立且更完整 | `docs/cookbook/adding-a-conversation-node.md`；client API `ConversationNodeDefinition/Context` 在 `dsh-client-runtime/lib/types/client/index.d.ts:16`（已装 0.1.0-rc.5）；`SessionEventMap` 在 `dsh-session/lib/types/types.d.ts:223`；官方决策记录 `.agents/notes/.../2026-08-09-client-conversation-node-assembly.md` |
| subagent-acp = ACP client 子进程 | ✅ 成立 | `packages/subagent/subagent-acp/README.md`（fresh subprocess + 自身 runtime/session/model/tools；`permission` 默认 `reject`） |
| dsh-acp = ACP server（方向相反） | ✅ 成立 | `packages/acp/acp/README.md` |
| llm-pi-ai 多供应商 | ✅ 成立且已在运行 | `packages/llm/llm-pi-ai`（@earendil-works/pi-ai providers/all 全目录）；`~/.dsh/settings.yaml` 已配置 `llm-pi-ai.providers.opencode-go` → deepseek-v4-flash，**当前评估会话即运行其上** |
| 插件承载服务先例 | ✅ 成立 | oh-dsh `plugins/better-sidebar-runtime`（dist 构建，源码 vendor 在 `plugins/better-sidebar-runtime/src/`：agent-pty / fs-tree / git / pty-manager / trust-fence） |
| 审批 seam | ✅ 存在（原计划未提） | harness `packages/interaction/user-approval`、`packages/interaction/permission-presets`、`packages/client/ui-permission-presets`——审批桥可直接挂官方服务 |
| SQLite 兼容性 | ✅ **双端同构**（原计划未提） | DSH 自带 `dsh-session-query-sqlite` 用 **`node:sqlite` DatabaseSync**（`lib/index.js:49`）；Synara `NodeSqliteClient` 也是 `node:sqlite`（`apps/server/src/persistence/NodeSqliteClient.ts:2-7`）；DSH engines `node ^22.19`，Electron 42 = Node 22.x → **无原生模块编译负担** |

### 现有插件契约面（升级影响）

- 6 个 bundle 插件 + shared：`better-sidebar-runtime` / `desktop-skins` /
  `desktop-sidebar` / `panel-controls` / `pinned-summary` / `plugin-marketplace`
- client inject 面全部指向 rc.5 官方包（`@deepseek-ai/dsh-client-runtime` /
  `dsh-client-ui-*` / `dsh-client-locale`），已在 profile node_modules 验证
  0.1.0-rc.5 全套存在 → **升级破坏面小，风险可控**（与原计划判断一致）

---

## 3. Synara 侧验证结果（agent-driver-refactor @ d3ae2cdc6）

### 3.1 原计划引用的旧层证据：大部分仍在

| 原计划证据 | 状态 | 位置 |
| --- | --- | --- |
| ProviderHostPort | ✅ 仍在（定位降为 conversationRuntime 的 provider 边界，非唯一运行时宿主） | `apps/server/src/conversationRuntime/provider/provider-host-port.ts:315-336` |
| 9 供应商 ProviderKind | ✅ 仍在（**pi 已提升为一级 ProviderKind**；另有 `ProviderApprovalPolicy`：untrusted/on-failure/on-request/never） | `packages/contracts/src/orchestration.ts:198-209,211` |
| InboxBuffer（SQLite + 幂等） | ✅ 仍在且强化：`RuntimeInboxRow` 带 payloadHash + status（received/claimed/applied/retryable_failure/dead_letter）+ leaseOwner/leaseToken/leaseExpiresAt + sequence/generation；hash 冲突抛 `RuntimeInboxHashConflictError`；幂等键 `(streamId,scopeId,generation,sequence)+payloadHash`；崩溃/lease 恢复见 `composition/startup-recovery.ts` + `acceptance/crash-restart.matrix.test.ts` | `apps/server/src/conversationRuntime/events/inbox-buffer.ts`；`provider-host-port.ts:33-39,84-103,137-220` |
| runtime-event-normalization | ✅ 仍在（且修复了文档点名的 blocker，`:481`） | `apps/server/src/conversationRuntime/events/runtime-event-normalization.ts` |
| productionLayer.ts（host registry） | ❌ **已删除** | 被 `packages/agent-driver/src/providers/registry.ts:112-211` + `boot/adapterLayers.ts` 取代 |

### 3.2 新形态：双层结构

- **接入方式**按 4 个 protocol 家族：codex=app-server（JSON-RPC stdio，
  `CodexAppServerManager` ~1778 行）；cursor/gemini/grok/droid=ACP 外部子进程
  （`families/acp/*AcpAdapterRuntime.ts`）；claudeAgent/opencode/kilo=sdk-agent
  （`families/sdkAgent/`，kilo 经 OpenCode-like runtime，43 矩阵标 unknown）；
  **pi=rpc**（wave4 把 Pi 从 in-process SDK 迁到 `pi --mode rpc` JSONL，
  `families/rpc/pi/PiRpcRuntime.ts`，注释明言「replaces the in-process SDK
  adapter」——**最新、最脆的一段**）
- **统一抽象三足鼎立**：`ProviderAdapter`（能力对象，
  `Services/ProviderAdapter.ts:240-359`，能力位取代 supports；能力清单：
  `startSession` L250 / `sendTurn` L257 / `interruptTurn` L264 /
  `respondToRequest` L273 / `respondToUserInput` L282 / `stopSession` L291 /
  `forkThread` L177 / `compactThread` L169 / `rollbackThread` L322 /
  `streamEvents` L335，能力宣告 `ProviderAdapterCapabilities` L93-119）+
  `ProviderService`（L3 路由，`Layers/ProviderService.ts`，`startSession` L1126 /
  `sendTurn` L1334 / `forkThread` L1243 / `respondToRequest` L1520）+
  conversationRuntime `ProviderHostPort` 边界
- **事件归一化两级**：adapter 级 `events/ProviderEventNormalizer.ts:20`（校验收敛
  provider session 身份，缺失即 `ProviderEventNormalizationError`，绝不 fallback）
  → 对话级 `runtime-event-normalization.ts:128`，统一为 50 种 canonical
  `ProviderRuntimeEventV2`（`provider-protocol/providerRuntime.ts:158-207`）
- **审批泛化**：`request_permission` → `request.opened / request.resolved` +
  `CanonicalRequestType`（`providerRuntime.ts:145-156`：command_execution /
  file_read / file_change / apply_patch / exec_command + tool_user_input /
  dynamic_tool_call / auth_tokens_refresh）；codex app-server 映射
  `CodexAdapterRuntime.ts:393-420`；decision `accept/acceptForSession/decline/cancel`
  （`provider-protocol/provider.ts:234-239`）；读侧
  `ConversationDetailApplication.ts:115-127` 生成 pendingApprovals。
  **注意能力差异：pi `supportsApproval:false`（`providers/registry.ts:209`）；
  sdk-agent host 对 approval 返回 unsupported-outcome**
- **会话持久化两层 SQLite**：provider runtime binding
  （`persistence/worktree/ProviderSessionRuntimeRepository.ts`：
  providerSessionId/worktreeId/threadId/runtimeMode/status/resumeCursor/
  runtimePayload，经 `ProviderSessionStorePortAdapter` 暴露）+ conversation 事实日志
  （inbox-buffer + durable-event-log + snapshot-store + consumer-cursor）
- **agent-driver 本身零 SQLite 直接依赖**——只靠 `hostPorts.ts` 的端口
  （SessionStore/Credential/EventSink/Attention/Attachment/Analytics/Capacity/
  TurnLifecycle/Health）要求宿主注入实现 → **对 DSH vendoring 极友好**：
  vendor 侧只需实现这些端口，进程管理与协议适配自含

### 3.3 成熟度判断（vendoring 决策关键）

| 信号 | 读数 |
| --- | --- |
| 迁移进度 | Wave 0（41-47 文档）已完成；**Wave 1 contract/conformance、Wave 2 Pi 增量、Wave 3 第二 provider（Claude 或 Cursor ACP 试点）、Wave 4 scheduler 拆频、Wave 5 独立专项全部待办**（runbook 47 §3–§7）。**只有 Pi 全 confirmed**；Claude lifecycle pattern 同态待证；ACP 家族 pattern/部分 unknown；OpenCode 需单独验证；**Kilo 仅 registry/session cursor mapping，无完整实现**（`providers/kilo/registration.ts`）；Codex app-server 独立协议 |
| 行为化验收 | 仅 Pi 有全套 conformance/probe fixture；**F3 门禁要求 Pi+Claude+一个 ACP 三 provider 过同一可观察矩阵；F6 要求三 provider terminal/late/stop/exit 结果一致才能抽 shared reducer**——两者都未达成，即「跨 provider shared kernel」未建立；Claude/ACP 的 conformance fixture 是 Wave 1 待办 |
| 已知坑 | P2 队列卡死（`DispatchQueuedTurn` 误发 `turn.queue` 致存在性校验失败+duplicate 语义错配）；P3 权限切换失败（目标线程缺 `conversation.created` 事件、`conversation.mode.runtime.set` 不在豁免集 → 根因是 lifecycle worker 未物化事实的异步窗口未统一豁免）；codex runtime event 无 provider session identity 周期性重启；Claude 403 / Pi 无回复文本 / 120s lease 后 reconciliation（环境类）；**测试引用缺口（TransportConformance.ts 缺失、CredentialPort 组装缺失）——迁移未闭合的直接证据** |
| 活跃度 | 2.5 天 40 commits——**fast-moving** |
| 有利面 | 分层干净、端口解耦、强类型契约；`node:sqlite` 与 DSH 同构；文档与代码有偏差时**代码领先**（41/42/47 点名的 `item.completed` projection blocker 已在 `runtime-event-normalization.ts:481` 修复） |

---

## 4. 可行性评估更新

### 4.1 路径判断不变，评级上调

- 路径 A（模型层注入）❌ 不变——丢失各供应商原生行为，用户不需要
- 路径 B（替换 DSH agent loop）❌ 不变——`AgentOptions` 仍只有
  provider/model/maxTokens，无外部后端 seam
- **路径 C（网关插件）🟢 高可行**——DSH 侧全部前置 seam 已就位（conversation-node、
  subagent-acp 先例、审批服务、node:sqlite）；Synara 侧有真实实现可 vendor

### 4.2 关键设计决策更新（新增一项）

| 决策点 | 原计划 | 复评 |
| --- | --- | --- |
| 供应商承载形态 | 一个网关插件 | ✅ 不变（bundle 形态，参照 @oh-dsh/desktop） |
| provider 层来源 | vendored Synara | ⚠️ **需选层**：旧层（conversationRuntime/provider）稳定但将被替换；新层（agent-driver）架构好但迁移中。**建议：以 provider-protocol 契约为界 + pin revision，按 family 渐进 vendor** |
| 会话数据 | SQLite inbox | ✅ 不变（node:sqlite 双端同构，无原生依赖） |
| 审批 | 显式桥到桌面 UI | ✅ 升级：直接挂 DSH `user-approval` / `permission-presets` 服务 + 现有「人类 UI 与 Agent 共用审批边界」基础设施 |
| 前端 | conversation-node + 自有会话视图 | ✅ 不变；机制现成（教程 + client API），工作量仍在渲染与交互 |

### 4.3 分阶段更新（相对原计划）

- **Phase 0**：已完成（升级已落地工作区），收尾 = 冒烟回归（`pnpm run smoke:runtime`）
- **Phase 1**（1.5–2 周）：vendored 最小内核。**先 ACP family**（cursor/gemini/grok/droid
  共用 host，外部协议最通用）或 **Pi RPC**（唯一全 confirmed 且有全套 conformance
  fixture 的路径——建议 Pi 先行以复用验收资产）；inbox 入 SQLite；UI 文本流
- **Phase 2**（1 周）：审批桥接 DSH user-approval（request.opened/resolved →
  桌面对话框），**绝不静默放行**（subagent-acp 默认 reject 可作参考语义）
- **Phase 3**（2–3 周）：conversation-node 会话视图（文本流最小可用 → 工具活动摘要 →
  错误/结束态）；模型/供应商切换 UI 复用 `dsh-client-ui-model-selection` 思路
- **Phase 4**（2 周）：codex app-server host、sdk-agent host、managed-sdk host 依次接入；
  transfer（forkThread）；可靠性与失败语义
- **合计约 6.5–8 周**（单人全栈）

### 4.4 风险登记更新

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| **Synara 层正在动（新）**：shared lifecycle reducer 未落地（F3 三供应商 conformance 与 F6 三供应商一致态门禁均未过）、Wave 1-5 迁移全部待办；**pi RPC 是 wave4 刚 clean cutover 的最新最脆段**（`PiRpcRuntime.ts` 注释「replaces the in-process SDK adapter」） | **高** | pin 具体 revision；vendor 树冻结；以 provider-protocol 契约为同步边界；vendor 后自带 conformance/probe（Pi fixture 可复用）；pi 路径单独留出验证缓冲 |
| 外部 CLI/SDK 版本敏感（codex app-server 独立协议、claude-agent-sdk、pi `--mode rpc` 0.74.x `agent_end` 无可靠 `isError`、ACP 版本） | 高 | 固定版本 + 启动探测；跟随 Synara 的 version pin 策略；vendor 时逐 provider 单独验证 resume/error 映射 |
| 供应商会话语义坑（vendor 后需防御）：P2 队列卡死（`turn.queue` 误发）、P3 权限切换豁免窗口、codex 事件缺 session identity 重启 | 中 | 以 Synara 根因结论为预置知识；审批桥显式物化 conversation 事实；进程崩溃与 DSH 本体隔离 |
| 迁移测试缺口（TransportConformance / CredentialPort） | 中 | vendor 时补最小 conformance 套件（Pi fixture 可复用） |
| 现有插件升级回归 | 中（已缓解） | 工作区已适配部分；smoke:runtime + 皮肤 token 校验脚本 |
| 前端会话体验适配量大 | 中 | 文本流最小可用先行；工具/审批可视化后置 |
| 供应商进程稳定性 | 中 | 复用 inbox 幂等与失败语义；AGENTS.md 可靠性优先 |

### 4.5 建议（含插件形态，按 make-dsh-plugin skill）

- **形态**：官方 bundle 插件（`dsh.bundle.patch` → `cordis.patch.yml` 组合层 +
  `dsh.client` 声明 + `exports["./client"]`）——需要组合层（网关插件 insert +
  client 注入 + 可选 subagent-acp 配置行），参照 `@oh-dsh/desktop` 与
  plugin-registry 的 `packages/plugin/console` 参考实现；`inject` 声明
  `settings`/`httpServer` 等服务（0811 严格注入）
- **vendoring 策略（三层边界）**：① `packages/provider-protocol`（L0 纯类型契约层，
  无供应商前缀字面量）作为**稳定接口**——对接网关的标准即那 50 种 canonical 事件 +
  Inbox 幂等语义；② `packages/agent-driver` 的 `ProviderAdapter` + `ProviderService` +
  `hostPorts` 作为**运行时边界**——进程管理/协议适配自含、零 SQLite 直接依赖；
  ③ 仅在网关插件内实现宿主端口（`agentDriverHost` 的 `Provider*PortAdapter` 思路，
  持久化落到 DSH 的 node:sqlite）。分两批：第一批 vendor「provider-protocol 契约 +
  ACP family 或 Pi RPC 最小运行时 + inbox 持久化」（约 2-3K 行核心），后续 family
  按 conformance 成熟度逐个跟进；保持与 Synara 的 sync 机制（参照
  better-sidebar-runtime 的 vendored 先例）；**在 F1-F6 门禁通过、shared reducer
  落地前，把它当「迁移中的候选」而非「已冻结的稳定库」**
- **下一步动作**：① `smoke:runtime` 确认 rc.5 升级零回归；② 在 Synara
  fork 上打 vendor 基线 tag；③ 搭网关插件骨架 + Pi 供应商跑通一轮对话

---

## 5. 证据索引（复评新增/变更）

| 事实 | 位置 |
| --- | --- |
| DSH 已升级 0.1.0-rc.5（工作区未提交） | oh-dsh-desktop `dsh-source.json`（git diff）；`scripts/build-dsh.mjs` |
| harness checkout = rc.5 revision | deepseek-harness `git rev-parse HEAD` = 47f943859b |
| conversation-node client API | profile `dsh-client-runtime/lib/types/client/index.d.ts:16`；`dsh-session/lib/types/types.d.ts:223` |
| subagent-acp ACP client + permission 默认 reject | deepseek-harness `packages/subagent/subagent-acp/README.md` |
| llm-pi-ai 已配置运行 | `~/.dsh/settings.yaml`（llm-pi-ai.providers.opencode-go） |
| DSH 用 node:sqlite | profile `dsh-session-query-sqlite/lib/index.js:49`；harness `packages/storage/storage-sqlite/src/unit.ts` |
| 审批服务存在 | harness `packages/interaction/user-approval`、`packages/interaction/permission-presets` |
| 旧层证据仍在（ProviderHostPort/InboxBuffer/归一化） | agent-driver-refactor `apps/server/src/conversationRuntime/provider/provider-host-port.ts:315`；`events/inbox-buffer.ts`；`events/runtime-event-normalization.ts:128` |
| productionLayer 已删除 | agent-driver-refactor（git 历史）→ `packages/agent-driver/src/providers/registry.ts:112` |
| 4 protocol 家族 / Pi RPC 迁移 | agent-driver-refactor `packages/contracts/src/orchestration.ts:198`；`packages/agent-driver/src/families/*`（acp/appServer/sdkAgent/rpc）；wave4 commit 93ca8b23c |
| 50 种 canonical 事件 / 审批泛化 | `packages/provider-protocol/src/providerRuntime.ts:158-207,145-156`；`packages/agent-driver/src/events/ProviderEventNormalizer.ts:20` |
| ProviderAdapter 能力清单 / ProviderService 路由 | `packages/agent-driver/src/Services/ProviderAdapter.ts:93-119,240-359`；`Layers/ProviderService.ts:1126,1334,1243,1520` |
| Inbox 幂等状态机 / lease 恢复 | `apps/server/src/conversationRuntime/events/inbox-buffer.ts`；`provider-host-port.ts:33-39,84-103`；`composition/startup-recovery.ts`；`acceptance/crash-restart.matrix.test.ts` |
| agent-driver 零 SQLite、宿主端口注入 | `packages/agent-driver/src/hostPorts.ts`；`apps/server/src/agentDriverHost/ports.ts:29-58` |
| pi supportsApproval:false / sdk-agent 审批 unsupported | `packages/agent-driver/src/providers/registry.ts:209`；`apps/server/src/conversationRuntime/provider/provider-host.sdk-agent.ts:114-116` |
| ProviderApprovalPolicy | `packages/contracts/src/orchestration.ts:211` |
| 迁移 Wave 0 / 未收敛信号 | `docs/rebuild-architecture/README.md`、41–47；`git log`（08-11→08-13 约 40 commits，含仅「1」的提交 3c61f30b1） |
