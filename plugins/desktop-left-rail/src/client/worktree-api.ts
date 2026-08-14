/**
 * Client half of the desktop worktree API. The left rail has no session
 * binding, so it calls the desktop host's `/oh-dsh-desktop/sidebar/api`
 * worktree endpoints with a bare cwd (same-origin POST, same fence as the
 * file/git routes — see plugins/desktop-sidebar/src/sidebar-api.ts).
 */
import { useEffect, useState } from 'react'
import type { GitWorktreeLayout, WorktreeLayoutMap } from './tree.ts'

/** One worktree list response (null = cwd is not a git work tree). */
export type WorktreeLayoutResult = GitWorktreeLayout | null

const API_ROOT = '/oh-dsh-desktop/sidebar/api/'

async function call(method: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${API_ROOT}${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    ...(signal === undefined ? {} : { signal }),
  })
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string }; value?: unknown }
  if (!response.ok || body.ok === false) {
    throw new Error(body.error?.message ?? `sidebar api ${method} failed (${response.status})`)
  }
  return body.value
}

/** `git.worktree-list` for one cwd; null when not in a git work tree. */
export async function fetchWorktreeLayout(cwd: string, signal?: AbortSignal): Promise<WorktreeLayoutResult> {
  const value = await call('git.worktree-list', { cwd }, signal)
  return value as WorktreeLayoutResult
}

/** Create a linked worktree. */
export async function createWorktree(
  cwd: string,
  path: string,
  branch: string,
  createBranch: boolean,
): Promise<void> {
  await call('git.worktree-add', { cwd, path, branch, createBranch })
}

/** The repository's branches (`git.branch` → { current, names }). */
export async function fetchBranches(cwd: string, signal?: AbortSignal): Promise<{ current: string; names: string[] }> {
  return (await call('git.branch', { cwd }, signal)) as { current: string; names: string[] }
}

/**
 * Batch-fetch the worktree layout for every unique workspace cwd. Results are
 * cached per cwd until the cwd roster changes (new worktrees refresh via a
 * manual `refresh`). Layouts are pure derivation input — a failed lookup
 * degrades that cwd to a non-git directory project.
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
  const refresh = (): void => { setRevision(v => v + 1) }
  return { layouts, refresh, loading }
}
