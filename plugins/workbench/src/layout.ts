/**
 * LayoutService implementation — region ownership, footprint negotiation,
 * and the declarative z-index table (target-design §3.3 skeleton). Regions
 * are the five workbench areas; claimants negotiate footprints here instead
 * of each writing `#root` padding or CSS flags (that single write point
 * arrives with the region hosts in a later leaf; this module is pure
 * negotiation). Sidebar width policy (`clampPersistedWidth`/
 * `clampSidebarWidth`) stays in its sidebar domain: callers hand the FINAL
 * effective width to `claim`/`preview` — this service never clamps.
 *
 * Consumers receive the service only through the `workbench.layout` ctx
 * service. No DOM, no React, no cordis imports.
 */
import type {
  LayoutClaimHandle,
  LayoutFootprint,
  LayoutPreviewHandle,
  LayoutRegion,
  LayoutService,
} from '@dsh-studio/shared/workbench-contracts'
import { LAYOUT_REGION_Z } from '@dsh-studio/shared/workbench-contracts'

interface ClaimState {
  readonly owner: string
  committed: LayoutFootprint
  pending: LayoutFootprint | undefined
}

/** Effective footprint of one claimant: preview while dragging, else commit. */
function effective(state: ClaimState): LayoutFootprint {
  return state.pending ?? state.committed
}

/** Merge footprints dimension-wise by maximum (the negotiation rule). */
function negotiate(states: Iterable<ClaimState>): LayoutFootprint {
  let width: number | undefined
  let height: number | undefined
  for (const state of states) {
    const { width: w, height: h } = effective(state)
    if (w !== undefined && (width === undefined || w > width)) width = w
    if (h !== undefined && (height === undefined || h > height)) height = h
  }
  const result: LayoutFootprint = {}
  if (width !== undefined) result.width = width
  if (height !== undefined) result.height = height
  return result
}

export function createLayoutService(): LayoutService {
  const regions = new Map<LayoutRegion, Map<string, ClaimState>>()
  // Overlay stacking: the lowest free layer slot is reused after release so
  // the overlay z stays bounded by live claimants, not by mount history.
  const freeLayers: number[] = []
  let nextLayer = 0
  const ownerLayers = new Map<string, number>()

  function regionMap(region: LayoutRegion): Map<string, ClaimState> {
    let map = regions.get(region)
    if (map === undefined) {
      map = new Map()
      regions.set(region, map)
    }
    return map
  }

  function acquireLayer(owner: string): number {
    const reused = freeLayers.shift()
    if (reused !== undefined) {
      ownerLayers.set(owner, reused)
      return reused
    }
    const layer = nextLayer++
    ownerLayers.set(owner, layer)
    return layer
  }

  function releaseLayer(owner: string): void {
    const layer = ownerLayers.get(owner)
    if (layer === undefined) return
    ownerLayers.delete(owner)
    freeLayers.push(layer)
  }

  const service: LayoutService = {
    claim(region, owner, footprint) {
      if (owner.trim() === '') throw new Error('layout claim requires a non-empty owner')
      const map = regionMap(region)
      const existing = map.get(owner)
      if (existing !== undefined) {
        existing.committed = footprint ?? {}
        existing.pending = undefined
      } else {
        map.set(owner, { owner, committed: footprint ?? {}, pending: undefined })
        if (region === 'overlay') acquireLayer(owner)
      }
      let released = false
      return {
        release() {
          if (released) return
          released = true
          service.release(region, owner)
        },
      }
    },
    release(region, owner) {
      const map = regions.get(region)
      if (map === undefined || !map.delete(owner)) return false
      if (region === 'overlay') releaseLayer(owner)
      return true
    },
    preview(region, owner, footprint) {
      const map = regions.get(region)
      const state = map?.get(owner)
      if (state === undefined) {
        throw new Error(`layout preview requires an existing claim: ${owner} on ${region}`)
      }
      state.pending = footprint
      let settled = false
      return {
        commit() {
          if (settled) return
          settled = true
          state.committed = state.pending ?? state.committed
          state.pending = undefined
        },
        discard() {
          if (settled) return
          settled = true
          state.pending = undefined
        },
      }
    },
    footprint(region) {
      const map = regions.get(region)
      if (map === undefined || map.size === 0) return {}
      return negotiate(map.values())
    },
    zIndexFor(region) {
      const base = LAYOUT_REGION_Z[region]
      if (region !== 'overlay' || ownerLayers.size === 0) return base
      let max = -1
      for (const layer of ownerLayers.values()) {
        if (layer > max) max = layer
      }
      return base + max * 10
    },
    claims(region) {
      const map = regions.get(region)
      return map === undefined ? [] : [...map.keys()]
    },
  }
  return service
}
