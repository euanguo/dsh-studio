# 皮肤样式架构重构设计文档（构建期烘焙 + 精确类名生成）

> 状态：**调研完成，待实现**。本文档是 2026-08 一轮纯调研的完整结论：
> 先摸清 DSH 运行时 CSS 的完整交付链路（全部有实测依据），再给出长期
> 可维护的架构决策、分阶段实施计划与可执行的验收标准。
>
> 读者：接单实现的新会话**必须先通读本文档**，尤其是 §4（现状机制）、
> §6（推荐架构）、§8（实施计划）、§9（验收标准）。
>
> 关联文档：`docs/SYNARA-SKINS-DESIGN.md`（皮肤 token 设计）、
> `docs/desktop-adjustments-handoff.md`（桌面端调整交接）。

---

## 0. 一页结论

| 问题 | 结论 |
| --- | --- |
| 现状的痛点 | 皮肤样式靠运行时插件注入，选择器用 `[class*="_xxx"]` 子串匹配 + `!important` 强覆盖 |
| 误命中的根因 | 哈希前缀不稳定，子串是唯一锚点；`_triggerEffort` 含 `_trigger` 子串即被误命中 |
| 能不能不走插件 | 能。本项目**本来就在构建期从上游源码现编产物**（`build-dsh.mjs`），已有临时打补丁先例 |
| 配色层（稳定） | **构建期烘焙**：往 dist 的 `index-*.css` 末尾追加两段 token 覆盖块（亮=chatgpt-day / 暗=chatgpt-night）+ 构建期自检 |
| 几何层（迭代） | **留在插件**，但选择器改为**构建期生成的精确哈希类名**（扫上游产物得到 `.LqtciG_trigger` 这种），子串匹配全部退役 |
| 永远不做 | fork 上游组件 `*.module.css` 源码；几何烘焙进 dist（破坏热更新且无级联收益） |
| 长期收益 | 默认主题不再依赖运行时逻辑（删掉控制器兜底搏斗）；回归从"肉眼发现"变成"构建报错" |

---

## 1. 背景与动机

### 1.1 现状（2026-08 实测）

皮肤应用完全发生在运行时插件 `@oh-dsh/desktop-skins` 里：

1. 控制器把皮肤注册进 `theme` 服务（`ui-theme`），激活后由 `ui-layout` 的
   `ThemePresenter` 把皮肤 tokens **以 `body` 内联 style 写入**；
2. `SkinDomPresenter` 给 `<body>` 打 `data-oh-dsh-skin` 属性，并注入一张
   `<style id="oh-dsh-desktop-skins-atmosphere">`（几何 + 颜色修正 CSS）；
3. 该样式表里的规则全部是 `body[data-oh-dsh-skin] [class*="_xxx"]` 子串
   选择器 + `!important`。

### 1.2 两个已经踩到的坑（本调研期间的实测案例）

- **子串误命中**：`LqtciG_triggerEffort`（模型选择器里的思考强度字样）类名
  含 `_trigger` 子串，被胶囊配方 `[class*="_trigger"]:not([class*="_triggerLabel"])`
  命中，强制 `height: 28.59px`，文字顶对齐偏高 ~4px。修复方式是再加
  `:not([class*="_triggerEffort"])` —— **每踩一个坑补一个排除项，是子串
  匹配的固有维护税**，且这种 bug 是**静默视觉损坏**（不报错、靠肉眼）。
- **min-height 压不住显式 height**：模型弹出层行（`role="menuitem"`）组件
  显式 `height: 40px`，皮肤配方只设 `min-height: 28.59px`，弹出层维持旧尺寸。
  修法是额外钉 `height`。

这两类问题在"选择器 + 覆盖"范式下会反复出现。

### 1.3 用户诉求

> 能不能在打包时直接修改组件 CSS / 提前注入 CSS token，让最终产物拿到样式
> 文件时**本身就是我们的标准样式**？—— 即默认外观不依赖运行时插件逻辑。

---

## 2. 构建链路全貌（实测）

### 2.1 上游源码从哪里来

`dsh-source.json` 钉死上游 commit（当前 `47f943859bef`，`0.1.0-rc.5`）：

```
dsh-source.json
  └─ scripts/dsh-source.mjs → resolveDshSource()
        └─ .cache/dsh-source/<rev12>/   ← 完整 git checkout（detached，blob:none 浅克隆）
```

`validateSource` 要求 checkout **干净**（`git status --porcelain` 为空），
每次构建前校验；`DSH_SOURCE` 环境变量可指向开发 checkout。

### 2.2 上游产物谁在编

`scripts/build-dsh.mjs`（npm script `build:dsh`）：

1. 在 checkout 里 `pnpm install --frozen-lockfile`（钉 pnpm 版本，见
   `resolvePinnedPnpm`）；
2. **临时**给上游源码打一个补丁（`withVisionSettingsNamespace`：给
   `packages/host/apiproxy/src/api-proxy.ts` 的设置 allowlist 加一行
   `'oh-dsh-vision'`），跑完 `pnpm run build` 后**立即还原**——
   **这就是本项目"构建期改上游源码"的现成先例**；
3. 产物：
   - `apps/web/dist/`（web 壳：`index.html` + `assets/index-*.js/css` +
     `vendor-*.js/css` + `manifest.webmanifest`）；
   - `packages/*/lib/`（各包的构建产物，含 client bundle）。

### 2.3 产物怎么进运行时

`scripts/stage-dsh.mjs`（npm script `stage:dsh`）把 checkout 的产物拷成
可移植树 `.stage/dsh-runtime/`（含 `workspace/`、`lib/bin.js`、node 运行时），
Electron 主进程启动后由 `lib/bin.js` 的 HTTP 服务托管。

### 2.4 开发热更新范围（关键约束）

`scripts/dev.mjs` **只热同步我们自己的插件 bundle**（esbuild 增量 →
拷进 `.stage/dsh-runtime/node_modules/@oh-dsh/<plugin>/dist/` →
client-hmr 广播 → 页面热换 fiber）。**上游产物（web dist、官方插件 lib）
在 dev 期间是静态的**：改它们 = 重跑 `build:dsh` + `stage:dsh` + 重启，
分钟级。

---

## 3. 配色层机制（实测）

### 3.1 token 样式表的唯一入口

`apps/web/src/base.css`（上游 shell 自有样式）注释原话：
"The five ui-theme sheets are the sole token source (--dsw-*)"：

```css
@import '@deepseek-ai/dsh-client-ui-theme/styles/base.css';
@import '@deepseek-ai/dsh-client-ui-theme/styles/design-platform.css';
@import '@deepseek-ai/dsh-client-ui-theme/styles/scrollbar.css';
@import '@deepseek-ai/dsh-client-ui-theme/styles/gradient-shadow-text.css';
@import '@deepseek-ai/dsh-client-ui-theme/styles/shiki.css';
```

最终打进 **一个静态产物**：
`apps/web/dist/assets/index-CSGf6Qzd.css`（约 67KB），实测包含：

```css
body { --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-00); … }   /* 亮 */
body[data-ds-dark-theme] { --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950); … }  /* 暗 */
```

（源码侧在 `packages/client/ui-theme/src/styles/design-platform.css`：
338 行、`body[data-ds-dark-theme]` 两个块、约 156 个 alias + 22 个 specific token。）

### 3.2 亮/暗切换

- `boot-theme.ts`（ui-theme 的 node 侧，进 `lib/index.js`）早期给 `<body>`
  加/去 `data-ds-dark-theme`；
- 内置主题 `light`/`dark` 的注册 tokens 是**空的**
  （`client/index.ts`：`{ id: 'light', colorScheme: 'light', tokens: {} }`），
  所以默认状态配色权威**就是那张静态 CSS**。

### 3.3 第三方皮肤 token 怎么画上去

`packages/client/ui-layout/lib/types/client/theme-presenter.js` 的
`ThemePresenter.apply(snapshot)`：

1. `document.documentElement.style.colorScheme = scheme`；
2. 按 `active.colorScheme` 加/去 `body[data-ds-dark-theme]`；
3. 把 `snapshot.active.tokens` **逐个 `body.style.setProperty` 内联写入**
   （先清掉上一轮写的）；`theme-color` meta 跟随计算后的 body 背景。

→ 结论：**注册皮肤 = 内联覆盖；内置主题 = 静态 CSS 权威**。两者互不干扰。

### 3.4 对烘焙的推论

在 dist `index-*.css` **末尾追加**两段覆盖块（亮 = chatgpt-day 值、
暗 = chatgpt-night 值，均以 `body[data-ds-dark-theme]` / `body` 同款或更高
特异性书写），即可让**内置 light/dark/system 原生就是 ChatGPT 配色**：
零选择器、零 `!important`、零运行时依赖，且与主题切换机制完全兼容。

---

## 4. 几何层机制（实测）

### 4.1 官方组件 CSS 的交付方式：JS 内联字符串

官方 client 插件的组件样式**不是静态文件**，而是构建期内联成字符串塞进
各插件的 `lib/client.js`，运行时由 loader 以 `<style data-plugin-css>` 标签
注入（实测）：

```js
// packages/client/ui-model-selection/lib/client.js（serve 给浏览器的产物）
const css = ".LqtciG_triggerLabel{text-overflow:ellipsis;…}.LqtciG_triggerEffort{color:var(--dsw-alias-label-caption);flex:none}…"
// loader 端：document.querySelector("style[data-plugin-css=…]") 不存在则 createElement("style") + appendChild
```

- `ui-conversation/lib/client.js`：42 个 `data-plugin-css` 注入块；
- 类名是 **CSS Modules 哈希**（`LqtciG_*`、`uNlE1G_*`、`-wizCq_*`、
  `UTNGfq_*`、`urMWOG_*`、`lbz_ZG_*` 各组件不同），**哈希前缀每次上游
  变更都会变**，语义后缀（`_trigger`/`_menu`/`_cell`/`_seat`/`_workspace`…）
  相对稳定。

### 4.2 级联顺序（重要）

- 官方组件 style 标签在**各插件 bundle 加载时**注入（早期）；
- 我们的 atmosphere `<style>` 在皮肤插件 boot 时注入（**之后**）；
- 所以"等特异性"的规则，我们的能赢（时序靠后）。

### 4.3 特异性分析（结论：大部分 `!important` 是防御性堆砌）

| 我们的规则 | 特异性 | 组件单类规则 | 谁赢（不看 !important） |
| --- | --- | --- | --- |
| `body[data-oh-dsh-skin] [class*="_menu"]` | (0,2,1) | `.LqtciG_menu` (0,1,0) | 我们 |
| `body[data-oh-dsh-skin] [class*="_trigger"]:not([…])` | (0,3,1)+ | `.LqtciG_trigger` (0,1,0) | 我们 |
| `body[data-oh-dsh-skin] [class*="_cell"]…`（若存在） | (0,2,1) | `.LqtciG_cell` (0,1,0) | 我们 |

`!important` 只在三类场景真正必要：① 组件高特异性规则（`.x .y`、
`[data-state]` 组合）；② 组件**内联样式**（如 `style="…"` 上的几何）；
③ 组件规则自身带 `!important`。其余是"防未来"的防御。

### 4.4 对几何烘焙的推论

- 几何如果搬进 dist 静态 css，**等特异性会输给 JS 后注入的组件标签**，
  仍然要 `!important` 或特异性技巧 —— **没有获得级联优势**；
- 而且几何是迭代最频繁的部分（本轮已修两轮），烘焙 = 每次微调都要重跑
  上游构建 + restage（分钟级），并失去 dev 热更新 —— **得不偿失**。

---

## 5. 精确类名生成器（核心新机制）

### 5.1 为什么可行

**完整哈希类名就躺在我们构建期能读到的产物里**：

- `apps/web/dist/assets/*.css`（壳组件）；
- `.cache/dsh-source/<rev>/packages/*/lib/client.js`（官方 client 插件，
  内联 css 字符串里就是最终类名，如 `LqtciG_triggerEffort`）。

扫一遍、按语义后缀收集、去重，就能生成精确选择器。

### 5.2 生成规则

1. 扫描目标：`apps/web/dist/assets/*.css` + `.cache/dsh-source/<rev>/packages/*/lib/client.js`
   （或 `.stage/dsh-runtime/workspace/…` 等价物，二选一，以 .cache 为权威，
   因为它不依赖 stage 是否跑过）；
2. 正则收集形如 `[A-Za-z0-9-]+(_trigger|_triggerLabel|_triggerEffort|_triggerIcon|_menu|_cell|_seat|_workspace|_workspaceLabel|_item_|_sessionRow|_projectRow|_workspaceRow|_treeRow|_navCell|_selector|_newSession|_card|_dialog|_renameInput|_primary|_list_|_submenu_|_label_|_button_|_themeCube|_icon|_wrap|_composer…)` 的类名；
   （语义后缀清单 = 现有几何 CSS 里用到的所有 `[class*="…"]` 锚点，见
   `plugins/desktop-skins/src/client/skins.ts` 的 `CHATGPT_GEOMETRY_CSS`）
3. 同后缀多实例（如 `-wizCq_trigger`、`uNlE1G_trigger`、`LqtciG_trigger`
   三个触发器）→ **全部收录**，等价于子串匹配的覆盖面；
4. 输出：一个选择器清单模块（如
   `plugins/desktop-skins/src/client/generated-selectors.ts`，或构建期注入
   产物，见 §8 决策点），皮肤 CSS 用它替换全部 `[class*="…"]`；
5. **自检（关键）**：语义后缀清单里每一个后缀，若在产物里零命中 →
   构建**报错**（把"静默视觉损坏"变成"响亮构建失败"）；若命中数突变
   （与上次构建比对）→ 警告。

### 5.3 构建顺序约束

生成器读 `.cache/dsh-source`（`build:dsh` 的产物），因此**插件构建必须排在
`build:dsh` 之后**：

- release 流程：`build:dsh` → [生成选择器] → `build` → `stage:dsh`；
  （当前 `package.json` 里 `dist:*` 是 `build → build:dsh → stage:dsh`，
  需要调整顺序，见 §8.3）
- dev 流程：首次 `CI=true pnpm run build:dsh && CI=true pnpm run stage:dsh`
  后才有 `.cache` 与 stage，dev.mjs 期间产物不变，生成器结果稳定。

---

## 6. 推荐架构（长期）

```
┌─ 构建期（稳定层 · 改动频率低）─────────────────────────┐
│ ① 默认配色烘焙：dist index-*.css 末尾追加两段 token 覆盖块 │
│    （亮=chatgpt-day / 暗=chatgpt-night）+ 构建期自检      │
│ ② 精确类名生成器：扫上游产物 → 精确选择器 → 喂给插件构建    │
└──────────────────────────────────────────────────────┘
┌─ 运行时（迭代层 · 改动频率高）─────────────────────────┐
│ ③ 皮肤插件：注入精确选择器样式表 + data-oh-dsh-skin 门控； │
│    6 个额外皮肤 + 设置 UI                              │
└──────────────────────────────────────────────────────┘
```

### 6.1 为什么配色烘焙、几何不烘焙

| | 配色 | 几何 |
| --- | --- | --- |
| 语义 | "默认主题"本体，稳定 | 皮肤观感细节，**迭代最频繁** |
| 烘焙成本 | 一处追加 + 自检，零冲突 | 重跑上游构建，分钟级迭代 |
| 级联收益 | 无选择器、无 !important，天然权威 | 无（静态 css 输给 JS 后注入的标签） |
| 烘焙后运行时简化 | 控制器兜底搏斗可整块删除 | 无变化 |

### 6.2 烘焙后控制器的简化（阶段二的重要收益）

现状控制器（`skin-controller.ts`）为"默认=chatgpt 对"维护了一整套运行时
兜底：`DEFAULT_SKINS`、`FALLBACK_THEME_KEY`、`skinForFallback()`、`adopt()`
对官方 light/dark 的重断言（对抗 ui-theme 异步 settings-scope 回退）。

烘焙之后：内置 light/dark **本来就是** chatgpt 配色 → 官方主题激活时
**无需任何动作** → 上述机制可删除；控制器退化为：
"有持久化皮肤选择就 setTheme + 应用；没有就不管"。**少一段运行时博弈
逻辑，就少一类竞态 bug**（这是长期最大的维护收益）。

### 6.3 单一事实源（纪律）

烘焙的配色值必须**直接生成自** `CHATGPT_NIGHT_TOKENS` / `CHATGPT_DAY_TOKENS`
（同一份 token 定义同时喂给"烘焙脚本"与"插件注册"），防止两份值漂移。
建议把这两张 token 表移到仓库共享位置（如 `shared/skins-tokens.ts` 或保持
在 `skins.ts` 并由构建脚本以源码级 import 读取，二选一，见 §8 决策点）。

### 6.4 明确不做

1. **不 fork 上游组件 `*.module.css` 源码**（几十个文件、每次 bump 冲突面大）；
2. **不把几何烘焙进 dist**（破坏热更新、无级联收益、迭代变慢）；
3. **不保留子串匹配**（`_triggerEffort` 这类 bug 会无限复发且静默）。

---

## 7. 关键路径速查（实测核对用）

| 物 | 路径 |
| --- | --- |
| 上游钉版 | `dsh-source.json`（repo 根） |
| 上游 checkout | `.cache/dsh-source/47f943859bef/` |
| 上游构建脚本 | `scripts/build-dsh.mjs`（vision 补丁先例在 `withVisionSettingsNamespace`） |
| staging 脚本 | `scripts/stage-dsh.mjs` |
| 插件构建脚本 | `scripts/build.mjs`（esbuild，`scripts/build-config.mjs` 共享配置） |
| dev 热更新 | `scripts/dev.mjs`（只同步 `@oh-dsh/*` bundle） |
| shell token 入口 | 上游 `apps/web/src/base.css`（@import 5 张 ui-theme sheet） |
| 配色权威文件 | 上游 `packages/client/ui-theme/src/styles/design-platform.css`（338 行） |
| dist 产物 | `apps/web/dist/assets/index-*.css`（壳）、`index-*.js`（内核） |
| 官方组件 css | `packages/*/lib/client.js`（内联字符串 + `data-plugin-css` 注入） |
| 亮暗切换 | 上游 `packages/client/ui-theme/src/boot-theme.ts` → `body[data-ds-dark-theme]` |
| token 绘画器 | `packages/client/ui-layout/lib/types/client/theme-presenter.js` |
| 内置主题空 tokens | `packages/client/ui-theme/src/client/index.ts`（`BUILTIN_THEMES`） |
| 皮肤插件 | `plugins/desktop-skins/src/client/`（`skins.ts` / `skin-controller.ts` / `skin-dom.ts` / `plugin.tsx`） |
| 皮肤测试 | `tests/desktop-skins.test.ts`（当前 280 通过 / 0 失败） |

---

## 8. 实施计划

### 8.1 阶段一：精确类名生成器替换子串选择器（无产品变化，先做）

目标：把 `CHATGPT_GEOMETRY_CSS` 里所有 `[class*="…"]` 子串锚点换成
构建期生成的精确类名，**视觉效果零变化**，只消除误命中这一类 bug。

1. 写 `scripts/generate-skin-selectors.mjs`：
   - 读 `dsh-source.json` 定位 checkout（复用 `scripts/dsh-source.mjs` 的
     `resolveDshSource()`）；
   - 扫描 `apps/web/dist/assets/*.css` 与 `packages/*/lib/client.js`
     （递归，跳过 `.map`），正则收集语义后缀类名；
   - 语义后缀清单来自现有几何 CSS 的锚点（§5.2 列表），**逐个自检**：
     零命中 → 抛错；并输出命中统计；
   - 输出 `plugins/desktop-skins/src/client/generated-selectors.ts`
     （形如 `export const TRIGGER_SELECTOR = '.LqtciG_trigger, .uNlE1G_trigger, .-wizCq_trigger'`，
     或导出数组，皮肤 css 组装时 join）。
2. 改造 `CHATGPT_GEOMETRY_CSS` 组装：
   - 精确类名规则与属性门控（`body[data-oh-dsh-skin*="chatgpt"]`）组合后
     特异性仍然高于组件单类规则（§4.3），**阶段一保留现有 `!important`
     不动**（防御性，避免行为漂移）；仅替换选择器来源。
   - `:not()` 排除项（`_triggerLabel`/`_triggerEffort`/`menuOpen`/
     `menuStatus` 等）继续保留（精确类名下它们大多不再需要，但保留无害；
     如生成器已把 `_triggerEffort` 单独收为独立规则，则可删除对应排除项）。
3. 构建流程接入：
   - `build.mjs`（或 `build-config.mjs`）在 esbuild 前先跑生成器；
   - **顺序约束**：release 流程 `build:dsh` 先于 `build`（§5.3）；
     若当前 `package.json` 的 `dist:*` 顺序不符，调整之并同步注释。
4. 验证（§9.1）。

### 8.2 阶段二：烘焙默认配色 + 控制器简化

1. 写 `scripts/bake-skin-palette.mjs`（或并入 stage-dsh 前处理）：
   - 输入：`CHATGPT_NIGHT_TOKENS` / `CHATGPT_DAY_TOKENS`
     （**单一事实源**，§6.3；先解决 token 表共享位置问题）；
   - 动作：找到 `apps/web/dist/assets/index-*.css`（glob，文件名带 hash），
     末尾追加：

     ```css
     /* === Oh-DSH: baked default palette (chatgpt-day / chatgpt-night) === */
     body { …亮色 token 值… }
     body[data-ds-dark-theme] { …暗色 token 值… }
     ```

     （必须同时追加两段；`body[data-ds-dark-theme]` 特异性高于 `body`，
     否则暗色块会被追加在后的亮色 `body` 块覆盖——顺序与特异性都要对。）
   - **自检**：追加前断言产物 css 里存在 `data-ds-dark-theme` 字样与
     `--dsw-alias-bg-base`（上游若改名/改管线 → 构建报错）；
     追加后断言两段块存在。
   - 建议只在 `stage:dsh`（或 `build:dsh` 之后、stage 之前）执行一次，
     保证 dev 的 stage 也是烘焙过的。
2. 简化 `skin-controller.ts`：
   - 删除 `DEFAULT_SKINS` / `FALLBACK_THEME_KEY` 读写 /
     `skinForFallback()` / `adopt()` 官方分支重断言（§6.2）；
   - `start()`：无持久化选择 → **什么都不做**（内置即 chatgpt）；
   - `setSkin(null)`（"Original"）：清除持久化选择 → 恢复内置主题即可；
   - `dispose()`：恢复内置主题；
   - chatgpt 对仍保留在 `DESKTOP_SKINS`（皮肤选择行的可选卡片），
     选中时的 token 与烘焙值一致，无可见差异。
3. 同步更新 `tests/desktop-skins.test.ts`：
   - 删除/改写依赖默认兜底逻辑的用例（如"official themes resolve to the
     default ChatGPT pair"、"choosing Original restores…" 中涉及
     chatgpt-night 默认激活的断言）；
   - 新增：无选择时 start() 不改主题快照、不写任何存储键。
4. 验证（§9.2）。

### 8.3 决策点（实现时定夺，本文档给出建议）

| 决策点 | 建议 |
| --- | --- |
| 生成的选择器**提交**还是构建期才生成 | **提交**（`generated-selectors.ts` 入库），diff 可审；上游 bump 后重新生成是预期行为 |
| token 表共享位置 | 把 `CHATGPT_NIGHT_TOKENS`/`CHATGPT_DAY_TOKENS` 抽到
  `plugins/desktop-skins/src/shared-tokens.ts`（或 repo 级 `shared/`），
  `skins.ts` 与烘焙脚本各自 import |
| 烘焙时机 | `stage-dsh.mjs` 内（对 `apps/web/dist` 的拷贝执行后处理），
  或独立脚本挂在 `build:dsh` 之后；以"dev 的 stage 也烘焙"为准 |
| `!important` 去留 | 阶段一全保留（零行为漂移）；阶段二只对**实测**仍被
  组件压制的规则保留，其余去掉，并在文档记录依据 |
| 生成器扫描源 | `.cache/dsh-source`（权威）；stage 树作备选/校验 |
| 语义后缀清单维护 | 跟随 `CHATGPT_GEOMETRY_CSS` 的锚点演进；零命中自检兜底 |

---

## 9. 验收标准（新会话实现后逐项核对）

> 验收手段：① 门禁（typecheck / test / build / stage）；② 运行期 CDP 计算
> 样式核对；③ 截图人工核对。CDP 用法参考本项目既有经验
> （`--remote-debugging-port=9223`，`/json/list` 拿 ws，`Runtime.evaluate`
> 查 `getComputedStyle`）。

### 9.1 阶段一验收（精确类名，行为零变化）

1. **误命中消除**：
   - 模型选择器触发器内 `[class*="_triggerEffort"]` 元素计算高度 =
     `18.5938px`（≈ 13px × 1.43），`border-radius: 0`，`display: flex`，
     `align-items: center` —— 不再被胶囊配方拔高；
   - `skins.ts` 里**不再存在** `[class*="_trigger"]` 这类子串选择器
     （grep 校验：`CHATGPT_GEOMETRY_CSS` 内无 `[class*="`）。
2. **既有视觉零变化**（与烘焙/生成前对比，逐项计算样式核对）：
   - 触发器/选择器按钮：`height: 28.5859px`、`border-radius: 999px`；
   - 模型弹出层行（`role="menuitem"`）：`height/min-height: 28.5859px`、
     `padding: 5px 8px`、`font-size: 13px`、`line-height: 18.59px`；
   - 弹出层容器：`border-radius: 12.5px`、`background: rgba(45,45,45,.9)`
     （night）/ `rgba(255,255,255,.96)`（day）、`padding: 4px`、hairline
     阴影 `0 0 0 .5px …`；
   - 发送键（`[class*="_primary"]:not([class*="_button_"])`）：
     `border-radius: 999px`；
   - 会话/项目行：`border-radius: 12.5px`，高度不被动；
   - 对话框按钮（`[class*="_button_"][class*="_md"]`）：`height: 32px`、
     `padding: 6px 16px`；
   - 亮/暗两套各过一遍（`data-oh-dsh-skin` 分别设为 night/day 或在
     Appearance 行切换 system 时 OS 明暗各验一次）。
3. **构建期自检**：语义后缀清单全部有命中（生成器不报错）；人为删掉
   产物里一个后缀类名（临时实验）→ 构建必须失败。
4. **门禁**：`pnpm run typecheck` 0 错误；`pnpm test` 全绿（当前基线
   280 pass / 0 fail / 5 skip，阶段一不应改动测试语义）。
5. **diff 可审**：`generated-selectors.ts` 入库且只有选择器字符串；
   皮肤 CSS 的规则体（token、padding、圆角值）**未变**。

### 9.2 阶段二验收（烘焙默认配色 + 控制器简化）

1. **默认外观原生生效**（关键验收）：
   - 清空皮肤选择（host 偏好 `{activeId:null, fallbackTheme:'system'}`），
     重启 app，**不依赖任何插件行为**：`body` 计算样式
     `--dsw-alias-bg-base` = `#181818`（暗）/ `#ffffff`（亮）等 chatgpt
     值（对照 `CHATGPT_NIGHT_TOKENS` / `CHATGPT_DAY_TOKENS` 全表抽查
     ≥ 10 个 token）；
   - **临时禁用皮肤插件**（如 cordis.patch.yml 去掉注入行）后重启，
     默认配色**仍是 chatgpt 值** —— 证明不依赖运行时；
   - Appearance 行：light → 亮色 chatgpt 值、dark → 暗色 chatgpt 值、
     system → 跟随 OS 明暗各验一次。
2. **皮肤切换仍正常**：
   - 选择 synara-night → `body` 内联 token 覆盖为 synara 值（painter
     机制），`data-oh-dsh-skin` 属性正确；
   - 选择 chatgpt-day → 与烘焙亮色一致（无可见跳变）；
   - 选择"Original"（null）→ 清除持久化选择，回到烘焙默认，**无任何
     存储键残留**（host 偏好文件里 activeId/fallback 干净）。
3. **控制器简化验证**：
   - `skin-controller.ts` 中不再有 `DEFAULT_SKINS` / `FALLBACK_THEME_KEY`
     / `skinForFallback` / `adopt` 官方分支重断言（grep 校验）；
   - 启动竞态回归测试：反复重启 5 次，皮肤状态稳定（无先应用后剥离的
     抖动；CDP 监听 `data-oh-dsh-skin` 属性变化次数，重启后应 ≤ 1 次设置、
     0 次移除）。
4. **门禁**：typecheck 0 错误；`pnpm test` 全绿（测试已按 §8.2.3 改写，
   用例数量允许变化但必须全部通过）；`pnpm run build` + `pnpm run stage:dsh`
   成功且烘焙自检通过。
5. **单一事实源**：烘焙脚本与插件引用同一份 token 定义（改 token 后
   重跑 bake + 重启，两处一致；可用 `scripts/verify-skin-tokens.mjs`
   思路做一致性校验或直接复用）。
6. **升级演练（可选加分）**：把 `dsh-source.json` 指到相邻的上游 commit
   试跑一次 `build:dsh + stage:dsh`，确认生成器与烘焙脚本自检通过、
   补丁面为零（若上游类名变化，生成器应自动重生成）。

### 9.3 全局验收纪律

- 所有改动提交到 `rebase/panel-work` 分支，提交信息遵循仓库既有风格
  （`feat(desktop): …` / `fix(desktop): …` / `refactor(desktop): …`）；
- 每个阶段一个提交（或按逻辑拆分，禁止混入无关改动）；
- 完成一个阶段即跑一次完整门禁 + CDP 验收，再进入下一阶段；
- 若阶段二遇到与 ui-theme 异步回退相关的新竞态，**回到本文档 §6.2
  重新评估"烘焙后是否仍需要兜底"**，并把结论更新进本文档。

---

## 10. 风险与回滚

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 上游 bump 后类名后缀变化 | 生成器重生成即可；语义后缀消失 → 构建报错 | §5.2 自检；升级演练（§9.2.6） |
| 上游改名 `data-ds-dark-theme` 或拆散 token sheet | 烘焙自检失败 | §8.2 追加前断言；失败即停 |
| 烘焙配色与插件 token 漂移 | 切换 chatgpt 皮肤时无可见变化但值不一致 | §6.3 单一事实源 + §9.2.5 校验 |
| 控制器简化引入回归（如 setSkin(null) 语义变化） | 用户可选回官方外观的能力变化 | 阶段二测试改写 + §9.2.3 回归验证；产品上"Original"= 内置 chatgpt 是既定决策 |
| dist 后处理让产物与上游不一致 | 排查样式 bug 时归属模糊 | 烘焙块带注释头 + 文档记录；构建期自检保证可复现 |
| 回滚 | — | 生成器/烘焙都是构建期步骤：去掉步骤即回滚到插件运行时方案；`generated-selectors.ts` 可 revert |

---

## 11. 附录：一句话决策记录

1. 配色（稳定层）→ 构建期烘焙进 dist，默认主题原生即 ChatGPT；
2. 几何（迭代层）→ 留在插件，选择器改为构建期生成的精确类名；
3. 控制器默认兜底逻辑 → 烘焙后删除（长期最大的简化收益）；
4. 永不 fork 上游组件 CSS 源码；
5. 失败要"响"（构建报错）不要"哑"（静默视觉损坏）。
