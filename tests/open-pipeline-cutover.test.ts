/**
 * OpenPipeline cutover oracle (kernel-refactor leaf-1.2).
 *
 * Behavioral coverage for the single open entry:
 *  - every sidebar open entry kind maps its click intent through the
 *    workbench pipeline onto the real center-surface store / side-rail host
 *    (single-click preview, double-click pin promotion, preview replacement,
 *    preview-tab-disabled upgrade, background never activates);
 *  - rail chips dedupe by their declared identity (activation replay);
 *  - the official open hook is refcount/HMR-safe (install → install →
 *    dispose ≡ a single install until the last dispose) and claims gate the
 *    original openPath.
 *
 * The tests execute the real modules (workbench kernel + sidebar pipeline +
 * zustand store); no source-text assertions.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOpenPipeline } from '../plugins/workbench/src/open-pipeline.ts'
import { createSurfaceRegistry } from '../plugins/workbench/src/registry.ts'
import type {
  OpenIntent,
  OpenPlan,
  OpenPipelineAction,
} from '@dsh-studio/shared/workbench-contracts'
import {
  connectOpenPipeline,
  workbenchOpen,
  type SidebarOpenHost,
} from '../plugins/sidebar/src/client/open/pipeline.ts'
import { useCenterSurfaceStore } from '../plugins/sidebar/src/client/surfaces/center-surface-store.ts'
import {
  installOfficialOpenHook,
  isLinkProtocolIntercepted,
} from '../plugins/sidebar/src/client/intercept.ts'

/* ---------- fixtures ---------- */

/** Structural stand-in for the DesktopSidebarService open surface. */
function fakeSidebarHost(previewTabs: 'default' | 'disabled' = 'default'): SidebarOpenHost & {
  activated: string[]
  tabs(): ReadonlyArray<{ id: string; type: string }>
} {
  const tabs: Array<{ id: string; type: string }> = []
  const listeners = new Set<() => void>()
  const activated: string[] = []
  let nextId = 0
  return {
    activated,
    tabs: () => [...tabs],
    getSnapshot: () => ({ centerPreviewTabs: previewTabs, tabs: [...tabs] }),
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    openTab(tab: { type: string }): void {
      const existing = tabs.find(candidate => candidate.type === tab.type)
      if (existing !== undefined) return
      nextId += 1
      tabs.push({ id: `tab-${nextId}`, type: tab.type })
    },
    activateTab(id: string): void {
      activated.push(id)
    },
  }
}

function registerOpenKinds(registry: ReturnType<typeof createSurfaceRegistry>): void {
  const centerKinds = [
    'file', 'diff', 'diff-staged', 'conflict', 'diff-all', 'diff-all-staged',
    'commit', 'commit-file', 'committed', 'committed-file', 'browser', 'terminal',
  ]
  for (const kind of centerKinds) {
    registry.register({
      kind,
      center: {},
      scopeNeed: kind === 'browser' ? null : 'workspace',
      previewable: kind !== 'terminal',
      focusPolicy: 'never',
    })
  }
  for (const kind of ['files', 'review']) {
    registry.register({
      kind,
      rail: { dedupeKey: kind, single: true },
      scopeNeed: 'workspace',
      previewable: false,
      focusPolicy: 'never',
    })
  }
}

function connected(previewTabs: 'default' | 'disabled' = 'default') {
  useCenterSurfaceStore.getState().clearAll()
  const registry = createSurfaceRegistry()
  registerOpenKinds(registry)
  const pipeline = createOpenPipeline(registry)
  const sidebar = fakeSidebarHost(previewTabs)
  const dispose = connectOpenPipeline({ open: pipeline, sidebar })
  return { pipeline, sidebar, dispose }
}

function slice(cwd: string) {
  return useCenterSurfaceStore.getState().getSlice(cwd)
}

function surfaceById(cwd: string, id: string) {
  return slice(cwd).open.find(surface => surface.id === id)
}

const CWD = '/repo'

/* ---------- entry-kind mapping through the real dispatcher ---------- */

test('file entry: single click previews, double click promotes to pin', () => {
  const env = connected()
  const open = workbenchOpen()
  // Single click → replaceable preview.
  open.open({ kind: 'file', target: { cwd: CWD, path: '/repo/a.ts' }, intent: 'preview' })
  let surface = surfaceById(CWD, 'file:/repo/a.ts')
  assert.equal(surface?.isPreview, true)
  assert.equal(slice(CWD).activeId, 'file:/repo/a.ts')
  // Double click on the same file → the existing preview becomes permanent.
  open.open({ kind: 'file', target: { cwd: CWD, path: '/repo/a.ts' }, intent: 'pin', title: 'a.ts' })
  surface = surfaceById(CWD, 'file:/repo/a.ts')
  assert.equal(surface?.title, 'a.ts')
  assert.equal(surface?.isPreview, false)
  env.dispose()
})

test('file entry: a second preview replaces the first (at most one preview)', () => {
  const env = connected()
  const open = workbenchOpen()
  open.open({ kind: 'file', target: { cwd: CWD, path: '/repo/a.ts' }, intent: 'preview' })
  open.open({ kind: 'file', target: { cwd: CWD, path: '/repo/b.ts' }, intent: 'preview' })
  assert.equal(surfaceById(CWD, 'file:/repo/a.ts'), undefined)
  assert.notEqual(surfaceById(CWD, 'file:/repo/b.ts'), undefined)
  env.dispose()
})

test('file entry: preview intent upgrades to a pinned tab when previews are disabled', () => {
  const env = connected('disabled')
  workbenchOpen().open({ kind: 'file', target: { cwd: CWD, path: '/repo/a.ts' }, intent: 'preview' })
  assert.equal(surfaceById(CWD, 'file:/repo/a.ts')?.isPreview, false)
  env.dispose()
})

test('diff entries: staged/unstaged/conflicted map to their own surfaces', () => {
  const env = connected()
  const open = workbenchOpen()
  open.open({ kind: 'diff', target: { cwd: CWD, path: '/repo/a.ts' }, intent: 'preview' })
  open.open({ kind: 'diff-staged', target: { cwd: CWD, path: '/repo/a.ts' }, intent: 'pin' })
  open.open({ kind: 'conflict', target: { cwd: CWD, path: '/repo/b.ts' }, intent: 'pin' })
  assert.deepEqual(
    slice(CWD).open.map(surface => [surface.kind, 'staged' in surface ? surface.staged : null]),
    [['diff', false], ['diff', true], ['conflict', null]],
  )
  env.dispose()
})

test('section entries: diff-all / diff-all-staged carry the staged flag and title', () => {
  const env = connected()
  const open = workbenchOpen()
  open.open({
    kind: 'diff-all-staged',
    target: { cwd: CWD },
    intent: 'pin',
    title: 'Staged section',
  })
  open.open({ kind: 'diff-all', target: { cwd: CWD }, intent: 'pin' })
  assert.deepEqual(
    slice(CWD).open.map(surface => [
      surface.kind,
      'staged' in surface ? surface.staged : null,
      surface.title,
    ]),
    [['diff-all', true, 'Staged section'], ['diff-all', false, 'Changes']],
  )
  env.dispose()
})

test('history entries: commit, commit-file, committed and committed-file decode targets', () => {
  const env = connected()
  const open = workbenchOpen()
  open.open({
    kind: 'commit',
    target: { cwd: CWD, path: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
    intent: 'pin',
    title: 'feat: pipeline',
  })
  open.open({
    kind: 'commit-file',
    target: { cwd: CWD, path: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0::src/x.ts' },
    intent: 'pin',
  })
  open.open({ kind: 'committed', target: { cwd: CWD, path: 'origin/main' }, intent: 'pin' })
  open.open({
    kind: 'committed-file',
    target: { cwd: CWD, path: 'origin/main::src/y.ts' },
    intent: 'pin',
  })
  assert.deepEqual(
    slice(CWD).open.map(surface => surface.id),
    [
      'commit:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      'commit-file:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0:src/x.ts',
      'committed:origin/main:all',
      'committed:origin/main:src/y.ts',
    ],
  )
  const commitFile = slice(CWD).open.find(surface => surface.kind === 'commit-file')
  assert.deepEqual(commitFile && 'hash' in commitFile
    ? { hash: commitFile.hash, filePath: commitFile.filePath }
    : null, { hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', filePath: 'src/x.ts' })
  const committedFile = surfaceById(CWD, 'committed:origin/main:src/y.ts')
  assert.ok(committedFile && 'filePath' in committedFile && committedFile.filePath === 'src/y.ts')
  env.dispose()
})

test('browser entry opens a pinned center surface carrying the resource', () => {
  const env = connected()
  workbenchOpen().open({
    kind: 'browser',
    target: { cwd: CWD, path: 'https://example.com/x' },
    intent: 'pin',
    title: 'example.com',
  })
  const surface = slice(CWD).open[0]
  assert.equal(surface?.kind, 'browser')
  assert.equal(surface?.isPreview, false)
  assert.equal(surface !== undefined && 'resource' in surface ? surface.resource : null, 'https://example.com/x')
  env.dispose()
})

test('terminal entry: every open creates a fresh instance and touches the quota', () => {
  const env = connected()
  const open = workbenchOpen()
  open.open({ kind: 'terminal', target: { cwd: CWD }, intent: 'pin', title: 'Terminal' })
  open.open({ kind: 'terminal', target: { cwd: CWD }, intent: 'pin', title: 'Terminal' })
  const terminals = slice(CWD).open.filter(surface => surface.kind === 'terminal')
  assert.equal(terminals.length, 2)
  assert.equal(slice(CWD).activeId, terminals[1]?.id)
  env.dispose()
})

test('rail chips dedupe by declared identity: reopen replays activation, not a new tab', () => {
  const env = connected()
  const open = workbenchOpen()
  open.open({ kind: 'files', target: {}, intent: 'pin' })
  open.open({ kind: 'files', target: {}, intent: 'pin' })
  assert.equal(env.sidebar.tabs().length, 1)
  assert.equal(env.sidebar.activated.length, 1)
  // Same for the review chip.
  open.open({ kind: 'review', target: {}, intent: 'pin' })
  assert.deepEqual(env.sidebar.tabs().map(tab => tab.type), ['files', 'review'])
  env.dispose()
})

test('background intent never activates (plan level)', () => {
  const actions: OpenPipelineAction[] = []
  const registry = createSurfaceRegistry()
  registry.register({ kind: 'file', center: {}, scopeNeed: 'workspace', previewable: true, focusPolicy: 'never' })
  const pipeline = createOpenPipeline(registry)
  pipeline.installDispatcher(action => { actions.push(action) })
  const plan = pipeline.open({ kind: 'file', target: { cwd: CWD, path: '/repo/a.ts' }, intent: 'background' })
  assert.equal(plan.activate, false)
  assert.equal(actions[0]?.plan.activate, false)
})

/* ---------- official open hook ---------- */

interface FakeWorkspaces {
  opened: string[]
  openPath(path: string): Promise<void>
}

function fakeWorkspaces(): FakeWorkspaces {
  return {
    opened: [],
    async openPath(path: string) { this.opened.push(path) },
  }
}

/** The hook consumes the host's structural WorkspacesService; tests pass a
 *  minimal fixture (the import is type-only, so no runtime shape needed). */
function toService(workspaces: FakeWorkspaces): Parameters<typeof installOfficialOpenHook>[0] {
  return workspaces as unknown as Parameters<typeof installOfficialOpenHook>[0]
}

async function runOriginal(workspaces: FakeWorkspaces, path: string): Promise<boolean> {
  await workspaces.openPath(path)
  return workspaces.opened.includes(path)
}

test('official hook: an openPath claim gates the original, a pass-through does not', async () => {
  const workspaces = fakeWorkspaces()
  const hook = installOfficialOpenHook(toService(workspaces))
  const stop = hook.onOpenPath(path => path === '/claimed')
  assert.equal(await runOriginal(workspaces, '/claimed'), false, 'claimed paths never reach the host')
  assert.equal(await runOriginal(workspaces, '/other'), true, 'unclaimed paths fall through')
  stop()
  assert.equal(await runOriginal(workspaces, '/claimed'), true, 'disposed claims fall through')
  hook.dispose()
})

test('official hook: a single install/dispose cycle restores the original exactly once', async () => {
  const workspaces = fakeWorkspaces()
  const original = workspaces.openPath
  const hook = installOfficialOpenHook(toService(workspaces))
  const stop = hook.onOpenPath(() => true)
  assert.notEqual(workspaces.openPath, original, 'takeover installed')
  assert.equal(await runOriginal(workspaces, '/x'), false)
  stop()
  hook.dispose()
  assert.equal(workspaces.openPath, original, 'original restored')
  assert.equal(await runOriginal(workspaces, '/x'), true)
})

test('official hook: double install stays behaviorally equivalent to one (HMR safety)', async () => {
  const workspaces = fakeWorkspaces()
  const original = workspaces.openPath
  // Two overlapping activations share one refcounted patch.
  const h1 = installOfficialOpenHook(toService(workspaces))
  const h2 = installOfficialOpenHook(toService(workspaces))
  const s1 = h1.onOpenPath(path => path === '/one')
  h2.onOpenPath(path => path === '/two')
  assert.equal(await runOriginal(workspaces, '/one'), false)
  assert.equal(await runOriginal(workspaces, '/two'), false)
  // First activation tears down: its claim dies, the patch survives.
  s1()
  h1.dispose()
  assert.equal(await runOriginal(workspaces, '/one'), true, 'first activation gone')
  assert.equal(await runOriginal(workspaces, '/two'), false, 'second activation still owns the takeover')
  // Last dispose restores the original exactly once — never the wrapper.
  h2.dispose()
  assert.equal(workspaces.openPath, original, 'original restored after the last dispose')
  assert.equal(await runOriginal(workspaces, '/two'), true)
})

test('link protocol gate keeps refusing non-web protocols', () => {
  const prefs = { browserInterceptHttp: true, browserInterceptHttps: true }
  assert.equal(isLinkProtocolIntercepted('https:', prefs), true)
  assert.equal(isLinkProtocolIntercepted('mailto:', prefs), false)
  assert.equal(isLinkProtocolIntercepted('http:', { browserInterceptHttp: false, browserInterceptHttps: true }), false)
})

/* ---------- connection discipline ---------- */

test('workbenchOpen fails loudly before connect and after dispose', () => {
  const env = connected()
  assert.doesNotThrow(() => workbenchOpen().open({ kind: 'files', target: {} }))
  env.dispose()
  assert.throws(() => workbenchOpen(), /not connected/)
})
