import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LAYOUT_REGION_Z,
  type LayoutService,
} from '../plugins/shared/contracts/workbench-contracts.ts'
import { createLayoutService } from '../plugins/workbench/src/layout.ts'
import {
  createLayoutDom,
  ensureLayoutDom,
  type LayoutDomEnv,
} from '../plugins/shared/layout-dom.ts'

/* ── headless DOM stub ──────────────────────────────────────────────── */

class StubElement {
  readonly style: StubStyle
  readonly dataset: Record<string, string | undefined> = {}
  readonly children: StubElement[] = []
  parent: StubElement | null = null

  id: string

  constructor(id: string = '') {
    this.id = id
    this.style = new StubStyle()
  }

  append(child: StubElement): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = this
    this.children.push(child)
  }

  remove(): void {
    if (this.parent === null) return
    const index = this.parent.children.indexOf(this)
    if (index !== -1) this.parent.children.splice(index, 1)
    this.parent = null
  }
}

class StubStyle {
  private readonly props = new Map<string, string>()

  getPropertyValue(name: string): string {
    return this.props.get(name) ?? ''
  }

  setProperty(name: string, value: string): void {
    this.props.set(name, value)
  }

  removeProperty(name: string): void {
    this.props.delete(name)
  }

  get paddingRight(): string {
    return this.props.get('padding-right') ?? ''
  }

  set paddingRight(value: string) {
    this.props.set('padding-right', value)
  }

  get boxSizing(): string {
    return this.props.get('box-sizing') ?? ''
  }

  set boxSizing(value: string) {
    this.props.set('box-sizing', value)
  }

  get zIndex(): string {
    return this.props.get('z-index') ?? ''
  }

  set zIndex(value: string) {
    this.props.set('z-index', value)
  }
}

function stubEnv(): { env: LayoutDomEnv; root: StubElement; html: StubElement; body: StubElement } {
  const root = new StubElement('root')
  const html = new StubElement('html')
  const body = new StubElement('body')
  return {
    env: {
      appRoot: () => root as unknown as HTMLElement,
      documentElement: html as unknown as HTMLElement,
      body: body as unknown as HTMLElement,
    },
    root,
    html,
    body,
  }
}

/* ── LayoutService negotiation contract ─────────────────────────────── */

test('right-panel claims are mutually exclusive in effect and the most recent claimant owns the flag', () => {
  const layout = createLayoutService()
  layout.claim('right-panel', 'sidebar', { width: 520 })
  layout.claim('right-panel', 'pinned-summary', { width: 312 })

  // The region reserves enough room for every concurrent claimant (max),
  // while ownership attribution follows claim recency.
  assert.deepEqual(layout.footprint('right-panel'), { width: 520 })
  assert.deepEqual(layout.claims('right-panel'), ['sidebar', 'pinned-summary'])

  // Re-claim by an existing owner replaces its footprint; claim order (and
  // therefore ownership attribution) is stable across re-claims.
  layout.claim('right-panel', 'sidebar', { width: 700 })
  assert.deepEqual(layout.claims('right-panel'), ['sidebar', 'pinned-summary'])
  assert.deepEqual(layout.footprint('right-panel'), { width: 700 })
})

test('release zeroes the negotiated footprint and is exactly-once per claim', () => {
  const layout = createLayoutService()
  const handle = layout.claim('right-panel', 'sidebar', { width: 520 })
  handle.release()
  assert.equal(layout.release('right-panel', 'sidebar'), false, 'handle release already dropped the claim')
  assert.deepEqual(layout.footprint('right-panel'), {})
  assert.deepEqual(layout.claims('right-panel'), [])

  // Re-claiming after a handle release works and releases through the service too.
  layout.claim('right-panel', 'sidebar', { width: 480 })
  assert.equal(layout.release('right-panel', 'sidebar'), true)
  assert.equal(layout.release('right-panel', 'sidebar'), false)
})

test('preview participates frame-by-frame without committing until promoted', () => {
  const layout = createLayoutService()
  layout.claim('right-panel', 'sidebar', { width: 520 })

  // Drag hot path: each frame previews; negotiation sees it immediately…
  const frame = layout.preview('right-panel', 'sidebar', { width: 640 })
  assert.deepEqual(layout.footprint('right-panel'), { width: 640 })
  // …and the committed value survives until the frame settles.
  frame.discard()
  assert.deepEqual(layout.footprint('right-panel'), { width: 520 })

  const drag = layout.preview('right-panel', 'sidebar', { width: 800 })
  drag.commit()
  assert.deepEqual(layout.footprint('right-panel'), { width: 800 })

  // Settled handles are inert; preview without a committed claim throws.
  drag.commit()
  drag.discard()
  assert.throws(() => layout.preview('right-panel', 'ghost', { width: 1 }), /existing claim/)
})

test('the declarative z-index table arbitrates regions and overlay stacking layers', () => {
  const layout = createLayoutService()
  for (const region of Object.keys(LAYOUT_REGION_Z) as Array<keyof typeof LAYOUT_REGION_Z>) {
    assert.equal(layout.zIndexFor(region), LAYOUT_REGION_Z[region])
  }

  const a = createOverlayWithZ(layout, 'a')
  const b = createOverlayWithZ(layout, 'b')
  // Each active overlay claimant stacks above the previous one through the
  // service's layer slots on top of the frozen table base.
  assert.equal(a.z, LAYOUT_REGION_Z.overlay)
  assert.ok(b.z > a.z, 'later overlay claimants stack above earlier ones')

  // Re-claiming an existing owner updates its footprint without leaking a
  // second layer slot.
  const beforeReclaim = layout.zIndexFor('overlay')
  layout.claim('overlay', 'b')
  assert.equal(layout.zIndexFor('overlay'), beforeReclaim)

  // Released layer slots are reused so stacking stays bounded by live claimants.
  a.release()
  const c = createOverlayWithZ(layout, 'c')
  assert.equal(c.z, b.z, 'a freed low slot is handed to the next claimant')
  b.release()
  c.release()
  assert.equal(layout.zIndexFor('overlay'), LAYOUT_REGION_Z.overlay)

  function createOverlayWithZ(service: LayoutService, owner: string): { z: number; release(): void } {
    const handle = service.claim('overlay', owner)
    return { z: service.zIndexFor('overlay'), release: handle.release }
  }
})

/* ── region host: right-panel squeeze ───────────────────────────────── */

function domOver(layout: LayoutService) {
  const stub = stubEnv()
  const dom = createLayoutDom(layout, stub.env)
  return { ...stub, dom }
}

test('the region host derives the squeeze solely from the negotiated footprint', () => {
  const layout = createLayoutService()
  const { dom, root, html } = domOver(layout)

  dom.reservePanel('sidebar', 520)
  assert.equal(root.style.paddingRight, '520px')
  assert.equal(root.style.boxSizing, 'border-box')
  assert.equal(html.dataset.dshStudioRightPanelOwner, 'sidebar')

  // A second claimant raises the reservation but not the attribution.
  dom.reservePanel('pinned-summary', 312)
  assert.equal(root.style.paddingRight, '520px')
  assert.equal(html.dataset.dshStudioRightPanelOwner, 'pinned-summary')

  // Releases clear the squeeze only when the last claimant drops.
  dom.releasePanel('pinned-summary')
  assert.equal(root.style.paddingRight, '520px')
  dom.releasePanel('sidebar')
  assert.equal(root.style.paddingRight, '')
  assert.equal(root.style.boxSizing, '')
  assert.equal(html.dataset.dshStudioRightPanelOwner, undefined)

  // Dirty-check: releasing again writes nothing new (still cleared).
  dom.releasePanel('sidebar')
  assert.equal(root.style.paddingRight, '')
})

test('preview frames move the column immediately; reserve settles the final width', () => {
  const layout = createLayoutService()
  const { dom, root } = domOver(layout)
  dom.reservePanel('sidebar', 400)

  dom.previewPanel('sidebar', 620)
  assert.equal(root.style.paddingRight, '620px')
  assert.deepEqual(layout.footprint('right-panel'), { width: 620 })
  assert.equal((layout.claims('right-panel').length), 1)

  // Frames replace each other without stacking pending state…
  dom.previewPanel('sidebar', 590)
  assert.equal(root.style.paddingRight, '590px')
  // …and the commit path re-asserts the claim with the final value.
  dom.reservePanel('sidebar', 600)
  assert.equal(root.style.paddingRight, '600px')
  assert.deepEqual(layout.footprint('right-panel'), { width: 600 })

  dom.releasePanel('sidebar')
  assert.throws(() => dom.previewPanel('sidebar', 10), /requires an active claim/)
})

test('missing app root degrades to flag-only negotiation', () => {
  const layout = createLayoutService()
  const stub = stubEnv()
  const env: LayoutDomEnv = { ...stub.env, appRoot: () => null }
  const dom = createLayoutDom(layout, env)
  dom.reservePanel('sidebar', 300)
  assert.equal(stub.html.dataset.dshStudioRightPanelOwner, 'sidebar')
  dom.releasePanel('sidebar')
  assert.equal(stub.html.dataset.dshStudioRightPanelOwner, undefined)
})

/* ── region host: overlay mount protocol ────────────────────────────── */

test('overlay mounts are claimed, stacked by the table, and unmounted in one piece', () => {
  const layout = createLayoutService()
  const { dom, body } = domOver(layout)

  const first = new StubElement('first')
  const second = new StubElement('second')
  const h1 = dom.mountOverlay('summary', first as unknown as HTMLElement)
  const h2 = dom.mountOverlay('marketplace', second as unknown as HTMLElement)

  // Body-level entry: appended in claim order; z rises per active layer.
  assert.deepEqual(body.children.map(child => child.id), ['first', 'second'])
  assert.equal(first.style.zIndex, String(LAYOUT_REGION_Z.overlay))
  assert.ok(Number(second.style.zIndex) > Number(first.style.zIndex))
  assert.deepEqual(layout.claims('overlay'), ['summary', 'marketplace'])

  // Remounting the same owner is idempotent — no duplicate body children.
  const again = dom.mountOverlay('summary', first as unknown as HTMLElement)
  assert.equal(body.children.length, 2)
  again.release()

  h1.release()
  assert.equal(first.parent, null)
  assert.deepEqual(layout.claims('overlay'), ['marketplace'])
  h2.release()
  assert.equal(second.parent, null)
  assert.deepEqual(layout.claims('overlay'), [])

  // Release is idempotent.
  h2.release()
  assert.equal(second.parent, null)
})

test('explicit overlay z overrides are honored without consuming dynamic layers', () => {
  const layout = createLayoutService()
  const { dom } = domOver(layout)
  const pinned = new StubElement('pinned')
  dom.mountOverlay('sidebar', pinned as unknown as HTMLElement, { zIndex: 10 })
  assert.equal(pinned.style.zIndex, '10')
  assert.deepEqual(layout.claims('overlay'), [])

  assert.throws(
    () => dom.mountOverlay('sidebar', new StubElement('replacement') as unknown as HTMLElement, { zIndex: 10 }),
    /already mounted/,
  )
})

/* ── region host: document chrome single write point ────────────────── */

test('document flags and vars are written dirty-checked through one channel', () => {
  const layout = createLayoutService()
  const { dom, html } = domOver(layout)

  dom.applyDocumentStyles({
    vars: { '--dsh-studio-sidebar-width': '420px' },
    flags: { dshStudioDesktopSidebarOpen: 'true' },
  })
  assert.equal(html.style.getPropertyValue('--dsh-studio-sidebar-width'), '420px')
  assert.equal(html.dataset.dshStudioDesktopSidebarOpen, 'true')

  // Same values: no-op rewrite must be observable-free but harmless.
  dom.applyDocumentStyles({
    vars: { '--dsh-studio-sidebar-width': '420px' },
    flags: { dshStudioDesktopSidebarOpen: 'true' },
  })
  assert.equal(html.style.getPropertyValue('--dsh-studio-sidebar-width'), '420px')

  dom.applyDocumentStyles({
    vars: { '--dsh-studio-sidebar-width': null },
    flags: { dshStudioDesktopSidebarOpen: null, dshStudioPanelMaximized: null },
  })
  assert.equal(html.style.getPropertyValue('--dsh-studio-sidebar-width'), '')
  assert.equal(html.dataset.dshStudioDesktopSidebarOpen, undefined)
})

/* ── shared-instance discipline ─────────────────────────────────────── */

test('ensureLayoutDom hands every consumer of one service the same host', () => {
  const layout = createLayoutService()
  assert.equal(ensureLayoutDom(layout), ensureLayoutDom(layout))
  assert.notEqual(ensureLayoutDom(createLayoutService()), ensureLayoutDom(layout))
})
