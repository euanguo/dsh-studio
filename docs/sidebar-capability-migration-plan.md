# Oh-DSH 侧边栏能力迁移计划（路径 1：搬能力）

> 状态：**计划定稿，待执行**（用户已确认走路径 1——把上游 DSH-better-sidebar 的能力逐个移植到我们自研壳，不做 deep fork）。
> 原则：每个能力是自包含模块，**独立移植、独立可交付、可随时停**；不引入上游 CSS modules，样式统一走我们的 token 层（`--oh-dsh-*` / `--dsw-alias-*`）；host 侧能力优先复用已 vendor 的路由（`plugins/sidebar-host`）。
> 配套：基准调研 `docs/sidebar-upstream-benchmark.md`（已完成的 P0/P1 契约迁移不在此列）、架构对比 `docs/sidebar-upstream-vs-ours-architecture.svg`。

---

## 0. 总览

| # | 能力 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|
| 1 | 外链协议分流（http/https 二级开关） | P0 | 0.5 天 | 无 |
| 2 | IME 组合键守卫 | P0 | 0.5 天 | 无 |
| 3 | Tab 条滚轮横向滚动 | P0 | 0.5 天 | 无 |
| 4 | HTML 预览 no-sandbox 逃生舱 | P1 | 1 天 | #1 的 prefs 模式 |
| 5 | 终端字体设置（族 + 字号实时生效） | P1 | 1-1.5 天 | panel-controls 接线 |
| 6 | 划词"添加到对话"浮窗 | P1 | 1-2 天 | composer 通道（review-comments 先例） |
| 7 | 双工作台 + tab 拖拽分屏 | P2 | 3-7 天 | 大件，独立排期 |
| 8 | subagent 拓扑 + 后台任务面板 | P2 | 3-5 天 | 需先验证 sessions 服务暴露子代理链 |
| 9 | token 统一（搬运组件的样式收编） | P3 | 穿插 | 随 4-8 走 |
| 10 | CI 挂载冒烟门禁（遗留 P2-1） | P3 | 1 天 | 独立 |

---

## 1. P0 小件（各 0.5 天，先做）

### 1.1 外链协议分流（browserInterceptHttp / Https）

**上游做法**（`src/client/index.tsx` link interception + `prefs-shared.ts`）：
- `browserInterceptLinks` 总开关 + **协议级二级开关**：`browserInterceptHttp`（默认 ON）、`browserInterceptHttps`（**默认 OFF**——多数 https 站点拒绝 iframe 嵌入）
- 拦截判定：总开关 → 按 `url.protocol` 查协议开关 → 目标 tab 启用开关；Ctrl/Cmd+click 始终放行
- 设置项挂在 browser tab 的 `settings.toggles` 下（吃狗粮）

**我们现状**：`SidebarRuntimePreferences` 只有 `browserInterceptLinks` 总开关；`plugin.tsx` 的 `stopLink` handler 命中总开关后直接走 urlTarget/browser 兜底。

**移植方案**：
1. `runtime-settings.ts`：`SidebarRuntimePreferences` 加 `browserInterceptHttp: boolean`（默认 true）、`browserInterceptHttps: boolean`（默认 false）+ `parseSidebarRuntimePreferences` + 默认值
2. `plugin.tsx` `stopLink`：总开关后加协议判断——
   ```ts
   const protocolOn = url.protocol === 'https:'
     ? prefs.browserInterceptHttps
     : prefs.browserInterceptHttp
   if (!protocolOn) return false
   ```
   （urlTarget 认领也受协议开关约束——放在协议判断之后）
3. `sidebar-desktop/src/client/plugin.tsx` browser tab 的 `settings.toggles` 加两行（`browserInterceptHttp` / `browserInterceptHttps`，复用 i18n key）
4. i18n：新增 `settings.open-links-http` / `settings.open-links-https`（en/zh）

**验收**：http 外链侧边栏打开、https 外链系统浏览器；设置页 browser 卡片齿轮内出现两个协议开关；开关关闭后对应协议外链放行。

### 1.2 IME 组合键守卫

**上游做法**（`src/client/ime-guard.ts`）：
- 纯函数 `isImeComposition(event)`：`isComposing || keyCode === 229`
- `registerImeGuard()`：document **capture 阶段** keydown/keyup，组合键 `stopPropagation()`——在 React 委托和任何内联第三方组件之前拦截，防方向键/回车/空格被页面代码劫持（IME 候选选择被打断）；不阻止默认行为（浏览器原生 IME 不受影响）；HMR-safe disposer

**我们现状**：无。自研查看器风险低，但内联 iframe（HTML 预览、未来上游组件）场景需要。

**移植方案**：
1. 新建 `plugins/sidebar/src/client/ime-guard.ts`（照搬上游：纯函数 + 注册函数）
2. `plugin.tsx` `apply()` 的 effect 里 `ctx.effect(() => registerImeGuard(), 'oh-dsh-desktop: IME composition guard')`
3. 单元测试：`tests/ime-guard.test.ts`（isImeComposition 判定 + 注册/注销）

**验收**：中文输入法候选期按方向键/回车/空格，页面组件（数字步进、按钮）不响应；`pnpm test` 含守卫测试。

### 1.3 Tab 条滚轮横向滚动

**上游做法**（`src/client/TabBar.tsx`）：
- 非 passive 原生 `wheel` 监听（React onWheel 在 root 是 passive，`preventDefault` 无效）：modifier 键（shift/ctrl/cmd/alt）放行（shift=原生横向、ctrl/cmd=缩放）；`scrollWidth <= clientWidth` 不拦截（页面正常滚）；`deltaMode` 换算（1→16、2→clientWidth）；`scrollLeft += (deltaX + deltaY) * unit`

**我们现状**：`SurfaceTabStrip`（`plugins/shared/surface-tab.tsx`）无滚轮处理，tab 溢出时只能拖滚动条。

**移植方案**：
1. `plugins/shared/surface-tab.tsx` 的 `SurfaceTabStrip`：加 `ref` + 上述 wheel 逻辑（放 `surface-tab.tsx` 内，center 条与右栏条共用）
2. 测试：`tests/surface-tab-wheel.test.ts` 或并入现有测试（纯逻辑抽 `shouldConsumeWheel(el, event)` 便于测试）

**验收**：右栏 tab 溢出时鼠标滚轮横向滚动；不溢出时页面正常滚动；shift/ctrl/cmd 滚轮行为不变。

---

## 2. P1 中件（各 1-2 天）

### 2.1 HTML 预览 no-sandbox 逃生舱

**上游做法**：prefs `htmlViewerNoSandbox`（全局关沙箱，带警告）+ `htmlViewerDefaultUnsafe`（新开预览默认非沙箱）+ html viewer 的 settings.toggles；TextEditor 预览状态行提供一次性"解锁/恢复"（每 surface 临时开关）。

**我们现状**：`files/file-viewers.tsx` 的 `HtmlFileViewer` 固定 `sandbox=""`（opaque origin），本地 HTML 预览无法访问同源资源。

**移植方案**：
1. `runtime-settings.ts` 加 `htmlViewerNoSandbox: boolean`（默认 false）、`htmlViewerDefaultUnsafe: boolean`（默认 false）
2. `file-viewers.tsx`：`HtmlFileViewer` 按 prefs 渲染 `sandbox` 属性；加"解锁/恢复"按钮（临时切换 + 警告文案）
3. `builtins/viewers.tsx` html viewer 注册 `settings.toggles`（两行）
4. i18n + 警告文案

**验收**：默认沙箱；开启 no-sandbox 后 iframe 无 sandbox 且显示警告；预览内一键解锁/恢复；设置页 html viewer 卡片齿轮出现两开关。

### 2.2 终端字体设置

**上游做法**：prefs `terminalFontFamily`（CSS font-family，空=主题等宽 `--ds-font-family-code`）、`terminalFontSize`（9-32px，实时生效）；terminal tab 的 `settings.toggles`（text/number 行）；TerminalView 订阅 prefs 实时应用。

**我们现状**：终端在 `panel-controls`（PTY dock），无字体设置；`runtime-settings.ts` 有 `agentTerminalTools` / `bottomPanelAutoTerminal` 等，通过 `panels.setAutoOpenTerminal()` 单向传给 panel-controls。

**移植方案**：
1. `runtime-settings.ts` 加 `terminalFontFamily: string`（默认 ''）、`terminalFontSize: number`（默认 14，9-32 钳制）
2. `panel-controls` 的 `DesktopPanels` 服务加 `setTerminalFont(family: string, size: number)`（或单方法 `setTerminalFontPreferences`），终端组件把 CSS 变量/样式应用到 xterm 容器（复用现有主题变量机制）
3. `plugin.tsx` `syncRuntime` 里把两个字段传给 panels
4. `builtins/tabs.tsx` terminal tab 的 `settings.toggles` 加 text/number 行（placeholder/unit：`px`、min 9 / max 32）
5. i18n

**验收**：设置页 terminal 卡片齿轮内出现字体族（text 行）与字号（number 行，blur/Enter 提交、越界钳制）；修改后打开的终端实时生效；重置恢复默认。

### 2.3 划词"添加到对话"浮窗

**上游做法**（`src/client/selection-payload.ts` + 预览器浮窗）：
- 纯字符串构造：`headerOf(path, cwd, lines)` → 相对路径 `rel[:start[-end]]`；`payloadOf(...)`：选区 ≤ `SELECTION_LIMIT`(500) 生成 fenced code block（info 行 = 相对路径:行号），超限退化为纯路径行；markdown 预览无法映射 DOM→源码行，用 `linesOfSelection` 在源码里**反向搜索**选区文本，唯一命中才报告行号
- UI：md 预览 + code 查看器划词后浮窗"添加到对话"，把 payload 追加进 composer draft

**我们现状**：`files/file-selection-reference.ts` 有部分纯函数（`formatFileSelectionReference` + 行号解析 helper，Synara 移植），**无调用方、无浮窗、无 composer 写入**。

**移植方案**：
1. 扩展 `file-selection-reference.ts`：补 `SELECTION_LIMIT`、`headerOf`、`payloadOf`（对齐上游形状；我们已有行号解析可复用）
2. `files/markdown-viewer.tsx` + `files/content-viewer.tsx`：选区监听 + 浮窗（"添加到对话"按钮），复用 `kit/dialog.tsx` 或轻量浮窗
3. composer 写入：复用 `review/review-comments.ts` 已有的 composer 集成通道（行评论 → composer 的先例），加 `appendToComposer(text)` 通道
4. 测试：`tests/selection-payload.test.ts`（payload 构造 + 反向搜索行号）

**验收**：md/文本预览划词出现浮窗；点击后 composer 出现 fenced block（info 行 `相对路径:行号`）；>500 字符退化为路径行；行号仅在唯一命中时输出。

---

## 3. P2 大件（独立排期）

### 3.1 双工作台 + tab 拖拽分屏

**上游做法**：`state.ts`（`splits` / `bottomSplits` 双树 reducer：openTabInActivePane / activateTabReducer / split / merge）+ `split-pane.tsx`（Workbench：pane 内 tab 栈、拆分/合并）+ `TabBar.tsx`（HTML5 drag：`TabDragPayload`、dragstart/dragover/drop、跨 pane 拖拽、拖动性能优化）+ `Sidebar.tsx` 装配。

**我们现状**：右栏 `SideToolsPanel`（单激活 tab 模型）+ 中间工作区（center surface preview/pin）+ 底部 `panel-controls` dock（PTY 专属，非通用工作台）。无任何 tab 拖拽/分屏。

**移植方案（务实版，不整套搬 reducer）**：
1. **右栏内拖拽排序**：`TabStrip` 的 `SurfaceTab` 加 `draggable` + dragstart/dragover/drop，`DesktopSidebarService` 加 `moveTab(tabId, toIndex)`（持久化到 session tabs，走 `writeTarget`）；排序可跨 pinned/tab strip
2. **第二工作台（底部 tab 区）**：`panel-controls` 的 dock 之上加一个"底部工作台"tab 区（复用 `SurfaceTabStrip`），tab 可拖入/拖出；状态模型轻量扩展：`DesktopSidebarSnapshot` 加 `bottomTabs` / `bottomActiveId`（或独立 `SidebarDockService`），持久化 per session
3. **跨区拖拽**：`TabDragPayload`（type + id + sourcePane）在右栏 ↔ 底部工作台之间 drop；drop 到已有 tab 旁 = 移动，drop 到空白 = 拆分
4. **不碰中间工作区**：center surfaces 保持现状（文件/diff 仍开中间）；后续如需"右栏 tab 拖进中间并排"再扩展
5. 交互细节对齐上游：非 passive wheel（见 1.3）、拖拽性能（pointer/RAF 节流）、drop 高亮

**风险与决策点**：
- 状态模型二选一：扩展 `DesktopSidebarService`（贴近现有持久化） vs 独立 dock 服务（贴近上游 splits）——**倾向扩展现有服务**（reducer 整套搬会与 center-surface store 双轨冲突）
- 底部工作台与 PTY dock 的布局关系（上下叠放 / dock 内 tab 切换）需产品确认

**验收**：右栏 tab 可拖拽排序并持久化；tab 可拖入底部工作台（第二 pane）；底部 tab 可拖回右栏；刷新后布局恢复；中间工作区行为不变。

### 3.2 subagent 拓扑 + 后台任务面板

**上游做法**：`SubagentView.tsx`（主会话为根、分层树、节点卡片带状态点/最后输出/最后工具调用轮询、点击跳转子会话）+ `subagent-jobs.ts` / `subagent-activity.ts`（活事件镜像）+ host `jobs.output` / `jobs.kill` 路由（**我们 host 已 vendor**）+ 设置（`autoOpenSubagent` / `autoOpenJobs`）。

**我们现状**：host `jobs-routes.ts` 已有 `jobs.output` / `jobs.kill`；**client 无面板、`betterSidebarApi` 未暴露 jobOutput/jobKill**。

**移植方案**：
1. **前置验证**：`SessionsService`（DSH runtime 注入）是否暴露会话 parent 链/子代理关系——上游从 sessions 服务取拓扑。若我们的 sessions 面没有，需从 DSH runtime 的 sessions 服务找等价 API 或从会话事件日志推导（host 侧 `jobs-routes` 的回放模式可参考）
2. `better-sidebar-api.ts` 加 `jobOutput(scope, id, signal)` / `jobKill(scope, id, reason)`（wire 契约 host 已支持）
3. 新建 `client/subagent/` 面板组件（拓扑树 + 节点状态 + jobs 输出回放 + 终止按钮），注册 tab `id: 'subagent'`（order 30，`single: true`），加 `settings.toggles`（`autoOpenSubagent` / `autoOpenJobs` → runtime-settings 加字段）
4. 样式走我们 token 层（P3）

**风险**：子代理拓扑数据源是最大不确定点（上游依赖 DSH sessions 服务的 parent 链）；若 DSH 0.1.0-rc.5 的 sessions 服务不暴露，则回退为"仅后台任务面板"（jobs 回放，数据源明确）。

**验收**：子代理会话出现时侧边栏 subagent 页展示拓扑树；节点显示状态与最近输出；点击跳转子会话；后台任务可查看输出与终止；开关控制自动展开。

---

## 4. P3 工程收尾

### 4.1 token 统一（随各能力走）
- 所有搬运组件**不引入上游 CSS modules**：样式内联/独立 css 文件，色值一律用 `--oh-dsh-*` / `--dsw-alias-*`（`plugins/shared/theme.css` 已映射）
- 验收：grep 搬运组件无硬编码 hex；主题切换（desktop-skins）下新组件跟随

### 4.2 CI 挂载冒烟门禁（遗留项）
- 上游 `scripts/e2e-mount.sh`：npm pack → `dsh plugin add <tarball>` 装进 scratch profile → 真实 `dsh web` → Playwright 无头断言 mount/无 crash/逐个打开内置 tab
- 我们现有 `scripts/smoke-runtime.mjs`（真实 Electron 冒烟）；补"打包产物 → 独立 profile → 无头渲染"一层
- 验收：CI 上 npm 打包产物可挂载渲染、无错误条

---

## 5. 执行顺序与依赖

```
P0-1 协议分流 ──┐（prefs 模式先例）
P0-2 IME 守卫  ├─ 各自独立，先做（1.5 天）
P0-3 tab 滚轮 ─┘
        │
P1-1 no-sandbox ──（依赖 P0-1 的 prefs 模式，0 硬依赖）
P1-2 终端字体 ────（依赖 panel-controls 接线）
P1-3 划词浮窗 ────（依赖 composer 通道）
        │
P2-1 双工作台 ────（大件，独立排期；可先做右栏内排序）
P2-2 subagent ────（先做前置验证：sessions 子代理链）
        │
P3-1 token 检查（穿插）· P3-2 CI 冒烟（独立）
```

**每步独立可交付**：P0 三件完成即合入验证；P1 逐件合入；P2 单独立项。

## 6. 验收与回归

- 每个能力：实现 + 单元测试（纯逻辑抽函数测试）+ 手动验收（桌面端 CDP/截图核对）
- 全量门禁：`pnpm typecheck && pnpm test && pnpm build`（build 含契约 consumer 类型门禁）
- 回归重点：右栏/中间工作区/底部 dock 布局不被 P2 双工作台改动破坏（`tests/right-panel-layout.test.ts` 守护）

## 7. 参考索引

**上游（`DSH-better-sidebar` main @ ecebc97）**：
- 协议分流：`src/client/index.tsx`（link interception）、`src/prefs-shared.ts`
- IME 守卫：`src/client/ime-guard.ts`（+ `tests/ime-guard.spec.ts`）
- tab 滚轮：`src/client/TabBar.tsx`（+ `tests/tab-bar-wheel.spec.tsx`）
- no-sandbox：`src/client/builtins/viewers.tsx`、`src/client/chunks/editor.tsx`（沙箱状态行）
- 终端字体：`src/client/builtins/tabs.tsx`、`src/client/terminal-font.ts`、`src/prefs-shared.ts`
- 划词浮窗：`src/client/selection-payload.ts`、`src/client/intercept.tsx`、`tests/selection-payload.spec.ts`
- 双工作台：`src/client/state.ts`、`src/client/split-pane.tsx`、`src/client/TabBar.tsx`、`src/client/Sidebar.tsx`
- subagent/jobs：`src/client/SubagentView.tsx`、`src/client/subagent-jobs.ts`、`src/client/subagent-activity.ts`、`src/client/api.ts`（jobOutput/jobKill）

**我们（oh-dsh-desktop）**：
- prefs：`plugins/sidebar/src/client/runtime-settings.ts`、`plugins/sidebar/src/sidebar-preferences.ts`
- 拦截：`plugins/sidebar/src/client/plugin.tsx`（stopLink/stopOpenPath）、`intercept.ts`
- 壳：`plugins/sidebar/src/client/SideToolsPanel.tsx`、`workspace-tools.tsx`、`plugins/shared/surface-tab.tsx`
- 查看器：`plugins/sidebar/src/client/files/file-viewers.tsx`、`content-viewer.tsx`、`markdown-viewer.tsx`
- 终端：`plugins/panel-controls/src/terminal/`（PTY dock）
- composer 通道先例：`plugins/sidebar/src/client/review/review-comments.ts`
- host 路由：`plugins/sidebar-host/src/jobs-routes.ts`（已 vendor）
