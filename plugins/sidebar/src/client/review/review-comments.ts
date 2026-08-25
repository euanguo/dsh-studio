import type { GitReviewCommit } from '../diff/git-review-diff.ts'
import {
  loadCommentsRecord,
  putReviewComments,
} from '@dsh-studio/shared/comments-record'

export type ReviewCommentSide = 'new' | 'old' | null

export interface ReviewComment {
  id: string
  workspacePath: string
  branch: string
  commitId: string
  filePath: string | null
  line: number | null
  side: ReviewCommentSide
  body: string
  createdAt: string
  /**
   * Resolution timestamp: a resolved comment stays listed and persisted
   * but is pulled out of the composer reference and never delivered with new
   * review requests. Absent ⇒ unresolved.
   */
  resolvedAt?: string
  request: string
}

export type ReviewCommentDraft = Omit<ReviewComment, 'request'>

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface ReviewSessionSummary {
  cwd?: string
}

export interface ReviewSessionFace {
  getSnapshot(): { nodes?: readonly { kind: string; seq: number }[] }
  subscribe(listener: () => void): () => void
}

interface ReviewInputState {
  draft: string
  draftRev: number
  occurrences: readonly ReviewOccurrence[]
}

interface ReviewInput {
  state: ObservableSnapshot<ReviewInputState>
  setDraft(draft: string): void
}

interface ReviewOccurrence {
  source: string
  ref: string
  offset: number
  label: string
}

export interface ReviewAgentContext {
  bail(context: ReviewAgentContext, event: string, request: unknown): true | undefined
  get(name: string): unknown
}

export interface ReviewSessionsService {
  list: ObservableSnapshot<{
    current?: string
    byId: Record<string, ReviewSessionSummary>
  }>
  scope?(id: string): ReviewAgentContext | undefined
  sessionOf?(context: ReviewAgentContext): ReviewSessionFace | undefined
}

interface ReviewConversationService {
  input: {
    for(context: ReviewAgentContext): ReviewInput
  }
}

export interface ReviewSlashSource {
  trigger: '@'
  name: string
  order: number
  candidates(): Promise<readonly never[]>
  onPick(): undefined
  codec: {
    /** `input.ref` selects which reference's model text to render. */
    clipboardText(input?: { ref?: string }): string
    serialize(input?: { ref?: string }): Promise<string>
  }
}

export interface ReviewInputTriggersService {
  registerSource(source: ReviewSlashSource): () => void
}

type InjectionResult = 'inserted' | 'unavailable'
type ScopeKey = string | null

interface ComposerBridge {
  addComment(text: string, id: string, branch: string): InjectionResult
  /**
   * Append raw text into the ACTIVE composer draft (the selection →
   * "add to conversation" channel). Returns 'unavailable' when no active
   * conversation input is reachable.
   */
  appendText(text: string): InjectionResult
  dispose(): void
  removeComment(id: string): void
  setScope(branch: string | null): void
}

const REVIEW_SOURCE = 'dsh-studio-review'
const REVIEW_REF = 'review-comments'
const MAX_PERSISTED_COMMENTS = 200

// Review comments live in the `comments` table's `review` array, sharing it
// with workbench ones. The record is owned by the shared comments-record
// module: half-writes ride on its freshest other-half cache instead of a
// stale local copy that used to erase newer workbench rows.

/** The persistence seam for review comments (domain-backed by default). */
export interface ReviewCommentsPersistence {
  load(): Promise<ReviewComment[]>
  save(comments: readonly ReviewComment[]): void
}

const domainPersistence: ReviewCommentsPersistence = {
  async load() {
    const record = await loadCommentsRecord()
    return (record.review ?? []).filter(isReviewComment).slice(-MAX_PERSISTED_COMMENTS)
  },
  save(comments) {
    void putReviewComments(comments.slice(-MAX_PERSISTED_COMMENTS)).catch(error => {
      console.warn('[sidebar] failed to persist review comments', error)
    })
  },
}

function isReviewComment(value: unknown): value is ReviewComment {
  if (typeof value !== 'object' || value === null) return false
  const comment = value as Partial<ReviewComment>
  return typeof comment.id === 'string'
    && typeof comment.workspacePath === 'string'
    && typeof comment.branch === 'string'
    && typeof comment.commitId === 'string'
    && (comment.filePath === null || typeof comment.filePath === 'string')
    && (comment.line === null || (Number.isInteger(comment.line) && Number(comment.line) > 0))
    && (comment.side === null || comment.side === 'new' || comment.side === 'old')
    && typeof comment.body === 'string'
    && typeof comment.createdAt === 'string'
    && (comment.resolvedAt === undefined || typeof comment.resolvedAt === 'string')
    && typeof comment.request === 'string'
}

function commentLocation(comment: ReviewComment): string {
  if (comment.filePath === null || comment.line === null) return 'Commit'
  return `${comment.filePath}:${comment.side === 'old' ? 'L' : 'R'}${String(comment.line)}`
}

export function formatReviewComment(
  commit: GitReviewCommit,
  comment: ReviewComment,
): string {
  const line = comment.filePath === null || comment.line === null
    ? undefined
    : commit.files
      .find(file => file.path === comment.filePath || file.oldPath === comment.filePath)
      ?.lines.find(candidate => comment.side === 'old'
        ? candidate.oldLine === comment.line
        : candidate.newLine === comment.line)
  return [
    '[Git review comment]',
    `Repository: ${comment.workspacePath}`,
    `Branch: ${comment.branch}`,
    `Commit: ${commit.shortId} (${commit.id}) ${commit.subject}`,
    `Location: ${commentLocation(comment)}`,
    ...(line === undefined ? [] : [`Code: ${line.content}`]),
    'Comment:',
    comment.body,
  ].join('\n')
}

export function formatReviewRequest(comments: readonly string[]): string {
  if (comments.length === 0) return ''
  return [
    '## Git review request',
    '',
    'Treat every review comment below as an actionable code-change request.',
    'Inspect the exact repository, branch, commit, file, and line before editing.',
    '',
    '## Comments',
    '',
    ...comments,
  ].join('\n')
}

/**
 * Explicit delivery state machine for the review composer bridge (audit C5/§5).
 *
 * The composer's delivery lifecycle is a small state machine with two phases:
 *
 *   idle    → pending: an occurring comment block was removed while the draft
 *             emptied and at least one comment remained (the user "closed" the
 *             reference in a now-empty draft → the selection signals delivery).
 *   pending → idle:     the draft was repopulated (delivery aborted), or a
 *             reset happened (scope changed / no conversation current), or the
 *             session's latest user-shorthand seq advanced past the baseline
 *             recorded at arm time → `send` the pending ids as an out-effect.
 *
 * The reducer is pure and module-scope (`reduceDelivery`) so the lifecycle is
 * testable without touching the reactive subscriptions. `createComposerBridge`
 * is the constructor: it computes reducer events from the input/session
 * subscriptions and, when `send` fires, runs `completeDelivery` for the real
 * side effects (delete the delivered ids, persist the scoped map, publish,
 * reconcile).
 */
// Phase tags use a const-object plus a string-literal union rather than a TS
// `enum` so the module stays loadable by Node's strip-only TS test runner.
const DeliveryPhase = {
  /** No delivery armed. */
  Idle: 'idle',
  /** A comment occurrence was closed; awaiting session user-seq advance. */
  Pending: 'pending',
} as const

interface PendingDelivery {
  input: ReviewInput
  ids: readonly string[]
  baselineSeq: number
}

type DeliveryState =
  | { phase: typeof DeliveryPhase.Idle }
  | { phase: typeof DeliveryPhase.Pending; pending: PendingDelivery }

type DeliveryEvent =
  | {
      type: 'input-state-changed'
      input: ReviewInput
      ids: readonly string[]
      draftEmpty: boolean
      occurrenceDropped: boolean
      commentsSize: number
      latestUserSeq: number
    }
  | { type: 'session-advanced'; latestUserSeq: number }
  | { type: 'reset' }

interface DeliveryResult {
  state: DeliveryState
  /** The ids to deliver, or null when no delivery is due from this event. */
  send: readonly string[] | null
}

function reduceDelivery(state: DeliveryState, event: DeliveryEvent): DeliveryResult {
  switch (state.phase) {
    case DeliveryPhase.Idle:
      if (event.type === 'input-state-changed') {
        if (event.occurrenceDropped && event.draftEmpty && event.commentsSize > 0) {
          return {
            state: {
              phase: DeliveryPhase.Pending,
              pending: {
                input: event.input,
                ids: event.ids,
                baselineSeq: event.latestUserSeq,
              },
            },
            send: null,
          }
        }
        return { state, send: null }
      }
      if (event.type === 'session-advanced') return { state, send: null }
      return { state: { phase: DeliveryPhase.Idle }, send: null }
    case DeliveryPhase.Pending: {
      const pending = state.pending
      if (event.type === 'input-state-changed') {
        // A repopulated draft aborts the armed delivery. The idle→pending
        // re-arm only runs from Idle, so an armed delivery stays armed while
        // the draft stays empty.
        if (!event.draftEmpty) return { state: { phase: DeliveryPhase.Idle }, send: null }
        return { state, send: null }
      }
      if (event.type === 'session-advanced') {
        if (event.latestUserSeq > pending.baselineSeq) {
          return { state: { phase: DeliveryPhase.Idle }, send: pending.ids }
        }
        return { state, send: null }
      }
      return { state: { phase: DeliveryPhase.Idle }, send: null }
    }
  }
  /* istanbul ignore next -- exhaustive enum switch; unreachable. */
  return { state, send: null }
}

function createComposerBridge(
  sessions: ReviewSessionsService,
  inputTriggers: ReviewInputTriggersService,
  onDelivered: (ids: readonly string[]) => void,
): ComposerBridge {
  const commentsByScope = new Map<ScopeKey, Map<string, string>>()
  let comments = new Map<string, string>()
  let branch: string | null = null
  let activeScope: ScopeKey = null
  let initialized = false
  let mutating = false
  let watchedInput: ReviewInput | undefined
  let watchedSession: ReviewSessionFace | undefined
  let watchedId: string | undefined
  let stopInput: (() => void) | undefined
  let stopSession: (() => void) | undefined
  let previousInputState: ReviewInputState | undefined
  let delivery: DeliveryState = { phase: DeliveryPhase.Idle }

  const label = (): string => `${String(comments.size)} comment${comments.size === 1 ? '' : 's'}`
  const payload = (): string => formatReviewRequest([...comments.values()])
  const source: ReviewSlashSource = {
    trigger: '@',
    name: REVIEW_SOURCE,
    order: 1000,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      clipboardText: payload,
      serialize: async () => payload(),
    },
  }

  const current = (): {
    id: string
    context: ReviewAgentContext
    input: ReviewInput
    session: ReviewSessionFace | undefined
    cwd: string | undefined
  } | null => {
    const snapshot = sessions.list.getSnapshot()
    const id = snapshot.current
    if (id === undefined) return null
    const context = sessions.scope?.(id)
    if (context === undefined) return null
    const conversation = context.get('conversation') as ReviewConversationService | undefined
    if (conversation === undefined) return null
    return {
      id,
      context,
      input: conversation.input.for(context),
      session: sessions.sessionOf?.(context),
      cwd: snapshot.byId[id]?.cwd,
    }
  }

  const scopeOf = (value: ReturnType<typeof current>): ScopeKey => value === null
    ? null
    : `${value.id}\0${value.cwd ?? ''}\0${branch ?? ''}`
  const occurrence = (state: ReviewInputState): ReviewOccurrence | undefined =>
    state.occurrences.find(item => item.source === REVIEW_SOURCE && item.ref === REVIEW_REF)
  const latestUserSeq = (session: ReviewSessionFace | undefined): number => {
    let latest = -1
    for (const node of session?.getSnapshot().nodes ?? []) {
      if (node.kind === 'user' && node.seq > latest) latest = node.seq
    }
    return latest
  }
  const removeOccurrence = (input: ReviewInput, item: ReviewOccurrence): void => {
    const state = input.state.getSnapshot()
    if (state.draft[item.offset] !== '\uFFFC') return
    input.setDraft(state.draft.slice(0, item.offset) + state.draft.slice(item.offset + 1))
  }
  const insertOccurrence = (value: NonNullable<ReturnType<typeof current>>): boolean => {
    const state = value.input.state.getSnapshot()
    return value.context.bail(value.context, 'slash/input-insert-reference', {
      reference: {
        source: REVIEW_SOURCE,
        ref: REVIEW_REF,
        label: label(),
        clipboardText: payload(),
      },
      span: { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev },
    }) === true
  }

  /** Reset any armed delivery (scope change / no current conversation). */
  const resetDelivery = (): void => {
    delivery = reduceDelivery(delivery, { type: 'reset' }).state
  }

  /** Apply the delivery out-effect: drop the delivered ids, persist the
   *  scoped map, publish, and reconcile. `ids` comes from the reducer's
   *  `send` out-signal. */
  const completeDelivery = (ids: readonly string[]): void => {
    for (const id of ids) comments.delete(id)
    commentsByScope.set(activeScope, comments)
    onDelivered(ids)
    reconcile()
  }

  const watch = (value: ReturnType<typeof current>): void => {
    if (value === null) {
      stopInput?.()
      stopSession?.()
      stopInput = undefined
      stopSession = undefined
      watchedInput = undefined
      watchedSession = undefined
      watchedId = undefined
      previousInputState = undefined
      resetDelivery()
      return
    }
    if (watchedId === value.id && watchedInput === value.input
      && watchedSession === value.session) return
    stopInput?.()
    stopSession?.()
    watchedId = value.id
    watchedInput = value.input
    watchedSession = value.session
    previousInputState = value.input.state.getSnapshot()
    stopInput = value.input.state.subscribe(() => {
      const previous = previousInputState
      const next = value.input.state.getSnapshot()
      previousInputState = next
      if (mutating) return
      const result = reduceDelivery(delivery, {
        type: 'input-state-changed',
        input: value.input,
        ids: [...comments.keys()],
        draftEmpty: next.draft === '',
        occurrenceDropped: previous !== undefined
          ? occurrence(previous) !== undefined && occurrence(next) === undefined
          : false,
        commentsSize: comments.size,
        latestUserSeq: latestUserSeq(value.session),
      })
      delivery = result.state
      reconcile()
    })
    stopSession = value.session?.subscribe(() => {
      const result = reduceDelivery(delivery, {
        type: 'session-advanced',
        latestUserSeq: latestUserSeq(value.session),
      })
      delivery = result.state
      if (result.send !== null) completeDelivery(result.send)
    })
  }

  function reconcile(): InjectionResult {
    const value = current()
    const nextScope = scopeOf(value)
    if (initialized && nextScope !== activeScope) {
      commentsByScope.set(activeScope, comments)
      const oldOccurrence = watchedInput === undefined
        ? undefined
        : occurrence(watchedInput.state.getSnapshot())
      if (watchedInput !== undefined && oldOccurrence !== undefined) {
        mutating = true
        try { removeOccurrence(watchedInput, oldOccurrence) } finally { mutating = false }
      }
      comments = commentsByScope.get(nextScope) ?? new Map()
      resetDelivery()
    } else if (!initialized) {
      comments = commentsByScope.get(nextScope) ?? comments
    }
    initialized = true
    activeScope = nextScope
    watch(value)
    if (value === null) return 'unavailable'

    const existing = occurrence(value.input.state.getSnapshot())
    if (delivery.phase === DeliveryPhase.Pending
      && delivery.pending.input === value.input && existing === undefined
      && value.input.state.getSnapshot().draft === '') return 'inserted'
    if (comments.size === 0) {
      if (existing !== undefined) {
        mutating = true
        try { removeOccurrence(value.input, existing) } finally { mutating = false }
      }
      return 'inserted'
    }
    if (existing?.label === label()) return 'inserted'

    mutating = true
    try {
      if (existing !== undefined) removeOccurrence(value.input, existing)
      return insertOccurrence(value) ? 'inserted' : 'unavailable'
    } finally {
      mutating = false
    }
  }

  const unregister = inputTriggers.registerSource(source)
  const stopSessions = sessions.list.subscribe(() => { reconcile() })

  return {
    addComment(text, id, nextBranch) {
      if (branch !== nextBranch) {
        branch = nextBranch
        reconcile()
      }
      comments.set(id, text)
      return reconcile()
    },
    appendText(text) {
      const value = current()
      if (value === null) return 'unavailable'
      const state = value.input.state.getSnapshot()
      value.input.setDraft(state.draft === '' ? text : `${state.draft}\n\n${text}`)
      return 'inserted'
    },
    removeComment(id) {
      let removed = comments.delete(id)
      for (const scoped of commentsByScope.values()) removed = scoped.delete(id) || removed
      if (removed) reconcile()
    },
    setScope(nextBranch) {
      const normalized = nextBranch?.trim() || null
      if (normalized === branch) return
      branch = normalized
      reconcile()
    },
    dispose() {
      stopSessions()
      stopInput?.()
      stopSession?.()
      unregister()
      const value = current()
      if (value !== null) {
        const item = occurrence(value.input.state.getSnapshot())
        if (item !== undefined) removeOccurrence(value.input, item)
      }
    },
  }
}

export class ReviewCommentsService {
  private comments: ReviewComment[] = []
  private readonly listeners = new Set<() => void>()
  private readonly bridge: ComposerBridge
  private readonly seededScopes = new Set<string>()
  private readonly persistence: ReviewCommentsPersistence

  constructor(
    sessions: ReviewSessionsService,
    inputTriggers: ReviewInputTriggersService,
    persistence: ReviewCommentsPersistence = domainPersistence,
  ) {
    this.persistence = persistence
    this.bridge = createComposerBridge(
      sessions,
      inputTriggers,
      ids => { this.removeMany(ids, false) },
    )
  }

  /** Hydrate the review comments (call at bootstrap, after the one-time
   *  legacy migration). Idempotent. */
  async start(): Promise<void> {
    try {
      const persisted = await this.persistence.load()
      // Union with additions that landed while the async load was in flight,
      // instead of letting the persisted snapshot replace them wholesale.
      const known = new Set(persisted.map(comment => comment.id))
      this.comments = [
        ...this.comments.filter(comment => !known.has(comment.id)),
        ...persisted,
      ].slice(-MAX_PERSISTED_COMMENTS)
      this.publish({ persist: false })
    } catch (error) {
      // Domain down: keep whatever memory holds and never publish an empty
      // list over it; a later start()/mutation retries persistence.
      console.warn('[sidebar] failed to load review comments', error)
    }
  }

  getSnapshot = (): readonly ReviewComment[] => this.comments

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Append raw text into the ACTIVE composer draft (the selection →
   * "add to conversation" channel). Returns 'unavailable' when the current
   * session has no reachable composer input.
   */
  appendToComposer(text: string): 'inserted' | 'unavailable' {
    return this.bridge.appendText(text)
  }

  private activeBranch: string | null = null

  activate(workspacePath: string, branch: string): void {
    this.activeBranch = branch
    this.bridge.setScope(branch)
    const scope = `${workspacePath}\0${branch}`
    if (this.seededScopes.has(scope)) return
    this.seededScopes.add(scope)
    for (const comment of this.comments) {
      if (comment.resolvedAt !== undefined) continue
      if (comment.workspacePath === workspacePath && comment.branch === branch) {
        this.bridge.addComment(comment.request, comment.id, branch)
      }
    }
  }

  add(commit: GitReviewCommit, comment: ReviewCommentDraft): InjectionResult {
    const stored: ReviewComment = { ...comment, request: '' }
    stored.request = formatReviewComment(commit, stored)
    this.comments = [...this.comments, stored].slice(-MAX_PERSISTED_COMMENTS)
    this.publish()
    return this.bridge.addComment(stored.request, stored.id, stored.branch)
  }

  remove(id: string): void {
    this.bridge.removeComment(id)
    this.removeMany([id], false)
  }

  /** Mark a comment resolved: kept and listed, but never delivered again. */
  resolve(id: string): void {
    this.bridge.removeComment(id)
    this.mutate(id, comment => ({ ...comment, resolvedAt: new Date().toISOString() }))
  }

  /** Re-open a resolved comment (re-injects it for the active branch). */
  unresolve(id: string): void {
    let restored: ReviewComment | undefined
    this.mutate(id, comment => {
      restored = { ...comment }
      delete restored.resolvedAt
      return restored
    })
    if (restored !== undefined && restored.branch === this.activeBranch) {
      this.bridge.addComment(restored.request, restored.id, restored.branch)
    }
  }

  dispose(): void {
    this.bridge.dispose()
    this.listeners.clear()
  }

  private removeMany(ids: readonly string[], removeFromBridge: boolean): void {
    if (removeFromBridge) for (const id of ids) this.bridge.removeComment(id)
    const idSet = new Set(ids)
    const next = this.comments.filter(comment => !idSet.has(comment.id))
    if (next.length === this.comments.length) return
    this.comments = next
    this.publish()
  }

  private mutate(
    id: string,
    transform: (comment: ReviewComment) => ReviewComment,
  ): void {
    let changed = false
    this.comments = this.comments.map(comment => {
      if (comment.id !== id) return comment
      changed = true
      return transform(comment)
    })
    if (changed) this.publish()
  }

  private publish(options?: { persist?: boolean }): void {
    if (options?.persist !== false) this.persistence.save(this.comments)
    for (const listener of this.listeners) listener()
  }
}

export function nextReviewCommentId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `review-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
}
