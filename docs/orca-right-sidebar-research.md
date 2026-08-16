# Orca 文件查看 / Diff 查看 / 编辑功能调研报告

> 调研对象：AI 编排桌面应用 **Orca**（仓库 `myade/orca`，Electron + React + electron-vite）。
> 范围：**文件查看、diff 查看、编辑** 三大领域的全部功能，重点是右栏 sidebar 相关的"完整可用"体验。
> 证据标注：`文件路径：函数/组件名`（已省略 `myade/orca/` 前缀）。

---

## 架构速览（为什么 Orca 的右栏体验特殊）

- **编辑器就是 Monaco**（`@monaco-editor/react` + 内嵌 `monaco-editor`），但被定位成"**git worktree 工作文件的查看/编辑界面**"，diff 是一等公民。代码文件、diff、CSV、ipynb、mermaid、markdown 源都走 Monaco。
- **渲染器是沙箱**：一切文件读写都走可信的 preload IPC 桥（`window.api.fs.*` → `ipcMain.handle('fs:*')`），远程/SSH 运行环境改用 runtime RPC（`files.*` 方法）。
- 单文件 tab 的渲染模式由 `EditorContent.tsx` 分发：`edit / diff / markdown-preview / conflict-review / check-details`。
- 未提交 `edit` tab 可切换为 **"Changes 模式"**，把编辑中的 draft 直接渲染成"workTree vs HEAD"的 diff，不另建 diff tab（`ChangesModeView.tsx`）。

---

## 一、文件查看器（File Viewer）

### 1.1 支持的文件类型与分发

- **文本**：所有文本/代码文件走 Monaco。`EditorContent.tsx`（`EditorContent`，第 723-831 行）按渲染模型分发：`isMarkdown`→Markdown 管线；`isMermaid`→MermaidViewer；`isCsv`→CsvViewer；`isNotebook`→IpynbViewer；否则 `renderMonacoEditor`。
- **二进制判定**：主进程 `fs:readFile` 返回 `{ content, isBinary, isImage?, mimeType? }`（`src/main/ipc/filesystem.ts:547`，`src/preload/api-types.ts:2479`）。二进制探针 8192 字节；文本上限 **50MB**（`MAX_TEXT_FILE_SIZE`）；可预览二进制（图片/PDF）上限 50MB base64。
- **图片**：`ImageViewer.tsx:ImageViewer`。内联缩放（**0.25–8×**，ctrl+滚轮锚点缩放，`image-viewer-zoom.ts`/`image-viewer-dom-zoom.ts`）、重置、弹出窗 `ImageViewerPopup.tsx`、intrinsic/fill 两种布局、展示文件名/尺寸/估算大小、加载失败兜底。PDF 的 `mimeType==='application/pdf'` 时**转发给 PdfViewer**（`ImageViewer.tsx:212`）。
- **PDF**：`PdfViewer.tsx:PDFViewer`（pdfjs-dist）。页宽/缩放（0.25–5×）、内置查找 `PdfFind.tsx`、缩放偏好记忆 `pdf-scale-preference.ts`。
- **CSV / TSV**：`CsvViewer.tsx + csv-parse.ts`。用 **CSS grid（非 `<table>`）** + `@tanstack/react-virtual` 行虚拟化（固定 28px 行、overscan 12，**可扛 10 万+ 行**）；吸顶表头 + 吸顶行号列；列宽从 200 行样本测量（`columnWidths`）；分隔符探测（`.tsv→tab`，否则数首行 tab vs 逗号，手写 RFC 4180 解析器 `parseCsv`，去 BOM/引号字段/CRLF）；"Empty file"空态 + 底部行列数统计。
- **Notebook (ipynb)**：`IpynbViewer.tsx + ipynb-parse.ts + ipynb-code-cell-lines.ts`。代码格用 Monaco（非活动格显示摘要 `MonacoCodeExcerpt`），markdown/raw 格可编辑+react-markdown 实时预览；每格头部支持 run/上插/下插/上移/下移/删除/类型切换（Code/Markdown/Raw）；源码编辑 400ms 防抖 draft，保存走 `editor.save`。**输出沙箱**：text/html → DOMPurify 清洗的 `sandbox=""` iframe、image/* → data-URI、json → pretty pre、markdown → 渲染；运行前有一次性 "Run Notebook Code?" 信任确认，`api.notebook.runPythonCell`（前格代码作 preamble）。BETA 徽标、nbformat/内核显示；编辑器高度压 96–520px。
- **Mermaid**：`MermaidViewer.tsx + MermaidBlock.tsx + mermaid-config.ts`。懒加载 mermaid（~650KB 缓存 promise）；所有 `mermaid.render()` 经模块级队列序列化防竞态；`securityLevel:'strict'`；输出 SVG 用 **DOMPurify 清洗**（防御纵深）；语法错误回退 raw 源码 + "Diagram error:" banner；Markdown 预览内嵌的代码块也会渲染 Mermaid。
- **二进制不可预览**：显示"Binary file — cannot display"占位（`EditorContent.tsx:744-751`）。

### 1.2 语法高亮方案

- **Monaco 自带 tokenizer + TextMate 语法**，不是 shiki/prism/highlight.js。诊断全部关闭，Monaco 被当**查看/高亮器**而非类型检查器（`src/renderer/src/lib/monaco-setup.ts`：TS/JS `noSemanticValidation/noSuggestionDiagnostics/noSyntaxValidation`）。
- 语言扩展映射：`src/renderer/src/lib/language-detect.ts:detectLanguage`（约 90 种扩展 + 按文件名的 `Dockerfile/Makefile/CMakeLists.txt/.env*/.gitignore`）。特判：`.md/.mdx→markdown`、`.mmd→mermaid`、`.csv/.tsv`、`.ipynb→notebook`（这些触发上面的特殊查看器）。
- **自定义语言**：`vue/svelte/astro/jsonl`（`register-*.ts`）和 `nim`（TextMate，`monaco-languages/textmate-grammars/nim.tmLanguage.json`）。
- **Markdown 预览中的代码高亮**：`MarkdownPreview.tsx` 用 `rehype-highlight`（+ remark-gfm/math + rehype-katex/raw/sanitize/slug），代码块带 `CodeBlockCopyButton` 复制按钮。

### 1.3 Markdown 处理（三种视图）

- **三种视图模式**：`source`（Monaco 源码）/ `rich`（TipTap 富文本所见即所得）/ `preview`（渲染预览）。由 `MarkdownViewMode` + `getMarkdownRenderMode()` 决定（`markdown-render-mode.ts`、`markdown-rich-mode.ts`）。切换按钮 `EditorViewToggle.tsx:EditorViewToggle`（source/rich/preview/edit/changes）。**各文件类型可用模式**由 `markdown-preview-controls.ts:getMarkdownViewModes/getDefaultMarkdownViewMode` 决定：编辑类文件默认 `rich`，**diff 默认 `source`**；CSV-rich 显示为 "Table"、notebook-rich 显示为 "Notebook"。**Preview 是独立 tab 而非切换值**（快捷键 `editor.markdownPreview` = Mod+Shift+V，`openMarkdownPreview`）。rich 编辑会剥离 frontmatter 再回写（`markdown-frontmatter.ts` + `FrontMatterBanner`）。
- **rich 编辑器** = **TipTap / ProseMirror**（`RichMarkdownEditor.tsx`），基于 `@tiptap/*` + `@tiptap/markdown`（riding `marked` facade，见 `tiptap-marked-facade.ts`）；**独立源码/预览往返**有专门的控制（`monaco-content-sync` / `useRichMarkdown*` 一组）。**rich 上限 300KB**（`markdown-rich-size-limit.ts`），超过自动回退 source 并提示。
- **preview** = **react-markdown**（`MarkdownPreview.tsx`），支持 GFM、表格、KaTeX 数学、`rehype-highlight`、sanitize、目录（`MarkdownTableOfContentsPanel.tsx`）、预览内文字查找（`markdown-preview-search.ts`）、内部链接/本地图片穿透（`markdown-internal-links.ts`、`markdown-preview-local-images.ts`）、frontmatter 处理（`markdown-frontmatter.ts` 提取/回写）。
- **同一文件多视图共开**：`openMarkdownPreview`（`EditorPanel.tsx:294`）可把源文件在另一个 pane 打开为渲染预览 tab（`mode='markdown-preview'`），`markdownPreviewSourceFileId` 关联回源，预览编辑自动同步。
- **导出 PDF**：`export-active-markdown.ts:exportActiveMarkdownToPdf`。

### 1.4 辅助功能

- **行号**：`lineNumbers: 'on'`，`renderLineHighlight: 'line'`（`MonacoEditor.tsx:846-870`）。
- **复制路径**：编辑器表头下拉 "Copy Path / Copy Relative Path"（`EditorPanelHeaderPath.tsx`、`EditorPanel.tsx:handleCopyPath`）；行号 gutter 右键菜单 "**Copy Path to Line / Copy Rel. Path to Line / Copy Remote URL**"（`MonacoGutterContextMenu.tsx`）。EditorFileTab 右键也可复制（`EditorFileTabContextMenu.tsx`）。
- **打开外部程序 / 在文件管理器显示**：`window.api.shell.*`（`src/preload/index.ts:2209-2242`）→ 主进程 `src/main/ipc/shell.ts`：
  - **`shell:openInFileManager`** → `shell.showItemInFolder`（在 Finder/文件管理器中显示）；
  - **`shell:openInExternalEditor`** → 用外部编辑器打开（含远程-SSH authority）；
  - `shell:openPath` / `shell:openFilePath` / `shell:openFileUri` / `shell:openUrl`（https/http only）。
- **minimap / 换行 / find**：minimap 默认关（设置项）；`wordWrap` 默认开（`file-editor-word-wrap-options.ts`）；Monaco 内建 find 用 `monacoFindOptions`（`seedSearchStringFromSelection`）。
- **大文本粘贴**：`monaco-large-text-paste.ts`（≤64KB 直贴、分段 16KB、硬上限 **16MB**，超出 toast "Paste is too large"）。
- **只读 / 异常状态**：`FileLoadErrorView`（无法加载+Retry）、二进制占位、`LargeDiffFallback`、`RichMarkdownErrorBoundary`、`EditorLoadingFallback`、空态 "No changes to display"（`CombinedDiffViewer.tsx:1656`）、"Conflicted files are reviewed separately"（冲突单独审，`CombinedDiffViewer.tsx:1606`）。
- **外部改动检测**：文件 watcher push（`fs:changed`）→ `useEditorExternalWatch.ts` → DOM 事件 `orca:editor-external-file-change` → 干净 tab 自动重载 / 脏 tab 标 `changed-on-disk` 并显示 `ExternalFileChangeBanner.tsx` + `ExternalFileChangeCompareDialog.tsx`。
- **Live tail**（实时日志跟随）：`useLocalLogTail.ts`，只读本地文件 `fs:startLocalLogTail/readLocalLogTail/localLogTailChanged`，Monaco 以 `read-only-live-tail` 模式跟随（禁 undo 保留）。

---

## 二、Diff 查看器（Diff Viewer）

### 2.1 渲染方式

- **单文件 diff = Monaco 内建 DiffEditor**（`DiffViewer.tsx`，import `DiffEditor` from `@monaco-editor/react`）。不是自研 differ：
  - **unified(inline)/split**：`renderSideBySide: sideBySide` 切换（`DiffViewer.tsx:422`）。
  - **逐词高亮 / 变更块**：Monaco 原生 change-highlighting。
  - **可编辑**：`editable` 只对 unstaged 生效——`modified` 侧可编辑（`上`行 `isEditable = diffSource==='unstaged'`，`EditorContent.tsx:843`）；`originalEditable:false`。编辑时 `onDidChangeModelContent` 同步 draft / 脏状态。
  - **自动滚到第一个 diff**，`F7 / Shift+F7` 及表头按钮上下跳（`DiffNavigationProvider`，`diff-navigation-context.tsx`；`installMonacoDiffChangeNavigationShortcut`）。
  - view-state 持久化到 LRU（`diff-model-swap-view-state.ts`、`diffViewStateCache`）。
  - 行号按 pane 定制（`diff-editor-line-number-options.ts:12-17`）：inline 模式把原侧 gutter 隐藏成 `'off'`、改侧恒 `'on'`、side-by-side 双开（Monaco 0.55 只暴露共享 option，需对内部 editor 逐侧 override）；diff 专用滚动条 **20px 更宽**、combined 行内隐藏竖条+吞滚轮（`diff-editor-scrollbar-options.ts:7-17`）；diff 换行（`diff-editor-word-wrap-options.ts`）；overview ruler。

### 2.2 Diff 数据模型（主进程 `getDiff` 流程）

- 插件直接拿 **original/modified 两个完整文本**给 Monaco 自行 diff——**没有 git hunks/context 模型**。主进程用 `git show <oid>:<path>` / `git show :<path>` / `readFile` 逐文件读出两侧内容（`src/main/git/status.ts:1746-1798` → `buildDiffResult` 1817），`getDiff`(1172)/`getBranchDiff`(1364)/`getCommitDiff`(1477) 三个入口，`git diff` CLI 只用来枚举变更文件和行统计（`--name-status -M -C`、`--numstat`，status.ts:1551-1562）。
- 返回类型 `GitDiffResult = GitDiffTextResult | GitDiffBinaryResult`（`src/shared/types.ts:3594`）；text 即 `{originalContent, modifiedContent}`。
- **大 diff 限制**：每侧 12 万行、合并字符 600 万（`shared/large-diff-render-limit.ts`）。

### 2.3 多文件 / 目录树导航（Combined Diff）

- **CombinedDiffViewer.tsx**：每个变更文件 = 一个 section，`@tanstack/react-virtual` 虚拟化（overscan 5）+ 自绘滚动条 + 滚动锚点恢复 + 懒加载（30s 超时 `COMBINED_DIFF_SECTION_LOAD_TIMEOUT_MS`）+ 缩进文件头。
- **4 种合并模式**（`DiffSource`，`store/slices/editor.ts:110`）：`combined-all`（全部）、`combined-uncommitted`（未提交）、`combined-branch`（分支配对）、`combined-commit`（某提交 vs 父）。`EditorContent.tsx:669` 把 `combined-*` 路由到 `<CombinedDiffViewer>`。
- **文件树侧栏**：`CombinedDiffFileTree.tsx`（含**搜索、按扩展名过滤、"仅看已核阅"** 切换 `viewedSectionKeys`），树点选 → 跳到对应 section（`combined-diff-file-tree-model.ts`、`combined-diff-file-tree-row.tsx`）。
- **每个 section** = `DiffSectionItem.tsx` → 吸顶 `DiffSectionHeader.tsx`（显示路径、+n/-n、脏标记 M、复制路径）+ `DiffSectionBody.tsx`：**`hideUnchangedRegions: { enabled: true }`**（`DiffSectionBody.tsx:201`，未修改上下文由 Monaco 折叠/可展开）。行内可直接编辑（unstaged）、段级保存（`handleSectionSave` → `writeRuntimeFile`）。
- 段级：折叠/展开全部、Inline/Side-by-side、Wrap 开关、打开该文件（`openSection`）。

### 2.4 大 diff 兜底

- `LargeDiffFallback.tsx`：超限时显示原/改行数、字符数、reason、阈值，并提供可选动作（`diff-viewer-large-diff-save-action.ts` 允许保存超限 draft）。live 重算 `diff-section-live-render-limit.ts`；大 diff 内容从存储状态剥离（`large-diff-section-content.ts`）。

### 2.5 Git 操作（Source Control / 右栏）

IPC 通道（`src/preload/index.ts` 定义，主进程 handler 在 `src/main/ipc/filesystem.ts` + `src/main/git/*`）：
`git:status` `git:diff` `git:commit` `git:generateCommitMessage` `git:cancelGenerateCommitMessage` `git:stage` `git:unstage` `git:discard` `git:bulkStage` `git:bulkUnstage` `git:bulkDiscard` `git:push` `git:pull` `git:fetch` `git:fastForward` `git:rebaseFromBase` `git:syncFork` `git:branchCompare` `git:commitCompare` `git:branchDiff` `git:commitDiff` `git:history` `git:abortMerge` `git:abortRebase` `git:upstreamStatus` `git:submoduleStatus` `git:remoteCommitUrl` `git:remoteFileUrl` `git:appendGitignore` `git:conflictOperation` `git:checkIgnored`。

- **staged / unstaged / untracked 分区**：`GitStatusEntry.area` + 状态（`shared/git-status-types.ts`、`SourceControl.tsx`、`source-control-tree.ts` 建目录树、虚拟化列表 `source-control-virtual-file-list.tsx`）。点击文件 → 打开单文件 diff tab（`openDiff(staged)`，`store/slices/editor.ts:2720`）。
- **单文件操作**：stage/unstage/discard（文件粒度，**无逐 hunk 暂存**）——eligibility `source-control-entry-actions.ts:canStage/Unstage/DiscardStatusEntry`。discard 有确认弹窗 `SourceControlDiscardDialog.tsx`（destructive 焦点默认）。
- **批量操作**：`BulkActionBar.tsx`、`discard-all-sequence.ts`（整区 stage/unstage/discard all）。
- **Commit 区（主操作状态机）**：`source-control-primary-action.ts:resolvePrimaryAction/resolveCommitAreaPrimaryAction` 有一个 **kind 阶梯：commit → stage → push → sync → publish → create_pr**，且由 `shared/source-control-primary-action-decision.ts` 决定当前应做什么；图标题 `PRIMARY_ICONS`。下拉 `source-control-dropdown-items.ts:resolveDropdownItems` 列出完整动作：Commit、Commit&Push、Commit&Sync、Push、Force Push、Create PR、Push-before-PR、Pull、Fast-forward、Sync、Rebase from Base、Fetch、Publish Branch；冲突中还会出现 **Abort merge/Abort rebase**。AI 生成提交信息 `git:generateCommitMessage`（`discoverCommitMessageModels`/`cancelGenerateCommitMessage`）。提交可用性禁用原因 `source-control-commit-eligibility.ts:resolveCommitDisabledReason`。
- **branch / commit 对比**：`openBranchDiff` / `openCommitDiff` / `openAllDiffs`（editor slice）用 `DiffSource` `combined-branch`/`combined-commit`；主进程算 merge-base（`getBranchCompare`/`getCommitCompare`）、逐文件 `getBranchDiff`/`getCommitDiff`。**base ref 选择器** `BaseRefPicker.tsx`（解析 `resolveSourceControlBaseRef`）；比较摘要带 commitsAhead 等。**强制推送/同步决策**从 `GitUpstreamStatus` 派生（`shared/git-upstream-status.ts:shouldForcePushWithLeaseForUpstream` 等）。
- **git 工具链/轮询细节**：远程操作集中在 `src/main/git/remote.ts`（`gitPush(…,{forceWithLease})`/`gitPull`/`gitFastForward`/`gitPullRebaseFromBase`/`gitFetch`/`gitSyncForkDefaultBranch`）；状态轮询单独调度（`git-status-refresh-scheduler.ts`），分支比较另设 **30 秒** `BRANCH_REFRESH_INTERVAL_MS`；`git status --porcelain=v2` 由 `shared/git-status-porcelain-parser.ts` 流式解析（区分 staged/unstaged/untracked、C-引用路径、子模块行）。工作树为中心：**切换分支 == 切换 worktree**（`worktree-listing-branch-switch.ts`/`worktrees.ts` IPC），SSH provider 的 branch picker 用 `checkout.ts:checkoutBranch/listLocalBranches`。
- **工作树管理 IPC**：`src/main/ipc/worktrees.ts`/`repos.ts`（`worktrees:list/create/remove/forceDeletePreservedBranch`、`repos:isGitAvailable/getGitUsername`），右栏 `FolderWorkspaceWorktreesPanel.tsx`。
- **提交历史图**：`GitHistoryPanel.tsx` + `GitHistoryGraphSvg.tsx`（SVG 图形）`GitHistoryRow.tsx`、提交右键菜单 `GitHistoryCommitContextMenu.tsx`（仅 open-remote / copy-hash / copy-message / explain / open-diff）。
- **显式缺失**（好做差异化）：**无 stash、无 cherry-pick、无 revert、无逐 hunk 交互暂存**（stash 仅有错误提示文案；`cherry-pick` 只是冲突操作枚举串）。

### 2.6 行内 diff 评论 / 评审批注

- `DiffComment` 模型（`types.ts:749`），`side:'modified'`，支持范围（多行）。
- `useDiffCommentDecorator.tsx`：行悬停 **"+" 加注按钮** + 拖拽选区，评论渲染为 Monaco **view zone**（`DiffCommentCard`），滚到该行居中。`DiffCommentPopover.tsx` 为撰写浮层。
- **AI 笔记/发到 AI**：`DiffNotesSendMenu.tsx`（"Send"，把 `formatDiffComments` 组装成 prompt 给 agent）、`CombinedDiffViewer` 顶栏聚合展示与复制/清空（`clearDiffComments`，确认弹窗）。
- Markdown 文件在普通编辑视图里也能加段落级评审批注（`useDiffCommentDecorator` 同样作用于 Monaco markdown；`monaco-markdown-selection-annotation`）。
- `DiffComment` 模型完整字段（`types.ts:749-770`）：`source:'diff'|'markdown'`、`selectedText`、`startLine..lineNumber` 区间、`scope`(unstaged/staged/branch)、`sentAt`、恒 `side:'modified'`；持久化在 worktree 元数据（orca-data.json）。行注释渲染为 Monaco view zone（React root per comment），支持拖拽选多行区间，滚动到该行居中。
- Commit 模式会渲染一个提交头卡片（subject + message + compareRef，`combined-diff-commit-message.ts`，`CombinedDiffViewer.tsx:1569-1604`）。

---

## 三、编辑器（Editor）

### 3.1 编辑器本体

- **Monaco**：`MonacoEditor.tsx`（`Editor` from `@monaco-editor/react`；`defaultValue` + 自管 content-sync，`keepCurrentModel`，`path={filePath}`）。
- 选项：minimap(设关)、wordWrap 默认开、行号、`renderLineHighlight:'line'`、`automaticLayout`、`tabSize:2`、`scrollBeyondLastLine:false`、smooth scroll、`find: monacoFindOptions`。
- **undo**：`monaco-content-sync.ts` 用真实 edit op 走 undoable 模式；只读 live-tail 关 undo 保留。
- **只读 / 可编辑**：`OpenFile.readOnly` 全局强制（无 autosave、无脏、回调全 noop，`EditorContent.tsx:45`、317）。
- **多视图模式**：`EditorViewToggle.tsx`（source/rich/preview/edit/changes）。CSV/Ipynb 元数据覆盖（Table/Notebook）。
- **分割 pane / 多 tab**：见第四部分 tab/split。

### 3.2 保存流程（IPC 通道 + 主进程处理）

- **Cmd/Ctrl+S**：`MonacoEditor` 装 `installEditorSaveShortcut` → `onSave` → `EditorPanel.handleSave` → `attemptEditorFileSave({fileId, fallbackContent})` → DOM 事件 **`orca:editor-save-file`**（`editor-save-events.ts`/`editor-autosave.ts`）→ `editor-autosave-controller.handleSaveFile` → `queueSave` → **`writeRuntimeFile`** → `window.api.fs.writeFile` → IPC **`fs:writeFile`**（`src/main/ipc/filesystem.ts:811`）→ `resolveAuthorizedPath` → `writeFile(path, content, 'utf-8')`。写后重基线磁盘签名、清脏、派发 `orca:editor-file-saved`。
- **Autosave**：默认 **1000ms**、可配（clamped 250–10000，`shared/constants.ts`）；`syncAutoSave` 用 `setTimeout` + 逐文件保存队列 + save generation 去重；`editor-self-write-registry` 打标，使自身写入不被当成外部改动。仅 `mode==='edit'` 与 `diffSource==='unstaged'` 可 autosave；**readOnly / combined-diff / conflict 不可**。
- **外部改动挂起保存**：`isAutosaveSuspendedForFile`（`externalMutation==='changed'` 或待验基线）→ 需先解决冲突/banner。
- **Hot exit 脏文件插队保存**：`orca:editor-save-dirty-files` / `orca:editor-prepare-hot-exit`（重启/更新前落盘所有脏文件）；save+close 用 `orca:save-and-close`。
- **删除/重命名前 quiesce**：`requestEditorSaveQuiesce`（`orca:editor-quiesce-file-saves`）等未保存写完成后才做 git mutation。
- 远程运行环境：`writeRuntimeFile` 走 runtime **RPC `files.write`**；本地/SSH 走 `fs:writeFile`。截断/预览文件会被拒编辑。
- 新建：`fs:createFile`（原子 `'wx'` 防覆盖）；`fs:createDir/rename/copy/deletePath(trash)`。
- **未命名文件**：`isUntitled` + `UntitledFileRenameDialog.tsx`/`useUntitledFileRename`（保存先弹重命名）。

---

## 四、其他亮点（值得借鉴）

- **文件树（完整文件管理器）**：`FileExplorer.tsx` + `FileExplorerVirtualRows.tsx` + `file-explorer-entries.ts`。`@tanstack/react-virtual` 虚拟化（~26px 行、overscan 20）、**逐目录懒加载** dirCache（仅根目录先加载，展开才取子目录，`FileExplorerDirLoadTracker`）、**名称/隐藏/gitignore 过滤**（`FileExplorerNameFilter.tsx`、`use-file-explorer-ignored-paths.ts`）、**全文搜索**（见下）、**拖拽/导入/复制/删除(回收站)/重命名/撤销重做**（`useFileExplorerDragDrop/Import/InlineInput/Duplicate/Delete`、`fileExplorerUndoRedo.ts` 50 步上限，dnd-kit 实现）、**背景菜单**（`FileExplorerBackgroundMenu.tsx`"Add as Project"）、**auto-reveal**（`useFileExplorerAutoReveal`）、键盘导航（`useFileExplorerKeys`）、多项目（`file-explorer-add-project-action.ts`）、实时 watcher 更新（`useFileExplorerWatch`）、`FileExplorerTreeStatus` loading/empty 态。
- **全文搜索**（真正的代码搜索，非文件名）：`useFileSearchPanel.ts`/`useFileSearchRunner.ts`（防抖）。默认引擎 **ripgrep (`rg`)**（`checkRgAvailable`/`buildRgArgs`/`ingestRgJsonLine`），无 `rg` 回退 **`git grep`**，SSH 走 `mux.request('fs.search')`、远程走 RPC `files.search`。结果 UI `SearchResultsPane.tsx`/`SearchResultItems.tsx` + `SearchFilters.tsx`（大小写/文本过滤），自带虚拟化；点击结果在**匹配行**打开文件（`search-match-open.ts`）。
- **Tab / 分割**：统一 `Tab`/`TabGroup` 模型（`tab-bar/`、`tab-group/`）。dnd-kit 排序（`SortableTab.tsx`）、`TabDragPreview`、**TabGroupSplitLayout 二叉布局树**（`TabGroupLayoutNode {leaf|split/direction/ratio}`，跨列拖拽分割 `TabPaneColumnSplitDragOverlay.tsx`）、`useTabGroupWorkspaceModel`、`TabGroupPanel`、最近使用切换 `RecentTabSwitcher.tsx`（**Ctrl+Tab MRU 悬浮层**）、`tab-drop-zone` 放置。tab 类型：editor/terminal/browser/web-runtime。**重命名 tab** `tab.rename`(Mod+R)、中键关闭（`onAuxClick` button 1）、拖拽自动滚动、溢出箭头导航。
- **快捷键**（可重绑定，`shared/keybindings.ts`）：`editor.save`(Mod+S) `editor.find`(Mod+F) `editor.replace`(Mod+Alt+F / win-linux Mod+H) `editor.markdownPreview`(Mod+Shift+V) `editor.copyContext`(Mod+Alt+C) `editor.nextChange`(F7) `editor.previousChange`(Shift+F7) `editor.addReviewNote`(Mod+Shift+A) `zoom.in/out/reset`(Mod±/Mod+0) `tab.rename`(Mod+R)，外加文件搜索/应用切换等；Terminal 单独 keymap。
- **差异比较入口路线**：source-control 树 → 单击单文件 diff；→ CombinedDiff（全部/未提交/分支/提交）；→ Changes 模式（编辑中文件就地看 diff）。
- **空/加载/错误态**：`FileLoadErrorView`、`EditorLoadingFallback`、`LargeDiffFallback`、`RichMarkdownErrorBoundary`、`ExternalFileChangeBanner/CompareDialog`、"No changes"/"Loading diff..."/"Binary file changed"、"Conflicted files are reviewed separately"。
- **富文本与数学**：TipTap 富 Markdown（表格/任务列表/details/数学@tiptap 扩展）、KaTeX、`MarkdownTableOfContentsPanel`（目录侧栏）。
- **worktree 管理**：右栏 worktree 切换（`FolderWorkspaceWorktreesPanel.tsx`、`folder-workspace-attached-worktrees.ts`），源代码/分支配对围绕 worktree；diff 全部以 worktree 为单位隔离评论（`worktree-diff-comments-selector`）。
- **跨平台 shell 能力**：`shell:openInFileManager`(Finder)/`openInExternalEditor`(含远程)/`openPath`；文件/目录/图片/音频选择器、`copyFile`。

---

## Orca 特有、我们大概率没有的 Top 10 功能

1. **Changes 模式**：把仍处于"编辑"标签的未提交文件就地渲染成 workTree-vs-HEAD diff 且保留原 draft 管线（autosave/dirty/关闭提示全兼容）——`ChangesModeView.tsx`、`editor-panel-render-model.ts`。
2. **CombinedDiff 四模式 + 文件树侧栏 + 虚拟化 section**：一次看整包变更（全部/未提交/分支/提交），逐文件 section 懒加载+滚动锚点/自绘滚动条+文件树搜索与过滤——`CombinedDiffViewer.tsx`、`CombinedDiffFileTree.tsx`。
3. **Monaco DiffEditor 内联编辑未提交 diff**：unstaged 的 modified 侧可直接改并保存，改后实时重算 live-render-limit——`DiffViewer.tsx`、`DiffSectionItem.tsx`。
4. **行内 AI 评审批注**：diff 行/view-zone 评论 + "Send to AI" + 聚合复制/清空——`useDiffCommentDecorator.tsx`、`DiffNotesSendMenu.tsx`、`formatDiffComments`。
5. **Rich(markdown 富文本) / Preview / Source 三态同文件多 pane**：rich=TipTap、preview=react-markdown+KaTeX+GFM+目录、跳转 internal link 开新 pane——`RichMarkdownEditor.tsx`、`MarkdownPreview.tsx`。
6. **完整文件管理器式文件树**：拖拽/导入/复制/删除/重命名/撤销重做/背景菜单"加项目"/全文搜索(rg)/ignore 过滤——`FileExplorer.tsx` + 一组 `useFileExplorer*`。
7. **外部改动检测全链路**：文件 watcher → changed-on-disk banner + 对比弹窗，并自动 quiesce 挂起保存——`useEditorExternalWatch.ts`、`ExternalFileChangeBanner.tsx`、`notifyEditorExternalFileChange`。
8. **内置图片/PDF/CSV/ipynb/Mermaid 专项查看器**：图片 0.25–8× 锚点缩放+popup、PDF pdfjs+搜索、CSV 虚拟化表格、ipynb 运行 Python 格、Mermaid 渲染——整套 `ImageViewer/PdfViewer/CsvViewer/IpynbViewer/MermaidViewer`。
9. **大 diff 安全上限与兜底动作**：12 万行/600 万字符限制，超限展示详细原因并可"保存超限 draft"——`large-diff-render-limit.ts`、`LargeDiffFallback.tsx`、`diff-viewer-large-diff-save-action.ts`。
10. **细颗粒行级工具 + 键盘导航**：gutter 右键"复制路径到行/相对路径/远程URL"、F7/Shift+F7 跳变更、行号窗、可重绑定 keymap、Copy Path——`MonacoGutterContextMenu.tsx`、`editor-shortcuts.ts`、`diff-navigation-context.tsx`。
