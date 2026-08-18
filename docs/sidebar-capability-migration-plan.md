# Oh-DSH 侧边栏能力迁移计划（路径 1：搬能力）

> 状态：**全部 12 项已执行完毕（2026-08-17）**（用户已确认走路径 1——把上游 DSH-better-sidebar 的能力逐个移植到我们自研壳，不做 deep fork）。
> 原则：每个能力是自包含模块，**独立移植、独立可交付、可随时停**；不引入上游 CSS modules，样式统一走我们的 token 层（`--oh-dsh-*` / `--dsw-alias-*`）；host 侧能力优先复用已 vendor 的路由（`plugins/sidebar-host`）。
> 配套：基准调研 `docs/sidebar-upstream-benchmark.md`（已完成的 P0/P1 契约迁移不在此列）、架构对比 `docs/sidebar-upstream-vs-ours-architecture.svg`。

---

## 0.1 上游动态跟踪（2026-08-16 拉取 `fc4031e`，基线上次调研 `ecebc97`）

| 上游新提交 | 内容 | 对我们的影响 | 处理 |
|---|---|---|---|
| `fd9544f` | **可配置终端 shell**（显式配置 → `DSH_SIDEBAR_SHELL` 环境变量 → PATH/known-dir 探测 pwsh → inbox 5.1 兜底；同一解析链供 UI 终端 + agent 终端工具；解析器可注入平台/env 便于测试） | 我们 `pty-manager.ts` 只有 `process.env.SHELL` 兜底，无显式配置/探测链 | **新增计划项 #5b：终端 shell 配置**（见 §2.4） |
| `3c196ff` | **皮肤兼容（令牌驱动）**：面板表面改用通用卡片令牌 `--dsw-alias-bg-layer-1`（不再消费宿主专属 token，10 款皮肤零适配跟随）；`effectiveTokenValue` 加 **alpha 阈值**（transparent / alpha<0.9 半透明 → 回退不透明底色，终端/编辑器文字不叠在皮肤背景上）；z-index 降到 DSH 浮层栈（100+）之下（面板 40 / 按钮簇 45）；角手柄移入面板内 | 我们 `theme.css` 已映射 `--dsw-alias-*`（方向一致）；但 sidebar root `z-index: 2147483647` 是最高层，**需要核对是否盖住 DSH 弹窗/浮层** | **更新 #9 token 统一策略**（alpha 阈值回退经验）+ **新增核对项 #9a z-index 层级**（见 §4.1） |
| `fc4031e` | xterm 迁移弃用包 → `@xterm/xterm@^5.5` | 我们已在 `@xterm/xterm@^6.0.0` + `@xterm/addon-fit@^0.11`（panel-controls） | **无需跟进** |
| `515ed0a` / `d7dc609` / `c9372de` | editor 语法高亮加 Swift / Kotlin / C# | 我们高亮走 `@pierre/diffs` 的 **Shiki 扩展表**（`files/language.ts`），已覆盖这些语言 | **无需跟进** |
| `d33d676` | CI flaky 测试修复 | 无关 | 忽略 |

**结论**：计划需要更新 3 处——新增"终端 shell 配置"条目、token 统一策略补充 alpha 阈值、新增 z-index 层级核对项。其余无需变动。

---

## 0. 总览

| # | 能力 | 优先级 | 工作量 | 依赖 | 状态 |
|---|---|---|---|---|---|
| 1 | 外链协议分流（http/https 二级开关） | P0 | 0.5 天 | 无 | ✅ |
| 2 | IME 组合键守卫 | P0 | 0.5 天 | 无 | ✅ |
| 3 | Tab 条滚轮横向滚动 | P0 | 0.5 天 | 无 | ✅ |
| 4 | HTML 预览 no-sandbox 逃生舱 | P1 | 1 天 | #1 的 prefs 模式 | ✅ |
| 5 | 终端字体设置（族 + 字号实时生效） | P1 | 1-1.5 天 | panel-controls 接线 | ✅ |
| 5b | **终端 shell 配置**（新增，上游 `fd9544f`） | P1 | 1 天 | host `pty-manager.ts` + agent-pty | ✅ |
| 6 | 划词"添加到对话"浮窗 | P1 | 1-2 天 | composer 通道（review-comments 先例） | ✅ |
| 7 | 双工作台 + tab 拖拽分屏 | P2 | 3-7 天 | 大件，独立排期 | ✅ |
| 8 | subagent 拓扑 + 后台任务面板 | P2 | 3-5 天 | 需先验证 sessions 服务暴露子代理链 | ✅ |
| 9 | token 统一（搬运组件的样式收编） | P3 | 穿插 | 随 4-8 走 | ✅ |
| 9a | **z-index 层级核对**（新增，上游 `3c196ff`） | P3 | 0.5 天 | 桌面端 CDP 验证 | ✅ |
| 10 | CI 挂载冒烟门禁（遗留 P2-1） | P3 | 1 天 | 独立 | ✅ |

---

## 1. P0 小件（各 0.5 天，先做）

### 1.1 外链协议分流（browserInterceptHttp / Https） ✅

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

---
**✅ 落地**（2026-08-17）：
- `plugins/sidebar/src/client/runtime-settings.ts` — prefs 字段 + parse + 默认值
- `plugins/sidebar/src/client/intercept.ts` — 新增纯函数 `isLinkProtocolIntercepted(protocol, prefs)`（协议闸门，可单测）
- `plugins/sidebar/src/client/plugin.tsx` — stopLink 主开关后接协议闸门，urlTarget 认领与 browser 兜底都受协议约束
- `plugins/sidebar-desktop/src/client/plugin.tsx` — browser tab 齿轮里加两个协议开关行
- `plugins/sidebar/src/client/i18n.ts` — `settings.open-links-http(-description)` / `settings.open-links-https(-description)`（en/zh）
- `tests/intercept-protocol.test.ts` — 协议矩阵测试；`tests/sidebar-runtime-settings.test.ts` 补默认值/旧文档回退断言
- 验证：typecheck 0 / test 全绿 / build 0（含 consumer 类型门禁）

### 1.2 IME 组合键守卫 ✅

**上游做法**（`src/client/ime-guard.ts`）：
- 纯函数 `isImeComposition(event)`：`isComposing || keyCode === 229`
- `registerImeGuard()`：document **capture 阶段** keydown/keyup，组合键 `stopPropagation()`——在 React 委托和任何内联第三方组件之前拦截，防方向键/回车/空格被页面代码劫持（IME 候选选择被打断）；不阻止默认行为（浏览器原生 IME 不受影响）；HMR-safe disposer

**我们现状**：无。自研查看器风险低，但内联 iframe（HTML 预览、未来上游组件）场景需要。

**移植方案**：
1. 新建 `plugins/sidebar/src/client/ime-guard.ts`（照搬上游：纯函数 + 注册函数）
2. `plugin.tsx` `apply()` 的 effect 里 `ctx.effect(() => registerImeGuard(), 'oh-dsh-desktop: IME composition guard')`
3. 单元测试：`tests/ime-guard.test.ts`（isImeComposition 判定 + 注册/注销）

**验收**：中文输入法候选期按方向键/回车/空格，页面组件（数字步进、按钮）不响应；`pnpm test` 含守卫测试。

---
**✅ 落地**（2026-08-17）：
- `plugins/sidebar/src/client/ime-guard.ts` — 照搬上游（纯函数 + capture 注册/disposer）
- `plugins/sidebar/src/client/plugin.tsx` — 装配 effect 注册（disposer 随卸载清理）
- `tests/ime-guard.test.ts` — 纯判定测试 + document stub 上的注册/capture 语义/disposer 测试（node --test 无 jsdom，用最小 document stub 验证 capture-phase 注册与组合键 stopPropagation）
- 验证：typecheck 0 / test 全绿 / build 0

### 1.3 Tab 条滚轮横向滚动 ✅

**上游做法**（`src/client/TabBar.tsx`）：
- 非 passive 原生 `wheel` 监听（React onWheel 在 root 是 passive，`preventDefault` 无效）：modifier 键（shift/ctrl/cmd/alt）放行（shift=原生横向、ctrl/cmd=缩放）；`scrollWidth <= clientWidth` 不拦截（页面正常滚）；`deltaMode` 换算（1→16、2→clientWidth）；`scrollLeft += (deltaX + deltaY) * unit`

**我们现状**：`SurfaceTabStrip`（`plugins/shared/surface-tab.tsx`）无滚轮处理，tab 溢出时只能拖滚动条。

**移植方案**：
1. `plugins/shared/surface-tab.tsx` 的 `SurfaceTabStrip`：加 `ref` + 上述 wheel 逻辑（放 `surface-tab.tsx` 内，center 条与右栏条共用）
2. 测试：`tests/surface-tab-wheel.test.ts` 或并入现有测试（纯逻辑抽 `shouldConsumeWheel(el, event)` 便于测试）

**验收**：右栏 tab 溢出时鼠标滚轮横向滚动；不溢出时页面正常滚动；shift/ctrl/cmd 滚轮行为不变。

---
**✅ 落地**（2026-08-17）：
- `plugins/shared/tab-strip-wheel.ts`（新）— 纯逻辑抽离：`hasTabStripWheelModifier`（modifier 放行）、`tabStripWheelDelta`（deltaMode 换算）、`resolveTabStripScroller`（自元素/最近可横向滚动祖先，center scroller 与右栏 `.oh-dsh-side-tabs` 两种宿主共用）、`bindTabStripWheel`（非 passive wheel 挂载/disposer）
- `plugins/shared/surface-tab.tsx` — `SurfaceTabStrip` 加 ref + effect 挂 `bindTabStripWheel`
- `plugins/sidebar/src/client/SideToolsPanel.tsx` — 右栏 `TabStrip`（`.oh-dsh-side-tabs` 滚动容器）同样挂 `bindTabStripWheel`
- `tests/tab-strip-wheel.test.ts` — modifier 矩阵 / deltaMode 换算 / scroller 解析（自溢出 + 祖先溢出 + 无溢出）
- 验证：typecheck 0 / test 全绿 / build 0

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

---
**✅ 落地**（2026-08-17）：
- `plugins/sidebar/src/client/runtime-settings.ts` — `htmlViewerNoSandbox` / `htmlViewerDefaultUnsafe`（默认 false）+ parse
- `plugins/sidebar/src/client/files/html-sandbox.ts`（新）— 纯决策 `resolveHtmlSurfaceUnsafe(global, default, override)`（全局开关无条件胜出；每 surface 用户开关覆盖默认）+ `htmlIframeSandboxAttribute`
- `plugins/sidebar/src/client/files/file-viewers.tsx` — `HtmlFileViewer` 改造成状态行式工具栏（解锁/恢复按钮 + 红色警告），订阅 runtime prefs，`useSyncExternalStore` 实时生效
- `plugins/sidebar/src/client/builtins/deps.ts` + `plugin.tsx` — `runtimeSettings` 服务注入 builtins
- `plugins/sidebar/src/client/builtins/viewers.tsx` — html viewer 注册 settings.toggles（两行开关）
- `plugins/sidebar/src/client/side-tools.css` — 工具栏按钮 + 警告条（token：`--dsw-alias-state-error-primary` / `--dsw-alias-bg-layer-1`）
- i18n：`settings.html-no-sandbox(-description)` / `settings.html-default-unsafe(-description)` / `files.viewer.html-unlock/-restore/-unsandboxed-warning`（en/zh）
- `tests/html-sandbox.test.ts` + `tests/sidebar-runtime-settings.test.ts` 扩展
- 验证：typecheck 0 / test 全绿 / build 0

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

---
**✅ 落地**（2026-08-17）：
- `plugins/sidebar/src/client/runtime-settings.ts` — `terminalFontFamily`（默认 ''）、`terminalFontSize`（默认 13，9-32 钳制）+ parse
- `plugins/panel-controls/src/terminal/panel-store.ts` — 纯助手 `terminalFontPrefActions(family, size)`（''/13 默认 = 零动作，防覆盖持久化字体）+ `hasPersistedDockState(storage, scope)`（新会话无持久化字体时播种全局 prefs）
- `plugins/panel-controls/src/terminal/plugin.tsx` — `DesktopPanels.setTerminalFontPreferences(family, size)`：启动首次 sync 只播种 FRESH dock（不碰已持久化 dock），此后每次变更 live 应用到当前 dock；xterm 字体通过既有 `state.fontFamily/fontSize` → `TerminalView` props 实时生效
- `plugins/sidebar/src/client/plugin.tsx` — `syncRuntime` 把两个字段传给 panels
- `plugins/sidebar/src/client/builtins/tabs.tsx` — terminal 卡片齿轮加 text（placeholder）/number（min 9 / max 32 / unit px）两行
- i18n：`settings.terminal-font-family(-description/-placeholder)` / `settings.terminal-font-size(-description)`（en/zh）
- `tests/terminal-panel-store.test.ts`（pref actions 映射 / 持久化探测）+ `tests/sidebar-runtime-settings.test.ts` 扩展
- 验证：typecheck 0 / test 全绿 / build 0

**决策点（记录）**：全局字体 prefs 与 panel-controls 既有 per-dock Aa 弹窗（per-session 持久化）并存——全局 prefs 是设置页入口，变更时 live 推送到当前 dock 并播种无持久化记录的新会话 dock；启动首次同步不覆盖已持久化 dock 字体（`fontsInitialized` 标记）；设置页重置只还原 prefs 文档，不重置 dock 本身（Aa 弹窗仍可单独重置）。默认字号与 panel-store 一致取 13（计划文 14 为笔误，上游同 13）。

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
**✅ 落地**（2026-08-17）：
- `plugins/sidebar/src/client/files/file-selection-reference.ts` — 扩展 `SELECTION_LIMIT`(500) / `SelectionLines` / `headerOf` / `buildSelectionInsert` / `linesOfSelection`+`lineAt`（对齐上游 selection-payload.ts，相对路径复用 `shared/path.ts` 的 `relativePathOf`）
- `plugins/sidebar/src/client/files/selection-insert-popup.tsx`（新）— 浮窗组件：document capture 级 mouseup 监听（选区须落在宿主容器内）+ 滚动/blur 自动关闭 + "添加到对话"按钮；chars/行号 meta 行；超限提示
- `plugins/sidebar/src/client/review/review-comments.ts` — 新增 `appendToComposer(text)` 通道（bridge `appendText`：当前会话 composer draft 直接追加，`'inserted' | 'unavailable'`）
- `plugins/sidebar/src/client/files/content-viewer.tsx` + `markdown-viewer.tsx` — md 预览（Scrollable ref 转发）与 Pierre 代码/文本视图挂载浮窗；`cwd`/`reviewComments` props 透传
- `plugins/sidebar/src/client/builtins/viewers.tsx` + `SideToolsPanel.tsx` FileView — viewer render input 补 `scope`（sessionId+cwd），reviewComments 注入
- `plugins/sidebar/src/client/side-tools.css` — 浮窗样式（`--dsw-alias-bg-layer-1` / border token）
- i18n：`files.selection-add` / `files.selection-over-limit`（en/zh）
- `tests/selection-payload.test.ts` — header 相对路径/行号、fence 构造、>500 退化、linesOfSelection 唯一命中/歧义/缺失
- 验证：typecheck 0 / test 全绿 / build 0

### 2.4 终端 shell 配置（新增，上游 `fd9544f`）

**上游做法**（host shell 解析，`fd9544f`）：
- 解析优先级：**显式 shell 配置 → `DSH_SIDEBAR_SHELL` 环境变量 → PATH/known-dir 探测 `pwsh.exe`（Windows；ProgramW6432 优先，兼容 32 位 Node）→ inbox PowerShell 5.1 兜底**（POSIX 侧保留 `$SHELL` 并 trim）
- 同一解析结果同时供 **UI 终端 tab（PtyManager）** 与 **model 端 `terminal_*` 工具（AgentPtyRegistry）**
- 解析器接受可注入的 platform/env/exists 选项，Windows 分支可在 ubuntu CI 单测

**我们现状**：`plugins/sidebar-host/src/pty-manager.ts` 只有 `defaultShell()`（读 `process.env.SHELL`，空则回退平台默认），无显式配置、无 `DSH_SIDEBAR_SHELL`、无 pwsh 探测链；UI 终端与 agent 终端各自取 shell（需核对是否同源）。

**移植方案**：
1. `sidebar-host`：把 `defaultShell` 升级为解析链（显式配置 → 环境变量 → 探测 → 兜底），抽 `resolveShell(options)` 纯函数（platform/env/exists 可注入）+ 单测；UI 终端与 agent-pty 统一走它
2. 显式配置入口：settings 命名空间加 `terminalShell` 字段（host `config.ts` 的 schema + client `runtime-settings.ts` 对应字段 + terminal 卡片 toggles text 行）——与 #5 字体设置同一齿轮弹窗
3. 配置变化时已开终端不回滚（新终端生效即可，对齐上游行为）

**验收**：设置页 terminal 卡片可配 shell 路径；设 `DSH_SIDEBAR_SHELL` 后新开终端用该 shell；Windows 链（探测/兜底）有单测覆盖；agent 终端工具与 UI 终端 shell 一致。

---
**✅ 落地**（2026-08-17）：
- `plugins/sidebar-host/src/shell-resolver.ts`（新，fork）— 纯解析器 `resolveShell(options)`（platform/env/exists/loginShell 可注入）：部署 `shell` 配置 → 设置页 `terminalShell` → `DSH_SIDEBAR_SHELL` → Windows pwsh.exe 探测（PATH + known-dir，ProgramW6432 优先）→ POSIX `$SHELL`/passwd login shell → 兜底（powershell.exe / /bin/bash）；`windowsPwshCandidateDirs` + `shellSpawnArgs`（POSIX 登录 shell `-l`）
- `plugins/sidebar-host/src/pty-manager.ts` — `PtyManager` 改收 shell **thunk**（spawn 时解析，新终端生效）；`defaultShell()` 保留为 `resolveShell` 零参包装
- `plugins/sidebar-host/src/agent-pty.ts` — `AgentPtyRegistry` 同 thunk + `shellSpawnArgs()`；UI 终端与 agent `terminal_*` 工具同源
- `plugins/sidebar-host/src/config.ts` — `SidebarConfig.shell`（部署级最高优先）+ `PrefsSchema.terminalShell`（用户设置）；`plugins/shared/prefs-shared.ts` 同字段
- `plugins/sidebar-host/src/index.ts` — settings watch 把 `terminalShell` 喂给共享 thunk
- client：`runtime-settings.ts` `terminalShell`（默认 ''）+ terminal 卡片齿轮 text 行（placeholder）
- i18n：`settings.terminal-shell(-description/-placeholder)`（en/zh）
- `plugins/sidebar-host/VENDOR.md` — fork delta 已记录（pty-manager / shell-resolver / agent-pty / config / index）
- `tests/shell-resolution.test.ts` — 全链优先级 / trim / Windows 探测（PATH、ProgramW6432、兜底）/ candidate dirs 去重 / spawn args
- 验证：typecheck 0（含 host 第二遍）/ test 全绿 / build 0

**决策点（记录）**：① 基线 `fc4031e` 实际已回退 `fd9544f` 的探测链（HEAD 只有 login-shell 链）——本实现取计划（fd9544f）超集 + HEAD 的 passwd/`-l` 改进，优先级：部署配置 → 设置页 → `DSH_SIDEBAR_SHELL`（双平台都查）→ 探测/login 链 → 兜底。② 解析时机 = spawn 时（thunk），不是插件启动时：设置变化对新终端生效、已开终端不回滚（对齐上游"新终端生效即可"）。

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

---
**✅ 落地**（2026-08-17，务实版全量）：
- `plugins/sidebar/src/sidebar-preferences.ts` — `PersistedSidebarSession` 加 `bottomTabs?` / `bottomActiveId?`（旧文档解析为空工作台，非破坏迁移）
- `plugins/sidebar/src/client/contract.ts` — snapshot 加 `bottomTabs` / `bottomActiveId`；服务接口加 `moveTab` / `moveTabToBottom` / `moveBottomTabToSide` / `moveBottomTab` / `activateBottomTab` / `closeBottomTab`；新 feature `'bottomWorkbench'`；`SidebarTabDragPayload` 类型
- `plugins/sidebar/src/client/sidebar-service.ts` — 六个新方法 + `openTab` 去重跨底部工作台（命中 → 聚焦 docked tab）+ writeTarget 支持 bottom 槽（持久化 + 快照发布）
- `plugins/sidebar/src/client/tab-drag.ts`（新）— 纯函数：payload 序列化/解析、`tabDropSideOf`（chip 中点分左右）、`fullTabDropIndex`（可见条位置 → 全数组索引）、`reorderIndexAfterRemoval`
- `plugins/shared/surface-tab.tsx` — `SurfaceTab` 加可选 drag props（center 条不传不受影响）
- `plugins/sidebar/src/client/SideToolsPanel.tsx` — 右栏 TabStrip 拖拽排序（含 pinned 过滤索引映射）+ 跨区 drop
- `plugins/sidebar/src/client/bottom-workbench.tsx`（新）— 底部第二工作台：SurfaceTabStrip + 活动 tab 内容（descriptor.render）+ 空态拖放区 + 徽标/关闭
- `plugins/sidebar/src/client/workspace-tools.tsx` — 工作台挂载进对话列（PTY dock 之上，MutationObserver 自愈定位）
- `plugins/sidebar/src/client/side-tools.css` — drop 标记（before/after 插入引导线）+ 工作台样式（token）
- i18n：`bottom-workbench.*`（en/zh）
- `tests/tab-drag.test.ts`（payload/中点/索引映射/移除偏移）+ `tests/sidebar-bottom-workbench.test.ts`（排序持久化/跨区移动/激活修复/onClose/去重聚焦/重载恢复/旧文档迁移）
- 验证：typecheck 0 / test 全绿 / build 0

**决策点（记录）**：① 状态模型按计划走**扩展 `DesktopSidebarService`**（不搬 reducer）——`writeTarget` 加可选 bottom 槽，persist + 快照同一路径。② 工作台布局 = 对话列中 PTY dock **上方**（非 dock 内 tab 切换）：panel-controls 一直把 dock 保持为列尾，工作台 `insertBefore('#oh-dsh-terminal-root')`，顺序自洽。③ 跨区语义：拖入底部 = 移动（非复制/拆分），被拖 tab 成为目标 pane 的活动 tab；右栏活动 tab 被移走时激活邻位。④ 底部 tab 内容复用 descriptor.render（SidebarRenderProps），中间工作区零改动。

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
**✅ 落地**（2026-08-17）：
- **前置验证结论**：vendored host 契约（`plugins/sidebar-host/src/context-types.ts`，handoff 时按本 runtime 核实）镜像了 sessions 列表 feed 的 `parentId`/`origin`（每 session）、`subagentsByParent`（每父会话目录）、`jobsBySession`（session/jobs push 镜像）；上游 SubagentView 消费同一形状。桌面端 CDP 探测未发现全局暴露的 runtime 服务实例（无 window 级句柄），故实现按**结构读取 + 优雅降级**：feed 出现 parent 关系就画拓扑树，否则只显示提示 + jobs 列表（计划的风险回退内建，无需两套面板）
- `plugins/shared/sidebar-api.ts` — wire 契约补 `'jobs.output'` / `'jobs.kill'`（scope 走既有 sessionId 注入）
- `plugins/sidebar/src/client/better-sidebar-api.ts` — `jobOutput(scope, id, signal)` / `jobKill(scope, id, reason?)`
- `plugins/sidebar/src/client/client-types.ts` — session summary 补 `parentId`/`origin`/`running`；list snapshot 补 `subagentsByParent`/`jobsBySession`；SessionsService 补可选 `setSubagentCatalogOpen`/`refreshSubagents`
- `plugins/sidebar/src/client/subagent/subagent-model.ts`（新）— 纯函数：`buildSubagentTree`（持久 parent 链成树，孤儿可见）、`subagentAutoOpenDecision`（新子代理/新任务 → 自动展开，prefs 分别门控）、`jobRowsFor`（新→旧）
- `plugins/sidebar/src/client/subagent/subagent-panel.tsx`（新）— 拓扑树（运行态圆点/当前标记/点击跳转/刷新）+ 目录子项（activity/mode）+ jobs 列表（状态 pill、输出回放、终止按钮、内联 <pre>）
- `plugins/sidebar/src/client/builtins/tabs.tsx` — 注册 `id: 'subagent'`（order 30，single）+ `settings.toggles`（autoOpenSubagent / autoOpenJobs）
- `plugins/sidebar/src/client/runtime-settings.ts` — `autoOpenSubagent` / `autoOpenJobs`（默认 true）+ parse（shared prefs + host PrefsSchema 本就有同名字段）
- `plugins/sidebar/src/client/SideToolsPanel.tsx` — 新增 `ToolIcon kind: 'subagent'` 分支图标
- `plugins/sidebar/src/client/side-tools.css` — 树/任务行样式（token；状态色走 state-success/error 别名）
- i18n：`subagent.*` + `settings.auto-open-*`（en/zh）
- `tests/subagent-model.test.ts`（成树/孤儿/自动展开决策/任务排序）+ runtime-settings 扩展
- 验证：typecheck 0 / test 全绿 / build 0

**决策点（记录）**：① 数据源验证深度：CDP 无全局句柄可探，采纳 vendored 契约（handoff 已核实）+ 结构降级双保险，不为此新增 host 路由。② auto-open 语义 = 打开侧边栏并激活 subagent tab（面板自身订阅 sessions.list 前值对比）；"展开"即 tab 激活，无二级折叠态。

---

## 4. P3 工程收尾

### 4.1 token 统一（随各能力走） ✅
- 所有搬运组件**不引入上游 CSS modules**：样式内联/独立 css 文件，色值一律用 `--oh-dsh-*` / `--dsw-alias-*`（`plugins/shared/theme.css` 已映射）
- **补充（上游 `3c196ff` 经验）**：面板表面用**通用卡片令牌**（如 `--dsw-alias-bg-layer-1`）而非宿主专属 token，皮肤切换自动跟随；**alpha 阈值回退**——`transparent` 与 `alpha < 0.9` 的半透明值一律回退不透明底色（防终端/编辑器文字叠在皮肤背景画上），`≥0.9` 近不透明值放行
- 验收：grep 搬运组件无硬编码 hex；主题切换（desktop-skins）下新组件跟随；半透明皮肤下文字可读

---
**✅ 落地**（2026-08-17）：
- 新增样式全部走 token：html 工具栏/警告条、划词浮窗（`--dsw-alias-bg-layer-1` 不透明卡片）、底部工作台（`color-mix … 96%` ≥0.9 放行）、subagent 树/任务行（state-success/error 别名）；`var(--token, #fallback)` 兜底值沿用仓库既有模式（surface-tab.css 同款）
- **alpha 阈值经验落地**：全仓唯一低于 0.9 的表面 `.oh-dsh-right-rail-reopen`（88% 半透明图标按钮）改为不透明 `--dsw-alias-bg-layer-1`（见 `surfaces/center-surface.css`）；终端 dock 本就用 `--dsw-alias-bg-layer-1`；center 条 92% 与工作台 96% 均 ≥0.9 放行
- 审计脚本：对新增区块做 `#hex`/裸 `rgb()` 扫描（结果：全部在 token fallback 或既有 shadow 模式内）

### 4.1a z-index 层级核对（新增，上游 `3c196ff`） ✅
- 上游把面板 z-index 降到 DSH 浮层栈（100+）**之下**（面板 40 / 按钮簇 45），修复 Cordis 弹出框被底部工作台遮挡（#52）
- **我们现状**：`sidebar.css` root `z-index: 2147483647`（最高层）、设置弹窗 backdrop `2147483000`——需要**验证是否盖住 DSH 官方弹窗/浮层**（设置弹窗、命令面板、approval 等）
- 核对方式：桌面端 CDP 打开 DSH 设置/命令面板，检查是否被侧栏 overlay 遮挡或无法交互；若无遮挡问题（我们的 overlay 有 `pointer-events: none` 兜底 + 折叠时 0 宽），保留现状并记录理由；若有，参考上游降级到浮层栈之下
- 验收：记录核对结论（问题 or 无问题 + 依据）；若需调整，z-index 收编进 token 层（`--oh-dsh-z-panel` 等）

---
**✅ 核对结论（2026-08-17，桌面端 CDP 实证）**：**无问题，保留现状**。依据：
1. root 的 2147483647 是**布局必需**而非偏好——面板顶行（tabs/+菜单/窗口控制）是窗口拖拽带内的交互条，root 必须盖过 center 拖拽区才能点中（sidebar.css 注释）；DSH 运行时自身也采用同款模式（左栏 ASIDE z-index 9000 + `pointer-events: none`）
2. 遮挡风险有界：root `pointer-events: none`、折叠时 0 宽、无背景（只有面板卡片实际绘制）；DSH 官方弹窗（设置/命令面板/approval）居中布局，常规宽度不进入右侧 300px 面板带；即便重叠，卡片外的区域仍可交互
3. 上游 #52 场景（底部面板盖 Cordis 弹窗）**不适用**：我们的底部工作台零 z-index（对话列常规流内），body 级 portal 浮层永远盖在其上
4. 设置弹窗 backdrop（2147483000）与 portal 菜单/对话框（2147483647）都是应用自身模态面，高于 root 属预期
- 无需 z-index 收编 token（无调整项）；selection-insert 浮窗 z-index 200 位于面板卡片（z 9100 自建 stacking context）内部，无泄漏

### 4.2 CI 挂载冒烟门禁（遗留项） ✅
- 上游 `scripts/e2e-mount.sh`：npm pack → `dsh plugin add <tarball>` 装进 scratch profile → 真实 `dsh web` → Playwright 无头断言 mount/无 crash/逐个打开内置 tab
- 我们现有 `scripts/smoke-runtime.mjs`（真实 Electron 冒烟）；补"打包产物 → 独立 profile → 无头渲染"一层
- 验收：CI 上 npm 打包产物可挂载渲染、无错误条

---
**✅ 落地**（2026-08-17）：
- `scripts/smoke-pack.mjs`（新）— `pnpm pack` → `dsh plugin add <tarball>` 装进 scratch desktop profile → 复制 staged runtime 并**移除其中 @oh-dsh/desktop**（打包产物成为唯一来源）→ 真实 boot → 断言：① boot graph 四个 bundle 全注册且 inject 清单与**打包产物 manifest** 一致；② 各 client bundle 200 + 自注册，sidebar bundle 含迁移内置标记（bottom-workbench/subagent/tab-strip-wheel/selection-insert）；③ 打包 host 的 `/sidebar/api/settings.get` 返回 ok 且含迁移词汇（autoOpenSubagent）；④ Electron 真实渲染（`scripts/smoke-pack-client.cjs`，独立于 smoke-client 的几何断言）看到 sidebar root + 终端 dock 挂载、无 "Failed to load plugins" 错误条
- `scripts/smoke-pack-client.cjs`（新）— 最小渲染 harness（mount + 无错误条粒度）
- `package.json` — `smoke:pack` 脚本；`.github/workflows/ci.yml` — runtime job 新增 "Smoke the packed artifact" 步骤（xvfb-run）
- 关键实现细节：profile 必须用 `ensureDesktopProfile` 初始化（CLI 原生 init 缺 `@deepseek-ai/dsh-web-app`，它提供 webServer——缺了 boot 起不来）；`cp -al` 硬链复制 691MB runtime 秒级完成
- 本地验证：`node scripts/smoke-pack.mjs` 全绿（打包产物挂载成功）

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
P1-4 终端 shell ──（host 解析链，独立）
        │
P2-1 双工作台 ────（大件，独立排期；可先做右栏内排序）
P2-2 subagent ────（先做前置验证：sessions 子代理链）
        │
P3-1 token 检查（穿插）· P3-1a z-index 核对 · P3-2 CI 冒烟（独立）
```

**每步独立可交付**：P0 三件完成即合入验证；P1 逐件合入；P2 单独立项。

> **执行结果（2026-08-17）**：全部 12 项完成并逐一验证（typecheck 0 / test 全绿 / build 0；CI 冒烟本地全绿）。各节均附 ✅ 落地清单与决策点记录。

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
- 终端 shell（`fd9544f`）：host shell 解析链（PtyManager/AgentPtyRegistry 共用）
- 皮肤/z-index（`3c196ff`）：令牌驱动 + alpha 阈值回退 + z-index 层级（面板 40 / 按钮簇 45）

**我们（oh-dsh-desktop）**：
- prefs：`plugins/sidebar/src/client/runtime-settings.ts`、`plugins/sidebar/src/sidebar-preferences.ts`
- 拦截：`plugins/sidebar/src/client/plugin.tsx`（stopLink/stopOpenPath）、`intercept.ts`
- 壳：`plugins/sidebar/src/client/SideToolsPanel.tsx`、`workspace-tools.tsx`、`plugins/shared/surface-tab.tsx`
- 查看器：`plugins/sidebar/src/client/files/file-viewers.tsx`、`content-viewer.tsx`、`markdown-viewer.tsx`
- 终端：`plugins/panel-controls/src/terminal/`（PTY dock）
- composer 通道先例：`plugins/sidebar/src/client/review/review-comments.ts`
- host 路由：`plugins/sidebar-host/src/jobs-routes.ts`（已 vendor）
