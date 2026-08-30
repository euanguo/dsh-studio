# Vendored source: DSH-better-sidebar capability host

The `src/` tree is the framework-agnostic Host of
[`DSH-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar),
vendored inside this repository (instead of a sibling clone) so the desktop
distribution is a self-contained single repository.

- Upstream: <https://github.com/omdsh-dev/DSH-better-sidebar> (MIT)
- Baseline revision: `3d88752eb184d7d8b535d66a296fade474dd053f` (v0.10.2)
- License: MIT — see THIRD_PARTY_NOTICES.md
- Only the Host is vendored. The upstream UI client was NOT vendored
  (DSH Studio ships its own panel UI); `src/client/` here only keeps the
  type-contract files the Host entry re-exports
  (`service.ts` + `state.ts` / `breakpoints.ts` / `api.ts` / `browser.ts`).

## Local modifications (fork delta on top of the baseline)

The maintainer allowed direct changes to the plugin body; each change is
recorded here so upstream upgrades can be re-applied:

- `git.ts` — **deleted**. Implementation moved to `plugins/shared/git-core.ts`
  (porcelain v2 single-command status + `numstat()`/`parseNumstatZ()` +
  `core.quotePath=false` + `maxOutputBytes`); `index.ts` imports it directly.
- `fs-tree.ts` / `wire.ts` / `prefs-shared.ts` — **deleted**. Moved to
  `plugins/shared/` (framework-agnostic capability layer shared by the
  sidebar host, the left-rail host and this vendored host). Internal
  importers (`index.ts` / `config.ts` / `agent-pty.ts` / `jobs-routes.ts` /
  `pty-manager.ts` / `client/state.ts`) now import from `../../shared/*`.
- `agent-pty.ts` — `exitCode`/`exitSignal` default to `null` (strict-mode
  `exactOptionalPropertyTypes` compatibility).
- `index.ts` — optional `head` returned conditionally; settings view
  returns `{}` instead of explicit `undefined` values (same strict-mode
  compatibility). Plus (generic-host parity so the desktop client can call
  `/capabilities/api` directly): `readText` also returns a full base64 `data`
  payload for binaries ≤ 2MB (inline image/PDF preview); `git.status`
  upgraded to `statusV2` + per-entry `numstat` stats; added `cwdScopeOf`
  and `git.worktree-list` / `git.worktree-add` (bare-cwd scope, no session).
- `jobs-routes.ts` — optional `text` returned conditionally (strict-mode).
- `pty-manager.ts` — shell resolution moved OUT into the NEW
  `shell-resolver.ts` below): the
  injectable priority is deployment `shell` config → settings
  `terminalShell` → `DSH_SIDEBAR_SHELL` → Windows pwsh.exe probe (PATH +
  known install dirs, ProgramW6432 preferred) / POSIX login-shell passwd
  chain → platform fallback; every value trimmed. `PtyManager` now takes a
  shell THUNK resolved at spawn time (settings changes affect NEW terminals
  only) and spawns POSIX shells as login shells (`-l`, upstream `76fa7df`
  behavior).
- `shell-resolver.ts` — **new (fork)**: the pure, injectable shell
  resolver (`resolveShell` / `windowsPwshCandidateDirs` /
  `shellSpawnArgs`), kept free of node-pty so the Windows chain is
  unit-testable on POSIX runners (`tests/shell-resolution.test.ts`).
- `workspace-git.ts` — **new (fork)**: workspace-level Git operations
  (`readWorkspaceFacts` / `mutateWorkspace` + the shared
  `isCapabilitiesWorkspaceMutation` wire guard) serving the NEW
  `workspace.facts` / `workspace.mutate` API methods. Folded in from the
  DSH Studio sidebar's former self-hosted `/dsh-studio/workspace` route so every
  panel data channel rides one API surface behind one trust fence;
  `routes.ts` wires both methods through the existing bare-cwd
  `cwdScopeOf` (the worktree scope).
- `agent-pty.ts` — constructor takes the same shell thunk (resolved at
  create time) and spawns with `shellSpawnArgs()`; UI terminals and the
  agent `terminal_*` tools always share the same shell.
- `config.ts` — `SidebarConfig.shell` (deployment override, top priority)
  + `PrefsSchema.terminalShell` (user setting); both feed the resolver
  through `index.ts`.
- `index.ts` — the terminal shell is resolved AT SPAWN TIME through the
  shared chain (settings `terminalShell` read live from the prefs watch);
  no behavioral drift between UI terminals and agent terminals.
- `client/api.ts` — fetch init assembled without an optional `signal`
  spread (strict-mode overload compatibility).
- `vendor.d.ts` — structural type shims for runtime-provided externals
  (cordis / dsh-settings / dsh-tools / dsh-llm /
  dsh-agent / ws). The vendored tree typechecks with a looser pass
  (`tsconfig.json` here; `noImplicitAny` off) because cordis infers most
  context types.

## Upgrading

1. Fetch the upstream repo, diff `src/` against this tree:
   `git diff --no-index plugins/capabilities/src <upstream>/src`
   (ignore the upstream `src/client/` UI files — not vendored).
2. Apply upstream changes, keeping the fork delta above (including the
   vendored `src/client/` type-contract subset).
3. Update the baseline revision above, then `pnpm run build` +
   `pnpm test`.
