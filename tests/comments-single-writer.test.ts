/**
 * Comments single-writer regression tests (kernel-refactor leaf-1.4).
 *
 * Pins the baseline delivered by `1b75b96`/`1c88b8d` — one canonical owner
 * (`plugins/shared/comments-record.ts`), strict loads that never mistake a
 * transport failure for an empty table, and half-writes that always ride
 * the freshest other-half — and the leaf-1.4 additions: review rows
 * addressed as workspace×branch buckets, the read-time version migration
 * (v1 fold-in + Q4 cap) being idempotent, and the one-time legacy
 * localStorage key migration still landing through the real RPC seam
 * (stubbed `fetch`, exactly the wire the client uses).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  adoptCommentsRecord,
  commentsStorage,
  COMMENTS_RECORD_VERSION,
  groupReviewCommentsByScope,
  groupWorkbenchCommentsByScope,
  loadCommentsRecord,
  migratePersistedCommentsRecord,
  putReviewCommentsByScope,
  putWorkbenchComments,
  readCommentsRecord,
  reviewScopeKey,
  workbenchScopeKey,
} from '../plugins/shared/comments-record.ts'
import {
  COMMENTS_SANITIZE_LIMIT,
  defaultSidebarCommentsChrome,
  UI_CHROME_TABLES,
  sanitizeSidebarComments,
  type PersistedReviewComment,
  type PersistedWorkbenchComment,
} from '../plugins/shared/ui-chrome-tables.ts'
import { migrateLegacyCommentsIntoDomain } from '../plugins/shared/comments-migration.ts'
import { parseUiChromeValue } from '../plugins/capabilities/src/ui-chrome-schemas.ts'

/* ── fake host: the /capabilities/api wire ────────────────────────────── */

interface FakeRequest {
  method: string
  body: Record<string, unknown>
}

let stored: unknown = undefined
let requests: FakeRequest[] = []
let failTransport = false

function installFakeHost(): void {
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    if (failTransport) throw new Error('transport down')
    const url = String(input)
    const method = url.slice(url.lastIndexOf('/') + 1)
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
    requests.push({ method, body })
    if (method === 'ui-chrome.get') {
      // The route handler wraps its face result once more
      // (`{ value: record }`), so the wire envelope nests two levels.
      return {
        ok: true,
        json: async () => ({ ok: true, value: { value: structuredClone(stored) } }),
      }
    }
    if (method === 'ui-chrome.put') {
      stored = structuredClone(body.value)
      return { ok: true, json: async () => ({ ok: true, value: null }) }
    }
    return { ok: false, json: async () => ({ ok: false, error: { message: 'unknown' } }) }
  }) as typeof fetch
}

function workbenchComment(overrides: Partial<PersistedWorkbenchComment>): PersistedWorkbenchComment {
  return {
    id: 'wb-id',
    cwd: '/repo',
    path: '/repo/file.ts',
    startLine: 1,
    body: 'note',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function reviewComment(overrides: Partial<PersistedReviewComment>): PersistedReviewComment {
  return {
    id: 'rv-id',
    workspacePath: '/repo',
    branch: 'main',
    commitId: 'c0ffee',
    filePath: null,
    line: null,
    side: null,
    body: 'review note',
    createdAt: '2025-01-01T00:00:00Z',
    request: 'fix this',
    ...overrides,
  }
}

test('strict load throws on transport failure so callers never write defaults over the host', async () => {
  installFakeHost()
  failTransport = true
  await assert.rejects(loadCommentsRecord(), /unreachable/)
  failTransport = false
})

test('single writer: each half-write rides the freshest other-half instead of erasing it', async () => {
  stored = {
    workbench: [workbenchComment({ id: 'wb-1' })],
    review: [reviewComment({ id: 'rv-1' })],
  }
  // First successful load seeds the owner cache.
  const loaded = await loadCommentsRecord()
  assert.equal(loaded.workbench.length, 1)
  assert.equal(loaded.review.length, 1)

  await putWorkbenchComments([workbenchComment({ id: 'wb-2' })])
  await commentsStorage.flush()
  let saved = stored as { workbench: PersistedWorkbenchComment[]; review: PersistedReviewComment[] }
  assert.deepEqual(saved.workbench.map(c => c.id), ['wb-2'])
  // The review half survived the workbench write.
  assert.deepEqual(saved.review.map(c => c.id), ['rv-1'])

  await putReviewCommentsByScope(groupReviewCommentsByScope([
    reviewComment({ id: 'rv-2' }),
  ]))
  await commentsStorage.flush()
  saved = stored as typeof saved
  // And the workbench half survived the review write.
  assert.deepEqual(saved.workbench.map(c => c.id), ['wb-2'])
  assert.deepEqual(saved.review.map(c => c.id), ['rv-2'])
})

test('concurrent half-writes compose instead of racing to last-empty-writer', async () => {
  adoptCommentsRecord(defaultSidebarCommentsChrome())
  const first = putWorkbenchComments([workbenchComment({ id: 'wb-concurrent' })])
  const second = putReviewCommentsByScope(groupReviewCommentsByScope([
    reviewComment({ id: 'rv-concurrent' }),
  ]))
  await Promise.all([first, second])
  await commentsStorage.flush()
  const saved = readCommentsRecord()
  assert.deepEqual(saved.workbench.map(c => c.id), ['wb-concurrent'])
  assert.deepEqual(saved.review.map(c => c.id), ['rv-concurrent'])
  // The flushed host record carries BOTH halves.
  const persisted = stored as typeof saved
  assert.deepEqual(persisted.workbench.map(c => c.id), ['wb-concurrent'])
  assert.deepEqual(persisted.review.map(c => c.id), ['rv-concurrent'])
  assert.equal(COMMENTS_RECORD_VERSION >= 3, true)
})

test('review buckets are addressed by workspace×branch and preserve row order', () => {
  const groups = groupReviewCommentsByScope([
    reviewComment({ id: 'a', branch: 'main' }),
    reviewComment({ id: 'b', branch: 'feature' }),
    reviewComment({ id: 'c', branch: 'main' }),
  ])
  assert.deepEqual([...groups.keys()], [
    reviewScopeKey('/repo', 'main'),
    reviewScopeKey('/repo', 'feature'),
  ])
  assert.deepEqual(groups.get(reviewScopeKey('/repo', 'main'))?.map(c => c.id), ['a', 'c'])
  assert.deepEqual(groups.get(reviewScopeKey('/repo', 'feature'))?.map(c => c.id), ['b'])
})

test('workbench comments are addressed by cwd and legacy rows stay in an explicit bucket', () => {
  const groups = groupWorkbenchCommentsByScope([
    workbenchComment({ id: 'repo-a', cwd: '/repo/a' }),
    workbenchComment({ id: 'legacy', cwd: null }),
    workbenchComment({ id: 'repo-b', cwd: '/repo/b' }),
    workbenchComment({ id: 'repo-a-2', cwd: '/repo/a' }),
  ])
  assert.deepEqual([...groups.keys()], [
    workbenchScopeKey('/repo/a'),
    workbenchScopeKey(null),
    workbenchScopeKey('/repo/b'),
  ])
  assert.deepEqual(groups.get(workbenchScopeKey('/repo/a'))?.map(c => c.id), ['repo-a', 'repo-a-2'])
  assert.deepEqual(groups.get(workbenchScopeKey(null))?.map(c => c.id), ['legacy'])
})

test('the host comments schema accepts explicit cwd scope while retaining legacy rows', () => {
  const parsed = parseUiChromeValue(UI_CHROME_TABLES.comments, {
    workbench: [
      workbenchComment({ id: 'scoped', cwd: '/repo' }),
      { id: 'legacy', path: '/repo/old.ts', startLine: 2, body: 'old', createdAt: 't' },
    ],
    review: [],
  }) as { workbench: Array<{ cwd?: string | null }> }
  assert.equal(parsed.workbench[0]?.cwd, '/repo')
  assert.equal(parsed.workbench[1]?.cwd, undefined)
})

test('version migration: v1 field names fold forward, cwd scope is explicit, oversized records clamp to the Q4 cap, and migration is idempotent', () => {
  const legacyBlob = {
    workbench: [
      // v1 shape: filePath/line naming.
      { id: 'legacy-1', filePath: '/repo/old.ts', line: 7, body: 'old note', createdAt: '2024-01-01T00:00:00Z' },
      // Already-canonical entry passes through untouched.
      workbenchComment({ id: 'current-1' }),
    ],
    review: [reviewComment({ id: 'rv-mig' })],
  }
  const migrated = migratePersistedCommentsRecord(legacyBlob)
  assert.equal(migrated.workbench[0]?.path, '/repo/old.ts')
  assert.equal(migrated.workbench[0]?.startLine, 7)
  assert.equal(migrated.workbench[0]?.cwd, null)
  assert.equal(migrated.workbench[1]?.id, 'current-1')
  assert.deepEqual(migrated.review.map(c => c.id), ['rv-mig'])

  // Idempotence: migrating an already-migrated record is a fixpoint.
  assert.deepEqual(migratePersistedCommentsRecord(migrated), migrated)

  // The cap is the ONE shared constant and keeps the most RECENT rows.
  assert.equal(COMMENTS_SANITIZE_LIMIT, 200)
  const oversized = {
    workbench: Array.from({ length: 250 }, (_, i) =>
      workbenchComment({ id: `wb-${i}`, createdAt: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString() })),
    review: [],
  }
  const clamped = migratePersistedCommentsRecord(oversized)
  assert.equal(clamped.workbench.length, 200)
  assert.equal(clamped.workbench.at(0)?.id, 'wb-50')
  assert.equal(clamped.workbench.at(-1)?.id, 'wb-249')
  // The release sanitizer shares the same clamp (sanitizer = runtime cap).
  const sanitized = sanitizeSidebarComments(oversized)
  assert.equal(sanitized.workbench.length, 200)
})

test('legacy localStorage one-time read migration still lands in the comments table exactly once', async () => {
  stored = { workbench: [], review: [] } // empty domain table
  requests = []
  const legacyStore = new Map<string, string>([
    ['dsh-studio.sidebar.diff-comments.v2', JSON.stringify([
      { id: 'wb-legacy-v2', path: '/repo/a.ts', startLine: 3, body: 'v2 note', createdAt: '2024-02-02T00:00:00Z' },
    ])],
    ['dsh-studio.sidebar.diff-comments.v1', JSON.stringify([
      { id: 'wb-legacy-v1', filePath: '/repo/b.ts', line: 9, body: 'v1 note', createdAt: '2024-01-01T00:00:00Z' },
    ])],
    ['dsh-studio.sidebar.review-comments.v1', JSON.stringify([
      {
        id: 'rv-legacy',
        workspacePath: '/repo',
        branch: 'main',
        commitId: 'abc',
        filePath: null,
        line: null,
        side: null,
        body: 'old review',
        createdAt: '2024-03-03T00:00:00Z',
        request: 'please fix',
      },
    ])],
  ])
  globalThis.window = {
    localStorage: {
      getItem: (key: string) => legacyStore.get(key) ?? null,
    },
  } as unknown as typeof window

  try {
    await migrateLegacyCommentsIntoDomain()
    const puts = requests.filter(r => r.method === 'ui-chrome.put')
    assert.equal(puts.length, 1)
    const written = puts[0]!.body.value as { workbench: Array<{ id: string; cwd?: string | null }>; review: Array<{ id: string }> }
    // v2 wins over the older v1 blob it already folded in.
    assert.deepEqual(written.workbench.map(c => c.id), ['wb-legacy-v2'])
     assert.equal(written.workbench[0]?.cwd, null)
    assert.deepEqual(written.review.map(c => c.id), ['rv-legacy'])

    // Re-running is a no-op: the table now holds data, nothing is rewritten.
    requests = []
    await migrateLegacyCommentsIntoDomain()
    assert.equal(requests.filter(r => r.method === 'ui-chrome.put').length, 0)

    // An unreachable domain retries later instead of writing blind.
    stored = { workbench: [], review: [] }
    failTransport = true
    requests = []
    await migrateLegacyCommentsIntoDomain()
    assert.equal(requests.filter(r => r.method === 'ui-chrome.put').length, 0)
  } finally {
    failTransport = false
    delete (globalThis as { window?: unknown }).window
  }
})
