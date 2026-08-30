# Leaf 4.3 — UI 合规全仓收敛（tokens/i18n/裸控件/探针 CSS）

OWNS 文件已被 leaf-4.1 移动的均按当前树适配（desktop-skins → `src/client/`、
commit-area → `source-control/`、panel-controls `style.d.ts` 单数）。全部改动仅
`pnpm run typecheck`（`tsc --noEmit` + capabilities tsconfig）自验，0 错；禁
git/install/test/build 均未执行。

## G1 — C7-CLEAR ✅
`plugins/shared/theme.css` 紫 tone 两组（`--dsh-studio-tone-protected-bg/fg`：
`#f1eaff`/`#6741a5`、`#2c2340`/`#c4a6f5`）**删除**。grep 全仓证明该 token 零消费
（死代码）；brand 家族全蓝无法 color-mix 派生紫，故删除 + ADR
`docs/adr-tone-protected-removal.md`。G1 CHECK 通过：`C7-CLEAR`。

## G2 — Q10 定夺 + 别名收口 ✅（CHECK 已按 Q10 结论更新）
在 `dsh-source` token 目录 `packages/client/ui-theme/src/styles/design-platform.css` grep 定夺：
- `--dsw-alias-accent-bg` / `--dsw-alias-accent-fg` — **不存在** → C23 清除。
  `surface-tab.css` 两处（active badge、drop indicator）改用
  `--dsw-alias-brand-primary-new-colorprimary-new-color`（color-mix 14% tint /
  直接引用）。`#4d6bfe` 永落已消。
- `--dsw-alias-brand-primary-new-colorprimary-new-color` — **存在**（light
  `rgb(65,118,230)` / dark `var(--dsw-static-deepseek-450)`）→ 保留 +
  `theme.css`/`surface-tab.css` 加 Q10 出处注释。
- `--dsw-alias-state-business-primary` — **存在**（light `deepseek-500` /
  dark `deepseek-400`）→ 保留 + `skins.ts` 加 Q10 出处注释。

## G3 — FONTS-ALL-CLEAR ✅
sidebar/marketplace `module.css` 残留 `font-size: Npx`（29 处）全部改
`var(--dsh-studio-font-*)`（10→xs, 11→sm, 12→md, 13→lg, 14→xl）。`source-control.module.css`
本已全 token 化（font-size 全 var、颜色全 `--dsw-alias-*` + fallback，无 `#4d6bfe`）。
G3 CHECK：`PX=0` → `FONTS-ALL-CLEAR`。

## G4 — GENERALROW-OK ✅（关税路径已修正）
原 CHECK 路径有误（无空格粘连路径），已验证实际目录。
- C25：`setting.tsx` 工具/预览两节 `dsh-studio-sidebar-settings-grid` 由
  `repeat(2,minmax(0,1fr))` 改单列 `minmax(0,1fr)`。
- C45：skins 3 列瓷砖画廊（`plugin.tsx` 的 `Button` 瓦片 + `repeat(3,...)` grid）
  收敛为官方 `Pill` 行（`Pill` 芯片 + swatch + 名称/模式），`skin-picker.module.css`
  grid 删除。
- C26：left-rail 复核已清（无 2/3 列 settings tiles）；skins picker 无省略号按钮
  （前轮已去）。`marketplace.module.css` `.oh-marketplace-flow` 为 3 步安装引导
  stepper（非 settings 行），已加 G4 豁免注释。

## C24 — skins 哈希 selector 迁入 generated-selectors 输入清单 ✅
`skins.ts` 手写哈希选择器全部迁出：新增 7 组 ANCHORS 常量 + generator 输入清单
（`scripts/generate-skin-selectors.mjs` ANCHORS 末尾：CLOSE_BUTTON/REMOVE_BUTTON/
ARROW_BUTTON/FILTER_PILL/TOAST/ONBOARDING_MASK/RAIL），并在
`generated-selectors.ts` 追加对应常量（当前 commit 哈希）。`skins.ts` 改用
`gate(...)` 引用：`_close_18d3q_30`/`_remove_1hk8w_53`/`_arrow_1hk8w_90`/
`_pill_e3ygd_1`/`_toast_fvpz7_7`/`_onboardingMask_1cfrq_10`/`xuwxfG_trigger`/
`xuwxfG_rail`（经 TRIGGER_PILL/RAIL）、`cardWorkspaceTrigger`（经 CARD 过滤）。
上游 bump 后 `pnpm run generate:selectors` 可重钉（G5 复核）。`typecheck` 0 错
佐证引用一致。

## C37 — i18n 群统一 t() ✅
新增 en/zh key：`diff.change-prev`、`diff.change-next`（`{hint}` 插值）、
`diff.comment-actions`、`diff.comment-resolve`、`diff.comment-reopen`、
`diff.comment-delete`、`files.empty-notebook`、`files.file-path`、
`files.table-of-contents`。替换：
- `content-viewer.tsx:482` "Open externally" → `t('files.open-externally')`（PdfViewer + t prop）
- `diff-toolbar.tsx:49/56` → `t('diff.change-prev/next', {hint})`
- `comment-bubble.tsx:40-65` 4 串 → `t(...)`（CommentBubble + t prop，级联
  multi-diff-file-stack/pierre-file-view/file-surface/diff-renderers 四处调用，
  `useCallback` deps `[t]` 更新）
- `ipynb-viewer.tsx:38` "Empty notebook" → `t('files.empty-notebook')`（+t prop）
- `markdown-viewer.tsx:45` "Table of contents" → `t('files.table-of-contents')`（+t prop，
  级联 content-viewer/ipynb）
- `file-viewer-chrome.tsx:81` "File path" → `t('files.file-path')`
严格执行，不再捕硬编码英文字符串。

## C38 — 裸控件收编官方原子 ✅
- files-view search：input 已是官方 `Input`，无裸 search button → 已合规。
- `commit-area.tsx`：手搓 `<small role="alert">`（generationError/operation error）
  → 官方 `StatusLine tone="error"`。branch-picker 触发器保留裸 `<button token>`——
  官方 `Button` 非 forwardRef，`branchButtonRef` 供 `Menu.getAnchorRect` 定位必需，
  该触发与官方 `Menu` 配对（既有 `useMenuAnchor` 惯例），在报告注明豁免。
- `comment-compose-card.tsx`：裸 `<textarea>` → 官方 `Textarea`。
- `selected-text-action.tsx`：按 PLAN 冲突协调，该文件组件拆分归 leaf-4.1；
  本 leaf 仅做样式侧不动组件逻辑（`role="menu"/"menuitem"` 列表选择器保留，
  迁移归 L4.1）。

## 其它
- **styles.ts 全局 Menu 重绘两份→一份 + 豁免注释**：删除 center-surface.module.css
  冗余 `body>div[role='menu']` 副本，收敛到唯一入口 side-tools.module.css 并加
  豁免注释（portaled DOM 无法用 dsh-studio-* 类定位，属性选择器唯一稳定锚点）。
  侧栏/各 plugin styles.ts 均 `node scripts/plugin-styles.mjs` 重新生成同步。
- **C43 Canvas**：`tab-drag-image.ts` 拖拽图硬编码色改 `getComputedStyle(document.body)`
  读 `--dsw-alias-bg-layer-1`/`--dsw-alias-border-l2`/`--dsw-alias-label-primary`
  + body computed fontFamily（Canvas fillStyle 无法直接吃 CSS 变量，getComputedStyle
  解析是唯一合规路径；token 声明在 body，故读 body）。

## 验证
- `node_modules/.bin/tsc --noEmit`：0 error（此前 baseline `overlay-arbiter.ts:84`
  已被其它 leaf 修复，全仓干净）。
- `node_modules/.bin/tsc --noEmit -p plugins/capabilities/tsconfig.json`：0 error。
- 禁 git/install/test/build：均未执行；`styles.ts` 由 `plugin-styles.mjs` 生成
  （源码级，非 build）。