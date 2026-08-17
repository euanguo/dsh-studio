/**
 * Client half of the desktop worktree API. The left rail has no session
 * binding, so it calls the desktop host's `/sidebar/api`
 * worktree endpoints with a bare cwd (same-origin POST, same fence as the
 * file/git routes — see plugins/sidebar/src/sidebar-api.ts).
 */
import { useEffect, useState } from 'react'
import { callSidebarGlobalApi } from '@oh-dsh/shared/sidebar-api'
import type { GitWorktreeLayout, WorktreeLayoutMap } from './tree.ts'

/** One worktree list response (null = cwd is not a git work tree). */
export type WorktreeLayoutResult = GitWorktreeLayout | null

/** `git.worktree-list` for one cwd; null when not in a git work tree. */
export async function fetchWorktreeLayout(cwd: string, signal?: AbortSignal): Promise<WorktreeLayoutResult> {
  return callSidebarGlobalApi<WorktreeLayoutResult>('git.worktree-list', { cwd }, signal)
}

/** Create a linked worktree. */
export async function createWorktree(
  cwd: string,
  path: string,
  branch: string,
  createBranch: boolean,
): Promise<void> {
  await callSidebarGlobalApi('git.worktree-add', { cwd, path, branch, createBranch })
}

/** The repository's branches (`git.branch` → { current, names }). */
export async function fetchBranches(cwd: string, signal?: AbortSignal): Promise<{ current: string; names: string[] }> {
  return callSidebarGlobalApi<{ current: string; names: string[] }>('git.branch', { cwd }, signal)
}

/**
 * Batch-fetch the worktree layout for every unique workspace cwd. Results are
 * cached per cwd until the cwd roster changes (new worktrees refresh via a
 * manual `refresh`); regaining window focus or tab visibility also refreshes
 * so layouts created or branches switched outside the app do not stay stale.
 * Layouts are pure derivation input — a failed lookup degrades that cwd to a
 * non-git directory project.
 */
export function useWorktreeLayouts(cwds: readonly string[]): {
  layouts: WorktreeLayoutMap
  refresh: () => void
  loading: boolean
} {
  const unique = Array.from(new Set(cwds)).sort()
  const [layouts, setLayouts] = useState<Map<string, WorktreeLayoutResult>>(new Map())
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const key = unique.join('\n')
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const run = async (): Promise<void> => {
      setLoading(true)
      const next = new Map<string, WorktreeLayoutResult>()
      await Promise.all(unique.map(async (cwd) => {
        try {
          next.set(cwd, await fetchWorktreeLayout(cwd, controller.signal))
        } catch {
          if (!cancelled) next.set(cwd, null)
        }
      }))
      if (!cancelled) {
        setLayouts(next)
        setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
    // `key` is the roster; `revision` forces a refetch after a worktree add.
  }, [key, revision])
  useEffect(() => {
    // External changes (a terminal, another surface, another user) can add
    // worktrees or switch branches: refetch when the window regains focus or
    // becomes visible again.
    const refreshIfVisible = (): void => {
      if (document.visibilityState === 'visible') setRevision(v => v + 1)
    }
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [])
  const refresh = (): void => { setRevision(v => v + 1) }
  return { layouts, refresh, loading }
}
