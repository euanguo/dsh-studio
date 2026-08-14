/**
 * Unit tests for the center surface store (preview/pin semantics).
 * Mirrors the reference project's center-surface-store tests.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  useCenterSurfaceStore,
} from '../plugins/desktop-sidebar/src/client/surfaces/center-surface-store.ts'
import {
  isPreviewSurface,
  resolveActiveSurface,
} from '../plugins/desktop-sidebar/src/client/surfaces/types.ts'

function openFile(path: string, preview: boolean): void {
  useCenterSurfaceStore.getState().openFile({ sessionId: 's1', cwd: '/ws', filePath: path, preview })
}

function openDiff(path: string, preview: boolean): void {
  useCenterSurfaceStore.getState().openDiff({ sessionId: 's1', cwd: '/ws', filePath: path, staged: false, preview })
}

function openConversation(id: string): void {
  useCenterSurfaceStore.getState().openConversation({ sessionId: id, cwd: '/ws', title: `session ${id}` })
}

function reset(): void {
  useCenterSurfaceStore.getState().clearAll()
}

test('single-click preview replaces the previous preview tab; double-click pins', () => {
  reset()
  openFile('/ws/a.ts', true) // single click → preview
  openFile('/ws/b.ts', true) // single click → replaces the preview
  let slice = useCenterSurfaceStore.getState().getSlice()
  assert.deepEqual(slice.open.map(s => s.title), ['b.ts'])
  assert.equal(slice.open[0]?.isPreview, true)

  openFile('/ws/b.ts', false) // double click → pins
  slice = useCenterSurfaceStore.getState().getSlice()
  assert.equal(slice.open[0]?.isPreview, false)

  openFile('/ws/c.ts', true) // preview replaces nothing (b is pinned now)
  slice = useCenterSurfaceStore.getState().getSlice()
  assert.deepEqual(slice.open.map(s => s.title), ['b.ts', 'c.ts'])
  assert.equal(slice.open[1]?.isPreview, true)
  assert.equal(slice.activeId, slice.open[1]?.id)
})

test('reopening an existing preview keeps it preview when single-clicked', () => {
  reset()
  openFile('/ws/a.ts', true)
  openFile('/ws/a.ts', true)
  const slice = useCenterSurfaceStore.getState().getSlice()
  assert.deepEqual(slice.open.map(s => s.title), ['a.ts'])
  assert.equal(slice.open[0]?.isPreview, true)
})

test('conversations are always pinned and can be open alongside previews', () => {
  reset()
  openConversation('s1')
  openFile('/ws/a.ts', true)
  openConversation('s2')
  const slice = useCenterSurfaceStore.getState().getSlice()
  assert.deepEqual(
    slice.open.map(s => [s.kind, s.isPreview]),
    [
      ['conversation', false],
      ['file', true],
      ['conversation', false],
    ],
  )
  assert.equal(slice.activeId, 'conversation:s2')
})

test('diff previews share the preview slot with files', () => {
  reset()
  openFile('/ws/a.ts', true)
  openDiff('/ws/b.ts', true)
  const slice = useCenterSurfaceStore.getState().getSlice()
  assert.deepEqual(slice.open.map(s => [s.kind, s.title]), [['diff', 'b.ts']])
})

test('close falls back to the last open tab; pin via store action', () => {
  reset()
  openFile('/ws/a.ts', false)
  openFile('/ws/b.ts', false)
  openFile('/ws/c.ts', false)
  const store = useCenterSurfaceStore.getState()
  store.close('file:/ws/c.ts')
  let slice = useCenterSurfaceStore.getState().getSlice()
  assert.equal(slice.activeId, 'file:/ws/b.ts')
  store.close('file:/ws/b.ts')
  slice = useCenterSurfaceStore.getState().getSlice()
  assert.equal(slice.activeId, 'file:/ws/a.ts')
})

test('isPreviewSurface / resolveActiveSurface helpers', () => {
  reset()
  openFile('/ws/a.ts', true)
  const slice = useCenterSurfaceStore.getState().getSlice()
  const active = resolveActiveSurface(slice)
  assert.ok(active !== null)
  assert.equal(isPreviewSurface(active), true)
  useCenterSurfaceStore.getState().pin(active.id)
  assert.equal(isPreviewSurface(resolveActiveSurface(useCenterSurfaceStore.getState().getSlice())!), false)
})

test('dismissSession / undismissSession are idempotent and persisted via the store', () => {
  reset()
  const store = useCenterSurfaceStore.getState()
  store.dismissSession('s-1')
  store.dismissSession('s-1')
  assert.deepEqual(useCenterSurfaceStore.getState().dismissedSessions, ['s-1'])
  store.undismissSession('s-2') // unknown id — no-op
  assert.deepEqual(useCenterSurfaceStore.getState().dismissedSessions, ['s-1'])
  store.undismissSession('s-1')
  assert.deepEqual(useCenterSurfaceStore.getState().dismissedSessions, [])
})

test('openConversation with activate:false joins without stealing activation', () => {
  reset()
  openFile('/ws/a.ts', false) // activeId = file:/ws/a.ts
  const store = useCenterSurfaceStore.getState()
  store.openConversation({ sessionId: 's2', cwd: '/ws', title: 's2', activate: false })
  const slice = useCenterSurfaceStore.getState().getSlice()
  assert.equal(slice.activeId, 'file:/ws/a.ts')
  assert.ok(slice.open.some(s => s.id === 'conversation:s2'))
  // The open gesture (activate: true default) then activates the tab.
  store.openConversation({ sessionId: 's2', cwd: '/ws', title: 's2' })
  assert.equal(useCenterSurfaceStore.getState().getSlice().activeId, 'conversation:s2')
})
