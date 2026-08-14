# Vendored source: DSH-better-sidebar (Host)

The `src/` tree is the framework-agnostic Host of
[`DSH-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar),
vendored inside this repository (instead of a sibling clone) so the desktop
distribution is a self-contained single repository.

- Upstream: <https://github.com/omdsh-dev/DSH-better-sidebar> (MIT)
- Baseline revision: `3d88752eb184d7d8b535d66a296fade474dd053f` (v0.10.2)
- License: MIT — see THIRD_PARTY_NOTICES.md
- Only the Host is vendored. The upstream UI client was NOT vendored
  (Oh-DSH ships its own panel UI); `src/client/` here only keeps the
  type-contract files the Host entry re-exports
  (`service.ts` + `state.ts` / `breakpoints.ts` / `api.ts` / `browser.ts`).

## Local modifications (fork delta on top of the baseline)

The maintainer allowed direct changes to the plugin body; each change is
recorded here so upstream upgrades can be re-applied:

- `git.ts` — added `numstat()` / `parseNumstatZ()`: per-path `git diff
  --numstat -z` parsing for the +N/−M file stats shown by the
  source-control panel.
- `agent-pty.ts` — `exitCode`/`exitSignal` default to `null` (strict-mode
  `exactOptionalPropertyTypes` compatibility).
- `index.ts` — optional `head` returned conditionally; settings view
  returns `{}` instead of explicit `undefined` values (same strict-mode
  compatibility).
- `jobs-routes.ts` — optional `text` returned conditionally (strict-mode).
- `client/api.ts` — fetch init assembled without an optional `signal`
  spread (strict-mode overload compatibility).
- `vendor.d.ts` — structural type shims for runtime-provided externals
  (cordis / @deepseek-ai/cordis / dsh-settings / dsh-tools / dsh-llm /
  dsh-agent / ws). The vendored tree typechecks with a looser pass
  (`tsconfig.json` here; `noImplicitAny` off) because cordis infers most
  context types.

## Upgrading

1. Fetch the upstream repo, diff `src/` against this tree:
   `git diff --no-index plugins/better-sidebar-runtime/src <upstream>/src`
   (ignore the upstream `src/client/` UI files — not vendored).
2. Apply upstream changes, keeping the fork delta above (including the
   vendored `src/client/` type-contract subset).
3. Update the baseline revision above, then `pnpm run build` +
   `pnpm test`.
