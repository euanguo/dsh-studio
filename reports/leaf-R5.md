# Leaf-R5 — 插件市场 class-emission 收口（回退 codemod + 真机验证）

驱动：leaf-4.2 拆分后新组件误用 `MarketplaceCss["oh-marketplace-*"]` 裸字符串替代品；
驱动者先尝试 codemod 改查表（方向错误），后改由 styles 重生成发射全局规则（`:global()` +
未哈希 `pluginCss`）。本叶精确回退 codemod —— 组件 class 恢复为裸字符串 `"oh-marketplace-*"`，
让它们匹配已发射的全局规则；并对 push-deadlock 造成的"stuck busy"修复做真机复核。

## 一、收尾清单

| 任务 | 事项 | 落点 | 验证 |
|---|---|---|---|
| ① | 回退 `MarketplaceCss["oh-marketplace-*"]` → 裸字符串 `"oh-marketplace-*"`（仅 `oh-marketplace-` 前缀；`dsh-studio-ui-*` 键不动）；清理因此不再使用的 import | `marketplace-filters.tsx`（17 键）、`marketplace-browse.tsx`（4 键）、`marketplace-view.tsx`（无 MarketplacesCss 残留，仅还原 `{"oh-marketplace-nav"}`→裸字符串）、`plugin-detail.tsx`（13 键，typecheck 必须） | `MarketplaceCss` 在 client 下仅剩 styles.ts 定义；typecheck 0 err |
| ② | styles.ts `pluginCss` 须含未哈希全局规则 | `.oh-marketplace-shell-content{flex:1;min-height:0;overflow:hidden}`、`.oh-marketplace-main{flex-direction:column;flex:auto;min-height:0;display:flex}` 及 `> *{flex:auto}`、`.oh-marketplace-shell` 仅 width/height **无 display**（display 由父 flex 承担） | 探针确认三规则均在，未重生成（无缺失） |
| ③ | `pnpm run typecheck` exit 0 | 全仓 | exit 0 |
| ④ | 真机（DEV :9222/CDP，runtime :55114）验证插件市场 shell/card/scroll、详情预览流、console 无错 | 会话 `dsh-dev-refactor-verify`，见 §二 | 全断言通过，0 console error |
| ⑤ | 三门禁 | typecheck / test / build | 全 exit 0，见 §三 |
| ⑥ | 提交 | 见 §四 | `git commit -s` |

> 说明：任务① 明确只列 3 文件；`plugin-detail.tsx` 因 typecheck（③）暴露 13 处
> `MarketplaceCss["oh-marketplace-*"]` 键已在 styles 重生成后从查表移除而必须一并回退，
> 且其所有 class 均为全局规则，属"精确回退 codemod"同一意图的必要闭环。

## 二、真机探针输出摘录（会话 dsh-dev-refactor-verify，`AGENT_BROWSER_CAPTURE_CONSOLE=1`）

启动复连：`tab → [t1] DeepSeek Harness - http://127.0.0.1:55114/`；页面 `location.reload()` 后打开
左侧"插件"（@e9）。

**1. shell / main / card 计算样式（全局规则生效）：**
```json
{ "shell":  { "display":"flex", "flex":"0 1 auto", "flexDirection":"column", "clientHeight":744 },
  "shellContent": { "display":"flex", "flex":"1 1 0%", "flexDirection":"column", "clientHeight":672 },
  "main":   { "display":"flex", "flex":"1 1 auto", "flexDirection":"column" },
  "grid":   { "display":"grid" },
  "card":   { "display":"flex", "flexDirection":"column" } }
```
另查 `getComputedStyle(.oh-marketplace-shell).height = "720px"`（规则 `min(960px,100vw-48px)` /
`min(720px,100vh-48px)` 生效；`clientHeight 744 = 720 + Modal 底部 padding 24`，契合"≈720"）。

**2. 滚动可用（scrollTop 可设并保持）：**
真实滚动容器为 `.dsh-studio-ui-scroll-area-viewport`（`overflowY:scroll`, sh 64042/ch 489）：
`set scrollTop=5000 → after=5000 → 1s 后 held=5000`（maxTop=63553）。grid 渲染 1749 卡片、无卡死。

**3. 详情预览流（构建脚本 / RiskConfirmation 步骤）：**
点卡片 `adb_dsh_plugin` → `.oh-marketplace-dialog` 内 `预览安装` 按钮 `disabled:false` →
`b.click()` → 进入 `snapshot.preview===null` 分支，弹 prepared-plan：
```json
planHeading: "已准备安装方案"
scriptsText: "prepare: npm run build"          // 构建脚本块
confirmLabels: ["仅允许在写入受限的预览环境中运行这些脚本。"]  // RiskConfirmation 勾选项
```
`启动隔离预览` 在勾选前为 `disabled`（`disabled={pending || !readyToPreview}`，required
确认未勾 → readyToPreview=false），**非 busy 卡住**：plan 已渲染即证明 prepare 完成后
`setBusy(false)` 正常执行（stuck-busy 修复生效）。确认后关闭详情 + 关闭插件市场（
`shellStillPresent:false`）。

**4. console 全程无错：**会话各检查点 `errors` 与 `console` 均为空。

**证据截图（tmp/desktop-verify/r5/screenshots/）：**
`01-marketplace-grid.png`（卡网格）；`02-plugin-detail.png`（详情·预览按钮 enabled）；
`03-plugin-detail-plan.png`（已准备安装方案 + 构建脚本 + 风险勾选）；
`04-closed-final.png`（关闭后状态）。

## 三、三门禁 G1/G2/G3

- `pnpm run typecheck`：**exit 0**（`tsc --noEmit` + `tsc -p plugins/capabilities/tsconfig.json`）。
- `pnpm test`：**pass 614 / fail 0 / skipped 2（共 616）**。
- `pnpm run build`：**exit 0**；1 条既有 katex bare-import warning（非本次引入）。
- build 后 DEV（CDP :9222 / runtime :55114）仍存活、CDP 心跳正常，未触发主进程重启竞态。

## 四、提交

```
plugin-marketplace: emit shell/layout classes globally; fix stuck busy
```
- 回退 4 个 client 组件对 `MarketplaceCss["oh-marketplace-*"]` 的查表 codemod，恢复裸字符串
  class（匹配 pluginCss 发射的全局规则 / module.css 的 `:global()` 包裹）。
- 说明两因：① push-deadlock —— host 推送原会 bump requestId 使 in-flight dispatch 的
  `busy=false` 被孤儿化，`requestId <=` 比较 + `acceptPush`（不触碰 requestId/busy）修复
  （store.ts）；② class-emission —— shell/main 的 flex 约束链改全局发射，组件用裸字符串挂钩。

## 五、遗留 / 说明

1. `MarketplaceCss` 仍保留在 styles.ts（生成产物，本叶不手改）；其中残余的
   `oh-marketplace-*` 键现无 client 引用，`dsh-studio-ui-*` 键仍被 shared 组件引用，
   收敛交由 scripts/plugin-styles.mjs 后续处理，非本叶范围。
2. `.agent-workflows/` 下本叶审计记录 agent-only，不入提交；`reports/leaf-R5.md` 在跟踪目录。
3. 未触碰 market 之外的业务文件；`git status` 既有 M 为工作树预存。