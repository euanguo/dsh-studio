# DSH Studio 插件市场重构设计：交互模型与安装链路简化

> 状态：设计提案（本 worktree `ui-ux-refactor` 的目标基线）。
> 证据基础：[开源生态调研](./research/dsh-plugin-marketplace-survey.md) + 对
> `plugins/plugin-marketplace/` 现有实现的逐行核对（行号引用以当前工作树为准）。
> 语言：中文单份（沿用 `ui-chrome-storage-plan.md` 的计划文档先例；落地成为产品行为时，
> `docs/usage.md` 的「插件市场」一节按双语规则同步更新）。

## 1. 背景与问题

### 1.1 现状事实基线（逐行核对得出）

| # | 事实 | 位置 |
|---|---|---|
| F1 | `prepare` 在**零确认**时也自动进入 preview —— 每次安全安装都会完整拷贝 live profile 并启动一个隔离 DSH runtime | `transaction-manager.ts:446` |
| F2 | `apply` 只被允许从 `previewing` 阶段发起（守卫矩阵） | `transaction-manager.ts:138` |
| F3 | apply 的本质是**整个 profile 原子换名**：live→backup、candidate→live，再在 live 内 re-home node_modules；intent-before-rename 日志、失败自动换回 | `transaction-manager.ts:615-692` |
| F4 | 安装通道只有 git-commit-pin 的 GitHub 仓库：`github:<owner/repo>#<40hex>`；monorepo subpath 直接 blocked；非 `dsh.bundle` manifest 只能 guide-only。没有 npm 通道、没有 Release tarball 通道 | `source-types.ts`、`candidate-validator.ts:375` |
| F5 | 候选校验已做：manifest/patch 路径约束、entry 目标、peer 兼容（对 pinned DSH 版本）、license/version 必填、build scripts 清点 | `candidate-validator.ts` |
| F6 | 目录归一化把 dsh-suite 已有的 stars/downloads/compat/evidence/risk/双语描述字段**全部丢弃**，只保留单语 description | `catalog.ts:15-28` |
| F7 | 启用/禁用/卸载同样走 prepare→preview→apply 整 profile swap | `plugin-detail.tsx:97-124` |
| F8 | 脚本化预览构建在非 macOS fail-closed（sandbox-exec 不存在即抛错） | `platform.ts:343` |
| F9 | 更新检查 = refresh 时对每个已装插件做一次 `resolveCommit` | `transaction-manager.ts:411-426` |
| F10 | 客户端为 960×720 弹层（侧栏底部入口），工具栏含搜索/直连仓库输入/status tabs/分类菜单；卡片网格 + 详情弹层（纯文本 description + facts + plan 审查，流程指示 1 审查/2 预览/3 应用） | `marketplace-filters.tsx`、`plugin-detail.tsx` |

### 1.2 核心矛盾

F1+F2+F7 意味着：**装一个零风险主题插件，用户也要经历「拷贝整个 profile → 启动隔离 runtime → 切回 → 再重启 live」的完整循环**。安全机制本身是对的（F3 的原子换名 + journal 是生态里最强的设计），但它被无差别地铺在了所有操作上。社区头部市场（dsh-market 等）的基准体验是"点一下、数秒、刷新即用"，我们的体验与之差距悬殊。

同时 F4 让我们比所有社区市场都少两条快通道（npm 包、Release tarball），F6 又让目录里现成的质量信号（兼容徽章、star、下载量、截图位）到不了 UI。

## 2. 目标与非目标

**目标**

1. P0/P1/P2 功能全部采纳（见 §3 总表），基于重构后的能力重排交互。
2. 安装链路风险分级：低风险操作**默认直接安装**，不再强制经过预览 runtime；预览降级为显式可选动作「先试装」。
3. 新增 npm 与 Release tarball 快速通道，源码通道降级为兜底。
4. 保持全部既有安全资产：commit pin、manifest hash、TOFU source lock、三级 confirmation、protected 集合、信任四事实分离。

**非目标**

- 不引入第二个 loader/runtime/profile 根（沿用 expansion-plan 不变量 1）。
- 不放松对 build scripts / 高危来源 / 来源变更的确认要求 —— 放松的只是「必须先看预览」这一层。
- 本期不做评分算法的产品化运营（P2 仅做排序预设与透传字段）。

## 3. 功能采纳总表（P0/P1/P2 → 设计落点）

| 级别 | 功能 | 来源参照 | 本文落点 |
|---|---|---|---|
| P0 | star/下载量透传 + 排序 | dsh-suite JSON 字段、awesome registry `downloads` | §6.1 协议扩展、§5.2 工具栏 |
| P0 | 兼容性徽章（ok/broken/unmaintained + lastVerified） | dsh-suite compat 日检 | §6.1、§5.3 详情页 |
| P0 | README 摘要（host 截断、不做完整 Markdown 渲染） | chnjames 明确约束 | §6.1、§5.3 |
| P0 | 截图轮播（策展优先、README 抽取兜底、仅 GitHub 图床白名单） | dsh-market | §6.1、§5.3 |
| P0 | **直接安装 fast path** | 社区普遍形态 vs 我们 F1/F2 | §4 全节 |
| P1 | 安装进度事件（阶段/百分比/速度/ETA/日志尾/可取消） | AwesomeHou 异步任务 | §4.5、§6.2 |
| P1 | 材料收集状态机（env vars 缺失 → 表单收集 → 续装） | bradeGithub awaiting-input | §6.2 |
| P1 | npm 通道（精确版本 pin） | dsh-market npm-first | §4.4 |
| P1 | Release tarball 通道（digest pin） | dsh-market 第二通道 | §4.4 |
| P1 | 市场自更新横幅 | AwesomeHou/dsh-market | §5.5 |
| P1 | 排序增强（最热/最新/下载量/name）+ weekly growth 预留 | sandbaseai/dsh.market | §5.2 |
| P2 | 五维评分式排序预设（本地启发式，不引入运营后台） | dsh.market 权重表 | §5.2 |
| P2 | 命令面板/agent 入口定位（打开市场并直达某插件） | DshMarketPlace `/store` | §5.6 |
| P2 | agent 教学 skill（教 agent 检索而非背名字） | DshMarketPlace bundled skill | §5.6 |
| P2 | watchlist triage 过滤枚举（接入 topic 快照源时启用） | dsh-suite 蹭tag/工具链/占位 | §6.3 |
| P2 | 整合包（一次事务装一组插件，共享确认、一次重启） | dsh.pack.json / dsh-suite "all" | §6.4 |

## 4. 新安装链路：风险分级三路径

### 4.1 原则

保留「所有写入先发生在 candidate profile，live profile 只能被原子切换改变」（expansion-plan 不变量 7）——这是 undo/recovery 可靠性的根。**去掉的只是「预览 runtime 是必经阶段」**：

> **修订不变量 5** 为：「Catalog 只能提供 metadata 和 admission evidence；它不能跳过 commit pin、manifest hash 或脚本确认。」——preview 从该清单移除，成为显式可选动作。
> **新增不变量 10**：「fast path 与 preview path 必须产生字节等价的最终 profile 树；两者的差别只在于是否启动隔离 runtime 与是否需要用户过目。」

expansion-plan 不变量 9（只有 `execution === installable` 的 bundle candidate 可进入 apply）原样保持。

### 4.2 路径分级

```
plan 出炉后按 fastPathEligible 分流：

fastPathEligible ≜
   execution === 'installable'
∧  mechanism === 'bundle'
∧  requirements === ∅                       // 无任何 confirmation 要求
∧  riskLevel === 'low'                      // 无 build scripts、非 untrusted source、无 source change
∧  compatibility.compatible !== false       // peer 兼容未被证伪
∧  catalogSource.trust ∈ { builtin, reviewed }
```

| 路径 | 触发条件 | 用户经历 | 底层动作 |
|---|---|---|---|
| **A · 直接安装**（新增，默认） | fastPathEligible | 点「安装」→ 进度条 → 完成 toast（提示重启生效）+ Undo 入口 | stage（candidate profile 内 pnpm install --ignore-scripts）→ 原子换名 swap → startLive。**不启动预览 runtime** |
| **B · 确认后安装** | requirements ≠ ∅ 或 riskLevel ≥ elevated | 详情弹层展示 plan 审查（风险原因/构建脚本/勾选确认）→「直接安装」或「先试装」 | 同 A，但 stage 前强制 confirmations 齐备；来源变更(TOFU)首次仍走 B |
| **C · 先试装**（显式可选） | 任意 installable bundle | 现有隔离预览流程原样保留 | 现 preview() 全过程 |

启用/禁用/卸载（F7）一律改走路径 A（带 recovery point）；它们不再启动预览 runtime。

### 4.3 状态机修订

```text
现状: idle→catalog-ready→planning→previewing→applying→applied-with-undo→undoing
      apply 仅可自 previewing (guards, transaction-manager.ts:138)

修订: 新增 staging 阶段，把「candidate profile 内安装」从 preview() 中抽出为共享阶段:

  planning  ──stage──────▶ staging     // stageCandidate(): copy + pnpm --ignore-scripts
  staging   ──apply─────▶ applying    // fast path: 直接换名 swap（A/B 两路共用）
  staging   ──preview───▶ previewing  // C 路: startPreview，等用户裁决
  previewing──apply─────▶ applying    // 保持不变
  其余转移与 journal 语义（intent-before-rename、W/U 窗口、reconcile）全部保持
```

对应改动：`PHASE_TRANSITIONS.planning += ['staging']`；`COMMAND_PHASE_GUARDS.apply = ['staging','previewing']`、`.preview = ['planning','staging']`（staging 后仍可补看预览）、新增 `.stage = ['planning']`。`preview()` 重构为 `stageCandidate()` + `startPreview()` 两段，行为对 C 路径完全向后兼容。

**崩溃一致性**：staging 引入新的中断窗口（stage 中途崩溃）——journal 增加 `staging` intent 记录，reconcile 规则：发现 staging intent 且 candidate root 存在则丢弃 candidate root 回 planning（与现有 preview 失败清理同型，复用 `removeWithin`）。

### 4.4 新安装通道（npm / Release tarball）

InstallSpec allowlist 从单一形式扩展为三种，全部保持 exact-pin 语义（expansion-plan §4.5 不放松）：

```text
github:<owner/repo>#<40-hex-sha>          // 现状保留，兜底通道
npm:<pkg>@<exact-semver>                  // 新增：不接受 range/latest
tarball:<https-url>#<sha256-digest>       // 新增：Release 资产预构建包，digest 由 resolver 实算锁定
```

- 解析顺序（resolver 内部，用户无感）：catalog 条目若带 `npm` 字段 → 试 npm 通道取 `npm:<pkg>@<exact>`；否则查 GitHub Release 资产（`release` evidence 已在候选里）→ tarball 通道；再退回源码通道。**npm 通道的开放范围采用 dsh-market 同款反 squatting 约束：仅对 trust ∈ {builtin, reviewed} 且条目带已核实 `npm` 字段的插件开放，其余一律回落源码通道**（附录 A.3）。
- 执行仍然只经官方 DSH/pnpm-forward path（expansion-plan 不变量）：npm 通道在 candidate profile 内执行 `dsh plugin add <pkg>@<exact>`（官方 CLI 接受裸名与 scoped 名，pnpm 转发；可加 `--save-exact`）；tarball 通道下载后校验 sha256，再以**位置参数**交给官方 CLI（`dsh plugin add <file.tgz>` —— 社区常见的 `-w` 旗标未见于官方文档，不作为契约，见附录 A.1）。两通道天然绕开大部分 build scripts（预构建产物），这正是它们能进 fast path 的结构性原因。
- **staging 完成判定（三查，借鉴 AwesomeHou 防 link:-缺依赖回归的做法）**：bundle 已注册进 `dsh.profile.bundles` ∧ entry 目标文件存在 ∧ 运行时依赖可解析。三查全过才允许进入 applying 或 previewing；任何一查失败按 stage 失败处理（丢弃 candidate root 回 planning）。
- 通道结果记入 source lock 新字段 `channel`（github|npm|tarball），TOFU 锁继续绑定 artifactDigest。
- ⚠️ 待校准：官方 CLI 对各 spec 形态的支持矩阵以附录 A 的调研结论为准；CLI 不支持 npm/tarball 直装的版本，回退为「pnpm --ignore-scripts 装入 candidate profile + 官方 install 注册」的组合，不阻塞本设计。

### 4.5 进度事件协议（P1）

host 在 staging/applying/undoing 期间通过既有 `desktop:plugin-marketplace-changed` 通道旁路推送细粒度事件（不改 RPC 形态）：

```text
MarketplaceProgress {
  transactionId, phase: 'staging'|'applying'|'undoing',
  stage: 'copy'|'fetch'|'install'|'verify'|'rehoming'|'swap'|'restart',
  percent?: number,        // copy/fetch 可计字节；install 阶段为不确定进度
  bytesTotal?: number, bytesDone?: number,
  etaSeconds?: number, logTail?: string[],   // 环形缓冲最近 N 行
  cancelable: boolean      // 仅 staging 的 fetch/copy 阶段可取消
}
最终结果附 requiresRestart: boolean（官方语义：bundle 插件需重启 dsh web 生效；
repository/.dsh-plugin 类即时生效——见附录 A.1）。
推送走既有 marketplace-changed 广播；客户端断线重连时以 jobId 轮询兜底
（AwesomeHou 的 202+polling 模型作为降级路径）。
```

取消语义 = 丢弃 candidate root + journal 回 planning（同崩溃 reconcile 路径），live profile 全程未被触碰。

## 5. 新交互模型

### 5.1 信息架构（保持现有骨架）

侧栏底部入口 → 960×720 弹层（现状保留）。弹层内部改为两栏：左列表（卡片网格 + 工具栏）＋ 右详情（常驻，替代现在的二级 Modal；窄宽度退化为栈叠）。理由：F10 的「详情是第二层 Modal」使对比/返回成本高，也是社区市场（设置 Tab 内主详布局）的一致形态。

### 5.2 列表与工具栏

- 保留：搜索（title/description/tags）、直连仓库输入、status tabs（全部/已装/停用/可更新 + 计数徽标）、分类下拉。
- 新增排序菜单：⭐ stars ↓ / downloads ↓ / 最近更新 ↓ / 名称 ↑ / **智能**（默认；P2 本地启发式：compat ok 优先 × log-stars × recency 衰减 × downloads，权重对齐 dsh.market 五维表的可用子集，公式入 §6.5）。
- 卡片信息升级：标题、双语描述（随界面语言）、⭐/↓ 计数、compat 徽章（🟢 ok / ⚪ unknown / 🔴 broken / 🪦 unmaintained，hover 显示 lastVerified 日期）、installed/update 徽标、trust 徽章（organization/community/untrusted 沿用现有配色语义）。
- 「全部更新」入口（status tab 上的可更新计数点击即触发批量 fast path 更新；任一非 fastPathEligible 则该项单独落入路径 B 队列）。

### 5.3 详情区（右栏）

1. 头部：标题 + trust/compat 徽章行 + 主按钮组（**安装 / 更新**（路径 A 或 B）/ 先试装（次级）/ 启用·禁用·卸载 / 打开仓库）。
2. 截图轮播：`screenshots[]` 策展字段优先（零额外请求）；无策展时打开详情时从 README 抽取首图兜底；图片域白名单限定 `*.githubusercontent.com`/`github.com`（对齐 dsh-market 约束），加载失败静默隐藏。
3. README 摘要：host 侧截断（首 4KB、去 HTML 只留文本与链接清单），客户端折叠展开；明确不做完整 Markdown 渲染（chnjames 同款克制边界）。
4. Facts 区（沿用 dl 结构）追加：⭐/↓、compat status + lastVerified、npm 包名、最新版本号（通道可得时）、通道标识（github/npm/tarball）。
5. Plan 审查卡（仅路径 B/C 时出现）：现有风险原因/构建脚本/确认勾选结构保留，流程指示从「1 审查 2 预览 3 应用」改为动态三态「检查 ✓ → （试装？）→ 应用」，fast path 下显示「已验证 · 直接安装」徽标而非流程条。

### 5.4 操作反馈

- staging 期间：卡片/详情按钮变进度态（§4.5 事件驱动），完成后 toast「已安装 · 重启后生效 · [撤销]」。
- 路径 B 确认交互沿用现有 checkbox 组（allow-build-scripts / accept-high-risk / accept-source-change 文案不变）。
- 路径 C 预览浮层沿用现状（隔离 runtime 打开后按现有预览视图裁决）。

### 5.5 市场自更新（P1）

市场插件本体纳入自家更新检测：snapshot 增加 `selfUpdate: { installedVersion, latestVersion, updateAvailable }`（数据源：目录中 pluginId=`plugin-marketplace` 行），available 时顶部横幅「vX → vY · 立即更新」。

### 5.6 Agent 与命令面板入口（P2）

- `desktop_plugin_*` 工具面已与 Human 共用同一 transaction owner（不变量 6 保持）；补一个 bundled skill：何时用 search 而不是凭记忆报插件名、如何解读 compat/trust 徽章、如何向用户转述确认项。
- 注册 workbench open-intent（`resolveOpenPlan` 语义）：`dsh-studio.plugin-marketplace.open` 支持 `pluginId` 参数，Agent 卡片/聊天链接可直达详情。

## 6. 数据契约扩展

### 6.1 目录归一化透传（修 F6）

`CatalogRepository` 增加可选字段解析，`MarketplacePlugin` 协议同步扩展（全部 optional，旧目录源不受影响）：

```text
stars?: number; downloads?: number
description: { zh: string; en: string }   // 归一化为双语对象，UI 按 locale 取
compat?: { status: 'unknown'|'ok'|'broken'|'unmaintained'; lastVerified?: string; note?: string }
evidenceLevel?: number; officialBeta?: boolean
screenshots?: string[]                    // 策展图 URL（域白名单校验后透传）
readmeSummary?: string                    // host 截断摘要（目录若无则打开详情时拉取）
homepage?: string; version?: string
```

### 6.2 命令与事件协议增量

```text
MarketplaceCommand 增量:
  { type:'install', … }        // 语义 = inspect+stage+apply（fast path 编排命令；
                               // 内部仍拆解为既有原子命令序列，审计日志可见）
  { type:'stage', … }          // 显式暂存（供「先试装」前的预加载）
  { type:'cancel', transactionId }   // 仅 staging 可取消
  { type:'provide', answers }  // P1 材料收集续装
MarketplacePlan 增量:
  channel: 'github'|'npm'|'tarball'
  envSpec?: { name, description, secret }[]   // 触发 provide 流
  fastPathEligible: boolean                   // 服务端判定，UI 不自行推断
MarketplaceSnapshot 增量:
  progress?: MarketplaceProgress; selfUpdate?: …
```

Human 与 Agent 提交同一命令集（不变量 6）；Agent 无 GUI，`provide` 对 Agent 工具返回结构化的 missing-env 清单由对话层收集。

### 6.3 topic 快照源的 triage（P2，条件启用）

当 catalog source kind = `github-topic-snapshot` 时，归一化阶段应用特征过滤（根 `SKILL.md` / `skills/*/SKILL.md` / `dsh.bundle` 标记 / cordis 依赖关键字），未通过者进 watchlist 区并标注原因枚举（蹭tag/工具链/占位），UI 默认折叠。

### 6.4 整合包（P2）

`MarketplacePack { id, title, plugins: [{pluginId, action}], sharedConfirmations }`：一次事务内依序 stage 多个 candidate，合并确认（取并集），一次 swap、一次重启。journal v3 记录 pack 成员清单以便整体 undo。

### 6.5 智能排序预设（P2）

`score = w1·compatOk + w2·normLog(stars) + w3·recency(pushedAt) + w4·normLog(downloads) + w5·trustWeight`
初始权重 (0.30, 0.25, 0.20, 0.15, 0.10)（对齐 dsh.market 维度思想，本地可算子集）；公式与权重进代码注释与本文，不做隐藏调参。

## 7. 安全边界保持清单（重构不动项）

commit pin（40-hex）/ manifest+patch hash / TOFU source lock（+channel 字段）/ 三级 confirmation 语义与文案 / protected 插件集合 / 目录信任分级（builtin/reviewed/user）与 Ed25519 签名 / 信任四事实分离（invariant 4）/ 所有写入先进 candidate profile（invariant 7）/ 非 macOS 脚本化构建 fail-closed（invariant 8 边界展示）。

明确放弃的安全幻觉：fast path 并不比 preview path「更危险地安装了什么」——两者最终 profile 树字节等价（验收断言，见 §8）；preview 提供的是「眼见为实」，不是额外的一层执行防护。这一点写进 usage.md 的市场章节。

## 8. 实施波次与验收

| 波次 | 内容 | 关键验收 |
|---|---|---|
| W1 | §6.1 透传 + §5.2/5.3 展示层（P0 展示项） | 旧目录源回归零 diff；双语切换正确；域白名单拦截测试 |
| W2 | §4.2/4.3 状态机 + fast path + enable/disable/uninstall 直通（P0 核心） | guards 矩阵测试重写；**fast/preview 等价性断言**（同一 candidate 两条路径的最终 profile 树 hash 相等）；staging 崩溃 reconcile 测试；journal v3 迁移幂等 |
| W3 | §4.5 进度事件 + 取消 + UI 进度态（P1） | 事件乱序/丢失容忍；取消后 live profile 未被触碰的 fs 断言 |
| W4 | §4.4 npm/tarball 通道（P1，依赖附录 A 校准） | 三通道 InstallSpec allowlist 单测；digest 不匹配拒装；channel 入 lock 测试 |
| W5 | §5.5 自更新 + §6.2 provide 材料收集 + 排序增强（P1） | secret 不落日志；awaiting→resume 状态机全覆盖 |
| W6 | §5.6 + §6.4/6.5 + §6.3（P2） | pack 整体 undo；triage 过滤仅作用于 topic-snapshot 源 |

每波次遵循仓库门禁：typecheck/test/build + 相关 smoke；契约测试先行（guards/journal/installSpec allowlist 属于 contract tests，非实现词句 grep）。

> **W6 之后预研项（非本期承诺）**：dsh-market 式 Include 树热挂载（附录 A.3）——对简单 insert 型 patch 实现 ~1s 热生效，把「重启后生效」的占比进一步压低。依赖 upstream `cordis-plugin-include` 能力评估，另立立项。

## 9. 与既有文档的关系

- `docs/plugin-marketplace-expansion-plan.md`（commit 7d6e69da，本工作树缺失）：本文修订其不变量 5、新增不变量 10，其余不变量 1–4、6–9 全部继承；其 P2 愿景清单中的 compatibility successful runs / packs / freshness / operation history 分别由本文 §6.1、§6.4、§5.2、§4.5+journal 承接。
- `docs/design.md` L62/L99-100：落地后需把「隔离预览、风险确认」表述更新为「风险分级安装（直接/确认/试装三路径）」，并恢复其对 expansion-plan/handoff 两文档的引用一致性。
- `docs/usage.md` §插件市场：W2 合入时按双语规则重写用户流程描述。

## 附录 A · 外部机制证据（后台代理调研结论）

### A.0 本地测量（2026-08-26，样本：dsh-suite plugins.json 快照）

- 安装命令形态分布（1764 条主目录）：空/默认 1647、裸 npm 名 31、`@scope/pkg` 形态 npm 安装命令 ~30、`git+https://` 形态 ~20、精确版本 npm 2、其余 see-README。
  → **官方 CLI 接受 npm spec（含 scoped）是目录数据自证的事实**，W4 的 npm 通道不依赖未经验证的行为假设。
- compat 字段可用性：`ok` 561 / `unknown` 1192 / `broken` 11；stars ≥100 的条目 92 —— 兼容徽章与 star 排序在现有目录上即有实际信息量。

### A.1 官方 CLI 通道矩阵

- `dsh plugin --profile <p> add` 接受：裸 npm 包名（含 scoped）、`github:owner/repo#ref` 或完整 URL、本地路径与 `link:`、tarball（`.tgz`，位置参数）；参数直接转发 pnpm。社区常见的 `-w` 旗标未获官方文档证实，本设计不将其作为契约。
- `list/update/remove` 子命令存在；update 会自动 reconcile `dsh.profile.bundles`；**disable/enable 无官方子命令**（只能操作 manifest）—— 我们现有的 enable/disable 直改路径保持不变。
- 安装实际改动：profile `package.json` 依赖 + `dsh.profile.bundles`（由安装状态驱动 reconcile），与 expansion-plan 不变量 2 一致。
- 官方重启语义：bundle 插件需重启 `dsh web` 生效；`.dsh-plugin` repository 类即时生效。→ §5.4 的「重启后生效」toast 与官方口径一致，不是我们独有的落后。
- 官方文档未给出 Node/pnpm 版本要求（仅提及 pnpm ≥10 与 git prepare 脚本授权相关）。
- 来源：<https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish>、<https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/commands>、<https://github.com/deepseek-ai/deepseek-harness/blob/main/apps/cli/reference/README.md>（deepseekdocs.com 为社区镜像，仅作旁证）。

### A.2 进度任务 / 材料收集 / 风险分类器

- **AwesomeHou 异步任务**：`POST /api/market/install` 立即返回 `{ok, jobId}`（202）→ `GET .../status?job=` 轮询 → `POST .../cancel`；终态含 `{installed, output, requiresRestart, error}`；进度载荷含 stage/percent/speed/ETA/实时日志行。planInstall 形态分类：根级 bundle → 标准 add；已发布 npm 优先 `name@<version>`（pnpm 连带拉入 ws/node-pty 等运行时依赖）；monorepo 克隆到 `$DSH_HOME/marketplace-src` 构建后 `link:` 注册（注意 `link:` 不能装根级插件）。装后三查：进入 `dsh.profile.bundles` ∧ entry 文件存在 ∧ 运行时依赖可解析 —— 本文 §4.4 staging 判定即取自此处。
- **bradeGithub 材料收集**：状态机 `done/awaiting-input/aborted/failed/manual`；env 扫描正则同时覆盖大写下缀（`*_API_KEY|*_TOKEN|*_SECRET|*_PASSWORD` 等）与 camelCase（`*ApiKey|*Token|*Secret|*Password`），敏感键类 TOKEN/KEY/SECRET/PASSWORD/CREDENTIAL/AUTH，脚本环境走最小白名单（PATH/HOME/TMP…）；扫描对象为 README / install 脚本 / `.env` 示例。本文 §6.2 `provide` 流按此实现。
- **chnjames 风险分类器**：字段 name/description/topics/keywords；外观类 = theme/skin/cosmetic 词族；高权限 = sudo/password/secret/keylogger/filesystem + bash/ssh/credential/spawn 词族；兜底 unknown。目录多级回退 Vercel→jsDelivr→raw→包内快照→本机搜索，TTL 21600s —— 可作为我们 catalog-source-manager 缓存策略的对照。

### A.3 dsh-market 内部机制

- **通道实现**：`installTargetFor(entry)` 决定安装目标；npm 通道只对 curated registry 内条目开放（防 typosquatting 的同源判定：`alias == entry.npm` ∨ repo 一致 ∨ spec 一致，否则拒绝安装）；源码通道在中国区经 gh-proxy 加速 codeload tarball（`src/accelerate.ts`）。最终命令就是 `dsh plugin --profile web add <target>`。→ 本文 §4.4 的「npm 通道仅对 builtin/reviewed 目录条目开放」即同款约束。
- **截图管线**：registry 快照 `screenshots[]` 策展字段零请求直显；无策展时在打开安装弹窗时从 README 抽取图片，仅允许 GitHub 图床。
- **「多数免重启」的真实机制**：`hotMount()`（src/hot.ts）只解析简单 patch（id/name 两行），写入 `.dsh-market/hot-*.yml`，经 `@deepseek-ai/cordis-plugin-include` 的 Include 树热挂载（约 1 秒 HMR）；client-only 依赖在启动时挂载；主题独立即时激活、互斥、跨重启保留、卸载即恢复；复杂 patch（含 config/expression 行）与纯终端类插件仍需重启。**结论：这不是绕过 runtime 模型，而是受控热插拔**——对本项目属 W6 之后的预研项（依赖 upstream include 能力），本期以「重启后生效」的诚实预期交付。
- **自更新**：市场本体与第三方插件走同一 npm dist-tag 通道（stable/beta/dev），设置卡片可切换。
- **更新/卸载检测**：`dsh.profile.bundles` + package.json dependencies ↔ catalog 条目（entry.npm/name/url）双向映射；卸载清理补丁层与 `.dsh-market/` 状态目录。
