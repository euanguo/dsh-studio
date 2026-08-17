# AGENTS.md — Desktop plugins

These rules apply under `plugins/`. They narrow the repository
[AGENTS.md](../AGENTS.md) for Oh-DSH Cordis plugins that render into the
DSH web client.

## Official chrome

`@deepseek-ai/dsh-client-ui-primitives` is a platform seed. Every
`dsh.client` plugin may import it. Client builds must list it in
`external` so the frozen module table supplies one copy.

Use these atoms for plugin chrome. Import them from the official package.
Do not re-export them from `@oh-dsh/shared`. Do not add a wrapper that
preserves a retired Oh-DSH name or prop list.

| Need | Official export |
| --- | --- |
| Button | `Button` (`primary` / `ghost` / `outline` / `toolbar`; `sm` / `md`) |
| Single-line field | `Input` |
| Dropdown or context menu | `Menu` (`portal` when an ancestor clips) |
| Dialog | `Modal` |
| Confirm a dangerous apply | `RiskConfirmation` |
| Hover label | `Tooltip` |
| Transient banner | `Toast` |
| Chip / filter / badge | `Pill` |
| Session or tab status | `StateDot` |
| Icon | `Icon*Outline*` / `Icon*Fill*` |
| Clipboard write | `writeClipboard` |

`DisclosureRow`, `TerminalBlock`, `ReadBlock`, `DiffBlock`,
`SearchBlock`, `WebBlock`, `MarkdownText`, and `MessageText` belong to
conversation tool cards. Do not use them as sidebar, terminal-dock, or
marketplace chrome.

## Icons

Prefer the official `Icon*` set. `@oh-dsh/shared/icons` holds only glyphs
the official set does not ship. `@oh-dsh/shared/tabler-icons` is
`FileGlyph` only (extension-colored file icons).

Do not add Tabler chrome icons. Do not inline a close / plus / search
SVG when an official icon exists.

## Tokens

Colors, type, and elevation come from `--dsw-alias-*` (and `--dsw-static-*`
when a semantic alias does not exist). `@oh-dsh/shared/theme.css` may add
spacing, radius, and control-size bridges that DSW does not name. Feature
CSS must not introduce a second palette.

## Do not invent a second kit

There is no Oh-DSH Button, Dialog, Toast surface, or icon alias layer.
A product-only composite (ListRow, SurfaceTab, a settings section) may
live in `@oh-dsh/shared` or a plugin. It composes official atoms; it does
not restyle them into a parallel language.

Do not import components from another official UI plugin
(`dsh-client-ui-workspace`, `dsh-client-ui-settings-*`, and the rest).
Compose through `ctx.slots`. Cross-plugin value imports are forbidden.

## Settings and slots

Settings rows contributed through `settings.section` or
`settings.general.item` use `Button`, `Input`, `Modal`, and official
icons for their controls. Feature cards and skin tiles may keep a
product layout; their actions and glyphs still come from primitives.
