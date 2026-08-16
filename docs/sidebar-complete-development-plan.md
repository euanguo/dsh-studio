# 右栏完整性开发计划（对齐 Synara × Orca 全部优势）

> 范围：把两个参考项目（Synara / Orca）在**文件查看、diff 查看、编辑**三大领域的全部细节与优势并入 Oh-DSH 右栏 sidebar。
> 依据：`docs/sidebar-feature-gap-analysis.md`（差距清单）、`docs/orca-right-sidebar-research.md`（Orca 完整证据）、`docs/synara-port-exploration.md`（Synara 移植记录）。
> 原则：不设上限、分阶段落地；每阶段可独立验证（typecheck + 单元测试 + CDP 手测）；重依赖走 chunk-loader 懒加载。

---

## 0. 技术底座（先行确认）

### 0.1 技术选型决策（本计划的关键取舍）
| 领域 | 选型 | 理由 | 备选 |
| --- | --- | --- | --- |
| 源码编辑器 | **CodeMirror 6**（懒加载 chunk） | ~500KB 内全功能（行号/折叠/查找替换/换行/语法高亮/undo），纯前端无 Electron 依赖；Monaco 10MB 对 DSH web 环境过重 | Monaco（若需要 TextMate 广度/内建 DiffEditor） |
| diff 渲染 | **保留 Pierre + rawOnly 行渲染**（自研扩展） | 已有基建；展开上下文/行操作在 DiffDocument 层自研可控 | Monaco DiffEditor（配合 Monaco 选型） |
| Markdown 渲染 | react-markdown + **remark-gfm/math + rehype-katex + rehype-highlight(复用 prism) + mermaid(懒加载)** | 轻量增量 | — |
| 富文本 Markdown | **TipTap**（懒加载 chunk，P4 评估） | Orca 同款（WYSIWYG）；体积 ~1MB 可接受 | 仅源码+预览双视图 |
| 语法高亮 | **保留 Prism + HTML 缓存防闪烁**；Shiki 双主题为可选升级 | Prism 已 17 语言、轻量；补缓存即可消除闪烁 | Shiki（双主题 + 更多语言） |
| 虚拟化 | **@tanstack/react-virtual**（~10KB） | Orca/Synara 同款思路、React 生态标准 | @legendapp/list |
| 文件树拖拽 | dnd-kit（可选，P7） | Orca 同款 | 先不做 |
| 图标 | tabler-icons（现状） | 已有 | — |
| PDF | pdfjs-dist（懒加载；PDF 查看已内嵌，补工具栏） | 现状 + 增量 | — |

### 0.2 依赖与体积管理（chunk 规划）
每个重依赖单独一个 chunk，`bundle-route.ts` 白名单 + `chunk-loader.ts` 加载：
- `chunk-editor`：CodeMirror 6 全家（~400-600KB gz）
- `chunk-markdown-rich`：TipTap + @tiptap/markdown（~600KB-1MB）
- `chunk-mermaid`：mermaid（~650KB）
- `chunk-ipynb`：ipynb 解析 + 单元格渲染（复用 editor chunk）
- `chunk-pdf`：pdfjs（PDF 查看增强，若未内置）
- `chunk-virtual`：@tanstack/react-virtual（小，可与主包合）
- 目标：主 client.js 体积不再增长；所有新重依赖首次使用时才下载。

### 0.3 host API 扩展（sidebar-host `/sidebar/api`）
现状：`fs.tree / fs.read / fs.write`、`git.*`（status/diff/stage/unstage/commit/branch/checkout/log/commit-diff/commit-files/commit-file-diff/committed-files/committed-diff/discard/revert/cherry-pick/show/worktree-*）、`settings.*`、pty/jobs。

新增（按阶段推进）：
- **P3（编辑）**：`fs.write` client 侧暴露（`fsWrite`）；`fs.stat`（大小/二进制判断/大文件标记）
- **P7（文件树）**：`fs.create`（原子 'wx'）、`fs.rename`、`fs.delete`（rm -rf 或 trash）、`fs.copy`
- **P7（搜索）**：`fs.search`（ripgrep 优先 → `git grep` 回退，返回文件/行号/匹配行/上下文）
- **P6（git 增强）**：`git.branch-diff` / `git.branch-compare`（merge-base + 逐文件 diff，BaseRefPicker 语义）
- **P8（live-tail）**：`fs.tail`（日志文件尾部跟随，SSE/轮询）
- **P6（AI 提交信息）**：`git.generate-commit-message`（走 host 的 LLM 通道或复用 DSH 会话，评估）

client 侧（better-sidebar-api.ts）对应补全以上全部。

### 0.4 快捷键骨架（P9 落地）
统一 keymap 模块（`client/kit/keymap.ts`）：Mod+S 保存、Mod+F 查找、F7/Shift+F7 跳变更、Mod+Shift+V Markdown 预览、Mod+Alt+C 复制上下文、Mod+Shift+A 加评审注；可重绑定（localStorage）。

---

## 阶段 P1：文件查看器增强（基础，无重依赖）

> 目标：查看体验对齐 Synara（双视图、兜底、辅助操作）。全部走现有 Prism/ReactMarkdown/pdfjs 基建，不引入新依赖。

### P1.1 文件头 chrome
- `content-viewer.tsx` 增加头部条：面包屑（project › …dirs › file，中间可收缩）、行数 meta（`123 lines`）、truncated 标记（`Shown partially`）。
- 打开外部程序 / 显示于文件夹按钮（desktop 侧经 `sidebar-desktop` 的 DesktopBridge 或 `window.dshDesktop`；web 侧降级隐藏）。

### P1.2 Markdown Source/Preview 双视图切换
- `FileViewerChrome` 内 radio 组（Source/Preview），切换状态 per-surface 持久化（center-surface-store）。
- Preview 渲染走现有 ReactMarkdown + 增强（代码块 prism 高亮、GFM 任务列表）。
- **任务清单可勾选写盘**：勾选 → 修改源文本 → `fsWrite` → 刷新；乐观更新 + 失败回滚（Synara `toggleMarkdownTaskMarker` 语义）。

### P1.3 大文件分级兜底
- 读取截断：1MB 上限（`fs.read` 传 maxBytes），truncated 标记传播 UI；**truncated 预览禁写**。
- 高亮上限 250k 字符 → 降级纯文本；行号上限 20k 行 → 去行号（Synara `MAX_PLAIN_NUMBERED_LINES`）。
- 长行不 wrap，横向滚动（现状已具备，确认）。

### P1.4 查看器细节补齐
- **PDF 工具栏**：页码导航、缩放 zoom/zoomIn/zoomOut/fitWidth/fitPage（pdfjs 现有内嵌之上加 toolbar）。
- **图片查看**：loading/ready/error 三态、object-contain 居中（现状有基础）、放大/重置按钮（可选 0.25-8×）。
- **CSV 表格**：吸顶表头、更多行数（500 → 上限提至 2000 或虚拟化）、分隔符探测（.tsv）。
- **二进制细分状态**：binary / empty / unavailable 三种说明态 + Open externally 按钮。
- **复制选中行引用**：文本选区 → 浮动「Copy path:line-line」按钮（`getLineSelectionWithin` 语义）。
- **加载/错误态**：Skeleton 占位、加载失败 + Retry。

### P1.5 读缓存
- 文件内容 LRU 缓存（32 条 / 16MB，代际失效）——切 tab 秒显（对齐 Synara workspace-file-runtime）。

**验收**：typecheck 通过；CDP 手测：打开 md/大文件/PDF/图片/CSV/二进制各类型，双视图切换、勾选任务写盘、截断提示、复制行引用。

---

## 阶段 P2：diff 查看器增强（无重依赖）

> 目标：diff 体验对齐 Synara/Orca（目录树、工具栏、展开、图片 diff、兜底）。

### P2.1 多文件 diff 目录树导航（左树右栈）
- `DiffAllSurfaceView` 重构为：左侧 `PathTreeNav`（目录可折叠 + 文件可选中，复用 list-row 族）+ 右侧 `MultiDiffFileStack`（文件块竖排，点击树滚动定位 + 高亮）。
- 文件块头：路径 + ±N/-M 统计 + 折叠按钮（onCollapse 卸载）。

### P2.2 懒加载性能策略
- IntersectionObserver 预取 + keep-window + 首屏挂 6 个；≥25 文件或 ≥2000 行默认折叠；≥80 文件 capped（对齐 Synara multi-diff-performance-policy）。

### P2.3 diff 工具栏与偏好
- `DiffToolbar`：Unified/Split 切换 + WordWrap 切换（参数已有，补 UI）；偏好持久化（session 级 localStorage）。
- 变更导航：F7/Shift+F7 + 工具栏上下跳按钮（对齐 Orca DiffNavigationProvider）。

### P2.4 上下文行展开（用户点名）
- 自研：对 `DiffDocument` 的 context 行分组，hunk 之间显示「展开 N 行上下文」按钮（GitHub/Orca 语义：展开更多 → 增大 context 窗口）。
- host 侧 `git.diff` 支持 `context` 参数（默认 3，展开时请求更大 context 重拉或本地拼接）。
- rawOnly 行渲染已有行级基础，扩展行点击/悬停操作。

### P2.5 图片 diff（用户点名）
- diff 中图片文件：`ImageDiffViewer`（Original/Modified 双 pane，并排或上下，空侧 "No preview"）。
- host `git.diff` 对图片返回 base64 两侧内容（新方法 `git.image-diff` 或现有 diff 扩展）。

### P2.6 blocked 态细分 + 大 diff 兜底
- blocked 状态枚举：text|patch|binary|large|missing|unsupported 各自空态（对齐 Synara）。
- 大 diff 兜底：行数/字符上限（如 12 万行/600 万字符）→ `LargeDiffFallback` 显示原因 + 可选「保存超限 draft」。

### P2.7 diff 右键菜单 + 路径操作
- 文件块右键：Open / Open With（可用编辑器列表）/ Show in Folder / Copy Path / Copy Relative Path（对齐 Synara PathContextMenuItems）。
- committed/commit diff 视图同步受益（同一 DiffViewer 族）。

**验收**：CDP 手测：多文件 diff 树导航滚动定位、split/wrap 切换、展开上下文、图片 diff、大 diff 提示。

---

## 阶段 P3：编辑器（核心大块，引入 CodeMirror 6）

> 目标：Orca 级编辑体验（查看/编辑一体化、保存流水、diff 联动）。这是最大的增量，依赖 P1（查看器）就位。

### P3.1 编辑器 surface 与基础
- 新增 `editor` surface kind + 渲染器注册（centerSurfaceRendererRegistry）。
- CodeMirror 6 懒加载 chunk：行号、语法高亮（`@codemirror/language-data` 语言集）、代码折叠、查找替换、wordWrap、tabSize、minimap(可省)、行高亮。
- 只读/可编辑（`readOnly` 全局强制）；与 P1 文件查看器共用分发（文本文件在可编辑上下文走编辑器，默认只读、可切编辑）。

### P3.2 保存流水
- client 补 `fsWrite` API（host 已有 fs.write 原子写）。
- Cmd/Ctrl+S → 保存 → fs.write → 清脏 → 刷新 git 状态（source-control runtime refresh）。
- **autosave**：默认 1000ms 可配（250-10000），逐文件队列 + generation 去重；readOnly/combined/conflict 不自动保存。
- **脏状态管理**：tab 标题 ●、切换文件未保存确认、关闭 surface 确认。
- **保存失败**：错误提示 + 重试（不改动本地内容）。

### P3.3 编辑状态与文件操作
- 未命名文件：保存先弹命名（UntitledFileRenameDialog 语义）。
- 截断预览禁编辑（同 P1.3 禁写）。
- 大文本粘贴分级（64KB 直贴 / 16MB 硬上限）。

### P3.4 unstaged diff 直接编辑（Orca 特色）
- diff surface 中 unstaged 的 modified 侧可编辑 → 保存写盘 → 实时刷新 diff（rawOnly 行渲染扩展为可编辑行）。

### P3.5 Changes 模式（Orca 特色）
- 编辑中的文件 tab 可切换为「Changes」视图：workTree-vs-HEAD diff 就地渲染（复用 git.diff），保留 draft 管线（autosave/脏状态）。

### P3.6 快捷键
- Mod+S 保存、Mod+F 查找、Mod+Alt+F 替换、F7/Shift+F7 跳变更（与 P2.3 共用）。

**验收**：编辑 md/ts 文件 → Cmd+S 落盘 → git 面板状态刷新；unstaged diff 直接编辑保存；脏标记/关闭确认；typecheck + 手测。

---

## 阶段 P4：Markdown 完整体验（富文本 + 预览增强）

> 目标：Orca 三态（source / rich / preview）+ 预览全家桶。

### P4.1 Markdown 源码编辑 + 预览同步
- P3 编辑器 + P1.2 双视图：source 编辑 ↔ preview 同步（防抖渲染）；同一文件可双 pane 共开（preview 独立 tab）。

### P4.2 富文本 WYSIWYG（TipTap）
- 懒加载 chunk；工具栏（标题/粗斜体/列表/表格/任务清单/链接/代码块/数学）、斜杠命令菜单、链接气泡、Emoji 菜单（对齐 Orca RichMarkdown*）。
- source ↔ rich 往返（`@tiptap/markdown` + 自研 reconcile）；rich 上限 300KB 自动回退 source。
- frontmatter 编辑时剥离、保存回写（FrontMatterBanner）。

### P4.3 预览增强
- TOC 目录侧栏（markdown-toc）、站内文字查找、内部链接路由（同仓库文件跳转）、本地图片、KaTeX 数学、mermaid 渲染（懒加载 + DOMPurify + 队列）。
- 导出 HTML/PDF（可选）。

**验收**：md 三态切换、富文本编辑往返源码无损坏、TOC/搜索/mermaid/KaTeX 渲染、勾选任务写盘（P1.2）。

---

## 阶段 P5：diff 评论与评审（Orca 特色）

> 目标：行内评论 + 发送给 AI。

### P5.1 行评论
- diff 行悬停 + 加号按钮、拖拽选区（多行区间）、评论卡（浮动/内嵌 view-zone 简化版）、撰写浮层（对齐 Orca useDiffCommentDecorator / DiffCommentPopover，用我们已有的 rawOnly 行点击基础）。
- Markdown 文件段落级评审批注（可选）。

### P5.2 评论持久化
- 评论模型：source/side/selectedText/startLine..lineNumber/scope/sentAt；按 workspace+cwd 分片存 localStorage（或侧栏数据文件）。

### P5.3 发送给 AI
- 评论聚合 → 组装 prompt（文件路径 + 行区间 + 选中文本 + 评论）→ 注入当前 DSH 会话 composer（桌面端可用，web 端降级复制）。

### P5.4 聚合面板
- 评论列表（按文件分组）、复制全部、清空（确认）。

**验收**：diff 行加评论、刷新后仍在、发送到会话或复制。

---

## 阶段 P6：git 操作增强

> 目标：对齐四区面板、批量操作、分支/commit 对比、状态机、历史图。

### P6.1 四区面板
- conflict / staged / unstaged / untracked 分区（现状 staged/unstaged，补 conflict/untracked 标记与操作）。
- 行级 +N/-M 统计、变更标记符号、悬停 stage/unstage/discard 按钮（现状已有部分，补全）。

### P6.2 区块级批量操作 + 确认计划
- section 头 stage-all/unstage-all/discard-all；discard 确认计划（stagedPaths/discardablePaths/finalPaths 预览）。

### P6.3 分支/commit 对比
- BaseRefPicker（选择 base ref）+ host `git.branch-compare`/`git.branch-diff`（merge-base 语义）→ combined-branch diff 视图。
- 保留并增强 committed diff（我们的独有优势）。

### P6.4 提交历史图
- `GitHistoryGraphSvg`（SVG 分支图）+ 提交右键（copy-hash/copy-message/explain/open-diff）—— 可选（依赖历史数据扩展）。

### P6.5 主操作状态机
- 阶梯：commit → stage → push → sync → publish → create_pr（resolvePrimaryAction 语义）；下拉动作（Commit/Push/Force Push/Create PR/Pull/Fast-forward/Sync/Rebase/Fetch/Publish Branch/Abort merge|rebase）。
- AI 生成提交信息（host `git.generate-commit-message` 或 DSH 会话，评估）。

**验收**：四区正确分组、批量操作带确认、分支对比视图、状态机主按钮。

---

## 阶段 P7：文件树增强

> 目标：文件管理器级操作 + 全文搜索。

### P7.1 文件操作
- host 补 `fs.create / fs.rename / fs.delete / fs.copy`；文件树右键菜单：新建文件/目录、重命名、删除（确认）、复制、在 Finder 显示。
- 原子创建（'wx' 防覆盖）；删除走回收站（Electron 侧 `shell.trashItem`，web 降级 rm）。

### P7.2 全文搜索
- host 补 `fs.search`（ripgrep 优先 → git grep 回退 → 纯 JS 降级）；右栏搜索框（防抖）、结果面板（虚拟化、按文件分组）、点击在匹配行打开（匹配行定位）。
- 过滤：大小写/仅代码/仅文件名。

### P7.3 树体验
- FilenameLabel 中间省略（Canvas 测量 + 扩展名保留，移植 Synara middle-truncate-text）。
- 目录懒加载、gitignore 过滤、auto-reveal（可选）。
- 拖拽/撤销重做（dnd-kit，P9 可选）。

**验收**：右键新建/重命名/删除文件生效；搜索命中打开到匹配行。

---

## 阶段 P8：专项查看器

> 目标：Orca 全家桶（ipynb / Mermaid / CSV 虚拟化 / live-tail）。

### P8.1 ipynb 查看器
- 解析（ipynb-parse）+ 单元格渲染：代码格（复用 editor chunk，非活动格摘要）、markdown 格（渲染预览 + 可编辑）。
- 格操作：run/上插/下插/上移/下移/删除/类型切换；**运行 Python**：host 补 `notebook.runPythonCell`（评估：需要 python 环境 + 输出沙箱；先做查看与编辑，运行标 P9 可选）。

### P8.2 Mermaid
- 懒加载 mermaid chunk + `securityLevel:'strict'` + DOMPurify 清洗 + 渲染队列 + 语法错误回退 raw。

### P8.3 CSV 虚拟化
- @tanstack/react-virtual 行虚拟化（可扛 10 万行）、吸顶表头/行号列、列宽采样（200 行）。

### P8.4 live-tail
- host 补 `fs.tail`（日志跟随，轮询/SSE）；只读跟随渲染（CodeMirror 只读模式或纯文本）。

**验收**：ipynb 查看/编辑、mermaid 渲染、10 万行 CSV 流畅、日志跟随。

---

## 阶段 P9：打磨与性能

### P9.1 快捷键体系
- 统一 keymap（0.4）+ 可重绑定 UI（设置页）。

### P9.2 状态与反馈
- 空/加载/错误态统一组件（EmptyHeader/Title/Description、Skeleton、Retry）。
- 通知 toast（复制成功/失败、写盘失败、discard 确认）——轻量自研 toast 或复用 DSH。

### P9.3 性能
- 列表虚拟化统一（变更列表、文件树、diff 文件栈、搜索结果）。
- 缓存：读缓存（P1.5）、高亮 HTML 缓存、diff 结果缓存、scroll 位置恢复。
- 懒加载全量重依赖 chunk（0.2）。

### P9.4 外部变更检测（评估）
- web 环境无 fs.watch：host 轮询（如 2s stat 对比）或 SSE 推送；脏 tab 标 changed-on-disk + banner + 对比弹窗（Orca ExternalFileChangeBanner）。
- 保存 quiesce（外部变更时挂起 autosave）。

### P9.5 冲突解决视图（可选，评估）
- conflict 文件 → 三方对比（ours/theirs/result，CodeMirror merge 或简化单选），保存 resolved。

**验收**：全量手测清单通过；无主包体积增长（chunk 化生效）；切换秒显。

---

## 执行顺序与依赖图

```
P1 文件查看 ──► P2 diff 查看 ──► P3 编辑器 ──► P4 Markdown 三态
   │                │                │                │
   └─► P5 diff 评论 ◄────────────────┘                │
   P6 git 增强（可与 P1-P5 并行）                      │
   P7 文件树（依赖 host API 扩展，可与 P1-P5 并行）     │
   P8 专项查看器（依赖 P3 editor chunk）◄──────────────┘
   P9 打磨（贯穿）
```

- **P1 → P2 → P3 → P4** 主线（P3 是最大块）。
- **P5** 依赖 P2（diff 行）与 P3（编辑器）基础。
- **P6 / P7** 相对独立（host API 扩展 + 面板增强），可与主线并行。
- **P8** 依赖 P3 的 editor chunk。
- **P9** 贯穿所有阶段。

## 每阶段交付物

1. 代码（plugins/sidebar*/shared/*）+ 依赖声明（package.json / pnpm-lock）
2. host API 扩展（sidebar-host index.ts）+ client API（better-sidebar-api.ts）
3. 单元测试（node --test，纯逻辑部分）
4. 文档更新（docs/sidebar-development.md 对应章节）
5. CDP 手测记录

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| CodeMirror 6 对 DSH 环境（Shadow DOM/iframe）兼容 | 提前 spike（P3 第一任务：最小编辑 demo 在 DSH surface 跑通） |
| TipTap 体积与复杂度 | 懒加载 chunk；先 source+preview 后 rich |
| ipynb 运行 Python 需要 host python 通道 | 先查看/编辑，运行标可选；host 评估 python 能力 |
| 外部变更检测无 fs.watch | host 轮询或 SSE；先 banner 后 quiesce |
| Monaco 若必须（TextMate 语法广度） | P3 spike 结论后决定；体积走 chunk |
| 工作量跨度大 | 每阶段独立验收；用户按阶段验收后继续 |

## 里程碑建议

- **M1**（P1+P2）：查看与 diff 完整可用 —— 用户点名四项中的 Markdown 双视图/目录树/图片 diff/展开上下文全部落地
- **M2**（P3+P4）：编辑器 + Markdown 三态 —— 从"查看器"变为"编辑器"
- **M3**（P5-P8）：评论/git/文件树/专项查看器 —— 功能全家桶
- **M4**（P9）：打磨与性能 —— 收尾
