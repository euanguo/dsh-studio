# 统一悬浮评论架构（文件查看 + diff 双端）

> 状态：实现中 · 2026-08-23 · 已入库（2026-08-24，docs/ 全目录跟踪）
> 驱动：synara-upstream 评论闭环调研（行号槽+chip+`<file_comments>` 协议）+ 本轮 goal
> `goal-435f8552`。原则：架构先行、不补丁、不留冗余逻辑。

## 1. 现状盘点（R0 结论）

- **渲染层已是统一意图**：`diff/comment-annotations.ts` 单一定义
  `commentsToDiffLineAnnotations` / `commentsToFileLineAnnotations`，一个评论模型喂三端
  （FileDiff、pierre File viewer、pierre Editor）。泡泡组件 `diff/comment-bubble.tsx`。
- **缺的是「统一添加交互」**：
  - diff 端：`surfaces/diff-renderers.tsx` 底部表单（行号 number 输入 + 正文 + 提交）——
    交互次优（用户点名要改）。
  - 文件端：**没有添加 UI**，只渲染既有评论。
  - 两端的"行级事件"均可用 `@pierre/diffs` 官方 API：
    `onLineNumberClick` / `onLineClick` / `onLineEnter`/`onLineLeave`（InteractionManager
    统一选项），加坐标锚定即可做悬停浮钮 + overlay 输入框，**不需要 DOM 刮削
    （优于 synara 的 shadow-DOM 穿透）**。
- **两个评论实体并存**（各有语义，不强行合并）：
  - `DiffComment`（`diff/diff-comments-store.ts`，localStorage v1，worktree 批注：
    id/path/line/body/createdAt）——文件与 diff 的批注。
  - `ReviewComment`（`review/review-comments.ts`，branch/commit 感知、resolve 生命周期、
    按 Git review request 投递 agent）——评审请求。
  - 划选引用：`files/selection-insert-popup.tsx`（选区 → "添加到对话" → composer 草稿，
    `file-selection-reference.ts` 构建 payload）——引用通道。

## 2. 统一模型（R1）

`DiffComment` 升级为 v2（向后兼容迁移）：

```ts
interface WorkbenchComment {
  id: string
  path: string            // 原 filePath
  startLine: number       // 原 line；多行 range 起点
  endLine?: number        // 多行范围终点（缺省 = startLine）
  contentHash?: string    // 锚定行内容哈希 ⇒ 漂移检测/outdated
  branch?: string | null  // 可选：跨分支过滤（写时打戳，遗留 null 全可见）
  body: string
  createdAt: string
  resolvedAt?: string     // 对齐 ReviewComment 生命周期
}
```

- 存储：升级 `diff-comments-store.ts` 为唯一批注库，schemaVersion 进入 key
  （`dsh-studio.sidebar.diff-comments.v2`），v1→v2 幂等迁移（读 v1 键 + 补迁移字段 +
  写回 v2 + 保留 `.bak`），旧 helper（commentPathMatches 等）保留语义。
- `ReviewComment` 保持独立（评审语义），其持久化/投递路径不动；UI 统一见 §3。
- 划选引用保留为"引用"通道，归一进统一的悬浮动作菜单（§3）。

## 3. 统一交互（R2）

共享组件 `comments/CommentRails.tsx`（或 `CommentHoverActions`）：

- **触发**：`onLineEnter` 记录 hoverLine + hoverTop；行号槽内浮出 `+` 按钮
  （复用 diff-renderers 的 gutter 定位思路；FileDiff 与 File 同一交互 API）。
- **输入**：行下方 overlay 输入框（锚 hoverTop+rowHeight）：
  - Enter 提交 / Shift+Enter 换行 / Esc 关闭（对齐 synara 的焦点约定，且经 `kit/keymap`
    注册全局 Esc 不误触）；空文本禁用提交。
- **动作**（同一弹层两个出口，对齐 synara"评论 vs 引用"语义）：
  1. **评论**：addWorkbenchComment（存批注，双端立即可见，可 resolve）
  2. **引用到对话**：复用 `file-selection-reference` 的 payload 构建，`@path` + fenced
     片段 + 行号注入 composer 草稿（`ReviewCommentsService.appendToComposer` 通道）。
- **接入点**：
  - `pierre-file-view.tsx`（File viewer）：onLineEnter/onLineClick + 注释泡旁浮钮。
  - `surfaces/diff-renderers.tsx`（FileDiff）：替换底部表单（删 `commentLine`/
    `commentBody` 状态与表单 JSX，改由 Rails 添加）；注释泡按新-side 行渲染不变。
  - `file-surface.tsx`（viewer + editor）：沿用注释泡；编辑态经 Rails 添加（editor
    交互由 editor 侧行事件提供，能力不足时藏起入口——不硬做）。
  - Markdown 渲染预览态：无稳定行号 → 保留划选引用，不提供行号评论（与 synara
    一致）；Markdown 源代码视图即 pierre 代码态，天然支持。

## 4. 发送到对话的桥（可选增强，随 R2 附带）

- 评论序列化：composer 发送时把未投递评论序列化为 `<file_comments>` 尾随块
  （对齐 synara `lib/fileComments.ts` 协议），transcript 气泡解包回显。
  依赖 DSH composer 的注入点是否可扩展——不可扩展时退化为"引用到对话"单条注入，
  文档明确取舍。

## 5. 迁移与清理（R1/R3）

- v1→v2 数据迁移（幂等、bak、重启安全，AGENTS.md 约束）。
- 删除被替代的冗余：diff-renderers 底部表单、无消费方的旧字段。
- `comment-annotations.ts` 更新为 v2 类型 + 多行 range 注解（pierre 支持 range？若仅
  line 级，则 endLine 只在序列化/漂移判定用，注解仍挂 startLine）。
- i18n 统一（comments.* 键位，中英）。
- 文档：design.md / design.en.md 补「统一评论」节（双语）。

## 6. 验收

- 文件视图（代码态）与 diff 视图：悬停行 → `+` → 输入 → 提交，双端同体验；
- 评论跨端可见（文件加的评论在 diff 相应行显示，双向）；
- v1→v2 迁移幂等（重复加载不产生重复评论）；
- resolve/resolved 标记可见；contentHash 不匹配时标注 outdated（R3 可选 UI）；
- diff 底部表单已删除；typecheck/test/build 全绿。

> 落地取舍（R2 终）：发送到对话的桥已实现为「引用到对话」轻量注入
> （`buildCommentReference`：`path` L{line}: body → composer 草稿）。
> `<file_comments>` 结构化协议需序列化点可扩展（发送时尾随块注入 +
> transcript 解包回显），受 DSH composer 扩展点约束未实现，保留为后续项。
