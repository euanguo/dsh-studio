import type { Translate } from '@dsh-studio/shared/i18n'
import type {
  MarketplaceCompatibilityStatus,
  MarketplaceConfirmation,
  MarketplacePlan,
  MarketplacePlugin,
  MarketplaceRiskReason,
  MarketplaceSort,
} from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'

export function shortCommit(commit: string): string {
  return commit.slice(0, 10)
}

export function localizedDescription(plugin: MarketplacePlugin, locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? plugin.descriptionByLocale.zh : plugin.descriptionByLocale.en
}

export function formatMarketplaceCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`
}

export function compatibilityTone(status: MarketplaceCompatibilityStatus): 'positive' | 'neutral' | 'negative' {
  return status === 'ok' ? 'positive' : status === 'unknown' ? 'neutral' : 'negative'
}

export function compatibilityLabel(
  status: MarketplaceCompatibilityStatus,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`compatibility.${status}`)
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
  const parts = [plugin.category, mechanismLabel(plugin, t), compatibilityLabel(plugin.compatibility.status, t)]
  if (plugin.installed) parts.push(plugin.enabled ? t('enabled') : t('disabled'))
  else parts.push(t('not-installed'))
  if (plugin.updateAvailable) parts.push(t('update-available'))
  if (plugin.protected) parts.push(t('managed'))
  return parts.join(' · ')
}

function recencyScore(pushedAt: string | null): number {
  if (pushedAt === null) return 0
  const timestamp = Date.parse(pushedAt)
  if (!Number.isFinite(timestamp)) return 0
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000)
  return Math.exp(-ageDays / 180)
}

function trustScore(plugin: MarketplacePlugin): number {
  if (plugin.trust === 'organization') return 1
  if (plugin.trust === 'community') return 0.7
  return 0.2
}

export function marketplaceScore(plugin: MarketplacePlugin): number {
  const compatibility = plugin.compatibility.status === 'ok'
    ? 1
    : plugin.compatibility.status === 'unknown' ? 0.55 : 0
  const stars = Math.log10(Math.max(1, plugin.stars) + 1) / 6
  const downloads = Math.log10(Math.max(1, plugin.downloads ?? 0) + 1) / 7
  const suppliedScore = plugin.score === null ? 0.5 : Math.min(1, Math.max(0, plugin.score / 100))
  return compatibility * 0.3
    + stars * 0.25
    + recencyScore(plugin.pushedAt) * 0.15
    + downloads * 0.15
    + trustScore(plugin) * 0.1
    + suppliedScore * 0.05
}

export function sortMarketplacePlugins(
  plugins: readonly MarketplacePlugin[],
  sort: MarketplaceSort,
): MarketplacePlugin[] {
  return [...plugins].sort((left, right) => {
    if (left.installed !== right.installed) return left.installed ? -1 : 1
    if (sort === 'name') return left.title.localeCompare(right.title)
    if (sort === 'stars') return right.stars - left.stars || left.title.localeCompare(right.title)
    if (sort === 'downloads') return (right.downloads ?? -1) - (left.downloads ?? -1) || left.title.localeCompare(right.title)
    if (sort === 'updated') return Date.parse(right.pushedAt ?? '') - Date.parse(left.pushedAt ?? '') || left.title.localeCompare(right.title)
    return marketplaceScore(right) - marketplaceScore(left) || right.stars - left.stars || left.title.localeCompare(right.title)
  })
}

export function planCanInstallDirectly(plan: MarketplacePlan | null): boolean {
  return plan?.fastPathEligible === true && plan.execution === 'installable' && plan.requirements.length === 0
}
