# AGENTS.md — Desktop plugins

These rules apply under `plugins/`. They narrow the repository
[AGENTS.md](../AGENTS.md) for DSH Studio Cordis plugins that render into the
DSH web client.

## Upstream DOM probes

Any selector, `data-slot`, aria-label, or class-name probe into the DSH web
client's DOM lives in exactly ONE module per plugin (the sidebar's is
`sidebar/src/client/surfaces/dsh-dom.ts`), with the coupling documented where
the probe is declared. Never spell upstream selectors inline in feature code:
an upstream bump must be re-pinnable by editing one file. New probe modules
must be registered in `scripts/guards/guard-no-inline-probe.mjs` so the guard
keeps enforcing one-probe-module-per-plugin for your tree too. Open semantics
(intents, preview vs pinned, activation) go through
`@dsh-studio/shared/workbench-contracts` (`resolveOpenPlan`) instead of being
re-decided at each call site.

## Workbench kernel services

The four runtime kernel services in `plugins/workbench` own their domains;
consumers wire in and never re-implement them:

- **OpenPipeline** — every open goes through the pipeline (`resolveOpenPlan`
  decides area/preview/activation). Do not move keyboard focus on open; the
  focus invariant is enforced at the pipeline level.
- **WorkspaceEvents** — workspace/session identity arrives via
  `workbench.events.onWorkspaceChanged` / `onSessionChanged`, pumped from the
  runtime's current-session projection. Subscribe to events instead of
  imperatively subscribing to session-list stores.
- **LayoutService** — negotiate final footprints only. Width policy lives in
  its owning domain (sidebar preferences persist the bound; live viewport cap
  stays there too); the service receives final numbers.
- **Overlay mounting** — floating layers mount through
  `ensureLayoutDom` from `@dsh-studio/shared/layout-dom`, never by appending
  to `<body>` (the sanctioned exception is `@dsh-studio/shared/tab-drag-image`,
  which needs a drag ghost outside any clipping ancestor).

## Official chrome

`@deepseek-ai/dsh-client-ui-primitives` is a platform seed. Every
`dsh.client` plugin may import it. Client builds must list it in
`external` so the frozen module table supplies one copy.

Plugin chrome has two sanctioned sources. DSH-flavored atoms (button,
menu, dialog, toast, tooltip, chip, status) import from the official
package. Generic form controls (single-line field, value selector,
checkbox) come from the shadcn base-nova set that lives in
`@dsh-studio/shared/ui` — installed via the shadcn CLI
(`components.json`, style `base-nova`, base `@base-ui/react`), styled
with the `--dsh-studio-ui-*` token bridge in `theme.css`. Never
hand-write a form control: add it through the shadcn CLI so the official
edge-case handling ships with it.

Do not re-export official atoms from `@dsh-studio/shared`. Do not add a
wrapper that preserves a retired DSH Studio name or prop list. Do not
add a second button, dialog, toast, or icon kit.

| Need | Source and export |
| --- | --- |
| Button (labeled actions) | `Button` from the official package (`primary` / `ghost` / `outline` / `toolbar`; `sm` / `md`) |
| Button (icon-only strip actions) | `ToolbarAction` from `@dsh-studio/shared/ui` — the compact icon form: 28×28 square footprint, ghost, secondary label, skin-rounded corners (the skins layer owns `border-radius`, do not override it). The official `sm` capsule is for labeled actions only; do not use it for pure icon buttons. |
| Center-surface header strip | `SurfaceToolbar` from `@dsh-studio/shared/ui` — one strip for every center surface (file view/edit, diff, commit). It owns the bar geometry AND the slot typography; consumers pass plain content through `leading` / `meta` / `modeSwitch` / `actions` and must not override its font, color, or layout with per-surface CSS. A state toggle (view↔edit, markdown source↔preview) is one `ToolbarAction` that swaps its icon, never a second control. |
| Single-line field | `Input` from `@dsh-studio/shared/ui` (shadcn base-nova). Never a raw `<input>` styled by feature CSS. |
| Value selector (choose one of N) | `Select` + `SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` from `@dsh-studio/shared/ui` (shadcn base-nova). Action menus and context menus stay on the official `Menu`. Never a raw `<select>` or a restyled trigger button. |
| Binary check / opt-in confirmation | `Checkbox` from `@dsh-studio/shared/ui` (shadcn base-nova). Never a raw `<input type="checkbox">`. |
| Dropdown or context menu | `Menu` from the official package (`portal` when an ancestor clips) |
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

## Data & state discipline

These rules are CI-enforced by `scripts/guards/*.mjs` and detailed in
`.workflow/specs/`. Components render from zustand stores and the
`shared/runtime` caches; they do not own server data.

- **State ownership (S1):** derivable values are computed, not stored in a
  second store or `useEffect`; cross-component UI identity goes in a zustand
  store (pure memory); server data lives in a `shared/runtime`
  RevisionedStore-family cache.
- **Data flow (S3):** RPC caching uses the shared RevisionedStore /
  GenerationGate / ScopedRuntimeRegistry layer, keyed by cwd/scope, with soft
  refresh and precise mutation invalidation. No hand-written
  loading/error/data triplets, no scattered bare `callCapabilitiesApi`.
- **Persistence (S2):** everything persists through `persistVia` onto a
  host-owned domain (ui-chrome table, settings namespace, or nodeFs). No
  component reads or writes `localStorage`/`sessionStorage` (guarded by
  `scripts/guards/guard-no-localstorage.mjs`).
- **Race & singletons (S6):** async effects abort (`AbortController` +
  `signal.aborted` check or a generation token); dialogs/promise services are
  queued; mutexes and overlay arbiters come from a `createXxx()` factory
  through context, never a module-level mutable singleton.

Upstream DOM probes stay in the single per-plugin probe module (see "Upstream
DOM probes" above); this is enforced by
`scripts/guards/guard-no-inline-probe.mjs`.

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
separator, control on the right. Use the shared form controls
(`Input` / `Select` / `Checkbox`) plus official `Button` / `Modal` for
those controls. Do not wrap options in a second card
language (accent borders, two-column feature tiles).
