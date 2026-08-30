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
 *
 * A blank (new-conversation) session resolves READY once its cwd is known:
 * the host's session-added frame carries it precisely so clients can group
 * without a list refresh, and an empty top strip on the new-conversation page
 * (workspace tabs vanishing) was exactly the bug. Blank sessions never get a
 * conversation TAB — that policy lives in {@link currentConversationSyncAction}.
 * @param list - current session-list projection.
 * @returns ready for any current session with a non-empty cwd, pending while
 * the cwd has not arrived yet, none when nothing is selected.
 */
export function resolveCenterWorkspace(list: SessionListState): CenterWorkspace {
  const sessionId = list.current
  if (sessionId === undefined) return { status: 'none' }
  const summary = list.byId[sessionId]
  const cwd = summary?.cwd?.trim()
  if (summary === undefined || cwd === undefined || cwd === '') {
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
 * Subagent children are never tabs (the left rail's sessionVisible rule),
 * so a restored subagent entry drops instead of being retained.
 */
export function retainConversationSurface(input: {
  cwd: string
  sessionId: string
  list: SessionListState
}): boolean {
  const summary = input.list.byId[input.sessionId]
  if (summary === undefined) return false
  if (summary.origin === 'subagent') return false
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
  // A blank (new-conversation) session is NOT a tab: navigating to it never
  // opens one, and the center stage is the conversation itself (the caller
  // deactivates the active surface). Its first sent message materializes it
  // (same session id, blank flips false) — the rule below opens the tab then.
  if (input.current.summary.blank === true) return 'none'
  if (input.previous?.summary.blank === true
    && input.previous.sessionId === input.current.sessionId) return 'open'
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

/**
 * A conversation tab's live posture, rendered as the official StateDot — the
 * same indicator and precedence as the left rail's session rows
 * (desktop-left-rail Rows.tsx sessionStatuses): a pending user interaction
 * outranks running, which outranks the finished-but-unviewed reminder.
 * Undefined = idle: no dot, the conversation icon shows instead.
 */
export function conversationPosture(
  summary?: SessionSummary,
): 'warning' | 'ongoing' | 'done' | undefined {
  if (summary === undefined) return undefined
  if (summary.pendingInteraction !== undefined) return 'warning'
  if (summary.running === true) return 'ongoing'
  if (summary.completed === true) return 'done'
  return undefined
}
