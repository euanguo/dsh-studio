/**
 * Unit tests for the center surface store (per-workspace preview/pin
 * semantics). Mirrors the reference project's center-surface-store tests.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  useCenterSurfaceStore,
} from '../plugins/sidebar/src/client/surfaces/center-surface-store.ts'
import {
  isPreviewSurface,
  resolveActiveSurface,
} from '../plugins/sidebar/src/client/surfaces/types.ts'

const CWD = '/ws'

function openFile(path: string, preview: boolean): void {
  useCenterSurfaceStore.getState().openFile({ sessionId: 's1', cwd: CWD, filePath: path, preview })
}

function openDiff(path: string, preview: boolean): void {
  useCenterSurfaceStore.getState().openDiff({ sessionId: 's1', cwd: CWD, filePath: path, staged: false, preview })
}

function openConversation(id: string): void {
  useCenterSurfaceStore.getState().openConversation({ sessionId: id, cwd: CWD, title: `session ${id}` })
}

function reset(): void {
  useCenterSurfaceStore.getState().clearAll()
}

function slice(): ReturnType<ReturnType<typeof useCenterSurfaceStore.getState>['getSlice']> {
  return useCenterSurfaceStore.getState().getSlice(CWD)
}

test('single-click preview replaces the previous preview tab; double-click pins', () => {
  reset()
  openFile('/ws/a.ts', true) // single click → preview
  openFile('/ws/b.ts', true) // single click → replaces the preview
  let current = slice()
  assert.deepEqual(current.open.map(s => s.title), ['b.ts'])
  assert.equal(current.open[0]?.isPreview, true)

  openFile('/ws/b.ts', false) // double click → pins
  current = slice()
  assert.equal(current.open[0]?.isPreview, false)

  openFile('/ws/c.ts', true) // preview replaces nothing (b is pinned now)
  current = slice()
  assert.deepEqual(current.open.map(s => s.title), ['b.ts', 'c.ts'])
  assert.equal(current.open[1]?.isPreview, true)
  assert.equal(current.activeId, current.open[1]?.id)
})

test('reopening an existing preview keeps it preview when single-clicked', () => {
  reset()
  openFile('/ws/a.ts', true)
  openFile('/ws/a.ts', true)
  const current = slice()
  assert.deepEqual(current.open.map(s => s.title), ['a.ts'])
  assert.equal(current.open[0]?.isPreview, true)
})

test('conversations are always pinned and can be open alongside previews', () => {
  reset()
  openConversation('s1')
  openFile('/ws/a.ts', true)
  openConversation('s2')
  const current = slice()
  assert.deepEqual(
    current.open.map(s => [s.kind, s.isPreview]),
    [
      ['conversation', false],
      ['file', true],
      ['conversation', false],
    ],
  )
  assert.equal(current.activeId, 'conversation:s2')
})

test('diff previews share the preview slot with files', () => {
  reset()
  openFile('/ws/a.ts', true)
  openDiff('/ws/b.ts', true)
  const current = slice()
  assert.deepEqual(current.open.map(s => [s.kind, s.title]), [['diff', 'b.ts']])
})

test('close falls back to the last open tab; pin via store action', () => {
  reset()
  openFile('/ws/a.ts', false)
  openFile('/ws/b.ts', false)
  openFile('/ws/c.ts', false)
  const store = useCenterSurfaceStore.getState()
  store.close(CWD, 'file:/ws/c.ts')
  let current = slice()
  assert.equal(current.activeId, 'file:/ws/b.ts')
  store.close(CWD, 'file:/ws/b.ts')
  current = slice()
  assert.equal(current.activeId, 'file:/ws/a.ts')
})

test('isPreviewSurface / resolveActiveSurface helpers', () => {
  reset()
  openFile('/ws/a.ts', true)
  const current = slice()
  const active = resolveActiveSurface(current)
  assert.ok(active !== null)
  assert.equal(isPreviewSurface(active), true)
  useCenterSurfaceStore.getState().pin(CWD, active.id)
  assert.equal(isPreviewSurface(resolveActiveSurface(slice())!), false)
})

test('dismissSession / undismissSession are idempotent per workspace', () => {
  reset()
  const store = useCenterSurfaceStore.getState()
  store.dismissSession(CWD, 's-1')
  store.dismissSession(CWD, 's-1')
  assert.deepEqual(useCenterSurfaceStore.getState().dismissedSessions[CWD], ['s-1'])
  store.undismissSession(CWD, 's-2') // unknown id — no-op
  assert.deepEqual(useCenterSurfaceStore.getState().dismissedSessions[CWD], ['s-1'])
  // Other workspaces keep their own dismissed sets.
  store.dismissSession('/other', 'x-9')
  assert.deepEqual(useCenterSurfaceStore.getState().dismissedSessions['/other'], ['x-9'])
  store.undismissSession(CWD, 's-1')
  assert.deepEqual(useCenterSurfaceStore.getState().dismissedSessions[CWD], undefined)
})

test('openConversation with activate:false joins without stealing activation', () => {
  reset()
  openFile('/ws/a.ts', false) // activeId = file:/ws/a.ts
  const store = useCenterSurfaceStore.getState()
  store.openConversation({ sessionId: 's2', cwd: CWD, title: 's2', activate: false })
  const current = slice()
  assert.equal(current.activeId, 'file:/ws/a.ts')
  assert.ok(current.open.some(s => s.id === 'conversation:s2'))
  // The open gesture (activate: true default) then activates the tab.
  store.openConversation({ sessionId: 's2', cwd: CWD, title: 's2' })
  assert.equal(slice().activeId, 'conversation:s2')
})

test('tab queues are isolated per workspace (cwd)', () => {
  reset()
  openFile('/ws/a.ts', false)
  useCenterSurfaceStore.getState().openFile({ sessionId: 's1', cwd: '/other', filePath: '/other/x.ts', preview: false })
  const wsSlice = useCenterSurfaceStore.getState().getSlice(CWD)
  const otherSlice = useCenterSurfaceStore.getState().getSlice('/other')
  assert.deepEqual(wsSlice.open.map(s => s.title), ['a.ts'])
  assert.deepEqual(otherSlice.open.map(s => s.title), ['x.ts'])
  // Closing in one workspace leaves the other untouched.
  useCenterSurfaceStore.getState().close(CWD, 'file:/ws/a.ts')
  assert.deepEqual(useCenterSurfaceStore.getState().getSlice('/other').open.map(s => s.title), ['x.ts'])
})
