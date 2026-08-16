# 右栏查看器类前端库调研（2026-08）

> 目标：给 sidebar 的「展示各种内容」找最合适的前端库，避免重复造轮子。
> 范围：不局限于 @pierre 作者，扩散调研 diff 视图、代码查看/编辑、文件预览、专项查看器、代码审查整包。

## 0. 结论速览

1. **diff / 代码渲染赛道，@pierre/diffs 目前是最完整的库，我们当前的选择正确。**
   它自带的 `CodeView` / `MultiFileDiff` / `Virtualizer` / `EditContext`(编辑器 beta) /
   annotation（评论/标注框架）/ merge-conflict 处理 / accept-reject / worker 池高亮 /
   流式 tokenize 等能力，足以覆盖我们右栏 diff + 文件查看 + 编辑三大领域的大部分需求。
   下一步应该「吃透它的能力」而不是自己重写。
2. 我们目前**自定义的多文件 diff 堆栈**（multi-diff-file-stack.tsx）可以用官方的
   `MultiFileDiff` + `Virtualizer` 替换掉大部分逻辑。
3. 专项补充（pierre 不覆盖的）：Markdown 渲染、图片查看、CSV 表格、ipynb —— 用成熟专项库。
4. 若要换备胎：diff 领域最强替代是 `git-diff-view`（GitHub 风格、多框架、732★）；
   纯大文件双栏对比可看 `react-virtualized-diff`（133★）。
5. Office/PDF 一体化的 `react-doc-viewer` / Flyfish file-viewer 偏文档场景、体积大，
   不适合我们以代码为中心的主包，不建议引入。

## 1. @pierre 作者（The Pierre Computer Company）的其它库

- 作者：**The Pierre Computer Company**（https://pierre.computer），monorepo：
  https://github.com/pierrecomputer/pierre （5937★，Apache-2.0，活跃维护）
- 作者已公开的其它库（全部围绕「代码展示/主题」生态）：
  - `@pierre/theme`：Pierre 配色主题（VS Code / Zed / Shiki 通用，MIT）
  - `@pierre/theming`：主题管理（跟随 @pierre/theme）
  - `@pierre/icons`：SVG 图标（diff UI sprite 来源）
  - 独立仓库 `pierrecomputer/theme`（58★）、`pierrecomputer/icons`（14★），org 共 7 个公开仓库
- 结论：作者没有做「文件浏览器/文件树/图片查看」类库，他的专精就是 **diff + 代码渲染 + 编辑器**。

## 2. @pierre/diffs 完整能力清单（1.3.5，我们在用）

来源：README + diffs.com 文档 + dist 导出符号。

### 2.1 高层组件（@pierre/diffs/react）
- `FileDiff` / `VirtualizedFileDiff`：diff 视图（split/unified 两种布局，虚拟滚动版）
- `File` / `VirtualizedFile`：单文件代码查看（虚拟滚动）
- `MultiFileDiff`：**多文件 diff 官方组件**（我们自研的 multi-diff-file-stack 可被它替代）
- `PatchDiff`：直接吃 git patch 文本
- `CodeView`：多文件/多 diff 协调视图（行选中、滚动同步、自定义 footer/header slot）
- `UnresolvedFile`：**merge conflict 渲染 + 解决交互**（accept ours/theirs/both）
- `EditContext` / `DiffsEditor` / `EditableInstance`：**内置编辑器（beta）**，可在 File/FileDiff 上懒加载
- `Virtualizer`：虚拟滚动核心
- `WorkerPoolContext`：**worker 池做 tokenize/高亮**（大文件不卡主线程）

### 2.2 能力细节
- 语法高亮基于 **Shiki**（主题/语言全继承），自定义主题/语言/字体、font-feature-settings
- **annotation 框架**：行级注释/标注注入（这正是「diff 评论」的官方实现）、annotation 元素定制
- **accept/reject hunk**：`diffAcceptRejectHunk` + 配置（AI 代码接受/拒绝 UI 直接可用）
- 行选择/范围选择、点击/悬停行事件、上下文折叠展开（hunk 展开阈值）
- `ScrollSyncManager`、`ResizeManager`、滚动定位（行/范围/位置）
- **流式 tokenize**：`ShikiStreamTokenizer` + `shiki-stream`（大文件增量高亮）
- `FileStream`：文件流式渲染
- SSR 支持（`@pierre/diffs/ssr`）、web-components（vanilla JS 版）、`@pierre/diffs/worker`
- 文件类型探测（`EXTENSION_TO_FILE_FORMAT`）、merge conflict 正则解析

### 2.3 我们尚未用上、值得接入的
| 能力 | 用途 | 对应我们现状 |
|---|---|---|
| `MultiFileDiff` | 替换自研 multi-diff-file-stack 主体 | 自研 stack（正在进行中） |
| `EditContext` 编辑器 | 替代/简化自研编辑器面 | 已有编辑器 + 自动保存 |
| annotation 框架 | diff 行评论 | 已自研持久化行评论（可对齐官方实现） |
| accept/reject hunk | AI 改动接受/拒绝 | 未做 |
| `UnresolvedFile` + merge conflict | 冲突解决 UI | 未做 |
| `Virtualizer` 大文件虚拟滚动 | 万行文件/diff 性能 | 部分 |
| worker 池高亮 | 大文件不卡 UI | 未接入 |

## 3. 扩散调研：替代/补充候选

### 3.1 diff 视图库
| 库 | Stars | 特点 | 对比结论 |
|---|---|---|---|
| `@pierre/diffs` | 5937(monorepo) | 最全：虚拟化+worker+编辑+标注+冲突 | ✅ 当前最优 |
| `@git-diff-view/react`（MrWangJustToDo/git-diff-view） | 732 | GitHub 风格，split/unified，**React/Vue/Solid/Svelte 多框架**，高性能 | 最强备胎；要多框架渲染时可用 |
| `otakustay/react-diff-view` | 1013 | 老牌，吃 unified diff 输出 | 2017 年起，风格旧，功能少 |
| `diff2html` | 3395 | 成熟，diff→HTML | 无虚拟化、无交互标注，适合静态渲染 |
| `react-virtualized-diff` | 133 | 专攻大文件双栏对比 | 轻量专项，可做参考 |

### 3.2 代码查看/高亮
- `react-shiki`（AVGVSTVS96，532★）：Shiki hook/组件，轻量高亮（pierre 已内置同能力，不需要）
- Nimbus Code 组件（shiki transformer：行号/高亮/diff/焦点标注）：思路可参考
- `uiwjs/react-textarea-code-editor`（567★）：textarea+高亮编辑器，极轻（对简单编辑够用）

### 3.3 编辑器
- **@pierre/diffs 自带 editor（beta）**：与 diff/file 视图同构，懒加载 —— 优先评估
- CodeMirror 6 / Monaco：重武器（主包体积大，需 chunk-loader），已被 pierre 替换
- `md-editor-rt`（6.5.x）：**Markdown 专用编辑器+预览**（主题/图片上传/全屏）
- `@uiw/react-markdown-editor`：Markdown 编辑器备选

### 3.4 文件预览一体化（Office/PDF 向）
- `react-doc-viewer`（mehuljariwala）：PDF/DOCX/XLS/PPT/Markdown/图片/视频/CSV 20+ 格式
- Flyfish file-viewer（file-viewer.app）：Office/PDF/CAD/XMind/压缩包/邮件，浏览器原生渲染
- `wh131462/file-preview`、`multi-file-viewer`、`xushanpei/open-file-viewer`：同类
- 结论：**偏文档类，体积大，与我们代码为主场景不匹配**；如未来要 Office 预览再单独 chunk 引入

### 3.5 Markdown / 图片 / 表格 / notebook 专项
- Markdown 渲染：`react-markdown`（15.8k★）+ rehype 插件（GFM、KaTeX、Mermaid）—— 现状保持
- Mermaid：`mermaid` 包懒加载（现状保持）
- 图片查看：轻量 `react-zoom-pan-pinch` 或浏览器原生 + 缩放按钮（够用即可，不建议 lightbox 全家桶）
- CSV 表格：Virtuoso（@virtuoso.dev/data-table，已有 skill）+ TanStack Table 组合（现状保持）
- ipynb：无强势 React 渲染库（jupyter 官方渲染器是 jupyterlab 全家桶，过重），保持自研轻量解析 + 代码块展示

### 3.6 代码审查整包（app/组件级，可参考架构不直接引）
- `backnotprop/plannotator`（7320★）：diff 标注审查 app，可借鉴交互设计
- `kne-union/code-review`：React 组件（文件树导航+虚拟滚动+多格式预览）—— 与我们需求最接近的组件库
- `oxidecomputer/skepsis`（116★）：本地 web 代码审查 UI
- `gofixpoint/amika` 的 `@amika/reviews`：diffs/trees UI 库
- `giovacalle/codepane`：React 文件浏览器+编辑器（性能优先）

## 4. 行动建议

1. **短期**：把自研 multi-diff-file-stack 换成官方 `MultiFileDiff`（+`virtualize={false}` 或内层 Virtualizer），删除重复代码。
2. **中期**：接入 `EditContext` 编辑器替代自研编辑器面；用 annotation 框架对齐 diff 行评论实现；加 accept/reject hunk UI（配置现成）。
3. **按需**：merge conflict UI 用 `UnresolvedFile`；大文件场景接入 WorkerPoolContext。
4. 主包不新增重型依赖；Markdown/图片/CSV/ipynb 维持现有专项库方案。

### 4.1 落地状态（2026-08-16 更新）

| 建议 | 状态 | 说明 |
|---|---|---|
| 用官方 MultiFileDiff 替换自研堆栈 | ✅ 完成（变体 b27ac7c + f17ede0） | 根因是 buildPatch 对 review 文档不生成 @@ hunk 头 → Pierre 解析 0 行。修复后堆栈与 commit 列表直接走 virtualize={false} 自然高度 Pierre 渲染（每块全量渲染、外层列表滚动），无需 MultiFileDiff 重构；rawOnly 已彻底移除，RawDiff 仅作 patch 解析失败降级 |
| File 组件替代 Prism 文本查看 | ✅ 完成（034b7e8） | 文本/markdown 源码走 Pierre File + Virtualizer；Prism 依赖已删；>250k 字符/未知语言保留 plain 降级 |
| 编辑器用 @pierre/diffs File+Editor | ✅ 完成（b909972） | 替代 CodeMirror chunk |
| diff 行评论 → annotation 框架 | ✅ 完成（bdbd768） | lineAnnotations + renderAnnotation 一套评论覆盖 diff + 文件查看 + 编辑器；行号点击预填评论表单 |
| merge conflict UI 用 UnresolvedFile | ✅ 完成（a0da345） | 冲突文件（UU/AA/DD）打开专用 surface；accept current/incoming/both → 原子写 + git stage + 切回文件视图 |
| worker 池高亮 | ✅ 完成（5e3f21e） | 修复 import.meta 在 cjs bundle 中为空导致 worker 加载失败的问题：worker 独立 ESM chunk（client-pierre-worker.js）+ bundle-route 白名单 |
| accept/reject hunk | ❌ 暂不做 | 用户明确先不接 |
| @pierre/trees | 👀 观察 | 尚未发布 npm |

### 4.2 已知库边界（踩坑记录）

- react 包装器对 `UnresolvedFile` 不 hydrate 原始 `file`：`instance.resolveConflict().file.contents` 恒为空 —— 用纯函数（merge-conflict-resolve.ts）按库的分割语义重建解析后内容。
- `UnresolvedFile` 的 `onMergeConflictResolve` 与 react 包装器内置的 `onMergeConflictAction` 互斥（后者必装）；解析按钮走 `renderMergeConflictUtility` + `handleMergeConflictActionClick`（运行时公开、.d.ts 标 private）。
- react `File`/`FileDiff` 渲染进 `diffs-container` 的 shadow root —— CDP 验证必须查 shadowRoot，光查 light DOM 会误判为空渲染。
- 自然高度（无 Virtualizer）的 FileDiff 容器测出 0×0，渲染循环不启动 —— 堆叠场景必须每块定高 Virtualizer 或官方 MultiFileDiff。

## 5. 参考链接
- @pierre/diffs 文档：https://diffs.com/docs ；编辑 beta：https://diffs.com/edit
- 作者 monorepo：https://github.com/pierrecomputer/pierre
- 渲染 diff 原理文章：https://pierre.computer/writing/on-rendering-diffs
- git-diff-view：https://github.com/MrWangJustToDo/git-diff-view
- react-doc-viewer：https://github.com/mehuljariwala/react-doc-viewer
- react-virtualized-diff：https://github.com/zhang-jiahangh/react-virtualized-diff
- kne-union/code-review：https://github.com/kne-union/code-review
- plannotator：https://github.com/backnotprop/plannotator
