/**
 * Pinned summary plugin entry: injects the service wiring only; the
 * implementation lives in service.ts, the stylesheet in summary.css and the
 * dictionaries in i18n.ts.
 */
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import type { DesktopPanels } from '@dsh-studio/panel-controls/client'
import {
  PINNED_SUMMARY_MESSAGES,
  type PinnedSummaryMessage,
} from './i18n.ts'
import {
  PinnedSummaryService,
  type PinnedSummary,
  type SessionsService,
} from './service.ts'

export type { PinnedSummary } from './service.ts'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): () => Promise<void> | void
  }
}

export const inject = ['desktopPanels', 'locale', 'sessions']

/** Provide the pinned-summary service and its layout-reserving DOM surface. */
export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<PinnedSummaryMessage> = locale.bind('dsh-studio.pinned-summary')
  ctx.effect(
    () => locale.register('dsh-studio.pinned-summary', PINNED_SUMMARY_MESSAGES),
    'dsh-studio: pinned summary dictionaries',
  )
  const service = new PinnedSummaryService(
    ctx.get('sessions') as SessionsService,
    locale,
    t,
    ctx.get('desktopPanels') as DesktopPanels,
  )
  ctx.effect(() => {
    service.mount()
    const disposeService = ctx.reflect.provide('pinnedSummary', service, undefined)
    return () => {
      service.dispose()
      void disposeService()
    }
  }, 'dsh-studio: pinned summary')
}