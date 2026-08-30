/**
 * WorkspaceEvents implementation — the workspace/session identity switch
 * source (target-design §3.5 skeleton). Exactly two event classes, kept
 * distinct because switching sessions inside the same cwd is NOT a workspace
 * change:
 *
 *   - `onWorkspaceChanged`: the active workspace (cwd) changed;
 *   - `onSessionChanged`: the active session changed (same cwd or not).
 *
 * Git freshness stays a separate domain (GitWatchCoordinator); this service
 * only carries the identity fact. Consumers receive the service only through
 * the `workbench.events` ctx service. No DOM, no React, no cordis imports.
 */
import type {
  SessionChangedEvent,
  Unsubscribe,
  WorkspaceEventsService,
} from '@dsh-studio/shared/workbench-contracts'

export function createWorkspaceEvents(): WorkspaceEventsService {
  let cwd: string | null = null
  let sessionId: string | null = null
  const workspaceSubscribers = new Set<(cwd: string) => void>()
  const sessionSubscribers = new Set<(event: SessionChangedEvent) => void>()

  return {
    identify(next) {
      const workspaceChanged = next.cwd !== undefined && next.cwd !== cwd
      const sessionChanged = next.sessionId !== undefined && next.sessionId !== sessionId
      if (next.cwd !== undefined) cwd = next.cwd
      if (next.sessionId !== undefined) sessionId = next.sessionId
      // Workspace first so session listeners already observe the new cwd.
      if (workspaceChanged && cwd !== null) {
        for (const callback of [...workspaceSubscribers]) callback(cwd)
      }
      if (sessionChanged && sessionId !== null) {
        const event: SessionChangedEvent = { sessionId, cwd: cwd ?? '' }
        for (const callback of [...sessionSubscribers]) callback(event)
      }
    },
    snapshot() {
      return { cwd, sessionId }
    },
    onWorkspaceChanged(callback) {
      workspaceSubscribers.add(callback)
      return () => workspaceSubscribers.delete(callback)
    },
    onSessionChanged(callback) {
      sessionSubscribers.add(callback)
      return () => sessionSubscribers.delete(callback)
    },
  }
}
