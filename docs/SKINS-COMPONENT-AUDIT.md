# 官方组件样式全量审计（ChatGPT 皮肤 token 规范对拍）

> 日期：2026-08 · 工具：`scripts/audit-skin-styles.mjs`（规则级解析上游
> web shell css + packages client bundle 内联 css，模块分组 + 关键规则 +
> token 引用 + 覆盖清单对拍）· 覆盖：285 个有关键规则的模块（594 个 hash
> 模块，katex 数学公式类已排除）· 基线：`generated-selectors.ts` 精确类名
> 覆盖 + 官方 89 键 token（skin-token-completion 轮次）。
>
> 审计方式：提取工具 + 四组并行人工过审（web-shell / conversation 系 /
> settings 系 / workspace-subagent-tool 系），每条建议经上游源码与运行时
> CDP 实测复核。

## 结论速览

| 类别 | 数量 | 处置 |
| --- | --- | --- |
| 已符合规范（走 token / 已被皮肤规则覆盖 / 正文内部排版） | ~260 模块 | 不动 |
| 幽灵 token（上游引用、官方 design-platform.css 未定义） | 10 键 / 14 处引用 | **已补充**（shared-tokens.ts） |
| 圆形按钮被通用 12.5px 规则压扁 | 12 类 | **已恢复 pill** |
| 行/输入/标签形态未统一 | 10 类 | **已统一** |
| 颜色硬编码/语义错配 | 6 处 | **已修正**（toast/chips/onboarding） |
| 已记录但不采纳（见 §5） | ~15 项 | 不动 |

## 1. 幽灵 token 补充（最高价值）

上游组件 css 引用了 10 个官方 design-platform.css **没有定义**的
`--dsw-alias-*` 键 → 官方默认主题与除 ChatGPT 外的皮肤下这些声明无效
（颜色继承父级）。已补进 `shared-tokens.ts` 颜色修正段（night/day 双值），
插件、烘焙、校验三处自动带出。

| 键 | night | day | 消费者（实测生效） |
| --- | --- | --- | --- |
| `--dsw-alias-label-error` | `#ff8583` | `#e5484d` | ghnu4W_inputInvalid/invalid、QtPdFG_failed（校验错误文字/边框） |
| `--dsw-alias-label-inverse` | `#0d0d0d` | `#ffffff` | ShSNQG_noteSave（主背景上的文字） |
| `--dsw-alias-label-quaternary` | `rgba(255,255,255,.38)` | `rgba(26,28,31,.38)` | urMWOG_seat（上游死声明，补充无害） |
| `--dsw-alias-fill-l2` | `rgba(255,255,255,.1)` | `rgba(26,28,31,.08)` | wI0qGa_kind（jobs 类型徽章） |
| `--dsw-alias-fill-tsp-secondary` | `rgba(255,255,255,.1)` | `rgba(26,28,31,.08)` | OYLFnq_label（agent-preset 标签） |
| `--dsw-alias-separator-primary` | `rgba(255,255,255,.156)` | `rgba(26,28,31,.117)` | lmC7WW_sep（conversation 分隔符） |
| `--dsw-alias-line-secondary` | `rgba(255,255,255,.084)` | `rgba(26,28,31,.078)` | fields 分隔线 |
| `--dsw-alias-bg-primary` | `#212121` | `#ffffff` | ShSNQG_noteInput（反馈输入框底） |
| `--dsw-alias-border-secondary` | `rgba(255,255,255,.156)` | `rgba(26,28,31,.117)` | ShSNQG_noteInput 边框 |
| `--dsw-alias-interactive-bg-primary` | `#ffffff` | `#1a1c1f` | ShSNQG_noteSave（主操作背景） |

实测（CDP，night/day 各一次）：label-error 边框/文字、fill 背景、noteSave
背景、separator 全部拿到正确值。

## 2. 圆形按钮恢复 pill（通用 button 规则的误伤）

`body[data-oh-dsh-skin] button { border-radius: 12.5px !important }` 会压扁
组件自带的圆形按钮（实测 .SIlZCq_close 28×28 从 999px 变 12.5px）。已在
几何 CSS 追加例外清单（全部 999px）：`SIlZCq_close`（代码 inspector 关闭）、
`Sqg4Fa_action`（附件编辑器 action）、`d4tJKG_action`（消息操作钮）、
`zNtrCa_toBottom`（回底漂浮钮）、`VfOgWa_iconButton`（侧栏 icon 钮 50%）、
`_64ccDW_iconBtn`（goal 面板）、`_close_18d3q_30`（图片查看器关闭）、
`_remove_1hk8w_53` / `_arrow_1hk8w_90`（附件）、`EBSbfa_iconButton`、
`bF00Jq_inspectButton`、`LEwn7a_actionButton`。实测真实消息操作按钮 999px。

## 3. 行/输入/标签形态统一

- 行圆角 12.5px（行高 DSH 自管，皮肤只统一圆角，与会话行同一纪律）：
  `wI0qGa_row`（jobs）、`vGKOra_row`/`vGKOra_clickarea`（subagent 目录）、
  `kxQ7mG_row`（commands）、`saFVAG_row`（目录选择）、`Sqg4Fa_header`（附件编辑器头）
- `_64ccDW_objectiveInput`（goal 目标输入框）：12.5px + token 行高 28.59px
- `LqtciG_groupTitle` / `gtvCtq_groupTitle`（模型列表/Commands 分组标题）：
  13px tertiary + 4px 8px（与 GROUP_LABEL 同规范）
- `_pill_e3ygd_1`（Pill 过滤胶囊）：999px + 行规格（官方 24px/12px 方角）

## 4. 颜色修正

- toast `_toast_fvpz7_7`：官方用 button-contrast-fill（night 浅底，与深色
  toast 语义错配）→ 改用 `--dsw-alias-toast-bg`（两套 #212121 深底），night
  显式白字（day 的 label-primary-inverted 已是白字）。实测 night/day 均深底白字。
- 引用 chips `lbz_ZG_chip` / `_3-lYmW_refChip`：硬编码 `#6187d838` →
  `--dsw-alias-interactive-bg-hover-accent`；圆角 12.5px、13px（.85em 相对字号
  不稳）；`lbz_ZG_chipInvalid` 硬编码 `#d8616133` → hover-danger。
- onboarding 遮罩 `_onboardingMask_1cfrq_10`：硬编码 `#0000003d` + blur 2px →
  `--dsw-alias-bg-mask-1` + `--dsw-mask-blur`。

## 5. 已记录但不采纳（及理由）

| 项 | 理由 |
| --- | --- |
| tooltip 文字 static bluish-00 → label-secondary | tooltip 底两套深 #212121，恒白字正确；深色浮层是官方设计（同 HoverCard #2C2C2E） |
| Modal close 8px → 999px | 与验收项 3「Close/Cancel/Rename 三按钮圆角一致 12.5px」冲突 |
| `_confirmation_1nu42_1` 入 DIALOG | 实为 Modal 的 className，表面元素已带 `_dialog_15u5s_22`（已覆盖） |
| `_sm_kz6gm_30` 按钮、compact/dense 菜单变体 | 低频形态，官方紧凑设计，改动无实测收益 |
| Modal `_header_15u5s_45` padding 不对称（22px 14px 12px 24px） | 纯形状微调，无实测收益，低优先级 |
| ui-workflow-run `f29-jq_*` 面板行（runHeader/memberRow/memberButton 等 4–8px）、`Y124yG_sessionLogButton`（18px）、`WrHpkq_file/showFolder`（6/4px） | workflow/导出/产出件均为低频面板，行圆角 8px 在意图内，workflow 功能上线时再上调 |
| `EBSbfa_option`（12px≈12.5px）、`H3siGG_panel`、`UTNGfq_previewBadge`/`modalInput` | 信息面板/徽章自有形态，差异在意图内 |
| ui-settings-models `_2WqzUG_*` 设置页卡片/编辑器/输入（rowCard/addCard/editor 等 12px 圆角、addButton 44px） | 设置页低频页面，官方自有形态；其中 `QtPdFG_save/discard` 对话框动作键已补 md 规格（32px/6 16px） |
| `Ka2sfq` trajectory 硬编码阴影 #00000024 | 详情面板阴影属官方设计，非配色错误 |
| `H3siGG_colorTools --meter-tint:#a78bfa` | progress meter 工具色，低频 |
| `Mxhjma/N4HsDW` hover 浮层 #fff/#cfd3d6 | ui-workspace 桌面端已禁用 |
| 非 ChatGPT 主题缺 8 个第二梯队键（label-caption 等） | 其他主题完整度是独立话题；ChatGPT 已全量定义 |

## 6. 覆盖对拍（验证）

- `pnpm run build` 内嵌门禁：官方 89 / 覆盖 112 / 缺失 0（新增 10 幽灵键后
  覆盖集 = 89 官方 + 4 shadow/mask + 9 shiki + 10 幽灵 = 112）
- typecheck 0 错误；`pnpm test` 282 pass / 0 fail
- CDP 实测：night/day 两套注入探测全部命中（§1-§4 每条值），真实 UI 复核
  圆形按钮与消息操作钮。

## 7. 工具与复跑

- `node scripts/audit-skin-styles.mjs` —— 全量提取（--json 输出结构化数据）
- `node scripts/audit-skin-styles.mjs --module <前缀>` —— 单模块人工过审
- 上游 bump 后重跑工具 + 重审 §2 例外清单（圆形按钮类名是否仍存在；
  幽灵键是否已被官方定义——若官方补了定义，我们覆盖值仍优先生效，无害）
- 本轮审计中间产物：`.agent-workflows/skin-audit/`（web-shell 组）、
  `.agent-workflows/skin-audit-conversation/`（conversation 组）、
  `.agent-workflows/skins-css-audit/`（settings 组）、
  `.agent-workflows/css-skin-audit/`（workspace/subagent/tool 组）、
  `.agent-workflows/skin-token-completion/output/style-audit.json`（全量数据）
