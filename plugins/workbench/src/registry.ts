/**
 * SurfaceRegistry implementation — the ONE descriptor table for every
 * workbench surface kind (target-design §3.1). Absorbs the former
 * tab/viewer/surface-renderer registration trio. Consumers receive the
 * service only through the `workbench.registry` ctx service; all types live
 * in `@dsh-studio/shared/workbench-contracts`.
 *
 * Pure data structure: no DOM, no React, no cordis imports.
 */
import type {
  SurfaceDescriptor,
  SurfaceRegistry,
} from '@dsh-studio/shared/workbench-contracts'

/** Structural validation shared by every registration path. */
function validate(descriptor: SurfaceDescriptor): void {
  const kind = typeof descriptor.kind === 'string' ? descriptor.kind.trim() : ''
  if (kind === '') throw new Error('surface descriptor requires a non-empty kind')
  // Viewer-only descriptors are valid file-class registrations: file hosts
  // render them directly without opening a center tab.
  if (descriptor.rail === undefined && descriptor.center === undefined
    && descriptor.viewer === undefined) {
    throw new Error(`surface ${kind} must declare a rail, center or viewer spec`)
  }
  // Rail tabs are permanent, but a merged rail+center descriptor may still
  // expose previewable center opens. Reject only a rail-only preview flag.
  if (descriptor.rail !== undefined
    && descriptor.center === undefined
    && descriptor.previewable) {
    throw new Error(`surface ${kind} is rail-mounted and cannot be previewable`)
  }
}

export function createSurfaceRegistry(): SurfaceRegistry {
  const byKind = new Map<string, SurfaceDescriptor>()
  const registry: SurfaceRegistry = {
    register(descriptor) {
      validate(descriptor)
      if (byKind.has(descriptor.kind)) {
        throw new Error(`surface kind already registered: ${descriptor.kind}`)
      }
      byKind.set(descriptor.kind, descriptor)
      return () => {
        if (byKind.get(descriptor.kind) === descriptor) {
          byKind.delete(descriptor.kind)
        }
      }
    },
    unregister(kind) {
      byKind.delete(kind)
    },
    resolve(kind) {
      return byKind.get(kind)
    },
    require(kind) {
      const descriptor = byKind.get(kind)
      if (descriptor === undefined) {
        throw new Error(`unknown surface kind: ${kind}`)
      }
      return descriptor
    },
    kinds() {
      return [...byKind.keys()]
    },
    findByDedupeKey(key) {
      for (const descriptor of byKind.values()) {
        const declared = descriptor.center?.dedupeKey ?? descriptor.rail?.dedupeKey
        if (declared === key) return descriptor
      }
      return undefined
    },
  }
  return registry
}
