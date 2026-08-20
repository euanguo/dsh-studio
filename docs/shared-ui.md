# 插件共享 UI 组件

`@dsh-studio/shared` 采用 shadcn/ui 的源码与维护方式来管理产品级 React
组合件，但它不是第二套运行时原子组件库。

## 分工

| 需求 | 来源 |
| --- | --- |
| Button、Input、Menu、Modal、Tooltip、Toast、Pill、StateDot | 直接从 `@deepseek-ai/dsh-client-ui-primitives` 引入 |
| 产品组合件和布局语义 | `@dsh-studio/shared/ui` |
| 颜色、字号、间距、圆角、控件几何 | `@dsh-studio/shared/theme.css` 与 `--dsw-*` token |
| 动态浏览器样式挂载 | `@dsh-studio/shared/style-injector` 的 `ensureStyle()` |

不要在 shared 中新增 `Button`、`Modal`、`Menu`、`Toast` 或图标别名。这些
原子由 DSH 官方 primitive 提供，插件必须直接消费，避免形成第二套 chrome
语言。

## 组件清单

`@dsh-studio/shared/ui` 当前提供：

- `ListRow` 及其 slots：导航器、树和侧栏行。
- `SurfaceTab`、`SurfaceTabStrip`：surface host 和标签栏。
- `Scrollable`：稳定滚动条轨道和可选边缘渐隐。
- `Card`、`CardHeader`、`CardTitle`、`CardDescription`、`CardAction`、
  `CardContent`、`CardFooter`。
- `Field`、`FieldGroup`、`FieldLabel`、`FieldDescription`、`FieldError`、
  `FieldSet`、`FieldLegend`、`FieldMessage`。
- `Separator`：水平或垂直分隔线。
- `Alert`、`AlertTitle`、`AlertDescription`、`AlertAction`。
- `Empty`、`EmptyHeader`、`EmptyMedia`、`EmptyTitle`、
  `EmptyDescription`、`EmptyContent`。
- `Skeleton` 和 `FilenameLabel`。

旧的 `@dsh-studio/shared/list-row`、`surface-tab`、`scrollable` 路径仍然
保留兼容导出；仓库内部的新代码应优先使用 `@dsh-studio/shared/ui`。
三组旧组件的实现已经迁移到 `plugins/shared/ui`，不是再维护两份代码。

## Token 方案

`plugins/shared/components.json` 是 shared workspace package 的 shadcn
配置，CSS 目标是既有的 `theme.css`。它不会添加 Tailwind、Radix、Sonner、
lucide 或新的色板。组件使用的 namespaced semantic bridge 在 `theme.css`
中定义，并映射到官方 DSW token：

- surface 与文字：`--dsw-alias-bg-*`、`--dsw-alias-label-*`；
- 交互与边框：`--dsw-alias-interactive-*`、`--dsw-alias-border-*`；
- 主色与危险状态：`--dsw-alias-brand-*`、`--dsw-alias-button-*`、
  `--dsw-alias-state-error-*`；
- 产品几何：`--dsh-studio-space-*`、`--dsh-studio-radius-*`、
  `--dsh-studio-control-*`。

皮肤切换仍然只需要更新 DSW 变量，shared UI 不读取固定的亮色/暗色调色板。
`@dsh-studio/shared/ui-styles` 会聚合新组件、ListRow、SurfaceTab、
Scrollable 和 FilenameLabel 的 CSS，插件作者不需要记住每个组件对应的
样式文件。

## 使用方式

在 shared workspace 中运行 CLI，因为仓库使用 pnpm workspace 且组件源码由
shared package 自己拥有：

```sh
pnpm --dir plugins/shared dlx shadcn@latest search @shadcn -q "card"
pnpm --dir plugins/shared dlx shadcn@latest add card --dry-run
```

生成文件必须逐个审阅。registry 组件通常假设 Tailwind utility class 或
某个 primitive 包；在本项目中保留 shadcn 的组合结构和 `data-slot` 约定，
再改成 plain React 与 DSW token。不要直接把 registry 默认的 Button、Dialog、
Radix 或 Tailwind 运行时带进生产包。

插件渲染 shared UI 时，通过 `ensureStyle` 注入 `theme.css` 与
`ui-styles`：

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@dsh-studio/shared/ui'
import sharedStyles from '@dsh-studio/shared/ui-styles'
import themeCss from '@dsh-studio/shared/theme.css'
import { ensureStyle } from '@dsh-studio/shared/style-injector'

const stopStyle = ensureStyle('my-plugin-shared-ui', `${themeCss}\n${sharedStyles}`)
```

卡片内的操作仍然直接使用官方原子：

```tsx
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
```

组件的 feature-specific CSS 继续放在插件自身，不在 shared UI 中引入业务状态。
