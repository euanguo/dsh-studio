# 桌面端调整交接文档（Desktop Adjustments Handoff）

> 用途：把 Oh-DSH-Desktop 在 fork 之上做过的**桌面端细节调整**完整记录下来，
> 防止在「最新上游 + 重放改造」的 rebase 过程中遗漏。本文覆盖的细节大多无法从
> 提交标题看出，必须对照代码与运行效果逐项核对。
>
> 基准状态：本地 `main` @ `79a275d`（含 **75 个**未推送提交，其中最后 5 个——
> `43e0833`/`a53f287`/`8c3506c`/`78b7405`/`79a275d`——是本文写作后新增的
> chrome 重构，已并入下文），DSH runtime 锁定 `0.1.0-rc.7`
> （`dsh-source.json` @ `99f6f02f`）。

---

## 0. 一页速览（哪些是"桌面端专属"改动）

| # | 调整项 | 位置 | 一句话 |
|---|--------|------|--------|
| 1 | macOS 红绿灯垂直居中于 42px 顶栏 | `src/main.ts` | `trafficLightPosition: {x:16, y:14}`，y = (42−14)/2 |
| 2 | 顶栏红绿灯预留（状态驱动，无测量） | `plugins/sidebar/src/client/chrome-geometry.ts` + `center-surface.css` | `--oh-dsh-traffic-left` = 16+52+8 = **76px**；`.is-left-collapsed` 按 `max(8px, 76−56)` = 20px 垫 |
| 3 | Windows 右侧 WCO 预留（实时跟随） | 同上 + `windowControlsOverlay` | `--oh-dsh-traffic-right` = 窗口宽 − overlay rect 右缘，`geometrychange` 驱动 |
| 4 | 统一顶栏（42px，in-flow，无 fixed portal） | `center-surface-host.tsx` / `center-surface.css` | 左 toggle（**常驻**）+ tab scroller + 右 reopen；垫值全由状态 class 决定 |
| 5 | 窗口无标题条：会话 header 即拖拽区 | `src/client.ts` `DESKTOP_CHROME_CSS` | `DESKTOP_TITLEBAR_HEIGHT = 0` |
| 6 | 模态挂起所有拖拽区 | `src/client.ts` | `:has([aria-modal='true']) body *` no-drag |
| 7 | ~~兜底 28px 隐形拖拽条~~ **已删除**（`79a275d`） | `src/client.ts` | 顶栏 strip 常驻覆盖所有窗口（含 preview），规则为死代码 |
| 8 | 左栏顶部 28px 避让红绿灯 | `src/client.ts` | `[data-slot='sidebar'] > div { padding-top: 28px }` |
| 9 | 设置弹层层级：dialog 1000、侧栏面 999 | `src/client.ts`（源自 `5aeff19`） | 弹层压在侧栏之上，原生菜单之下 |
| 10 | 平台化窗口 chrome | `src/main.ts` `createWindow` | macOS hiddenInset+vibrancy / Win 透明 overlay caption / 其他 frameless |
| 11 | 窗口图标（打包 vs 开发） | `src/main.ts` `windowIconPath` | resources 优先，dev 回退 assets/icons |
| 12 | UI 缩放 1.12 | `src/main.ts` | `DEFAULT_UI_ZOOM_FACTOR` |
| 13 | 剪贴板权限门 | `src/permissions.ts` | 仅 runtime origin 主窗口主帧 |
| 14 | Hero 品牌文案替换 | `src/client.ts` | "Into the Unknown" → "Oh-DSH-Desktop" |
| 15 | 左栏 = 自研 desktop-left-rail | `plugins/desktop-left-rail` | 禁用官方 ui-workspace，project→worktree→session 树 |
| 16 | 皮肤 = desktop-skins | `plugins/desktop-skins` | 替换上游 skins/vision，token 校验脚本 |
| 17 | 右栏所有权声明 | `plugins/panel-controls` | `claimRightPanel/releaseRightPanel`，唯一 #root squeeze |
| 18 | pinned-summary 不再 squeeze #root | `plugins/pinned-summary` | 288px 固定面板，z-index 9000 |
| 19 | Marketplace 会话切换自动关闭 | `plugins/plugin-marketplace` | `session-navigation.ts` |
| 20 | 热重载 dev 启动器 | `scripts/dev.mjs` | esbuild + bundle sync + Electron 重启 |

---

## 1. 窗口 chrome（主进程，`src/main.ts`）

### 1.1 平台分叉（`createWindow`）

```ts
titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'hidden',
// darwin 追加：
trafficLightPosition: { x: 16, y: 14 },   // 见 §2 红绿灯居中
vibrancy: 'sidebar', visualEffectState: 'followWindow',
// win32 追加：
titleBarOverlay: { color: '#00000000', symbolColor: '#7f858f', height: 44 },
backgroundMaterial: 'acrylic', hasShadow: true, roundedCorners: true, thickFrame: true,
// 其他平台（linux 等）：transparent: true（frameless，渲染层自绘 chrome）
```

- 窗口默认 1280×840，preview 1160×760，最小 900×620。
- `backgroundColor` 跟随 `nativeTheme.shouldUseDarkColors`：`#202020` / `#f7f7f5`。
- `webPreferences`：`contextIsolation: true`、`sandbox: true`、`webviewTag: true`、
  `spellcheck: true`。
- **缩放**：`window.webContents.setZoomFactor(1.12)`（`DEFAULT_UI_ZOOM_FACTOR`，
  第 38 行）。UI 侧所有像素值（42px 顶栏、28px 按钮等）都是 1.12 倍下的设计值，
  改缩放系数会连带破坏顶栏/红绿灯对齐，勿动。

### 1.2 窗口图标（`windowIconPath`，第 202 行）

打包态：`process.resourcesPath/oh-dsh-desktop.png`；开发态：回退
`assets/icons/512x512.png`。Linux 需完整图标集（`scripts/generate-icon-linux.sh`）。

### 1.3 其他主进程细节

- 原生菜单：`Menu.setApplicationMenu(Menu.buildFromTemplate(template))`（§6.1 提到
  的 findSettingsButton 逻辑在 client 侧）。
- IPC 表见 §3。

---

## 2. ★ 红绿灯位置与居中定位（用户重点提及，最易遗漏）

> 本节经历了两轮重构（`da813c6` → `43e0833` → `a53f287`），以下描述的是
> **当前最终态**：chrome-geometry 只发布两个原始事实，所有垫值由 CSS 状态
> class 计算，**任何元素测量都被移除**。

### 2.1 主进程锚点（`src/main.ts`）

```ts
// 第 228–230 行
// Vertically center the traffic lights on the 42px unified top
// rail: the cluster is 14px tall, so y = (42 - 14) / 2 = 14.
trafficLightPosition: { x: 16, y: 14 },
```

- **只对 macOS 生效**（`darwin` 分支内）；Windows/Linux 不设，红绿灯不存在。
- x=16 是左缘内缩；y=14 是**垂直居中**：红绿灯簇高 14px，顶栏高 42px，
  (42−14)/2 = 14。若顶栏高度改成别的值，这个公式必须同步重算。

### 2.2 几何 IPC（`desktop:chrome-geometry`，`src/main.ts` 第 685 行）

```ts
ipcMain.handle('desktop:chrome-geometry', () => ({
  platform,
  trafficLight: platform === 'darwin' ? { x: 16, y: 14 } : null,
  trafficLightWidth: 52,   // 精确值：三个 12px 按钮 + 8px 间隙（Apple HIG）
}))
```

- **簇宽从估算 58 改为精确 52**（`43e0833`）：系统绘制的按钮相对我们自己的
  锚点位置固定，可确定计算。`ChromeGeometry` 契约在
  `plugins/shared/desktop-contracts.ts`。
- preload 暴露：`window.dshDesktop.chrome.getGeometry()`（`src/preload.ts`）。

### 2.3 渲染层发布（`plugins/sidebar/src/client/chrome-geometry.ts`）—— 只发两个事实

`applyChromeGeometry()`（workspace-tools.tsx 第 212 行启动，HMR-safe）：

- **`--oh-dsh-traffic-left`**（macOS，只设一次）：`anchor.x(16) + 簇宽(52) +
  呼吸间隙(8) = 76px`（`TRAFFIC_LIGHT_GAP = 8`，macOS 标题栏惯例）；非 macOS
  为 `0`（Windows 的系统按钮在右上，左缘无需预留）。主进程应答前保持 CSS
  fallback。
- **`--oh-dsh-traffic-right`**（Windows，实时）：`max(0, window.innerWidth −
  (rect.x + rect.width))` —— overlay rect 是**安全区**（窗口宽减按钮区），
  监听 `geometrychange` 跟随移动/缩放。macOS 上为 0。
- **没有**任何元素测量（`a53f287` 删掉了 43e0833 引入的 ResizeObserver +
  MutationObserver + transitionend/animationend 全套）。原因：测量会形成
  反馈回路——行内边距喂给测量、测量又算出行内边距，曾把 300px 面板的顶行
  撑到 332px（右对齐动作被钉死在 tab 上）。现在顶行精确贴合面板
  （`width:100% + min-width:0`，side-tools.css），`margin-left:auto` 把动作
  推到右缘。

### 2.4 CSS 状态规则（`center-surface.css` + `side-tools.css`）—— 垫值的唯一归属

`:root` fallback（center-surface.css 第 26–30 行）：

```css
--oh-dsh-traffic-left: 74px;   /* 主进程应答前的 macOS fallback */
--oh-dsh-rail-offset: 56px;    /* DSH 收起态 activity rail 自身宽度，:root 常量 */
```

三条状态规则（`a53f287`，CDP 验证过）：

1. **strip 左侧**：`.oh-dsh-center-tabs-strip.is-left-collapsed`
   （左栏收起，host 第 494 行按 `leftRailOpen === false` 挂 class）：
   `padding-left: max(var(--oh-dsh-space-2), calc(var(--oh-dsh-traffic-left, 76px) − var(--oh-dsh-rail-offset, 56px)))`
   → **max(8px, 76−56) = 20px**，toggle 恰好落在红绿灯右侧 76px 处。
   Windows 上 `--oh-dsh-traffic-left` 为 0，calc 为负 → max 夹到 8px。
2. **strip 右侧**：`.oh-dsh-center-tabs-strip.is-right-free`（右栏关闭，strip
   右缘抵窗口边）：`padding-right: var(--oh-dsh-traffic-right, var(--oh-dsh-space-2))`
   —— 为 Windows 右上角系统按钮预留。
3. **右栏顶行**：`[data-oh-dsh-sidebar-full-width='true'] .oh-dsh-side-top`
   （workspace-tools 由 `maximized || narrowViewport` 发布——与 overlay/
   side-by-side 判定同一状态）→ `padding-left: var(--oh-dsh-traffic-left, 76px)`，
   面板整窗覆盖（x=0）时预留完整红绿灯区。

### 2.5 左栏区域的 28px 避让（`src/client.ts` 第 85–90 行）

```css
html[data-oh-dsh-desktop='true'] [data-slot='sidebar'] > div {
  padding-top: 28px;
}
```

红绿灯落在窗口左上角（约 28px 高），左栏顶部按钮行必须整体下移避让。
左栏内 28px 尺寸的按钮/行（`WorkspaceBrowser.module.css` 中大量 28px）与此呼应。

### 2.6 CDP 验证过的关键数值（改动时对照）

| 场景 | 期望值 |
|------|--------|
| 左栏收起（macOS） | strip 左垫 **20px**，toggle 左缘在 **76px**（灯右缘后 8px 呼吸间隙） |
| 左栏展开（macOS） | strip 左垫 **8px**（无预留，toggle 常驻在 8px 处） |
| 面板最大化/窄视口 | 顶行左垫 **76px**，pinned tab 起点 **77px**（不钻灯下） |
| 面板 side-by-side | 顶行 299px，动作右对齐（1182..1272），无垃圾垫值 |

---

## 3. 统一顶栏（`plugins/sidebar`，`3bf6f74` 起的核心演进）

### 3.1 结构（`center-surface-host.tsx` 第 486–493 行 + CSS §2.4）

顶栏 = DSH 中间列（`.aOBRAa_centerCol`）的**正常流 flex 子元素**，位于会话槽
上方，**没有任何 fixed 定位**：

```
[左栏 toggle] [tab scroller（唯一滚动成员）] [右栏 reopen]
```

- **左栏 toggle**（`.oh-dsh-left-rail-toggle`）：**常驻渲染**（`43e0833` 起），
  是 DSH 左栏的**唯一管理入口**——DSH 自己的 header toggle 被 CSS 隐藏。
  label/aria-pressed 跟随状态（`收起左栏` = 展开态），28×28，`no-drag`。
  位置由 strip 的 `is-left-collapsed` 垫值决定（§2.4 规则 1）。
- **tab scroller**（`.oh-dsh-center-tabs-scroller`）：唯一可滚动成员
  （`flex: 1 1 auto; overflow-x: auto`，隐藏滚动条）；内部 tab 条 `flex: none`。
- **右栏 reopen**（`.oh-dsh-right-rail-reopen`）：仅右栏**关闭**时常驻右端，
  溢出 tab 永远滚不到它下面；strip 同时挂 `is-right-free` 为 Windows 按钮预留。
- **删除物**：旧的 `RailFloatControls`（portal + fixed 定位）与
  `is-left-collapsed` 硬编码 48px 补偿全部移除。
- 整条 strip 是 `-webkit-app-region: drag` 拖拽区，交互 chip 全部 `no-drag`；
  **不设高 z-index**（DSH 弹层要盖在它上面）。右栏顶行 `.oh-dsh-side-top`
  在拖拽带内 `no-drag`，右栏根 `#oh-dsh-sidebar-root` 保持 z-index 2147483647
  盖过 center strip（否则真实点击会落在下层拖拽区）。
- 面板展开时 surface body 占满列高（`--oh-dsh-center-col-height` 由
  ResizeObserver 维护，不用 100vh），会话槽 `display:none !important`。

### 3.2 `readLeftRailOpen` 语义修复（`dsh-dom.ts`，`3bf6f74`）

**既有 bug，必须保留这个修复**：DSH 左栏 toggle 的 aria-label 描述的是**动作**
而非状态 —— 左栏**展开**时 label 是「收起侧边栏 / Collapse sidebar」，点击会收起。
旧实现返回相反值，导致 toggle 显隐与左栏实际状态相反。

```ts
return label.includes('收起') || /collapse/i.test(label)
```

### 3.3 每工作区 tab 队列

tab 队列按 workspace 隔离（`1e96531` 起的 per-workspace tab queues），切工作区
不丢 tab。

---

## 4. 拖拽区规则（`src/client.ts` `DESKTOP_CHROME_CSS`）

1. `--oh-dsh-titlebar-height: 0px`：**没有**白色标题条。token 保留（0px）让
   marketplace / pinned-summary / panel 工具栏跟随。
2. **会话 header 即拖拽区**：`[data-slot='conversation'] header` → `drag` +
   `user-select: none`；header 内所有交互元素（button/a/input/select/textarea/
   role=button|link|tab/contenteditable）→ `no-drag` + `user-select: auto`。
3. **模态挂起**：`html:has([aria-modal='true']) body * { -webkit-app-region: no-drag }`
   —— Electron 拖拽区无视视觉层级，模态遮罩与弹层自身控件必须抢回指针。
4. **兜底拖拽条：已删除**（`79a275d`）。演进史：
   - `da813c6` 时代：无 header（空状态/新会话页）时 `body::before` 渲染隐形
     28px 拖拽条（z-index 2147483647）；
   - `8c3506c`：该条盖在已挂载的 center tab strip 之上吞掉其点击（Electron
     拖拽区无视层叠），加 `:not(:has(#oh-dsh-center-tabs-root))` 豁免；
   - `79a275d`：判定为死代码直接删除——sidebar 插件**无条件打包**（含隔离
     preview 窗口，同一 bundledPlugins 列表），`#oh-dsh-center-tabs-root`
     必然存在，strip 自身（42px drag 区）覆盖每个窗口。**不要复活它。**
5. **预览标签**：preview 窗口右上角胶囊 `data-oh-dsh-preview-label`。

---

## 5. 弹层层级（设置弹层 layering，源自 `5aeff19`）

`src/client.ts` 第 131–166 行：

- DSH 设置 dialog（`#root [role='presentation'] > [role='dialog']`）：
  `#root` → `z-index: 1000 !important; overflow: visible`；
  presentation 容器 → 1000 + 半透明遮罩（`rgb(0 0 0 / 22%)` + blur 6px）。
- 弹层打开时，侧栏面/摘要/市场收在 999（`#oh-dsh-sidebar-root`、
  `[data-oh-dsh-pinned-summary]`、`#oh-dsh-plugin-marketplace-root`）——
  **侧栏不得盖在设置之上**，同时 dropdown 控件可正常弹出（这是相对旧版
  `z-index: 2147483647` 的关键修正）。
- marketplace root 额外 `position: relative`。
- 挂载根选择器当前为 `#oh-dsh-sidebar-root`（workspace-tools.tsx 第 181 行
  设置 `element.id`，client.ts 弹层规则引用同名；`5aeff19` 时代的
  `#oh-dsh-desktop-sidebar-root` 旧名已不存在，两处若改名必须同步）。

---

## 6. preload 桥与命令（`src/preload.ts` + `plugins/shared/desktop-contracts.ts`）

`window.dshDesktop`（contextBridge，隔离、freeze）：

| 成员 | 说明 |
|------|------|
| `chooseWorkspace()` | 目录选择 |
| `getInfo()` | `DesktopInfo`（appDataPath/dshHome/platform/preview/profile/version） |
| `getRuntimeSnapshot()` | 运行时诊断 |
| `onCommand(listener)` | `DesktopCommand` 命令流（focus-composer / new-session / open-paths / show-settings / toggle-* 等） |
| `openExternal(url)` | 仅 http/https |
| `chrome.getGeometry()` | §2.2 |
| `pluginMarketplace.{dispatch,getSnapshot}` | 市场桥（结构性收窄，调用处自行窄化类型） |

`DesktopCommand` 全集在 `desktop-contracts.ts`；client 侧 `dispatch()` 在
`src/client.ts` 第 258 行起（含 `showSettings` 的 `findSettingsButton` 三级
回退逻辑，依赖 DSH rc.5 的 `[data-slot="settings.trigger"]`）。

---

## 7. 剪贴板权限门（`src/permissions.ts`）

Electron 42 把 `navigator.clipboard.writeText` 走 `clipboard-read` 权限请求
（sanitized-write 门），因此**两个**权限都必须放行：
`clipboard-sanitized-write` + `clipboard-read`。约束：

- 仅主窗口主帧；仅 runtime 自身 origin（`requestingOrigin` 与 `runtimeOrigin`
  同源）；其余权限一律拒绝。

相关提交：`2f43a3b`（origin 侧）、`c7d7d38`（本地侧 "allow Web Clipboard
writes from the DSH runtime origin"）。

---

## 8. 左栏（`plugins/desktop-left-rail`）

- **取代官方 ui-workspace**：`cordis.patch.yml` 中 `ui-workspace` 置
  `disabled: true`，insert `oh-desktop-left-rail`（slot `sidebar.workspaces`
  单主）。
- 功能：project → worktree → session 树（`tree.ts`）、wide/rail 双形态
  （rail 态只留两个 36×36 图标控制）、搜索胶囊、拖放排序。
- 顶部避让：§2.5 的 28px 由 chrome CSS 统一处理，本插件内部不重复。

---

## 9. 皮肤（`plugins/desktop-skins`）

- 替换上游 `@oh-dsh/skins` + `@oh-dsh/vision`（`cordis.patch.yml`：vision →
  desktop-skins）。设计文档 `docs/SYNARA-SKINS-DESIGN.md`。
- token 一致性由 `scripts/verify-skin-tokens.mjs` 校验（skin 变量必须命中
  已声明 token 集）。

---

## 10. 右栏所有权与终端（`plugins/panel-controls`）

- `DesktopPanels` 新增 **`claimRightPanel(ownerId, {paddingRight})` /
  `releaseRightPanel(ownerId)`**：多个插件争抢右栏时，**只有最近声明的 owner
  生效**（`#root` 的 padding-right squeeze + `data-oh-dsh-right-panel-owner`
  标志）。这是对「插件互相覆盖 #root 全局态」竞态的收敛。
- 终端注入顺序：`themeCss → xterm.css → terminal.css`（`theme.css` 在
  `plugins/shared/`）。
- 快捷键（统一 keymap，`2c00efb` 起）：面板开关 `mod+alt+b`、最大化退出
  `Escape`、review `ctrl+shift+g`、浏览器 `mod+t`、diff 内 F7 逐块跳转。

---

## 11. pinned-summary（`plugins/pinned-summary`）

- 288px 固定右缘面板，`z-index: 9000`，`--oh-dsh-pinned-summary-width`。
- **删除了**旧的 `html[data-oh-dsh-summary-pinned='true'] #root { padding-right }`
  squeeze（与 §10 的 claim 机制合并，避免双 squeeze 叠加）；`@media (max-width:
  900px)` 下的 root padding 规则一并删除。

---

## 12. Marketplace（`plugins/plugin-marketplace`）

- **会话导航自动关闭**（`client/session-navigation.ts` 的
  `transitionSessionNavigation`：`phase: 'ready'` 之后 current 变化 → close；
  启动不算导航）。
- 预览隔离沙箱（fail-closed）、footer 导航保持、bundle 构建隔离于 profile
  workspace（对应 origin 侧 `d14a952/3b3dc5d/240b2ac/11ab5e1` 等——这些已被
  上游吸收，rebase 时以上游为准，勿重放）。

---

## 13. 构建与开发脚本（`scripts/`）

| 脚本 | 作用 |
|------|------|
| `dev.mjs` | **热重载启动器**：esbuild `context()` 增量构建（配置共享自 `build-config.mjs`）→ 同步 bundle 到 `.stage/dsh-runtime/node_modules/@oh-dsh/*/dist/` → DSH client-hmr 500ms 轮询 + SSE 换纤；Electron 主进程变更才重启。需要先 `pnpm run build` + `pnpm run stage:dsh` |
| `build.mjs` / `stage-dsh.mjs` | 构建/stage（**注意：fork 内这两份是旧版**，rebase 时以上游新版为准，只把 fork 独有部分合入） |
| `vendor-plugin.mjs` | 把外部插件 vendor 进 `plugins/` |
| `check-sidebar-source.mjs` | 校验 sidebar 源码与 staged runtime 一致 |
| `plugin-styles.mjs` | 插件 CSS 抽取/打包 |
| `verify-skin-tokens.mjs` | §9 皮肤 token 校验 |
| `generate-icon-linux.sh` | Linux 图标集生成 |
| `smoke-client.cjs` | 运行时冒烟 |

- DSH runtime 锁定：`dsh-source.json` → deepseek-harness
  `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`（0.1.0-rc.7）。升级 DSH 前先过
  `tests/`（`pnpm test`）。

---

## 14. rebase 注意事项（给接手的对话）

1. **75 个本地提交未推送**（本地 `main` @ `79a275d` vs 远程 `origin/main` @
   `2262687`）。接手前先把本地 main 推到远程（如 `backup/local-main`），
   避免丢失。
2. 远程 fork 的 26 个 marketplace/打包提交（Chao Liu 等）**已被上游吸收**
   （LICENSE、catalog.ts 两树一致），重放时跳过，冲突时以上游版为准。
3. 反向过期的文件：`scripts/build.mjs`、`stage-dsh.mjs`、`build-linux.mjs`、
   `build-windows.mjs`、`plugins/plugin-marketplace/src/host/transaction-manager.ts`
   —— fork 里是旧版，采用上游新版。
4. 上游已改名/重构：`src/` 大改（update lifecycle/data-root/web/tui）、
   `package.json` 结构不同（0.1.5 vs 本地 0.1.2）、`plugins/shared/` 上游新增
   `guardrails.ts`/`surface.ts`（本地没有，需保留）。
5. 待清理：仓库根误提交的 `reply.png`、`tool-row-check.png`、`sidebar-icons.png`。
6. 已建好基底分支 `rebase/panel-work`（并行克隆
   `../oh-dsh-desktop-rebase`，基于 `upstream/main` @ `1490ba3` 推送到远程）。

## 15. 验证清单（每项调整的肉眼检查法）

- [ ] macOS：红绿灯在 42px 顶栏内**垂直居中**（上下留白相等），y=14。
- [ ] macOS 左栏收起：左栏 toggle 恰好出现在红绿灯右侧（左垫 20px、toggle 左缘
      76px），与灯无重叠无间隙。
- [ ] macOS 左栏展开：toggle 常驻在 8px 处（不再消失），首个 tab 不钻灯下。
- [ ] macOS 面板最大化/窄视口：顶行左垫 76px，pinned tab 起点 77px。
- [ ] Windows：右上角最小化/最大化/关闭按钮区不被右栏 reopen 顶到
      （`--oh-dsh-traffic-right` 实时跟随缩放）；左栏收起时 strip 左垫夹到 8px。
- [ ] 顶栏空白处可拖动窗口；按钮/tab 可点击（drag/no-drag 边界正确）。
- [ ] 打开设置弹层：侧栏/摘要/市场被压在模糊遮罩下（1000 vs 999），
      弹层内 dropdown 可正常展开。
- [ ] 空状态（新会话页/无会话 header）：窗口仍可拖动（**顶栏 strip 承担拖拽**，
      不再有兜底条），且顶栏按钮可点击（8c3506c 回归点）。
- [ ] 打开任意 modal 后窗口不能误拖（aria-modal 挂起生效）。
- [ ] 会话 header 上点击按钮不触发拖拽。
- [ ] 左栏顶部第一行按钮与红绿灯无重叠（28px padding）。
- [ ] 复制按钮可用（剪贴板权限门放行）。
- [ ] Hero 页标题显示 "Oh-DSH-Desktop" 而非 "Into the Unknown"。
- [ ] 窗口图标：打包态 resources/oh-dsh-desktop.png，dev 态 assets/icons。
- [ ] 设置弹层打开时侧栏 toggle 仍可用（z-index 修复不破坏交互）。
