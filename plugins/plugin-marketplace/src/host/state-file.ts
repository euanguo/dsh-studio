// Marketplace state-file semantics: the `.dsh-studio/marketplace.json`
// receipts/locks document, the profile package.json bundle flags, and the
// plan-application that mutates a candidate preview profile. Phase policy
// stays in transaction-manager.ts; disk mechanics come from fs-ops.ts.
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type {
  MarketplaceCandidate,
  MarketplaceInstalledPlugin,
  MarketplacePlan,
  MarketplaceSourceLock,
} from '../protocol.ts'
import { isProtectedMarketplacePlugin } from '../protocol.ts'
import type { MarketplacePlatform } from './platform.ts'
import { MARKETPLACE_STATE_VERSION, migrateMarketplaceLocks, sourceLockFromCandidate, validateMarketplaceSourceLock } from './source-lock.ts'
import type { MarketplaceSourceResolver } from './source-types.ts'
import { allowBuild } from './allowbuild-yaml.ts'
import { assertBundleEntryFiles, assertPortableBundleProfile, ensureWithin, isRecord, message, removeWithin } from './fs-ops.ts'

export const STATE_VERSION = MARKETPLACE_STATE_VERSION
export const MANAGED_DIRECTORY = '.dsh-studio'
const STATE_FILE = 'marketplace.json'

export interface MarketplaceStateFile {
  entries: MarketplaceInstalledPlugin[]
  locks: MarketplaceSourceLock[]
  version: typeof STATE_VERSION
}

interface PackageManifest {
  dependencies?: unknown
  dsh?: {
    bundle?: { patch?: unknown }
    profile?: { bundles?: unknown }
  }
  name?: unknown
  scripts?: unknown
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${String(process.pid)}-${randomUUID()}`
  writeFileSync(temporary, JSON.stringify(value, undefined, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}

function validateInstalledEntry(value: unknown): value is MarketplaceInstalledPlugin {
  if (!isRecord(value)) return false
  return typeof value.pluginId === 'string'
    && /^[A-Za-z0-9_.-]{1,100}$/.test(value.pluginId)
    && (value.mechanism === 'bundle' || value.mechanism === 'repository')
    && (value.packageName === null || typeof value.packageName === 'string')
    && typeof value.resolvedCommit === 'string'
    && /^[0-9a-f]{40}$/.test(value.resolvedCommit)
    && typeof value.source === 'string'
    && typeof value.installedAt === 'string'
}

export function readMarketplaceState(profileDir: string): MarketplaceStateFile {
  const path = join(profileDir, MANAGED_DIRECTORY, STATE_FILE)
  if (!existsSync(path)) return { entries: [], locks: [], version: STATE_VERSION }
  try {
    const parsed = readJson(path)
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
      throw new Error('unsupported marketplace state version')
    }
    if (parsed.version === 1) {
      return {
        entries: parsed.entries.filter(validateInstalledEntry),
        locks: [],
        version: STATE_VERSION,
      }
    }
    if ((parsed.version !== 2 && parsed.version !== STATE_VERSION) || !Array.isArray(parsed.locks)) {
      throw new Error('unsupported marketplace state version')
    }
    return {
      entries: parsed.entries.filter(validateInstalledEntry),
      locks: migrateMarketplaceLocks(parsed.locks).filter(validateMarketplaceSourceLock),
      version: STATE_VERSION,
    }
  } catch (error) {
    throw new Error(`failed to read plugin marketplace state at ${path}: ${message(error)}`)
  }
}

export function writeMarketplaceState(profileDir: string, state: MarketplaceStateFile): void {
  writeJsonAtomic(join(profileDir, MANAGED_DIRECTORY, STATE_FILE), {
    entries: state.entries,
    locks: state.locks,
    version: STATE_VERSION,
  } satisfies MarketplaceStateFile)
}

function profileManifest(profileDir: string): PackageManifest {
  const path = join(profileDir, 'package.json')
  const manifest = readJson(path)
  if (!isRecord(manifest)) throw new Error(`${path} must contain an object`)
  return manifest as PackageManifest
}

function profileBundles(manifest: PackageManifest): string[] {
  const bundles = manifest.dsh?.profile?.bundles
  return Array.isArray(bundles)
    ? bundles.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function bundleInstalled(profileDir: string, packageNameValue: string | null): boolean {
  if (packageNameValue === null) return false
  const dependencies = profileManifest(profileDir).dependencies
  return isRecord(dependencies) && typeof dependencies[packageNameValue] === 'string'
}

export function bundleEnabled(profileDir: string, packageNameValue: string | null): boolean {
  return packageNameValue !== null
    && profileBundles(profileManifest(profileDir)).includes(packageNameValue)
}

export function setBundleEnabled(
  profileDir: string,
  packageNameValue: string,
  enabled: boolean,
): void {
  const path = join(profileDir, 'package.json')
  const manifest = profileManifest(profileDir)
  if (!isRecord(manifest.dsh)) manifest.dsh = {}
  if (!isRecord(manifest.dsh.profile)) manifest.dsh.profile = {}
  const current = profileBundles(manifest)
  manifest.dsh.profile.bundles = enabled
    ? current.includes(packageNameValue) ? current : [...current, packageNameValue]
    : current.filter(entry => entry !== packageNameValue)
  writeJsonAtomic(path, manifest)
}

export function installedEntryEnabled(
  profileDir: string,
  entry: MarketplaceInstalledPlugin,
): boolean {
  return entry.mechanism === 'bundle' ? bundleEnabled(profileDir, entry.packageName) : false
}

function repositoryFromSource(source: string): string | null {
  const match = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#/.exec(source)
  return match?.[1] ?? null
}

/** Projection of an already-installed entry into its management plan/candidate
 *  (uninstall / enable / disable). Guide-only repository receipts short-circuit
 *  with a blocked plan; bundle receipts resolve into a full candidate. */
export async function buildManageCandidate(
  args: {
    action: 'uninstall' | 'enable' | 'disable'
    requestedPluginId: string
    current: MarketplaceInstalledPlugin
    lock: MarketplaceSourceLock | undefined
    profileDir: string
    resolver: MarketplaceSourceResolver
  },
): Promise<{ guideOnly: true, plan: MarketplacePlan } | { guideOnly: false, candidate: MarketplaceCandidate }> {
  const { action, requestedPluginId, current, lock, profileDir, resolver } = args
  const enabled = installedEntryEnabled(profileDir, current)
  if (action === 'enable' && enabled) throw new Error(`${requestedPluginId} is already enabled`)
  if (action === 'disable' && !enabled) throw new Error(`${requestedPluginId} is already disabled`)
  if (current.mechanism !== 'bundle') {
    const plan: MarketplacePlan = {
      action,
      artifactDigest: '',
      buildScripts: {},
      catalogSourceId: null,
      description: `Manage ${requestedPluginId} in the desktop profile.`,
      entryTargets: [],
      execution: 'guide-only',
      installSpec: current.source,
      license: null,
      manifestHash: '',
      manifestPath: '.dsh-plugin/package.json',
      mechanism: 'repository',
      packageName: current.packageName,
      patchHash: null,
      pluginId: requestedPluginId,
      requirements: [],
      repository: repositoryFromSource(current.source) ?? 'unknown/unknown',
      resolvedCommit: current.resolvedCommit,
      riskLevel: 'blocked',
      riskReasons: ['unsupported-runtime'],
      source: current.source,
      sourceReview: 'matched',
      subpath: null,
      version: null,
    }
    return { guideOnly: true, plan }
  }
  const candidate: MarketplaceCandidate = {
    buildScripts: {},
    description: `Manage ${requestedPluginId} in the desktop profile.`,
    diagnostics: [],
    evidence: {
      compatibility: null,
      filesPresent: lock === undefined ? [] : [lock.manifestPath],
      license: null,
      release: null,
      signature: null,
    },
    execution: 'installable',
    identity: {
      packageName: current.packageName ?? '',
      pluginId: requestedPluginId,
      repository: repositoryFromSource(current.source) ?? 'unknown/unknown',
      subpath: lock?.subpath ?? null,
    },
    manifest: {
      artifactDigest: lock?.artifactDigest ?? '',
      bundlePatch: null,
      entryTargets: [],
      hash: lock?.manifestHash ?? '',
      license: null,
      patchHash: lock?.patchHash ?? null,
      path: lock?.manifestPath ?? 'package.json',
      version: null,
    },
    mechanism: 'bundle',
    risk: { level: 'low', reasons: [], requiredConfirmations: [] },
    source: {
      catalogSourceId: lock?.catalogSourceId ?? null,
      installSpec: lock?.installSpec ?? current.source,
      kind: lock?.catalogSourceId === null ? 'direct-repository' : 'catalog',
      locator: `https://github.com/${repositoryFromSource(current.source) ?? 'unknown/unknown'}`,
      requestedRef: lock?.requestedRef ?? null,
      resolvedCommit: current.resolvedCommit,
    },
  }
  return { guideOnly: false, candidate }
}

/** Resolve an install/update candidate from a repository ref or the loaded
 *  catalog, enforcing the same install/update preconditions as before. */
export async function resolveInstallCandidate(
  args: {
    resolver: MarketplaceSourceResolver
    action: 'install' | 'update'
    pluginId?: string | undefined
    sourceRef?: Parameters<MarketplaceSourceResolver['resolveRepository']>[0] | undefined
    catalog: {
      id: string
      mechanism: string
      protected?: boolean
      repository: string
      catalogSourceId?: string | null
    }[]
    stateEntries: MarketplaceInstalledPlugin[]
  },
): Promise<MarketplaceCandidate> {
  const { resolver, action, pluginId, sourceRef, catalog, stateEntries } = args
  if (pluginId !== undefined) {
    const current = stateEntries.find(entry => entry.pluginId === pluginId)
    if (action === 'install' && current !== undefined) throw new Error(`${pluginId} is already installed`)
    if (action === 'update' && current === undefined) throw new Error(`${pluginId} is not installed`)
  }
  let repositoryRef: Parameters<MarketplaceSourceResolver['resolveRepository']>[0]
  let catalogPlugin: (typeof catalog)[number] | undefined
  if (sourceRef !== undefined && 'kind' in sourceRef && sourceRef.kind === 'repository') {
    repositoryRef = sourceRef
  } else {
    if (pluginId === undefined) throw new Error('install/update requires a plugin id or repository sourceRef')
    catalogPlugin = catalog.find(plugin => plugin.id === pluginId)
    if (catalogPlugin === undefined) throw new Error(`plugin is not present in the loaded catalog: ${pluginId}`)
    if (catalogPlugin.mechanism === 'unsupported' || catalogPlugin.mechanism === 'repository') {
      throw new Error(`${pluginId} is guide-only or blocked by the pinned DSH runtime`)
    }
    if (catalogPlugin.protected === true
      || isProtectedMarketplacePlugin(pluginId, catalogPlugin.repository)) {
      throw new Error(`${pluginId} is protected by the desktop and cannot be modified by its own marketplace`)
    }
    repositoryRef = {
      catalogSourceId: catalogPlugin.catalogSourceId ?? 'builtin',
      input: catalogPlugin.repository,
      kind: 'repository',
      requestedRef: null,
      subpath: null,
    }
  }
  const candidate = await resolver.resolveRepository(repositoryRef)
  if (catalogPlugin !== undefined) candidate.identity.pluginId = catalogPlugin.id
  if (isProtectedMarketplacePlugin(
    candidate.identity.pluginId,
    candidate.identity.repository,
    candidate.identity.packageName,
  )) {
    throw new Error(`${candidate.identity.pluginId} is protected by the desktop and cannot be modified by its own marketplace`)
  }
  const current = stateEntries.find(entry => entry.pluginId === candidate.identity.pluginId
    || entry.packageName === candidate.identity.packageName)
  if (action === 'install' && current !== undefined) throw new Error(`${candidate.identity.pluginId} is already installed`)
  if (action === 'update' && current === undefined) throw new Error(`${candidate.identity.pluginId} is not installed`)
  if (action === 'update' && current?.resolvedCommit === candidate.source.resolvedCommit) {
    throw new Error(`${candidate.identity.pluginId} is already at the latest commit`)
  }
  return candidate
}

function normalizeBundleDependency(
  profileDir: string,
  packageNameValue: string,
  checkout: string,
): void {
  ensureWithin(profileDir, checkout)
  const path = join(profileDir, 'package.json')
  const manifest = readJson(path)
  if (!isRecord(manifest) || !isRecord(manifest.dependencies)) {
    throw new Error('DSH profile package.json is missing dependencies')
  }
  const source = relative(profileDir, checkout).split(sep).join('/')
  if (source === '' || source === '..' || source.startsWith('../')) {
    throw new Error(`bundle checkout is not portable from the profile: ${checkout}`)
  }
  manifest.dependencies[packageNameValue] = `link:${source}`
  writeJsonAtomic(path, manifest)
}

export interface PreviewProfilePlanContext {
  /** Platform operations, restricted to what profile mutation needs. */
  platform: Pick<MarketplacePlatform, 'buildBundle' | 'cloneRepository' | 'runDsh'>
  /** Manager-owned teardown of one previously installed bundle. */
  removeBundle: (installed: MarketplaceInstalledPlugin) => Promise<void>
  warn: (message_: string) => void
  profileName: string
  candidateHome: string
  candidateProfile: string
  root: string
  plan: MarketplacePlan
  candidate: MarketplaceCandidate
}

/**
 * Mutate the candidate preview profile exactly as the plan prescribes
 * (install/update/uninstall/enable/disable), leaving receipts, locks and
 * bundle flags consistent. Throws before any preview handle exists so the
 * orchestrator can fall back to planning and tear the tree down.
 */
export async function applyPlanToPreviewProfile(ctx: PreviewProfilePlanContext): Promise<void> {
  const { plan, candidateProfile, candidateHome, root } = ctx
  const candidateState = readMarketplaceState(candidateProfile)
  const current = candidateState.entries
  const remaining = current.filter(entry => entry.pluginId !== plan.pluginId
    && (plan.packageName === null || entry.packageName !== plan.packageName))
  const existing = current.find(entry => entry.pluginId === plan.pluginId
    || (plan.packageName !== null && entry.packageName === plan.packageName))
  if (plan.action === 'install' || plan.action === 'update') {
    const preserveEnabled = existing === undefined
      ? true
      : installedEntryEnabled(candidateProfile, existing)
    const installed: MarketplaceInstalledPlugin = {
      installedAt: new Date().toISOString(),
      mechanism: plan.mechanism,
      packageName: plan.packageName,
      pluginId: plan.pluginId,
      resolvedCommit: plan.resolvedCommit,
      source: plan.source,
    }
    if (existing?.mechanism === 'bundle'
      && (plan.mechanism !== 'bundle' || existing.packageName !== plan.packageName)) {
      await ctx.removeBundle(existing)
    }
    if (plan.mechanism === 'bundle') {
      if (plan.packageName === null) throw new Error('bundle plan is missing its package name')
      const sources = join(candidateProfile, MANAGED_DIRECTORY, 'sources')
      if (existsSync(sources)) {
        for (const entry of readdirSync(sources)) {
          if (entry.startsWith(`${plan.pluginId}-`)) {
            removeWithin(sources, join(sources, entry), ctx.warn)
          }
        }
      }
      mkdirSync(sources, { recursive: true, mode: 0o700 })
      const sourceName = `${plan.pluginId}-${plan.resolvedCommit.slice(0, 12)}`
      const checkout = join(sources, sourceName)
      const scriptNames = Object.keys(plan.buildScripts)
      const cloneTarget = scriptNames.length > 0
        ? join(root, 'bundle-builds', sourceName)
        : checkout
      await ctx.platform.cloneRepository(
        plan.repository,
        plan.resolvedCommit,
        cloneTarget,
      )
      if (scriptNames.length > 0) {
        allowBuild(candidateProfile, plan.packageName)
        await ctx.platform.buildBundle({
          checkout: cloneTarget,
          sandboxRoot: root,
          scripts: scriptNames,
        })
        renameSync(cloneTarget, checkout)
        assertBundleEntryFiles(checkout, plan.entryTargets)
      }
      await ctx.platform.runDsh({
        args: ['plugin', '--profile', ctx.profileName, 'add', checkout],
        dshHome: candidateHome,
        sandboxRoot: root,
      })
      if (scriptNames.length === 0) assertBundleEntryFiles(checkout, plan.entryTargets)
      const manifest = readJson(join(candidateProfile, 'package.json'))
      if (!isRecord(manifest) || !isRecord(manifest.dependencies)
        || typeof manifest.dependencies[plan.packageName] !== 'string') {
        throw new Error(`DSH did not add ${plan.packageName} to the preview profile`)
      }
      normalizeBundleDependency(candidateProfile, plan.packageName, checkout)
      await ctx.platform.runDsh({
        args: ['plugin', '--profile', ctx.profileName, 'install', '--ignore-scripts'],
        dshHome: candidateHome,
        sandboxRoot: root,
      })
      setBundleEnabled(candidateProfile, plan.packageName, preserveEnabled)
      assertPortableBundleProfile(candidateProfile, root)
    }
    const next = [...remaining, installed]
    const previousLock = candidateState.locks.find(lock => lock.pluginId === plan.pluginId)
    const locks = [
      ...candidateState.locks.filter(lock => lock.pluginId !== plan.pluginId),
      sourceLockFromCandidate(ctx.candidate, previousLock),
    ]
    writeMarketplaceState(candidateProfile, {
      entries: next,
      locks,
      version: STATE_VERSION,
    })
  } else if (plan.action === 'uninstall') {
    const installed = existing
    if (installed === undefined) throw new Error(`${plan.pluginId} is no longer installed`)
    if (installed.mechanism !== 'bundle') {
      throw new Error('repository-plugin receipts are guide-only and cannot be changed')
    }
    await ctx.removeBundle(installed)
    writeMarketplaceState(candidateProfile, {
      entries: remaining,
      locks: candidateState.locks,
      version: STATE_VERSION,
    })
  } else {
    const installed = existing
    if (installed === undefined) throw new Error(`${plan.pluginId} is no longer installed`)
    if (installed.mechanism !== 'bundle' || installed.packageName === null) {
      throw new Error('repository-plugin receipts are guide-only and cannot be changed')
    }
    const enabled = plan.action === 'enable'
    setBundleEnabled(candidateProfile, installed.packageName, enabled)
    writeMarketplaceState(candidateProfile, {
      entries: current,
      locks: candidateState.locks,
      version: STATE_VERSION,
    })
  }
}
