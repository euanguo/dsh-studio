/** Marketplace i18n helpers — pure label resolution (split out of the
 *  plugin entry so the card/detail surfaces share one implementation). */
import type { Translate } from '@dsh-studio/shared/i18n'
import type {
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceRiskReason,
} from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'

export function shortCommit(commit: string): string {
  return commit.slice(0, 10)
}

export function mechanismLabel(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`mechanism.${plugin.mechanism}`)
}

export function runtimeRiskLabel(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`risk.${plugin.runtimeRisk}`)
}

export function riskReasonLabel(
  reason: MarketplaceRiskReason,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`risk-reason.${reason}`)
}

export function confirmationLabel(
  confirmation: MarketplaceConfirmation,
  t: Translate<MarketplaceMessage>,
): string {
  if (confirmation === 'allow-build-scripts') return t('allow-scripts')
  if (confirmation === 'accept-high-risk') return t('accept-high-risk')
  return t('accept-source-change')
}

export function pluginMeta(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  const parts = [plugin.category, mechanismLabel(plugin, t)]
  if (plugin.installed) parts.push(plugin.enabled ? t('enabled') : t('disabled'))
  else parts.push(t('not-installed'))
  if (plugin.updateAvailable) parts.push(t('update-available'))
  if (plugin.protected) parts.push(t('managed'))
  return parts.join(' · ')
}