import type { MarketplaceSourceLock } from '../protocol.ts'
import type { MarketplaceCandidate } from './source-types.ts'

export const MARKETPLACE_STATE_VERSION = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactCommit(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function repositoryFromCanonicalSource(value: string): string | null {
  const match = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:#|$)/.exec(value)
  return match?.[1] ?? null
}

function exactInstallSpec(repository: string, commit: string): string {
  return `github:${repository}#${commit}`
}

/** Validate the v3 source lock fields before they can influence a transaction. */
export function validateMarketplaceSourceLock(value: unknown): value is MarketplaceSourceLock {
  if (!isRecord(value)) return false
  return typeof value.canonicalSource === 'string'
    && (value.catalogSourceId === null || typeof value.catalogSourceId === 'string')
    && exactCommit(value.firstSeenCommit)
    && exactCommit(value.resolvedCommit)
    && (typeof value.requestedRef === 'string' || value.requestedRef === null)
    && typeof value.installSpec === 'string'
    && /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9a-f]{40}$/.test(value.installSpec)
    && hash(value.manifestHash)
    && typeof value.manifestPath === 'string'
    && (value.patchHash === null || hash(value.patchHash))
    && hash(value.artifactDigest)
    && (value.mechanism === 'bundle' || value.mechanism === 'repository')
    && typeof value.packageName === 'string'
    && typeof value.pluginId === 'string'
    && typeof value.recordedAt === 'string'
    && (value.subpath === null || typeof value.subpath === 'string')
}

function migratedLock(value: unknown): MarketplaceSourceLock | null {
  if (!isRecord(value)) return null
  const commit = exactCommit(value.resolvedCommit) ? value.resolvedCommit : null
  const firstSeenCommit = exactCommit(value.firstSeenCommit)
    ? value.firstSeenCommit
    : commit
  const repository = typeof value.canonicalSource === 'string'
    ? repositoryFromCanonicalSource(value.canonicalSource)
    : null
  const installSpec = typeof value.installSpec === 'string'
    && /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9a-f]{40}$/.test(value.installSpec)
    ? value.installSpec
    : repository !== null && commit !== null ? exactInstallSpec(repository, commit) : null
  if (commit === null || firstSeenCommit === null || installSpec === null
    || typeof value.manifestHash !== 'string' || !hash(value.manifestHash)
    || typeof value.packageName !== 'string' || typeof value.pluginId !== 'string'
    || (value.mechanism !== 'bundle' && value.mechanism !== 'repository')) return null
  return {
    artifactDigest: typeof value.artifactDigest === 'string' && hash(value.artifactDigest)
      ? value.artifactDigest
      : value.manifestHash,
    canonicalSource: typeof value.canonicalSource === 'string' ? value.canonicalSource : `github:${repository ?? ''}`,
    catalogSourceId: typeof value.catalogSourceId === 'string' ? value.catalogSourceId : null,
    firstSeenCommit,
    installSpec,
    manifestHash: value.manifestHash,
    manifestPath: typeof value.manifestPath === 'string' ? value.manifestPath : 'package.json',
    mechanism: value.mechanism,
    packageName: value.packageName,
    patchHash: typeof value.patchHash === 'string' && hash(value.patchHash) ? value.patchHash : null,
    pluginId: value.pluginId,
    recordedAt: typeof value.recordedAt === 'string' ? value.recordedAt : new Date(0).toISOString(),
    requestedRef: typeof value.requestedRef === 'string' ? value.requestedRef : null,
    resolvedCommit: commit,
    subpath: typeof value.subpath === 'string' ? value.subpath : null,
  }
}

/** Migrate legacy marketplace locks without inferring trust from absent fields. */
export function migrateMarketplaceLocks(value: unknown): MarketplaceSourceLock[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    const migrated = migratedLock(entry)
    return migrated === null ? [] : [migrated]
  })
}

/** Create the durable lock facts for an inspected candidate. */
export function sourceLockFromCandidate(
  candidate: MarketplaceCandidate,
  previous?: MarketplaceSourceLock,
): MarketplaceSourceLock {
  if (candidate.mechanism !== 'bundle' && candidate.mechanism !== 'repository') {
    throw new Error('source lock requires a supported marketplace mechanism')
  }
  return {
    artifactDigest: candidate.manifest.artifactDigest,
    canonicalSource: `github:${candidate.identity.repository}`,
    catalogSourceId: candidate.source.catalogSourceId,
    firstSeenCommit: previous?.firstSeenCommit ?? candidate.source.resolvedCommit,
    installSpec: candidate.source.installSpec,
    manifestHash: candidate.manifest.hash,
    manifestPath: candidate.manifest.path,
    mechanism: candidate.mechanism,
    packageName: candidate.identity.packageName,
    patchHash: candidate.manifest.patchHash,
    pluginId: candidate.identity.pluginId,
    recordedAt: previous?.recordedAt ?? new Date().toISOString(),
    requestedRef: candidate.source.requestedRef,
    resolvedCommit: candidate.source.resolvedCommit,
    subpath: candidate.identity.subpath,
  }
}
