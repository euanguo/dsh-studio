import type {
  MarketplaceCompatibility,
  MarketplaceInstalledPlugin,
  MarketplaceInstallChannel,
  MarketplaceMechanism,
  MarketplacePlugin,
} from './protocol.ts'
import { isProtectedMarketplacePlugin } from './protocol.ts'

export interface MarketplaceCatalog {
  generatedAt: string | null
  plugins: MarketplacePlugin[]
  watchlist: MarketplacePlugin[]
}

type RawCatalogEntry = Record<string, unknown>

const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SAFE_IMAGE_HOSTS = new Set(['github.com', 'raw.githubusercontent.com', 'user-images.githubusercontent.com'])
const SAFE_ARTIFACT_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'])
const COMPATIBILITY: MarketplaceCompatibility['status'][] = ['unknown', 'ok', 'broken', 'unmaintained']

function isRecord(value: unknown): value is RawCatalogEntry {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function readmeSummary(value: unknown): string | null {
  const candidate = text(value)
  if (candidate === null) return null
  return candidate.replace(/<[^>]*>/g, '').slice(0, 4096)
}

function repository(value: unknown): string | null {
  const candidate = text(value)
  if (candidate === null) return null
  const normalized = candidate
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/^github:/i, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
  return REPOSITORY.test(normalized) ? normalized : null
}

function slug(value: unknown): string | null {
  const candidate = text(value)?.toLowerCase() ?? null
  return candidate !== null && SLUG.test(candidate) ? candidate : null
}

function localizedDescription(value: unknown, fallback: string): { en: string; zh: string } {
  if (!isRecord(value)) return { en: fallback, zh: fallback }
  const en = text(value.en) ?? fallback
  const zh = text(value.zh) ?? en
  return { en, zh }
}

function safeImage(value: unknown, repo: string): string | null {
  const candidate = text(value)
  if (candidate === null) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !SAFE_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return null
    if (url.hostname.toLowerCase() === 'github.com' && !url.pathname.includes(`/${repo}/`)) return null
    return url.toString()
  } catch {
    return null
  }
}

function artifactUrl(value: unknown): string | null {
  const candidate = text(value)
  if (candidate === null) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !SAFE_ARTIFACT_HOSTS.has(url.hostname.toLowerCase())
      || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null
    if (url.hostname.toLowerCase() === 'github.com' && !url.pathname.includes('/releases/download/')) return null
    return url.toString()
  } catch {
    return null
  }
}

function screenshots(value: unknown, repo: string): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap(item => {
    const image = safeImage(item, repo)
    return image === null ? [] : [image]
  }))].slice(0, 8)
}

function compatibility(value: unknown): MarketplaceCompatibility {
  if (!isRecord(value)) return { status: 'unknown', dshVersion: null, lastVerified: null, note: null }
  const status = COMPATIBILITY.includes(value.status as MarketplaceCompatibility['status'])
    ? value.status as MarketplaceCompatibility['status']
    : 'unknown'
  return {
    status,
    dshVersion: text(value.dshVersion),
    lastVerified: text(value.lastVerified),
    note: text(value.note),
  }
}

function channel(value: RawCatalogEntry): MarketplaceInstallChannel | null {
  const npm = text(value.npm)
  return npm === null ? 'github' : 'npm'
}

function mechanism(value: RawCatalogEntry): MarketplaceMechanism {
  if (value.mechanism === 'unsupported') return 'unsupported'
  if (value.mechanism === 'repository' || value.repository === true) return 'repository'
  // Canonical dsh-suite rows describe DSH repositories; an omitted or
  // discover-shaped mechanism is still a normal bundle admission candidate.
  if (value.mechanism === 'bundle' || value.mechanism === 'discover'
    || value.bundle === true || value.dshBundle === true || value.mechanism === undefined) return 'bundle'
  return 'discover'
}

function runtimeRisk(value: RawCatalogEntry, kind: MarketplaceMechanism): MarketplacePlugin['runtimeRisk'] {
  const risk = isRecord(value.risk) ? value.risk : null
  if (risk?.shellAccess === true || risk?.networkEgress === true) return 'trusted-host'
  if (kind === 'bundle') return 'profile-bundle'
  if (kind === 'repository') return 'trusted-host'
  return 'guided'
}

function normalizedEntry(value: unknown, installedIds: ReadonlySet<string>, watched: boolean): MarketplacePlugin | null {
  if (!isRecord(value)) return null
  const id = slug(value.id ?? value.name)
  const repo = repository(value.repo ?? value.repository ?? value.url)
  if (id === null || repo === null) return null
  const fallbackDescription = text(value.name) ?? id
  const descriptions = localizedDescription(value.description, fallbackDescription)
  const kind = mechanism(value)
  const compat = compatibility(value.compat)
  const risk = isRecord(value.risk) ? value.risk : null
  const stars = finiteNumber(value.stars) ?? 0
  const downloads = finiteNumber(value.downloads)
  const weeklyGrowth = finiteNumber(value.weeklyGrowth)
  const evidence = isRecord(value.evidence) ? value.evidence : null
  const install = text(value.install)
  const npm = text(value.npm)
  const releaseAssetUrl = artifactUrl(value.releaseAssetUrl ?? value.tarballUrl)
  const releaseAssetDigest = releaseAssetUrl === null ? null : text(value.releaseAssetDigest ?? value.tarballDigest)
  const plugin: MarketplacePlugin = {
    catalogSourceId: null,
    category: text(value.category) ?? 'other',
    compatibility: compat,
    currentCommit: null,
    description: descriptions.en,
    descriptionByLocale: descriptions,
    downloads,
    enabled: false,
    evidenceLevel: finiteNumber(evidence?.level),
    homepage: text(value.homepage),
    installCommand: install,
    id,
    installed: installedIds.has(id),
    latestCommit: null,
    mechanism: kind,
    npm,
    officialBeta: value.isOfficialBeta === true,
    preferredChannel: channel(value),
    protected: isProtectedMarketplacePlugin(id, repo, npm),
    pushedAt: text(value.last_push ?? value.pushedAt),
    readmeSummary: readmeSummary(value.readmeSummary),
    releaseAssetUrl,
    releaseAssetDigest,
    repository: repo,
    runtimeRisk: runtimeRisk(value, kind),
    score: finiteNumber(value.score),
    scoreExplanation: text(value.scoreExplanation ?? value.explanation),
    screenshots: screenshots(value.screenshots, repo),
    sourceNote: text(value.sourceNote),
    stars,
    tags: Array.isArray(value.tags)
      ? [...new Set(value.tags.flatMap(item => {
        const tag = text(item)
        return tag === null ? [] : [tag]
      }))].slice(0, 32)
      : [],
    title: text(value.title ?? value.name) ?? id,
    trust: value.trust === 'organization' ? 'organization' : 'community',
    updateAvailable: false,
    url: `https://github.com/${repo}`,
    version: text(value.version),
    watchReason: watched ? text(value.watchReason) ?? 'watchlist' : null,
    weeklyGrowth,
  }
  if (risk?.noLicense === true && plugin.compatibility.note === null) {
    plugin.compatibility = { ...plugin.compatibility, note: 'catalog flagged missing license' }
  }
  return plugin
}

function uniquePluginIds(plugins: readonly MarketplacePlugin[], used: Set<string>): MarketplacePlugin[] {
  return plugins.flatMap(plugin => {
    if (!used.has(plugin.id)) {
      used.add(plugin.id)
      return [plugin]
    }
    const suffix = plugin.repository.replace('/', '-').toLowerCase()
    let id = `${plugin.id}-${suffix}`
    let serial = 2
    while (used.has(id)) {
      id = `${plugin.id}-${suffix}-${String(serial)}`
      serial += 1
    }
    used.add(id)
    return [{ ...plugin, id }]
  })
}

function compareCatalogEntries(left: MarketplacePlugin, right: MarketplacePlugin): number {
  if (left.installed !== right.installed) return left.installed ? -1 : 1
  if (left.compatibility.status !== right.compatibility.status) {
    const rank = (status: MarketplaceCompatibility['status']): number => status === 'ok' ? 0 : status === 'unknown' ? 1 : 2
    const difference = rank(left.compatibility.status) - rank(right.compatibility.status)
    if (difference !== 0) return difference
  }
  if (left.stars !== right.stars) return right.stars - left.stars
  return left.title.localeCompare(right.title)
}

/** Parse the one canonical dsh-suite/awesome-dsh-plugin catalog schema. */
export function parseMarketplaceCatalog(
  value: unknown,
  installed: readonly MarketplaceInstalledPlugin[] = [],
): MarketplaceCatalog {
  if (!isRecord(value) || !isRecord(value._meta) || value._meta.schema_version !== '1.0'
    || !Array.isArray(value.plugins)) {
    throw new Error('unsupported DSH plugin catalog: expected schema_version 1.0')
  }
  const installedIds = new Set(installed.map(entry => entry.pluginId))
  const usedIds = new Set<string>()
  const plugins = uniquePluginIds(value.plugins.flatMap(entry => {
    const normalized = normalizedEntry(entry, installedIds, false)
    return normalized === null ? [] : [normalized]
  }), usedIds).sort(compareCatalogEntries)
  const watchlist = Array.isArray(value.watchlist)
    ? uniquePluginIds(value.watchlist.flatMap(entry => {
      const normalized = normalizedEntry(entry, installedIds, true)
      return normalized === null ? [] : [normalized]
    }), usedIds).sort(compareCatalogEntries)
    : []
  return {
    generatedAt: text(value._meta.generated_at) ?? text(value.generatedAt),
    plugins,
    watchlist,
  }
}

export function isMarketplaceArtifactUrl(value: string): boolean {
  return artifactUrl(value) !== null
}

export function isMarketplaceImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && SAFE_IMAGE_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}
