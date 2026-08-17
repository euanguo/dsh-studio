/**
 * Built-in registration: the plugin registers its own tabs, viewers and
 * center-surface renderers through the same service external plugins use —
 * eating its own dogfood. The descriptors live next to their feature
 * modules (tabs.tsx / viewers.tsx / surfaces.tsx); this module only
 * aggregates them and owns the disposer lifecycle (HMR-safe).
 */
import { builtinTabs } from './tabs.tsx'
import { builtinViewers } from './viewers.tsx'
import { registerBuiltinSurfaces } from './surfaces.tsx'
import type { SidebarBuiltinDeps } from './deps.ts'
import type { DesktopSidebarService } from '../contract.ts'

/**
 * Register every built-in tab, viewer and surface renderer with the
 * service. Returns a disposer that unregisters everything.
 */
export function registerBuiltins(
  sidebar: DesktopSidebarService,
  deps: SidebarBuiltinDeps,
): () => void {
  const disposers: Array<() => void> = []
  for (const tab of builtinTabs(deps)) {
    disposers.push(sidebar.registerTab(tab))
  }
  for (const viewer of builtinViewers(deps)) {
    disposers.push(sidebar.registerViewer(viewer))
  }
  disposers.push(registerBuiltinSurfaces(sidebar, deps.t, deps.reviewComments))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export type { SidebarBuiltinDeps } from './deps.ts'
