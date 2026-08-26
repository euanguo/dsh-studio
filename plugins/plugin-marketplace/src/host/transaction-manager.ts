// Marketplace transaction phase orchestration. State-file semantics live in
// state-file.ts, allowBuild YAML editing in allowbuild-yaml.ts, and raw
// filesystem surgery in fs-ops.ts; this module owns phases, guards, and the
// preview/apply/undo coordination across runtime + journal.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  MarketplaceAction,
  MarketplaceCandidate,
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplaceInstalledPlugin,
  MarketplacePlan,
  MarketplacePlugin,
  MarketplacePreview,
  MarketplaceSnapshot,
  SourceRef,
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
import { PINNED_DSH_VERSION, type MarketplaceSourceResolver } from './source-types.ts'
import {
  MANAGED_DIRECTORY,
  applyPlanToPreviewProfile,
  buildManageCandidate,
  bundleEnabled,
  bundleInstalled,
  installedEntryEnabled,
  readMarketplaceState,
  resolveInstallCandidate,
  setBundleEnabled,
  writeMarketplaceState,
} from './state-file.ts'
import {
  copyDirectory,
  defaultWarn,
  message,
  removeWithin,
} from './fs-ops.ts'

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
  onWarn?: (message_: string) => void
  platform: MarketplacePlatform
  profile: string
  resolver?: MarketplaceSourceResolver
  runtime: MarketplaceRuntime
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
  readonly #warn: (message_: string) => void

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
    removeWithin(this.#root, this.#previewsRoot, this.#warn)
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
    return structuredClone({
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
          await this.preview(command.confirmations ?? [])
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
      const resolved = await buildManageCandidate({
        action,
        requestedPluginId,
        current,
        lock: state.locks.find(entry => entry.pluginId === requestedPluginId),
        profileDir: this.#profileDir,
        resolver: this.#resolver,
      })
      if (resolved.guideOnly) {
        this.#tx.candidate = null
        this.#tx.plan = resolved.plan
        this.#transition('planning')
        return
      }
      this.#tx.candidate = resolved.candidate
      this.#tx.plan = this.#resolver.makePlan(resolved.candidate, action)
      this.#transition('planning')
      return
    }

    const candidate = await resolveInstallCandidate({
      resolver: this.#resolver,
      action: action as 'install' | 'update',
      pluginId: requestedPluginId,
      sourceRef: sourceRef !== undefined && sourceRef.kind === 'repository' ? sourceRef : undefined,
      catalog: this.#catalog,
      stateEntries: state.entries,
    })
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
    const candidate = this.#tx.candidate
    if (candidate === null) throw new Error('bundle preview is missing its source candidate')
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
      await applyPlanToPreviewProfile({
        platform: this.#options.platform,
        removeBundle: async installed => {
          await this.removeBundle(candidateHome, candidateProfile, root, installed)
        },
        warn: this.#warn,
        profileName: this.#options.profile,
        candidateHome,
        candidateProfile,
        root,
        plan,
        candidate,
      })
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
