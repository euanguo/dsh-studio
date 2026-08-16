/** Host half of desktop skins: durable preferences on the app-owned origin. */

import {
  mountDesktopSkinPreferences,
  type DesktopCapability,
  type DesktopSkinPreferencesHostContext,
} from './preferences-server.ts'

interface HostContext extends DesktopSkinPreferencesHostContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

export const name = 'oh-dsh-desktop-skins'
export const inject = ['desktop', 'webServer']

export function apply(ctx: HostContext): void {
  ctx.effect(
    () => mountDesktopSkinPreferences(ctx, ctx.get('desktop') as DesktopCapability),
    'oh-dsh-desktop: desktop skin preferences',
  )
}
