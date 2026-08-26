# DSH Studio Plugin Development

> This document explains the DSH Studio plugin system: the Cordis plugin model
> of DSH (DeepSeek Harness), how the desktop bundle mounts, the
> responsibilities of built-in plugins, and the complete mechanism of the
> built-in skin plugin `@dsh-studio/desktop-skins`, including a step-by-step
> guide for adding a new skin.
>
> Applies to: `0.1.2` (DSH `0.0.1-rc.2`, Electron 42).

---

## 1. Plugin model overview

DSH Studio is not a standalone frontend. It packages a fixed-version DSH
runtime, Node.js, Electron, and local capabilities into one desktop app. The
UI remains the official DSH React UI; desktop capabilities mount into it as
**Cordis plugins**.

### 1.1 Three layers

```text
Official DSH Profile + Loader (cordis.yml plugin tree)
        │
        ▼
DSH Studio bundle layer (cordis.patch.yml, patched into the official tree)
  │
  ▼
Desktop plugins (@dsh-studio/* packages under plugins/, Host/Client pairs)
```

- **Official layer**: DSH's own plugins (`dsh-base`, `dsh-web-app`, …) own the
  core contracts — agent loop, Web runtime, settings, locale, ThemeService.
- **Bundle layer**: `cordis.patch.yml` is the DSH Studio bundle patch; after
  the Web runtime starts on a random loopback port it inserts the desktop
  plugins. Service dependencies are declared by each plugin's `inject` and
  `dsh.client.inject`.
- **Desktop plugin layer**: every package under `plugins/` is an independent
  Cordis plugin. `dsh.client` declares Client-side injection; Host-side
  mounting is decided jointly by plugin exports, `cordis.patch.yml`, the
  build scripts, and the runtime profile.

### 1.2 The bundle patch (cordis.patch.yml)

```yaml
# Top-level entries override official config
- id: webserver
  config:
    host: 127.0.0.1
    port: 0            # random port

- id: web-runtime
  config:
    mode: production
    printUrl: true
    surfaceContext: false
    lanAddresses: []

# insert block puts the desktop plugins into the official plugin tree
- insert:
    - id: oh-desktop
      name: '@dsh-studio/desktop'
    - id: oh-capabilities
      name: '@dsh-studio/capabilities'
    - id: oh-desktop-skins
      name: '@dsh-studio/desktop-skins'
    - id: oh-desktop-sidebar
      name: '@dsh-studio/desktop-sidebar'
    - id: oh-panel-controls
      name: '@dsh-studio/panel-controls'
    - id: oh-pinned-summary
      name: '@dsh-studio/pinned-summary'
    - id: oh-plugin-marketplace
      name: '@dsh-studio/plugin-marketplace'
```

Key points:

- `id` inside the patch is the plugin's entry ID in the Loader tree; `name`
  is the npm package name.
- The `insert` list defines insertion order within the bundle patch; service
  dependencies are declared via each plugin's `inject` and
  `dsh.client.inject`. In the current list `oh-desktop` sits before the skin
  and other UI plugins.
- `webserver` uses `port: 0`: the OS assigns a random loopback port, avoiding
  conflicts with other DSH instances and shrinking the network exposure a
  fixed port would create; it is not a permission or isolation boundary.

### 1.3 Two identities of one plugin: Host and Client

Most desktop plugins are dual-ended:

| End | Entry file | Runs in | Capabilities |
| --- | --- | --- | --- |
| Host | usually `src/index.ts` (`exports["."]`); the root desktop package uses `src/plugin.ts` | Node process of the DSH runtime | filesystem, PTY, HTTP routes, app data |
| Client | `src/client.ts` (`exports["./client"]`) | browser UI | DOM, React components, settings pages, stores |

The `package.json` `dsh.client` field declares how the Client side injects:

```jsonc
"dsh": {
  "client": {
    "inject": ["@deepseek-ai/dsh-client-runtime", "..."],
    "platform": "web",
    "immediately": true
  }
}
```

- `inject`: dependent Client-side service packages (runtime / locale / slots /
  settings / theme …) guaranteeing load order.
- `platform: "web"`: the browser platform.
- `immediately: true`: load at app start.

### 1.4 Host/Client plugin contract

Plugins follow the Cordis `name + inject + apply(ctx)` shape; exact fields
depend on the Host or Client entry and the DSH runtime APIs they use:

```ts
export const name = 'oh-xxx'
export const inject = ['desktop', 'webServer']  // service names depended on

export function apply(ctx: HostContext): void {
  ctx.effect(
    () => mountSomething(ctx, ...),  // register; return a cleanup function
    'oh-xxx: description',
  )
}
```

Common contract capabilities:

| Capability | Notes |
| --- | --- |
| `ctx.effect(register, label)` | registers cleanup logic where the lifecycle supports it; ubiquitous in Client plugins — Host plugins must not assume hot-unload is guaranteed |
| `ctx.get(name)` | fetch an injected service instance |
| `ctx.on(event, listener)` | subscribe to typed events (e.g. `theme/change`) |
| `ctx.reflect.provide(name, value)` | expose an instance as an injectable service (e.g. `desktopSkins`) |
| `locale.register(ns, dict)` | register en/zh translation dictionaries |
| `slots.inject(name, register)` | inject settings entries/components into official UI slots |

App start/stop, install, uninstall, and update currently work by stopping and
restarting the whole DSH runtime rather than per-plugin hot unloading; Host
cleanup must therefore not assume hot unload is guaranteed.

---

## 2. Built-in plugins

| Plugin | Directory | Origin | Responsibility |
| --- | --- | --- | --- |
| `@dsh-studio/desktop` | `src/` | in-house | unified desktop entry: window, menu, Electron bridge, Agent capabilities, plugin registration order |
| `@dsh-studio/capabilities` | `plugins/capabilities/` | vendored Host capability gateway (`src/`, baseline `3d88752` + local extensions, see `VENDOR.md`) | PTY, Files, Git, WorkTree, Workspace, Agent tools |
| `@dsh-studio/desktop-sidebar` | `plugins/sidebar/` (+ `sidebar-desktop/`) | UI downstream of `DSH-better-sidebar` | session tabs, viewers, Git review, inline comments, composer references |
| `@dsh-studio/panel-controls` | `plugins/panel-controls/` | downstream of `dsh-web-panel` | terminal dock, draggable bottom panel, session state |
| `@dsh-studio/pinned-summary` | `plugins/pinned-summary/` | in-house | current-session summary card and body gutter management |
| `@dsh-studio/plugin-marketplace` | `plugins/plugin-marketplace/` | distilled from `plugin-registry` + `dsh-hub` | marketplace with isolated preview, risk confirmation, TOFU source lock, apply and recovery |
| `@dsh-studio/desktop-skins` | `plugins/desktop-skins/` | downstream of `dsh-skins` | desktop skins: ThemeService extension, settings UI, host-side persistence |

Shared module: `plugins/shared/` (i18n, ListRow, SurfaceTab and other product
composites). Control atoms are NOT in shared: buttons, inputs, menus,
dialogs, toasts, and icons always come from
`@deepseek-ai/dsh-client-ui-primitives`; see
[`plugins/AGENTS.md`](../plugins/AGENTS.md).

---

## 3. Deep dive: the skin plugin `@dsh-studio/desktop-skins`

The skin plugin is the project's reference example for extending the official
DSH ThemeService: it extends the official themes (light/dark/system) into a
set of desktop skins, where each skin is **a set of `--dsw-*` CSS variable
values**. Selecting one takes effect immediately and is persisted by the Host.

### 3.1 Dual-ended responsibilities

```text
Host side (index.ts → preferences-server.ts)
  ├─ persists desktop-skins.json under appDataPath
  └─ registers GET/PUT /dsh-studio/skins/preferences HTTP routes

Client side (client.ts → plugin.tsx)
  ├─ DesktopSkinsController: registers skins into ThemeService, reads/writes
  │   preferences, applies them to the DOM
  ├─ SkinDomPresenter: writes the skin onto <body data-dsh-studio-skin="...">
  ├─ DesktopSkinPreferencesStorage: fetch-based merged writes (dirty loop +
  │   validation)
  └─ SkinSettingsRow: settings-page tile grid UI
```

### 3.2 Token system (built-in skins currently use 32 variables)

Each built-in skin currently defines 32 tokens: `--dsw-alias-*` (26 semantic
aliases) + `--dsw-specific-*` (6 component-specific colors). This is the
current design convention; the source types allow any string dictionary and
tests only require at least 30 keys — the exact set of 32 is not enforced
item-by-item.

#### Alias group (26)

| Token | Meaning | Design notes |
| --- | --- | --- |
| `--dsw-alias-bg-base` | deepest app background | darkest/lightest base; dark skins are near-black with hue |
| `--dsw-alias-bg-layer-1` | first overlay layer (cards/panels) | one step brighter than base (dark) or near-white (light) |
| `--dsw-alias-bg-layer-2` | second overlay layer | another step brighter |
| `--dsw-alias-bg-layer-3` | third overlay layer | brighter again |
| `--dsw-alias-bg-overlay` | popover/overlay background | brightest background layer |
| `--dsw-alias-bg-module-platform` | module platform background (fixed areas) | often equals layer-2 |
| `--dsw-alias-border-l1` | level-1 border | weak; hue-tinted rgba around 0.07–0.08 alpha |
| `--dsw-alias-border-l2` | level-2 border | medium; ~0.12–0.14 alpha |
| `--dsw-alias-border-l3` | level-3 border | strong; ~0.18–0.22 alpha |
| `--dsw-alias-brand-primary` | brand primary | defines the skin's personality |
| `--dsw-alias-brand-primary-invert` | inverted text on brand primary | text/icon color over the primary, usually a dark base |
| `--dsw-alias-brand-text` | brand-related body text | lighter than the primary |
| `--dsw-alias-button-primary-fill` | primary button fill | often equals brand primary |
| `--dsw-alias-button-primary-hover` | primary button hover | one step brighter than primary |
| `--dsw-alias-interactive-bg-active` | interactive item active background | primary rgba ~0.14–0.16 alpha |
| `--dsw-alias-interactive-bg-hover` | interactive item hover background | primary rgba ~0.07–0.09 alpha |
| `--dsw-alias-label-primary` | primary text | highest contrast (near-white/near-black) |
| `--dsw-alias-label-secondary` | secondary text | medium contrast |
| `--dsw-alias-label-tertiary` | tertiary text/captions | low contrast |
| `--dsw-alias-markdown-code-block` | code block background | a deeper block than layer-1 |
| `--dsw-alias-markdown-inline-code` | inline code background | neutral close to bubble |
| `--dsw-alias-scrollbar-bg-l1` | scrollbar thumb/track | neutral one step brighter than background |
| `--dsw-alias-scrollbar-hover-l1` | scrollbar hover | usually brand primary |
| `--dsw-alias-state-error-primary` | error state color | red family harmonized with the primary |
| `--dsw-alias-state-success-primary` | success state color | green family harmonized with the primary |
| `--dsw-alias-state-warn-primary` | warning state color | yellow family harmonized with the primary |

#### Specific group (6)

| Token | Meaning | Design notes |
| --- | --- | --- |
| `--dsw-specific-bubble` | message bubble background | often equals markdown-inline-code |
| `--dsw-specific-input-major` | major input background | deeper than layer-1 (dark) or whiter (light) |
| `--dsw-specific-menu` | menu background | deeper than layer-2 |
| `--dsw-specific-sidebar-fill` | sidebar fill | current implementation requires equality with `--dsw-alias-bg-base` (test-enforced) |
| `--dsw-specific-sidebar-nav-item-active` | sidebar nav active item | often equals markdown-inline-code |
| `--dsw-specific-sidebar-nav-item-hover` | sidebar nav hover | between layer-1 and bubble |

> Design advice: layered backgrounds (base → layer-1/2/3 → overlay) should
> step progressively; borders should be brand-hued rgba rather than pure gray
> for a real skin feel; state colors should not copy default red/green/yellow
> — tune them around the primary hue (e.g. a cyan-blue skin shifts errors
> toward coral).

### 3.3 Registration and application chain

```text
plugin.tsx apply(ctx)
  └─ ctx.effect: new DesktopSkinsController(theme, storage, dom).start()
       ├─ for each skin call theme.register({ id, colorScheme, tokens })
       │    (skins become selectable themes in the official ThemeService)
       ├─ read persisted preference ACTIVE_SKIN_KEY (localStorage / host file)
       ├─ if a skin was selected: record FALLBACK_THEME_KEY, theme.setTheme(skin.id)
       └─ adopt(theme.getTheme())
             ├─ desktopSkin(active.id) resolves the skin → write preference back
             └─ dom.apply(skin)
                  ├─ <body data-dsh-studio-skin="dsh-studio-skin-xxx">
  └─ if a plugin ships the reserved css field: inject <style id=dsh-studio-skins-atmosphere>
```

All built-in skins currently omit the `css` field and tests require it to be
`undefined`, so today's actual path uses tokens only and injects no extra
skin CSS.

Key behaviors:

- **External takeover**: when the user switches back to an official look
  (light/dark/system), the `theme/change` event → `controller.adopt()` → the
  skin deactivates, `ACTIVE_SKIN_KEY` clears, and the official choice lands in
  `FALLBACK_THEME_KEY`. The skin system never hijacks the official theme.
- **Fallback**: choosing "original appearance" restores the fallback
  (light/dark/system, default system).
- **Persistence keys**: `dsh-studio.skins.active` (skin ID) and
  `dsh-studio.skins.fallback` (fallback appearance).
- **DOM does exactly two things**: the body attribute + the atmosphere style
  sheet; nothing else — clean responsibility.

### 3.4 Preference persistence (host side)

- Storage location: `<appDataPath>/desktop-skins.json`; `<appDataPath>` comes
  from Electron's `app.getPath('userData')`. The DSH profile lives at
  `<userData>/dsh/profiles/desktop`, which is NOT the same path as the skin
  preference file.
- HTTP API: `GET /dsh-studio/skins/preferences` reads; `PUT` writes; PUT
  validates `Origin` against `Host` (same-origin) or returns 403.
- Writes first land in a random temp file `desktop-skins.json.next-<random>`
  and then attempt `rename`; on `EEXIST`/`EPERM` they fall back to
  `copyFile`. This path does not provide atomic-replacement semantics.
- Client writes merge rapid updates through an async dirty loop; when a round
  produces no new dirty state exactly one PUT is sent — it is not a
  timer-based debounce.

### 3.5 Settings page UI

- Injects a skin settings block into the DSH settings page "General" area via
  `slots.inject('settings.general.item', ...)` (`order: 20`).
- UI is a tile grid (`desktop-skins.css`): each tile shows a preview gradient
  (`skin.preview`), a primary-color dot (`skin.accent`), the name, and a
  light/dark mode tag.
- Language: strings like `skins.name.*` are registered in `i18n.ts` (en/zh).

### 3.6 Current test constraints

`tests/desktop-skins.test.ts` asserts per skin:

1. `id` matches `/^dsh-studio-skin-/`;
2. `tokens` has at least 30 keys; built-ins ship 32 but the test does not pin
   the exact key names;
3. `--dsw-alias-bg-base` is a 6-digit hex color (`#rrggbb`);
4. `--dsw-alias-bg-base` === `--dsw-specific-sidebar-fill`;
5. `css` is `undefined` (all built-ins are token-only, no extra stylesheet);
6. skin IDs are globally unique.

---

## 4. Adding a new skin (step by step)

### 4.1 Full token design

Follow the semantics table in [3.2](#32-token-system-current-built-in-skins-use-32-variables):
first define the personality — hue, colorScheme, primary, and the pacing of
the background steps — then produce the full token set in the current design
convention. Suggested order:

1. Fix `colorScheme` (`light`/`dark`) and `--dsw-alias-brand-primary`;
2. derive the six backgrounds (base → layer-1/2/3 → overlay, module-platform);
3. derive three border levels (hue-tinted rgba);
4. derive brand/button/interactive six-pack;
5. derive three text levels (descending contrast);
6. derive markdown ×2 and scrollbar ×2;
7. derive three state colors (harmonized around the primary);
8. derive specific ×6 (bubble = inline-code, sidebar-fill = bg-base,
   nav-active = bubble, nav-hover between layer-1 and bubble).

### 4.2 Files you usually touch

| File | Change |
| --- | --- |
| `plugins/desktop-skins/src/preferences.ts` | append the new ID to `DESKTOP_SKIN_IDS` |
| `plugins/desktop-skins/src/client/skins.ts` | add token constants + a `DESKTOP_SKINS` entry |
| `plugins/desktop-skins/src/client/i18n.ts` | add `skins.name.<id>` copy (en/zh) |
| `tests/desktop-skins.test.ts` | update only if a fixed-count assertion remains; currently 6 skins |

> Real example: `dsh-studio-skin-synara-night` (dark) and
> `dsh-studio-skin-synara-day` (light) were mapped token-by-token from the
> Synara web-next design system; the full process is documented in
> [docs/SYNARA-NIGHT-SKIN-DESIGN.md](./SYNARA-NIGHT-SKIN-DESIGN.md).

A `skins.ts` entry looks like:

```ts
Object.freeze({
  id: 'dsh-studio-skin-<your-id>',
  colorScheme: 'dark',
  tokens: YOUR_SKIN_TOKENS,
  preview: 'linear-gradient(145deg, #… 0%, #… 100%)',
  accent: '#…',          // consistent with brand-primary
  label: 'skins.name.<your-id>',
}),
```

`preview` is the settings-tile gradient and `accent` the tile dot — both
should express the new skin's personality.

### 4.3 Verification

```sh
pnpm test          # all node:test (includes desktop-skins.test.ts)
pnpm typecheck     # tsc --noEmit
```

To see it in the app:

```sh
pnpm run build && pnpm run stage:dsh && pnpm start
```

---

## 5. Build & verification (common commands)

| Command | Purpose |
| --- | --- |
| `pnpm install` | install dependencies (electron / esbuild / node-pty may build) |
| `pnpm run build` | esbuild-build all plugins + root entries |
| `pnpm run build:dsh` | build pinned-version DSH (needs checkout or cache) |
| `pnpm run stage:dsh` | stage DSH artifacts into app resources |
| `pnpm test` | full node:test suite |
| `pnpm typecheck` | full TypeScript check |
| `pnpm start` | build + stage + launch Electron |
| `pnpm run dist:mac[:quick]` | package DMG/ZIP releases |

Pre-release verification chain (required by README):

```sh
pnpm run typecheck
pnpm test
pnpm run dist:mac
pnpm run smoke:pack
codesign --verify --deep --strict release/mac-arm64/DSH Studio.app
hdiutil verify release/DSH Studio-0.1.2-arm64.dmg
```
