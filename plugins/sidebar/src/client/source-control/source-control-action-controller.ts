import { errorMessage } from '@dsh-studio/shared/errors'
import { useCallback, useRef, useState } from 'react'
import type { CapabilitiesScope } from '../sidebar-api.ts'
import { sidebarApi } from '../sidebar-api.ts'
import type { SourceControlActionKind } from './source-control-actions.ts'

export type SourceControlOperationState =
  | { phase: 'idle' }
  | { phase: 'running'; kind: SourceControlActionKind }
  | { phase: 'error'; kind: SourceControlActionKind; message: string }

export interface SourceControlActionController {
  state: SourceControlOperationState
  run(kind: SourceControlActionKind, message: string): Promise<{ stagedAll: boolean }>
  /** Checkout a branch (the panel branch-list action; not a commit-area kind). */
  checkout(branch: string): Promise<void>
  clearError(): void
}

export interface SourceControlActionControllerOptions {
  scope: CapabilitiesScope | undefined
  /** Number of currently staged changes (D1: never stage-all when > 0). */
  stagedCount: number
  refresh(): Promise<void>
  onCommitted(): void
}

async function dispatch(
  kind: SourceControlActionKind,
  scope: CapabilitiesScope,
  message: string,
  stagedCount: number,
): Promise<{ stagedAll: boolean }> {
  switch (kind) {
    case 'commit': {
      // D1: commit ONLY the already-staged set; the "stage everything +
      // commit" behaviour (the old panel-mutations path) is reserved for
      // the empty-index case and is signalled back via stagedAll.
      if (stagedCount === 0) {
        await sidebarApi.gitStage(scope)
        await sidebarApi.gitCommit(scope, message)
        return { stagedAll: true }
      }
      await sidebarApi.gitCommit(scope, message)
      return { stagedAll: false }
    }
    case 'publish':
    case 'push':
      await sidebarApi.gitPush(scope)
      return { stagedAll: false }
    case 'force-push':
      await sidebarApi.gitForcePush(scope)
      return { stagedAll: false }
    case 'pull':
      await sidebarApi.gitPull(scope)
      return { stagedAll: false }
    case 'sync':
      await sidebarApi.gitSync(scope)
      return { stagedAll: false }
    case 'fetch':
      await sidebarApi.gitFetch(scope)
      return { stagedAll: false }
    case 'abort-merge':
      await sidebarApi.gitAbortMerge(scope)
      return { stagedAll: false }
    case 'abort-rebase':
      await sidebarApi.gitAbortRebase(scope)
      return { stagedAll: false }
  }
}

/**
 * Own the one active commit-area mutation lane. The only result state callers
 * receive is phase/kind/message; Git facts always return through refresh().
 */
export function useSourceControlActionController(
  options: SourceControlActionControllerOptions,
): SourceControlActionController {
  const [state, setState] = useState<SourceControlOperationState>({ phase: 'idle' })
  const running = useRef(false)
  const { scope, stagedCount, refresh, onCommitted } = options
  // C21: depend on the primitive option values, not the unstable `options`
  // object literal (a fresh object each render would defeat memoization).
  const run = useCallback(async (kind: SourceControlActionKind, message: string): Promise<{ stagedAll: boolean }> => {
    if (scope === undefined || running.current) return { stagedAll: false }
    running.current = true
    setState({ phase: 'running', kind })
    try {
      const result = await dispatch(kind, scope, message, stagedCount)
      if (kind === 'commit') onCommitted()
      await refresh()
      setState({ phase: 'idle' })
      return result
    } catch (cause) {
      setState({
        phase: 'error',
        kind,
        message: errorMessage(cause),
      })
      return { stagedAll: false }
    } finally {
      running.current = false
    }
  }, [onCommitted, refresh, scope, stagedCount])
  const clearError = useCallback(() => {
    setState(current => current.phase === 'error' ? { phase: 'idle' } : current)
  }, [])
  const checkout = useCallback(async (branch: string): Promise<void> => {
    if (scope === undefined || running.current) return
    running.current = true
    setState({ phase: 'running', kind: 'commit' })
    try {
      await sidebarApi.gitCheckout(scope, branch)
      await refresh()
      setState({ phase: 'idle' })
    } catch (cause) {
      setState({
        phase: 'error',
        kind: 'commit',
        message: errorMessage(cause),
      })
    } finally {
      running.current = false
    }
  }, [refresh, scope])
  return { state, run, checkout, clearError }
}
