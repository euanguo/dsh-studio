# DSH 桌面自验证 — 踩坑台账（PITFALLS）

> 本文件是技能的**可写记忆**：每一次踩坑，都必须在此追加一条（或合并同类项），
> 并在 SKILL.md 对应小节补一行指引。它是仓库内被跟踪的文件，随技能一起演进；
> 跨会话由 agent 持续维护。条目按日期倒序，近期条目在上。

## 约定

每条踩坑记录五要素：**日期 / 症状 / 根因 / 修复 / 来源**。
`来源: 实测` 表示本人在真实 DEV 桌面上复现并验证过；`来源: 文档` 表示来自
chrome-use 配套文档，未在本桌面复现但属官方保证行为。

---

## 2026-08-23（首版，全部实测）

### 1. 已有一个 DEV 实例时，带 CDP 启动的 Electron 以 exit 0 静默退出
- **症状**：`pnpm run dev` 日志里出现 `DevTools listening on ws://127.0.0.1:9222/...` 后
  立刻出现 `[dev] electron exited (code=0 signal=null)`，CDP 端口无响应；desktop.log
  里没有 "quitting application"。
- **根因**：Electron 单实例锁（默认按 `userData` 路径排他）。另一个
  `DSH_STUDIO_CHANNEL=dev` 实例（userData=`~/.dsh-studio-dev/desktop`）正在运行，
  占住了锁；新进程在 `requestSingleInstanceLock()` 失败后 `app.quit()`。
  生产版（`~/.dsh-studio/desktop`）锁不同，**不是**元凶。
- **修复**：先停止旧 DEV 实例再启动；或直接
  `node .agents/skills/dsh-desktop-verify/scripts/ensure-dev-desktop.mjs ensure --force-restart`。
  检测旧实例：`pgrep -fl "dsh-studio-dev/desktop"`。
- **来源**：实测。

### 2. Electron 主进程重启后，chrome-use 会话 daemon 卡死 "session unresponsive"
- **症状**：dev.mjs 因 `dist/main.js|preload.cjs|splash.html` 变化自动重启 Electron
  后，下一条 chrome-use 命令返回
  `✗ session unresponsive: the stuck '<session>' daemon was stopped automatically; rerun the command...`；
  重跑 `chrome-use test` 还可能长时间挂起。
- **根因**：会话 daemon 持有的 CDP websocket 指向已消失的 target；重启后
  `target.id` 与 `webSocketDebuggerUrl` 全部失效。
- **修复**：按提示重跑命令（会自动起新 daemon），再 `chrome-use --session <s> connect <port>`，
  再 `chrome-use --session <s> tab` 重新发现目标；**永不缓存 target id/webSocketDebuggerUrl**。
- **来源**：实测。

### 3. CDP 就绪 ≠ 应用就绪；页面目标可能先是 splash
- **症状**：`chrome-use tab` 显示
  `page "" file:///.../dist/splash.html`；此时快照看不到任何业务 UI。
- **根因**：应用启动时序为 splash（loadFile）→ DSH runtime 就绪 →
  导航到 `http://127.0.0.1:<随机端口>/`。每次启动 runtime URL 端口都不同。
- **修复**：`chrome-use --session <s> wait --url "**127.0.0.1**"`（或轮询 `tab`），
  再 `wait --load networkidle`，最后 `snapshot -i`。定位目标一律用
  `tab`/URL 匹配，绝不硬编码端口。
- **来源**：实测。

### 4. `chrome-use test` 套件断言限制
- **症状**：`assert: count: { sel: ..., gte: 1 }` 报
  `bad assert: count: need eq: <n>`。
- **根因**：套件引擎里 `count` 只支持 `eq: <n>`（且 `<n>` 为整数）。
- **修复**：范围断言改用 `eval`（如 `document.querySelectorAll('...').length >= 1`）；
  更多断言支持见版本文档 `chrome-use skills get test`。
- **来源**：实测。

### 5. 套件失败产物 `cu-test-artifacts/` 落在 cwd，会污染 git status
- **症状**：`chrome-use test` 失败时在**当前工作目录**生成
  `cu-test-artifacts/<case>.png`；在仓库根目录跑且未清理时会进入 `git status`。
- **修复**：套件与产物都在 gitignore 的证据目录下运行，例如
  `cd tmp/desktop-verify/<run> && chrome-use test <绝对路径套件> --session <s>`；
  跑完按需保留证据或删除。
- **来源**：实测。

### 6. `console` / `errors` 默认不采集
- **症状**：`chrome-use --session <s> errors` 返回空，即使页面有 JS 错误。
- **根因**：本 fork 的 console 捕获默认关闭。
- **修复**：会话首个命令前设置 `AGENT_BROWSER_CAPTURE_CONSOLE=1`
  （如 `AGENT_BROWSER_CAPTURE_CONSOLE=1 chrome-use --session <s> connect <port>`），
  再在验证过程中用 `console` / `errors` 检查。
- **来源**：实测 + dogfood 文档。

### 7. 无关的构建/触碰 dist 会触发 Electron 重启
- **症状**：验证过程中应用突然重启（窗口关闭重开），target 与 runtime URL 全变。
- **根因**：dev.mjs 监听 `dist/main.js|preload.cjs|splash.html`，任何重写都会
  `stopElectron() + startElectronWhenReady()`。
- **修复**：验证进行中不要跑全量 `pnpm run build`/不触摸这些文件；万一发生，
  按 #2 的流程恢复后重跑套件。
- **来源**：实测。

### 8. CDP 端口冲突
- **症状**：`connect` 连到了别的 Chromium/Electron（或端口被占，连接串台）。
- **修复**：启动前 `lsof -nP -iTCP:<port> -sTCP:LISTEN`；用
  `DSH_VERIFY_CDP_PORT=<port>` 或 `ensure --port <port>` 换端口；连接后 **必须**
  `tab` 确认目标 URL 是 `127.0.0.1:<runtime端口>` 的 DSH 页面。
- **来源**：实测（chrome-use 文档同样强调 target 校验）。

### 9. 主进程重启竞态：dev.mjs 复活 Electron 时旧实例还占着 CDP 端口/单实例锁（高频）
- **症状**：验证中 `touch dist/main.js|preload.cjs`（或任何触发 dev.mjs 自动重启的
  改动）后，dev 日志出现
  `ERROR:net/socket/socket_posix.cc:173] bind() failed: Address already in use (48)`
  与 `Cannot start http server for devtools.`，随后
  `[dev] electron exited (code=0 signal=null)`；CDP 端口下落后**不再回来**
  （90s 内实测 2/2 复现）。应用可能停在无 CDP 的存活状态，或整体退出。
- **根因**：dev.mjs 对主进程 bundle 的停旧/起新去抖约 250ms，而旧 Electron 的
  SIGTERM 优雅退出（含停掉 DSH runtime 子进程）通常更慢；新实例在旧进程仍持有
  端口和单实例锁时就启动 → 绑口失败 + 锁失败 → 静默退出。无 CDP 端口时该竞态
  不可见，所以 dev.mjs 平时"看起来没问题"。
- **修复**（按优先级）：
  1. 触发重启后**轮询**：先等端口 down，再等 up（最多 ~90s）；不回来就走 2。
  2. 兜底自愈：`node <this-skill>/scripts/ensure-dev-desktop.mjs ensure --port <port>`
     （helper 会识别"launcher 存活但 CDP 掉线"，整树重建后重启）。
  3. 需要确定性"干净重启态"时，不要 touch dist，直接
     `node <this-skill>/scripts/ensure-dev-desktop.mjs stop && … ensure`。
- **来源**：实测（2/2）。此竞态属于 dev.mjs 上游改进候选，不在本技能内修复。

## 2026-08-23（本次 WorkTree capability 重构）

### 10. `ELECTRON_RUN_AS_NODE=1` 使 Web smoke 的 Electron 客户端拒绝 `--no-sandbox`
- **症状**：`pnpm run smoke:web` 在 Web API 已全部通过后，Electron 客户端以
  `bad option: --no-sandbox` 退出。
- **根因**：当前 DSH shell 为 Electron 注入了 `ELECTRON_RUN_AS_NODE=1`；
  smoke 脚本需要真正启动 Electron，而不是 Node 兼容模式。
- **修复**：使用 `env -u ELECTRON_RUN_AS_NODE pnpm run smoke:web`；DEV 桌面
  helper 本身不受影响。
- **来源**：实测。



- `eval` 在页面 MAIN world 执行且状态跨调用：顶层 `const x` 会 "already declared"，
  脚本要包 IIFE 或挂 `window.`。
- `fill` 用 CDP insertText，**不触发 keydown/keyup**；需要真实按键事件的控件
  用 `type --key-events` / `keyboard type`。
- 快照优先：定位/点击一律 `snapshot -i` + `@ref`，禁止截图定位；
  坐标点击只用于 canvas/无 DOM 场景；`screenshot --annotate` 是给人类/多模态看的证据。
- `@ref` 在导航、tab 切换后失效；同文档内跨 re-render 会自动按
  role+name+指纹重定位（找不到会大声报错而不是乱点）。
- 中文/大段 JS 用 `eval --stdin` / `eval --file`，避免 shell 转义破坏。

## 2026-08-23（补录，全部实测）

### 12. Pierre 渲染空白：host 插件 chunk 路由正则与挂载路径脱节（404 worker）
- **症状**：文件/diff/编辑器视图区域空白；`diffs-container` shadow 内 0 行、
  `contentContainer.scrollHeight === 0`；`fetch('/capabilities/bundle/pierre-worker.js')`
  返回 404 “not found”（9 字节）。
- **根因**：`plugins/capabilities/src/bundle-route.ts` 的 prefix 路由随 c8100c0 从
  `/sidebar/bundle` 改名 `/capabilities/bundle`（挂载路径与客户端 URL 都改了），
  但 handler 内 `pathname` 正则仍写 `/^\/sidebar\/bundle\//` → 永远 404 →
  `new Worker(url, {type:'module'})` 报错 → Pierre worker 池不工作 → 任何纯文本/
  diff 内容都无法分词渲染。这属于**已提交分支代码**，与未提交 UI 重构无关，
  排查时不要只盯本地 diff。另外 host 侧插件改动 dev.mjs 只做“重建+sync”，
  **不会自动重启 Electron**；必须 `ensure-dev-desktop.mjs stop && ensure` 干净重启
  才能加载新正则。
- **修复**：把正则改为 `/^\/capabilities\/bundle\/([a-z0-9-]+)\.js$/`，并在旁边注释
  “与挂载路径保持同步”；重启 DEV 后 `fetch(...)` 200 且 `new Worker` 无 error。
- **来源**：实测。

### 13. 重启后点文件 tab 激活不了（aria-selected 永远 false）
- **症状**：`ensure` 干净重启后，文件 surface tab 出现在中心 strip，但点击后
  `aria-selected` 仍为 false、`.dsh-studio-center-surface-body` 保持
  `data-hidden='true'`/display:none；console 无任何报错。
- **根因**：重启后 app 默认落在“新会话”空白占位符上；center-surface-host 的 sync
  逻辑规定 blank 会话（`workspace.summary.blank === true`）**占据中心舞台**，
  每次 sync 都 `state.deactivate(cwd)`——所有工作区 surface 都不能保持激活。
  这不是 bug，是既有设计。此前会话选中真实会话时文件点击可正常打开。
- **修复**：先在左侧会话树选中一个真实会话（非“新会话”占位符），再点文件 tab。
- **来源**：实测。

### 14. 模型不支持读图时，用 DOM 断言代替截图定位（本会话为 deepseek-v4-flash）
- **症状**：`read_image` 报 “model does not declare image input”。
- **根因**：当前模型无图像输入能力；截图只能作为给人类/多模态的证据，不能作为
  agent 自身的定位/确认手段。
- **修复**：全部用 `eval` 量 `getBoundingClientRect`/`scrollHeight`/shadowRoot 叶子
  数来断言渲染；截图仅落盘留证（如 `00-initial.png`、`01-file-view-fixed.png`）。
- **来源**：实测。

### 15. 删除共享 CSS/模块后 dev 增量构建静默失败 → 热重载停滞
- **症状**：改完 CSS 等很久页面没变化；`dev-desktop.log` 有 `build failed
  (source change): Could not resolve "../scrollable.css"`，但 dev 进程没崩、
  CDP 还在，之前的改动也都不再热更新。
- **根因**：删了 `plugins/shared/scrollable.css` 但 `ui/styles.ts` 仍
  `import '../scrollable.css'`；增量构建每次失败，SSE 热替换不上。
- **修复**：删共享文件后 `grep -rn "文件名" plugins --include=*.ts*` 全量
  清引用（含 styles.ts 的 CSS 聚合导入、package.json exports、index.ts）。
- **来源**：实测。

### 16. CDP 合成拖选后 Selection.isCollapsed 为 true 但仍有文本 → 操作条不出现
- **症状**：chrome-use mouse down/move/up 拖选后，`window.getSelection()` 有
  135+ 字符文本，但 `selection.isCollapsed === true`；以 `isCollapsed` 作
  "空选区"判断的代码会把真实选区当空清掉，浮层从不出现（真实物理鼠标看似
  正常，CDP 复现稳定）。
- **根因**：CDP Input.dispatchMouseEvent 的拖选在 rAF 提交后 isCollapsed 状态
  与实际 range 不一致（浏览器在后续渲染才落实 committed selection）；把
  `if (selection.isCollapsed || rangeCount === 0)` 提前 return 是错误判定。
- **修复**：改用 `rangeCount === 0 || text.trim() === ''` 作为空选区信号
  （selection-action 的 readCommittedSelection）。
- **来源**：本次 selection-action 验证实测。

### 17. 非受控 textarea（defaultValue + 渲染期读 ref.value）提交按钮永远 disabled
- **症状**：React 组件用 `defaultValue` + `const body = inputRef.current?.value`
  在渲染时读值，`disabled={body.trim()===''}`：输入内容不触发重渲染，按钮永远
  disabled，Enter 提交也读到旧值。
- **根因**：渲染期读 DOM ref 不是反应式状态；需要 onChange 驱动 state。
- **修复**：改为受控（useState + value + onChange）。评论 compose 卡片已修。
- **来源**：本次验证实测（CommentComposeCard）。

### 18. 排查"改动没生效"先验证运行 bundle 内容，别信 rev hash
- **症状**：改源码后 dev 日志显示 rebuilt+synced，页面 reload 后行为仍旧；
  误以为有 HTTP 缓存，实际是**自己的改动没写进源码**（python replace 静默
  失败/AssertionError 中途没写盘），bundle 与源码一致（都旧）。
- **修复**：先 `grep -n "特征字符串" plugins/.../src/...` 确认源码有改动，
  再 `grep -c "特征" dist/plugins/sidebar/client.js` 与运行时
  `performance.getEntriesByType('resource')` 里 bundle 内容确认。
- **来源**：本次验证。

### 19. chrome-use test 套件在会话卡死后无输出超时被杀
- **症状**：`chrome-use test suite.yaml --session <s>` 在页面/CDP 异常后
  无任何输出直到超时（session daemon 连接坏）。先 `session stop` + `connect`
  重建会话，再跑套件。
- **修复**：跑套件前 `chrome-use --session <s> tab` 自检连接；拖选类交互
  套件引擎不支持（无 mouse 动词），只放稳定断言。
- **来源**：本次实测。

### 20. 新会话占位符抢占中心舞台 → 无法点击其它 tab（会话卡死的常见前置）
- **症状**：当前 tab 是"新建会话"占位页时，点击 Git/文件 tab 不切换，diff 无法
  打开；反复操作后 chrome-use daemon 超时被杀。
- **根因**：blank 会话占位符占据 center，sync 逻辑 deactivate 其它 surface
  （center-surface-host 既定设计，见 #13）；再加上 dev 主进程重启竞态（#9），
  CDP 端口被旧实例占着、新实例 bind 失败，两件事叠加表现为"卡死"。
- **修复**：先点左侧真实会话（非"新会话"占位）再开 tab；CDP 不通时先
  `pkill -f remote-debugging-port` + helper `ensure --force-restart` 自愈，
  再 `session stop` + `connect` 重建 chrome-use 会话。
- **来源**：本轮实测（多轮超时）。

### 21. CDP 合成拖选产生"半折叠"Selection：isCollapsed=true 但有文本，range 锚在 light DOM
- **症状**：chrome-use mouse down/move/up 拖选后，`selection.toString()` 有
  100+ 字符，但 `selection.isCollapsed === true`，`range.getClientRects()` 返回
  空数组，`range.startContainer/endContainer` 是 light-DOM 的 DIV（不在 Pierre
  shadow root 内），`caretRangeFromPoint` 也返回 light-DOM 节点。
- **根因**：CDP Input.dispatchMouseEvent 模拟的拖选没有产生浏览器真实
  文本选择结构，只有文本快照 + anchor 坐标。任何依赖 range/isCollapsed/
  clientRects 的行解析在此环境下都失效（真实物理鼠标则正常）。
- **修复**：改用**拖拽端点坐标**（pointerdown + mouseup 的 clientX/Y）对行
  元素 boundingRect 做几何反查（行 rect 始终可信）；列用 caret 探测，
  失败时降级为 undefined。见 selection-reference.ts 的
  `resolveSelectionSpanFromPoints` / `lineNumberAtPoint`。
- **来源**：本轮实测（多次失败后定位）。

### 22. Pierre 行元素两套：data-line（全宽代码行）vs data-column-number（49px 行号列）
- **症状**：收集 `[data-column-number]` 做行解析，行 rect 只有 ~49px 宽
  （x=300..349），拖选在 x≥350 时永远命中不到行 → 行号解析失败。
- **根因**：`data-column-number` 是 gutter 行号列；真正的代码行是
  `[data-line]`（全宽 923px）。unified diff 中 data-line 是新侧行号，
  change-addition 行只有 data-line（无 alt-line），删除行有 alt-line。
- **修复**：collectLineElements 优先收集 `[data-line]` 全宽行（按
  data-line 取行号），跳过窄 gutter，避免重复计数。
- **来源**：本轮实测。

### 23. 用 chrome-use 命令"探测"应用状态 → daemon 通道失效时卡到超时
- **症状**：应用+CDP 明明就绪（桌面端已显示），但 `chrome-use tab / eval /
  snapshot` 一次卡 60s 才放弃；反复出现"卡了好久"。
- **根因**：chrome-use 的每条命令都先经 daemon 的 WebSocket 连 CDP。主进程
  重启/`recover` 后，daemon 指向旧 target，通道失效 → 每次命令重建重连 →
  卡到超时。这不是 CDP 的问题，是"探测手段"的问题。
- **修复**：判断应用是否就绪永远先走 HTTP 端点（毫秒级，不经过 daemon）：
  `curl -sf --max-time 4 http://127.0.0.1:9222/json/list` 看 page target
  的 URL 是否变成 `127.0.0.1:<port>/`。确认后再 `session stop` + `connect`
  重建 daemon，然后才用 chrome-use 交互/快照。
- **来源**：本轮实测（用户明确指出"明明就绪还卡了很久"）。

### 24. 同一浮层组件，两个调用点行为不同 → 先对比参数差异而非组件本身
- **症状**：对话列表弹层（side="bottom"）在视口底部能自动翻到上方；评论弹层
  （试 side="top"）却"往下偏被截断"。用户质疑"不是同一个弹出层组件吗"。
- **根因**：两者共用 base-ui Popover（FloatingLayer），但**side 语义不同**：
  side="bottom" 时 flip 引擎能在底部空间不足时自动翻上；手写 side="top" 反而
  依赖引擎反向 flip，行为不一致且难预测。统一成同一调用方式（side="bottom"
  + collisionPadding 交 flip）后行为一致。
- **修复**：评论弹层与对话列表弹层完全同一套参数（bottom + flip + 12px padding +
  6px offset）；方向一律交给 floating 引擎，不做手写 side 特判。
- **来源**：本轮实测（用户连续两轮指出方向不一致）。

### 25. 可滚动浮层内容用共享 ScrollArea 承载，别手写 overflow-y
- **症状**：对话列表手写 `.dsh-studio-selection-conv-list { overflow-y: auto }`，
  滚动条样式与全应用不一致（无统一虚拟滚动条）。
- **根因**：全局 ScrollArea（base-ui ScrollArea + 统一 Thumb 样式）已是项目标准，
  新浮层列表绕过了它。
- **修复**：浮层内列表内容一律包 `<ScrollArea className viewportClassName>`，
  shell 只管尺寸/边框/背景，滚动条交给 ScrollArea。
- **来源**：本轮实测（用户要求"用全局通用滚动容器承载"）。

### 26. 运行时页面与 CDP HTTP 目标健康，但 chrome-use `connect` 持续超时
- **日期**：2026-08-24。
- **症状**：`curl http://127.0.0.1:9222/json/list` 正常返回 DSH Studio page target，
  但在客户端热更新后，`chrome-use session stop <name>` 再
  `chrome-use --session <name> connect 9222` 连续 30 秒超时，并显示
  `Chrome relay dropped — reconnecting…`。
- **根因**：chrome-use relay/daemon 重连链路卡住；CDP 端点和 Electron runtime
  仍然健康，不能归因为应用崩溃。
- **修复**：先记录 CDP HTTP 端点作为应用存活证据，停止重复连接；在 relay 恢复后
  建立新的命名会话再继续 UI 验证。构建与静态验证不受影响。
- **来源**：本轮实测。
