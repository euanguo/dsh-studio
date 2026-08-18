import type {
  MarketplaceAction,
  MarketplaceConfirmation,
  MarketplaceInstalledPlugin,
  MarketplaceRiskLevel,
  MarketplaceRiskReason,
  MarketplaceSourceReview,
} from '../protocol.ts'

export type CatalogSourceKind =
  | 'builtin'
  | 'json'
  | 'github-repository'
  | 'github-topic-snapshot'

export type CatalogSourceTrust = 'builtin' | 'reviewed' | 'user'

export interface CatalogSource {
  digest: string | null
  etag: string | null
  enabled: boolean
  id: string
  kind: CatalogSourceKind
  label: string
  lastCommit: string | null
  lastError: string | null
  lastSuccessfulFetchAt: string | null
  locator: string
  priority: number
  signature: {
    algorithm: 'Ed25519'
    keyId: string
    status: string
  } | null
  trust: CatalogSourceTrust
}

export interface CatalogSnapshot {
  digest: string
  generatedAt: string | null
  plugins: import('../protocol.ts').MarketplacePlugin[]
  source: CatalogSource
}

export interface RepositorySourceRef {
  catalogSourceId?: string | null
  input: string
  kind: 'repository'
  requestedRef?: string | null
  subpath?: string | null
}

export interface CatalogEntrySourceRef {
  catalogSourceId?: string | null
  kind: 'catalog'
  pluginId: string
}

export type SourceRef = CatalogEntrySourceRef | RepositorySourceRef

export interface CanonicalRepositorySource {
  locator: string
  repository: string
  requestedRef: string | null
  subpath: string | null
}

export type MarketplaceCandidateExecution = 'installable' | 'guide-only' | 'blocked'
export type MarketplaceCandidateMechanism = 'bundle' | 'repository' | 'unsupported'

export interface MarketplaceCompatibilityEvidence {
  compatible: boolean | null
  declared: Record<string, string>
  dshVersion: string | null
  reason: string | null
}

export interface MarketplaceMetadataEvidence {
  author: string | null
  displayName: string | null
  homepage: string | null
  keywords: string[]
}

export interface MarketplaceCandidate {
  buildScripts: Record<string, string>
  description: string
  diagnostics: string[]
  evidence: {
    compatibility: MarketplaceCompatibilityEvidence | null
    filesPresent: string[]
    license: string | null
    metadata?: MarketplaceMetadataEvidence | null
    release: Record<string, unknown> | null
    signature: Record<string, unknown> | null
  }
  execution: MarketplaceCandidateExecution
  identity: {
    packageName: string
    pluginId: string
    repository: string
    subpath: string | null
  }
  manifest: {
    artifactDigest: string
    bundlePatch: string | null
    entryTargets: string[]
    hash: string
    license: string | null
    patchHash: string | null
    path: string
    version: string | null
  }
  mechanism: MarketplaceCandidateMechanism
  risk: {
    level: MarketplaceRiskLevel
    reasons: MarketplaceRiskReason[]
    requiredConfirmations: MarketplaceConfirmation[]
  }
  source: {
    catalogSourceId: string | null
    installSpec: string
    kind: 'catalog' | 'direct-repository'
    locator: string
    requestedRef: string | null
    resolvedCommit: string
  }
}

export interface RepositorySourceAdapter {
  readFile(repository: string, path: string, commit: string): Promise<string | null>
  resolveCommit(repository: string, requestedRef?: string | null): Promise<string>
}

export interface CatalogSourceReader {
  (source: CatalogSource, options?: { force?: boolean }): Promise<unknown>
}

export interface MarketplaceSourceResolver {
  makePlan(candidate: MarketplaceCandidate, action: MarketplaceAction): import('../protocol.ts').MarketplacePlan
  resolveCatalogSource(source: CatalogSource, options?: { force?: boolean }): Promise<CatalogSnapshot>
  resolveRepository(sourceRef: RepositorySourceRef): Promise<MarketplaceCandidate>
}

export interface MarketplaceSourceResolverOptions {
  catalogReader?: CatalogSourceReader
  dshVersion?: string | null
  findInstalled?(candidate: MarketplaceCandidate): MarketplaceInstalledPlugin | undefined
  findSourceLock?(candidate: MarketplaceCandidate): import('../protocol.ts').MarketplaceSourceLock | undefined
  repository: RepositorySourceAdapter
}

export interface MarketplaceSourceLockV3 {
  artifactDigest: string
  canonicalSource: string
  catalogSourceId: string | null
  firstSeenCommit: string
  installSpec: string
  manifestHash: string
  manifestPath: string
  mechanism: 'bundle' | 'repository'
  packageName: string
  patchHash: string | null
  pluginId: string
  recordedAt: string
  requestedRef: string | null
  resolvedCommit: string
  subpath: string | null
}

export const FIXTURE_REPOSITORY = 'JUSTMONIKA2022/dsh-sandbox-escalation-fix'
export const FIXTURE_COMMIT = '19f2cb4cecc178313d2f54458badfc1bcb8bc816'
export const PINNED_DSH_VERSION = '0.1.0-rc.7'
