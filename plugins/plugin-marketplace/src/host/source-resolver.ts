import type {
  MarketplaceAction,
  MarketplaceApprovalDecision,
  MarketplaceConfirmation,
  MarketplaceInstalledPlugin,
  MarketplacePlan,
  MarketplaceRiskLevel,
  MarketplaceRiskReason,
  MarketplaceSourceLock,
  MarketplaceSourceReview,
} from '../protocol.ts'
import { CatalogSourceManager } from './catalog-source-manager.ts'
import { validateRepositoryCandidate } from './candidate-validator.ts'
import {
  validateExactCommit,
  validateGitHubRepository,
} from './github-source-adapter.ts'
import type {
  CatalogSnapshot,
  CatalogSource,
  MarketplaceCandidate,
  MarketplaceSourceResolver,
  MarketplaceSourceResolverOptions,
  RepositorySourceAdapter,
  RepositorySourceRef,
} from './source-types.ts'

const REF = /^[A-Za-z0-9._/-]{1,200}$/
const SHELL = /[\u0000\u0001-\u001f\u007f;&|`$<>]/

export class MarketplaceSourceError extends Error {
  readonly code:
    | 'invalid-source-ref'
    | 'source-content-changed'
    | 'source-not-configured'

  constructor(
    code: MarketplaceSourceError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'MarketplaceSourceError'
    this.code = code
  }
}

function safeRef(value: string, label: string): string {
  if (value === '' || value.length > 200 || SHELL.test(value) || !REF.test(value)
    || value.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new MarketplaceSourceError('invalid-source-ref', `${label} is not a safe GitHub ref`)
  }
  return value
}

function safeSubpath(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null
  if (value.length > 300 || value.startsWith('/') || value.includes('\\') || SHELL.test(value)) {
    throw new MarketplaceSourceError('invalid-source-ref', 'repository subpath is not safe')
  }
  const segments = value.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new MarketplaceSourceError('invalid-source-ref', 'repository subpath is not safe')
  }
  return segments.join('/')
}

function splitRef(value: string): { input: string; requestedRef: string | null } {
  let raw = value
  if (raw.startsWith('github:')) raw = raw.slice('github:'.length)
  const atIndex = raw.includes('@') && !raw.startsWith('@') ? raw.indexOf('@') : -1
  const hashIndex = raw.indexOf('#')
  const index = hashIndex >= 0 ? hashIndex : atIndex
  if (index < 0) return { input: raw, requestedRef: null }
  if (hashIndex >= 0 && raw.indexOf('#', hashIndex + 1) >= 0) {
    throw new MarketplaceSourceError('invalid-source-ref', 'repository source contains multiple refs')
  }
  return {
    input: raw.slice(0, index),
    requestedRef: safeRef(raw.slice(index + 1), 'requested ref'),
  }
}

/** Canonicalize only public GitHub owner/repo and optional tree refs. */
export function canonicalizeRepositorySource(source: RepositorySourceRef): {
  locator: string
  repository: string
  requestedRef: string | null
  subpath: string | null
} {
  if (source.kind !== 'repository' || typeof source.input !== 'string') {
    throw new MarketplaceSourceError('invalid-source-ref', 'repository source must contain an input string')
  }
  const raw = source.input.trim()
  if (raw === '' || raw.length > 512 || SHELL.test(raw)
    || /(?:^|\/)\.\.(?:\/|$)/.test(raw)) {
    throw new MarketplaceSourceError('invalid-source-ref', 'repository source is empty or contains unsafe characters')
  }
  const split = splitRef(raw)
  let repository: string
  let urlRef: string | null = null
  let urlSubpath: string | null = null
  if (split.input.startsWith('https://') || split.input.startsWith('http://')) {
    let parsed: URL
    try { parsed = new URL(split.input) } catch {
      throw new MarketplaceSourceError('invalid-source-ref', 'repository URL is invalid')
    }
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com'
      || parsed.username !== '' || parsed.password !== '' || parsed.port !== '' || parsed.search !== '') {
      throw new MarketplaceSourceError('invalid-source-ref', 'only public https://github.com repositories are supported')
    }
    const segments = parsed.pathname.split('/').filter(Boolean).map(segment => {
      try { return decodeURIComponent(segment) } catch { return segment }
    })
    if (segments.length < 2) throw new MarketplaceSourceError('invalid-source-ref', 'GitHub URL must contain owner/repo')
    repository = `${segments[0] ?? ''}/${(segments[1] ?? '').replace(/\.git$/, '')}`
    if (segments[2] !== undefined) {
      if (segments[2] !== 'tree' || segments[3] === undefined) {
        throw new MarketplaceSourceError('invalid-source-ref', 'GitHub URL may only use /tree/<ref>/<subpath>')
      }
      urlRef = safeRef(segments[3], 'requested ref')
      urlSubpath = safeSubpath(segments.slice(4).join('/'))
    }
  } else {
    if (split.input.includes('/') === false || split.input.includes(':')) {
      throw new MarketplaceSourceError('invalid-source-ref', 'repository input must be owner/repo or a GitHub URL')
    }
    repository = split.input.replace(/\.git$/, '')
  }
  validateGitHubRepository(repository)
  const requestedRef = source.requestedRef === undefined || source.requestedRef === null
    ? urlRef ?? split.requestedRef
    : safeRef(source.requestedRef, 'requested ref')
  if (urlRef !== null && split.requestedRef !== null && urlRef !== split.requestedRef) {
    throw new MarketplaceSourceError('invalid-source-ref', 'GitHub URL ref and fragment ref differ')
  }
  const subpath = safeSubpath(source.subpath ?? urlSubpath)
  if (urlSubpath !== null && source.subpath !== undefined && source.subpath !== null && source.subpath !== urlSubpath) {
    throw new MarketplaceSourceError('invalid-source-ref', 'GitHub URL subpath and source subpath differ')
  }
  return {
    locator: `https://github.com/${repository}`,
    repository,
    requestedRef,
    subpath,
  }
}

export function normalizedInstallSpec(repository: string, commit: string): string {
  validateGitHubRepository(repository)
  validateExactCommit(commit)
  const spec = `github:${repository}#${commit}`
  if (!/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9a-f]{40}$/.test(spec)) {
    throw new MarketplaceSourceError('invalid-source-ref', 'normalized installSpec is not safe')
  }
  return spec
}

function canonicalSourceFor(candidate: MarketplaceCandidate): string {
  return `github:${candidate.identity.repository}`
}

function sourceReview(
  candidate: MarketplaceCandidate,
  lock: MarketplaceSourceLock | undefined,
  installed: MarketplaceInstalledPlugin | undefined,
): MarketplaceSourceReview {
  if (lock !== undefined && lock.resolvedCommit === candidate.source.resolvedCommit
    && lock.manifestHash !== candidate.manifest.hash) {
    throw new MarketplaceSourceError(
      'source-content-changed',
      `${candidate.identity.pluginId} changed content at pinned commit ${candidate.source.resolvedCommit}`,
    )
  }
  if (lock === undefined) {
    return installed !== undefined
      && installed.mechanism === candidate.mechanism
      && installed.packageName === candidate.identity.packageName
      && installed.resolvedCommit === candidate.source.resolvedCommit
      ? 'matched'
      : 'first-use'
  }
  return lock.canonicalSource === canonicalSourceFor(candidate)
    && lock.installSpec === candidate.source.installSpec
    && lock.mechanism === candidate.mechanism
    && lock.packageName === candidate.identity.packageName
    ? 'matched'
    : 'changed'
}

function planRisk(
  candidate: MarketplaceCandidate,
  action: MarketplaceAction,
  review: MarketplaceSourceReview,
): { level: MarketplaceRiskLevel; reasons: MarketplaceRiskReason[]; requirements: MarketplaceConfirmation[] } {
  const reasons = [...candidate.risk.reasons]
  const requirements = [...candidate.risk.requiredConfirmations]
  const activatesCode = action === 'install' || action === 'update' || action === 'enable'
  if (candidate.execution !== 'installable') {
    if (!reasons.includes('unsupported-runtime')) reasons.push('unsupported-runtime')
    return { level: 'blocked', reasons, requirements: [] }
  }
  if (activatesCode && candidate.source.kind === 'direct-repository') {
    if (!reasons.includes('untrusted-source')) reasons.push('untrusted-source')
    if (!requirements.includes('accept-high-risk')) requirements.push('accept-high-risk')
  }
  if (activatesCode && Object.keys(candidate.buildScripts).length > 0) {
    if (!reasons.includes('install-scripts')) reasons.push('install-scripts')
    if (!requirements.includes('allow-build-scripts')) requirements.push('allow-build-scripts')
  }
  if (review === 'changed') {
    if (!reasons.includes('source-change')) reasons.push('source-change')
    if (!requirements.includes('accept-source-change')) requirements.push('accept-source-change')
  }
  const level: MarketplaceRiskLevel = reasons.includes('source-change')
    || reasons.includes('untrusted-source') ? 'high' : reasons.length > 0 ? 'elevated' : 'low'
  return { level, reasons, requirements }
}

export function makeMarketplaceApprovalDecision(
  plan: MarketplacePlan | null,
  previewActive: boolean,
  undoAvailable: boolean,
): MarketplaceApprovalDecision {
  return {
    action: plan?.action ?? null,
    applyConfirmationRequired: previewActive,
    buildScriptConfirmationRequired: plan !== null && Object.keys(plan.buildScripts).length > 0,
    recoveryConfirmationRequired: undoAvailable,
    requiredConfirmations: plan?.requirements ?? [],
    riskLevel: plan?.riskLevel ?? 'low',
    riskReasons: plan?.riskReasons ?? [],
    sourceChangeConfirmationRequired: plan?.sourceReview === 'changed',
  }
}

export class DefaultMarketplaceSourceResolver implements MarketplaceSourceResolver {
  readonly #catalog: CatalogSourceManager | null
  readonly #options: MarketplaceSourceResolverOptions

  constructor(options: MarketplaceSourceResolverOptions) {
    this.#catalog = options.catalogReader === undefined ? null : new CatalogSourceManager(options.catalogReader)
    this.#options = options
  }

  async resolveCatalogSource(source: CatalogSource, options: { force?: boolean } = {}): Promise<CatalogSnapshot> {
    if (this.#catalog === null) {
      throw new MarketplaceSourceError('source-not-configured', 'catalog source reader is not configured')
    }
    return await this.#catalog.resolveCatalogSource(source, options)
  }

  async resolveRepository(sourceRef: RepositorySourceRef): Promise<MarketplaceCandidate> {
    const source = canonicalizeRepositorySource(sourceRef)
    const commit = await this.#options.repository.resolveCommit(source.repository, source.requestedRef)
    validateExactCommit(commit)
    const candidate = await validateRepositoryCandidate({
      catalogSourceId: sourceRef.catalogSourceId ?? null,
      dshVersion: this.#options.dshVersion ?? null,
      kind: sourceRef.catalogSourceId === undefined || sourceRef.catalogSourceId === null
        ? 'direct-repository'
        : 'catalog',
      readFile: this.#options.repository.readFile.bind(this.#options.repository),
      resolvedCommit: commit,
      source,
    })
    candidate.source.installSpec = normalizedInstallSpec(source.repository, commit)
    return candidate
  }

  makePlan(candidate: MarketplaceCandidate, action: MarketplaceAction): MarketplacePlan {
    const lock = this.#options.findSourceLock?.(candidate)
    const installed = this.#options.findInstalled?.(candidate)
    const review = sourceReview(candidate, lock, installed)
    const risk = planRisk(candidate, action, review)
    return {
      action,
      artifactDigest: candidate.manifest.artifactDigest,
      buildScripts: candidate.buildScripts,
      catalogSourceId: candidate.source.catalogSourceId,
      description: candidate.description || `Manage ${candidate.identity.pluginId} in the desktop profile.`,
      entryTargets: candidate.manifest.entryTargets,
      execution: candidate.execution,
      installSpec: candidate.source.installSpec,
      license: candidate.manifest.license,
      manifestHash: candidate.manifest.hash,
      manifestPath: candidate.manifest.path,
      mechanism: candidate.mechanism === 'bundle' || candidate.mechanism === 'repository'
        ? candidate.mechanism : 'bundle',
      packageName: candidate.identity.packageName,
      patchHash: candidate.manifest.patchHash,
      pluginId: candidate.identity.pluginId,
      requirements: risk.requirements,
      repository: candidate.identity.repository,
      resolvedCommit: candidate.source.resolvedCommit,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      source: candidate.source.installSpec,
      sourceReview: review,
      subpath: candidate.identity.subpath,
      version: candidate.manifest.version,
    }
  }
}

export function platformRepositoryAdapter(platform: {
  readRepositoryFile(repository: string, path: string, commit: string): Promise<string | null>
  resolveCommit(repository: string, requestedRef?: string | null): Promise<string>
}): RepositorySourceAdapter {
  return {
    readFile: (repository, path, commit) => platform.readRepositoryFile(repository, path, commit),
    resolveCommit: (repository, requestedRef) => platform.resolveCommit(repository, requestedRef),
  }
}
