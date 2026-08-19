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
  conversationSurfaceId,
  isPreviewSurface,
  resolveActiveSurface,
} from '../plugins/sidebar/src/client/surfaces/types.ts'

const CWD = '/ws'

function openFile(path: string, preview: boolean): void {
  useCenterSurfaceStore.getState().openFile({ cwd: CWD, filePath: path, preview })
}

function openDiff(path: string, preview: boolean): void {
  useCenterSurfaceStore.getState().openDiff({ cwd: CWD, filePath: path, staged: false, preview })
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

test('closing a conversation removes its tab instead of archiving the session', () => {
  reset()
  const store = useCenterSurfaceStore.getState()
  store.openConversation({ sessionId: 's-1', cwd: CWD, title: 'session s-1' })
  assert.ok(slice().open.some(s => s.id === conversationSurfaceId('s-1')))
  // Closing the conversation tab removes it from the open set (the session
  // itself is never archived — only the tab record is dropped).
  store.close(CWD, conversationSurfaceId('s-1'))
  assert.equal(slice().open.some(s => s.id === conversationSurfaceId('s-1')), false)
  assert.equal(slice().activeId, null)
  // Reopening the same session creates a fresh tab (identity is not sticky).
  store.openConversation({ sessionId: 's-1', cwd: CWD, title: 'session s-1' })
  assert.ok(slice().open.some(s => s.id === conversationSurfaceId('s-1')))
})

test('a conversation surface keeps its sessionId as identity', () => {
  reset()
  const surface = useCenterSurfaceStore.getState().openConversation({
    sessionId: 's-1',
    cwd: CWD,
    title: 'session s-1',
  })
  assert.equal(surface.id, conversationSurfaceId('s-1'))
  assert.equal(surface.kind, 'conversation')
  assert.equal(surface.sessionId, 's-1')
  // The open-set record carries the same identity.
  const stored = slice().open.find(s => s.id === conversationSurfaceId('s-1'))
  assert.equal(stored?.kind, 'conversation')
  assert.equal(stored?.sessionId, 's-1')
})

test('terminal titles update the center tab without changing its identity', () => {
  reset()
  const store = useCenterSurfaceStore.getState()
  store.openTerminal({ cwd: CWD, title: '终端' })
  store.updateSurfaceTitle(CWD, 'terminal:1', 'zsh — oh-dsh')
  const terminal = slice().open.find(surface => surface.id === 'terminal:1')
  assert.equal(terminal?.title, 'zsh — oh-dsh')
  assert.equal(terminal?.id, 'terminal:1')
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
  useCenterSurfaceStore.getState().openFile({ cwd: '/other', filePath: '/other/x.ts', preview: false })
  const wsSlice = useCenterSurfaceStore.getState().getSlice(CWD)
  const otherSlice = useCenterSurfaceStore.getState().getSlice('/other')
  assert.deepEqual(wsSlice.open.map(s => s.title), ['a.ts'])
  assert.deepEqual(otherSlice.open.map(s => s.title), ['x.ts'])
  // Closing in one workspace leaves the other untouched.
  useCenterSurfaceStore.getState().close(CWD, 'file:/ws/a.ts')
  assert.deepEqual(useCenterSurfaceStore.getState().getSlice('/other').open.map(s => s.title), ['x.ts'])
})

test('moveSurface reorders open surfaces within a workspace queue (drag sort)', () => {
  reset()
  const store = useCenterSurfaceStore.getState()
  store.openFile({ cwd: CWD, filePath: '/ws/a.ts', preview: false })
  store.openFile({ cwd: CWD, filePath: '/ws/b.ts', preview: false })
  store.openFile({ cwd: CWD, filePath: '/ws/c.ts', preview: false })
  assert.deepEqual(slice().open.map(s => s.id), ['file:/ws/a.ts', 'file:/ws/b.ts', 'file:/ws/c.ts'])

  // Move first item to end
  store.moveSurface(CWD, 'file:/ws/a.ts', 2)
  assert.deepEqual(slice().open.map(s => s.id), ['file:/ws/b.ts', 'file:/ws/c.ts', 'file:/ws/a.ts'])

  // Move middle item to front
  store.moveSurface(CWD, 'file:/ws/c.ts', 0)
  assert.deepEqual(slice().open.map(s => s.id), ['file:/ws/c.ts', 'file:/ws/b.ts', 'file:/ws/a.ts'])

  // No-op for missing id / out of range
  store.moveSurface(CWD, 'nonexistent', 0)
  assert.deepEqual(slice().open.map(s => s.id), ['file:/ws/c.ts', 'file:/ws/b.ts', 'file:/ws/a.ts'])
})
