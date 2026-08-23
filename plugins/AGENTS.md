# AGENTS.md — Desktop plugins

These rules apply under `plugins/`. They narrow the repository
[AGENTS.md](../AGENTS.md) for DSH Studio Cordis plugins that render into the
DSH web client.

## Upstream DOM probes

Any selector, `data-slot`, aria-label, or class-name probe into the DSH web
client's DOM lives in exactly ONE module per plugin (the sidebar's is
`sidebar/src/client/surfaces/dsh-dom.ts`), with the coupling documented where
the probe is declared. Never spell upstream selectors inline in feature code:
an upstream bump must be re-pinnable by editing one file. Open semantics
(intents, preview vs pinned, activation) go through
`@dsh-studio/shared/workbench-contracts` (`resolveOpenPlan`) instead of being
re-decided at each call site.

## Official chrome

`@deepseek-ai/dsh-client-ui-primitives` is a platform seed. Every
`dsh.client` plugin may import it. Client builds must list it in
`external` so the frozen module table supplies one copy.

Use these atoms for plugin chrome. Import them from the official package.
Do not re-export them from `@dsh-studio/shared`. Do not add a wrapper that
preserves a retired DSH Studio name or prop list.

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
| Clipboard write | `writeClipboard` |

`DisclosureRow`, `TerminalBlock`, `ReadBlock`, `DiffBlock`,
`SearchBlock`, `WebBlock`, `MarkdownText`, and `MessageText` belong to
conversation tool cards. Do not use them as sidebar, terminal-dock, or
marketplace chrome.

## Icons

Icons are not required to come from official primitives. Sidebar and
other DSH Studio chrome use the installed `@tabler/icons-react` set via
`@dsh-studio/shared/tabler-icons` (16px, stroke 1.5). File trees use
`FileGlyph`. Official `Icon*` glyphs are optional for left-rail and
other surfaces that already match the official product.

## Tokens

Colors, type, and elevation come from `--dsw-alias-*` (and `--dsw-static-*`
when a semantic alias does not exist). `@dsh-studio/shared/theme.css` may add
spacing, radius, and control-size bridges that DSW does not name. Feature
CSS must not introduce a second palette.

## Do not invent a second kit

There is no DSH Studio Button, Dialog, Toast surface, or icon alias layer.
A product-only composite (ListRow, SurfaceTab, a settings section) may
live in `@dsh-studio/shared` or a plugin. It composes official atoms; it does
not restyle them into a parallel language.

Do not import components from another official UI plugin
(`dsh-client-ui-workspace`, `dsh-client-ui-settings-*`, and the rest).
Compose through `ctx.slots`. Cross-plugin value imports are forbidden.

## Settings and slots

Settings rows contributed through `settings.section` or
`settings.general.item` follow the official General-row layout: 14px
title, 12px tertiary description, 16px vertical padding, hairline
separator, control on the right. Use official `Button` / `Input` /
`Modal` for those controls. Do not wrap options in a second card
language (accent borders, two-column feature tiles).
