import type {
  MarketplaceCandidate,
  SourceRef,
} from './host/source-types.ts'

export type { MarketplaceCandidate, SourceRef } from './host/source-types.ts'

export const MARKETPLACE_CATALOG_REPOSITORY = 'whyihaveyou/dsh-suite'
export const MARKETPLACE_CATALOG_PATH = 'data/plugins.json'

export type MarketplaceAuthStatus = 'ready' | 'missing-cli' | 'signed-out' | 'error'
export type MarketplaceMechanism = 'bundle' | 'repository' | 'discover' | 'unsupported'
export type MarketplaceInstallMechanism = 'bundle' | 'repository'
export type MarketplaceAction = 'install' | 'update' | 'enable' | 'disable' | 'uninstall'
export type MarketplaceRuntimeRisk = 'profile-bundle' | 'trusted-host' | 'guided'
export type MarketplaceTrust = 'organization' | 'community' | 'untrusted'
export type MarketplaceRiskLevel = 'low' | 'elevated' | 'high' | 'blocked'
export type MarketplaceRiskReason =
  | 'install-scripts'
  | 'trusted-host-code'
  | 'source-change'
  | 'protected-plugin'
  | 'unsupported-runtime'
  | 'untrusted-source'
  | 'incompatible-peer'
export type MarketplaceSourceReview = 'first-use' | 'matched' | 'changed'
export type MarketplaceConfirmation =
  | 'allow-build-scripts'
  | 'accept-high-risk'
  | 'accept-source-change'

/** Distribution channel selected after catalog and artifact verification. */
export type MarketplaceInstallChannel = 'github' | 'npm' | 'tarball'

/** Stable client-side ordering presets; the host remains the source of truth. */
export type MarketplaceSort = 'smart' | 'stars' | 'downloads' | 'updated' | 'name'

export type MarketplaceCompatibilityStatus = 'unknown' | 'ok' | 'broken' | 'unmaintained'

export interface MarketplaceCompatibility {
  status: MarketplaceCompatibilityStatus
  dshVersion?: string | null
  lastVerified?: string | null
  note?: string | null
}

export interface MarketplaceEnvironmentRequirement {
  name: string
  description: string
  secret: boolean
}

export interface MarketplaceInputRequest {
  transactionId: string
  pluginId: string
  requirements: MarketplaceEnvironmentRequirement[]
}

export type MarketplaceProgressPhase = 'staging' | 'applying' | 'undoing'
export type MarketplaceProgressStage =
  | 'copy'
  | 'fetch'
  | 'install'
  | 'verify'
  | 'rehoming'
  | 'swap'
  | 'restart'
  | 'collect-input'

export interface MarketplaceProgress {
  transactionId: string
  phase: MarketplaceProgressPhase
  stage: MarketplaceProgressStage
  percent: number | null
  bytesDone: number | null
  bytesTotal: number | null
  speedBytesPerSecond: number | null
  etaSeconds: number | null
  logTail: string[]
  cancelable: boolean
  requiresRestart: boolean
}

export interface MarketplaceSelfUpdate {
  installedVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  channel: 'stable' | 'beta' | 'dev'
  checkedAt: string | null
}

export interface MarketplacePackEntry {
  action: MarketplaceAction
  pluginId: string
}

export interface MarketplacePack {
  id: string
  title: string
  description: string
  entries: MarketplacePackEntry[]
  tags: string[]
}

const PROTECTED_PLUGIN_IDS = new Set([
  'capabilities',
  'desktop',
  'sidebar',
  'dsh-better-sidebar',
  'sidebar',
  'dsh-studio',
  'panel-controls',
  'pinned-summary',
  'plugin-marketplace',
  'workspace-tools',
])

const PROTECTED_PLUGIN_PACKAGES = new Set([
  '@dsh-studio/capabilities',
  '@dsh-studio/desktop',
  '@dsh-studio/sidebar',
  '@dsh-studio/panel-controls',
  '@dsh-studio/sidebar',
  'dsh-better-sidebar',
])

const PROTECTED_PLUGIN_REPOSITORIES = new Set([
  'dsh-external/dsh-better-sidebar',
  'omdsh-dev/dsh-better-sidebar',
])

/** Marketplace code cannot replace the desktop or its transaction owner. */
export function isProtectedMarketplacePlugin(
  pluginId: string,
  repository?: string | null,
  packageName?: string | null,
): boolean {
  return PROTECTED_PLUGIN_IDS.has(pluginId.toLowerCase())
    || (repository !== undefined && repository !== null
      && PROTECTED_PLUGIN_REPOSITORIES.has(repository.toLowerCase()))
    || (packageName !== undefined && packageName !== null
      && PROTECTED_PLUGIN_PACKAGES.has(packageName.toLowerCase()))
}

export interface MarketplacePlugin {
  catalogSourceId: string | null
  category: string
  description: string
  currentCommit: string | null
  enabled: boolean
  id: string
  installed: boolean
  latestCommit: string | null
  mechanism: MarketplaceMechanism
  protected: boolean
  pushedAt: string | null
  repository: string
  runtimeRisk: MarketplaceRuntimeRisk
  tags: string[]
  title: string
  trust: MarketplaceTrust
  updateAvailable: boolean
  url: string
  stars: number
  downloads: number | null
  weeklyGrowth: number | null
  descriptionByLocale: { en: string; zh: string }
  compatibility: MarketplaceCompatibility
  screenshots: string[]
  readmeSummary: string | null
  homepage: string | null
  version: string | null
  npm: string | null
  sourceNote: string | null
  officialBeta: boolean
  evidenceLevel: number | null
  score: number | null
  scoreExplanation: string | null
  watchReason: string | null
  preferredChannel: MarketplaceInstallChannel | null
  installCommand: string | null
  releaseAssetUrl: string | null
  releaseAssetDigest: string | null
}

export interface MarketplaceInstalledPlugin {
  artifactUrl: string | null
  channel: MarketplaceInstallChannel
  installedAt: string
  mechanism: MarketplaceInstallMechanism
  packageName: string | null
  pluginId: string
  resolvedCommit: string
  source: string
  version: string | null
}

export interface MarketplaceSourceLock {
  artifactDigest: string
  canonicalSource: string
  catalogSourceId: string | null
  firstSeenCommit: string
  installSpec: string
  manifestHash: string
  manifestPath: string
  mechanism: MarketplaceInstallMechanism
  packageName: string
  patchHash: string | null
  pluginId: string
  recordedAt: string
  requestedRef: string | null
  resolvedCommit: string
  subpath: string | null
  channel: MarketplaceInstallChannel
  version: string | null
  artifactUrl: string | null
}

export interface MarketplacePlan {
  action: MarketplaceAction
  artifactDigest: string
  buildScripts: Record<string, string>
  channel: MarketplaceInstallChannel
  artifactUrl: string | null
  catalogSourceId: string | null
  description: string
  entryTargets: string[]
  execution: 'installable' | 'guide-only' | 'blocked'
  installSpec: string
  license: string | null
  manifestHash: string
  manifestPath: string
  mechanism: MarketplaceInstallMechanism
  packageName: string | null
  patchHash: string | null
  pluginId: string
  requirements: MarketplaceConfirmation[]
  environmentRequirements: MarketplaceEnvironmentRequirement[]
  fastPathEligible: boolean
  previewAvailable: boolean
  requiresRestart: boolean
  repository: string
  resolvedCommit: string
  riskLevel: MarketplaceRiskLevel
  riskReasons: MarketplaceRiskReason[]
  source: string
  sourceReview: MarketplaceSourceReview
  subpath: string | null
  version: string | null
}

export interface MarketplaceApprovalDecision {
  action: MarketplaceAction | null
  applyConfirmationRequired: boolean
  directInstallAllowed: boolean
  fastPathEligible: boolean
  previewAvailable: boolean
  buildScriptConfirmationRequired: boolean
  recoveryConfirmationRequired: boolean
  requiredConfirmations: MarketplaceConfirmation[]
  riskLevel: MarketplaceRiskLevel
  riskReasons: MarketplaceRiskReason[]
  sourceChangeConfirmationRequired: boolean
}

export type MarketplaceOperationAction = MarketplaceAction | 'pack'

export interface MarketplacePreview {
  /** `pack` is explicit so mixed pack actions are never reported as install. */
  action: MarketplaceOperationAction
  actions: MarketplaceAction[]
  packId: string | null
  pluginId: string
  requiresRestart: boolean
  resolvedCommit: string
  startedAt: string
  transactionId: string
}

export interface MarketplaceRecoveryPoint {
  appliedAt: string
  pluginId: string
  transactionId: string
}

export interface MarketplaceLifecycle {
  candidate: MarketplacePreview | null
  current: {
    profile: string
    state: 'live'
  }
  previous: MarketplaceRecoveryPoint | null
}

export interface MarketplaceSnapshot {
  approval?: MarketplaceApprovalDecision
  auth: {
    detail: string
    status: MarketplaceAuthStatus
  }
  busy: boolean
  candidate?: MarketplaceCandidate | null
  catalog: MarketplacePlugin[]
  catalogGeneratedAt: string | null
  catalogWatchlist: MarketplacePlugin[]
  error: string | null
  installed: MarketplaceInstalledPlugin[]
  lastAction: string | null
  lifecycle: MarketplaceLifecycle
  plan: MarketplacePlan | null
  preview: MarketplacePreview | null
  progress: MarketplaceProgress | null
  inputRequest: MarketplaceInputRequest | null
  packs: MarketplacePack[]
  selfUpdate: MarketplaceSelfUpdate | null
  sourceLocks: MarketplaceSourceLock[]
  undoAvailable: boolean
}

export type MarketplaceTarget =
  | { pluginId: string; sourceRef?: never }
  | { pluginId?: never; sourceRef: SourceRef }

export type MarketplaceExecutionMode = 'direct' | 'preview'

export type MarketplaceCommand =
  | { type: 'refresh'; force?: boolean }
  | ({ type: 'plan'; action: MarketplaceAction } & MarketplaceTarget)
  | ({
    type: 'execute'
    action: MarketplaceAction
    mode: MarketplaceExecutionMode
    confirmations?: MarketplaceConfirmation[]
  } & MarketplaceTarget)
  | ({
    type: 'pack'
    packId: string
    mode: MarketplaceExecutionMode
    confirmations?: MarketplaceConfirmation[]
  })
  | { type: 'apply' }
  | { type: 'discard' }
  | { type: 'cancel'; transactionId: string }
  | { type: 'provide'; transactionId: string; answers: Record<string, string> }
  | { type: 'undo' }

export interface PluginMarketplaceBridge {
  dispatch(command: MarketplaceCommand): Promise<MarketplaceSnapshot>
  getSnapshot(): Promise<MarketplaceSnapshot>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseMarketplaceSourceRef(value: unknown): SourceRef {
  if (!isRecord(value) || (value.kind !== 'catalog' && value.kind !== 'repository')) {
    throw new Error('invalid marketplace sourceRef')
  }
  if (value.kind === 'catalog') {
    if (typeof value.pluginId !== 'string' || value.pluginId.trim() === ''
      || (value.catalogSourceId !== undefined
        && value.catalogSourceId !== null && typeof value.catalogSourceId !== 'string')) {
      throw new Error('invalid marketplace catalog sourceRef')
    }
    return {
      catalogSourceId: value.catalogSourceId === undefined ? null : value.catalogSourceId as string | null,
      kind: 'catalog',
      pluginId: value.pluginId.trim(),
    }
  }
  if (typeof value.input !== 'string' || value.input.trim() === ''
    || (value.catalogSourceId !== undefined
      && value.catalogSourceId !== null && typeof value.catalogSourceId !== 'string')
    || (value.requestedRef !== undefined
      && value.requestedRef !== null && typeof value.requestedRef !== 'string')
    || (value.subpath !== undefined
      && value.subpath !== null && typeof value.subpath !== 'string')) {
    throw new Error('invalid marketplace repository sourceRef')
  }
  return {
    catalogSourceId: value.catalogSourceId === undefined ? null : value.catalogSourceId as string | null,
    input: value.input.trim(),
    kind: 'repository',
    requestedRef: value.requestedRef === undefined ? null : value.requestedRef as string | null,
    subpath: value.subpath === undefined ? null : value.subpath as string | null,
  }
}

const MARKETPLACE_ACTIONS = new Set<MarketplaceAction>([
  'install',
  'update',
  'enable',
  'disable',
  'uninstall',
])

const MARKETPLACE_CONFIRMATIONS = new Set<MarketplaceConfirmation>([
  'allow-build-scripts',
  'accept-high-risk',
  'accept-source-change',
])

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`)
  return value.trim()
}

function parseTarget(value: Record<string, unknown>): MarketplaceTarget {
  const pluginId = typeof value.pluginId === 'string' && value.pluginId.trim() !== ''
    ? value.pluginId.trim()
    : undefined
  const sourceRef = value.sourceRef === undefined ? undefined : parseMarketplaceSourceRef(value.sourceRef)
  if (pluginId === undefined && sourceRef === undefined) throw new Error('marketplace command needs pluginId or sourceRef')
  if (pluginId !== undefined && sourceRef !== undefined) {
    throw new Error('marketplace command target must contain either pluginId or sourceRef')
  }
  return pluginId === undefined ? { sourceRef: sourceRef as SourceRef } : { pluginId }
}

function parseAction(value: unknown): MarketplaceAction {
  if (typeof value !== 'string' || !MARKETPLACE_ACTIONS.has(value as MarketplaceAction)) {
    throw new Error('invalid marketplace action')
  }
  return value as MarketplaceAction
}

function parseMode(value: unknown): MarketplaceExecutionMode {
  if (value !== 'direct' && value !== 'preview') throw new Error('marketplace execution mode must be direct or preview')
  return value
}

function parseConfirmations(value: unknown): MarketplaceConfirmation[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string'
    || !MARKETPLACE_CONFIRMATIONS.has(entry as MarketplaceConfirmation))) {
    throw new Error('invalid marketplace confirmations')
  }
  return [...new Set(value as MarketplaceConfirmation[])]
}

function parseAnswers(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error('marketplace answers must be an object')
  const answers: Record<string, string> = {}
  for (const [name, answer] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof answer !== 'string') {
      throw new Error('marketplace answers contain an invalid field')
    }
    answers[name] = answer
  }
  return answers
}

export function parseMarketplaceCommand(value: unknown): MarketplaceCommand {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('marketplace command must be an object with a type')
  }
  if (value.type === 'refresh') {
    if (value.force !== undefined && typeof value.force !== 'boolean') throw new Error('invalid marketplace refresh command')
    return value.force === undefined ? { type: 'refresh' } : { type: 'refresh', force: value.force }
  }
  if (value.type === 'plan') {
    return { type: 'plan', action: parseAction(value.action), ...parseTarget(value) }
  }
  if (value.type === 'execute') {
    return {
      type: 'execute',
      action: parseAction(value.action),
      mode: parseMode(value.mode),
      confirmations: parseConfirmations(value.confirmations),
      ...parseTarget(value),
    }
  }
  if (value.type === 'pack') {
    return {
      type: 'pack',
      packId: requiredText(value.packId, 'marketplace packId'),
      mode: parseMode(value.mode),
      confirmations: parseConfirmations(value.confirmations),
    }
  }
  if (value.type === 'apply' || value.type === 'discard' || value.type === 'undo') return { type: value.type }
  if (value.type === 'cancel') return { type: 'cancel', transactionId: requiredText(value.transactionId, 'marketplace transactionId') }
  if (value.type === 'provide') {
    return {
      type: 'provide',
      transactionId: requiredText(value.transactionId, 'marketplace transactionId'),
      answers: parseAnswers(value.answers),
    }
  }
  throw new Error(`unsupported marketplace command: ${value.type}`)
}
