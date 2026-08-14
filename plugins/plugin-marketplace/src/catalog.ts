import type {
  MarketplaceInstalledPlugin,
  MarketplaceMechanism,
  MarketplacePlugin,
} from './protocol.ts'
import {
  isProtectedMarketplacePlugin,
} from './protocol.ts'

export interface MarketplaceCatalog {
  generatedAt: string | null
  plugins: MarketplacePlugin[]
}

interface CatalogRepository {
  bundle?: unknown
  category?: unknown
  description?: unknown
  empty?: unknown
  hide?: unknown
  name?: unknown
  note?: unknown
  pushedAt?: unknown
  repository?: unknown
  repo?: unknown
  url?: unknown
  tags?: unknown
}

interface NormalizedCatalogRow {
  category: string
  description: string
  id: string
  mechanism: MarketplaceMechanism
  pushedAt: string | null
  repository: string
  tags: string[]
  title: string
  trust: MarketplacePlugin['trust']
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function mechanism(row: CatalogRepository): MarketplaceMechanism {
  if (row.bundle === true) return 'bundle'
  if (row.repository === true) return 'repository'
  return 'unsupported'
}

function runtimeRisk(value: MarketplaceMechanism): MarketplacePlugin['runtimeRisk'] {
  if (value === 'bundle') return 'profile-bundle'
  if (value === 'repository' || value === 'discover') return 'trusted-host'
  return 'guided'
}

function validRepositoryPart(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value)
}

function repositoryName(value: unknown): string | null {
  const text = cleanString(value)
  if (text === null) return null
  const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(text)
  if (match === null || !validRepositoryPart(match[1] ?? '') || !validRepositoryPart(match[2] ?? '')) {
    return null
  }
  return `${match[1]}/${match[2]}`
}

function tags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap(tag => cleanString(tag) === null ? [] : [cleanString(tag) as string]).slice(0, 16)
    : []
}

function legacyRows(value: Record<string, unknown>): NormalizedCatalogRow[] | null {
  if (value.schema !== 'dsh-external-hub/v0.1' || !Array.isArray(value.repos)) return null
  return value.repos.flatMap(candidate => {
    if (!isRecord(candidate)) return []
    const row = candidate as CatalogRepository
    const id = cleanString(row.name)
    if (id === null || !validRepositoryPart(id) || row.hide === true || row.empty === true) return []
    const repository = repositoryName(row.repo) ?? repositoryName(row.url) ?? `dsh-external/${id}`
    return [{
      category: cleanString(row.category) ?? 'other',
      description: cleanString(row.note) ?? cleanString(row.description) ?? 'No description provided.',
      id,
      mechanism: mechanism(row),
      pushedAt: cleanString(row.pushedAt),
      repository,
      tags: tags(row.tags),
      title: id,
      trust: repository.startsWith('dsh-external/') ? 'organization' : 'community',
      url: `https://github.com/${repository}`,
    }]
  })
}

function registryRows(value: Record<string, unknown>): NormalizedCatalogRow[] | null {
  if (value.schema !== 'omdsh-registry/v1' || !Array.isArray(value.entries)) return null
  return value.entries.flatMap(candidate => {
    if (!isRecord(candidate) || !isRecord(candidate.source)) return []
    const id = cleanString(candidate.id)
    const repository = repositoryName(candidate.source.repository)
    if (id === null || !validRepositoryPart(id) || repository === null) return []
    const install = isRecord(candidate.install) ? candidate.install : {}
    const mode = install.mode
    const installMechanism: MarketplaceMechanism = mode === 'profile-bundle'
      ? 'bundle'
      : mode === 'repository-plugin' ? 'repository' : 'unsupported'
    return [{
      category: cleanString(candidate.kind) ?? 'other',
      description: cleanString(candidate.description) ?? 'No description provided.',
      id,
      mechanism: installMechanism,
      pushedAt: null,
      repository,
      tags: tags(candidate.tags),
      title: cleanString(candidate.displayName) ?? id,
      trust: isRecord(candidate.listing) && candidate.listing.state === 'reviewed'
        ? 'organization'
        : 'community',
      url: `https://github.com/${repository}`,
    }]
  })
}

function communityRows(value: Record<string, unknown>): NormalizedCatalogRow[] | null {
  if (!isRecord(value._meta) || value._meta.schema_version !== '1.0' || !Array.isArray(value.plugins)) {
    return null
  }
  return value.plugins.flatMap(candidate => {
    if (!isRecord(candidate)) return []
    const id = cleanString(candidate.id)
    const repository = repositoryName(candidate.repo) ?? repositoryName(candidate.url)
    if (id === null || !validRepositoryPart(id) || repository === null) return []
    const description = isRecord(candidate.description)
      ? cleanString(candidate.description.en) ?? cleanString(candidate.description.zh)
      : cleanString(candidate.description)
    return [{
      category: cleanString(candidate.category) ?? 'other',
      description: description ?? 'No description provided.',
      id,
      mechanism: 'discover',
      pushedAt: null,
      repository,
      tags: tags(candidate.tags),
      title: cleanString(candidate.name) ?? id,
      trust: 'community',
      url: `https://github.com/${repository}`,
    }]
  })
}

/** Parse supported public catalog schemas without trusting their source paths. */
export function parseMarketplaceCatalog(
  value: unknown,
  installed: readonly MarketplaceInstalledPlugin[] = [],
): MarketplaceCatalog {
  if (!isRecord(value)) throw new Error('unsupported plugin catalog')
  const rows = legacyRows(value) ?? registryRows(value) ?? communityRows(value)
  if (rows === null) throw new Error('unsupported plugin catalog')
  const installedIds = new Set(installed.map(entry => entry.pluginId))
  const plugins: MarketplacePlugin[] = rows.map(row => ({
      category: row.category,
      currentCommit: null,
      description: row.description,
      enabled: false,
      id: row.id,
      installed: installedIds.has(row.id),
      latestCommit: null,
      mechanism: row.mechanism,
      protected: isProtectedMarketplacePlugin(row.id, row.repository),
      pushedAt: row.pushedAt,
      repository: row.repository,
      runtimeRisk: runtimeRisk(row.mechanism),
      tags: row.tags,
      title: row.title,
      trust: row.trust,
      updateAvailable: false,
      url: row.url,
    }))
  plugins.sort((left, right) => {
    if (left.installed !== right.installed) return left.installed ? -1 : 1
    if (left.mechanism === 'unsupported' && right.mechanism !== 'unsupported') return 1
    if (right.mechanism === 'unsupported' && left.mechanism !== 'unsupported') return -1
    return left.title.localeCompare(right.title)
  })
  return {
    generatedAt: cleanString(value.generated) ?? cleanString(value.generatedAt)
      ?? (isRecord(value._meta) ? cleanString(value._meta.generated_at) : null),
    plugins,
  }
}
