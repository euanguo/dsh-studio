/**
 * Git operations for the desktop sidebar / left-rail hosts.
 *
 * The implementation moved to `plugins/shared/git-core.ts` (upgraded with
 * porcelain v2 single-command status, `core.quotePath=false` and output
 * limits) so the desktop-sidebar host, the vendored better-sidebar runtime
 * and the left-rail worktree browser share exactly one implementation.
 * This module stays as the compatibility re-export: existing importers
 * (`desktop-sidebar/src/sidebar-api.ts`, `tests/worktree.test.ts`) keep
 * their paths.
 */
export * from '../../shared/git-core.ts'
