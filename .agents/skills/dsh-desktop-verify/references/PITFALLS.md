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
