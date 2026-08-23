---
name: dsh-desktop-verify
description: 启动 DSH Studio DEV 桌面端，用 chrome-use 稳定连接（CDP），对功能做自验证、自循环验证与优化。Use when developing or changing DSH Studio desktop features and needing end-to-end self-verification on the real DEV desktop app, launching the DSH Studio (Dev) desktop, connecting chrome-use to the running Electron app, driving the desktop UI through chrome-use's CDP capabilities, running re-runnable UI regression suites against the app, surviving hot reload / main-process restarts, or improving this skill after hitting pitfalls. Triggers include "自验证桌面功能", "启动DEV桌面端并验证", "chrome-use 连桌面", "desktop self-verify", "verify the dev desktop", "dogfood the desktop app".
---

# DSH Studio 桌面端自验证（DEV）

本技能指引 AI **启动 DSH Studio 的 DEV 桌面端**、用 **chrome-use** 通过 CDP
稳定连接，然后对功能做**自验证 → 自循环验证 → 修复→再验证 → 沉淀**的闭环，
并在每一次踩坑后**反过来优化本技能自己**。

三条铁律贯穿始终：

1. **复用 chrome-use 自带能力**：所有界面定位、交互、断言、取证都必须走
   chrome-use 的命令/套件引擎（snapshot / click / fill / eval / expect /
   screenshot / test / network / record …）。**禁止**为触发某个功能自写一次性
   Python/Node/JS 脚本去点按钮或注入事件——那是 chrome-use 已经做好的事。
2. **只把"进程生命周期"交给仓库内 helper**：启动/停止/日志用
   `scripts/ensure-dev-desktop.mjs`（它只包装仓库自带的 `pnpm run dev`，不驱动任何 UI）。
3. **技能是活的**：每踩一个坑，必须按[第 7 节](#7-踩坑与自我改进强制机制)更新
   `references/PITFALLS.md`，必要时修订本 SKILL.md 与套件，并补 Agent Note。

开始前先读 chrome-use 的版本文档（内容随安装版本变化，不要凭记忆猜命令）：

```bash
chrome-use skills get core        # 必读：核心循环、ref 契约、等待/断言
chrome-use skills get electron    # 必读：Electron 桌面端连接与排错
chrome-use skills get test        # 写回归套件前读：套件格式与断言限制
chrome-use skills get dogfood     # 全量功能探索/找 bug 时读
chrome-use skills get network     # 需要拦截/录制请求时读
```

---

## 1. 启动 DEV 桌面端

### 1.1 环境与数据根

- **DEV 渠道**：`DSH_STUDIO_CHANNEL=dev` → 数据根 `~/.dsh-studio-dev`
  （与已安装的**正式版** `~/.dsh-studio` 完全隔离，可并行）。
- **正式版**（`/Applications/DSH Studio.app` 或 `release/` 产物）：默认
  `~/.dsh-studio`，是真实用户数据。本技能默认**只碰 DEV**；
  确需验证正式版时见[第 10 节](#10-边界与禁忌)。
- 生产版正在运行时（`pgrep -fl "DSH Studio.app/Contents/MacOS/DSH Studio"`），
  不要杀它、不要向它注入 CDP 之外的东西。

### 1.2 前置条件（一次性）

```bash
# 在仓库根目录：staged DSH runtime（pnpm run dev 的前置）
CI=true pnpm run build:dsh && CI=true pnpm run stage:dsh
# Electron-based smoke commands must run outside Node compatibility mode:
# env -u ELECTRON_RUN_AS_NODE pnpm run smoke:web
chrome-use --version
```

### 1.3 启动（推荐：helper）

```bash
# <this-skill> = 本技能目录，仓库相对路径 .agents/skills/dsh-desktop-verify/
node <this-skill>/scripts/ensure-dev-desktop.mjs ensure --port 9222
# 默认 9222；可用 DSH_VERIFY_CDP_PORT 覆盖
```

helper 会：检查前置 → 检测是否已有带 CDP 的实例（有则复用）→ 检测无 CDP 的旧
DEV 实例（单实例锁冲突，提示处理）→ `pnpm run dev` 后台拉起并等待 CDP 就绪 →
打印目标列表与下一步命令。状态/日志在 gitignored 的
`tmp/dsh-dev-desktop/`（`node $H status` / `stop` / `logs --tail 80`）。

### 1.4 手工等价命令（不依赖 helper 时）

```bash
# 后台运行（dev.mjs 是仓库官方热重载 launcher，DSH_STUDIO_ELECTRON_ARGS
# 是其官方留的 CDP 开口，见 scripts/dev.mjs 注释）
DSH_STUDIO_ELECTRON_ARGS='--remote-debugging-port=9222' pnpm run dev
# 等 CDP：
for i in $(seq 1 60); do curl -sf http://127.0.0.1:9222/json/version >/dev/null && break; sleep 2; done
```

**启动后不要马上快照**：应用先显示 splash（`file://.../splash.html`），等 DSH
runtime 就绪后才导航到 `http://127.0.0.1:<随机端口>/`（每次启动端口都会变）。

---

## 2. 用 chrome-use 稳定连接

### 2.1 会话与连接

给每次验证任务一个**唯一命名会话**，避免与其它 AI 线程串扰：

```bash
chrome-use --session dsh-dev-<task-slug> connect 9222
chrome-use --session dsh-dev-<task-slug> tab        # 确认目标
```

`tab` 输出应看到 `[tN] DeepSeek Harness - http://127.0.0.1:<runtime端口>/`。
目标选择规则：

- 用 **`--url`/tab 列表里的 URL** 识别主窗口（`127.0.0.1:<runtime端口>`），
  **不要**按窗口标题猜（CDP 的 page title 是 `DeepSeek Harness`；
  OS 窗口标题 `DSH Studio (Dev)` 不在 CDP 里）。
- 插件市场预览窗口、更新窗口会出现额外 page target；用
  `chrome-use tab --url "*<特征>*"` 切换。
- 若 `tab` 后 URL 还是 splash：`wait --url "**127.0.0.1**"` 后再 `tab`。

**探测 runtime 用 `curl` 直达 CDP，别用 chrome-use 命令去"问"**（PITFALLS #23）：
`chrome-use tab / eval / snapshot` 都先经 chrome-use daemon 的 WebSocket；一旦
daemon 与 CDP 的通道失效（主进程重启后常见），这些命令会卡到超时才放弃，
哪怕应用早就就绪。判断"应用+CDP 是否活着"永远先走 HTTP 端点（毫秒级）：
```bash
curl -sf --max-time 4 http://127.0.0.1:9222/json/version   # CDP 活着?
curl -sf --max-time 4 http://127.0.0.1:9222/json/list       # page 目标 & runtime URL
# 看到 page 'http://127.0.0.1:<port>/' 即 runtime 就绪
```
**每次 `ensure`/`recover`/`--force-restart`/主进程重启后，必须重建 chrome-use
会话**（旧的 daemon 指向旧 target，必然卡）：`session stop` → `connect <port>`
→ `tab`。重建后若 `tab` 仍异常，先 `session stop` 再重连，绝不硬等。

### 2.2 快照与交互约定

```bash
chrome-use --session $S snapshot -i                         # 交互元素 + @ref
chrome-use --session $S snapshot -i -d 3                   # 限制深度，防超大树
chrome-use --session $S snapshot -i -f "新建会话|设置|插件"  # 正则过滤+祖先上下文
chrome-use --session $S snapshot -i --json > state.json
```

- **快照优先**：定位/点击一律 `snapshot -i` + `@ref` 或 `find role/text/...`；
  截图只用于给人类/多模态看的**证据**，禁止"截图定位"。
- 任何导航、`tab` 切换、应用重启后 **必须重新快照**（`@ref` 会失效）。
- 同文档内 React 重渲染后 `@ref` 会自动按 role+name+指纹重定位；真找不到会
  大声报错 → 重新快照，禁止 `AGENT_BROWSER_VERIFY_REF=0` 硬来。
- 交互后不要干等：`wait @ref` / `wait --text "..."` / `wait --url "**..."**` /
  `wait --load networkidle`；断言用 `expect`（有退出码，可 && 串联）：

```bash
chrome-use --session $S click @e8 && chrome-use --session $S expect "#id" visible
chrome-use --session $S expect text @e3 contains "已保存"
chrome-use --session $S expect no-errors   # 需要先开 console 捕获，见 PITFALLS #6
```

---

## 3. chrome-use 能力地图（桌面验证场景 → 命令）

充分使用 chrome-use 暴露的 CDP 能力；遇到"某能力不够"先查下表，
不要急着写脚本。通用规则：复杂 JS 用 `eval --stdin`/`--file`；数组结果加
`--json`；`fill` 是 insertText（不发 key 事件），需要真实按键用
`type --key-events`/`keyboard type`。

| 验证场景 | chrome-use 能力 |
|---|---|
| 连接带 CDP 的桌面 | `connect <port>` / 全局 `--cdp <port>` / `--auto-connect` |
| 多窗口 / webview / preview 目标 | `tab`、`tab --url <glob>`、`frame @e3`、`tab <targetId>`、`tab adopt` |
| 发现界面元素 | `snapshot -i[-c|-d N|-f regex|-s css|--json]`；`find role/text/label/placeholder/testid/first/nth` |
| 点击/输入/表单 | `click`（含坐标）、`dblclick`、`fill`、`type`、`press`（<=组合键）、`keyboard type/inserttext`、`select`、`pick`、`check/uncheck`、`upload`、`drag`、`scroll`、`scrollintoview`、`mouse`、`form fill --map` |
| 读状态/取值 | `get text/value/attr/count/box`、`read`、`extract --schema '{rows,fields}'` |
| 深层/疑难 DOM | `eval`（MAIN world，IIFE 包裹）、`--observe`（动作后看变更 delta）、`AGENT_BROWSER_CLICK_MODE=dom` |
| 等待与断言 | `wait @ref /--text /--url /--load /--fn`；`expect visible/gone/count(text/value/url/request/no-errors)`；`--if-present` 可选步 |
| 可重跑回归套件 | `chrome-use test <suite>.yaml --session <s>`（套件 = chrome-use 自带动词+断言，见第 4 节） |
| 证据：静图 | `screenshot [--full|--annotate|--clip]`（annotate 的 `[n]` 对应 `@eN`） |
| 证据：过程 | `record start x.webm` … `record stop`（交互 bug 才录） |
| 网络层 | `network route <glob> --mock/--rewrite/--edit/--abort`、`network requests`、`network har start/stop` |
| 控制台/错误 | `console`、`errors`（需 `AGENT_BROWSER_CAPTURE_CONSOLE=1` 于会话开始时设置） |
| Canvas/WebGL 界面 | `canvas list`、`canvas capture`、`click x y`（`box @eN` 取坐标） |
| 视口/深色模式 | `viewport <w> <h>`（CDP 虚拟视口）、`set media dark/light`、`set device` |
| 弹窗/下载 | `dialog status|accept|dismiss`；`download`、`downloads` |
| 会话管理 | `--session <name>` 隔离、`daemon status/restart`、`session stop/prune`、`state save/restore` |
| 页面上传 | `upload <sel> <file>`（文件输入与拖放/粘贴区均支持） |

---

## 4. 功能验证工作流

对每个待验证功能走"**写用例 → 驱动 → 断言 → 取证 → 修复 → 回归**"。

### 4.1 模式 A：可重跑回归套件（首选，自循环验证的载体）

把功能的冒烟/回归写成 YAML 套件（复用 chrome-use 的动词与断言，**不是**新脚本）：

```yaml
suite: dsh-<feature> verification
cases:
  - name: <what is checked>
    steps:                          # 可选：chrome-use 动词，如 click/fill/type/press
      - fill: { sel: "...", text: "..." }
      - click: { sel: "..." }
    assert:                         # 全部成立才通过
      - visible: "..."
      - text: { sel: "...", contains: "..." }
      - eval: "<boolean JS>"
```

- 运行：`cd tmp/desktop-verify/<run> && chrome-use test <套件绝对路径> --session <s>`
  （PITFALLS #5：产物目录跟随 cwd，别在仓库根跑）。
- 断言引擎限制：`count` 只支持 `eq: <n>`，范围断言用 `eval`（PITFALLS #4）。
- 失败会留 `cu-test-artifacts/<case>.png`；修复代码后重跑直到全绿。
- 套件自带的基线：`.agents/skills/dsh-desktop-verify/suites/dsh-desktop-smoke.yaml`。

### 4.2 模式 B：探索式验证（找 bug / 全量回归）

用 chrome-use + dogfood 方法论跑一遍：先 `snapshot -i` 摸清主界面 → 逐 section
走读 → 交互元素逐个点 → 空态/边界/报错态 → `console`/`errors` 盯 JS 错误 →
每一个发现**当场**用截图/录屏落证据（interactive bug 录视频，静态 bug 一张
annotate 截图即可）。产出结构化报告（见第 6 节）。

### 4.3 断言"真的发生了"

- 提交类动作：`expect request <substr> --status 2xx`（先 `requests --clear`）。
- 状态类动作：`expect text @eN contains ...` 或 `eval` 读内部状态；
  **不要**用 `body.textContent.includes(...)` 这类会误判 echo 的断言。
- 视觉类：`screenshot --annotate` 后由你（多模态）确认。

---

## 5. 自循环验证（三种重载路径）

功能改完后，必须证明"**CDP 验证链路在任何一种热更新/重启下都存活**"：

| 改动类型 | 触发方式 | 链路变化 | 之后必做 |
|---|---|---|---|
| 客户端 bundle（plugins/*/src/client.*） | 改文件 → dev.mjs 增量 rebuild → SSE 热替换 | 页面不刷新，DOM 局部换 | 重新 `snapshot -i` 拿新 `@ref`；重跑套件；`errors` 检查无新错误 |
| Electron 主进程（src/main.ts 等 → dist/main.js/preload.cjs/splash.html） | dev.mjs 自动停旧起新 | **target.id / runtime URL 端口全变，且存在重启竞态（PITFALLS #9，实测高频）**：新实例可能因旧实例未释放端口/锁而静默退出，CDP 可能不再回来 | 轮询端口 down→up（≤90s）；若 CDP 不回来 → `node <this-skill>/scripts/ensure-dev-desktop.mjs ensure --port <port>` 自愈重建；然后 `connect <port>` → `tab` → `wait --url "**127.0.0.1**"` → 重跑套件。要确定性干净重启态可直接 `stop && ensure`，别 touch dist |
| DSH Runtime 重启（应用内 "DSH → 重新启动 DSH Runtime"） | 菜单触发或 helper 重启 | 页面导航到新 runtime URL | 同上：重新发现目标 → 重跑套件 |

循环纪律：

1. 每轮验证后 **重跑全套件**（复用 `chrome-use test`），不只验证改动点。
2. 全程**不要**跑全量 `pnpm run build`（会触发主进程重启，PITFALLS #7）；
   需要构建用 dev.mjs 的增量。
3. 直到套件全绿 + 无新 console/errors + 证据齐全才算闭环；
   出问题就修 → 再跑，最多 N 轮，超过则记录为 blocker 并上报。

---

## 6. 证据与报告

- 单次验证运行在 gitignored 目录：`tmp/desktop-verify/<run-id>/`
  ```
  tmp/desktop-verify/<run-id>/
  ├── screenshots/            # screenshot --annotate 图（state 名语义化：00-initial.png …）
  ├── videos/                 # record start/stop 的 webm（仅交互类 bug）
  ├── har/                    # network har start/stop 落 HAR（网络问题）
  └── report.md               # 每发现一个问题当场记一条，附截图引用与复现步骤
  ```
- 报告要素（问题条目）：可复现步骤（编号步骤 ↔ 截图）、期望 vs 实际、
  严重度、console/network 证据、复现是否稳定（>1 次）。
- 取证纪律：交互 bug 录视频前先确认可稳定复现；视频内动作间隔 1s 以上；
  绝不删除中途产物；跑完清理 `cu-test-artifacts/`（若在 suite cwd 生成）。

---

## 7. 踩坑与自我改进（强制机制）

**本技能是可修改的，修改技能就是任务的一部分。** 每次遇到障碍/发现新知识：

1. **当场记录**：把"五要素"（日期/症状/根因/修复/来源）追加进
   `references/PITFALLS.md`（合并同类项），并照抄关键命令。
2. **修订生效路径**：如果踩坑点属于 SKILL.md 某小节写错/写漏 →
   **立刻改 SKILL.md 对应小节**（缩短下一位 agent 的试错）。
3. **套件化**：凡能写成断言复用的经验，全部沉淀进
   `suites/` 下对应套件（回归即防复发）。
4. **Agent Note**：若本次改动改变了行为/契约/流程（按
   `.agents/notes/README.md` 的"非平凡"标准），补一篇
   `implemented/` Agent Note 三件套（en/zh/i18n sidecar，用
   `pnpm run doc-sync` 系列校验）。
5. **收尾自检**（每轮循环结束）：`git status --short` 里不得出现
   `tmp/`、`cu-test-artifacts/`、`.stage/` 等产物；没有遗留本技能未记录的坑。

---

## 8. 故障排查速查

| 症状 | 处置 |
|---|---|
| 启动后 `electron exited (code=0)` | 单实例锁冲突（PITFALLS #1）：`node <this-skill>/scripts/ensure-dev-desktop.mjs ensure --force-restart` 或先停旧实例 |
| 重启后日志有 `bind() failed: Address already in use` 且 CDP 不回来 | 主进程重启竞态（PITFALLS #9，高频）：轮询后仍无 CDP 就走 `ensure --port <port>` 自愈 |
| `session unresponsive ... rerun the command` | 主进程重启导致 daemon 失效（PITFALLS #2）：重跑命令/`daemon restart` → `connect` → `tab` |
| `tab` 显示 splash / 空 title | 应用还在 splash→runtime 过渡：`wait --url "**127.0.0.1**"` |
| `connect` 串台到别的浏览器 | 端口被占（PITFALLS #8）：换端口并 `tab` 校验 URL |
| 快照超大/找不到控件 | `snapshot -i -f <regex>` 过滤；或 `snapshot -i -d 3 -s <css>` 定位 |
| `count: need eq` | PITFALLS #4：改 `eval` |
| `errors`/`console` 空 | PITFALLS #6：会话开始时设 `AGENT_BROWSER_CAPTURE_CONSOLE=1` |

完整台账见 [references/PITFALLS.md](references/PITFALLS.md)（会持续增长）。

---

## 9. 参考

- 仓库启动器：`scripts/dev.mjs`（DEV 官方热重载；`DSH_STUDIO_ELECTRON_ARGS` 是
  CDP 开口）；数据根语义见 `docs/design.md`「名称与数据目录」。
- Agent Note：[implemented/feature/2026-08-23-desktop-verify-skill.md](../../../.agents/notes/implemented/feature/2026-08-23-desktop-verify-skill.md)
- 优秀先例（同一思路的 Electron CDP 技能）：用户级 `synara-electron-debug`。

---

## 10. 边界与禁忌

- 只验证 **DEV 渠道**（`~/.dsh-studio-dev`）。验证正式版（`~/.dsh-studio`）必须
  用户显式要求，且只读验证优先（会动真实用户数据：会话、凭据、插件）。
- 不得向 app 源码注入测试钩子/ mock transport 来"让验证通过"；失败就是失败。
- 不得自写一次性脚本触发功能（见开头铁律 1）；helper 脚本只负责进程生命周期。
- 不得删除/改写他人正在运行的实例（生产版绝对不碰）。
- 不得缓存 `webSocketDebuggerUrl`/`target.id`/runtime 端口跨重启使用。
