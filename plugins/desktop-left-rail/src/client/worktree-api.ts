/**
 * Client half of the desktop worktree API. The left rail has no session
 * binding, so it calls the desktop host's `/sidebar/api` worktree endpoints
 * with a bare cwd through the same-origin capability fence.
 */
import { useEffect, useMemo, useState } from 'react'
import { callSidebarGlobalApi } from '@dsh-studio/shared/sidebar-api'
import type { WorktreeDefaultsResult } from '@dsh-studio/shared/worktree-preferences'
import type { GitWorktreeLayout, WorktreeFactState, WorktreeLayoutMap } from './tree.ts'

/** One worktree list response (null = confirmed non-git directory). */
export type WorktreeLayoutResult = GitWorktreeLayout | null

/** `git.worktree-list` for one cwd; null when it is confirmed non-git. */
export async function fetchWorktreeLayout(cwd: string, signal?: AbortSignal): Promise<WorktreeLayoutResult> {
  return callSidebarGlobalApi<WorktreeLayoutResult>('git.worktree-list', { cwd }, signal)
}

/** Effective worktree store root + nesting for the creation dialog's defaults. */
export async function fetchWorktreeDefaults(signal?: AbortSignal): Promise<WorktreeDefaultsResult> {
  return callSidebarGlobalApi<WorktreeDefaultsResult>('git.worktree-defaults', {}, signal)
}

/**
 * Create a linked worktree.
 * @param base - new-branch start point (ignored when attaching an existing branch).
 */
export async function createWorktree(
  cwd: string,
  path: string,
  branch: string,
  createBranch: boolean,
  base?: string,
): Promise<void> {
  await callSidebarGlobalApi('git.worktree-add', {
    cwd, path, branch, createBranch,
    ...(base === undefined ? {} : { base }),
  })
}

/** One guarded linked-worktree removal preview. */
export interface WorktreeRemovalPreview {
  repoRoot: string
  path: string
  branch: string | null
  main: boolean
  locked: boolean
  prunable: string | null
  dirty: boolean
  statusEntries: readonly { path: string; xy: string }[]
}

/** Inspect one linked worktree before asking for destructive confirmation. */
export async function previewWorktreeRemoval(cwd: string, path: string, signal?: AbortSignal): Promise<WorktreeRemovalPreview> {
  return callSidebarGlobalApi<WorktreeRemovalPreview>('git.worktree-remove-preview', { cwd, path }, signal)
}

/** Remove one non-primary linked worktree through the Host Git fence. */
export async function removeWorktree(cwd: string, path: string, force = false): Promise<WorktreeLayoutResult> {
  const result = await callSidebarGlobalApi<{ layout: WorktreeLayoutResult }>('git.worktree-remove', { cwd, path, force })
  return result.layout
}

/** The repository's branches (`git.branch` → { current, names }). */
export async function fetchBranches(cwd: string, signal?: AbortSignal): Promise<{ current: string; names: string[] }> {
  return callSidebarGlobalApi<{ current: string; names: string[] }>('git.branch', { cwd }, signal)
}

/**
 * Batch-fetch the worktree layout for every unique workspace cwd. A lookup
 * failure retains its last-known layout and is never represented as a
 * confirmed non-Git directory.
 */
export function useWorktreeLayouts(cwds: readonly string[]): {
  layouts: WorktreeLayoutMap
  facts: ReadonlyMap<string, WorktreeFactState>
  refresh: () => void
  loading: boolean
} {
  const unique = Array.from(new Set(cwds)).sort()
  const [facts, setFacts] = useState<Map<string, WorktreeFactState>>(new Map())
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const key = unique.join('\n')
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const previous = facts
    const initial = new Map<string, WorktreeFactState>()
    for (const cwd of unique) {
      const old = previous.get(cwd)
      const lastKnown = old?.status === 'ready' && old.layout !== null
        ? old.layout
        : old?.status === 'loading' || old?.status === 'error' ? old.lastKnown : undefined
      initial.set(cwd, lastKnown === undefined ? { status: 'loading' } : { status: 'loading', lastKnown })
    }
    setFacts(initial)
    const run = async (): Promise<void> => {
      setLoading(unique.length > 0)
      const next = new Map(initial)
      await Promise.all(unique.map(async cwd => {
        try {
          next.set(cwd, { status: 'ready', layout: await fetchWorktreeLayout(cwd, controller.signal) })
        } catch (error) {
          const old = previous.get(cwd)
          const lastKnown = old?.status === 'ready' && old.layout !== null
            ? old.layout
            : old?.status === 'loading' || old?.status === 'error' ? old.lastKnown : undefined
          next.set(cwd, {
            status: 'error',
            ...(lastKnown === undefined ? {} : { lastKnown }),
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }))
      if (!cancelled) {
        setFacts(next)
        setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
    // `key` is the cwd roster; `revision` forces a refetch after a mutation.
  }, [key, revision])
  useEffect(() => {
    const refreshIfVisible = (): void => {
      if (document.visibilityState === 'visible') setRevision(value => value + 1)
    }
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [])
  const layouts = useMemo<WorktreeLayoutMap>(() => ({
    get(cwd) {
      const fact = facts.get(cwd)
      if (fact === undefined) return undefined
      if (fact.status === 'ready') return fact.layout
      return fact.lastKnown
    },
    getFact(cwd) {
      return facts.get(cwd)
    },
  }), [facts])
  return { layouts, facts, refresh: () => { setRevision(value => value + 1) }, loading }
}
