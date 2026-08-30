/**
 * Built-in registration: the plugin registers its own surfaces through the
 * same service external plugins use — eating its own dogfood. The aspect
 * declarations live next to their feature modules (tabs.tsx = rail,
 * viewers.tsx = file viewers, surfaces.tsx = center renderers); this module
 * unifies them per kind into single kernel-model descriptors, owns the
 * kernel metadata (scopeNeed / previewable / focusPolicy) for the merged
 * kinds, and owns the disposer lifecycle (HMR-safe).
 */
import { builtinTabs, type RailPart } from './tabs.tsx'
import { builtinViewers, type ViewerPart } from './viewers.tsx'
import { builtinSurfaces, type CenterPart } from './surfaces.tsx'
import type { SidebarBuiltinDeps } from './deps.ts'
import type {
  SidebarSurfaceDescriptor,
  DesktopSidebarService,
} from '../contract.ts'

/** Any aspect declaration awaiting kind-level unification. */
type BuiltinPart = Pick<
  SidebarSurfaceDescriptor,
  'kind' | 'scopeNeed' | 'previewable' | 'focusPolicy'
> & Partial<Pick<SidebarSurfaceDescriptor, 'rail' | 'center' | 'viewer'>>

/**
 * Unify same-kind aspect declarations into ONE descriptor: aspects merge
 * (exactly one declaration per aspect), `scopeNeed` is the CONJUNCTION
 * (workspace only when every declared aspect requires one — a rail tab
 * openable without a workspace stays openable even when its center twin
 * needs a cwd), `previewable` follows the center aspect, and the focus
 * policy must agree.
 */
function unifyDescriptor(kind: string, parts: readonly BuiltinPart[]): SidebarSurfaceDescriptor {
  const rail = parts.map(part => part.rail).find(spec => spec !== undefined)
  const center = parts.map(part => part.center).find(spec => spec !== undefined)
  const viewer = parts.map(part => part.viewer).find(spec => spec !== undefined)
  if (rail === undefined && center === undefined && viewer === undefined) {
    throw new Error(`builtin surface ${kind} has no aspect declarations`)
  }
  const focusPolicies = new Set(parts.map(part => part.focusPolicy))
  if (focusPolicies.size > 1) {
    throw new Error(`builtin surface ${kind} declares conflicting focus policies`)
  }
  return {
    kind,
    ...(rail === undefined ? {} : { rail }),
    ...(center === undefined ? {} : { center }),
    ...(viewer === undefined ? {} : { viewer }),
    scopeNeed: parts.every(part => part.scopeNeed === 'workspace') ? 'workspace' : null,
    previewable: parts.some(part => part.previewable),
    focusPolicy: parts[0]!.focusPolicy,
  }
}

function groupByKind(parts: readonly BuiltinPart[]): Map<string, BuiltinPart[]> {
  const grouped = new Map<string, BuiltinPart[]>()
  for (const part of parts) {
    const existing = grouped.get(part.kind)
    if (existing === undefined) grouped.set(part.kind, [part])
    else existing.push(part)
  }
  return grouped
}

/**
 * Register every built-in surface with the service as unified descriptors.
 * Returns a disposer that unregisters everything.
 */
export function registerBuiltins(
  sidebar: DesktopSidebarService,
  deps: SidebarBuiltinDeps,
): () => void {
  const parts: BuiltinPart[] = [
    ...builtinTabs(deps),
    ...builtinViewers(deps),
    ...builtinSurfaces(deps.t, deps.sessions, deps.runtimeSettings),
  ]
  const disposers: Array<() => void> = []
  for (const [kind, kindParts] of groupByKind(parts)) {
    disposers.push(sidebar.register(unifyDescriptor(kind, kindParts)))
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export type { SidebarBuiltinDeps } from './deps.ts'
