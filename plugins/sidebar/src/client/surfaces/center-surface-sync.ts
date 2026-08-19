/**
 * Current-session projection and transition policy for center surfaces.
 * Only a materialized session with a workspace cwd may mutate a project queue.
 */
import type { SessionListState, SessionSummary } from '../client-types.ts'

export type CenterWorkspace =
  | { status: 'none' }
  | { status: 'pending'; sessionId: string }
  | { status: 'ready'; cwd: string; sessionId: string; summary: SessionSummary }

export type CurrentConversationSyncAction = 'open' | 'activate' | 'none'

/**
 * Resolve whether the current session has enough authoritative facts to drive
 * the center queue.
 * @param list - current session-list projection.
 * @returns ready only for a non-blank current session with a non-empty cwd.
 */
export function resolveCenterWorkspace(list: SessionListState): CenterWorkspace {
  const sessionId = list.current
  if (sessionId === undefined) return { status: 'none' }
  const summary = list.byId[sessionId]
  const cwd = summary?.cwd?.trim()
  if (summary === undefined || summary.blank === true || cwd === undefined || cwd === '') {
    return { status: 'pending', sessionId }
  }
  return { status: 'ready', cwd, sessionId, summary }
}

/**
 * Resolve the one center-queue action induced by an authoritative current
 * session snapshot.
 * @param input - ready session, prior ready session, and queue facts.
 * @returns the idempotent operation needed to reflect the current session.
 */
/**
 * Keep an open conversation tab while its session is temporarily incomplete.
 * Once a materialized session moves to another cwd, its old queue entry is
 * stale; an absent session was deleted and must be removed as well.
 */
export function retainConversationSurface(input: {
  cwd: string
  sessionId: string
  list: SessionListState
}): boolean {
  const summary = input.list.byId[input.sessionId]
  if (summary === undefined) return false
  if (summary.blank === true) return true
  const cwd = summary.cwd?.trim()
  return cwd === undefined || cwd === '' || cwd === input.cwd
}

export function currentConversationSyncAction(input: {
  current: Extract<CenterWorkspace, { status: 'ready' }>
  previous: Extract<CenterWorkspace, { status: 'ready' }> | undefined
  queueKnown: boolean
  currentTabOpen: boolean
  activeSurfaceExists: boolean
}): CurrentConversationSyncAction {
  if (!input.queueKnown) return 'open'
  if (input.previous?.cwd === input.current.cwd) {
    if (input.previous.sessionId !== input.current.sessionId) {
      return input.currentTabOpen ? 'activate' : 'open'
    }
    if (input.currentTabOpen && !input.activeSurfaceExists) return 'activate'
  }
  if (input.previous?.cwd !== input.current.cwd && input.currentTabOpen) return 'activate'
  return 'none'
}
