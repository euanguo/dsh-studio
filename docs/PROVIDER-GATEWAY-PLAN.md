# Oh-DSH-Desktop 多供应商网关：可行性分析、开发方案与体验预期

> 目标：把 Oh-DSH-Desktop（Electron 桌面应用，DSH runtime）作为「壳」，
> 通过其插件机制承载**多个完整 agent 运行时供应商**（Codex app-server、
> Claude Agent SDK、ACP 子进程等），使其成为「所有供应商的桌面应用」。
>
> 本文档基于对两个仓库源码的实测探索（全部结论带 file:line 证据）：
> - DSH 上游：`deepseek-harness`（master = 0.1.0-rc.5；Oh-DSH 固定 0.0.1-rc.2）
> - Synara 后端：`apps/server` 的 9 个供应商 host 实现
> - Oh-DSH-Desktop 现有插件：`plugins/`（better-sidebar-runtime 等服务型插件先例）
>
> 文档日期：2026-08；适用：oh-dsh-desktop 0.1.2。

---

## 第一部分：可行性分析

### 1.1 结论摘要

| 维度 | 结论 |
| --- | --- |
| 「每供应商一个 LlmAdapter 插件」注入模型 API | 🟢 高可行（官方 seam + 教程 + 已内置 llm-pi-ai） |
| **「网关插件承载完整 agent 运行时供应商」**（本方案） | 🟡 **中高可行**（需版本升级 + 事件/审批桥 + 前端适配） |
| 保留各供应商原生 agent 行为（工具、审批、循环） | ✅ 可保留（供应商进程自持） |
| 完整复用 DSH 主 UI 的会话/工具/计划面板 | ❌ 不可直接复用（绑定 DSH 自有 agent loop，需自建会话视图） |

核心判断：**插件可以承载任意服务**（本仓库 `better-sidebar-runtime`
已证明：一个插件扛起 PTY/Files/Git 完整本地服务）。因此「把 Synara 的
9 个供应商 host 打包成一个网关插件、挂进桌面应用」在机制上完全成立。
真正的工程风险在版本升级、事件归一化、审批桥与前端会话体验。

### 1.2 关键事实与证据

#### A. 插件机制：可承载服务（本仓库先例）

- `plugins/better-sidebar-runtime`：一个插件承载 PTY、Files、Git、history、
  commit-diff 的完整本地能力层（`README.md` 内置 plugins 表）
- `plugins/desktop-skins`：插件内注册 HTTP 路由做偏好持久化
  （`src/preferences-server.ts` 的 `ctx.webServer.register`）
- Cordis 插件 = 任意 Node 代码 + `ctx.effect` 生命周期管理；spawn 子进程、
  开 WS/HTTP、桥接外部服务都是插件份内事

#### B. DSH 的 LLM 层：官方 seam 存在但语义是「模型 API」

- `ctx.llm` = `LlmRuntime`（`packages/llm/llm/src/index.ts:25`）
- 适配器接口 `LlmAdapter`：唯一必需方法 `stream(GenerateOptions)`
  （`index.ts:191,239`）；注册 API `registerAdapter(['route'], adapter)`
  （`index.ts:319`）
- 官方教程 `docs/cookbook/adding-an-llm-adapter.md`：插件模板
  `name` / `inject: ['llm']` / `apply(ctx)` 内注册
- 单供应商插件范本：`llm-deepseek`（路由 `deepseek-official`，
  `llm-deepseek/src/index.ts:48-55`）
- 多供应商通用插件已内置：`llm-pi-ai`（基于 `@earendil-works/pi-ai@0.82.1`，
  覆盖 openai/anthropic/deepseek/bedrock/vertex/azure/codex，
  `tests/catalog.spec.ts:35,44,129`、`docs/user/guide/providers.md:19`）
- 约束：路由全局唯一，重复注册抛 `DUPLICATE_ADAPTER`（`index.ts:345-354`）

> 但这条 seam 只能接「模型 API 流」，接不了「完整 agent 运行时」——
> 这正是路径 2 不能走 `ctx.llm` 的原因。

#### C. DSH 的 agent 层：无外部后端 seam（硬编码循环）

- `AgentOptions` 只有 `provider`（模型路由）/`model`/`maxTokens`
  （`packages/core/agent/src/runtime-types.ts:24-31`）——provider 指
  LlmAdapter 路由，不是外部 agent 进程
- agent 循环（工具调用、审批、文件系统、会话日志）是 DSH 内置单一实现，
  不可替换

#### D. DSH 生态的 ACP client 先例（方向正确！）

- `subagent-acp`：**在子进程中以 ACP client 驱动外部 agent** 的官方实现——
  "drives it as an Agent Client Protocol client. The child has its own runtime,
  session, model configuration, and tools"
  （`packages/subagent/subagent-acp/README.md`）
- 注意：DSH 自带 `dsh-acp` 包是 **ACP server**（把 DSH agent 暴露给外部），
  方向与 subagent-acp 相反；subagent-acp 证明 DSH 生态里 ACP client 方向可行

#### E. DSH 的 UI 外部事件注入点

- `docs/cookbook/adding-a-conversation-node.md`：官方教程——把外部业务
  事件族（replayable event family）通过 `SessionEventMap` 渲染成
  Chat 视图的 keyed 节点，增量构建业务 State

#### F. Synara 后端：9 个供应商 host（可直接搬移）

`packages/contracts/src/orchestration.ts:198-204` 的 `ProviderKind`：

| 供应商 | 接入方式 | 进程形态 | Synara host |
| --- | --- | --- | --- |
| codex | app-server（JSON-RPC stdio） | `codex app-server` 子进程 | provider-host.codex.ts |
| claudeAgent | claude-agent-sdk query | 外部 SDK 会话 | provider-host.sdk-agent.ts |
| pi | sdk-agent | 外部 SDK 会话 | provider-host.sdk-agent.ts |
| cursor/gemini/grok/droid | ACP（JSON-RPC stdio） | 外部子进程 | provider-host.acp.ts |
| opencode/kilo | managed SDK server | 托管 SDK server | provider-host.managed-sdk.ts |

统一抽象：`ProviderHostPort`（`provider-host-port.ts:315-336`）——
`execute(ProviderExecuteRequest)→ProviderOutcome`、`transfer`、
`startSession`、`bindSession`、`supports(intentType, providerId)`；
事件经 `InboxBuffer`（SQLite 持久化 + 幂等）与 `runtime-event-normalization`
归一化为 facts；host registry 在 `productionLayer.ts:248-302`
（`providerId → host` Map 路由）。

> 这整层可以 vendored 进网关插件——Synara 已经替我们写好了
> 「多供应商进程管理 + 事件归一化」的完整实现。

#### G. 版本差距（最大前置风险）

- Oh-DSH-Desktop 固定 DSH **0.0.1-rc.2**（`dsh-source.json`，私有仓库
  `dsh2026/test-zevorn.git`，revision `7b9644f2`）
- 上游 master 已是 **0.1.0-rc.5**
- subagent-acp / conversation-node / llm-pi-ai 属于较新架构，rc.2 是否具备
  **必须实测确认**（私有仓库无法直接 clone 验证）
- 升级会牵动现有全部 Oh-DSH 插件契约（6 套皮肤、侧栏、面板、市场）

### 1.3 三条路径对比（为什么选网关插件）

| 路径 | 做法 | 供应商行为 | 可行性 | 结论 |
| --- | --- | --- | --- | --- |
| A. 模型层注入 | 每供应商一个 LlmAdapter 插件 | 统一为 DSH 循环 | 高 | 用户不需要（丢失各家行为） |
| B. agent 层替换 | 替换 DSH 的 agent loop | 各家原生 | 低 | 需 fork DSH 核心，无 seam |
| **C. 网关插件（本方案）** | **一个插件承载 Synara provider 层，桌面壳 + 自有会话视图** | **各家原生** | **中高** | **选定** |

---

## 第二部分：开发方案

### 2.1 总体架构

```
Oh-DSH-Desktop.app（Electron）
├── DSH runtime（升级到 0.1.x，作为壳与 UI 宿主）
│   ├── DSH Web UI（官方会话视图 + conversation-node 扩展点）
│   ├── 现有 Oh-DSH 插件（皮肤/侧栏/面板/市场，升级适配）
│   └── 新增：@oh-dsh/provider-gateway（Host 端）
│       ├── ProviderHostRegistry（vendored Synara 层）
│       │   ├── provider-host.codex.ts      → codex app-server 子进程
│       │   ├── provider-host.acp.ts        → cursor/gemini/grok/droid 子进程
│       │   ├── provider-host.sdk-agent.ts  → claudeAgent/pi
│       │   └── provider-host.managed-sdk.ts→ opencode/kilo
│       ├── 供应商会话管理（start/bind/transfer、SQLite inbox 持久化）
│       ├── 审批桥（外部 request_permission → 桌面对话框/通知）
│       └── 事件归一化 → DSH SessionEventMap
│   └── 新增：@oh-dsh/provider-gateway（Client 端）
│       └── conversation-node 定义：会话节点渲染、供应商切换 UI、
│           审批弹窗、模型选择器
└── Electron shell（窗口/菜单/原生能力，照旧）
```

### 2.2 分阶段实施计划

#### Phase 0：版本升级评估（0.5–1 周）★ 前置，必须先做

- 确认 rc.2 是否已有 conversation-node / subagent-acp / llm-pi-ai；
  若无，规划 rc.2 → 0.1.x 升级
- 盘点现有 7 个 Oh-DSH 插件对 DSH 契约的依赖面（inject 列表、client API），
  列出破坏点
- 产出：升级影响清单 + 每插件的适配任务

#### Phase 1：网关插件骨架 + 第一个供应商（1–2 周）

- 新建 `plugins/provider-gateway/`（参照 better-sidebar-runtime 的形态：
  Host 端进程管理 + `cordis.patch.yml` 挂载）
- vendored Synara provider 层：先搬 `provider-host.acp.ts` 家族
  （外部协议最通用，cursor/gemini/grok/droid 共用一个 host）
- 实现供应商会话生命周期：`provider.catalog`（列表/健康状态）、
  `conversation.start`、事件入 inbox、断线重连
- 验收：桌面内启动一个 ACP 供应商（如 gemini）子进程，能跑通一轮对话，
  事件落到 SQLite，UI 能显示文本流

#### Phase 2：审批桥 + 安全边界（1 周）

- 外部 `request_permission` → 桌面通知 + 原生对话框（allow_once/reject_once），
  参照 ACP 契约与 Synara 的 approval 语义；**绝不静默放行**
- 供应商进程沙箱/workspace 边界（沿用 Synara 的 session/workspace 校验）
- 密钥管理：沿用 `$DSH_HOME/.credentials.yaml` 模式，配置只存引用

#### Phase 3：前端会话体验（2–3 周）★ 工作量最大

- conversation-node 定义：外部供应商会话渲染为 Chat 视图节点
  （流式文本、工具活动、错误态、结束态）
- 供应商切换 UI（设置页 + 会话内 model/provider 选择器）
- 会话持久化与历史恢复（SQLite inbox → 重放为节点 State）
- 多会话（每供应商多窗口/多标签）

#### Phase 4：其余供应商家族接入 + 打磨（2 周）

- codex app-server host、sdk-agent host、managed-sdk host 依次接入
- transfer（import/fork/handoff）能力
- 性能与可靠性（流式缓冲、重连、部分流、失败语义）

**总计：约 7–9 周**（单人全栈；Phase 0 结果可能缩短或延长）

### 2.3 关键设计决策

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 供应商承载形态 | 一个网关插件（多供应商） | 共享 inbox/归一化/审批桥；比每供应商一插件更少重复；与 llm-pi-ai 的「一插件多路由」同构 |
| provider 层来源 | vendored Synara（保持同步策略） | Synara 已实现全部 9 家；下游改造模式与 better-sidebar-runtime 一致 |
| 会话数据 | SQLite inbox（复用 Synara 持久化语义） | 断线恢复、幂等、重放 |
| 审批 | 显式桥到桌面 UI | 外部进程权限必须人审，符合 AGENTS.md 安全优先 |
| 前端 | conversation-node + 自有会话视图 | 不试图复用 DSH 主 loop 的 UI（绑定其内部 agent） |

### 2.4 风险登记

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| rc.2 缺 conversation-node/ACP client 能力 | 高 | Phase 0 先实测；必要时先做纯 Host 版（桌面对话框轮询）再补 UI |
| 版本升级破坏现有插件 | 中 | Phase 0 破坏点清单 + 逐个适配（皮肤/侧栏风险可控） |
| 前端会话体验适配量大 | 中 | 先用文本流节点（最小可用），工具/审批可视化后置 |
| 供应商进程稳定性（崩溃/重启/部分流） | 中 | 复用 Synara 的 inbox 幂等与失败语义；AGENTS.md 可靠性优先 |
| 私有 DSH 仓库访问 | 低 | 已有固定 revision 机制；升级需新 revision |

---

## 第三部分：体验效果预期

### 3.1 最终形态（目标体验）

```
启动 Oh-DSH-Desktop
└─ 供应商工作台（新主页/侧栏入口）
   ├─ 供应商卡片列表（Codex / Claude / Gemini / Grok / Cursor / Droid /
   │    OpenCode / Kilo / Pi）+ 健康状态 + 各自模型列表
   ├─ 点击任一家 → 打开该供应商的会话标签页
   │    ├─ 流式文本回复（各供应商原生 agent 行为：工具调用、思考、审批）
   │    ├─ 审批请求 → 桌面原生对话框（允许一次/拒绝一次）
   │    ├─ 会话历史持久化，重启后恢复
   │    └─ 每供应商可开多个会话（多标签）
   ├─ 会话内可切换供应商/模型（transfer 能力）
   └─ 设置页：各供应商 binaryPath/launchArgs/密钥引用（沿用 DSH settings）
```

### 3.2 体验效果分层描述

**能获得的（核心价值）：**
1. **一个桌面应用 = 所有 agent 的入口**：Codex、Claude、Gemini、Grok、
   Cursor 等各自保留原生行为（工具、循环、模型），统一在 Oh-DSH 壳里
   启动、管理、持久化——不再需要 6 个独立 CLI/应用
2. **统一会话管理**：跨供应商的会话列表、历史、恢复、导出
3. **统一审批边界**：所有供应商的权限请求走同一个桌面审批 UI
4. **桌面原生能力**：PTY、Files、Git 等既有 Oh-DSH 能力可被供应商会话复用
   （经网关桥接）
5. **皮肤/双语/窗口等现有体验不变**：6 套皮肤、中英文、快捷键照常

**体验上的妥协（必须预期管理）：**
1. 外部供应商会话的 UI 是「网关自定义节点」，不是 DSH 原生会话的完整
   工具面板/计划面板——初期以文本流 + 工具活动摘要为主，视觉密度低于
   DSH 自家 agent 会话
2. 供应商之间切换不是无缝迁移：transfer 能力取决于各家协议支持
   （Synara 已有 import/fork/handoff 语义，但外部 agent 未必全支持）
3. 首次启用需配置各供应商 CLI（binaryPath），类似 Synara 的设置
4. 升级到 DSH 0.1.x 后，若个别旧插件不适配，功能可能暂时降级

### 3.3 成功标准（可验收）

- [ ] 桌面内可启动 ≥3 类供应商（ACP 类、SDK 类、app-server 类各至少一家）
- [ ] 会话文本流、审批、持久化恢复全链路可用
- [ ] 任一供应商进程崩溃不影响其他供应商与 DSH 本体
- [ ] 皮肤、双语、窗口等既有体验零回归
- [ ] 全部走人审审批，无静默放行路径

---

## 附录：证据索引（file:line）

| 事实 | 位置 |
| --- | --- |
| LlmRuntime / LlmAdapter / registerAdapter | deepseek-harness `packages/llm/llm/src/index.ts:25,191,239,319` |
| 插件注册 LLM 适配器教程 | deepseek-harness `docs/cookbook/adding-an-llm-adapter.md` |
| llm-deepseek 单供应商范本 | deepseek-harness `packages/llm/llm-deepseek/src/index.ts:48-55` |
| llm-pi-ai 多供应商 | deepseek-harness `packages/llm/llm-pi-ai`（catalog.spec.ts:35,44,129） |
| AgentOptions 仅模型路由 | deepseek-harness `packages/core/agent/src/runtime-types.ts:24-31` |
| subagent-acp = ACP client 驱动外部 agent | deepseek-harness `packages/subagent/subagent-acp/README.md` |
| dsh-acp = ACP server（方向相反） | deepseek-harness `packages/acp/acp/README.md` |
| conversation-node 外部事件注入 | deepseek-harness `docs/cookbook/adding-a-conversation-node.md:5,21,62` |
| 插件承载服务先例 | oh-dsh-desktop `plugins/better-sidebar-runtime/` |
| 9 供应商清单 | synara `packages/contracts/src/orchestration.ts:198-204` |
| ProviderHostPort 抽象 | synara `apps/server/src/conversationRuntime/provider/provider-host-port.ts:315-336` |
| host registry 路由 | synara `apps/server/src/conversationRuntime/provider/../productionLayer.ts:248-302` |
| DSH 固定版本 | oh-dsh-desktop `dsh-source.json`（0.0.1-rc.2, 7b9644f2） |
