/**
 * Center surface renderer registry (ported from the reference project's
 * `surfaces/surface-renderer-registry.tsx`): kind → renderer strategy table.
 * The host renders the active surface through the registry and never knows
 * the concrete renderers; adding a surface kind = one registration.
 */
import type { ReactNode } from 'react'
import type { CenterSurface, CenterSurfaceKind } from './types.ts'

export type SurfaceRenderer = (surface: CenterSurface) => ReactNode

export class SurfaceRendererRegistry {
  private readonly renderers = new Map<CenterSurfaceKind, SurfaceRenderer>()

  register(kind: CenterSurfaceKind, renderer: SurfaceRenderer): void {
    if (this.renderers.has(kind)) {
      throw new Error(`center-surface: duplicate renderer for "${kind}"`)
    }
    this.renderers.set(kind, renderer)
  }

  get(kind: CenterSurfaceKind): SurfaceRenderer | undefined {
    return this.renderers.get(kind)
  }

  /** Render a surface; null when no renderer is registered (unknown kind). */
  render(surface: CenterSurface): ReactNode {
    const renderer = this.renderers.get(surface.kind)
    return renderer === undefined ? null : renderer(surface)
  }
}
