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
  MarketplaceInputRequest,
  MarketplaceInstalledPlugin,
  MarketplacePack,
  MarketplacePlan,
  MarketplacePlugin,
  MarketplacePreview,
  MarketplaceProgress,
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
  readMarketplaceState,
  resolveInstallCandidate,
} from './state-file.ts'
import {
  copyDirectory,
  defaultWarn,
  message,
  removeWithin,
} from './fs-ops.ts'

interface ActiveStage {
  candidateHome: string
  candidateProfile: string
  operation: MarketplacePreview
  root: string
}

interface PendingInput {
  confirmations: MarketplaceConfirmation[]
  candidates: MarketplaceCandidate[] | null
  mode: 'direct' | 'preview'
  plans: MarketplacePlan[] | null
  request: MarketplaceInputRequest
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
  onStateChange?: () => void
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
  | 'staging'
  | 'previewing'
  | 'applying'
  | 'applied-with-undo'
  | 'undoing'

const MARKETPLACE_PHASES = [
  'idle',
  'catalog-ready',
  'planning',
  'staging',
  'previewing',
  'applying',
  'applied-with-undo',
  'undoing',
] as const satisfies readonly MarketplacePhase[]

/** Legal phase-to-phase moves; anything else is a programming error. */
const PHASE_TRANSITIONS: Readonly<Record<MarketplacePhase, readonly MarketplacePhase[]>> = {
  idle: ['catalog-ready', 'planning'],
  'catalog-ready': ['planning', 'idle'],
  planning: ['staging', 'catalog-ready', 'idle', 'applied-with-undo'],
  staging: ['previewing', 'applying', 'planning', 'catalog-ready', 'idle'],
  previewing: ['applying', 'planning', 'catalog-ready', 'idle', 'applied-with-undo'],
  applying: ['applied-with-undo', 'previewing', 'staging'],
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
  plan: ['idle', 'catalog-ready', 'planning', 'applied-with-undo'],
  execute: ['planning', 'staging', 'catalog-ready', 'idle', 'applied-with-undo'],
  pack: ['idle', 'catalog-ready', 'applied-with-undo'],
  cancel: ['staging'],
  provide: ['planning', 'staging'],
  discard: MARKETPLACE_PHASES,
  apply: ['staging', 'previewing'],
  undo: ['applied-with-undo'],
}

function operationLabel(operation: MarketplacePreview): string {
  return operation.packId === null ? operation.pluginId : `pack ${operation.packId}`
}

function phaseRejection(type: MarketplaceCommand['type'], phase: MarketplacePhase): string {
  switch (type) {
    case 'plan':
    case 'execute':
      return phase === 'previewing'
        ? 'Apply or discard the current preview first.'
        : `Cannot ${type} a plugin while the marketplace transaction is ${phase}.`
    case 'apply':
      return 'There is no active staged operation to apply.'
    case 'undo':
      return 'There is no previous plugin profile to restore.'
    default:
      // refresh and discard accept every phase, so this is unreachable.
      return `the marketplace cannot accept a ${type} command during the ${phase} phase`
  }
}

/** The whole transaction lifecycle as one state value plus its payloads. */
interface MarketplaceTransaction {
  active: ActiveStage | null
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
  #progress: MarketplaceProgress | null = null
  #pendingInput: PendingInput | null = null
  #packs: MarketplacePack[] = []
  #selfUpdate: MarketplaceSnapshot['selfUpdate'] = null
  // Orthogonal busy flag: true while a dispatch runs, independent of phase.
  #busy = false
  #cancelRequested = false
  #tx: MarketplaceTransaction
  #catalog: MarketplacePlugin[] = []
  #watchlist: MarketplacePlugin[] = []
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
        this.#tx.active !== null && this.#tx.phase === 'previewing',
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
      catalogWatchlist: this.#watchlist,
      progress: this.#progress,
      inputRequest: this.#pendingInput?.request ?? null,
      packs: this.#packs,
      selfUpdate: this.#selfUpdate,
      error: this.#error,
      installed,
      lastAction: this.#lastAction,
      lifecycle: {
        candidate: this.#tx.active?.operation ?? null,
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
      preview: this.#tx.phase === 'previewing' ? this.#tx.active?.operation ?? null : null,
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
    if (this.#busy && command.type === 'cancel') {
      this.#cancelRequested = true
      return this.getSnapshot()
    }
    if (this.#busy) {
      throw new MarketplaceBusyError('the marketplace is busy processing another operation')
    }
    this.#cancelRequested = false
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
        case 'plan':
          await this.resolvePlan(command.action, command.pluginId, command.sourceRef)
          break
        case 'execute':
          await this.resolvePlan(command.action, command.pluginId, command.sourceRef)
          await this.executePlan(command.mode, command.confirmations ?? [])
          break
        case 'pack':
          await this.executePack(command.packId, command.mode, command.confirmations ?? [])
          break
        case 'cancel':
          await this.cancelStage(command.transactionId)
          break
        case 'provide':
          await this.provideInput(command.transactionId, command.answers)
          break
        case 'discard':
          await this.discard()
          break
        case 'apply':
          await this.applyActive()
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
    this.#watchlist = snapshot.watchlist
    this.#catalogGeneratedAt = snapshot.generatedAt
    this.#packs = [{
      description: 'A small set of verified plugins for a fresh DSH profile.',
      entries: this.#catalog.filter(plugin => plugin.officialBeta && !plugin.protected).slice(0, 5).map(plugin => ({ action: 'install' as const, pluginId: plugin.id })),
      id: 'recommended',
      tags: ['recommended', 'verified'],
      title: 'Recommended plugins',
    }].filter(pack => pack.entries.length > 0)
    const market = this.#catalog.find(plugin => plugin.id === 'plugin-marketplace')
    this.#selfUpdate = market === undefined ? null : {
      channel: 'stable',
      checkedAt: new Date().toISOString(),
      installedVersion: readMarketplaceState(this.#profileDir).entries.find(entry => entry.pluginId === market.id)?.version ?? null,
      latestVersion: market.version,
      updateAvailable: market.version !== null && market.version !== readMarketplaceState(this.#profileDir).entries.find(entry => entry.pluginId === market.id)?.version,
    }
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

  private async resolvePlan(
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

  private async executePlan(mode: 'direct' | 'preview', confirmations: readonly MarketplaceConfirmation[]): Promise<void> {
    const plan = this.#tx.plan
    if (plan === null) throw new Error(phaseRejection('execute', this.#tx.phase))
    if (plan.execution !== 'installable' || (plan.mechanism !== 'bundle' && plan.mechanism !== 'repository')) {
      throw new Error(`${plan.pluginId} is not executable by the pinned DSH runtime`)
    }
    const missing = plan.requirements.filter(requirement => !confirmations.includes(requirement))
    if (missing.length > 0) throw new Error(`Marketplace confirmation required: ${missing.join(', ')}`)
    if (plan.environmentRequirements.length > 0) {
      const request: MarketplaceInputRequest = {
        pluginId: plan.pluginId,
        requirements: plan.environmentRequirements,
        transactionId: randomUUID(),
      }
      this.#pendingInput = { candidates: null, confirmations: [...confirmations], mode, plans: null, request }
      this.setProgress({ transactionId: request.transactionId, phase: 'staging', stage: 'collect-input', percent: null, cancelable: false, requiresRestart: plan.requiresRestart })
      this.#lastAction = `Waiting for configuration for ${plan.pluginId}.`
      return
    }
    await this.stagePlan(mode)
    if (mode === 'direct') await this.applyActive()
  }

  private async provideInput(transactionId: string, answers: Record<string, string>): Promise<void> {
    const pending = this.#pendingInput
    if (pending === null || pending.request.transactionId !== transactionId) {
      throw new Error('marketplace has no matching configuration request')
    }
    for (const requirement of pending.request.requirements) {
      const answer = answers[requirement.name]
      if (answer === undefined || answer.trim() === '') {
        throw new Error(`missing required configuration: ${requirement.name}`)
      }
    }
    this.#pendingInput = null
    if (pending.plans !== null && pending.candidates !== null) {
      await this.stagePack(pending.mode, pending.request.pluginId, pending.plans, pending.candidates, answers)
    } else {
      await this.stagePlan(pending.mode, answers)
    }
    if (pending.mode === 'direct') await this.applyActive()
  }

  private async cancelStage(transactionId: string): Promise<void> {
    if (this.#tx.active === null || this.#tx.active.operation.transactionId !== transactionId) {
      throw new Error('marketplace has no matching staged operation')
    }
    if (this.#tx.phase !== 'staging') throw new Error('only staging operations can be cancelled')
    const pluginId = operationLabel(this.#tx.active.operation)
    await this.discard()
    this.#lastAction = `Cancelled marketplace operation for ${pluginId}.`
  }

  private async executePack(
    packId: string,
    mode: 'direct' | 'preview',
    confirmations: readonly MarketplaceConfirmation[],
  ): Promise<void> {
    const pack = this.#packs.find(entry => entry.id === packId)
    if (pack === undefined || pack.entries.length === 0) throw new Error(`marketplace pack is unavailable: ${packId}`)
    const plans: MarketplacePlan[] = []
    const candidates: MarketplaceCandidate[] = []
    for (const entry of pack.entries) {
      await this.resolvePlan(entry.action, entry.pluginId)
      if (this.#tx.plan === null || this.#tx.candidate === null) throw new Error(`pack member could not be planned: ${entry.pluginId}`)
      plans.push(this.#tx.plan)
      candidates.push(this.#tx.candidate)
    }
    const missing = [...new Set(plans.flatMap(plan => plan.requirements))]
      .filter(requirement => !confirmations.includes(requirement))
    if (missing.length > 0) throw new Error(`Marketplace confirmation required: ${missing.join(', ')}`)
    const environmentRequirements = [...new Map(plans
      .flatMap(plan => plan.environmentRequirements)
      .map(requirement => [requirement.name, requirement] as const)).values()]
    if (environmentRequirements.length > 0) {
      const request: MarketplaceInputRequest = {
        pluginId: packId,
        requirements: environmentRequirements,
        transactionId: randomUUID(),
      }
      this.#pendingInput = { candidates, confirmations: [...confirmations], mode, plans, request }
      this.setProgress({ transactionId: request.transactionId, phase: 'staging', stage: 'collect-input', percent: null, cancelable: false, requiresRestart: plans.some(plan => plan.requiresRestart) })
      this.#lastAction = `Waiting for configuration for pack ${packId}.`
      return
    }
    await this.stagePack(mode, packId, plans, candidates)
    if (mode === 'direct') await this.applyActive()
  }

  private async stagePack(
    mode: 'direct' | 'preview',
    packId: string,
    plans: readonly MarketplacePlan[],
    candidates: readonly MarketplaceCandidate[],
    environment: Record<string, string> = {},
  ): Promise<void> {
    const transactionId = randomUUID()
    const root = join(this.#previewsRoot, transactionId)
    const candidateHome = join(root, 'dsh')
    const candidateProfile = join(candidateHome, 'profiles', this.#options.profile)
    const requiresRestart = plans.some(plan => plan.requiresRestart)
    this.setProgress({ transactionId, phase: 'staging', stage: 'copy', percent: 0, cancelable: true, requiresRestart })
    try {
      copyDirectory(this.#profileDir, candidateProfile)
      removeWithin(candidateProfile, join(candidateProfile, 'node_modules'), this.#warn)
      rmSync(join(candidateProfile, 'pnpm-lock.yaml'), { force: true })
      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index]
        const candidate = candidates[index]
        if (plan === undefined || candidate === undefined) continue
        this.#tx.plan = plan
        this.#tx.candidate = candidate
        this.setProgress({ transactionId, phase: 'staging', stage: 'install', percent: null, cancelable: false, requiresRestart })
        await applyPlanToPreviewProfile({
          platform: this.#options.platform,
          removeBundle: async installed => { await this.removeBundle(candidateHome, candidateProfile, root, installed) },
          warn: this.#warn,
          profileName: this.#options.profile,
          candidateHome,
          candidateProfile,
          root,
          plan,
          candidate,
          environment,
          isCancelled: () => this.#cancelRequested,
        })
      }
      this.throwIfCancelled()
      this.setProgress({ transactionId, phase: 'staging', stage: 'verify', percent: 100, cancelable: false, requiresRestart })
      const operation: MarketplacePreview = {
        action: 'pack',
        actions: plans.map(plan => plan.action),
        packId,
        pluginId: `pack:${packId}`,
        requiresRestart,
        resolvedCommit: plans.at(-1)?.resolvedCommit ?? '',
        startedAt: new Date().toISOString(),
        transactionId,
      }
      this.#tx.active = { candidateHome, candidateProfile, operation, root }
      this.#transition('staging')
      if (mode === 'preview') {
        this.#transition('previewing')
        await this.#options.runtime.startPreview({ dshHome: candidateHome, pluginId: operation.pluginId, sandboxRoot: root, transactionId })
        this.setProgress({ transactionId, phase: 'staging', stage: 'restart', percent: 100, cancelable: false, requiresRestart })
        this.#lastAction = `Isolated pack preview is ready for ${packId}.`
      } else {
        this.#lastAction = `Staged pack ${packId}.`
      }
    } catch (error) {
      this.#tx.active = null
      this.#tx.plan = null
      this.#tx.candidate = null
      this.#progress = null
      await this.#options.runtime.stopPreview().catch(() => {})
      removeWithin(this.#previewsRoot, root, this.#warn)
      this.#settle()
      throw error
    }
  }

  private throwIfCancelled(): void {
    if (this.#cancelRequested) throw new Error('marketplace operation cancelled')
  }

  private async stagePlan(mode: 'direct' | 'preview', environment: Record<string, string> = {}): Promise<void> {
    const plan = this.#tx.plan
    const candidate = this.#tx.candidate
    if (plan === null || candidate === null) throw new Error('marketplace plan is missing its candidate')
    const transactionId = randomUUID()
    const root = join(this.#previewsRoot, transactionId)
    const candidateHome = join(root, 'dsh')
    const candidateProfile = join(candidateHome, 'profiles', this.#options.profile)
    this.setProgress({ transactionId, phase: 'staging', stage: 'copy', percent: 0, cancelable: true, requiresRestart: plan.requiresRestart })
    try {
      copyDirectory(this.#profileDir, candidateProfile)
      this.throwIfCancelled()
      if (plan.action === 'install' || plan.action === 'update' || plan.action === 'uninstall') {
        removeWithin(candidateProfile, join(candidateProfile, 'node_modules'), this.#warn)
        rmSync(join(candidateProfile, 'pnpm-lock.yaml'), { force: true })
      }
      this.setProgress({ transactionId, phase: 'staging', stage: 'install', percent: null, cancelable: false, requiresRestart: plan.requiresRestart })
      await applyPlanToPreviewProfile({
        platform: this.#options.platform,
        removeBundle: async installed => { await this.removeBundle(candidateHome, candidateProfile, root, installed) },
        warn: this.#warn,
        profileName: this.#options.profile,
        candidateHome,
        candidateProfile,
        root,
        plan,
        candidate,
        environment,
        isCancelled: () => this.#cancelRequested,
      })
      this.throwIfCancelled()
      this.setProgress({ transactionId, phase: 'staging', stage: 'verify', percent: 100, cancelable: false, requiresRestart: plan.requiresRestart })
      const operation: MarketplacePreview = {
        action: plan.action,
        actions: [plan.action],
        packId: null,
        pluginId: plan.pluginId,
        requiresRestart: plan.requiresRestart,
        resolvedCommit: plan.resolvedCommit,
        startedAt: new Date().toISOString(),
        transactionId,
      }
      this.#tx.active = { candidateHome, candidateProfile, operation, root }
      this.#transition('staging')
      if (mode === 'preview') {
        this.#transition('previewing')
        await this.#options.runtime.startPreview({ dshHome: candidateHome, pluginId: plan.pluginId, sandboxRoot: root, transactionId })
        this.setProgress({ transactionId, phase: 'staging', stage: 'restart', percent: 100, cancelable: false, requiresRestart: plan.requiresRestart })
        this.#lastAction = `Isolated ${plan.action} preview is ready for ${plan.pluginId}.`
      } else {
        this.#lastAction = `Staged ${plan.action} for ${plan.pluginId}.`
      }
    } catch (error) {
      this.#tx.active = null
      this.#pendingInput = null
      this.#progress = null
      this.#transition('planning')
      if (mode === 'preview') await this.#options.runtime.stopPreview().catch(() => {})
      removeWithin(this.#previewsRoot, root, this.#warn)
      throw error
    }
  }

  private setProgress(input: {
    transactionId: string
    phase: MarketplaceProgress['phase']
    stage: MarketplaceProgress['stage']
    percent?: number | null
    bytesDone?: number | null
    bytesTotal?: number | null
    speedBytesPerSecond?: number | null
    etaSeconds?: number | null
    cancelable?: boolean
    requiresRestart?: boolean
    logTail?: string[]
  }): void {
    const previous = this.#progress
    this.#progress = {
      bytesDone: input.bytesDone ?? previous?.bytesDone ?? null,
      bytesTotal: input.bytesTotal ?? previous?.bytesTotal ?? null,
      cancelable: input.cancelable ?? false,
      etaSeconds: input.etaSeconds ?? null,
      logTail: input.logTail ?? [...(previous?.logTail ?? []), input.stage].slice(-8),
      percent: input.percent === undefined ? previous?.percent ?? null : input.percent,
      phase: input.phase,
      requiresRestart: input.requiresRestart ?? previous?.requiresRestart ?? true,
      speedBytesPerSecond: input.speedBytesPerSecond ?? null,
      stage: input.stage,
      transactionId: input.transactionId,
    }
    this.#options.onStateChange?.()
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
      this.#tx.plan = null
      this.#tx.candidate = null
      this.#pendingInput = null
      this.#progress = null
      this.#settle()
      return
    }
    if (this.#tx.phase === 'previewing') await this.#options.runtime.stopPreview()
    removeWithin(this.#previewsRoot, active.root, this.#warn)
    this.#tx.active = null
    this.#tx.plan = null
    this.#tx.candidate = null
    this.#pendingInput = null
    this.#progress = null
    this.#lastAction = `Discarded the staged ${operationLabel(active.operation)} change without changing the live profile.`
    this.#settle()
  }

  private async applyActive(): Promise<void> {
    const active = this.#tx.active
    if (active === null || (this.#tx.phase !== 'staging' && this.#tx.phase !== 'previewing')) {
      throw new Error(phaseRejection('apply', this.#tx.phase))
    }
    const wasPreviewing = this.#tx.phase === 'previewing'
    this.#transition('applying')
    this.setProgress({ transactionId: active.operation.transactionId, phase: 'applying', stage: 'swap', percent: 0, cancelable: false, requiresRestart: active.operation.requiresRestart })
    const rollbackRoot = join(this.#rollbacksRoot, active.operation.transactionId)
    const backupProfile = join(rollbackRoot, this.#options.profile)
    // Intent-before-rename: durably record the applying intent BEFORE any
    // profile rename (and before runtime teardown), so a crash in any window
    // (W1..W5) leaves a reconcilable ledger instead of an unmarked
    // half-swap.
    const priorJournal = readRawJournal(this.#rollbackStatePath)
    writeJournal(this.#rollbackStatePath, journalIntentRecord('applying', {
      backupProfile,
      pluginId: operationLabel(active.operation),
      transactionId: active.operation.transactionId,
    }))
    let candidateInstalled = false
    try {
      if (wasPreviewing) await this.#options.runtime.stopPreview()
      await this.#options.runtime.stopLive()
      mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 })
      renameSync(this.#profileDir, backupProfile)
      renameSync(active.candidateProfile, this.#profileDir)
      candidateInstalled = true
      this.setProgress({ transactionId: active.operation.transactionId, phase: 'applying', stage: 'rehoming', percent: 50, cancelable: false, requiresRestart: active.operation.requiresRestart })
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
      this.setProgress({ transactionId: active.operation.transactionId, phase: 'applying', stage: 'restart', percent: 90, cancelable: false, requiresRestart: active.operation.requiresRestart })
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
      // Keep the staged candidate available for an explicit retry.
      this.#progress = null
      this.#transition(wasPreviewing ? 'previewing' : 'staging')
      throw new Error(`plugin ${wasPreviewing ? 'preview' : 'direct install'} failed to apply and was rolled back: ${message(error)}`)
    }
    this.#tx.rollback = {
      appliedAt: new Date().toISOString(),
      backupProfile,
      pluginId: operationLabel(active.operation),
      transactionId: active.operation.transactionId,
    }
    // Terminal journal state: the swap completed and is durably committed;
    // this write is also where a v1 record lazily upgrades to v2.
    writeJournal(this.#rollbackStatePath, journalAppliedRecord({
      appliedAt: this.#tx.rollback.appliedAt,
      backupProfile,
      pluginId: operationLabel(active.operation),
      transactionId: active.operation.transactionId,
    }))
    removeWithin(this.#previewsRoot, active.root, this.#warn)
    const requiresRestart = active.operation.requiresRestart
    this.#tx.active = null
    this.#tx.plan = null
    this.#tx.candidate = null
    this.#pendingInput = null
    this.#progress = null
    this.#lastAction = `Applied ${operationLabel(active.operation)}; the previous profile remains available for Undo${requiresRestart ? '; restart required.' : '.'}`
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
    this.setProgress({ transactionId: rollback.transactionId, phase: 'undoing', stage: 'swap', percent: 0, cancelable: false, requiresRestart: true })
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
    let restored = false
    try {
      await this.#options.runtime.stopLive()
      renameSync(this.#profileDir, replacedProfile)
      renameSync(rollback.backupProfile, this.#profileDir)
      restored = true
      this.setProgress({ transactionId: rollback.transactionId, phase: 'undoing', stage: 'restart', percent: 90, cancelable: false, requiresRestart: true })
      await this.#options.runtime.startLive()
    } catch (error) {
      await this.#options.runtime.stopLive().catch(() => {})
      if (restored && existsSync(this.#profileDir)) renameSync(this.#profileDir, rollback.backupProfile)
      if (existsSync(replacedProfile)) renameSync(replacedProfile, this.#profileDir)
      await this.#options.runtime.startLive().catch(() => {})
      // The restore failed on disk; put the applied journal back verbatim so
      // the recovery point survives.
      restoreJournal(this.#rollbackStatePath, priorJournal)
      // The recovery point stays (the next constructor reconcile handles a
      // crashed undo).
      this.#progress = null
      this.#transition('applied-with-undo')
      throw new Error(`failed to restore the previous plugin profile: ${message(error)}`)
    }
    removeWithin(this.#rollbacksRoot, replacedProfile, this.#warn)
    clearJournal(this.#rollbackStatePath)
    removeWithin(this.#rollbacksRoot, rollbackRoot, this.#warn)
    this.#tx.rollback = null
    this.#progress = null
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
