/**
 * Conversation targeting for the selection action bar ("add to chat").
 *
 * The DSH sidebar is conversation-scoped: a text selection can be appended
 * into ANY conversation's composer draft, not just the active one. This
 * module derives the candidate list (active session first, then the session
 * roster) and owns the single write path into a target conversation's
 * draft — the same mechanism the review-comments bridge uses
 * (`sessions.scope(id)` → `conversation.input.for(context)` → `setDraft`),
 * made target-addressable instead of current-only.
 */
import type { ReviewAgentContext, ReviewSessionsService } from '../review/review-comments.ts'
import type { SessionsService } from '../client-types.ts'
import { recordSelectionReference, SELECTION_SOURCE } from './slash-source.ts'

/** A conversation the selection can be sent to. */
export interface ConversationTarget {
  id: string
  /** Human-facing label: title, project basename, then session id. */
  label: string
  /** True when this is the currently active conversation (default target). */
  current: boolean
  /** Session cwd — the payload path base for this target. */
  cwd?: string
  /** Last activity wall-clock (ms epoch); shown in the picker. */
  updatedAt?: number
}

export type AppendResult = 'inserted' | 'unavailable'

/**
 * Structural mirror of the composer input the sessions service exposes per
 * conversation (`conversation.input.for(context)` in the review bridge).
 * Structurally compatible with the review service's private type; only the
 * setDraft write is needed here.
 */
interface TargetComposerInput {
  setDraft(draft: string): void
}

interface TargetConversationService {
  input: {
    for(context: ReviewAgentContext): TargetComposerInput
  }
}

/**
 * List targetable conversations from the sessions roster. The current
 * (active) session is always first and is the default target; the rest
 * follow the roster's order (current first, then recency via the
 * host-provided `updatedAt`; the picker menu scrolls when it exceeds the
 * viewport). Returns null when no conversation is reachable at all.
 */
export function listConversationTargets(
  sessions: SessionsService,
): ConversationTarget[] | null {
  const snapshot = sessions.list.getSnapshot()
  const current = snapshot.current
  const entries = Object.entries(snapshot.byId)
  if (current === undefined && entries.length === 0) return null
  const ordered = current === undefined
    ? entries
    : [current, ...entries.filter(([id]) => id !== current).map(([id]) => id)]
      .map(id => [id, snapshot.byId[id]] as const)
  // 当前会话固定置顶；其余按最近更新时间从近到远（左栏同序）。
  const sorted = [
    ...ordered.filter(([id]) => id === current),
    ...ordered
      .filter(([id]) => id !== current)
      .sort(([, a], [, b]) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0)),
  ]
  return sorted
    .map(([id, summary]) => ({
      id,
      label: summary?.displayTitle
        ?? summary?.title
        ?? (summary?.cwd !== undefined && summary.cwd !== '' ? summary.cwd : id),
      current: id === current,
      ...(summary?.cwd === undefined ? {} : { cwd: summary.cwd }),
      ...(summary?.updatedAt === undefined ? {} : { updatedAt: summary.updatedAt }),
    }))
}

/**
 * Append `text` into the composer draft of the conversation identified by
 * `conversationId`. Unlike the review bridge's active-only append, any
 * roster id is addressable through `sessions.scope(id)`; when the scope is
 * unreachable (no conversation service bound) the call degrades to
 * 'unavailable' and the caller can surface that.
 */
export function appendToConversation(
  sessions: ReviewSessionsService,
  conversationId: string,
  text: string,
): AppendResult {
  const context = sessions.scope?.(conversationId)
  if (context === undefined) return 'unavailable'
  const conversation = context.get('conversation') as TargetConversationService | undefined
  const input = conversation?.input?.for(context)
  if (input === undefined) return 'unavailable'
  const state = inputDraftState(input)
  input.setDraft(state === '' ? text : `${state}\n\n${text}`)
  return 'inserted'
}

function inputDraftState(input: TargetComposerInput): string {
  // The full composer input state is observable; only the draft string
  // matters for appending. Absent an observable state, append to an empty
  // baseline (setDraft still works).
  const state = (input as {
    state?: { getSnapshot?(): { draft?: string } }
  }).state
  const draft = state?.getSnapshot?.().draft
  return typeof draft === 'string' ? draft : ''
}

/**
 * Insert the selection as an INLINE REFERENCE CHIP (the composer's
 * `slash/input-insert-reference` occurrence) instead of appending raw text.
 * The chip renders as a styled block in the draft (label = `path:lines`),
 * carries the fenced payload as its clipboard text, and is removable as one
 * unit — the same mechanism the review-comments bridge uses.
 *
 * Each chip gets a UNIQUE ref (C15) so multiple selections can coexist in
 * one draft without clobbering each other's serialized payload.
 *
 * Returns 'inserted' when the chip landed, 'unavailable' when the target
 * conversation's composer is unreachable or rejects the reference.
 */
export function insertReferenceIntoConversation(
  sessions: ReviewSessionsService,
  conversationId: string,
  input: { label: string; clipboardText: string },
): AppendResult {
  const context = sessions.scope?.(conversationId)
  if (context === undefined) return 'unavailable'
  const conversation = context.get('conversation') as TargetConversationService | undefined
  const composerInput = conversation?.input?.for(context)
  if (composerInput === undefined) return 'unavailable'
  const state = (composerInput as {
    state?: { getSnapshot?(): { draft?: string; draftRev?: number } }
  }).state?.getSnapshot?.()
  const draft = typeof state?.draft === 'string' ? state.draft : ''
  const draftRev = typeof state?.draftRev === 'number' ? state.draftRev : 0
  // Record the model text under a per-chip ref so the codec can look it up
  // at submit time (C15). Uses crypto.randomUUID when available.
  const ref = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `selection-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
  recordSelectionReference(ref, input.clipboardText)
  const ok = context.bail(context, 'slash/input-insert-reference', {
    reference: {
      source: SELECTION_SOURCE,
      ref,
      label: input.label,
      clipboardText: input.clipboardText,
    },
    span: { start: draft.length, end: draft.length, draftRev },
  })
  return ok === true ? 'inserted' : 'unavailable'
}
