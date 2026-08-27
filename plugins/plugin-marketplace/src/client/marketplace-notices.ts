/**
 * marketplace-notices.ts (leaf-4.2)
 * ---------------------------------------------------------------------
 * Notice / error banner derivation for the marketplace surface. Host message
 * strings are translated back into localized notices; error/auth detail text
 * is mapped onto the message dict. Pure helpers — no UI, no state.
 */
import type { Translate } from '@dsh-studio/shared/i18n'
import type {
  MarketplaceAction,
  MarketplaceSnapshot,
} from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'

/** Translate an auth `detail` from the host into a localized guide line. */
export function localizedAuthDetail(
  detail: string,
  t: Translate<MarketplaceMessage>,
): string {
  if (detail.startsWith('Install GitHub CLI')) return t('auth.install-gh')
  if (detail === 'Authenticated with GitHub CLI.') return t('auth.ready')
  if (detail === 'Plugin catalog has not been refreshed yet.') {
    return t('auth.not-refreshed')
  }
  return detail
}

/** Translate a host change-push message (lastAction) into a localized notice. */
export function localizedHostMessage(
  message: string,
  t: Translate<MarketplaceMessage>,
): string {
  let match = /^Loaded (\d+) catalog plugins\.$/.exec(message)
  if (match !== null) return t('notice.loaded', { count: match[1] })
  match = /^Isolated (install|update|enable|disable|uninstall) preview is ready for (.+)\.$/.exec(message)
  if (match !== null) {
    const action = t(`action.${match[1] as MarketplaceAction}`)
    return t('notice.preview-ready', { action, plugin: match[2] })
  }
  match = /^Isolated pack preview is ready for (.+)\.$/.exec(message)
  if (match !== null) return t('notice.preview-ready', { action: t('action.pack'), plugin: match[1] })
  match = /^Discarded the (?:staged )?(.+?)(?: preview| change) without changing the (?:(?:desktop|live) )?profile\.$/.exec(message)
  if (match !== null) return t('notice.discarded', { plugin: match[1] })
  match = /^Applied (.+); the previous profile remains available for Undo\.$/.exec(message)
  if (match !== null) return t('notice.applied', { plugin: match[1] })
  match = /^Applied (.+); the previous profile remains available for Undo; restart required\.$/.exec(message)
  if (match !== null) return t('notice.direct', { plugin: match[1] })
  match = /^Staged (.+) for (.+)\.$/.exec(message)
  if (match !== null) return t('notice.staged', { plugin: match[2] })
  match = /^Staged pack (.+)\.$/.exec(message)
  if (match !== null) return t('notice.staged', { plugin: `pack ${match[1]}` })
  match = /^Cancelled marketplace operation for (.+)\.$/.exec(message)
  if (match !== null) return t('notice.cancelled', { plugin: match[1] })
  match = /^Restored the profile from before (.+) was applied\.$/.exec(message)
  if (match !== null) return t('notice.restored', { plugin: match[1] })
  return message
}

/** The modal subtitle line carrying the loaded-catalog count, if any. */
export function marketplaceLoadedNotice(
  snapshot: MarketplaceSnapshot | null,
  t: Translate<MarketplaceMessage>,
): string | null {
  return snapshot !== null
    ? t('notice.loaded', { count: snapshot.catalog.length })
    : null
}

/** Non-error "last action" notice string, localized, or null. */
export function marketplaceActionNotice(
  snapshot: MarketplaceSnapshot | null,
  error: string | null,
  t: Translate<MarketplaceMessage>,
): string | null {
  const lastAction = snapshot?.lastAction ?? null
  if (lastAction === null || error !== null) return null
  const notice = localizedHostMessage(lastAction, t)
  const loaded = marketplaceLoadedNotice(snapshot, t)
  return notice !== loaded ? notice : null
}