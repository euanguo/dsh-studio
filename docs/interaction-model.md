# 工作台交互模型与状态作用域设计

> 状态：提案（proposal）· 2026-08-23
> 调研基础：Minke v0.2.0 架构对比、Exa 网络调研（2025-05 ~ 2026-08，约 30 组查询、280+
> 结果、22 篇全文深读，含 VS Code / Claude Code / Codex / Cursor / Zed 一手 issue 与论坛帖）。
> 证据存档：`.agent-workflows/research-minke-vs-dsh-studio/`（本仓库本地排除目录）。

[English](./interaction-model.en.md) · 简体中文

---

## 0. 问题定义

DSH Studio 桌面的三栏工作台由自研插件构成：左栏 Project→Worktree→Session 树
（`desktop-left-rail`）、右栏工具面板（`sidebar` 的 `SideToolsPanel`）、中间对话 +
`center-surface-host` 多 surface tab 条。本次设计回答四个问题：

1. 工具内容的"消化区"应该在哪——右栏自吸收（Minke 模式）还是中间主区（现模式）？
2. 打开行为的边界——单击/双击、预览 vs 正式打开、是否抢焦点？
3. 面板/tab/工具状态的归属——跟会话（session）、跟项目（worktree/cwd）还是全局？
4. 划词评论（review comments）的归属——它锚定的是代码位置，还是产生它的那个会话？

## 1. 结论速览

| # | 决策 | 方向 |
| --- | --- | --- |
| D1 | 内容消化区 | **维持「右栏发射台 → 中间 center-surface 消化」**，不采用 Minke 式右栏自吸收 |
| D2 | 会话内文件链接 | 新增「右栏快速预览」短路径；**后台打开、绝不抢焦点** |
| D3 | agent 自动打开 | agent 写文件**不自动**跳转/开 tab；一律通过链接按需打开 |
| D4 | preview tab 语义 | 保留单击预览 / 双击固定，**新增偏好开关**（禁用预览 / 单击即正式打开） |
| D5 | 状态作用域 | 默认 **per-worktree(cwd)**；新增「全局布局一致性」偏好；**划词评论改挂 worktree+branch，跨会话共享** |
| D6 | side-chat 定位 | 显式承担「临时提问」语义（对齐 Codex `/side`），不污染主线 |
| D7 | 右栏几何 | 保持可拖宽/最大化/左右切换；宽度偏好随 worktree 记忆 |

## 2. 决策依据

### D1 内容消化区：右栏发射台 → 中间消化

网络证据（一手用户声音）：

- Claude Code #62829（bug，已确认 duplicate of 主流诉求）：Claude Code 在右侧边栏时，
  点击文件链接"opened as a tab in the same panel/sidebar as the chat… Chat window becomes
  narrow, file preview is very small"，用户要求 **files should open in the main editor
  area**。根因是扩展用 `panelTab.viewColumn + 1` 把文件开进了侧栏自身。
- Cursor 论坛长期主题 "Chat is fixed-width even with a large screen"、"minimal chat width
  becomes so large…"：窄栏读代码是大面积痛点。
- 《The Sidebar is Dead, Long Live the Duet》（Medium, 2026-03）：纯侧栏范式陷入
  Human-in-the-Loop 微确认循环。
- 正面共识（Suhas Bhairav 等）：*"blend both — a side panel for quick guidance and a
  focused work mode for complex tasks"*。

结论：右栏承担导航与轻预览，深度阅读/diff/终端进中间。Minke 的右栏自吸收模式在单工具
场景成立，但多文件对比、长 diff、并行终端都需要主画布；Claude Code 用户已用 bug 投诉
过"内容困在侧栏"。

### D2/D3 打开行为：短路径预览 + 不自动跳转

- VS Code #298700（由 VS Code 团队成员 egamma 提出，已修复于 1.115）：agent 创建/修改的
  文件自动在编辑器打开"overwhelming"，编辑器被大量待关闭的 tab 塞满；期望是
  **不自动打开，需要时从 chat 链接点开**。
- Codex #13718、Zed commit 62b9a98、opencode #12608/#18836：各产品都在补齐"chat 内文件
  引用可点击并导航到正确位置"的能力——点击文件引用的落点是核心交互，不是附属功能。
- Cursor 论坛 Bug（2026-08）"Agent Window steals focus and opens file tabs"：agent 运行时
  抢焦点打断输入被列为严重缺陷。

落地规则：

1. **焦点不变式**：任何由渲染层触发的打开（会话链接、agent 输出、右栏点击）不得改变键盘
   焦点或滚动位置；composer 输入中的打断视为回归。
2. 会话内的文件引用 → 先以**右栏快速预览**呈现（复用右栏 files viewer 的 preview pane）；
   用户显式动作（双击 / “在中间打开”菜单项 / pin 图标）才升级为中间 surface tab。
3. agent 完成文件修改后**不自动打开**；在对话卡片提供文件 chip（可点击，走第 2 条路径）。

### D4 preview tab 语义与偏好

社区长期辩论（VS Code #81093、#9388、#128755；Zed #39054、#4324、#53203；Cursor 论坛
"Chat: double-click file reference should open full tab, not preview-only"）的收敛结论：

- 单击 = 预览（斜体 tab，至多一个，替换上一个未固定预览）；双击/pin = 正式 tab；
- 必须提供偏好：`workbench.previewTabs: 'default' | 'disabled'`
  （disabled 时单击即正式打开，等价 Zed 的 disable preview_tabs）；
- dirty 内容永不因预览替换而丢失（现状已满足：替换对象仅限上一个未 pin 的 preview）。

### D5 状态作用域：per-worktree 为主 + 可选全局一致；划词评论归代码

面板/tab/工具状态的作用域，业界两个主流实现并存：

- **per-workspace**：Zed 默认；Discussion #55054 显示切项目时"layout snaps… panels open/
  close, sizes shift"，agentic panel 让多项目切换成为高频动作后，用户要求 global 选项；
- **per-session**：VS Code Agents 窗口 `src/vs/sessions/LAYOUT_CONTROLLER.md` —— 每个
  agent session 独立 panel/editor working set。

DSH Studio 取向：**worktree 才是用户心智里的工作环境**（wt/Grove 等 per-worktree 工具
生态；并行 agent × git worktree 已是主流工作流）。因此：

1. 右栏 open-tab 布局、中间 tab 队列、explorer/Git runtime 缓存、project-shared PTY
   （`${cwd}:${tabId}`）维持 per-worktree(cwd)；localStorage 分桶持久化保证"切换即恢复"，
   规避 Zed 用户抱怨的跳变。
2. 新增偏好 `layoutScope: 'workspace' | 'global'`（默认 workspace）：global 时右栏布局与
   中间队列跨 worktree 共享一份（对齐 Zed #55054 的提案形态）。
3. **划词评论重新归属**：评论的天然锚定是代码位置（GitHub PR review comment =
   `path + line(side) + commit_id`，过期显示 outdated；GitLab discussions 同理；Gerrit 带
   range + patchset rebase re-anchor）。当前实现 `scopeOf() = sessionId\0cwd\0branch`
   把同一份代码上的批注按会话分裂：同一 worktree 的会话 A 加的评论在会话 B 不可见，且
   同一行可重复评论——与"划词评论锚定代码"的本质冲突。修正为：
   - 存储桶 key：`workspacePath\0branch`（与现有 seededScopes 一致，去掉 sessionId 维度）；
   - `ReviewComment` 增加 `authorSessionId?` 作为作者元数据（展示"来自哪个会话"，不参与
     归属）；可选 `resolvedAt/resolvedBy` 与 outdated 标记（锚定漂移时按 GitLab #588416
     的教训显式标注，不做静默重定位；crit #296 的 content-based anchoring 可作为后续增强）;
   - 迁移：旧数据（v1 storage）一次性迁移到新桶（按 `workspacePath\0branch` 合并去重，
     id 不变），非破坏、幂等。
4. side-chat / trajectory 维持 session 动作（fork 子会话 / 当前会话轨迹页）。

### D6 side-chat = 临时提问

Codex `/side`（优设网解析）：临时问题走独立侧窗，回答结束回主线，不改变主对话推进方向；
"AI 产品会更像多线程工作台"。我们 side-chat 已实现 fork 当前会话；补齐两点：入口文案强调
“临时提问”；临时会话默认不进入左栏主线列表顶部（避免污染主线顺序）。

### D7 右栏几何

Cursor 论坛大量反馈证明窄栏阅读是普遍痛点；右栏已具备拖宽/最大化/左右切换。补充：宽度与
最大化状态随 worktree 记忆（并入现有 sidebar-preferences 的 cwd 分桶），全局偏好只保留
默认宽度。

## 3. 落地分解

| 项 | 改动面 | 量级 |
| --- | --- | --- |
| D2 会话链接→右栏快速预览 | `plugins/sidebar/src/client/intercept.ts`（openPath handler 路由到右栏 preview pane）、`SideToolsPanel.tsx` files viewer | 中 |
| D3 不自动打开 | center-surface 打开调用点审计（`openPreviewableSurface` 的调用方），agent 卡片加 file chips | 中 |
| D4 preview 偏好 | `sidebar-preferences.ts` 增 `previewTabs` 字段；`center-surface-store.ts` `openPreviewableSurface` 读偏好 | 小 |
| D5a layoutScope 偏好 | `sidebar-preferences.ts`、`center-surface-store.ts`（byCwd ↔ 共享桶切换读取层） | 中 |
| D5b 评论重归属 | `review-comments.ts`：scopeOf 去 sessionId、storage v1→v2 迁移、authorSessionId 元数据、outdated 标记 | 中 |
| D6 side-chat 文案与排序 | `builtins/tabs.tsx`、左栏排序规则 | 小 |
| D7 几何随 worktree | `sidebar-preferences.ts`（宽度入 cwd 桶） | 小 |

验收要点：

- 焦点不变式自动化检查（打开文件前后 composer 是否仍持有焦点）；
- 切换 worktree 来回：tab 队列/布局/PTY 全部恢复（现有 smoke 补 case）；
- 会话 A 加的划词评论在会话 B 的同一 diff 行可见且可 resolve；
- `previewTabs: disabled` 下单击直接生成 pinned tab；
- 迁移幂等：重复加载 v1 数据不产生重复评论。

## 4. 明确不做（本轮）

- 无限画布空间化布局（Collaborator 类）：与三栏心智冲突，观察生态再定。
- 底部工作台恢复 mount：源码保留；待 side-by-side 需求出现再评估。
- 命令面板（Mod+K）：单独提案（键位分散问题的最小解是统一 palette，但不阻塞本模型）。

## 5. 参考（节选）

- Minke 对比：`.agent-workflows/research-minke-vs-dsh-studio/final-comparison.md`
- 网络证据：同目录 `network-research.md`；原始检索与全文抓取
  `output/exa-results*.json`、`output/exa-contents*.json`
- 关键一手来源：microsoft/vscode#298700、anthropics/claude-code#62829、openai/codex#13718、
  zed-industries/zed#55054、zed#39054、zed#4324、microsoft/vscode#81093/#9388、
  vscode src/vs/sessions/LAYOUT_CONTROLLER.md、forum.cursor.com（chat fixed-width /
  double-click full tab / agent steals focus）、coderabbit.ai docs、docs.gitlab.com
  (discussions)、Gerrit comment-util、crit#296（content-based anchoring）
