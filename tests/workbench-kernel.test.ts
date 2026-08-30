/**
 * Workbench kernel skeleton behavior tests (kernel-refactor leaf-1.1).
 *
 * Exercises the four @dsh-studio/workbench services end to end through
 * their public factories AND the plugin entry's ctx wiring: registry
 * register/resolve/dedupe; open-pipeline plan routing, dedupe, and
 * dispatcher contract; layout claim/release/preview negotiation and the
 * z-index table; workspace/session event publication. Boundary assertions
 * pin that the kernel stays DOM/React-free and reachable only via ctx ids.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  LAYOUT_REGION_Z,
  type OpenPipelineAction,
  resolveSurfaceDedupeKey,
  type SurfaceDescriptor,
} from '../plugins/shared/contracts/workbench-contracts.ts'
import { apply } from '../plugins/workbench/src/client.ts'
import { createWorkspaceEvents } from '../plugins/workbench/src/events.ts'
import { createLayoutService } from '../plugins/workbench/src/layout.ts'
import { createOpenPipeline } from '../plugins/workbench/src/open-pipeline.ts'
import { createSurfaceRegistry } from '../plugins/workbench/src/registry.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function descriptor(overrides: Partial<SurfaceDescriptor>): SurfaceDescriptor {
  return {
    kind: 'file',
    center: {},
    scopeNeed: 'workspace',
    previewable: true,
    focusPolicy: 'never',
    ...overrides,
  }
}

/* ---------- SurfaceRegistry ---------- */

test('registry registers, resolves, and unregisters surface kinds', () => {
  const registry = createSurfaceRegistry()
  const file = descriptor({ kind: 'file' })
  registry.register(file)
  registry.register({
    kind: 'terminal',
    rail: {},
    scopeNeed: null,
    previewable: false,
    focusPolicy: 'never',
  })
  assert.deepEqual(registry.kinds(), ['file', 'terminal'])
  assert.equal(registry.resolve('file'), file)
  assert.equal(registry.resolve('missing'), undefined)
  assert.throws(() => registry.require('missing'), /unknown surface kind/)
  registry.unregister('file')
  assert.deepEqual(registry.kinds(), ['terminal'])
})

test('registry rejects duplicates and structurally invalid descriptors', () => {
  const registry = createSurfaceRegistry()
  registry.register(descriptor({ kind: 'diff' }))
  assert.throws(() => registry.register(descriptor({ kind: 'diff' })), /already registered/)
  assert.throws(() => registry.register(descriptor({ kind: '  ' })), /non-empty kind/)
  assert.throws(
    () =>
      registry.register(
        {
          kind: 'x',
          scopeNeed: null,
          previewable: false,
          focusPolicy: 'never',
        },
      ),
    /rail, center or viewer spec/,
  )
  // Rail surfaces are permanent by adjudication — never previewable.
  assert.throws(
    () =>
      registry.register({
        kind: 'x',
        rail: {},
        scopeNeed: 'workspace',
        previewable: true,
        focusPolicy: 'never',
      }),
    /cannot be previewable/,
  )
  // A viewer-only descriptor is valid: file hosts can render it without a
  // center tab, and the same registry still owns its routing metadata.
  const viewerOnly = {
    kind: 'x',
    viewer: { exts: ['.md'] },
    scopeNeed: null,
    previewable: false,
    focusPolicy: 'never' as const,
  }
  registry.register(viewerOnly)
  assert.equal(registry.resolve('x'), viewerOnly)
})

test('registry dedupe lookup honors explicit keys and registration returns a disposer', () => {
  const registry = createSurfaceRegistry()
  const unregister = registry.register(
    descriptor({ kind: 'browser', rail: { dedupeKey: 'browser-chip' }, previewable: false }),
  )
  assert.equal(registry.findByDedupeKey('browser-chip')?.kind, 'browser')
  assert.equal(registry.findByDedupeKey('nope'), undefined)
  unregister()
  assert.deepEqual(registry.kinds(), [])
})

test('dedupe identity: explicit key wins, otherwise kind plus open target', () => {
  const explicit = { kind: 'terminal', rail: { dedupeKey: 'term' } }
  assert.equal(resolveSurfaceDedupeKey(explicit, {}), 'term')
  const derived = { kind: 'file', center: {} }
  assert.equal(resolveSurfaceDedupeKey(derived, { path: '/a/b.ts' }), 'file:/a/b.ts')
  assert.equal(resolveSurfaceDedupeKey(derived, { sessionId: 's1' }), 'file:s1')
  assert.equal(resolveSurfaceDedupeKey(derived, {}), 'file:')
})

/* ---------- OpenPipeline ---------- */

type RecordedAction = OpenPipelineAction

function pipelineWithDispatcher() {
  const registry = createSurfaceRegistry()
  registry.register(descriptor({ kind: 'file', center: {} }))
  const pipeline = createOpenPipeline(registry)
  const actions: RecordedAction[] = []
  pipeline.installDispatcher(action => actions.push(action))
  return { pipeline, actions }
}

test('pipeline routes opens through resolveOpenPlan semantics', () => {
  const { pipeline } = pipelineWithDispatcher()
  // Default intent pins.
  let plan = pipeline.open({ kind: 'file', target: { path: '/a.ts' } })
  assert.deepEqual(plan, { area: 'center-tabs', pinned: true, activate: true })
  // Preview intent previews while preview tabs are enabled.
  plan = pipeline.open({ kind: 'file', target: { path: '/b.ts' }, intent: 'preview' })
  assert.equal(plan.pinned, false)
  // Background appends without activation.
  plan = pipeline.open({ kind: 'file', target: { path: '/c.ts' }, intent: 'background' })
  assert.equal(plan.activate, false)
  // Disabling preview tabs upgrades a preview intent to a permanent tab.
  pipeline.setPreviewTabs('disabled')
  plan = pipeline.open({ kind: 'file', target: { path: '/d.ts' }, intent: 'preview' })
  assert.equal(plan.pinned, true)
  // Rail-only kinds are permanent rail chips.
  const registry = createSurfaceRegistry()
  registry.register({
     kind: 'chip',
     rail: {},
     scopeNeed: null,
     previewable: false,
     focusPolicy: 'never',
   })
  const railPipeline = createOpenPipeline(registry)
  const actions: RecordedAction[] = []
  railPipeline.installDispatcher(action => actions.push(action))
  const railPlan = railPipeline.open({ kind: 'chip', intent: 'preview' })
  assert.deepEqual(railPlan, { area: 'side-rail', pinned: true, activate: true })
})

test('pipeline dedupes by surface identity and reports activation instead of reopening', () => {
  const { pipeline, actions } = pipelineWithDispatcher()
  pipeline.open({ kind: 'file', target: { path: '/a.ts' } })
  pipeline.open({ kind: 'file', target: { path: '/a.ts' }, intent: 'background' })
  assert.equal(actions.length, 2)
  assert.equal(actions[0]?.type, 'open')
  assert.equal(actions[1]?.type, 'activate')
  assert.equal(actions[1]?.plan, actions[0]?.plan, 'activation replays the live plan')
  const dedupeKey = actions[0]?.dedupeKey ?? ''
  assert.ok(pipeline.isActive(dedupeKey))
  // Closing the tab re-arms the identity for a fresh open.
  assert.equal(pipeline.deactivate(dedupeKey), true)
  assert.equal(pipeline.deactivate(dedupeKey), false)
  pipeline.open({ kind: 'file', target: { path: '/a.ts' } })
  assert.equal(actions.length, 3)
  assert.equal(actions[2]?.type, 'open')
})

test('pipeline fails loudly without a dispatcher or for unknown kinds', () => {
  const registry = createSurfaceRegistry()
  registry.register(descriptor({ kind: 'file' }))
  const pipeline = createOpenPipeline(registry)
  assert.throws(() => pipeline.open({ kind: 'file' }), /no dispatcher installed/)
  const uninstall = pipeline.installDispatcher(() => {})
  assert.throws(() => pipeline.open({ kind: 'ghost' }), /unknown surface kind/)
  uninstall()
  assert.throws(() => pipeline.open({ kind: 'file' }), /no dispatcher installed/)
})

/* ---------- LayoutService ---------- */

test('layout claims negotiate footprints per dimension by maximum', () => {
  const layout = createLayoutService()
  assert.deepEqual(layout.footprint('right-panel'), {})
  layout.claim('right-panel', 'terminal', { width: 480 })
  assert.deepEqual(layout.footprint('right-panel'), { width: 480 })
  layout.claim('right-panel', 'summary', { width: 320 })
  assert.deepEqual(layout.footprint('right-panel'), { width: 480 })
  assert.deepEqual(layout.claims('right-panel'), ['terminal', 'summary'])
  // Re-claiming replaces the owner footprint instead of duplicating it.
  layout.claim('right-panel', 'summary', { width: 560 })
  assert.deepEqual(layout.claims('right-panel'), ['terminal', 'summary'])
  assert.deepEqual(layout.footprint('right-panel'), { width: 560 })
  assert.equal(layout.release('right-panel', 'summary'), true)
  assert.equal(layout.release('right-panel', 'summary'), false)
  assert.deepEqual(layout.footprint('right-panel'), { width: 480 })
})

test('layout handles release exactly once and reject blank owners', () => {
  const layout = createLayoutService()
  assert.throws(() => layout.claim('left-rail', '  '), /non-empty owner/)
  const handle = layout.claim('left-rail', 'rail')
  handle.release()
  handle.release()
  assert.deepEqual(layout.claims('left-rail'), [])
})

test('layout previews participate in negotiation and commit/discard two-phase', () => {
  const layout = createLayoutService()
  layout.claim('right-panel', 'terminal', { width: 400 })
  layout.claim('right-panel', 'summary', { width: 300 })
  const drag = layout.preview('right-panel', 'summary', { width: 700 })
  assert.deepEqual(layout.footprint('right-panel'), { width: 700 })
  drag.discard()
  assert.deepEqual(layout.footprint('right-panel'), { width: 400 })
  const drag2 = layout.preview('right-panel', 'summary', { width: 620 })
  drag2.commit()
  assert.deepEqual(layout.footprint('right-panel'), { width: 620 })
  // Settled handles are idempotent: a late discard must not roll back.
  drag2.discard()
  assert.deepEqual(layout.footprint('right-panel'), { width: 620 })
  // Previewing without a claim is a programming error.
  assert.throws(() => layout.preview('right-panel', 'ghost', { width: 10 }), /existing claim/)
})

test('layout z-index arbitration uses the shared table and stacks overlays in layers', () => {
  const layout = createLayoutService()
  // Every region resolves to the frozen base.
  for (const [region, base] of Object.entries(LAYOUT_REGION_Z)) {
    assert.equal(layout.zIndexFor(region as keyof typeof LAYOUT_REGION_Z), base)
  }
  // Overlay claimants take stacking layer slots in claim order…
  const first = layout.claim('overlay', 'summary-popover')
  const second = layout.claim('overlay', 'marketplace-overlay')
  assert.equal(layout.zIndexFor('overlay'), LAYOUT_REGION_Z.overlay + 10)
  assert.deepEqual(layout.claims('overlay'), ['summary-popover', 'marketplace-overlay'])
  // …survivors keep their stacking when a sibling releases…
  second.release()
  assert.equal(layout.zIndexFor('overlay'), LAYOUT_REGION_Z.overlay)
  // …the lowest freed slot is reused by the next claimant…
  const third = layout.claim('overlay', 'next-overlay')
  assert.equal(layout.zIndexFor('overlay'), LAYOUT_REGION_Z.overlay + 10)
  // …and an empty overlay falls back to the frozen base.
  first.release()
  third.release()
  assert.equal(layout.zIndexFor('overlay'), LAYOUT_REGION_Z.overlay)
})

/* ---------- WorkspaceEvents ---------- */

test('workspace events keep cwd switches and session switches distinct', () => {
  const events = createWorkspaceEvents()
  const workspaces: string[] = []
  const sessions: string[] = []
  events.onWorkspaceChanged(cwd => workspaces.push(cwd))
  events.onSessionChanged(event => sessions.push(`${event.sessionId}@${event.cwd}`))

  // Initial identity is empty and identical updates fire nothing.
  assert.deepEqual(events.snapshot(), { cwd: null, sessionId: null })
  events.identify({})
  events.identify({ cwd: '/repo' })
  assert.deepEqual(workspaces, ['/repo'])
  assert.deepEqual(sessions, [])

  // Same cwd, new session: session event only, carrying the current cwd.
  events.identify({ sessionId: 's1', cwd: '/repo' })
  assert.deepEqual(workspaces, ['/repo'])
  assert.deepEqual(sessions, ['s1@/repo'])

  // Cwd change with unchanged session: workspace event only.
  events.identify({ cwd: '/other' })
  assert.deepEqual(workspaces, ['/repo', '/other'])
  assert.deepEqual(sessions, ['s1@/repo'])

  // Both change: workspace fires before session so listeners see the new cwd.
  events.identify({ sessionId: 's2', cwd: '/third' })
  assert.deepEqual(workspaces, ['/repo', '/other', '/third'])
  assert.deepEqual(sessions, ['s1@/repo', 's2@/third'])

  // Unsubscribe stops delivery.
  const stop = events.onSessionChanged(() => assert.fail('must not fire'))
  stop()
  events.identify({ sessionId: 's3' })
  assert.deepEqual(events.snapshot().sessionId, 's3')
})

/* ---------- Plugin wiring & boundaries ---------- */

test('client entry provides the four kernel services under the fixed ctx ids', () => {
  const provided = new Map<string, unknown>()
  const removed: string[] = []
  let teardown: (() => void) | undefined
  const ctx = {
    reflect: {
      provide(name: string, value: unknown): () => void {
        provided.set(name, value)
        return () => {
          removed.push(name)
          provided.delete(name)
        }
      },
    },
  }
  teardown = apply(ctx) ?? undefined
  // The fixed service ids are the entire cross-plugin surface.
  assert.deepEqual(
    [...provided.keys()].sort(),
    ['workbench.events', 'workbench.layout', 'workbench.open', 'workbench.registry'],
  )
  // The wired services are real: exercise each one through the ctx map.
  const registry = provided.get('workbench.registry') as ReturnType<typeof createSurfaceRegistry>
  registry.register(descriptor({ kind: 'file' }))
  assert.deepEqual((provided.get('workbench.registry') as typeof registry).kinds(), ['file'])
  const events = provided.get('workbench.events') as ReturnType<typeof createWorkspaceEvents>
  assert.equal(typeof events.onWorkspaceChanged, 'function')
  const layout = provided.get('workbench.layout') as ReturnType<typeof createLayoutService>
  assert.deepEqual(layout.footprint('overlay'), {})
  assert.throws(
    () => (provided.get('workbench.open') as ReturnType<typeof createOpenPipeline>).open({ kind: 'file' }),
    /no dispatcher installed/,
  )

  teardown?.()
  // Teardown removed every provider exactly once each.
  assert.deepEqual([...removed].sort(), [
    'workbench.events',
    'workbench.layout',
    'workbench.open',
    'workbench.registry',
  ])
  assert.equal(provided.size, 0)
})

test('kernel sources stay DOM/React/cordis free (import-direction boundary)', () => {
  // Guarded contract: the kernel is pure logic reachable only through ctx
  // services; importing DOM/React/cordis here would split the platform's
  // single React copy rule and leak browser globals into host-safe code.
  const sources = [
    'plugins/workbench/src/client.ts',
    'plugins/workbench/src/events.ts',
    'plugins/workbench/src/index.ts',
    'plugins/workbench/src/layout.ts',
    'plugins/workbench/src/open-pipeline.ts',
    'plugins/workbench/src/registry.ts',
    'plugins/shared/contracts/workbench-contracts.ts',
  ]
  const banned = /(?:from\s+|import\s*\()\s*['"](react|react-dom[^'"]*|cordis|@deepseek-ai\/[^'"]*)['"]/
  for (const source of sources) {
    const text = readFileSync(join(root, source), 'utf8')
    assert.equal(banned.test(text), false, `${source} must not import DOM/React/cordis`)
  }
})
