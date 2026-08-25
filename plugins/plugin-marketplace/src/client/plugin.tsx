/**
 * plugin.tsx (leaf-4.2) — marketplace entry wiring.
 * Concerns are split across siblings: DOM probes → marketplace-dom.ts,
 * data/command hook → use-marketplace.ts, notices → marketplace-notices.ts,
 * filter/surface body → marketplace-filters.tsx, and the view controller +
 * thin surface root → marketplace-view.tsx. This file only wires and boots the
 * controller and the slots entry, keeping it small enough to read in a glance.
 */
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import type { MarketplaceMessage } from './i18n.ts'
import { MARKETPLACE_MESSAGES } from './i18n.ts'
import { createMarketplaceStore } from './store.ts'
import {
  MarketplaceNavigationEntry,
  PluginMarketplaceViewService,
  type ClientContext,
  type SessionsService,
  type SlotsService,
} from './marketplace-view.tsx'

export const inject = ['locale', 'sessions', 'slots']

export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktop
  if (bridge === undefined) {
    console.info('plugin-marketplace: skipped, the plugin marketplace is desktop-only')
    return
  }
  const locale = ctx.get('locale') as LocaleService
  const sessions = ctx.get('sessions') as SessionsService
  const slots = ctx.get('slots') as SlotsService
  const t: Translate<MarketplaceMessage> = locale.bind('dsh-studio.plugin-marketplace')
  const store = createMarketplaceStore()
  const view = new PluginMarketplaceViewService(bridge, locale, t, sessions, store)
  ctx.effect(
    () => locale.register('dsh-studio.plugin-marketplace', MARKETPLACE_MESSAGES),
    'dsh-studio: marketplace dictionaries',
  )
  slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-studio-plugin-marketplace',
    order: 80,
    locale: 'dsh-studio.plugin-marketplace',
    inject: () => ({ locale, t, view }),
  }, MarketplaceNavigationEntry))
  ctx.effect(() => {
    let disposed = false
    let disposeProvider: (() => Promise<void> | void) | void
    void bridge.getInfo().then(info => {
      if (disposed || info.preview !== null) return
      view.mount()
      void view.hydrate().catch(error => {
        console.warn('[plugin-marketplace] flags unavailable', error)
      })
      disposeProvider = ctx.reflect.provide('pluginMarketplace', view, undefined)
    }).catch((error: unknown) => {
      console.error('plugin-marketplace: failed to inspect the desktop window', error)
    })
    return () => {
      disposed = true
      view.dispose()
      if (typeof disposeProvider === 'function') void disposeProvider()
    }
  }, 'dsh-studio: plugin marketplace')
}