# Oh-DSH 右侧栏（Right Sidebar）现有功能与 Git 面板布局架构分析

> 纯分析文档，未改动任何代码。基于 `plugins/desktop-sidebar` 与
> `plugins/better-sidebar-runtime` 的源码推断。

---

## 一、右侧栏整体架构

### 1.1 这是什么

右侧栏是 `plugins/desktop-sidebar`（包名 `@oh-dsh/desktop-sidebar`）注入的一个
固定覆盖层（`fixed` overlay），不是 DSH 官方自带面板的简单"左侧栏镜像"，而是
项目自己重构的一套"工作区 + 桌面工具"面板。挂在 `doc.body` 下的
`#oh-dsh-desktop-sidebar-root` 容器里，通过 `createPortal` 渲染。

- 宿主容器：`#oh-dsh-desktop-sidebar-root`，`fixed`、右上角、`right:12px; bottom:12px`、
  `z-index:9000`，默认 `pointer-events:none`，展开时才恢复。
- 面板本体：`.oh-dsh-workspace-panel`（通用面板壳），`.oh-dsh-side-panel` 再把它
  收成贴边右侧栏。
- 打开/关闭、宽度、最大化全部通过 `WorkspaceToolsService` + `DesktopSidebarService`
  的订阅（各种 `useSyncExternalStore`）驱动。
- 主组件：`SideToolsPanel.tsx`，注册表：`plugin.tsx` 的 `registerBuiltinSidebarTools`。

### 1.2 面板的"页框"结构（Chrome）

面板按功能分成四段（纵向 flex）：

```
┌───────────────────────────────────────────────┐
│  .oh-dsh-side-top  顶栏（37px 最小高）           │
│  [文件] [Git]  [+]菜单   …  [🗕][▣ ⌘J][⊥ ⌥⌘B]  │
├───────────────────────────────────────────────┤
│  [可选] .oh-dsh-side-header  子页顶栏（active  │
│  tab 有标题时；Git 面板 chrome:custom 会隐藏它）│
├───────────────────────────────────────────────┤
│  content —— active tab 渲染的正文（flex:1）     │
│                                                │
├───────────────────────────────────────────────┤
│  （无底栏）                                    │
└───────────────────────────────────────────────┘
```

- `PinnedTabs`：固定两个"插槽"——**文件(📁)** 和 **Git(⌘⇧G)**，常驻可点。
- `TabStrip`：只有 ≥2 个 tab 时才出现，可横向滚动 + 关闭按钮。
- `AddToolsMenu`：`+` 弹出其它未打开的工具。
- `PanelActions`：最右侧一排窗控——**展开/还原、终端(⌘J)、收起侧边栏(⌥⌘B)**。
- 二级菜单视图（无 active tab 时）是 `SideMenu`，居中列出一堆工具行 + 快捷 `kbd`。

### 1.3 面板的三种形态

1. **菜单态**（无 active tab）→ `SideMenu` 工具列表。
2. **Tab 态**（有 active tab）→ 对应 `descriptor.render(...)` 渲染正文。
3. **最大化态** → `data-maximized`，面板铺满全窗（100vw），`#root` 被挤到 `padding-right:100vw`。

宽度逻辑：默认 **300px**，可拖拽到 **280–480px**（`SIDEBAR_MIN/MAX_WIDTH`），
窄视口（<900px）时变成全宽抽屉。

---

## 二、右侧栏现有功能清单

以 `plugin.tsx` 里注册的 tab/viewer 为准，外加一些服务侧的注入能力。

### 2.1 内置工具（注册的 tabs）

| # | id / 类型 | 触发 | 功能 | 备注 |
|---|-----------|------|------|------|
| 1 | `review`（Git） | 固定按钮 / ⌘⇧G | **Git Review 面板**：变更列表、提交历史、行级评论、分支/提交/push（见第三部分） | 固定位、`single`、需 workspace；`chrome:'custom'` |
| 2 | `terminal` | [+] / ⌘J | 一键切换底部终端面板（`panels.toggleBottomPanel()`） | 纯 action，无独立渲染 |
| 3 | `browser` | [+] / ⌘T | **内嵌浏览器**：地址栏 + 返回/刷新 + `<webview>` 加载任意 http(s) | `chrome:'standard'` |
| 4 | `files` | 固定按钮 / ⌘P | **文件浏览器**：flat/nested/tree 三种模式、点目录展开、双击打开 tab、单击弹 DetachedPanel 预览 | 需 workspace |
| 5 | `file` | 双击文件路径打开 | **单文件查看 tab**（隐藏注册，不自带按钮） | dedupe 按 resource |
| 6 | `side-chat` | [+] / ⌥⌘S | fork 一个会话侧栏聊天 | 纯 action |
| 7 | `trajectory` | [+] | 打开主界面的"轨迹" tab | 纯 action，需 workspace |

### 2.2 文件查看器（viewers，按扩展名/嗅探匹配）

- `binary`（检测到 0 字节）→ 下载式预览。
- `html` / `.htm` → iframe 渲染。
- `markdown` / `.md` / `.mdx` → `ReactMarkdown` 渲染。
- `text`（兜底）→ `TextFileViewer` 行号文本预览。

另外 `ContentViewer` / `DiffView` 支持 **语法高亮（Prism）**、**统览/分栏 diff**、软换行。

### 2.3 拦截/增强能力

- **openPath 拦截**：DSH 主会话打开工作区文件时，接管到侧栏 `file` tab 显示。
- **外部链接拦截**：Ctrl/Cmd+点击链接（非主文件路径）转到内嵌 browser。
- **会话/工作区绑定**：tabs、选择、评论按 `sessionId + cwd` 隔离（`SIDEBAR_MAX_SESSIONS=50`）。
- **评论服务**：`reviewComments` 以 `commitId + sessionId + workspacePath + branch` 锚定行级/提交级评论。
- **设置在 DSH 设置区**：注入 `settings.section`（`SidebarSettingsRow`）——开关各 tab/viewer、默认宽、是否默认打开、是否拦截 openPath/链接。

### 2.4 快捷键汇总

| 键 | 动作 |
|----|------|
| ⌃⇧G / Ctrl+Shift+G | 打开 Git Review |
| ⌘T | 打开浏览器 |
| ⌘P | 打开文件 |
| ⌥⌘S | 打开侧栏聊天 |
| ⌥⌘B | 收起/展开侧边栏 |
| ⌘J | 开关底部终端 |
| Esc | 取消最大化 |

---

## 三、Git 面板布局 / 线稿架构（重点）

Git 面板由 `WorkspacePanel`（`workspace-panel.tsx`）整体构成，内部是一个纵向
flex 的 `.oh-dsh-review-view`，又嵌进 `.oh-dsh-workspace-content` 这个会滚动的容器。
因为它注册为 `chrome:'custom'`，所以不再套用外层 `.oh-dsh-side-header`，而是自己渲染
一个 `.oh-dsh-workspace-header`。

### 3.1 总框架（从代码逆推出的线稿）

```
┌────────────────────────────────────────────────────────┐
│ oh-dsh-review-view  (display:flex; column; flex:1; overflow:hidden)
│ ┌────────────────────────────────────────────────────┐ │
│ │ oh-dsh-workspace-header   (min-height:58px)         │ │
│ │   [← 返回]  仓库名  ▬▬▬▬▬▬  [⟳][+][⛶][✕]            │ │
│ ├────────────────────────────────────────────────────┤ │
│ │ oh-dsh-workspace-content  (flex:1; overflow:auto;   │ │
│ │   padding: 4px 8px 12px)                            │ │
│ │  ┌ 错误提示条(可选) ┐                                │ │
│ │  [SECTION 1] 变更列表（含工具栏）                    │ │
│ │  [SECTION ↑] 提交历史 + 行级评论                     │ │
│ │  [SECTION 2] 环境/分支/提交(事实区)                 │ │
│ │  [SECTION 3] 工作目录行                             │ │
│ │  [SECTION 4] 后台进程                                │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

> 关键点：**只有一个 header**（review 是 `chrome:'custom'`，外层 in-chrome header 被跳过）。

### 3.2 五个内容区块（自顶向下）

1. **变更列表区** `<section>`（`.oh-dsh-change-list`）
   - 顶部 `SourceControlPanel`：`oh-dsh-sc-toolbar` 工具栏（"更改 n" + flat/tree 切换）。
   - 下面是行流：`staged`（已暂存）→ `unstaged`（未暂存，含冲突）两个 `section`，
     每个 section 可折叠；逐行是 目录行 / 文件行。
2. **提交历史区** `<section class="oh-dsh-review-history">`
   - 标题行（时钟图标 + "Review 历史" + 计数徽章）。
   - 提交列表（每行 hash + subject + author，可展开详情）。
   - 选中提交后：详情卡片（header、行级/提交级评论、分文件 `decailtails` diff）。
3. **事实区** `<section class="oh-dsh-workspace-facts">`
   - 环境选择（local）、分支下拉、新建分支输入、提交/推送 toggle + `oh-dsh-commit-box`。
4. **工作目录区** `<section class="oh-dsh-workspace-directory">`
   - 仓库名 + 完整路径 + "+" 选择工作区按钮。
5. **后台进程区** `<section class="oh-dsh-processes">`：当前会话运行中的工具调用列表。

### 3.3 变更列表的"行"建模（视图模型）

纯函数 `buildSourceControlRows`（`source-control-view-model.ts`）把
`WorkspaceChange[]` 变成三种行：

```
行 = SectionRow（区段头）| DirectoryRow（目录）| FileRow（文件）
```

- **两个区段**：`staged` 在上、`unstaged` 在下（含 conflicted）。
- **模式**：`flat`（每文件一行、depth=0）或 `tree`（目录分组、depth 缩进、单子目录链合并）。
- **能力**：每行算 `canStage / canUnstage / canDiscard`（如 conflicted 不可 stage/discard）。
- 树建模（`source-control-tree.ts`）：路径按 `/` 切段 → 建树 → 计数 fileCount → 合并单孩子目录链 → 排序。

### 3.4 行级样式/布局规则（source-control.css）

- **行高** 28px（`--oh-dsh-size-row`），行内 flex，`--tree-depth` 决定缩进
  （`8px + 6px*深度`）。
- **三段结构**：`.oh-dsh-sc-main`（图标+名称，flex:1）｜`.oh-dsh-sc-trailing`
  （状态白+短标签，绝对定位右侧）｜`.oh-dsh-sc-actions`（hover 覆盖 stage/unstage/discard 按钮组）。
- **"永不改布局"的悬浮动作层**：trailing 与 actions 都是绝对定位于行右侧、`translateY(-50%)`；
  平时 trailing 可见、actions 透明；行 hover 时 trailing 淡出、actions 淡入——
  所以任何行在任何状态下（稳定或 pending）都**不改变宽度/高度**。
- **右键菜单**：`.oh-dsh-sc-menu`（复制路径 / stage / unstage / discard），固定定位，`z-index:max`。

### 3.5 DetachedPanel（文件/diff 预览弹层）

- 点变更行 → 不是内联展开，而是弹出一个**全局浮动窗**（`createPortal` 到 body）：
  `.oh-dsh-detached`，默认约 `min(620, 视口-320)` 宽、`min(520, 视口-120)` 高。
- 可**拖拽标题栏**、**右下角缩放**、Esc/按钮关闭。
- 内分：header（标题/副标题 + actions：diff 视图 / 文件视图 / 外部打开）+ body。
- body 里是 **diff 工具栏**（统览/分栏 + 软换行）→ `DiffView`，或 `ContentViewer`。

---

## 四、关于"样式/布局/间距奇怪"的代码侧观察（潜在问题，未改）

以下是从 CSS 直接读出的可能让人感觉"不对"的点：

1. **间距/缩进不统一**：变更列表用了 `padding-left:30px` 的"野心"缩进
   （`.oh-dsh-change-list`, `.oh-dsh-review-commit-list`, `.oh-dsh-new-branch`,
   `.oh-dsh-commit-box` 都各写各的 30/40px），而文件浏览器/Git 行用的是
   `var(--tree-indent)=6px*深度` 体系。两种缩进语言并存。
2. **字号很碎**：正文 11px，一堆 `9px` 的字号散落各规则（commit 行、评论、目录行），
   与共享层定义的 10–15px 阶梯相悖。
3. **头部高度/圆角**：面板外壳 `border-radius:22px` + `right:12px`（贴边但没有完全贴边）；
   而 `.oh-dsh-side-panel` 又 `border-radius:0; right:0` 把它压平——两套壳规则叠加，
   视觉右下角可能与其它面板不一致。
4. **section 间分界靠 border**：`.oh-dsh-workspace-content section` 用
   `border-bottom` + `--space-2` 分隔，但祖 `.oh-dsh-workspace-facts` 又 `display:grid; gap:1px`，
   体系混用。
5. **旧的 `/` `.oh-dsh-change-row` / `.oh-dsh-change-status`** 仍在 desktop-sidebar.css 里
   （`oh-dsh-change-list` 引用的是旧网格行样式），看起来与新的 `SourceControlPanel`
   （`.oh-dsh-sc-*`）有重叠/残留：旧样式可能不再被新行命中，属死代码风险。
6. **间距 token 主要在**：4px 网格（space-0/1/1.5/2/3/4/5/6），但很多地方仍硬编码
   `7px / 9px / 18px / 40px` padding，未完全走 token。
7. **两套顶栏行为**：Git 用自己 `chrome:'custom'` 的 header，其它 tab 用外层
   `.oh-dsh-side-header`；菜单态又完全没 header——于是"顶栏长什么样"有三种规则，易出现
   {Git 有返回+关+最大化但没终端} vs {普通 tab 有 back/close/max} vs {菜单只有右上角关闭} 的不齐。

---

## 五、结语

本分析未改动任何文件。改动点如需推进，建议先从"缩进/字号/token 收敛"和"旧 `.oh-dsh-change-*`
样式清理 + 两套 header 统一"入手。如果需要，我可以基于以上线稿拟定一版具体的样式重构步骤。