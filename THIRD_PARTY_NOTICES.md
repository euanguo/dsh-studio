# Third-Party Notices

Oh-DSH is distributed under the MIT License. The projects below informed
independently implemented bundled plugins.

Upstream UI, themes, and component styling are not bundled. Oh-DSH adapts
compatible features to its own persistence, layout, localization, and theme
contracts. The Better Sidebar Host source is vendored inside this repository
(`plugins/better-sidebar-runtime/src/`, baseline recorded in its VENDOR.md).
Upstream releases and features are reviewed regularly.

## dsh-web-panel

- Project: <https://github.com/dsh-external/dsh-web-panel>
- Declared license: BSD 3-Clause
- Oh-DSH component: `@oh-dsh/panel-controls`

Oh-DSH adapts the Terminal dock for its desktop layout, session model, themes,
and localization. The dock uses the shared Better Sidebar PTY Host, so no
separate Web Terminal or shell plugin is required.

## DSH-better-sidebar

- Project: <https://github.com/omdsh-dev/DSH-better-sidebar>
- Vendored tree: `plugins/better-sidebar-runtime/src/` (v0.10.2, baseline
  revision `3d88752eb184d7d8b535d66a296fade474dd053f`)
- Declared license: MIT
- Oh-DSH components: `@oh-dsh/better-sidebar-runtime` and
  `@oh-dsh/desktop-sidebar`

Oh-DSH compiles the upstream Host from that clone for PTY, bounded Files, Git
status, branch operations, history, and commit diffs. It does not load the
upstream client UI. The Oh-DSH sidebar adapts those capabilities into its own
tabs, viewers, Git Review, line comments, themes, and bilingual desktop
layout. We thank the maintainers and review upstream features regularly.

### Local extensions on the upstream clone

With the maintainer's consent, Oh-DSH extends the local clone directly when a
capability belongs upstream rather than in a wrapper:

- `src/git.ts` — `numstat()` / `parseNumstatZ()`: per-path `git diff
  --numstat -z` parsing for the +N/−M file stats shown by the source-control
  panel (added on top of revision `3d88752`).

## plugin-registry and dsh-hub

- Projects: <https://github.com/dsh-external/plugin-registry> and
  <https://github.com/dsh-external/dsh-hub>
- Declared licenses: BSD 3-Clause and MIT
- Oh-DSH component: `@oh-dsh/plugin-marketplace`

Oh-DSH distills source locking, trust review, installed/enabled state,
candidate previews, updates, and recovery into one desktop transaction. Its
navigation, approval flow, and bilingual UI are implemented in this
repository.

## dsh-skins

- Project: <https://github.com/dsh-external/dsh-skins>
- Declared license: MIT
- Oh-DSH component: `@oh-dsh/desktop-skins`

Oh-DSH follows the ThemeService extension model while providing original
skins, a desktop Settings interface, and Host-backed persistence.
