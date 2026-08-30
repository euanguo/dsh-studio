/**
 * Layout region host — the DOM binding of the workbench LayoutService
 * (`ctx.get('workbench.layout')`).
 *
 * This module is the SINGLE write point for every global-layout DOM effect
 * that used to be scattered across the retired desktopPanels right-panel
 * coordinator and its consumers:
 *
 * 1. Right-panel squeeze: the app root's `padding-right` (+ border-box) is
 *    derived ONLY from the negotiated right-panel footprint. Consumers call
 *    `layout.claim/release/preview` semantics through `reservePanel` /
 *    `previewPanel` / `releasePanel`; they never touch the app root.
 * 2. Overlay mount protocol: `mountOverlay` is the ONLY body-level element
 *    entry for plugin chrome. It claims the `overlay` region, assigns the
 *    element's stacking from the declarative z-index table
 *    (`layout.zIndexFor('overlay')`, one layer slot per active claimant),
 *    appends to `<body>` in claim order, and removes both on release.
 * 3. Document chrome flags / CSS variables: `applyDocumentStyles` is the
 *    one writer on `documentElement`; consumers decide VALUES, never write
 *    them themselves.
 *
 * The factory takes an injectable environment so the host behavior is fully
 * testable headlessly (see tests/layout-service.test.ts).
 */
import type { LayoutService } from './contracts/workbench-contracts.ts'

/** DOM surfaces the region host binds to (injectable for tests). */
export interface LayoutDomEnv {
  /** The app shell root element carrying the right-panel squeeze. */
  appRoot(): HTMLElement | null
  readonly documentElement: HTMLElement
  readonly body: HTMLElement
}

function defaultEnv(): LayoutDomEnv {
  // Resolved lazily: importing this module headlessly (tests, host side)
  // must not require a DOM until a host actually binds to one.
  return {
    appRoot: () => document.getElementById('root'),
    get documentElement() {
      return document.documentElement
    },
    get body() {
      return document.body
    },
  }
}

export interface OverlayMountOptions {
  /**
   * Explicit stacking override for layers pinned by product decisions that
   * predate the z-index table (e.g. the sidebar root deliberately sits below
   * upstream dialogs). When omitted, the declarative table decides via
   * `layout.zIndexFor('overlay')`.
   */
  zIndex?: number
}

export interface OverlayHandle {
  /** Remove the element and release its overlay claim (idempotent). */
  release(): void
}

/**
 * One document-level chrome patch. Values are written dirty-checked onto
 * `documentElement`; `null` removes the entry. Flag keys are dataset keys in
 * camelCase (`dshStudioDesktopSidebarOpen`), var keys are CSS custom
 * property names (`--dsh-studio-sidebar-width`).
 */
export interface DocumentStylePatch {
  vars?: Record<string, string | null>
  flags?: Record<string, string | null>
}

/** Region-host face consumers use alongside the raw LayoutService. */
export interface LayoutDom {
  readonly layout: LayoutService
  /**
   * Commit `owner`'s final right-panel width (px). Re-claiming replaces the
   * committed footprint and settles any in-flight drag preview.
   */
  reservePanel(owner: string, width: number): void
  /**
   * Drag hot path: publish a pending width WITHOUT touching the committed
   * claim. The very first frame already moves the center column because the
   * negotiated footprint includes previews. Must follow a `reservePanel`
   * by the same owner.
   */
  previewPanel(owner: string, width: number): void
  /** Drop `owner`'s right-panel claim; the squeeze clears when it was the last. */
  releasePanel(owner: string): void
  /**
   * The overlay mount protocol — the ONLY body-level element entry.
   * Returns an idempotent release handle.
   */
  mountOverlay(
    owner: string,
    element: HTMLElement,
    options?: OverlayMountOptions,
  ): OverlayHandle
  /** The single writer for document-level chrome flags and CSS variables. */
  applyDocumentStyles(patch: DocumentStylePatch): void
}

interface PanelClaim {
  claim: ReturnType<LayoutService['claim']>
  preview: ReturnType<LayoutService['preview']> | undefined
}

export function createLayoutDom(
  layout: LayoutService,
  env: LayoutDomEnv = defaultEnv(),
): LayoutDom {
  const panels = new Map<string, PanelClaim>()
  const overlays = new Map<string, { element: HTMLElement; handle: OverlayHandle }>()

  function settlePreview(claim: PanelClaim): void {
    claim.preview?.discard()
    claim.preview = undefined
  }

  /** Re-apply the squeeze + owner flag from the negotiated state. */
  function syncPanel(): void {
    const root = env.appRoot()
    const html = env.documentElement
    const owners = layout.claims('right-panel')
    const width = layout.footprint('right-panel').width
    if (width === undefined) {
      if (html.dataset.dshStudioRightPanelOwner !== undefined) {
        delete html.dataset.dshStudioRightPanelOwner
      }
      // Dirty-checked: avoid style invalidation when the squeeze is already clear.
      if (root !== null && root.style.paddingRight !== '') {
        root.style.removeProperty('padding-right')
      }
      if (root !== null && root.style.boxSizing !== '') {
        root.style.removeProperty('box-sizing')
      }
      return
    }
    const owner = owners[owners.length - 1]
    if (owner !== undefined && html.dataset.dshStudioRightPanelOwner !== owner) {
      html.dataset.dshStudioRightPanelOwner = owner
    }
    if (root === null) return
    // box-sizing must accompany a non-zero squeeze so padding narrows the
    // center column instead of overflowing the window.
    if (root.style.boxSizing !== 'border-box') {
      root.style.setProperty('box-sizing', 'border-box')
    }
    const cssWidth = `${String(width)}px`
    if (root.style.paddingRight !== cssWidth) {
      root.style.setProperty('padding-right', cssWidth)
    }
  }

  return {
    layout,

    reservePanel(owner, width) {
      let claim = panels.get(owner)
      if (claim === undefined) {
        claim = {
          claim: layout.claim('right-panel', owner, { width }),
          preview: undefined,
        }
        panels.set(owner, claim)
      } else {
        settlePreview(claim)
        // Re-claiming by the same owner replaces the committed footprint.
        claim.claim = layout.claim('right-panel', owner, { width })
      }
      syncPanel()
    },

    previewPanel(owner, width) {
      const claim = panels.get(owner)
      if (claim === undefined) {
        throw new Error(`layout-dom: previewPanel requires an active claim: ${owner}`)
      }
      settlePreview(claim)
      claim.preview = layout.preview('right-panel', owner, { width })
      syncPanel()
    },

    releasePanel(owner) {
      const claim = panels.get(owner)
      if (claim === undefined) return
      panels.delete(owner)
      settlePreview(claim)
      claim.claim.release()
      syncPanel()
    },

    mountOverlay(owner, element, options) {
      const existing = overlays.get(owner)
      if (existing !== undefined) {
        if (existing.element !== element) {
          throw new Error(`layout-dom: overlay owner is already mounted: ${owner}`)
        }
        return existing.handle
      }
      // Explicit z-index layers are pinned product surfaces, not claimants in
      // the shared overlay stack. They still use this host for mount/release,
      // but do not consume a dynamic layer slot.
      const claim = options?.zIndex === undefined ? layout.claim('overlay', owner) : undefined
      // The declarative z-index table is the arbitration authority unless a
      // product surface carries an explicit pinned layer.
      const z = options?.zIndex ?? layout.zIndexFor('overlay')
      element.style.zIndex = String(z)
      env.body.append(element)
      const handle: OverlayHandle = {
        release() {
          const current = overlays.get(owner)
          if (current?.handle !== handle) return
          overlays.delete(owner)
          claim?.release()
          element.remove()
        },
      }
      overlays.set(owner, { element, handle })
      return handle
    },

    applyDocumentStyles(patch) {
      const html = env.documentElement
      for (const [name, value] of Object.entries(patch.vars ?? {})) {
        if (value === null) {
          if (html.style.getPropertyValue(name) !== '') html.style.removeProperty(name)
        } else if (html.style.getPropertyValue(name) !== value) {
          html.style.setProperty(name, value)
        }
      }
      for (const [name, value] of Object.entries(patch.flags ?? {})) {
        if (value === null) {
          if (html.dataset[name] !== undefined) delete html.dataset[name]
        } else if (html.dataset[name] !== value) {
          html.dataset[name] = value
        }
      }
    },
  }
}

/** Live LayoutDom instances keyed by their LayoutService instance. */
const instances = new WeakMap<LayoutService, LayoutDom>()

/**
 * The ONE LayoutDom per LayoutService instance — every consumer passing the
 * same ctx service shares a single region host (and therefore a single set
 * of DOM write points).
 */
export function ensureLayoutDom(layout: LayoutService): LayoutDom {
  let dom = instances.get(layout)
  if (dom === undefined) {
    dom = createLayoutDom(layout)
    instances.set(layout, dom)
  }
  return dom
}
