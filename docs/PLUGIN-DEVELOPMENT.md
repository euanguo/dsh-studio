# Oh-DSH-Desktop 插件开发文档

> 本文档讲解 Oh-DSH-Desktop 的插件体系：DSH（DeepSeek Harness）的 Cordis
> 插件模型、桌面 bundle 的挂载方式、内置插件职责，以及内置皮肤插件
> `@oh-dsh/desktop-skins` 的完整机制与「如何新增一套皮肤」的分步指南。
>
> 适用版本：`0.1.2`（DSH `0.0.1-rc.2`，Electron 42）。

---

## 1. 插件模型总览

Oh-DSH-Desktop 不是一个独立前端，它把固定版本的 DSH runtime、Node.js、
Electron 和本地能力打包进一个 macOS 应用。UI 仍是 DSH 官方 React UI，
桌面能力以 **Cordis 插件** 的形式挂载进去。

### 1.1 三层结构

```text
DSH 官方 Profile + Loader（cordis.yml 插件树）
        │
        ▼
Oh-DSH bundle layer（cordis.patch.yml，patch 进官方插件树）
  │
  ▼
桌面插件（plugins/ 下的 @oh-dsh/* 包，Host/Client 双端）
```

- **官方层**：DSH 的 `dsh-base`、`dsh-web-app` 等官方插件，负责 agent loop、
  Web runtime、settings、locale、ThemeService 等核心契约。
- **bundle layer**：`cordis.patch.yml` 是 Oh-DSH-Desktop 的 bundle patch，
  在随机 loopback 端口启动 Web runtime 后插入桌面插件；服务依赖由各插件
  的 `inject` 和 `dsh.client.inject` 声明。
- **桌面插件层**：`plugins/` 下每个包是一个独立的 Cordis 插件。
  `dsh.client` 声明 Client 端注入信息；Host 端挂载则由插件导出、
  `cordis.patch.yml`、构建脚本和运行时 profile 共同决定。

### 1.2 bundle patch（cordis.patch.yml）

```yaml
# 顶层条目覆盖官方配置
- id: webserver
  config:
    host: 127.0.0.1
    port: 0            # 随机端口

- id: web-runtime
  config:
    mode: production
    printUrl: true
    surfaceContext: false
    lanAddresses: []

# insert 块把桌面插件插入官方插件树
- insert:
    - id: oh-desktop
      name: '@oh-dsh/desktop'
    - id: oh-better-sidebar-runtime
      name: '@oh-dsh/better-sidebar-runtime'
    - id: oh-desktop-skins
      name: '@oh-dsh/desktop-skins'
    - id: oh-desktop-sidebar
      name: '@oh-dsh/desktop-sidebar'
    - id: oh-panel-controls
      name: '@oh-dsh/panel-controls'
    - id: oh-pinned-summary
      name: '@oh-dsh/pinned-summary'
    - id: oh-plugin-marketplace
      name: '@oh-dsh/plugin-marketplace'
```

要点：

- patch 中的 `id` 是插件在 Loader 树中的条目 ID，`name` 是 npm 包名。
- `insert` 列表定义 bundle patch 中的插入顺序；服务依赖由插件的 `inject`
  和 `dsh.client.inject` 声明。当前列表中 `oh-desktop` 位于皮肤和其他 UI
  插件之前。
- `webserver` 使用 `port: 0`，由系统分配随机 loopback 端口，避免与其他
  DSH 实例冲突，并减少固定端口带来的网络暴露面；它不是独立的权限或隔离边界。

### 1.3 一个插件的两种身份：Host 与 Client

大多数桌面插件是「双端」的：

| 端 | 入口文件 | 运行位置 | 能力 |
| --- | --- | --- | --- |
| Host 端 | 通常为 `src/index.ts`（`exports["."]`）；根桌面包使用 `src/plugin.ts` | DSH runtime 的 Node 进程 | 文件系统、PTY、HTTP 路由、应用数据 |
| Client 端 | `src/client.ts`（`exports["./client"]`） | 浏览器 UI | DOM、React 组件、设置页、store |

`package.json` 的 `dsh.client` 字段声明 Client 端如何注入：

```jsonc
"dsh": {
  "client": {
    "inject": ["@deepseek-ai/dsh-client-runtime", "..."],
    "platform": "web",
    "immediately": true
  }
}
```

- `inject`：声明依赖的 Client 端服务包（runtime / locale / slots / settings /
  theme 等），保证加载顺序。
- `platform: "web"`：浏览器平台。
- `immediately: true`：应用启动即加载。

### 1.4 Host / Client 插件契约

插件通常遵循 Cordis 的 `name + inject + apply(ctx)` 形态；具体字段取决于
Host 或 Client 入口及其所依赖的 DSH runtime API：

```ts
export const name = 'oh-xxx'
export const inject = ['desktop', 'webServer']  // 依赖的服务名

export function apply(ctx: HostContext): void {
  ctx.effect(
    () => mountSomething(ctx, ...),  // 注册；返回清理函数
    'oh-xxx: 描述',
  )
}
```

常用契约能力：

| 能力 | 说明 |
| --- | --- |
| `ctx.effect(register, label)` | 在支持该生命周期的入口中注册清理逻辑；Client 插件普遍使用，Host 插件不能据此假定一定存在热卸载 |
| `ctx.get(name)` | 获取注入的服务实例 |
| `ctx.on(event, listener)` | 订阅 typed 事件（如 `theme/change`） |
| `ctx.reflect.provide(name, value)` | 把实例暴露为可注入服务（如 `desktopSkins`） |
| `locale.register(ns, dict)` | 注册中英文翻译字典 |
| `slots.inject(name, register)` | 向官方 UI 槽位注入设置项/组件 |

当前应用的启停、安装、卸载和更新主要通过停止并重启整个 DSH runtime 完成，
并不是插件级热卸载；因此 Host 注册的清理不能以热卸载已经得到保证为前提。

---

## 2. 内置插件一览

| 插件 | 目录 | 来源 | 职责 |
| --- | --- | --- | --- |
| `@oh-dsh/desktop` | `src/` | 自研 | 统一桌面入口：window、菜单、Electron bridge、Agent 能力与插件注册顺序 |
| `@oh-dsh/better-sidebar-runtime` | `plugins/better-sidebar-runtime/` | 仓库内 vendor 的 Better Sidebar Host（`src/`，基线 `3d88752` + 本地扩展，见 `VENDOR.md`） | PTY、Files、Git、history、commit diff 的本地能力层 |
| `@oh-dsh/desktop-sidebar` | `plugins/desktop-sidebar/` | `DSH-better-sidebar` UI 下游 | Session tabs、viewer、Git Review、逐行评论、composer 引用 |
| `@oh-dsh/panel-controls` | `plugins/panel-controls/` | `dsh-web-panel` 下游 | Terminal dock、可拖拽底部面板、Session 状态 |
| `@oh-dsh/pinned-summary` | `plugins/pinned-summary/` | 自研 | 当前 Session 摘要卡片与正文 gutter 管理 |
| `@oh-dsh/plugin-marketplace` | `plugins/plugin-marketplace/` | `plugin-registry` + `dsh-hub` 炼化 | 插件市场的隔离预览、风险确认、TOFU 来源锁、应用与恢复 |
| `@oh-dsh/desktop-skins` | `plugins/desktop-skins/` | `dsh-skins` 下游 | 桌面皮肤：ThemeService 扩展、设置 UI、Host 持久化 |

共享模块：`plugins/shared/`（`i18n.ts` / `use-i18n.ts`，双语翻译辅助）。

---

## 3. 皮肤插件深度解析：`@oh-dsh/desktop-skins`

皮肤插件是目前项目里「扩展 DSH 官方 ThemeService」的范例：它把 DSH 的
官方主题（light/dark/system）扩展为一套桌面皮肤（skin），每套皮肤是
**一组 `--dsw-*` CSS 变量的值**，选中后立即生效并由 Host 持久化。

### 3.1 双端职责

```text
Host 端（index.ts → preferences-server.ts）
  ├─ 在 appDataPath 下持久化 desktop-skins.json
  └─ 注册 GET/PUT /oh-dsh-desktop/skins/preferences HTTP 路由

Client 端（client.ts → plugin.tsx）
  ├─ DesktopSkinsController：注册皮肤到 ThemeService、读写偏好、DOM 应用
  ├─ SkinDomPresenter：把皮肤写到 <body data-oh-dsh-skin="...">
  ├─ DesktopSkinPreferencesStorage：fetch 合并写（dirty loop + 校验）
  └─ SkinSettingsRow：设置页瓦片网格 UI
```

### 3.2 Token 体系（当前内置皮肤使用 32 个变量）

当前每套内置皮肤定义 32 个 token：`--dsw-alias-*`（26 个语义别名）+
`--dsw-specific-*`（6 个组件专用色）。这是当前设计约定；源码类型允许
任意字符串字典，测试只要求至少 30 个键，并未逐项强制这 32 个变量。

#### Alias 组（26 个）

| Token | 语义 | 设计要点 |
| --- | --- | --- |
| `--dsw-alias-bg-base` | 应用最底层背景 | 最深/最浅的基色；深色皮肤通常近黑、带色相 |
| `--dsw-alias-bg-layer-1` | 第一层浮层背景（卡片/面板） | 比 base 亮一档（深色皮肤）或近白（浅色皮肤） |
| `--dsw-alias-bg-layer-2` | 第二层浮层背景 | 再亮一档 |
| `--dsw-alias-bg-layer-3` | 第三层浮层背景 | 再亮一档 |
| `--dsw-alias-bg-overlay` | 覆盖层背景（popover/浮层） | 最亮的背景层 |
| `--dsw-alias-bg-module-platform` | 模块平台背景（固定区域） | 常等于 layer-2 |
| `--dsw-alias-border-l1` | 一级边框 | 弱；用色相化 rgba，透明度约 0.07–0.08 |
| `--dsw-alias-border-l2` | 二级边框 | 中；透明度约 0.12–0.14 |
| `--dsw-alias-border-l3` | 三级边框 | 强；透明度约 0.18–0.22 |
| `--dsw-alias-brand-primary` | 品牌主色 | 决定整套皮肤的「性格」 |
| `--dsw-alias-brand-primary-invert` | 品牌主色上的反色文本 | 主色上的文字/图标色，通常是深色底 |
| `--dsw-alias-brand-text` | 品牌文本色 | 品牌相关的正文色，比主色浅 |
| `--dsw-alias-button-primary-fill` | 主按钮填充 | 常等于品牌主色 |
| `--dsw-alias-button-primary-hover` | 主按钮 hover | 比主色亮一档 |
| `--dsw-alias-interactive-bg-active` | 交互项激活背景 | 主色 rgba，透明度约 0.14–0.16 |
| `--dsw-alias-interactive-bg-hover` | 交互项 hover 背景 | 主色 rgba，透明度约 0.07–0.09 |
| `--dsw-alias-label-primary` | 一级文本 | 最高对比度（近白/近黑） |
| `--dsw-alias-label-secondary` | 二级文本 | 中对比度 |
| `--dsw-alias-label-tertiary` | 三级文本/说明文字 | 低对比度 |
| `--dsw-alias-markdown-code-block` | 代码块背景 | 比 layer-1 更「沉」的深色块 |
| `--dsw-alias-markdown-inline-code` | 行内代码背景 | 与 bubble 相近的中性色 |
| `--dsw-alias-scrollbar-bg-l1` | 滚动条滑块/轨道 | 比背景亮一档的中性色 |
| `--dsw-alias-scrollbar-hover-l1` | 滚动条 hover | 常用品牌主色 |
| `--dsw-alias-state-error-primary` | 错误状态色 | 与主色相协调的红色系 |
| `--dsw-alias-state-success-primary` | 成功状态色 | 与主色相协调的绿色系 |
| `--dsw-alias-state-warn-primary` | 警告状态色 | 与主色相协调的黄色系 |

#### Specific 组（6 个）

| Token | 语义 | 设计要点 |
| --- | --- | --- |
| `--dsw-specific-bubble` | 消息气泡背景 | 与 markdown-inline-code 常相同 |
| `--dsw-specific-input-major` | 主输入框背景 | 比 layer-1 更深一档（深色皮肤）或更白 |
| `--dsw-specific-menu` | 菜单背景 | 比 layer-2 深一档 |
| `--dsw-specific-sidebar-fill` | 侧边栏填充 | 当前实现要求等于 `--dsw-alias-bg-base`（测试强制） |
| `--dsw-specific-sidebar-nav-item-active` | 侧边栏导航激活项 | 常等于 markdown-inline-code |
| `--dsw-specific-sidebar-nav-item-hover` | 侧边栏导航 hover | 介于 layer-1 与 bubble 之间 |

> 设计建议：层级背景（base → layer-1/2/3 → overlay）应逐档递进；
> 边框用「品牌色相的 rgba」而不是纯灰，才有皮肤感；状态色不要照抄
> 默认红绿黄，应围绕主色相微调（例如青蓝皮肤的错误色偏珊瑚红）。

### 3.3 注册与应用链路

```text
plugin.tsx apply(ctx)
  └─ ctx.effect: new DesktopSkinsController(theme, storage, dom).start()
       ├─ 对每套皮肤调用 theme.register({ id, colorScheme, tokens })
       │    （把皮肤注册进 DSH 官方 ThemeService，成为可选主题）
       ├─ 读持久化偏好 ACTIVE_SKIN_KEY（localStorage / Host 文件）
       ├─ 若曾选中皮肤：记录 FALLBACK_THEME_KEY，theme.setTheme(skin.id)
       └─ adopt(theme.getTheme())
            ├─ desktopSkin(active.id) 找到皮肤 → 写回偏好
            └─ dom.apply(skin)
                 ├─ <body data-oh-dsh-skin="oh-dsh-skin-xxx">
  └─ 若插件提供预留的 css 字段：注入 id=oh-dsh-desktop-skins-atmosphere 的 <style>
```

当前所有内置皮肤都没有 `css` 字段，测试也要求其为 `undefined`，因此当前
实际路径只使用 token，不注入额外 skin CSS。

关键行为：

- **外部接管**：官方外观（light/dark/system）被用户改回时，
  `theme/change` 事件 → `controller.adopt()` → 皮肤失效、清除 `ACTIVE_SKIN_KEY`、
  把官方选择存入 `FALLBACK_THEME_KEY`。皮肤系统永远不会「霸占」官方主题。
- **回退**：选择「原始外观」时恢复 FALLBACK（light/dark/system，默认 system）。
- **皮肤选择持久化**：`oh-dsh-desktop.skins.active`（皮肤 ID）与
  `oh-dsh-desktop.skins.fallback`（回退外观）。
- **DOM 只做两件事**：body 属性 + atmosphere 样式表；不碰别的 DOM，职责干净。

### 3.4 偏好持久化（Host 端）

- 存储位置：`<appDataPath>/desktop-skins.json`；`<appDataPath>` 来自
  Electron 的 `app.getPath('userData')`。DSH profile 位于
  `<userData>/dsh/profiles/desktop`，与皮肤偏好文件不是同一路径。
- HTTP API：`GET /oh-dsh-desktop/skins/preferences` 读取，
  `PUT` 写入；PUT 校验 `Origin` 与 `Host` 同源，否则 403。
- 写入先落到随机临时文件 `desktop-skins.json.next-<random>`，再尝试
  `rename`；遇到 `EEXIST` 或 `EPERM` 时使用 `copyFile` 兼容处理。该路径
  不具备原子替换语义。
- 客户端写入通过异步 `dirty` loop 合并连续更新；同一轮没有新的 dirty
  时只发送一次 PUT，不是基于 timer 的 debounce。

### 3.5 设置页 UI

- 通过 `slots.inject('settings.general.item', ...)` 向 DSH 设置页的
  「通用」区注入皮肤设置块（`order: 20`）。
- UI 是瓦片网格（`desktop-skins.css`）：每块瓦片显示预览渐变
  （`skin.preview`）、主色圆点（`skin.accent`）、名称与明暗模式标签。
- 语言：`skins.name.*` 等文案在 `i18n.ts` 中注册（en/zh 双语）。

### 3.6 当前测试约束

`tests/desktop-skins.test.ts` 对每套皮肤断言：

1. `id` 匹配 `/^oh-dsh-skin-/`；
2. `tokens` 至少 30 个键；当前内置皮肤各自提供 32 个 token，但测试不检查
   固定的 32 个键名；
3. `--dsw-alias-bg-base` 是 6 位十六进制颜色（`#rrggbb`）；
4. `--dsw-alias-bg-base` === `--dsw-specific-sidebar-fill`；
5. `css` 为 `undefined`（当前皮肤全部走纯 token，不带额外样式表）；
6. 皮肤 ID 全局唯一。

---

## 4. 新增一套皮肤（分步指南）

### 4.1 设计 token 全集

参照 [3.2 Token 体系](#32-token-体系一套皮肤--32-个变量) 的语义表，先定
「性格」：色相（hue）、明暗（colorScheme）、主色、层级递进节奏。然后
按当前设计约定给出完整 token 集合。建议顺序：

1. 定 `colorScheme`（`light` / `dark`）与 `--dsw-alias-brand-primary`；
2. 推背景 6 件套（base → layer-1/2/3 → overlay、module-platform）；
3. 推边框 3 档（色相化 rgba）；
4. 推品牌/按钮/交互 6 件套；
5. 推文本 3 级（对比度递减）；
6. 推 markdown 2 件、滚动条 2 件；
7. 推状态 3 色（围绕主色相协调）；
8. 推 specific 6 件（bubble = inline-code、sidebar-fill = bg-base、
   nav-active = bubble、nav-hover 介于 layer-1 与 bubble 之间）。

### 4.2 通常需要更新的文件

| 文件 | 改动 |
| --- | --- |
| `plugins/desktop-skins/src/preferences.ts` | `DESKTOP_SKIN_IDS` 数组追加新 ID |
| `plugins/desktop-skins/src/client/skins.ts` | 新增 token 常量 + `DESKTOP_SKINS` 追加条目 |
| `plugins/desktop-skins/src/client/i18n.ts` | 新增 `skins.name.<id>` 文案（en/zh） |
| `tests/desktop-skins.test.ts` | 如果测试仍保留固定数量断言，则同步更新；当前为 6 |

> 真实案例：`oh-dsh-skin-synara-night`（暗色）与 `oh-dsh-skin-synara-day`（亮色）
> 两套从 Synara web-next 前端设计体系逐 token 映射的皮肤，完整设计过程与
> 映射依据见 [docs/SYNARA-NIGHT-SKIN-DESIGN.md](./SYNARA-NIGHT-SKIN-DESIGN.md)。

`skins.ts` 条目示例：

```ts
Object.freeze({
  id: 'oh-dsh-skin-<your-id>',
  colorScheme: 'dark',
  tokens: YOUR_SKIN_TOKENS,
  preview: 'linear-gradient(145deg, #… 0%, #… 100%)',
  accent: '#…',          // 与 brand-primary 一致
  label: 'skins.name.<your-id>',
}),
```

`preview` 是设置页瓦片的渐变预览，`accent` 是瓦片主色圆点——两者都要
体现新皮肤的性格。

### 4.3 验证

```sh
pnpm test          # 全部 node:test（含 desktop-skins.test.ts）
pnpm typecheck     # tsc --noEmit
```

如果还需要在应用里看效果：

```sh
pnpm run build && pnpm run stage:dsh && pnpm start
```

---

## 5. 构建与验证（常用命令）

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖（electron / esbuild / node-pty 允许构建） |
| `pnpm run build` | esbuild 构建全部插件 + 根入口 |
| `pnpm run build:dsh` | 构建固定版本 DSH（需源码 checkout 或缓存） |
| `pnpm run stage:dsh` | 把 DSH 产物 staging 到应用资源目录 |
| `pnpm test` | node:test 全量测试 |
| `pnpm typecheck` | TypeScript 全量类型检查 |
| `pnpm run check:plugins` | 运行时冒烟（runtime 加载插件树） |
| `pnpm start` | 构建 + staging + 启动 Electron |
| `pnpm run dist:mac[:quick]` | 打 DMG/ZIP 发行包 |

发布前验证链（README 要求）：

```sh
pnpm run typecheck
pnpm test
pnpm run dist:mac
pnpm run smoke:app
codesign --verify --deep --strict release/mac-arm64/Oh-DSH-Desktop.app
hdiutil verify release/Oh-DSH-Desktop-0.1.2-arm64.dmg
```
