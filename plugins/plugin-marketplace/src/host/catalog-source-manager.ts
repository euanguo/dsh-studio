import { createHash } from 'node:crypto'
import { parseMarketplaceCatalog } from '../catalog.ts'
import type { MarketplacePlugin } from '../protocol.ts'
import type {
  CatalogSnapshot,
  CatalogSource,
  CatalogSourceReader,
} from './source-types.ts'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function identity(plugin: MarketplacePlugin): string {
  return `${plugin.repository.toLowerCase()}\u0000${plugin.id.toLowerCase()}`
}

function withSource(plugin: MarketplacePlugin, source: CatalogSource): MarketplacePlugin {
  return { ...plugin, catalogSourceId: source.id }
}

/** Load catalog snapshots and merge duplicate identities by explicit priority. */
export class CatalogSourceManager {
  readonly #reader: CatalogSourceReader

  constructor(reader: CatalogSourceReader) {
    this.#reader = reader
  }

  async resolveCatalogSource(source: CatalogSource, options: { force?: boolean } = {}): Promise<CatalogSnapshot> {
    const document = await this.#reader(source, options)
    const catalog = parseMarketplaceCatalog(document)
    return {
      digest: digest(document),
      generatedAt: catalog.generatedAt,
      plugins: catalog.plugins.map(plugin => withSource(plugin, source)),
      source,
    }
  }

  merge(snapshots: readonly CatalogSnapshot[]): MarketplacePlugin[] {
    const selected = new Map<string, { plugin: MarketplacePlugin; source: CatalogSource }>()
    const ordered = [...snapshots].sort((left, right) => right.source.priority - left.source.priority
      || left.source.id.localeCompare(right.source.id))
    for (const snapshot of ordered) {
      for (const plugin of snapshot.plugins) {
        const key = identity(plugin)
        if (!selected.has(key)) selected.set(key, { plugin, source: snapshot.source })
      }
    }
    return [...selected.values()].map(entry => withSource(entry.plugin, entry.source))
  }
}

export function catalogSnapshotDigest(value: unknown): string {
  return digest(value)
}
