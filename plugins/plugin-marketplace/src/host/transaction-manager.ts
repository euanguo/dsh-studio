import { errorMessage } from '@dsh-studio/shared/errors'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type {
  MarketplaceAction,
  MarketplaceCandidate,
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplaceInstalledPlugin,
  MarketplacePlan,
  MarketplacePlugin,
  MarketplacePreview,
  MarketplaceRiskLevel,
  MarketplaceRiskReason,
  MarketplaceSnapshot,
  MarketplaceSourceLock,
  MarketplaceSourceReview,
  SourceRef,
} from '../protocol.ts'
import {
  isProtectedMarketplacePlugin,
} from '../protocol.ts'
import type { MarketplacePlatform } from './platform.ts'
import { CatalogSourceManager } from './catalog-source-manager.ts'
import {
  clearJournal,
  journalAppliedRecord,
  journalIntentRecord,
  readRawJournal,
  reconcileJournal,
  restoreJournal,
  writeJournal,
  type MarketplaceRecoveryPoint,
} from './journal.ts'
import {
  DefaultMarketplaceSourceResolver,
  makeMarketplaceApprovalDecision,
  platformRepositoryAdapter,
} from './source-resolver.ts'
import {
  MARKETPLACE_STATE_VERSION,
  migrateMarketplaceLocks,
  sourceLockFromCandidate,
  validateMarketplaceSourceLock,
} from './source-lock.ts'
import {
  PINNED_DSH_VERSION,
  type MarketplaceSourceResolver,
} from './source-types.ts'

const STATE_VERSION = MARKETPLACE_STATE_VERSION
const MANAGED_DIRECTORY = '.dsh-studio'
const STATE_FILE = 'marketplace.json'
const BUILD_BEGIN = '# >>> DSH Studio allowed plugin builds'
const BUILD_END = '# <<< DSH Studio allowed plugin builds'

interface MarketplaceStateFile {
  entries: MarketplaceInstalledPlugin[]
  locks: MarketplaceSourceLock[]
  version: 3
}

interface ActivePreview {
  candidateHome: string
  candidateProfile: string
  preview: MarketplacePreview
  root: string
}

export interface MarketplacePreviewRuntimeInput {
  dshHome: string
  pluginId: string
  sandboxRoot: string
  transactionId: string
}

/** Runtime/window operations injected by Electron and replaced in tests. */
export interface MarketplaceRuntime {
  startLive(): Promise<void>
  startPreview(input: MarketplacePreviewRuntimeInput): Promise<void>
  stopLive(): Promise<void>
  stopPreview(): Promise<void>
}

export interface PluginMarketplaceOptions {
  appDataPath: string
  dshHome: string
  onWarn?: (message: string) => void
  platform: MarketplacePlatform
  profile: string
  resolver?: MarketplaceSourceResolver
  runtime: MarketplaceRuntime
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function message(error: unknown): string {
  return errorMessage(error)
}

/**
 * Explicit marketplace transaction phases. Every command guard and every
 * state mutation is expressed against this enum; the manager never derives
 * "what is happening" from scattered null/boolean flags. `applying` and
 * `undoing` are explicit in-memory phases today and become the persisted
 * journal phases in the leaf that owns disk timing.
 */
export type MarketplacePhase =
  | 'idle'
  | 'catalog-ready'
  | 'planning'
  | 'previewing'
  | 'applying'
  | 'applied-with-undo'
  | 'undoing'

const MARKETPLACE_PHASES = [
  'idle',
  'catalog-ready',
  'planning',
  'previewing',
  'applying',
  'applied-with-undo',
  'undoing',
] as const satisfies readonly MarketplacePhase[]

/** Legal phase-to-phase moves; anything else is a programming error. */
const PHASE_TRANSITIONS: Readonly<Record<MarketplacePhase, readonly MarketplacePhase[]>> = {
  idle: ['catalog-ready', 'planning'],
  'catalog-ready': ['planning'],
  planning: ['previewing', 'catalog-ready', 'idle'],
  previewing: ['applying', 'planning', 'catalog-ready', 'idle', 'applied-with-undo'],
  applying: ['applied-with-undo', 'previewing'],
  'applied-with-undo': ['undoing', 'planning', 'catalog-ready', 'idle'],
  undoing: ['catalog-ready', 'idle', 'applied-with-undo'],
}

/**
 * Command×phase guard matrix: the only phases in which each marketplace
 * command is accepted. A command issued outside its rows (and not rejected by
 * the orthogonal busy flag) fails with the same user-visible error wording as
 * before the matrix existed.
 */
const COMMAND_PHASE_GUARDS: Readonly<Record<MarketplaceCommand['type'], readonly MarketplacePhase[]>> = {
  refresh: MARKETPLACE_PHASES,
  inspect: ['idle', 'catalog-ready', 'planning', 'applied-with-undo'],
  prepare: ['idle', 'catalog-ready', 'planning', 'applied-with-undo'],
  preview: ['planning'],
  discard: MARKETPLACE_PHASES,
  apply: ['previewing'],
  undo: ['applied-with-undo'],
}

function phaseRejection(type: MarketplaceCommand['type'], phase: MarketplacePhase): string {
  switch (type) {
    case 'inspect':
    case 'prepare':
      return phase === 'previewing'
        ? 'Apply or discard the current preview first.'
        : `Cannot ${type} a plugin while the marketplace transaction is ${phase}.`
    case 'preview':
      return phase === 'previewing'
        ? 'A plugin preview is already active.'
        : 'Inspect a plugin before starting its preview.'
    case 'apply':
      return 'There is no prepared preview to apply.'
    case 'undo':
      return 'There is no previous plugin profile to restore.'
    default:
      // refresh and discard accept every phase, so this is unreachable.
      return `the marketplace cannot accept a ${type} command during the ${phase} phase`
  }
}

/** The whole transaction lifecycle as one state value plus its payloads. */
interface MarketplaceTransaction {
  active: ActivePreview | null
  candidate: MarketplaceCandidate | null
  phase: MarketplacePhase
  plan: MarketplacePlan | null
  rollback: MarketplaceRecoveryPoint | null
}

/** Typed rejection for a concurrent marketplace command while the host is
 *  busy (D4). The client distinguishes this from a normal failure and shows
 *  a "busy" notice instead of treating the command as silently dropped. */
export class MarketplaceBusyError extends Error {
  readonly kind = 'marketplace-busy' as const
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

function readMarketplaceState(profileDir: string): MarketplaceStateFile {
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

function writeMarketplaceState(profileDir: string, state: MarketplaceStateFile): void {
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

function bundleInstalled(profileDir: string, packageNameValue: string | null): boolean {
  if (packageNameValue === null) return false
  const dependencies = profileManifest(profileDir).dependencies
  return isRecord(dependencies) && typeof dependencies[packageNameValue] === 'string'
}

function bundleEnabled(profileDir: string, packageNameValue: string | null): boolean {
  return packageNameValue !== null
    && profileBundles(profileManifest(profileDir)).includes(packageNameValue)
}

function setBundleEnabled(
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

/** One `  'name': true` (or legacy bare `name: true`) entry inside the
 *  managed block; anything else in the interior is ignored. */
function managedEntryName(line: string): string | null {
  const match = /^[ \t]+(?:'((?:[^']|'')*)'|([^#' \t][^:#]*?)):[ \t]*true[ \t\r]*$/.exec(line)
  if (match === null) return null
  if (match[1] !== undefined) return match[1].replaceAll("''", "'")
  return match[2]?.trim() ?? null
}

/**
 * Whole-block allowBuild protocol (leaf-3.3): everything between the begin
 * and end markers is owned by this module. The rewrite strips the marked
 * block, rejects any foreign `allowBuilds` key outside it with its line
 * number, and deterministically regenerates one sorted block — replacing the
 * old block in place or appending one at the end. It never performs regex
 * surgery on the surrounding YAML: every other line — comments, quoting,
 * CRLF endings — survives byte-for-byte, and reruns over the same inputs
 * produce identical bytes.
 */
export function regenerateManagedAllowBuilds(text: string, packageNameValue: string): string {
  const lines = text.split('\n')
  let beginLine = -1
  let endLine = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.includes(BUILD_BEGIN) === true) {
      beginLine = index
      break
    }
  }
  if (beginLine >= 0) {
    for (let index = beginLine + 1; index < lines.length; index += 1) {
      if (lines[index]?.includes(BUILD_END) === true) {
        endLine = index
        break
      }
    }
    if (endLine < 0) throw new Error(`managed configuration block is missing ${BUILD_END}`)
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (beginLine >= 0 && index >= beginLine && index <= endLine) continue
    if (/^[ \t]*allowBuilds[ \t]*:/.test(lines[index] ?? '')) {
      throw new Error(
        `pnpm-workspace.yaml line ${index + 1} has an allowBuilds key outside the managed `
        + `${BUILD_BEGIN} block; move it between the markers or remove it`,
      )
    }
  }
  const names = new Set<string>([packageNameValue])
  if (beginLine >= 0) {
    for (let index = beginLine + 1; index < endLine; index += 1) {
      const name = managedEntryName(lines[index] ?? '')
      if (name !== null) names.add(name)
    }
  }
  const block = [
    BUILD_BEGIN,
    'allowBuilds:',
    ...[...names].sort().map(name => `  ${yamlString(name)}: true`),
    BUILD_END,
  ]
  if (beginLine < 0) {
    // No managed block yet: append one after a single blank line, keeping a
    // single trailing newline regardless of the original file's shape.
    while (lines.at(-1) === '') lines.pop()
    return [...lines, '', ...block, ''].join('\n')
  }
  // In-place replacement: every line outside the marked block keeps its
  // exact bytes.
  return [...lines.slice(0, beginLine), ...block, ...lines.slice(endLine + 1)].join('\n')
}

function repositoryFromSource(source: string): string | null {
  const match = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#/.exec(source)
  return match?.[1] ?? null
}

function installedEntryEnabled(
  profileDir: string,
  entry: MarketplaceInstalledPlugin,
): boolean {
  return entry.mechanism === 'bundle' ? bundleEnabled(profileDir, entry.packageName) : false
}

function yamlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function allowBuild(profileDir: string, packageNameValue: string): void {
  const path = join(profileDir, 'pnpm-workspace.yaml')
  const original = existsSync(path) ? readFileSync(path, 'utf8') : 'packages:\n  - .\n'
  writeFileSync(path, regenerateManagedAllowBuilds(original, packageNameValue), { mode: 0o600 })
}

function ensureWithin(parent: string, candidate: string): void {
  const root = resolve(parent)
  const target = resolve(candidate)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`refusing filesystem operation outside ${root}: ${target}`)
  }
}

function assertBundleEntryFiles(checkout: string, targets: readonly string[]): void {
  const canonicalCheckout = realpathSync(checkout)
  for (const target of targets) {
    const entry = resolve(checkout, target)
    ensureWithin(checkout, entry)
    if (!existsSync(entry)) {
      throw new Error(`bundle entry ${target} was not materialized in the exact checkout`)
    }
    if (!lstatSync(entry).isFile()) {
      throw new Error(`bundle entry ${target} is not a regular file in the exact checkout`)
    }
    ensureWithin(canonicalCheckout, realpathSync(entry))
  }
}

function defaultWarn(message: string): void {
  console.warn(`plugin-marketplace: ${message}`)
}

/**
 * Windows maps the read-only attribute to the owner write bit. Git packs and
 * some cloned files are created read-only, so `rmSync` fails with EPERM before
 * it can recurse into the tree. Clear that attribute before the retry while
 * never following symlinks out of the disposable tree.
 */
function clearReadOnlyAttributes(
  path: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return
  try {
    const stats = lstatSync(path)
    if (stats.isDirectory()) {
      chmodSync(path, stats.mode | 0o200)
      for (const entry of readdirSync(path)) {
        clearReadOnlyAttributes(join(path, entry), platform)
      }
    } else if (stats.isFile()) {
      chmodSync(path, stats.mode | 0o200)
    }
  } catch {
    // Best-effort attribute pass; the removal retry below reports the real failure.
  }
}

function removeTree(
  path: string,
  onWarn: (message: string) => void = defaultWarn,
  platform: NodeJS.Platform = process.platform,
): void {
  try {
    rmSync(path, { force: true, recursive: true })
    return
  } catch {
    if (platform === 'win32') clearReadOnlyAttributes(path, platform)
  }
  try {
    rmSync(path, { force: true, recursive: true })
  } catch (error) {
    onWarn(`failed to clean plugin marketplace tree at ${path}: ${message(error)}`)
  }
}

export function removeWithin(
  parent: string,
  candidate: string,
  onWarn: (message: string) => void = defaultWarn,
  platform: NodeJS.Platform = process.platform,
): void {
  ensureWithin(parent, candidate)
  removeTree(candidate, onWarn, platform)
}

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) throw new Error(`source profile does not exist: ${source}`)
  if (existsSync(target)) throw new Error(`candidate profile already exists: ${target}`)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  cpSync(source, target, {
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  })
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

function assertPortableBundleProfile(profileDir: string, previewRoot: string): void {
  for (const name of ['package.json', 'pnpm-lock.yaml']) {
    const path = join(profileDir, name)
    if (existsSync(path) && readFileSync(path, 'utf8').includes(previewRoot)) {
      throw new Error(`${name} retained an absolute path into the disposable preview`)
    }
  }
}

function cloneSnapshot(snapshot: MarketplaceSnapshot): MarketplaceSnapshot {
  return structuredClone(snapshot)
}

/**
 * Own the complete preview/apply/undo transaction behind a two-method
 * interface. Callers never manipulate profile paths or package commands.
 */
export class PluginMarketplaceManager {
  readonly #options: PluginMarketplaceOptions
  readonly #profileDir: string
  readonly #resolver: MarketplaceSourceResolver
  readonly #root: string
  readonly #previewsRoot: string
  readonly #rollbacksRoot: string
  readonly #rollbackStatePath: string
  readonly #latestCommits = new Map<string, string>()
  // Orthogonal busy flag: true while a dispatch runs, independent of phase.
  #busy = false
  #tx: MarketplaceTransaction
  #catalog: MarketplacePlugin[] = []
  #catalogGeneratedAt: string | null = null
  #auth: MarketplaceSnapshot['auth'] = {
    detail: 'Plugin catalog has not been refreshed yet.',
    status: 'error',
  }
  #error: string | null = null
  #lastAction: string | null = null
  readonly #warn: (message: string) => void

  constructor(options: PluginMarketplaceOptions) {
    this.#options = options
    this.#warn = options.onWarn ?? defaultWarn
    this.#profileDir = join(options.dshHome, 'profiles', options.profile)
    this.#resolver = options.resolver ?? new DefaultMarketplaceSourceResolver({
      dshVersion: PINNED_DSH_VERSION,
      findInstalled: candidate => readMarketplaceState(this.#profileDir).entries.find(entry =>
        entry.pluginId === candidate.identity.pluginId || entry.packageName === candidate.identity.packageName),
      findSourceLock: candidate => readMarketplaceState(this.#profileDir).locks.find(lock =>
        lock.pluginId === candidate.identity.pluginId || lock.packageName === candidate.identity.packageName),
      repository: platformRepositoryAdapter(options.platform),
    })
    this.#root = join(options.appDataPath, 'plugin-marketplace')
    this.#previewsRoot = join(this.#root, 'previews')
    this.#rollbacksRoot = join(this.#root, 'rollbacks')
    this.#rollbackStatePath = join(this.#rollbacksRoot, 'current.json')
    removeTree(this.#previewsRoot, this.#warn)
    mkdirSync(this.#previewsRoot, { recursive: true, mode: 0o700 })
    mkdirSync(this.#rollbacksRoot, { recursive: true, mode: 0o700 })
    // Crash reconciliation (journal v2): settle every W1..W5/U1..U3 leftover
    // warn-first before the first command runs. Reported problems seed #error
    // so a fatal loss is never silent; the error persists until the next
    // successful dispatch (leaf-3.3 retention).
    const reconciliation = reconcileJournal({
      profile: options.profile,
      profileDir: this.#profileDir,
      rollbacksRoot: this.#rollbacksRoot,
      statePath: this.#rollbackStatePath,
      warn: this.#warn,
    })
    this.#tx = {
      active: null,
      candidate: null,
      phase: reconciliation.recovery === null ? 'idle' : 'applied-with-undo',
      plan: null,
      rollback: reconciliation.recovery,
    }
    if (reconciliation.problems.length > 0) {
      this.#error = reconciliation.problems.join(' ')
    }
  }

  /** Current explicit transaction phase. Host-side introspection only; it is
   *  not part of the wire snapshot DTO. */
  get phase(): MarketplacePhase {
    return this.#tx.phase
  }

  getSnapshot(): MarketplaceSnapshot {
    const state = readMarketplaceState(this.#profileDir)
    const receipts = state.entries
    const installed = receipts.filter(entry => entry.mechanism === 'repository'
      || bundleInstalled(this.#profileDir, entry.packageName))
    const installedById = new Map(installed.map(entry => [entry.pluginId, entry]))
    return cloneSnapshot({
      approval: makeMarketplaceApprovalDecision(
        this.#tx.plan,
        this.#tx.active !== null,
        this.#tx.rollback !== null,
      ),
      auth: this.#auth,
      busy: this.#busy,
      candidate: this.#tx.candidate,
      catalog: this.#catalog.map(plugin => {
        const receipt = installedById.get(plugin.id)
        const latestCommit = this.#latestCommits.get(plugin.id) ?? null
        const enabled = receipt === undefined
          ? false
          : receipt.mechanism === 'bundle'
            ? bundleEnabled(this.#profileDir, receipt.packageName)
            : false
        return {
          ...plugin,
          currentCommit: receipt?.resolvedCommit ?? null,
          enabled,
          installed: receipt !== undefined,
          latestCommit,
          updateAvailable: receipt !== undefined
            && latestCommit !== null
            && latestCommit !== receipt.resolvedCommit,
        }
      }),
      catalogGeneratedAt: this.#catalogGeneratedAt,
      error: this.#error,
      installed,
      lastAction: this.#lastAction,
      lifecycle: {
        candidate: this.#tx.active?.preview ?? null,
        current: {
          profile: this.#options.profile,
          state: 'live',
        },
        previous: this.#tx.rollback === null ? null : {
          appliedAt: this.#tx.rollback.appliedAt,
          pluginId: this.#tx.rollback.pluginId,
          transactionId: this.#tx.rollback.transactionId,
        },
      },
      plan: this.#tx.plan,
      preview: this.#tx.active?.preview ?? null,
      sourceLocks: state.locks,
      undoAvailable: this.#tx.rollback !== null,
    })
  }

  async dispatch(command: MarketplaceCommand): Promise<MarketplaceSnapshot> {
    // D4: a busy host must not silently drop a concurrent command. Instead of
    // short-circuiting to the current snapshot, throw a typed rejection so the
    // client can surface "a marketplace operation is already running" instead
    // of implying the command was accepted. This is the single throw site for
    // MarketplaceBusyError; it also guards commands that would race an
    // in-flight applying/undoing phase.
    if (this.#busy) {
      throw new MarketplaceBusyError('the marketplace is busy processing another operation')
    }
    this.#busy = true
    let succeeded = false
    try {
      // Command×phase guard matrix: reject before any state mutation.
      if (!COMMAND_PHASE_GUARDS[command.type].includes(this.#tx.phase)) {
        throw new Error(phaseRejection(command.type, this.#tx.phase))
      }
      switch (command.type) {
        case 'refresh':
          await this.refresh(command.force === true)
          break
        case 'inspect':
          await this.inspect(command.action, command.pluginId, command.sourceRef)
          break
        case 'prepare':
          await this.prepare(command.action, command.pluginId, command.sourceRef)
          break
        case 'preview':
          await this.preview(command.confirmations
            ?? (command.allowBuildScripts === true ? ['allow-build-scripts'] : []))
          break
        case 'discard':
          await this.discard()
          break
        case 'apply':
          await this.applyPreview()
          break
        case 'undo':
          await this.undo()
          break
        default:
          command satisfies never
      }
      succeeded = true
    } catch (error) {
      // Error retention (leaf-3.3): the failure message stays in every later
      // snapshot until the next successful dispatch replaces it.
      this.#error = message(error)
    } finally {
      this.#busy = false
    }
    // A successful dispatch supersedes any retained error (including the
    // constructor's reconcile problems); a failed one leaves it standing so
    // read-only snapshots keep surfacing the failure.
    if (succeeded) this.#error = null
    return this.getSnapshot()
  }

  /** Move to an explicit phase; any move outside PHASE_TRANSITIONS is a bug. */
  #transition(phase: MarketplacePhase): void {
    const current = this.#tx.phase
    if (phase === current) return
    if (!PHASE_TRANSITIONS[current].includes(phase)) {
      throw new Error(`illegal marketplace phase transition: ${current} -> ${phase}`)
    }
    this.#tx.phase = phase
  }

  /** The resting phase implied by the settled transaction data. */
  #restingPhase(): MarketplacePhase {
    if (this.#tx.rollback !== null) return 'applied-with-undo'
    return this.#catalogGeneratedAt !== null ? 'catalog-ready' : 'idle'
  }

  /** Return to the resting phase once plan/candidate/active data is cleared. */
  #settle(): void {
    this.#transition(this.#restingPhase())
  }

  private async refresh(force = false): Promise<void> {
    this.#auth = await this.#options.platform.authStatus()
    const installed = readMarketplaceState(this.#profileDir).entries
    const sourceManager = new CatalogSourceManager((_source, options) =>
      this.#options.platform.loadCatalog(options))
    const snapshot = await sourceManager.resolveCatalogSource({
      digest: null,
      etag: null,
      enabled: true,
      id: 'builtin',
      kind: 'builtin',
      label: 'DSH Studio built-in catalog',
      lastCommit: null,
      lastError: null,
      lastSuccessfulFetchAt: null,
      locator: 'whyihaveyou/dsh-suite/data/plugins.json',
      priority: 0,
      signature: null,
      trust: 'builtin',
    }, { force })
    this.#catalog = snapshot.plugins
    this.#catalogGeneratedAt = snapshot.generatedAt
    this.#latestCommits.clear()
    const available = new Map(this.#catalog
      .filter(plugin => plugin.mechanism !== 'unsupported' && plugin.mechanism !== 'repository')
      .map(plugin => [plugin.id, plugin.repository]))
    await Promise.all(installed
      .filter(entry => available.has(entry.pluginId))
      .map(async entry => {
        try {
          this.#latestCommits.set(
            entry.pluginId,
            await this.#options.platform.resolveCommit(available.get(entry.pluginId) as string),
          )
        } catch {
          // A failed update check must not hide the installed plugin catalog.
        }
      }))
    this.#lastAction = `Loaded ${String(this.#catalog.length)} catalog plugins.`
    // A loaded catalog upgrades the resting phase; an active transaction keeps
    // its phase (refresh never abandons a plan or preview).
    if (this.#tx.phase === 'idle') this.#transition('catalog-ready')
  }

  private async prepare(
    action: MarketplaceAction,
    pluginId?: string,
    sourceRef?: SourceRef,
  ): Promise<void> {
    await this.inspect(action, pluginId, sourceRef)
    if (this.#tx.plan === null) throw new Error('marketplace inspection did not produce a plan')
    if (this.#tx.plan.execution !== 'installable' || this.#tx.plan.riskLevel === 'blocked') {
      throw new Error(`${this.#tx.plan.pluginId} is guide-only or blocked by the pinned DSH runtime`)
    }
    // Explicit planning→previewing transition: a requirements-free plan enters
    // the preview phase through the same guarded move as an explicit preview
    // command instead of an implicit side effect of prepare.
    if (this.#tx.plan.requirements.length === 0) await this.preview([])
  }

  private async inspect(
    action: MarketplaceAction,
    pluginId?: string,
    sourceRef?: SourceRef,
  ): Promise<void> {
    // A new inspection abandons the previous plan/candidate first; the phase
    // falls back to its resting value before the new candidate is resolved.
    this.#tx.candidate = null
    this.#tx.plan = null
    this.#settle()
    const state = readMarketplaceState(this.#profileDir)
    const requestedPluginId = pluginId ?? (sourceRef?.kind === 'catalog' ? sourceRef.pluginId : undefined)
    if (action === 'uninstall' || action === 'enable' || action === 'disable') {
      if (requestedPluginId === undefined) throw new Error(`${action} requires a marketplace plugin id`)
      const current = state.entries.find(entry => entry.pluginId === requestedPluginId)
      if (current === undefined) throw new Error(`${requestedPluginId} was not installed by this marketplace`)
      const enabled = installedEntryEnabled(this.#profileDir, current)
      if (action === 'enable' && enabled) throw new Error(`${requestedPluginId} is already enabled`)
      if (action === 'disable' && !enabled) throw new Error(`${requestedPluginId} is already disabled`)
      if (current.mechanism !== 'bundle') {
        this.#tx.candidate = null
        this.#tx.plan = {
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
        this.#transition('planning')
        return
      }
      const lock = state.locks.find(entry => entry.pluginId === requestedPluginId)
      if (isProtectedMarketplacePlugin(requestedPluginId, repositoryFromSource(current.source), current.packageName)) {
        throw new Error(`${requestedPluginId} is protected by the desktop and cannot be modified by its own marketplace`)
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
      this.#tx.candidate = candidate
      this.#tx.plan = this.#resolver.makePlan(candidate, action)
      this.#transition('planning')
      return
    }

    if (requestedPluginId !== undefined) {
      const current = state.entries.find(entry => entry.pluginId === requestedPluginId)
      if (action === 'install' && current !== undefined) throw new Error(`${requestedPluginId} is already installed`)
      if (action === 'update' && current === undefined) throw new Error(`${requestedPluginId} is not installed`)
    }
    let repositoryRef: Extract<SourceRef, { kind: 'repository' }>
    let catalogPlugin: MarketplacePlugin | undefined
    if (sourceRef?.kind === 'repository') {
      repositoryRef = sourceRef
    } else {
      if (requestedPluginId === undefined) throw new Error('install/update requires a plugin id or repository sourceRef')
      catalogPlugin = this.#catalog.find(plugin => plugin.id === requestedPluginId)
      if (catalogPlugin === undefined) throw new Error(`plugin is not present in the loaded catalog: ${requestedPluginId}`)
      if (catalogPlugin.mechanism === 'unsupported' || catalogPlugin.mechanism === 'repository') {
        throw new Error(`${requestedPluginId} is guide-only or blocked by the pinned DSH runtime`)
      }
      if (catalogPlugin.protected || isProtectedMarketplacePlugin(requestedPluginId, catalogPlugin.repository)) {
        throw new Error(`${requestedPluginId} is protected by the desktop and cannot be modified by its own marketplace`)
      }
      repositoryRef = {
        catalogSourceId: catalogPlugin.catalogSourceId ?? 'builtin',
        input: catalogPlugin.repository,
        kind: 'repository',
        requestedRef: null,
        subpath: null,
      }
    }
    const candidate = await this.#resolver.resolveRepository(repositoryRef)
    if (catalogPlugin !== undefined) candidate.identity.pluginId = catalogPlugin.id
    if (isProtectedMarketplacePlugin(
      candidate.identity.pluginId,
      candidate.identity.repository,
      candidate.identity.packageName,
    )) {
      throw new Error(`${candidate.identity.pluginId} is protected by the desktop and cannot be modified by its own marketplace`)
    }
    const current = state.entries.find(entry => entry.pluginId === candidate.identity.pluginId
      || entry.packageName === candidate.identity.packageName)
    if (action === 'install' && current !== undefined) throw new Error(`${candidate.identity.pluginId} is already installed`)
    if (action === 'update' && current === undefined) throw new Error(`${candidate.identity.pluginId} is not installed`)
    if (action === 'update' && current?.resolvedCommit === candidate.source.resolvedCommit) {
      throw new Error(`${candidate.identity.pluginId} is already at the latest commit`)
    }
    this.#latestCommits.set(candidate.identity.pluginId, candidate.source.resolvedCommit)
    this.#tx.candidate = candidate
    this.#tx.plan = this.#resolver.makePlan(candidate, action)
    this.#transition('planning')
  }

  private async preview(confirmations: readonly MarketplaceConfirmation[]): Promise<void> {
    // Only reachable from the planning phase: the dispatch guard matrix (or
    // the prepare cascade right after inspect). Narrow defensively through
    // the same rejection wording instead of a second ad-hoc predicate.
    const plan = this.#tx.plan
    if (plan === null) throw new Error(phaseRejection('preview', this.#tx.phase))
    const missing = plan.requirements.filter(requirement => !confirmations.includes(requirement))
    if (missing.length > 0) {
      throw new Error(`Preview requires explicit confirmation: ${missing.join(', ')}`)
    }
    if (plan.execution !== 'installable' || plan.mechanism !== 'bundle') {
      throw new Error('only installable DSH bundle candidates can enter preview')
    }
    if (plan.installSpec !== `github:${plan.repository}#${plan.resolvedCommit}`) {
      throw new Error('bundle preview requires an exact commit-pinned installSpec')
    }
    const transactionId = randomUUID()
    const root = join(this.#previewsRoot, transactionId)
    const candidateHome = join(root, 'dsh')
    const candidateProfile = join(candidateHome, 'profiles', this.#options.profile)
    copyDirectory(this.#profileDir, candidateProfile)
    try {
      // A live profile can carry a `node_modules` whose `.modules.yaml` points
      // at a pnpm store that no longer exists: applying a preview deletes the
      // preview root (and its store) while the applied profile keeps the
      // store reference, so every later preview copy inherits a tree pnpm
      // refuses with ERR_PNPM_UNEXPECTED_STORE. Drop the copied tree and
      // lockfile for actions that run pnpm anyway, so pnpm rebuilds them
      // against the preview's own store.
      if (plan.action === 'install' || plan.action === 'update' || plan.action === 'uninstall') {
        removeWithin(candidateProfile, join(candidateProfile, 'node_modules'), this.#warn)
        rmSync(join(candidateProfile, 'pnpm-lock.yaml'), { force: true })
      }
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
          await this.removeBundle(candidateHome, candidateProfile, root, existing)
        }
        if (plan.mechanism === 'bundle') {
          if (plan.packageName === null) throw new Error('bundle plan is missing its package name')
          const sources = join(candidateProfile, MANAGED_DIRECTORY, 'sources')
          if (existsSync(sources)) {
            for (const entry of readdirSync(sources)) {
              if (entry.startsWith(`${plan.pluginId}-`)) {
                removeWithin(sources, join(sources, entry), this.#warn)
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
          await this.#options.platform.cloneRepository(
            plan.repository,
            plan.resolvedCommit,
            cloneTarget,
          )
          if (scriptNames.length > 0) {
            allowBuild(candidateProfile, plan.packageName)
            await this.#options.platform.buildBundle({
              checkout: cloneTarget,
              sandboxRoot: root,
              scripts: scriptNames,
            })
            renameSync(cloneTarget, checkout)
            assertBundleEntryFiles(checkout, plan.entryTargets)
          }
          await this.#options.platform.runDsh({
            args: ['plugin', '--profile', this.#options.profile, 'add', checkout],
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
          await this.#options.platform.runDsh({
            args: ['plugin', '--profile', this.#options.profile, 'install', '--ignore-scripts'],
            dshHome: candidateHome,
            sandboxRoot: root,
          })
          setBundleEnabled(candidateProfile, plan.packageName, preserveEnabled)
          assertPortableBundleProfile(candidateProfile, root)
        }
        const next = [...remaining, installed]
        const previousLock = candidateState.locks.find(lock => lock.pluginId === plan.pluginId)
        const candidate = this.#tx.candidate
        if (candidate === null) throw new Error('bundle preview is missing its source candidate')
        const locks = [
          ...candidateState.locks.filter(lock => lock.pluginId !== plan.pluginId),
          sourceLockFromCandidate(candidate, previousLock),
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
        await this.removeBundle(candidateHome, candidateProfile, root, installed)
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
      const preview: MarketplacePreview = {
        action: plan.action,
        pluginId: plan.pluginId,
        resolvedCommit: plan.resolvedCommit,
        startedAt: new Date().toISOString(),
        transactionId,
      }
      this.#tx.active = { candidateHome, candidateProfile, preview, root }
      this.#transition('previewing')
      await this.#options.runtime.startPreview({
        dshHome: candidateHome,
        pluginId: plan.pluginId,
        sandboxRoot: root,
        transactionId,
      })
      this.#lastAction = `Isolated ${plan.action} preview is ready for ${plan.pluginId}.`
    } catch (error) {
      // The preview never became usable: back to planning with the plan kept
      // so the client can adjust confirmations and retry.
      this.#tx.active = null
      this.#transition('planning')
      await this.#options.runtime.stopPreview().catch(() => {})
      removeWithin(this.#previewsRoot, root, this.#warn)
      throw error
    }
  }

  private async removeBundle(
    candidateHome: string,
    candidateProfile: string,
    sandboxRoot: string,
    installed: MarketplaceInstalledPlugin,
  ): Promise<void> {
    if (installed.packageName === null) throw new Error('installed bundle is missing its package name')
    await this.#options.platform.runDsh({
      args: ['plugin', '--profile', this.#options.profile, 'remove', installed.packageName],
      dshHome: candidateHome,
      sandboxRoot,
    })
    const sources = join(candidateProfile, MANAGED_DIRECTORY, 'sources')
    if (!existsSync(sources)) return
    for (const entry of readdirSync(sources)) {
      if (entry.startsWith(`${installed.pluginId}-`)) removeWithin(sources, join(sources, entry), this.#warn)
    }
  }

  private async discard(): Promise<void> {
    const active = this.#tx.active
    if (active === null) {
      // Nothing to tear down; abandoning a plan-only transaction settles the
      // phase back to its resting value.
      if (this.#tx.plan !== null || this.#tx.candidate !== null) {
        this.#tx.plan = null
        this.#tx.candidate = null
        this.#settle()
      }
      return
    }
    await this.#options.runtime.stopPreview()
    removeWithin(this.#previewsRoot, active.root, this.#warn)
    this.#tx.active = null
    this.#tx.plan = null
    this.#tx.candidate = null
    this.#lastAction = `Discarded the ${active.preview.pluginId} preview without changing the desktop profile.`
    // A previous recovery point (if any) survives a preview discard.
    this.#settle()
  }

  private async applyPreview(): Promise<void> {
    // Guard matrix admits apply only from the previewing phase.
    const active = this.#tx.active
    if (active === null) throw new Error(phaseRejection('apply', this.#tx.phase))
    this.#transition('applying')
    const rollbackRoot = join(this.#rollbacksRoot, active.preview.transactionId)
    const backupProfile = join(rollbackRoot, this.#options.profile)
    // Intent-before-rename: durably record the applying intent BEFORE any
    // profile rename (and before runtime teardown), so a crash in any window
    // (W1..W5) leaves a reconcilable ledger instead of an unmarked
    // half-swap.
    const priorJournal = readRawJournal(this.#rollbackStatePath)
    writeJournal(this.#rollbackStatePath, journalIntentRecord('applying', {
      backupProfile,
      pluginId: active.preview.pluginId,
      transactionId: active.preview.transactionId,
    }))
    await this.#options.runtime.stopPreview()
    await this.#options.runtime.stopLive()
    mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 })
    let candidateInstalled = false
    try {
      renameSync(this.#profileDir, backupProfile)
      renameSync(active.candidateProfile, this.#profileDir)
      candidateInstalled = true
      // The applied profile's node_modules was linked from the preview's
      // store, which is deleted with the preview root below. Re-home it
      // against the persistent home store (unsandboxed) so the live profile
      // never references a vanished store. Any failure during re-homing
      // automatically triggers rollback to the original profile.
      removeWithin(this.#profileDir, join(this.#profileDir, 'node_modules'), this.#warn)
      rmSync(join(this.#profileDir, 'pnpm-lock.yaml'), { force: true })
      await this.#options.platform.runDsh({
        args: ['plugin', '--profile', this.#options.profile, 'install', '--ignore-scripts'],
        dshHome: this.#options.dshHome,
        sandboxRoot: this.#options.appDataPath,
        sandboxed: false,
      })
      await this.#options.runtime.startLive()
    } catch (error) {
      await this.#options.runtime.stopLive().catch(() => {})
      if (candidateInstalled && existsSync(this.#profileDir)) {
        const failed = join(rollbackRoot, 'failed-candidate')
        renameSync(this.#profileDir, failed)
      }
      if (existsSync(backupProfile)) renameSync(backupProfile, this.#profileDir)
      await this.#options.runtime.startLive().catch(() => {})
      // The apply failed and rolled back on disk; the journal returns to its
      // exact pre-transaction form so a prior recovery point survives
      // verbatim (a v1 file stays v1 until a successful transaction).
      restoreJournal(this.#rollbackStatePath, priorJournal)
      // The preview handle stays as before (leaf-3.2 owns the reconcile of
      // that crashed transaction).
      this.#transition('previewing')
      throw new Error(`plugin preview failed to apply and was rolled back: ${message(error)}`)
    }
    this.#tx.rollback = {
      appliedAt: new Date().toISOString(),
      backupProfile,
      pluginId: active.preview.pluginId,
      transactionId: active.preview.transactionId,
    }
    // Terminal journal state: the swap completed and is durably committed;
    // this write is also where a v1 record lazily upgrades to v2.
    writeJournal(this.#rollbackStatePath, journalAppliedRecord({
      appliedAt: this.#tx.rollback.appliedAt,
      backupProfile,
      pluginId: active.preview.pluginId,
      transactionId: active.preview.transactionId,
    }))
    removeWithin(this.#previewsRoot, active.root, this.#warn)
    this.#tx.active = null
    this.#tx.plan = null
    this.#tx.candidate = null
    this.#lastAction = `Applied ${active.preview.pluginId}; the previous profile remains available for Undo.`
    this.remapCatalogInstalled()
    this.#transition('applied-with-undo')
  }

  private async undo(): Promise<void> {
    // Guard matrix admits undo only from the applied-with-undo phase.
    const rollback = this.#tx.rollback
    if (rollback === null) throw new Error(phaseRejection('undo', this.#tx.phase))
    if (!existsSync(rollback.backupProfile)) {
      this.#tx.rollback = null
      clearJournal(this.#rollbackStatePath)
      this.#settle()
      throw new Error('There is no previous plugin profile to restore.')
    }
    this.#transition('undoing')
    const rollbackRoot = dirname(rollback.backupProfile)
    const replacedProfile = join(rollbackRoot, `replaced-${Date.now().toString(36)}`)
    // Intent-before-rename for the undo direction (U1..U3 windows). The
    // original appliedAt rides along so an interrupted-undo reconcile can
    // re-terminalize the journal without rebasing the recovery point.
    const priorJournal = readRawJournal(this.#rollbackStatePath)
    writeJournal(this.#rollbackStatePath, journalIntentRecord('undoing', {
      appliedAt: rollback.appliedAt,
      backupProfile: rollback.backupProfile,
      pluginId: rollback.pluginId,
      transactionId: rollback.transactionId,
    }))
    await this.#options.runtime.stopLive()
    let restored = false
    try {
      renameSync(this.#profileDir, replacedProfile)
      renameSync(rollback.backupProfile, this.#profileDir)
      restored = true
      await this.#options.runtime.startLive()
    } catch (error) {
      await this.#options.runtime.stopLive().catch(() => {})
      if (restored && existsSync(this.#profileDir)) renameSync(this.#profileDir, rollback.backupProfile)
      if (existsSync(replacedProfile)) renameSync(replacedProfile, this.#profileDir)
      await this.#options.runtime.startLive().catch(() => {})
      // The restore failed on disk; put the applied journal back verbatim so
      // the recovery point survives.
      restoreJournal(this.#rollbackStatePath, priorJournal)
      // The recovery point stays (leaf-3.2 owns the reconcile of that
      // crashed undo).
      this.#transition('applied-with-undo')
      throw new Error(`failed to restore the previous plugin profile: ${message(error)}`)
    }
    removeWithin(this.#rollbacksRoot, replacedProfile, this.#warn)
    clearJournal(this.#rollbackStatePath)
    removeWithin(this.#rollbacksRoot, rollbackRoot, this.#warn)
    this.#tx.rollback = null
    this.#tx.candidate = null
    this.#lastAction = `Restored the profile from before ${rollback.pluginId} was applied.`
    this.remapCatalogInstalled()
    this.#settle()
  }

  private remapCatalogInstalled(): void {
    const installed = new Set(readMarketplaceState(this.#profileDir).entries.map(entry => entry.pluginId))
    this.#catalog = this.#catalog.map(plugin => ({ ...plugin, installed: installed.has(plugin.id) }))
  }
}
