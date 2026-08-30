import { isMarketplaceArtifactUrl } from '../catalog.ts'
import type { MarketplaceSourceLock } from '../protocol.ts'
import type { MarketplaceCandidate } from './source-types.ts'

export const MARKETPLACE_STATE_VERSION = 4

const HASH = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const PACKAGE = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactCommit(value: unknown): value is string {
  return typeof value === 'string' && COMMIT.test(value)
}

function exactHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value)
}

function validRepository(value: string): boolean {
  return REPOSITORY.test(value)
}

function validPackage(value: string): boolean {
  return PACKAGE.test(value)
}

function validVersion(value: string | null): boolean {
  return value === null || VERSION.test(value)
}

function validArtifactUrl(value: string | null): boolean {
  if (value === null) return true
  return isMarketplaceArtifactUrl(value)
}

function channelSpec(value: string, channel: MarketplaceSourceLock['channel'], packageName: string, version: string | null, artifactUrl: string | null, repository: string, commit: string): boolean {
  if (channel === 'github') return value === `github:${repository}#${commit}`
  if (channel === 'npm') return version !== null && value === `npm:${packageName}@${version}`
  if (artifactUrl === null || !value.startsWith(`tarball:${artifactUrl}#`)) return false
  return exactHash(value.slice(`tarball:${artifactUrl}#`.length))
}

/** Validate the canonical v4 source lock before it can influence a transaction. */
export function validateMarketplaceSourceLock(value: unknown): value is MarketplaceSourceLock {
  if (!isRecord(value)) return false
  if (typeof value.canonicalSource !== 'string'
    || (value.catalogSourceId !== null && typeof value.catalogSourceId !== 'string')
    || !exactCommit(value.firstSeenCommit)
    || !exactCommit(value.resolvedCommit)
    || (typeof value.requestedRef !== 'string' && value.requestedRef !== null)
    || typeof value.installSpec !== 'string'
    || !exactHash(value.manifestHash)
    || typeof value.manifestPath !== 'string'
    || (value.patchHash !== null && !exactHash(value.patchHash))
    || !exactHash(value.artifactDigest)
    || (value.mechanism !== 'bundle' && value.mechanism !== 'repository')
    || typeof value.packageName !== 'string'
    || !validPackage(value.packageName)
    || typeof value.pluginId !== 'string'
    || typeof value.recordedAt !== 'string'
    || (value.subpath !== null && typeof value.subpath !== 'string')
    || (value.channel !== 'github' && value.channel !== 'npm' && value.channel !== 'tarball')
    || (value.version !== null && typeof value.version !== 'string')
    || !validVersion(value.version)
    || (value.artifactUrl !== null && typeof value.artifactUrl !== 'string')
    || !validArtifactUrl(value.artifactUrl)) return false

  const canonical = value.canonicalSource.match(/^github:(.+)$/)?.[1] ?? null
  if (canonical === null || !validRepository(canonical)) return false
  if (value.channel === 'tarball' ? value.artifactUrl === null : value.artifactUrl !== null) return false
  if (!channelSpec(value.installSpec, value.channel, value.packageName, value.version, value.artifactUrl, canonical, value.resolvedCommit)) return false
  if (value.channel === 'tarball') {
    const digest = value.installSpec.slice(value.installSpec.lastIndexOf('#') + 1)
    if (!exactHash(digest)) return false
  }
  return true
}

function migratedLock(value: unknown): MarketplaceSourceLock | null {
  if (!isRecord(value)) return null
  const repository = typeof value.canonicalSource === 'string'
    ? value.canonicalSource.match(/^github:(.+)$/)?.[1] ?? null
    : null
  const commit = exactCommit(value.resolvedCommit) ? value.resolvedCommit : null
  const firstSeenCommit = exactCommit(value.firstSeenCommit) ? value.firstSeenCommit : commit
  if (repository === null || !validRepository(repository) || commit === null || firstSeenCommit === null
    || typeof value.manifestHash !== 'string' || !exactHash(value.manifestHash)
    || typeof value.packageName !== 'string' || !validPackage(value.packageName)
    || typeof value.pluginId !== 'string'
    || (value.mechanism !== 'bundle' && value.mechanism !== 'repository')) return null
  const channel = value.channel === 'npm' || value.channel === 'tarball' ? value.channel : 'github'
  // Old records did not contain enough facts to prove npm/tarball provenance.
  // Preserve the installed artifact as an exact GitHub lock rather than inventing
  // a new channel during the non-destructive persisted-state migration.
  const normalizedChannel: MarketplaceSourceLock['channel'] = channel === 'github' ? 'github' : 'github'
  return {
    artifactDigest: typeof value.artifactDigest === 'string' && exactHash(value.artifactDigest)
      ? value.artifactDigest : value.manifestHash,
    artifactUrl: null,
    canonicalSource: `github:${repository}`,
    catalogSourceId: typeof value.catalogSourceId === 'string' ? value.catalogSourceId : null,
    channel: normalizedChannel,
    firstSeenCommit,
    installSpec: `github:${repository}#${commit}`,
    manifestHash: value.manifestHash,
    manifestPath: typeof value.manifestPath === 'string' ? value.manifestPath : 'package.json',
    mechanism: value.mechanism,
    packageName: value.packageName,
    patchHash: typeof value.patchHash === 'string' && exactHash(value.patchHash) ? value.patchHash : null,
    pluginId: value.pluginId,
    recordedAt: typeof value.recordedAt === 'string' ? value.recordedAt : new Date(0).toISOString(),
    requestedRef: typeof value.requestedRef === 'string' ? value.requestedRef : null,
    resolvedCommit: commit,
    subpath: typeof value.subpath === 'string' ? value.subpath : null,
    version: typeof value.version === 'string' && VERSION.test(value.version) ? value.version : null,
  }
}

/** Migrate persisted marketplace locks without inventing npm/tarball provenance. */
export function migrateMarketplaceLocks(value: unknown): MarketplaceSourceLock[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    const migrated = migratedLock(entry)
    return migrated === null ? [] : [migrated]
  })
}

/** Create durable lock facts for an inspected candidate. */
export function sourceLockFromCandidate(
  candidate: MarketplaceCandidate,
  previous?: MarketplaceSourceLock,
): MarketplaceSourceLock {
  if (candidate.mechanism !== 'bundle' && candidate.mechanism !== 'repository') {
    throw new Error('source lock requires a supported marketplace mechanism')
  }
  return {
    artifactDigest: candidate.manifest.artifactDigest,
    artifactUrl: candidate.source.artifactUrl,
    canonicalSource: `github:${candidate.identity.repository}`,
    catalogSourceId: candidate.source.catalogSourceId,
    channel: candidate.source.channel,
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
    version: candidate.source.version,
  }
}
