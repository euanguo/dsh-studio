# 外部插件接入指南：基于 @dsh-studio/sidebar 注册新页面与文件预览器

> 面向 **消费插件开发者**：如何让你的插件向 DSH Studio 侧边栏注册新的侧边栏 tab、文件类型预览器、
> 中间工作区（center surface）渲染器与声明式设置。
>
> 适用版本：**0.1.2+**（`ctx.desktopSidebar` 服务契约化后）。
> 权威代码：`plugins/sidebar/src/client/contract.ts`（契约定义）、`plugins/sidebar/src/client/sidebar-service.ts`（服务实现）、
> `plugins/sidebar/src/client/builtins/`（内置 tab/viewer/surface 参考实现）、
> `plugins/sidebar-desktop/src/client/plugin.tsx`（真实消费插件示例）。

---

## 1. 总览：你能扩展什么

DSH Studio 侧边栏是一个**注册表服务**（对齐上游 DSH-better-sidebar 的 `ctx.betterSidebar` 契约）：

- **新页面（tab）**：注册一种新的侧边栏 tab 类型，出现在侧边栏 `+` 菜单里，用户点击后在右栏打开你的 React 页面；也支持**动作型 tab**（点击执行动作而不开 tab，如打开底部终端）。
- **文件预览器（file viewer）**：注册一种文件类型预览器，让文件 tab 走你的渲染组件（覆盖或补充内置的 text/html/markdown/binary）。
- **中间工作区渲染器（surface renderer）**（DSH Studio 扩展）：注册一种 center surface 渲染器——文件/diff/浏览器等页面开在 DSH 对话上方的中间工作区。
- **声明式设置（settings）**：每个注册的 tab/viewer 自动获得设置页卡片（启用开关），并可声明自己的设置行（绑定宿主字段或插件自有字段）或自定义设置面板。

内置的 tab（review/files/file/terminal/side-chat/trajectory）、viewer（binary/html/markdown/text）与
surface（file/diff/commit/…）**自己也是通过同一套 API 注册的**（吃自己的狗粮），所以外部插件的能力与内置功能完全对等。

**关键机制一句话**：`@dsh-studio/sidebar` 的 client half 在 `apply()` 里通过 `ctx.reflect.provide('desktopSidebar', service)` 发布服务；
消费插件在 `inject` 里声明 `'desktopSidebar'`，然后调用 `ctx.desktopSidebar.registerTab(...)` / `registerViewer(...)` /
`registerSurfaceRenderer(...)` 完成注册；返回的 disposer 由你的 `ctx.effect()` 在 fiber 卸载（HMR / 禁用）时自动调用。

> ⚠️ **服务只在 client half**：`ctx.desktopSidebar` 只存在于浏览器侧。host 半需要读侧边栏状态时，
> 走它自己的 HTTP 路由（`/sidebar/api/*`），不走服务。

---

## 2. 前置：类型合并与依赖声明

### 2.1 类型合并

你的插件拿到 `ctx.desktopSidebar` 的完整类型：

```ts
import type {} from '@dsh-studio/sidebar/client/contract'  // 触发 declare module 'cordis' 类型合并
```

这个 **type-only import** 在编译时被擦除，不产生任何运行时依赖。在真实 cordis 环境（DSH 官方插件）里，
`ctx.desktopSidebar` 自动出现在你的 `Context` 类型上；在非 cordis 环境（如本仓库插件族），
用你自己的结构类型 + 从契约 import 显式类型。

### 2.2 package.json 声明

```jsonc
{
  "name": "my-plugin",
  "peerDependencies": {
    "react": "^18.2.0",
    "@dsh-studio/sidebar": "workspace:*"
  },
  "peerDependenciesMeta": {
    "@dsh-studio/sidebar": { "optional": true }
  }
}
```

`@dsh-studio/sidebar` 声明为 **peerDependency**（避免重复实例化）；`optional: true` 让插件在侧边栏未安装时也能加载。

---

## 3. Tab 注册 API

### 3.1 `SidebarTabDescriptor` 完整字段

```ts
interface SidebarTabDescriptor {
  /** 唯一 id；也是 SidebarTab.type 的值。建议带包前缀：'my-plugin:db'。 */
  id: string
  /** 标题（i18n 友好：字符串或 () => string）。 */
  title: string | (() => string)
  /** 图标：ReactNode 或 (size) => ReactNode。 */
  icon?: ReactNode | ((size: number) => ReactNode)
  /** + 菜单排序（升序）；默认 100。 */
  order?: number
  /** 从 + 菜单隐藏（file tab 用：由文件打开触发，不在菜单里）。 */
  hidden?: boolean
  /** + 菜单禁用判定。两参：scope（session + cwd）、当前快照。 */
  available?: (scope: SidebarScope | null, state: SidebarSnapshot) => boolean
  /** 单实例语法糖：`single: true` ≡ `dedupeKey: () => id`。 */
  single?: boolean
  /** 去重键：openTab 时若已存在同 key 的 tab 则聚焦而非新开。 */
  dedupeKey?: (tab: SidebarTab) => string | undefined
  /** 自定义 tab 创建（铸造 SidebarTab + 状态 patch）。返回 null 拒绝创建。 */
  createTab?: (seed: SidebarTabSeed, tabs: readonly SidebarTab[]) =>
    { tab: SidebarTab; patch?: { tabs?: readonly SidebarTab[]; activeId?: string | null } } | null
  /** 外链点击目标认领：外链被拦截时第一个 urlTarget 命中的 tab 打开（URL 作 resource seed）。 */
  urlTarget?: (url: URL) => boolean
  /** 声明式设置（见 §6）。 */
  settings?: SidebarSettingsDeclaration
  /** tab 角标：number 渲染计数（99+ 封顶），string 原样。抛错吞掉。 */
  badge?: (scope: SidebarScope | null, state: SidebarSnapshot) => string | number | null | undefined
  /** 生命周期回调（仅 SERVICE 路径触发）：新建 → onOpen；聚焦 → onActivate；关闭 → onClose。 */
  onOpen?: (tab: SidebarTab, scope: SidebarScope) => void
  onActivate?: (tab: SidebarTab, scope: SidebarScope) => void
  onClose?: (tab: SidebarTab, scope: SidebarScope) => void
  /** 渲染函数。action 型 tab（无 render）是菜单快捷键：点击执行 action。 */
  render?: (props: SidebarRenderProps) => ReactNode
  /** 点击执行动作而不开 tab（DSH Studio 扩展，上游没有）。 */
  action?: () => void | Promise<void>
  /** 'custom' 渲染无 chrome 的正文；'standard' 加标准 tab chrome。 */
  chrome?: 'custom' | 'standard'
  /** 无工作区时禁用 + 菜单行。 */
  requiresWorkspace?: boolean
  /** + 菜单里的快捷键提示（仅展示）。 */
  shortcut?: string
}
```

### 3.2 `SidebarRenderProps`

```ts
interface SidebarRenderProps {
  active: boolean        // 是否当前激活 tab 且面板打开（不可见时暂停轮询等）
  close(): void
  patch(patch: { resource?: string; title?: string; meta?: unknown }): void
  scope: SidebarScope | null   // { sessionId, cwd? } —— 渲染目标会话
  tab: SidebarTab
}
```

### 3.3 注册示例

**最简 tab**（单实例、+ 菜单可见）：

```ts
ctx.effect(() =>
  ctx.desktopSidebar.registerTab({
    id: 'my-plugin:notes',
    title: 'Notes',
    icon: <NoteIcon />,
    order: 50,
    single: true,
    render: ({ scope }) => <NotesView sessionId={scope?.sessionId} />,
  })
)
```

**动作型 tab**（点击执行、不开 tab）：

```ts
ctx.effect(() =>
  ctx.desktopSidebar.registerTab({
    id: 'my-plugin:sync',
    title: 'Sync',
    order: 60,
    action: async () => { await runSync() },
  })
)
```

**认领外链**（`features.includes('urlTarget')` gate）：拦截的外链路由到第一个 `urlTarget` 命中的 tab，
URL 作为 resource seed；内置 browser 是隐式兜底：

```ts
ctx.effect(() => {
  if (!ctx.desktopSidebar.features.includes('urlTarget')) return
  return ctx.desktopSidebar.registerTab({
    id: 'my-plugin:docs',
    title: () => 'Docs',
    order: 80,
    urlTarget: url => url.hostname === 'docs.my-site.com',
    render: ({ tab }) => <DocsView url={tab.resource} />,
  })
})
```

### 3.4 内置 tab（不可重复注册）

| id | order | single | hidden | 用途 |
|---|---|---|---|---|
| `review` | 10 | ✅ | | Git Review 面板 |
| `terminal` | 20 | — | | 动作型：开底部终端 dock |
| `files` | 40 | ✅（按 resource） | | 文件树 |
| `file` | — | ✅（按 resource） | ✅ | 文件查看/预览（由 openFile 触发） |
| `side-chat` | 50 | — | | 动作型：新建侧边对话 |
| `trajectory` | 60 | — | | 动作型：打开轨迹 |
| `browser`（sidebar-desktop） | 30 | — | | Electron webview 浏览器 |

你的 `id` 不可与上述重复，否则 `registerTab` 抛 `"sidebar: duplicate tab ..."`。

---

## 4. FileViewer 注册 API

```ts
interface SidebarViewerDescriptor {
  id: string
  title?: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  /** 小写无点扩展名数组；[] = catch-all（仅最低优先级有效）。 */
  exts: readonly string[]
  /** 优先级（高优先）；默认 0。内置：binary=100 / html=30 / markdown=20 / text=-100。 */
  priority?: number
  /** 字节获取策略：'none' | 'fsRead' | 'mediaUrl' | 'custom' | 'binary-download' */
  fetchStrategy: SidebarFileFetchStrategy
  /** 内容嗅探（覆盖 exts）：head 字节可用时第一个 detect 命中的 viewer 命中。 */
  detect?: (path: string, head: Uint8Array) => boolean
  settings?: SidebarSettingsDeclaration
  render?: (input: SidebarViewerRenderInput) => ReactNode
}

interface SidebarViewerRenderInput {
  content?: string      // fsRead 文本
  path: string
  resourceUrl?: string  // mediaUrl
  scope?: SidebarScope  // custom 策略自取字节
  title: string
  truncated?: boolean
}
```

**匹配算法**：`matchViewer(path, head?)` 单趟按 priority 降序遍历，每个描述符先 `detect`（有 head 时）后 `exts`；
`exts: []` 且无 `detect` 是盲 catch-all。禁用（设置页关掉）的 viewer 被跳过。

**示例**（CSV 预览器，覆盖同名扩展名）：

```ts
ctx.effect(() =>
  ctx.desktopSidebar.registerViewer({
    id: 'my-plugin:csv',
    exts: ['csv'],
    priority: 10,          // 高于内置 text 的 -100
    fetchStrategy: 'fsRead',
    render: ({ content, path, title }) => <CsvGrid text={content ?? ''} path={path} />,
  })
)
```

---

## 5. Center surface 渲染器注册（DSH Studio 扩展）

```ts
ctx.effect(() =>
  ctx.desktopSidebar.registerSurfaceRenderer('my-kind', surface => {
    if (surface.kind !== 'my-kind') return null
    return <MySurfaceView surface={surface} />
  })
)
```

`kind` 必须是 `CenterSurfaceKind` 联合成员（`'file' | 'diff' | 'diff-all' | 'commit' | 'commit-file' |
'committed' | 'conflict' | 'browser' | 'conversation' | 'terminal'`）。桌面插件的 webview 浏览器
（`sidebar-desktop`）就是这么注册的——这是"桌面能力作为增强层"的标准模式。

---

## 6. 声明式设置

每个注册的 tab/viewer 自动出现在 DSH 设置页「侧边栏」分区的卡片清单里（图标 + 标题 + 类型 id + 高亮 = 启用）。
声明 `settings` 后卡片会出现齿轮按钮（仅启用时），打开设置弹窗：

```ts
settings?: {
  /** 绑定宿主 prefs 字段的设置行（内置键：'agentTerminalTools' / 'bottomPanelAutoTerminal' /
   *  'browserInterceptLinks' / 'interceptOpenPath'；未知 key 被设置 seam 丢弃）。 */
  toggles?: readonly SidebarSettingToggle[]
  /** 插件自有设置行：key 是插件局部的，持久化在 pluginSettings[<descriptor id>]，
   *  无需宿主 schema 字段。值必须 JSON 可序列化。 */
  pluginToggles?: readonly SidebarSettingToggle[]
  /** 自定义设置面板：给出时齿轮弹窗渲染它而非行列表。 */
  render?: (props: SidebarSettingsRenderProps) => ReactNode
}

interface SidebarSettingToggle {
  key: string
  title: string | (() => string)
  desc?: string | (() => string)
  type?: 'switch' | 'text' | 'number'   // 缺省 'switch'
  min?: number
  max?: number
  placeholder?: string
  unit?: string
}

interface SidebarSettingsRenderProps {
  prefs: Record<string, unknown>          // 宿主 prefs（runtime + openByDefault + width）
  pluginSettings: Record<string, unknown> // 本描述符的 pluginSettings blob
  updatePluginSetting(key: string, value: unknown): void
  close(): void
}
```

> `settings.render` 抛错会被吞掉并显示内联错误，一个坏插件不会弄坏设置页。

---

## 7. 生命周期与 HMR

- **disposer 必须返回**：`registerTab` / `registerViewer` / `registerSurfaceRenderer` 返回 `() => void`，
  你的 `ctx.effect(() => register(...))` 在 fiber 卸载时自动调用。不包 `ctx.effect` 会导致下次激活时
  `"duplicate tab"` 错误。
- **注册时机**：`ctx.reflect.provide('desktopSidebar', service)` 在 `apply()` 开头执行，
  消费方 `inject = ['desktopSidebar']` 保证服务就绪后才激活。
- **顺序无关**：Cordis 的 `inject` 保证服务就绪后才激活你的插件；可在 `apply` 内任意时刻注册。
- **降级**：localStorage 里持久化的 tab 若其 type 未注册（你的插件未加载），渲染为 OrphanedTab 占位卡
  （"插件未加载" + 类型 id + 关闭按钮）；你的插件加载后下次渲染自动恢复。

---

## 8. 完整最小示例

> 插件 `my-plugin`：加一个 "Database 浏览器" tab + `.csv` 文件预览器 + 一个插件自有设置。

```tsx
// my-plugin/src/client/index.tsx
import { createElement } from 'react'
import type {} from '@dsh-studio/sidebar/client/contract'  // 触发 ctx.desktopSidebar 类型合并
import type { Context } from 'cordis'

export const inject = ['desktopSidebar']

export function apply(ctx: Context): void {
  // Database tab（单实例，带插件自有设置）
  ctx.effect(() =>
    ctx.desktopSidebar.registerTab({
      id: 'my-plugin:db',
      title: () => 'Database',
      order: 50,
      single: true,
      settings: {
        pluginToggles: [{
          key: 'pageSize',
          title: 'Page size',
          type: 'number',
          min: 10,
          max: 100,
          unit: 'rows',
        }],
      },
      render: ({ scope, tab }) =>
        createElement(DbView, { sessionId: scope?.sessionId, pageSize: 25 }),
    })
  )

  // CSV viewer（priority 高于内置 text 兜底）
  ctx.effect(() =>
    ctx.desktopSidebar.registerViewer({
      id: 'my-plugin:csv',
      exts: ['csv'],
      priority: 10,
      fetchStrategy: 'fsRead',
      render: ({ content, path }) =>
        createElement(CsvGrid, { text: content ?? '', path }),
    })
  )
}
```

**安装**：把 `my-plugin` 加进 profile 的 `dependencies`（`"my-plugin": "link:<路径>"`），
在 `cordis.patch.yml` 加挂载行，构建后浏览器硬刷新即可。

---

## 9. 能力探测

服务暴露 `version` 与单调 `features` 清单（只增不删），消费插件按能力 gate 新 API：

```ts
const features: readonly string[] = [
  'badge', 'tabLifecycle', 'updateTab', 'openFile', 'targetedOpen',
  'stateSubscription', 'tabMeta', 'pluginSettings', 'urlTarget', 'surfaceRenderer',
]
```

```ts
if (ctx.desktopSidebar.features.includes('tabMeta')) {
  // 可以使用 tab.meta / updateTab 的 meta
}
```

---

## 10. 参考实现

- **内置注册**：`plugins/sidebar/src/client/builtins/tabs.tsx`、`viewers.tsx`、`surfaces.tsx`
- **真实消费插件**：`plugins/sidebar-desktop/src/client/plugin.tsx`（browser tab + surface renderer + 声明式设置）
- **设置 seam**：`plugins/sidebar/src/client/settings.tsx`
- **契约测试**：`tests/sidebar.test.ts`（生命周期 / badge / urlTarget / pluginSettings / targeted open / surface renderers）
