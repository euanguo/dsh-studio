import { useCallback, useRef, useState } from 'react'
import type { SidebarScope } from '../sidebar-api.ts'
import { sidebarApi } from '../sidebar-api.ts'
import type { SourceControlActionKind } from './source-control-actions.ts'

export type SourceControlOperationState =
  | { phase: 'idle' }
  | { phase: 'running'; kind: SourceControlActionKind }
  | { phase: 'error'; kind: SourceControlActionKind; message: string }

export interface SourceControlActionController {
  state: SourceControlOperationState
  run(kind: SourceControlActionKind, message: string): Promise<void>
  clearError(): void
}

export interface SourceControlActionControllerOptions {
  scope: SidebarScope | undefined
  refresh(): Promise<void>
  onCommitted(): void
}

async function dispatch(
  kind: SourceControlActionKind,
  scope: SidebarScope,
  message: string,
): Promise<void> {
  switch (kind) {
    case 'commit':
      await sidebarApi.gitStage(scope)
      await sidebarApi.gitCommit(scope, message)
      return
    case 'publish':
    case 'push':
      await sidebarApi.gitPush(scope)
      return
    case 'force-push':
      await sidebarApi.gitForcePush(scope)
      return
    case 'pull':
      await sidebarApi.gitPull(scope)
      return
    case 'sync':
      await sidebarApi.gitSync(scope)
      return
    case 'fetch':
      await sidebarApi.gitFetch(scope)
      return
    case 'abort-merge':
      await sidebarApi.gitAbortMerge(scope)
      return
    case 'abort-rebase':
      await sidebarApi.gitAbortRebase(scope)
      return
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
  const run = useCallback(async (kind: SourceControlActionKind, message: string): Promise<void> => {
    if (options.scope === undefined || running.current) return
    running.current = true
    setState({ phase: 'running', kind })
    try {
      await dispatch(kind, options.scope, message)
      if (kind === 'commit') options.onCommitted()
      await options.refresh()
      setState({ phase: 'idle' })
    } catch (cause) {
      setState({
        phase: 'error',
        kind,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      running.current = false
    }
  }, [options])
  const clearError = useCallback(() => {
    setState(current => current.phase === 'error' ? { phase: 'idle' } : current)
  }, [])
  return { state, run, clearError }
}
