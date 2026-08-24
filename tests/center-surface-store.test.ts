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
  currentConversationSyncAction,
  resolveCenterWorkspace,
  retainConversationSurface,
} from '../plugins/sidebar/src/client/surfaces/center-surface-sync.ts'
import {
  conversationSurfaceId,
  isPreviewSurface,
  resolveActiveSurface,
} from '../plugins/sidebar/src/client/surfaces/types.ts'
import {
  mergePayloads,
  sanitizePersistedCenterSurfaces,
} from '../plugins/sidebar/src/client/surfaces/center-surface-persistence.ts'

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

test('center workspace resolves once the cwd is known, blank or not', () => {
  // Blank without a cwd: the host frame has not landed yet — pending.
  assert.deepEqual(resolveCenterWorkspace({ current: 's-1', byId: { 's-1': { blank: true } } }), {
    status: 'pending',
    sessionId: 's-1',
  })
  // Blank WITH a cwd (host session-added carries it): ready — the workspace
  // tabs must stay listed on the new-conversation page instead of vanishing.
  assert.deepEqual(resolveCenterWorkspace({ current: 's-1', byId: { 's-1': { blank: true, cwd: '/ws' } } }), {
    status: 'ready',
    cwd: '/ws',
    sessionId: 's-1',
    summary: { blank: true, cwd: '/ws' },
  })
  assert.deepEqual(resolveCenterWorkspace({ current: 's-1', byId: { 's-1': { cwd: '/ws' } } }), {
    status: 'ready',
    cwd: '/ws',
    sessionId: 's-1',
    summary: { cwd: '/ws' },
  })
  assert.deepEqual(resolveCenterWorkspace({ byId: {} }), { status: 'none' })
})

test('a blank current session never opens a conversation tab; materializing opens it', () => {
  const blank = { status: 'ready' as const, cwd: '/ws', sessionId: 's-new', summary: { blank: true, cwd: '/ws' } }
  // Navigating to the new-conversation placeholder: no tab, no activate.
  assert.equal(currentConversationSyncAction({
    current: blank,
    previous: undefined,
    queueKnown: false,
    currentTabOpen: false,
    activeSurfaceExists: false,
  }), 'none')
  assert.equal(currentConversationSyncAction({
    current: blank,
    previous: { status: 'ready' as const, cwd: '/ws', sessionId: 's-old', summary: { cwd: '/ws' } },
    queueKnown: true,
    currentTabOpen: false,
    activeSurfaceExists: true,
  }), 'none')
  // Still blank on a later snapshot (same session): still none.
  assert.equal(currentConversationSyncAction({
    current: blank,
    previous: blank,
    queueKnown: true,
    currentTabOpen: false,
    activeSurfaceExists: false,
  }), 'none')
  // The first sent message materializes it (same id, blank flips false):
  // the conversation becomes a real tab now.
  assert.equal(currentConversationSyncAction({
    current: { status: 'ready' as const, cwd: '/ws', sessionId: 's-new', summary: { cwd: '/ws' } },
    previous: blank,
    queueKnown: true,
    currentTabOpen: false,
    activeSurfaceExists: false,
  }), 'open')
})

test('new project waits for materialization before seeding its first tab', () => {
  const provisional = resolveCenterWorkspace({
    current: 's-new',
    byId: { 's-new': { blank: true } },
  })
  assert.equal(provisional.status, 'pending')
  const materialized = resolveCenterWorkspace({
    current: 's-new',
    byId: { 's-new': { cwd: '/new-project', blank: false } },
  })
  assert.equal(materialized.status, 'ready')
  if (materialized.status !== 'ready') throw new Error('expected materialized workspace')
  assert.equal(currentConversationSyncAction({
    current: materialized,
    previous: undefined,
    queueKnown: false,
    currentTabOpen: false,
    activeSurfaceExists: false,
  }), 'open')
})

test('incomplete session snapshots do not prune an existing conversation tab', () => {
  assert.equal(retainConversationSurface({
    cwd: '/ws',
    sessionId: 's-1',
    list: { byId: { 's-1': { blank: true } } },
  }), true)
  assert.equal(retainConversationSurface({
    cwd: '/ws',
    sessionId: 's-1',
    list: { byId: { 's-1': {} } },
  }), true)
  assert.equal(retainConversationSurface({
    cwd: '/ws',
    sessionId: 's-1',
    list: { byId: { 's-1': { cwd: '/other' } } },
  }), false)
  assert.equal(retainConversationSurface({ cwd: '/ws', sessionId: 's-1', list: { byId: {} } }), false)
})

test('center sync seeds only unknown queues and handles same-project navigation', () => {
  const current = { status: 'ready' as const, cwd: '/ws', sessionId: 's-1', summary: { cwd: '/ws' } }
  assert.equal(currentConversationSyncAction({
    current,
    previous: undefined,
    queueKnown: false,
    currentTabOpen: false,
    activeSurfaceExists: false,
  }), 'open')
  assert.equal(currentConversationSyncAction({
    current: { ...current, sessionId: 's-2' },
    previous: current,
    queueKnown: true,
    currentTabOpen: false,
    activeSurfaceExists: true,
  }), 'open')
  assert.equal(currentConversationSyncAction({
    current: { ...current, sessionId: 's-2' },
    previous: current,
    queueKnown: true,
    currentTabOpen: true,
    activeSurfaceExists: true,
  }), 'activate')
  assert.equal(currentConversationSyncAction({
    current,
    previous: current,
    queueKnown: true,
    currentTabOpen: false,
    activeSurfaceExists: false,
  }), 'none')
  assert.equal(currentConversationSyncAction({
    current,
    previous: { ...current, cwd: '/other', sessionId: 's-other' },
    queueKnown: true,
    currentTabOpen: false,
    activeSurfaceExists: false,
  }), 'none')
  assert.equal(currentConversationSyncAction({
    current,
    previous: current,
    queueKnown: true,
    currentTabOpen: true,
    activeSurfaceExists: false,
  }), 'activate')
})

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
  store.updateSurfaceTitle(CWD, 'terminal:1', 'zsh — dsh-studio')
  const terminal = slice().open.find(surface => surface.id === 'terminal:1')
  assert.equal(terminal?.title, 'zsh — dsh-studio')
  assert.equal(terminal?.id, 'terminal:1')
})

test('known empty queues stay distinct from uninitialized queues', () => {
  reset()
  const store = useCenterSurfaceStore.getState()
  store.ensureCwd(CWD)
  store.activate(CWD, conversationSurfaceId('missing'))
  assert.deepEqual(slice(), { open: [], activeId: null })
  store.openConversation({ cwd: CWD, sessionId: 's-1', title: 's-1' })
  store.close(CWD, conversationSurfaceId('s-1'))
  assert.deepEqual(slice(), { open: [], activeId: null })
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

/* ── domain persistence (sanitize + hydrate-time merge) ─────────────── */

function persistedFile(id: string, filePath: string, title: string) {
  return {
    id,
    kind: 'file',
    cwd: CWD,
    filePath,
    title,
    closable: true,
    isPreview: false,
  } as const
}

test('persisted center surfaces drop malformed rows and dangling active ids', () => {
  const valid = persistedFile('file:/ws/a.ts', '/ws/a.ts', 'a.ts')
  const sanitized = sanitizePersistedCenterSurfaces({
    byCwd: {
      '': { open: [], activeId: null },                       // empty cwd dropped
      '/ws': {
        open: [
          valid,
          { kind: 'file', id: '', cwd: '/ws' },               // invalid base dropped
          { kind: 'browser', cwd: '/ws', id: 'b' },            // missing isPreview dropped
        ],
        activeId: 'missing',                                   // not in open → null
      },
      '/other': { open: 'not-an-array', activeId: 5 },         // whole slice dropped
    },
  })
  assert.deepEqual(sanitized, {
    byCwd: {
      '/ws': { open: [valid], activeId: null },
    },
  })
})

test('hydrate-time merge keeps surfaces opened during the domain read', () => {
  const storedA = persistedFile('file:/ws/a.ts', '/ws/a.ts', 'a.ts')
  const storedB = persistedFile('file:/ws/b.ts', '/ws/b.ts', 'b.ts')
  // The user opened c and re-titled b while the read was pending.
  const pendingC = persistedFile('file:/ws/c.ts', '/ws/c.ts', 'c.ts')
  const pendingB = { ...storedB, title: 'renamed' }

  const merged = mergePayloads(
    { byCwd: { '/ws': { open: [storedA, storedB], activeId: 'file:/ws/a.ts' } } },
    { byCwd: { '/ws': { open: [pendingB, pendingC], activeId: 'file:/ws/c.ts' } } },
  )

  assert.deepEqual(merged.byCwd['/ws']?.open.map(s => s.title), ['a.ts', 'renamed', 'c.ts'])
  // The pending selection wins when it survives the merge.
  assert.equal(merged.byCwd['/ws']?.activeId, 'file:/ws/c.ts')
  // A cwd known only from the pending side is adopted wholesale.
  const adopted = mergePayloads(
    { byCwd: {} },
    { byCwd: { '/fresh': { open: [pendingC], activeId: 'file:/ws/c.ts' } } },
  )
  assert.deepEqual(adopted.byCwd['/fresh']?.open, [pendingC])
  // A pending activeId that no longer exists falls back to the stored one.
  const fallback = mergePayloads(
    { byCwd: { '/ws': { open: [storedA], activeId: 'file:/ws/a.ts' } } },
    { byCwd: { '/ws': { open: [], activeId: 'file:/ws/gone' } } },
  )
  assert.equal(fallback.byCwd['/ws']?.activeId, 'file:/ws/a.ts')
})
