# Shared UI components for plugins

`@dsh-studio/shared` uses shadcn/ui as a source and maintenance convention for
product-level React compositions. It is not a second runtime atom library.

## Division of responsibility

| Need | Source |
| --- | --- |
| Button, input, menu, dialog, tooltip, toast, pill, status dot | Direct imports from `@deepseek-ai/dsh-client-ui-primitives` |
| Product composites and layout semantics | `@dsh-studio/shared/ui` |
| Colors, type, spacing, radius, and control geometry | `@dsh-studio/shared/theme.css` and `--dsw-*` tokens |
| Dynamic browser style mounting | `ensureStyle()` from `@dsh-studio/shared/style-injector` |

Do not add a shared `Button`, `Modal`, `Menu`, `Toast`, or icon alias. These
atoms are supplied by DSH's official primitives and plugins must consume them
directly. This keeps one chrome language and one platform runtime.

## Component inventory

`@dsh-studio/shared/ui` currently provides:

- `ListRow` and its slots for navigators, trees, and sidebar rows.
- `SurfaceTab` and `SurfaceTabStrip` for surface hosts and tab strips.
- `Scrollable` for stable scrollbar lanes and optional edge fades.
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`,
  `CardContent`, and `CardFooter`.
- `Field`, `FieldGroup`, `FieldLabel`, `FieldDescription`, `FieldError`,
  `FieldSet`, `FieldLegend`, and `FieldMessage`.
- `Separator` for horizontal or vertical rules.
- `Alert`, `AlertTitle`, `AlertDescription`, and `AlertAction`.
- `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`,
  `EmptyDescription`, and `EmptyContent`.
- `Skeleton` and `FilenameLabel`.

The old `@dsh-studio/shared/list-row`, `surface-tab`, and `scrollable` paths
remain compatibility exports. New repository code should prefer
`@dsh-studio/shared/ui`. The three existing composites now have their
canonical implementations in `plugins/shared/ui`; they are not maintained as
two separate copies.

## Token model

`plugins/shared/components.json` is the shadcn configuration for the shared
workspace package. Its CSS target is the existing `theme.css`. It does not add
Tailwind, Radix, Sonner, lucide, or a new palette. The namespaced semantic
bridge in `theme.css` maps the source-layer concepts to official DSW tokens:

- surfaces and text: `--dsw-alias-bg-*` and `--dsw-alias-label-*`;
- interaction and borders: `--dsw-alias-interactive-*` and
  `--dsw-alias-border-*`;
- primary and destructive states: `--dsw-alias-brand-*`,
  `--dsw-alias-button-*`, and `--dsw-alias-state-error-*`;
- product geometry: `--dsh-studio-space-*`, `--dsh-studio-radius-*`, and
  `--dsh-studio-control-*`.

Skin changes continue to flow through the same DSW variables. Shared UI does
not read a hard-coded light/dark palette. `@dsh-studio/shared/ui-styles`
aggregates the new components, ListRow, SurfaceTab, Scrollable, and
FilenameLabel styles so plugin authors do not need to remember every file.

## Usage

Run the CLI from the shared workspace because this repository is a pnpm
workspace and the shared package owns its component sources:

```sh
pnpm --dir plugins/shared dlx shadcn@latest search @shadcn -q "card"
pnpm --dir plugins/shared dlx shadcn@latest add card --dry-run
```

Review every generated file. Registry components usually assume Tailwind
utility classes or a primitive package. In this project, keep the shadcn
composition and `data-slot` conventions, then adapt the implementation to
plain React and DSW tokens. Do not bring the registry's default Button,
Dialog, Radix, or Tailwind runtime into the production bundle.

A plugin that renders shared UI should inject `theme.css` and `ui-styles` with
`ensureStyle`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@dsh-studio/shared/ui'
import sharedStyles from '@dsh-studio/shared/ui-styles'
import themeCss from '@dsh-studio/shared/theme.css'
import { ensureStyle } from '@dsh-studio/shared/style-injector'

const stopStyle = ensureStyle('my-plugin-shared-ui', `${themeCss}\n${sharedStyles}`)
```

Actions inside that card still use the official atom directly:

```tsx
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
```

Feature-specific CSS remains local to the plugin and should not introduce new
palette semantics into the shared source layer.
