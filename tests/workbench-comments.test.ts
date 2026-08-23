import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  readWorkbenchComments,
  writeWorkbenchComments,
  type WorkbenchComment,
} from '../plugins/sidebar/src/client/diff/diff-comments-store.ts'

/** DOM-free Storage shim (the module reads/writes window.localStorage). */
const LEGACY = 'dsh-studio.sidebar.diff-comments.v1'
const KEY = 'dsh-studio.sidebar.diff-comments.v2'

function memoryStorage(): { storage: Storage; read(key: string): unknown } {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: key => map.get(key) ?? null,
    key: index => [...map.keys()][index] ?? null,
    removeItem: key => { map.delete(key) },
    setItem: (key, value) => { map.set(key, value) },
  }
  ;(globalThis as Record<string, unknown>).window = { localStorage: storage } as unknown as Window
  return { storage, read: key => { const raw = map.get(key); return raw === undefined ? null : JSON.parse(raw) } }
}

test('workbench comments migrate idempotently from the v1 line shape', () => {
  const { storage, read } = memoryStorage()
  storage.setItem(LEGACY, JSON.stringify([
    { id: 'a', filePath: 'src/a.ts', line: 12, body: 'watch the null check', createdAt: 't1' },
    { id: 'b', filePath: 'src/b.ts', line: 3, body: 'rename', createdAt: 't2' },
  ]))

  // First load migrates and writes v2…
  const first = readWorkbenchComments()
  assert.equal(first.length, 2)
  assert.deepEqual(
    { path: first[0]!.path, startLine: first[0]!.startLine, endLine: first[0]!.endLine },
    { path: 'src/a.ts', startLine: 12, endLine: undefined },
  )

  // …and a second load reads the migrated document (no duplicates).
  readWorkbenchComments()
  assert.equal((read(KEY) as WorkbenchComment[]).length, 2)
  // The legacy blob survives untouched as the audit trail.
  assert.ok(storage.getItem(LEGACY) !== null)
})

test('workbench comments persist the full v2 anchor + lifecycle fields', () => {
  const { storage, read } = memoryStorage()
  const comment: WorkbenchComment = {
    id: 'c1',
    path: 'src/a.ts',
    startLine: 10,
    endLine: 14,
    contentHash: 'sha256:abc',
    branch: 'feature/x',
    body: 'extract this block',
    createdAt: 't',
  }
  writeWorkbenchComments([comment])
  const stored = read(KEY) as WorkbenchComment[]
  assert.equal(stored.length, 1)
  assert.equal(stored[0]!.endLine, 14)
  assert.equal(stored[0]!.contentHash, 'sha256:abc')
  assert.equal(stored[0]!.branch, 'feature/x')
  assert.equal(stored[0]!.resolvedAt, undefined)
})

test('read tolerates malformed documents and falls back to migration', () => {
  const { storage } = memoryStorage()
  storage.setItem(KEY, '{not json')
  storage.setItem(LEGACY, JSON.stringify([
    { id: 'a', filePath: 'x.ts', line: 1, body: 'b', createdAt: 't' },
  ]))
  const comments = readWorkbenchComments()
  assert.equal(comments.length, 1)
  assert.equal(comments[0]!.path, 'x.ts')
})
