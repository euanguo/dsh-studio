import type { GitReviewCommit } from '../diff/git-review-diff.ts'

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

interface ReviewSlashSource {
  trigger: '@'
  name: string
  order: number
  candidates(): Promise<readonly never[]>
  onPick(): undefined
  codec: {
    clipboardText(): string
    serialize(): Promise<string>
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

const STORAGE_KEY = 'dsh-studio.sidebar.review-comments.v1'
const REVIEW_SOURCE = 'dsh-studio-review'
const REVIEW_REF = 'review-comments'
const MAX_PERSISTED_COMMENTS = 200

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

function readComments(storage: Storage): ReviewComment[] {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter(isReviewComment).slice(-MAX_PERSISTED_COMMENTS)
      : []
  } catch {
    return []
  }
}

function writeComments(storage: Storage, comments: readonly ReviewComment[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(comments.slice(-MAX_PERSISTED_COMMENTS)))
  } catch {
    // Review stays available in memory when browser storage is unavailable.
  }
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
  let pending: {
    input: ReviewInput
    ids: readonly string[]
    baselineSeq: number
  } | undefined

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

  const completeDelivery = (): void => {
    if (pending === undefined) return
    const ids = pending.ids
    pending = undefined
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
      pending = undefined
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
      if (pending !== undefined && next.draft !== '') pending = undefined
      if (pending === undefined && previous !== undefined
        && occurrence(previous) !== undefined && occurrence(next) === undefined
        && next.draft === '' && comments.size > 0) {
        pending = {
          input: value.input,
          ids: [...comments.keys()],
          baselineSeq: latestUserSeq(value.session),
        }
      }
      reconcile()
    })
    stopSession = value.session?.subscribe(() => {
      if (pending !== undefined
        && latestUserSeq(value.session) > pending.baselineSeq) completeDelivery()
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
      pending = undefined
    } else if (!initialized) {
      comments = commentsByScope.get(nextScope) ?? comments
    }
    initialized = true
    activeScope = nextScope
    watch(value)
    if (value === null) return 'unavailable'

    const existing = occurrence(value.input.state.getSnapshot())
    if (pending?.input === value.input && existing === undefined
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
  private comments: ReviewComment[]
  private readonly listeners = new Set<() => void>()
  private readonly bridge: ComposerBridge
  private readonly seededScopes = new Set<string>()
  private readonly storage: Storage

  constructor(
    sessions: ReviewSessionsService,
    inputTriggers: ReviewInputTriggersService,
    storage: Storage,
  ) {
    this.storage = storage
    this.comments = readComments(storage)
    this.bridge = createComposerBridge(
      sessions,
      inputTriggers,
      ids => { this.removeMany(ids, false) },
    )
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

  private publish(): void {
    writeComments(this.storage, this.comments)
    for (const listener of this.listeners) listener()
  }
}

export function nextReviewCommentId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `review-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
}
