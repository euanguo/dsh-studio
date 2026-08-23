import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ReviewCommentsService,
  formatReviewComment,
  formatReviewRequest,
  nextReviewCommentId,
  type ReviewComment,
} from '../plugins/sidebar/src/client/review/review-comments.ts'
import type {
  ReviewSessionsService,
  ReviewInputTriggersService,
} from '../plugins/sidebar/src/client/review/review-comments.ts'
import type { GitReviewCommit } from '../plugins/sidebar/src/client/diff/git-review-diff.ts'

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

function fakeSessions(): ReviewSessionsService {
  return {
    list: {
      getSnapshot: () => ({ byId: {} }),
      subscribe: () => () => {},
    },
  }
}

/**
 * A tracking input-triggers stub that captures the slash source the service
 * registers, so tests can read `codec.clipboardText()` to see which comments
 * are currently seeded into the composer bridge.
 */
function trackingInputTriggers(): {
  triggers: ReviewInputTriggersService
  getSource(): ReviewSlashSource | undefined
} {
  let source: ReviewSlashSource | undefined
  return {
    getSource: () => source,
    triggers: {
      registerSource: (src: ReviewSlashSource) => {
        source = src
        return () => { source = undefined }
      },
    },
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: key => map.get(key) ?? null,
    key: index => [...map.keys()][index] ?? null,
    removeItem: key => { map.delete(key) },
    setItem: (key, value) => { map.set(key, value) },
  }
}

const COMMIT: GitReviewCommit = {
  id: 'abc123def',
  shortId: 'abc123d',
  subject: 'change something',
  files: [],
} as unknown as GitReviewCommit

function makeService(storage: Storage): {
  service: ReviewCommentsService
  comment: ReviewComment
} {
  const service = new ReviewCommentsService(fakeSessions(), {
    registerSource: () => () => {},
  }, storage)
  const draft = {
    id: nextReviewCommentId(),
    workspacePath: '/repo',
    branch: 'feature/x',
    commitId: COMMIT.id,
    filePath: 'src/a.ts',
    line: 12,
    side: 'new' as const,
    body: 'rename this variable',
    createdAt: new Date().toISOString(),
  }
  service.activate('/repo', 'feature/x')
  service.add(COMMIT, draft)
  const [comment] = service.getSnapshot()
  return { service, comment: comment! }
}

test('resolve keeps the comment listed and persisted but flagged', async () => {
  const storage = memoryStorage()
  const { service, comment } = makeService(storage)
  assert.equal(comment.resolvedAt, undefined)

  service.resolve(comment.id)
  const resolved = service.getSnapshot().find(item => item.id === comment.id)
  assert.ok(resolved?.resolvedAt !== undefined && resolved.resolvedAt !== '')

  // The resolution is durable.
  const reloaded = new ReviewCommentsService(fakeSessions(), {
    registerSource: () => () => {},
  }, storage)
  assert.ok(reloaded.getSnapshot().find(item => item.id === comment.id)?.resolvedAt)
})

test('unresolve clears the flag and re-injects on the active branch', async () => {
  const { service, comment } = makeService(memoryStorage())
  service.resolve(comment.id)
  service.unresolve(comment.id)
  const reopened = service.getSnapshot().find(item => item.id === comment.id)
  assert.equal(reopened?.resolvedAt, undefined)
})

test('formatReviewComment renders the anchored request body', () => {
  const storage = memoryStorage()
  const { comment } = makeService(storage)
  const text = formatReviewComment(COMMIT, comment)
  assert.match(text, /Repository: \/repo/)
  assert.match(text, /Branch: feature\/x/)
  assert.match(text, /Location: src\/a\.ts:R12/)
})

test('activate skips resolved comments when seeding a fresh scope', () => {
  // Shared storage so persisted comments survive across service instances.
  const shared = memoryStorage()

  // Phase 1: add two comments on the same branch, then resolve the first.
  const { triggers: triggers1 } = trackingInputTriggers()
  const svc1 = new ReviewCommentsService(fakeSessions(), triggers1, shared)
  svc1.activate('/repo', 'feature/x')
  const draftA = {
    id: nextReviewCommentId(),
    workspacePath: '/repo',
    branch: 'feature/x',
    commitId: COMMIT.id,
    filePath: 'src/a.ts',
    line: 12,
    side: 'new' as const,
    body: 'fix the typo',
    createdAt: new Date().toISOString(),
  }
  const draftB = {
    id: nextReviewCommentId(),
    workspacePath: '/repo',
    branch: 'feature/x',
    commitId: COMMIT.id,
    filePath: 'src/b.ts',
    line: 30,
    side: 'new' as const,
    body: 'rename this variable',
    createdAt: new Date().toISOString(),
  }
  svc1.add(COMMIT, draftA)
  svc1.add(COMMIT, draftB)
  const [commentA] = svc1.getSnapshot()
  assert.ok(commentA !== undefined)
  svc1.resolve(commentA.id)

  // Phase 2: a fresh service (empty seededScopes) re-reads from storage and
  // calls activate() for the same scope. Only the unresolved comment should
  // be seeded into the bridge; the resolved one must stay out.
  const { triggers: triggers2, getSource } = trackingInputTriggers()
  const svc2 = new ReviewCommentsService(fakeSessions(), triggers2, shared)
  svc2.activate('/repo', 'feature/x')

  const payload = getSource()?.codec.clipboardText() ?? ''
  assert.ok(payload.includes('rename this variable'), 'unresolved comment is seeded')
  assert.ok(!payload.includes('fix the typo'), 'resolved comment is NOT re-seeded')
})

test('formatReviewRequest formats an empty list as empty string', () => {
  assert.equal(formatReviewRequest([]), '')
  assert.ok(formatReviewRequest(['one comment']).includes('one comment'))
})
