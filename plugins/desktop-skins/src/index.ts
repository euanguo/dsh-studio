/** Host half of desktop skins: durable preferences on the app-owned origin. */

import {
  OH_DSH_SURFACE_SERVICE,
  type OhDshSurface,
} from '@oh-dsh/shared/surface'
import {
  mountDesktopSkinPreferences,
  type DesktopSkinPreferencesHostContext,
} from './preferences-server.ts'

interface HostContext extends DesktopSkinPreferencesHostContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

export const name = 'oh-dsh-desktop-skins'

/**
 * The preferences route rides the shell's webServer, and the durable file
 * lives under the ACTIVE SURFACE's data root (the shared ohDshSurface
 * contract — desktop's dataRoot is the app-data path, web's is the web
 * data root). Injecting the desktop-only capability would pin this plugin
 * to Electron; the surface contract keeps one skins provider for every
 * browser-bearing shell.
 */
export const inject = [OH_DSH_SURFACE_SERVICE, 'webServer']

export function apply(ctx: HostContext): void {
  ctx.effect(
    () => mountDesktopSkinPreferences(ctx, ctx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface),
    'oh-dsh-desktop: desktop skin preferences',
  )
}
