# Third-Party Notices

Oh-DSH is distributed under the MIT License. The projects below are either
bundled at a pinned revision or informed independently implemented adapters.

Upstream UI, themes, and component styling are not bundled. Oh-DSH adapts
compatible features to its own persistence, layout, localization, and theme
contracts. Direct upstream sources are tracked as pinned submodules. Upstream
releases and features are reviewed regularly.

## dsh-web-panel

- Historical project: dsh-web-panel (its previous public locator is no longer available)
- Oh-DSH component: `@oh-dsh/panel-controls`

Oh-DSH adapts the Terminal dock for its desktop layout, session model, themes,
and localization. The dock uses the shared Better Sidebar PTY Host, so no
separate Web Terminal or shell plugin is required.

## DSH-better-sidebar

- Project: <https://github.com/omdsh-dev/DSH-better-sidebar>
- Pinned release: `v0.9.0`
- Pinned revision: `2e9db44a71bb75c9fa1185330541dce2582deee3`
- Declared license: MIT
- Oh-DSH components: `@oh-dsh/better-sidebar-runtime` and
  `@oh-dsh/sidebar`

Oh-DSH compiles the pinned upstream Host for PTY, bounded Files, Git status,
branch operations, history, and commit diffs. It does not load the upstream
client UI. The Oh-DSH sidebar adapts those capabilities into its own tabs,
viewers, Git Review, line comments, themes, and bilingual desktop layout. We
thank the maintainers and review upstream features regularly.

## plugin-registry and dsh-hub

- Projects: <https://github.com/vlln/plugin-registry>,
  <https://github.com/omdsh-dev/dsh-hub>, and
  <https://github.com/whyihaveyou/dsh-suite>
- Declared licenses: MIT
- Oh-DSH component: `@oh-dsh/plugin-marketplace`

Oh-DSH distills source locking, trust review, installed/enabled state,
candidate previews, updates, and recovery into one desktop transaction. Its
navigation, approval flow, and bilingual UI are implemented in this
repository.

## dsh-skins

- Historical project: dsh-skins (its previous public locator is no longer available)
- Oh-DSH component: `@oh-dsh/skins`

Oh-DSH follows the ThemeService extension model while providing original
skins, a desktop Settings interface, and Host-backed persistence.

## dsh-vision

- Project: <https://github.com/william-jin-cmu/dsh-vision>
- Referenced revision: `72978aa176df8e01a685bf270a1b1d016660c492`
- Declared license: BSD-3-Clause
- Oh-DSH component: `@oh-dsh/vision`

Oh-DSH adapts the upstream OpenAI-compatible vision bridge to the current DSH
credentials, settings, tool-output, and cancellation contracts. The built-in
Host is shared by Desktop, Web, and TUI, and local file resolution remains
inside the active Session workspace. The upstream license is retained with the
packaged plugin.

## dsh-TUI

- Project: <https://github.com/ccch1mneyyy/dsh-TUI>
- Upstream package: `dsh-cc-tui@0.4.1`
- Pinned revision: `6a8956678fc3746ed14b62bfee066ee8fc68f3cb`
- Declared license: MIT
- Oh-DSH component: `@oh-dsh/tui`

Oh-DSH bundles the pinned upstream renderer, session interaction, commands,
and terminal compatibility layer. The small downstream component owns only
the unified launcher, Profile defaults, data boundary, and release packaging.
We thank the upstream maintainer and keep the original license with the
packaged source artifacts.

## xterm.js

- Project: <https://github.com/xtermjs/xterm.js>
- Declared license: MIT
- Oh-DSH components: `@xterm/xterm` and the Fit, Search, Serialize,
  Unicode11, Web Links, WebGL, and Ligatures addons

Oh-DSH uses xterm.js for the terminal renderer and keeps the addon lifecycle
optional where browser GPU capabilities are unavailable. The upstream package
licenses remain in the installed dependency tree.

## orca

- Project: <https://github.com/stablyai/orca>
- Declared license: MIT
- Oh-DSH components: `@oh-dsh/shared` (`terminal-scrollback-policy.ts`,
  `stable-pane-id.ts`, `terminal-scroll-snapshot.ts`, `terminal-font.ts`,
  `terminal-fit-retry.ts`, `terminal-webgl-atlas.ts`,
  `recent-pty-output-buffer.ts`, `terminal-view.tsx` stable-fit)

Oh-DSH adapts orca's pure algorithms for desktop scrollback row/backlog
normalization, stable-fit consecutive-frame settlement, scroll intent
restoration across reflows, and durable pane keys.

## pierre

- Project: <https://github.com/pierrecomputer/pierre>
- Bundled package: `@pierre/diffs` (pinned in `plugins/sidebar`)
- Declared license: Apache-2.0
- Oh-DSH component: `@oh-dsh/sidebar` (diff viewer, line annotations, and
  virtualized rendering)

Oh-DSH renders diffs through the upstream `@pierre/diffs` React components
(line rows, syntax highlighting, virtualization) while keeping the worker pool
and structured fallback in this repository. The upstream license is retained
with the packaged plugin.
