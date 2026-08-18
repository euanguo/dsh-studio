import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  CanonicalRepositorySource,
  MarketplaceCandidate,
  MarketplaceCandidateExecution,
  MarketplaceCompatibilityEvidence,
  RepositorySourceAdapter,
} from './source-types.ts'
import { validateExactCommit } from './github-source-adapter.ts'

const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepack'] as const
const PACKAGE_NAME = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export type CandidateValidationErrorCode =
  | 'invalid-entry-path'
  | 'invalid-manifest'
  | 'invalid-patch'
  | 'missing-entry'
  | 'missing-manifest'
  | 'missing-patch'

export class CandidateValidationError extends Error {
  readonly code: CandidateValidationErrorCode

  constructor(code: CandidateValidationErrorCode, message: string) {
    super(message)
    this.name = 'CandidateValidationError'
    this.code = code
  }
}

export interface CandidateValidationInput {
  catalogSourceId: string | null
  dshVersion?: string | null
  kind: 'catalog' | 'direct-repository'
  readFile: RepositorySourceAdapter['readFile']
  resolvedCommit: string
  source: CanonicalRepositorySource
}

interface PackageManifest {
  author?: unknown
  description?: unknown
  displayName?: unknown
  dsh?: {
    bundle?: { patch?: unknown }
    client?: unknown
    market?: {
      author?: unknown
      displayName?: unknown
      homepage?: unknown
      keywords?: unknown
    }
  }
  exports?: unknown
  homepage?: unknown
  keywords?: unknown
  license?: unknown
  main?: unknown
  name?: unknown
  peerDependencies?: unknown
  repository?: unknown
  scripts?: unknown
  version?: unknown
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap(item => typeof item === 'string' && item.trim() !== '' ? [item.trim()] : [])
    : []
}

function extractMetadata(manifest: PackageManifest): {
  author: string | null
  displayName: string | null
  homepage: string | null
  keywords: string[]
} {
  const market = isRecord(manifest.dsh?.market) ? manifest.dsh?.market as Record<string, unknown> : {}
  const repo = isRecord(manifest.repository) && typeof manifest.repository.url === 'string'
    ? manifest.repository.url
    : null
  return {
    author: stringOrNull(market.author) ?? stringOrNull(manifest.author) ?? (isRecord(manifest.author) ? stringOrNull((manifest.author as Record<string, unknown>).name) : null),
    displayName: stringOrNull(market.displayName) ?? stringOrNull(manifest.displayName) ?? stringOrNull(manifest.name),
    homepage: stringOrNull(market.homepage) ?? stringOrNull(manifest.homepage) ?? stringOrNull(repo),
    keywords: [...new Set([...stringArray(market.keywords), ...stringArray(manifest.keywords)])],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function packageRootPath(source: CanonicalRepositorySource, path: string): string {
  if (source.subpath === null) return path
  return `${source.subpath}/${path}`
}

function validRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return false
  const normalized = value.startsWith('./') ? value.slice(2) : value
  if (normalized === '' || normalized.startsWith('/') || normalized.includes('\\') || normalized.includes('\u0000')) return false
  const segments = normalized.split('/')
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function relativeEntryPath(value: unknown, label: string): string {
  if (!validRelativePath(value)) {
    throw new CandidateValidationError('invalid-entry-path', `${label} is not a safe package-relative path`)
  }
  const path = value.startsWith('./') ? value.slice(2) : value
  return path
}

function packageName(manifest: PackageManifest): string {
  if (typeof manifest.name !== 'string' || !PACKAGE_NAME.test(manifest.name)) {
    throw new CandidateValidationError('invalid-manifest', 'package.json must declare a valid package name')
  }
  return manifest.name
}

function pluginIdFor(packageNameValue: string): string {
  const id = packageNameValue.split('/').at(-1) ?? packageNameValue
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id)) {
    throw new CandidateValidationError('invalid-manifest', 'package name cannot produce a safe plugin id')
  }
  return id
}

function licenseValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (isRecord(value) && typeof value.type === 'string' && value.type.trim() !== '') return value.type.trim()
  return null
}

function scripts(manifest: PackageManifest): Record<string, string> {
  if (!isRecord(manifest.scripts)) return {}
  const result: Record<string, string> = {}
  for (const name of LIFECYCLE_SCRIPTS) {
    const value = manifest.scripts[name]
    if (typeof value === 'string' && value.trim() !== '') result[name] = value
  }
  return result
}

function invalidScripts(manifest: PackageManifest): string[] {
  if (!isRecord(manifest.scripts)) return []
  return LIFECYCLE_SCRIPTS.filter(name => Object.hasOwn(manifest.scripts as object, name)
    && typeof (manifest.scripts as Record<string, unknown>)[name] !== 'string')
}

function collectExportPaths(value: unknown, targets: Set<string>, condition?: string): void {
  if (typeof value === 'string') {
    if (condition !== 'types' && condition !== 'typings'
      && !value.includes('*') && value.trim() !== '') {
      targets.add(value)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach(entry => { collectExportPaths(entry, targets, condition) })
    return
  }
  if (!isRecord(value)) return
  Object.entries(value).forEach(([key, entry]) => {
    collectExportPaths(entry, targets, key)
  })
}

function generatedEntrySources(target: string): string[] {
  const normalized = target.startsWith('./') ? target.slice(2) : target
  const match = /^(?:lib|dist)\/(.+)\.(?:mjs|cjs|js)$/.exec(normalized)
  if (match === null) return []
  const stem = match[1] ?? ''
  return ['.ts', '.mts', '.tsx', '.js', '.mjs', '.cjs']
    .map(extension => `src/${stem}${extension}`)
}

function entryTargets(manifest: PackageManifest): string[] {
  const targets = new Set<string>()
  if (manifest.main !== undefined) targets.add(relativeEntryPath(manifest.main, 'main'))
  if (manifest.exports !== undefined) collectExportPaths(manifest.exports, targets)
  const client = manifest.dsh?.client
  if (typeof client === 'string') targets.add(relativeEntryPath(client, 'dsh.client'))
  else if (isRecord(client)) {
    for (const key of ['entry', 'path']) {
      if (client[key] !== undefined) targets.add(relativeEntryPath(client[key], `dsh.client.${key}`))
    }
  }
  const normalized = [...targets].map(target => target.startsWith('./') ? target.slice(2) : target)
  if (normalized.length === 0) {
    throw new CandidateValidationError('missing-entry', 'package.json must declare main, exports, or a dsh.client entry')
  }
  return [...new Set(normalized)]
}

function patchPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CandidateValidationError('invalid-manifest', 'dsh.bundle.patch must be a non-empty string')
  }
  return relativeEntryPath(value.startsWith('./') ? value.slice(2) : value, 'dsh.bundle.patch')
}

function parsePatch(text: string, path: string): void {
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new CandidateValidationError('invalid-patch', `${path} is not valid YAML: ${String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new CandidateValidationError('invalid-patch', `${path} must be a top-level YAML array`)
  }
  for (const [index, entry] of parsed.entries()) {
    if (!isRecord(entry)) {
      throw new CandidateValidationError('invalid-patch', `${path} entry ${String(index + 1)} must be a mapping`)
    }
  }
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function artifactDigest(files: ReadonlyMap<string, string>): string {
  const digest = createHash('sha256')
  for (const path of [...files.keys()].sort()) {
    digest.update(path).update('\u0000').update(files.get(path) ?? '').update('\u0000')
  }
  return digest.digest('hex')
}

function versionParts(value: string): { main: number[]; pre: string[] } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value)
  if (match === null) return null
  return {
    main: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  if (a === null || b === null) return Number.NaN
  for (let index = 0; index < 3; index += 1) {
    if ((a.main[index] ?? 0) !== (b.main[index] ?? 0)) {
      return (a.main[index] ?? 0) < (b.main[index] ?? 0) ? -1 : 1
    }
  }
  if (a.pre.length === 0 && b.pre.length > 0) return 1
  if (a.pre.length > 0 && b.pre.length === 0) return -1
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const leftPart = a.pre[index]
    const rightPart = b.pre[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber < rightNumber ? -1 : 1
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function simplePeerRangeSatisfied(version: string, range: string): boolean {
  for (const alternative of range.split('||')) {
    const tokens = alternative.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0 || tokens.every(token => token === '*' || token.toLowerCase() === 'x')) return true
    let accepted = true
    for (const token of tokens) {
      const match = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(token)
      if (match === null) {
        accepted = false
        break
      }
      const operator = match[1] ?? '='
      const target = match[2] ?? ''
      const comparison = compareVersions(version, target)
      if (Number.isNaN(comparison)) {
        accepted = false
        break
      }
      if (operator === '=' && comparison !== 0) accepted = false
      if (operator === '>' && comparison <= 0) accepted = false
      if (operator === '>=' && comparison < 0) accepted = false
      if (operator === '<' && comparison >= 0) accepted = false
      if (operator === '<=' && comparison > 0) accepted = false
      if (operator === '^' || operator === '~') {
        const targetParts = versionParts(target)
        const versionPartsValue = versionParts(version)
        if (targetParts === null || versionPartsValue === null || comparison < 0) {
          accepted = false
        } else {
          const targetMajor = targetParts.main[0] ?? 0
          const targetMinor = targetParts.main[1] ?? 0
          const targetPatch = targetParts.main[2] ?? 0
          const versionMajor = versionPartsValue.main[0] ?? 0
          const versionMinor = versionPartsValue.main[1] ?? 0
          const versionPatch = versionPartsValue.main[2] ?? 0
          if (operator === '~' && (versionMajor !== targetMajor || versionMinor !== targetMinor)) accepted = false
          if (operator === '^' && (targetMajor > 0
            ? versionMajor !== targetMajor
            : targetMinor > 0
              ? versionMajor !== 0 || versionMinor !== targetMinor
              : versionMajor !== 0 || versionMinor !== 0 || versionPatch !== targetPatch)) accepted = false
        }
      }
    }
    if (accepted) return true
  }
  return false
}

function dshPeerCompatibility(
  manifest: PackageManifest,
  dshVersion: string | null,
): MarketplaceCompatibilityEvidence | null {
  if (!isRecord(manifest.peerDependencies)) return null
  const declared = Object.fromEntries(Object.entries(manifest.peerDependencies)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  const dshPeers = Object.entries(declared).filter(([name]) => name === 'deepseek-harness'
    || name === '@deepseek-ai/dsh'
    || name.startsWith('@deepseek-ai/dsh-'))
  if (dshPeers.length === 0) return null
  if (dshVersion === null || dshVersion === '') {
    return {
      compatible: null,
      declared,
      dshVersion: null,
      reason: 'pinned DSH version was not supplied',
    }
  }
  for (const [name, range] of dshPeers) {
    try {
      if (!simplePeerRangeSatisfied(dshVersion, range)) {
        return {
          compatible: false,
          declared,
          dshVersion,
          reason: `${name} requires ${range}`,
        }
      }
    } catch {
      return {
        compatible: false,
        declared,
        dshVersion,
        reason: `${name} declares an invalid peer range ${range}`,
      }
    }
  }
  return { compatible: true, declared, dshVersion, reason: null }
}

function executionFor(
  diagnostics: string[],
  source: CanonicalRepositorySource,
  compatibility: MarketplaceCompatibilityEvidence | null,
  version: string | null,
  license: string | null,
  entries: readonly string[],
): MarketplaceCandidateExecution {
  if (source.subpath !== null) diagnostics.push('monorepo subpaths are diagnostic-only until a package-manager subpath adapter exists')
  if (compatibility?.compatible === false) diagnostics.push(compatibility.reason ?? 'DSH peer compatibility failed')
  if (version === null) diagnostics.push('package.json must declare a valid version')
  if (license === null) diagnostics.push('package.json must declare a license')
  if (entries.length === 0) diagnostics.push('package.json declares no verified entry')
  return diagnostics.length > 0 ? 'blocked' : 'installable'
}

function unsupportedCandidate(
  manifestText: string,
  manifest: PackageManifest,
  input: CandidateValidationInput,
  manifestPath: string,
  diagnostic: string,
): MarketplaceCandidate {
  const name = packageName(manifest)
  const license = licenseValue(manifest.license)
  const version = typeof manifest.version === 'string' && SEMVER.test(manifest.version)
    ? manifest.version
    : null
  return {
    buildScripts: scripts(manifest),
    description: typeof manifest.description === 'string' ? manifest.description : '',
    diagnostics: [diagnostic],
    evidence: {
      compatibility: dshPeerCompatibility(manifest, input.dshVersion ?? null),
      filesPresent: [manifestPath],
      license,
      metadata: extractMetadata(manifest),
      release: null,
      signature: null,
    },
    execution: 'guide-only',
    identity: {
      packageName: name,
      pluginId: pluginIdFor(name),
      repository: input.source.repository,
      subpath: input.source.subpath,
    },
    manifest: {
      artifactDigest: hash(manifestText),
      bundlePatch: null,
      entryTargets: [],
      hash: hash(manifestText),
      license,
      patchHash: null,
      path: manifestPath,
      version,
    },
    mechanism: 'repository',
    risk: {
      level: 'blocked',
      reasons: ['unsupported-runtime'],
      requiredConfirmations: [],
    },
    source: {
      catalogSourceId: input.catalogSourceId ?? null,
      installSpec: `github:${input.source.repository}#${input.resolvedCommit}`,
      kind: input.kind,
      locator: input.source.locator,
      requestedRef: input.source.requestedRef,
      resolvedCommit: input.resolvedCommit,
    },
  }
}

/** Validate the exact manifest, patch, entries, metadata, and lifecycle scripts. */
export async function validateRepositoryCandidate(
  input: CandidateValidationInput,
): Promise<MarketplaceCandidate> {
  validateExactCommit(input.resolvedCommit)
  const manifestPath = packageRootPath(input.source, 'package.json')
  const manifestText = await input.readFile(input.source.repository, manifestPath, input.resolvedCommit)
  if (manifestText === null) {
    throw new CandidateValidationError('missing-manifest', `${manifestPath} is missing at ${input.resolvedCommit}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText) as unknown
  } catch (error) {
    throw new CandidateValidationError('invalid-manifest', `${manifestPath} is not valid JSON: ${String(error)}`)
  }
  if (!isRecord(parsed)) throw new CandidateValidationError('invalid-manifest', `${manifestPath} must contain an object`)
  const manifest = parsed as PackageManifest
  const name = packageName(manifest)
  const unsupportedPath = packageRootPath(input.source, '.dsh-plugin/package.json')
  const bundlePatchValue = manifest.dsh?.bundle?.patch
  if (typeof bundlePatchValue !== 'string') {
    const repositoryText = await input.readFile(input.source.repository, unsupportedPath, input.resolvedCommit)
    if (repositoryText !== null) {
      let repositoryManifest: unknown
      try { repositoryManifest = JSON.parse(repositoryText) as unknown } catch { repositoryManifest = {} }
      return unsupportedCandidate(
        repositoryText,
        isRecord(repositoryManifest) ? repositoryManifest as PackageManifest : manifest,
        input,
        unsupportedPath,
        'repository-plugin manifests are guide-only on the pinned DSH runtime',
      )
    }
    return unsupportedCandidate(
      manifestText,
      manifest,
      input,
      manifestPath,
      'package does not declare dsh.bundle.patch and is not installable by the pinned DSH runtime',
    )
  }

  const declaredPatch = patchPath(bundlePatchValue)
  const patchPathValue = packageRootPath(input.source, declaredPatch)
  const patchText = await input.readFile(input.source.repository, patchPathValue, input.resolvedCommit)
  if (patchText === null) {
    throw new CandidateValidationError('missing-patch', `${patchPathValue} is missing at ${input.resolvedCommit}`)
  }
  parsePatch(patchText, patchPathValue)
  const diagnostics: string[] = []
  const blockingDiagnostics = invalidScripts(manifest).map(name =>
    `${name} lifecycle entry must be a string`)
  diagnostics.push(...blockingDiagnostics)
  const lifecycle = scripts(manifest)
  const targets = entryTargets(manifest)
  const files = new Map<string, string>([
    [manifestPath, manifestText],
    [patchPathValue, patchText],
  ])
  for (const target of targets) {
    const targetPath = packageRootPath(input.source, posix.normalize(target))
    if (!validRelativePath(target)) {
      throw new CandidateValidationError('invalid-entry-path', `${target} is not a safe package-relative path`)
    }
    const targetText = await input.readFile(input.source.repository, targetPath, input.resolvedCommit)
    if (targetText !== null) {
      files.set(targetPath, targetText)
      continue
    }
    if (lifecycle.prepare === undefined) {
      throw new CandidateValidationError('missing-entry', `${targetPath} is missing at ${input.resolvedCommit}`)
    }
    let generatedSource: string | null = null
    for (const sourceTarget of generatedEntrySources(target)) {
      const sourcePath = packageRootPath(input.source, sourceTarget)
      const sourceText = await input.readFile(input.source.repository, sourcePath, input.resolvedCommit)
      if (sourceText !== null) {
        files.set(sourcePath, sourceText)
        generatedSource = sourcePath
        break
      }
    }
    if (generatedSource === null) {
      throw new CandidateValidationError('missing-entry', `${targetPath} is missing at ${input.resolvedCommit}`)
    }
    diagnostics.push(`${targetPath} will be materialized by prepare from ${generatedSource}`)
  }
  const license = licenseValue(manifest.license)
  const version = typeof manifest.version === 'string' && SEMVER.test(manifest.version)
    ? manifest.version
    : null
  const compatibility = dshPeerCompatibility(manifest, input.dshVersion ?? null)
  const execution = executionFor(blockingDiagnostics, input.source, compatibility, version, license, targets)
  for (const diagnostic of blockingDiagnostics) {
    if (!diagnostics.includes(diagnostic)) diagnostics.push(diagnostic)
  }
  const artifact = artifactDigest(files)
  const metadata = extractMetadata(manifest)
  const candidate: MarketplaceCandidate = {
    buildScripts: scripts(manifest),
    description: typeof manifest.description === 'string' ? manifest.description : '',
    diagnostics,
    evidence: {
      compatibility,
      filesPresent: [...files.keys()],
      license,
      metadata,
      release: null,
      signature: null,
    },
    execution,
    identity: {
      packageName: name,
      pluginId: pluginIdFor(name),
      repository: input.source.repository,
      subpath: input.source.subpath,
    },
    manifest: {
      artifactDigest: artifact,
      bundlePatch: declaredPatch,
      entryTargets: targets,
      hash: hash(manifestText),
      license,
      patchHash: hash(patchText),
      path: manifestPath,
      version,
    },
    mechanism: 'bundle',
    risk: {
      level: 'low',
      reasons: [],
      requiredConfirmations: [],
    },
    source: {
      catalogSourceId: input.catalogSourceId ?? null,
      installSpec: `github:${input.source.repository}#${input.resolvedCommit}`,
      kind: input.kind,
      locator: input.source.locator,
      requestedRef: input.source.requestedRef,
      resolvedCommit: input.resolvedCommit,
    },
  }
  if (execution !== 'installable') {
    const reason: import('../protocol.ts').MarketplaceRiskReason = compatibility?.compatible === false
      ? 'incompatible-peer'
      : 'unsupported-runtime'
    candidate.risk = { level: 'blocked', reasons: [reason], requiredConfirmations: [] }
  }
  return candidate
}
