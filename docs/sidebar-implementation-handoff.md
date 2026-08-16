# Oh-DSH 右栏完整性实现 — 上下文交接文档

> 本文档是**自包含**的交接文件：新会话仅凭本文件 + 仓库即可开始实现，无需回溯本会话历史。
> 配套文档（都在仓库 `docs/` 下，按需阅读）：
> - `docs/sidebar-complete-development-plan.md` —— **完整开发计划（P1-P9，本交接的执行主线）**
> - `docs/sidebar-feature-gap-analysis.md` —— 三项目差距清单（Synara × Orca × 我们）
> - `docs/orca-right-sidebar-research.md` —— Orca 功能完整证据版（`文件路径:函数` 标注）
> - `docs/synara-port-exploration.md` —— Synara 早期移植记录（ListRow/缓存/中间 Tab/Diff 基座）
> - `docs/sidebar-development.md` —— 插件开发规范

---

## 1. 项目是什么

**Oh-DSH-Desktop**：基于 DeepSeek Harness（DSH）的 Electron 桌面应用。右栏 sidebar 是核心功能区（文件树 / Git / diff / 终端 / 设置），我们的工作目标是把右栏做成**完整可用的文件查看 + diff 查看 + 编辑**体验，对齐两个参考项目（Synara、Orca）的全部优势。

- 仓库：`/Users/verger/code_source/front_end/important_project/oh-dsh-desktop`
- 分支：`main`（本地领先 `origin/main` 9 个 commit，**未推送**）
- 开发启动：`OH_DSH_ELECTRON_ARGS='--remote-debugging-port=9222' pnpm run dev`（watch 模式）
- 构建/部署链：`pnpm build` → `pnpm stage:dsh` → dev（或 dist:mac）
- 类型检查：`pnpm typecheck`（tsc --noEmit + sidebar-host 独立 tsconfig）
- 单元测试：`pnpm test`（`node --test tests/*.test.ts`，纯 node 无浏览器）

## 2. 插件架构（拆分后的现状，勿改结构）

右栏已拆分为 4 个可独立分发的 DSH 插件（本次工作全部在其中）：

| 包 | 目录 | 角色 |
| --- | --- | --- |
| `@oh-dsh/shared` | `plugins/shared/` | 能力层：`git-core.ts`（git 实现）、`fs-tree.ts`、`wire.ts`、`prefs-shared.ts`、`desktop-contracts.ts`（DesktopBridge 契约）、`sidebar-api.ts`（SIDEBAR_API_BASE=`/sidebar/api`）、`list-row.tsx`（行原语族）、`i18n.ts`、`icons.tsx`/`tabler-icons.tsx`、`theme.css` |
| `@oh-dsh/sidebar` | `plugins/sidebar/` | **通用侧栏（本次工作主体）**：client 端文件查看 / diff / Git / 设置 |
| `@oh-dsh/sidebar-host` | `plugins/sidebar-host/` | vendor 的 DSH-better-sidebar Host：`/sidebar/api` 后端（fs/git/settings/pty/jobs）、bundle 懒加载路由 |
| `@oh-dsh/sidebar-desktop` | `plugins/sidebar-desktop/` | Electron 增强：webview/BrowserView、DesktopBridge client、browser surface |

### 关键文件索引（sidebar 插件）

**文件查看**（`plugins/sidebar/src/client/files/`）：
- `content-viewer.tsx` —— 类型分发（text/csv/markdown/html/image/pdf/binary）+ ReactMarkdown 渲染
- `syntax-highlight.ts` —— Prism 高亮（17 语言：ts/js/jsx/tsx/json/md/yaml/bash/python/sql/diff/go/rust/java/css/html）
- `file-viewers.tsx` —— TextFileViewer / BinaryFileViewer / HtmlFileViewer

**diff**（`plugins/sidebar/src/client/diff/`）：
- `diff-viewer.tsx` —— 统一 diff 渲染（Pierre worker + RawDiff 结构化行渲染，rawOnly 时行可点击）
- `file-diff.ts` —— DiffDocument 模型（行 kind：context/added/removed/hunk；`DiffLayoutStyle = 'unified' | 'split'`；buildPatch/buildDiffDocument）
- `pierre-adapter.tsx` —— @pierre/diffs worker 适配（unified diff 高亮）

**中间 surface**（`plugins/sidebar/src/client/surfaces/`）：
- `center-surface-store.ts` —— 中间 tab 状态（file/diff/diff-all/commit/commit-file/committed/browser）
- `types.ts` —— surface 类型与 id 助手
- `renderers.tsx` —— FileSurfaceView / DiffSurfaceView / DiffAllSurfaceView（多文件 details 堆叠）/ CommitDiffSurfaceView / CommitFileSurfaceView / CommittedSurfaceView
- `center-surface-host.tsx` / `surface-renderer-registry.tsx` / `center-surface.css`

**Git 面板**（`plugins/sidebar/src/client/`）：
- `workspace-panel.tsx` —— 变更列表 + commit 区 + committed 区（**独有优势**）+ history（30 条）+ 目录
- `source-control/` —— source-control-panel / tree / view-model / css
- `better-sidebar-api.ts` —— client API（fs.read/tree、git.*、settings.*）
- `runtimes/` —— explorer-runtime / source-control-runtime / file-runtime / registry（ScopedRuntimeRegistry）/ chrome-store
- `sidebar-storage.ts` —— localStorage 偏好；`sidebar-preferences.ts`；`plugin.tsx`（surface 注册 + 设置注入）

**Host**（`plugins/sidebar-host/src/index.ts`）：
- `buildApi` 内的路由：`fs.tree/read/write`、`git.status/diff/stage/unstage/commit/branch/checkout/log/commit-diff/commit-files/commit-file-diff/committed-files/committed-diff/discard/revert/cherry-pick/show/worktree-list/worktree-add`、`settings.get/update`、pty/jobs
- `fs.write` 为原子写（tmp + rename）——**编辑器保存通道已就绪**
- `bundle-route.ts` —— chunk 白名单（新增重依赖 chunk 需在此登记）+ `chunk-loader.ts`（client 侧）

## 3. 参考项目（只读参考，勿修改）

- **Synara**：`/Users/verger/orca/workspaces/synara-official-replay-e87742-20260709/agent-driver-refactor`，前端 `apps/web-next/src/`（features/file-viewer、features/source-control、components/file-viewer、components/markdown、components/path-tree）
- **Orca**：`/Users/verger/code_source/front_end/important_project/myade/orca`，UI `src/renderer/src/components/editor/`（MonacoEditor、CombinedDiffViewer、RichMarkdownEditor、MarkdownPreview、ImageViewer、PdfViewer、CsvViewer、IpynbViewer、diff-comments/）

## 4. 调研结论速览（详见差距分析文档）

- **Synara 强**：Markdown Source/Preview 双视图（per-tab 持久化 + 任务清单勾选写盘）、Shiki 双主题（HTML 缓存防闪烁）、多文件 diff 左树右栈（PathTreeNav + MultiDiffFileStack + 懒加载 25/80/2000 性能策略）、git 四区（conflict/staged/unstaged/untracked）、大文件分级兜底（1MB 截断禁写/20k 行去行号/250k 字符）、PDF toolbar、复制行引用 `path:line-line`、路径操作菜单。**无内置编辑器、无 committed diff**。
- **Orca 强**：Monaco 编辑器（autosave 1s/外部变更检测/hot exit/未命名重命名）、Monaco DiffEditor（折叠未改区、unstaged 可编辑、F7 导航）、CombinedDiff 四模式（all/uncommitted/branch/commit）+ 文件树（搜索/过滤）+ 虚拟化、Markdown 三态（source/rich(TipTap)/preview(TOC+KaTeX+mermaid+搜索)）、图片查看（0.25-8× 缩放）、PDF 查找、CSV 虚拟化（10 万行）、ipynb（可运行 Python 格）、Mermaid、diff 评论（view-zone + Send to AI）、大 diff 兜底（12 万行/600 万字符）、文件树（拖拽/撤销/全文搜索 rg）、Changes 模式。
- **我们独有**：committed/unpushed diff 视图、DSH 会话集成、`fs.write` 原子写通道。**保留并增强，勿删。**

## 5. 完整开发计划（执行主线）

见 **`docs/sidebar-complete-development-plan.md`**（P1-P9 全部任务 + 技术选型 + 里程碑）。要点：

- **P1 文件查看**：Markdown 双视图 + 任务勾选写盘、文件头 chrome、大文件兜底、PDF 工具栏、图片三态、CSV 吸顶、二进制细分、复制行引用、读缓存 LRU
- **P2 diff 查看**：多文件左树右栈、懒加载性能策略、Unified/Split+WordWrap 工具栏、**上下文行展开**、**图片 diff**、blocked 态细分、大 diff 兜底、diff 右键菜单、F7 导航
- **P3 编辑器**（最大块）：CodeMirror 6 懒加载、editor surface、Cmd+S + autosave + 脏状态、未命名重命名、unstaged diff 直接编辑、Changes 模式
- **P4 Markdown 三态**：source/rich(TipTap)/preview + TOC/KaTeX/mermaid/搜索/frontmatter
- **P5 diff 评论**：行悬停加注、拖拽选区、持久化、Send to AI、聚合面板
- **P6 git 增强**：四区、批量+确认计划、分支对比（BaseRefPicker）、历史图、主操作状态机、AI 提交信息
- **P7 文件树**：fs.create/rename/delete/copy（host 扩展）、全文搜索（rg→git grep）、FilenameLabel
- **P8 专项查看器**：ipynb、Mermaid、CSV 虚拟化、live-tail
- **P9 打磨**：快捷键体系、状态统一、toast、虚拟化/缓存统一、外部变更检测、冲突解决

## 6. 技术选型（已定，按此执行）

| 领域 | 选型 |
| --- | --- |
| 源码编辑器 | **CodeMirror 6**（懒加载 chunk；Monaco 10MB 备选，P3 开头 spike 验证 DSH 兼容后再定） |
| diff 渲染 | 保留 **Pierre + rawOnly 行渲染**，自研展开上下文/行操作 |
| Markdown | react-markdown + remark-gfm/math + rehype-katex + rehype-highlight（复用 Prism）+ mermaid 懒加载 |
| 富文本 | **TipTap**（懒加载 chunk；先 source+preview 后 rich） |
| 语法高亮 | Prism + **HTML 缓存防闪烁**（Shiki 双主题可选升级） |
| 虚拟化 | **@tanstack/react-virtual** |
| 图标 | tabler-icons（现状） |
| PDF | pdfjs-dist（现状内嵌 + 补工具栏） |

体积纪律：**每个重依赖一个 chunk**，`bundle-route.ts` 白名单登记 + `chunk-loader.ts` 加载；主 client.js 体积不再增长（当前 sidebar-desktop/client.js ~976KB 已偏大）。

## 7. 验证纪律（每阶段必做）

1. `pnpm typecheck` 通过（含 `tsc --noEmit -p plugins/sidebar-host/tsconfig.json`）
2. 纯逻辑（解析/树构建/diff 文档/评论模型）加单元测试：`pnpm test`
3. **CDP 手测**（正确方式，勿用 document.body.innerText）：
   - 启动：`OH_DSH_ELECTRON_ARGS='--remote-debugging-port=9222' pnpm run dev`（后台）
   - 检查：`chrome-use --cdp 9222 snapshot -i`（accessibility snapshot 是唯一可靠方式）
   - 交互：`chrome-use --cdp 9222 click @eN` / `eval "JS"`
   - **host bundle 改动必须重启 Electron**（dev.mjs 只对 main.js/preload.cjs/splash.html 自动重启；client 改动热重载）
4. 验收后提交（conventional commits，逻辑拆分，docs 不混入代码 commit）

## 8. 当前 git 状态（交接时点）

- 本地 `main` 领先 `origin/main` 9 个 commit（全部**未推送**，用户要求先不推）
- 未跟踪（勿提交进代码 commit）：`docs/sidebar-code-audit.md`、`docs/sidebar-development.md`、`docs/sidebar-distribution-plan.md`、`docs/sidebar-structure-plan.md`（可归入独立 docs commit）
- 最近 commit：`b018d9d fix(sidebar): prevent horizontal scrollbar in commit history list`
- 环境注意：参考项目只读；`node_modules` 已装好；pnpm 10 + node 22（有 engine warning，非阻塞）

## 9. 已知约束与坑

- **dev.mjs 行为**：watch 到 plugins 变化 → rebuild + sync 到 `.stage/dsh-runtime`；**只有** Electron main 产物变化才自动重启 Electron，**host bundle（sidebar-host）改动需手动重启**（kill 后台 job 后重新 `pnpm run dev`，或 kill electron 后重启）
- **surface 注册**：新 surface kind（如 `editor`）需在 `centerSurfaceRendererRegistry.register`（plugin.tsx）+ `center-surface-store`（id 助手/open 方法）+ `types.ts`（联合类型）三处同步
- **client API 新增**（如 fsWrite）：`better-sidebar-api.ts` 加方法 → host `buildApi` 加路由（`cwdOf`/`requireString` 助手）→ 两端同步
- **i18n**：所有新文案进 `client/i18n.ts` 的 WORKSPACE_MESSAGES（zh/en 双份）
- **CSS**：样式进 `client/sidebar.css` 或各子目录 css，用 `--oh-dsh-*` token 阶梯（勿硬编码像素）
- **行原语**：列表行用 `shared/list-row.tsx`（ListRow 族），不要另造行样式
- 参考项目里有现成实现（如 Synara 的 middle-truncate-text、Orca 的 markdown-toc）可照抄思路，但**必须适配 DSH 环境**（无 Node fs、无 zustand 依赖时可自研 useSyncExternalStore）

## 10. 下一步（新会话的起点）

1. 读 `docs/sidebar-complete-development-plan.md`（主线）+ 本文档
2. 从 **P1.1/P1.2（文件头 chrome + Markdown Source/Preview 双视图）** 开始
3. 每完成一个 P 阶段任务：typecheck → 单测 → CDP 手测 → 提交（conventional commit）
4. 遇到选型分叉（尤其 P3 编辑器 CodeMirror vs Monaco）先做最小 spike 再定
