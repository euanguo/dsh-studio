# Vendored source: DSH ui-workspace (desktop left rail)

The `src/` tree of `@dsh-studio/desktop-left-rail` forks the official
[`@deepseek-ai/dsh-client-ui-workspace`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/client/ui-workspace)
plugin and restructures the browsing region into a desktop three-level
project → worktree → session tree.

- Upstream: <https://github.com/deepseek-ai/deepseek-harness> (MIT),
  `packages/client/ui-workspace`
- Pinned DSH revision: `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
  (`dsh-source.json`, upstream version `0.1.0-rc.7`)
- Fork commit: `ed5a97f` ("left-rail: fork official ui-workspace into a
  project→worktree→session tree")
- License: MIT — see THIRD_PARTY_NOTICES.md

The official row is disabled in `cordis.patch.yml` (`ui-workspace` →
`disabled: true`) and this fork registers into the same `sidebar.workspaces`
single slot, so the desktop ships exactly one browser.

## Local evolution beyond the fork baseline

The fork delta is the product surface, not a patch to re-apply: the plugin
now behaves as DSH Studio's own desktop workspace browser while reusing the
official primitives, slot contracts and session/workspace stores. Changes
are recorded here so an upstream re-sync can judge what to keep:

- **Three-level tree** (`tree.ts`): git worktrees group under their repo root
  (project); non-git directories become single-worktree projects; sessions
  trail under the worktree owning their workspace.
- **Multi-workspace worktree rows**: every workspace whose cwd lives under a
  worktree joins the row (`workspaceIds`); row actions address each member
  explicitly instead of a silently chosen one.
- **Group tabs**: horizontal tab strip (create/rename/remove groups) with the
  pinned catch-all tab; project → group assignment and per-project aliases
  persist through the host settings service (`dsh-studio-left-rail` namespace),
  not localStorage.
- **Worktree lifecycle**: `git.worktree-list` / `git.worktree-add` /
  `git.branch` host endpoints (sidecar routes in the generic sidebar host);
  the New WorkTree dialog lists existing worktrees and branches.
- **Search over projects**: session search extended with project/worktree/
  branch name matches; a match jumps to its tab and expands the project.
- **Expansion-key namespaces**: `ws:` / `repo:` / `wt:` / `ungrouped`
  prefixes keep view-state keys from colliding in one dictionary.
- **Skin tokens**: all row, badge and dialog styles consume `--dsw-*` tokens
  (no hardcoded colors); row radius follows the 12.5px skin discipline.
- **Keyboard reorder**: move-up/move-down menu verbs as the accessibility
  twin of drag-and-drop.

## Upgrading

1. Diff against the upstream package at the pinned revision:
   `git diff --no-index <upstream>/packages/client/ui-workspace/src plugins/desktop-left-rail/src`
2. Adopt upstream fixes that still apply; keep the product surface above
   (the official UI client shape diverges deliberately).
3. Re-run `pnpm run plugin-styles desktop-left-rail` after CSS changes,
   then `pnpm run typecheck` + `pnpm test` + `pnpm run build`.
