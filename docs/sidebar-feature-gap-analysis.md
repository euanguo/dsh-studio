# 右栏功能差距调研报告（Synara × Orca × Oh-DSH Sidebar）

> 状态：**调研完成**（两份 subagent 报告 + 一手代码核验已合并）。
> 参考项目：
> - **Synara**（agent-driver-refactor）：本地优先 AI 桌面应用，前端 `apps/web-next/src/`
> - **Orca**（myade/orca）：AI 编排桌面应用（Electron + React），UI `src/renderer/src/components/editor/`
> - 详细分报告：`docs/synara-port-exploration.md`（早期移植）、`docs/orca-right-sidebar-research.md`（本次 Orca 完整调研）
> 目标：把 Oh-DSH 右栏 sidebar 从「基础可用」提升为「完整可用」——文件查看、diff 查看、编辑三个领域。

## 0. 一句话结论

| 项目 | 文件查看 | diff 查看 | 编辑 |
| --- | --- | --- | --- |
| **Synara** | 强（Shiki 双主题 / Markdown 双视图 / PDF 内嵌 / 大文件分级兜底） | 强（多文件左树右栈 + 懒加载性能策略 / 四区 git 面板） | **无内置编辑器**（只读 + 外部编辑器） |
| **Orca** | 极强（Monaco 查看器 / 图片缩放 / PDF 查找 / CSV 虚拟化 / ipynb / Mermaid） | 极强（Monaco Diff / CombinedDiff 四模式 + 文件树 / 可编辑 unstaged / diff 评论） | 极强（Monaco + autosave + 外部变更检测 + hot exit） |
| **Oh-DSH** | 基础（Prism 17 语言 / Markdown 仅渲染 / PDF 裸内嵌） | 基础（Pierre / details 堆叠 / **committed diff 独有**） | **无**（host `fs.write` 通道已就绪） |

**我们的独特优势**（两个参考项目都没有）：committed/unpushed diff 视图（Synara 明确缺失，Orca 只有 commit-vs-parent）、DSH 原生会话/工作区语义、原子写盘通道（fs.write tmp+rename）。

---

## 1. 我们的现状（Oh-DSH Sidebar）

### 1.1 文件查看（`plugins/sidebar/src/client/files/`）
| 能力 | 现状 | 文件 |
| --- | --- | --- |
| 文本 + 行号 | ✅ Prism 高亮（17 语言）+ CSS 行号 | content-viewer.tsx / syntax-highlight.ts |
| CSV/TSV | ✅ 表格（quoted 解析，500 行截断） | content-viewer.tsx |
| Markdown | ⚠️ 仅 ReactMarkdown 渲染，无 Source/Preview 双视图、无编辑 | content-viewer.tsx |
| HTML | ✅ iframe 沙箱 | file-viewers.tsx |
| 图片 | ⚠️ 裸 img，无缩放/弹出 | content-viewer.tsx |
| PDF | ⚠️ 裸内嵌，无工具栏/缩放/查找 | content-viewer.tsx |
| 二进制 | ⚠️ 占位「打开外部」 | file-viewers.tsx |
| 大文件 | ❌ 无截断/降级策略 | — |

### 1.2 diff 查看（`plugins/sidebar/src/client/diff/` + `surfaces/`）
| 能力 | 现状 | 文件 |
| --- | --- | --- |
| 单文件 diff | ✅ Pierre worker，unified/split 参数 | diff-viewer.tsx / pierre-adapter.tsx |
| word wrap | ✅ 参数支持（无 UI 切换） | diff-viewer.tsx |
| 多文件 diff | ⚠️ `<details>` 堆叠，无目录树导航 | renderers.tsx DiffAllSurfaceView |
| committed diff | ✅ **独有**（baseRef...HEAD） | renderers.tsx CommittedSurfaceView |
| commit 历史 | ✅ 30 条 + 展开文件列表 + 行评论目标 | workspace-panel.tsx |
| 行操作 | ⚠️ 仅 rawOnly 行点击（评论目标） | diff-viewer.tsx |
| 上下文展开 / 图片 diff / 大 diff 降级 | ❌ 均无 | — |

### 1.3 编辑
- ❌ 无内置编辑器；host 已有 `fs.write`（原子写 tmp+rename，`sidebar-host/src/index.ts:264`），client 未暴露 API。

---

## 2. Synara 有而我们没有的（报告见 subagent 输出，要点如下）

### 2.1 文件查看器
- [ ] **Markdown Source/Preview 双视图切换**（file-viewer-chrome.tsx radiogroup，per-tab 持久化）
- [ ] **Shiki 双主题高亮**（github-light/dark + HTML 缓存 500 条/50MB 防闪烁 + 预热 + 超长降级）
- [ ] **PDF 内嵌查看器**（pdf.js canvas + text/link 层 + 缩放/页码 toolbar）
- [ ] **复制选中行引用** `path:start-end`（getLineSelectionWithin + 浮动 Copy 按钮）
- [ ] **大文件分级兜底**：1MB 读取截断（truncated + 禁写）、20k 行去行号、250k 字符高亮上限
- [ ] **GFM 任务清单可勾选写盘**（onTaskToggle → WriteWorkspaceFile → fs.write）
- [ ] **Open With / Show in Folder / Copy Path**（上下文菜单 + 文件头 ButtonGroup）
- [ ] 加载/空/二进制/打不开细分错误态（Skeleton + BinaryFileView）
- [ ] 文件头面包屑 chrome（project › dirs › file + 行数 meta + truncated 标记）

### 2.2 diff 查看器
- [ ] **多文件 diff 左树右栈**：PathTreeNav 目录树 + MultiDiffFileStack 竖排堆叠 + 点击树滚动定位
- [ ] **懒加载性能策略**：≥25 文件或 ≥2000 行默认折叠、≥80 文件 capped、首屏挂 6 个、IntersectionObserver 预取 + keep-window
- [ ] **Unified/Split + WordWrap 工具栏**（diff-view-preferences，session 级持久化）
- [ ] **git 四区面板**（unstaged/staged/untracked/conflict）+ 行/目录/区块级 stage/unstage/discard + DiscardPlan 确认
- [ ] **diff 文件右键菜单**：Open / Copy Path / Copy Relative Path / Show in Folder / Open With
- [ ] blocked 态细分：binary/large/missing/unsupported/unavailable 各自空态

---

## 3. Orca 有而我们没有的（详见 `docs/orca-right-sidebar-research.md`）

### 3.1 文件查看器
- [ ] **Monaco 作为查看/高亮器**（TextMate 语法 ~90 语言映射 + vue/svelte/astro/nim 自定义；诊断全关只做高亮）
- [ ] **Markdown 三视图**：source（Monaco）/ **rich（TipTap WYSIWYG）** / preview（react-markdown + KaTeX + GFM + 目录 + 站内搜索 + mermaid + 内部链接 + 本地图片）；rich 上限 300KB 自动回退；frontmatter 剥离/回写
- [ ] **图片查看器**：0.25–8× ctrl+滚轮锚点缩放、重置、弹出窗、intrinsic/fill 布局、文件名/尺寸统计
- [ ] **PDF 查看器**：pdfjs，0.25–5× 缩放、内置查找（PdfFind）、缩放偏好记忆
- [ ] **CSV 虚拟化表格**：CSS grid + react-virtual，可扛 10 万+ 行，吸顶表头/行号列、分隔符探测、列宽采样
- [ ] **ipynb 查看器**：代码格 Monaco 编辑 + 运行 Python 格（信任确认 + 输出沙箱）、格增删移/类型切换
- [ ] **Mermaid 渲染**：懒加载 + 队列序列化 + DOMPurify 清洗 + 语法错误回退
- [ ] **外部改动检测**：watcher → changed-on-disk 标记 + ExternalFileChangeBanner + 对比对话框
- [ ] **live-tail**（日志文件实时跟随，只读）
- [ ] **gutter 右键菜单**：Copy Path to Line / Copy Rel. Path to Line / Copy Remote URL
- [ ] 大文本粘贴分级（64KB 直贴 / 16MB 硬上限）、minimap/wordWrap 选项

### 3.2 diff 查看器
- [ ] **Monaco DiffEditor 单文件**：inline/split、**折叠未改区（hideUnchangedRegions）可展开**、逐词高亮、自动滚到首变更、F7/Shift+F7 跳变更、view-state LRU
- [ ] **unstaged diff 可直接编辑** modified 侧并保存（改后实时重算 live-render-limit）
- [ ] **CombinedDiff 四模式**：combined-all / combined-uncommitted / combined-branch / combined-commit，每文件 = 虚拟化 section + 懒加载 + 滚动锚点 + 自绘滚动条
- [ ] **diff 文件树侧栏**：搜索、按扩展名过滤、「仅看已核阅」切换、树点选跳 section
- [ ] **大 diff 兜底**：12 万行/600 万字符上限，超限展示原因 + 可选「保存超限 draft」
- [ ] **diff 评论**：行悬停 + 加注按钮、拖拽选区、Monaco view-zone 渲染、Send to AI、聚合复制/清空
- [ ] **图片 diff**：Original/Modified 双 pane（并排或上下），空侧 "No preview"
- [ ] **冲突解决视图**：ConflictComponents + ConflictReviewFileTree + monaco 冲突装饰
- [ ] **分支/提交对比**：BaseRefPicker + merge-base 计算 + 30s 分支刷新
- [ ] **提交历史图**：SVG 图 + 右键（open-remote/copy-hash/copy-message/explain/open-diff）

### 3.3 编辑器
- [ ] **Monaco 编辑器**：行号/折叠/查找替换/minimap 选项/undo（真实 edit op）/tabSize/自动布局
- [ ] **保存流水**：Cmd+S → autosave（默认 1000ms，可配）→ fs:writeFile（quiesce 排队、save generation 去重、自身写入打标）
- [ ] **hot exit**：重启/更新前插队落盘所有脏文件；删除/重命名前 quiesce
- [ ] **未命名文件**：UntitledFileRenameDialog（保存先弹重命名）
- [ ] **Changes 模式**：编辑中的 unstaged 文件就地渲染成 workTree-vs-HEAD diff，保留 draft 管线
- [ ] **快捷键体系**：Mod+S / Mod+F / F7 / Mod+Shift+V / Mod+Alt+C（可重绑定 keymap）

### 3.4 其他亮点
- [ ] **完整文件管理器文件树**：拖拽/导入/复制/删除(回收站)/重命名/**撤销重做 50 步**/gitignore 过滤/逐目录懒加载/背景菜单「加项目」/auto-reveal/键盘导航
- [ ] **全文搜索**：ripgrep 优先、git grep 回退、SSH 走 mux、结果在匹配行打开文件
- [ ] **Tab 体系**：拖拽排序/分割 pane（二叉布局树）/Ctrl+Tab MRU 悬浮层/中键关闭/重命名
- [ ] worktree 管理面板（右栏切换）

---

## 4. 推荐补齐清单（按优先级）

### P0 —— 用户点名 + 高频（建议先做）
1. **Markdown Source/Preview 双视图切换**（Synara 模式，成本低收益高）
2. **多文件 diff 目录树导航**（Synara PathTreeNav 模式；我们有 DiffAll 堆叠基础）
3. **图片 diff 支持**（Orca ImageDiffViewer：Original/Modified 双 pane）
4. **展开未修改上下文**（diff 中间列展开；评估 Pierre 能力 vs Monaco DiffEditor 引入）

### P1 —— 完整性
5. **内置编辑器**（Monaco 或 CodeMirror 6）+ Cmd+S 保存（复用 fs.write，client 补 fsWrite API）
6. **Unified/Split + WordWrap UI 切换**（参数已有，缺 UI + 持久化）
7. **diff 右键菜单**（Copy Path / Show in Folder / Open With）
8. **大文件/大 diff 分级兜底**（1MB 截断、行数阈值、超限提示）
9. **复制选中行引用** path:line-line
10. **PDF 工具栏**（缩放/页码/查找）
11. **Shiki 高亮升级**（双主题 + HTML 缓存；或保留 Prism 但补缓存）

### P2 —— 锦上添花
12. **富文本 Markdown 编辑**（TipTap）—— 依赖重，评估
13. **diff 评论**（行内评论 + 发送给 AI）
14. **自动保存 + 外部变更检测**（watcher 依赖 Electron 侧能力，评估）
15. **ipynb / Mermaid / CSV 虚拟化** 专项查看器
16. **冲突解决视图**
17. **unstaged diff 直接编辑**

---

## 5. 实现约束（Oh-DSH 侧）

- **依赖现状**：prismjs + react-markdown + @pierre/diffs；无 Monaco/CodeMirror/TipTap。
- **体积**：sidebar-desktop/client.js ~976KB 已偏大；Monaco ~10MB 必须动态加载（chunk-loader 懒加载基建已有：bundle-route.ts / chunk-loader.ts）。
- **host 通道**：`fs.write` 已就绪（原子写 tmp+rename）；`fs.read` 已就绪；client 需补 `fsWrite` API + 编辑会话语义。
- **保留并增强**：我们独有的 committed/unpushed diff 视图、commit 历史、行评论目标（rawOnly）。
- **布局**：文件查看在中间 surface（center-surface），diff 在 surface 与右栏 review 面板；编辑器应走中间 surface tab。
