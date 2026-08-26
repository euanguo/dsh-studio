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
}

export interface MarketplaceInstalledPlugin {
  installedAt: string
  mechanism: MarketplaceInstallMechanism
  packageName: string | null
  pluginId: string
  resolvedCommit: string
  source: string
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
}

export interface MarketplacePlan {
  action: MarketplaceAction
  artifactDigest: string
  buildScripts: Record<string, string>
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
  buildScriptConfirmationRequired: boolean
  recoveryConfirmationRequired: boolean
  requiredConfirmations: MarketplaceConfirmation[]
  riskLevel: MarketplaceRiskLevel
  riskReasons: MarketplaceRiskReason[]
  sourceChangeConfirmationRequired: boolean
}

export interface MarketplacePreview {
  action: MarketplaceAction
  pluginId: string
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
  error: string | null
  installed: MarketplaceInstalledPlugin[]
  lastAction: string | null
  lifecycle: MarketplaceLifecycle
  plan: MarketplacePlan | null
  preview: MarketplacePreview | null
  sourceLocks: MarketplaceSourceLock[]
  undoAvailable: boolean
}

export type MarketplaceCommand =
  | { type: 'refresh'; force?: boolean }
  | {
    type: 'inspect'
    action: MarketplaceAction
    pluginId?: string
    sourceRef?: SourceRef
  }
  | {
    type: 'prepare'
    action: MarketplaceAction
    pluginId?: string
    sourceRef?: SourceRef
  }
  | {
    type: 'preview'
    confirmations?: MarketplaceConfirmation[]
  }
  | { type: 'discard' }
  | { type: 'apply' }
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

export function parseMarketplaceCommand(value: unknown): MarketplaceCommand {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('marketplace command must be an object with a type')
  }
  if (value.type === 'refresh') {
    if (value.force !== undefined && typeof value.force !== 'boolean') {
      throw new Error('invalid marketplace refresh command')
    }
    return value.force === undefined
      ? { type: 'refresh' }
      : { type: 'refresh', force: value.force }
  }
  if (value.type === 'discard' || value.type === 'apply' || value.type === 'undo') {
    return { type: value.type }
  }
  if (value.type === 'inspect' || value.type === 'prepare') {
    if (!['install', 'update', 'enable', 'disable', 'uninstall'].includes(String(value.action))) {
      throw new Error('invalid marketplace inspect command')
    }
    const pluginId = typeof value.pluginId === 'string' && value.pluginId.trim() !== ''
      ? value.pluginId.trim()
      : undefined
    const sourceRef = value.sourceRef === undefined
      ? undefined
      : parseMarketplaceSourceRef(value.sourceRef)
    if (pluginId === undefined && sourceRef === undefined) {
      throw new Error('marketplace inspect command needs pluginId or sourceRef')
    }
    if (sourceRef?.kind === 'catalog' && pluginId !== undefined && sourceRef.pluginId !== pluginId) {
      throw new Error('marketplace pluginId and sourceRef identify different plugins')
    }
    if (sourceRef?.kind === 'repository' && pluginId !== undefined) {
      throw new Error('marketplace inspect command with a repository sourceRef must not provide a separate pluginId')
    }
    return {
      type: value.type,
      action: value.action as MarketplaceAction,
      ...(pluginId === undefined ? {} : { pluginId }),
      ...(sourceRef === undefined ? {} : { sourceRef }),
    }
  }
  if (value.type === 'preview') {
    const valid = new Set<MarketplaceConfirmation>([
      'allow-build-scripts',
      'accept-high-risk',
      'accept-source-change',
    ])
    if (value.confirmations !== undefined
      && (!Array.isArray(value.confirmations)
        || value.confirmations.some(entry => typeof entry !== 'string'
          || !valid.has(entry as MarketplaceConfirmation)))) {
      throw new Error('invalid marketplace preview confirmations')
    }
    const confirmations = Array.isArray(value.confirmations)
      ? value.confirmations as MarketplaceConfirmation[]
      : [] satisfies MarketplaceConfirmation[]
    return { type: 'preview', confirmations }
  }
  throw new Error(`unsupported marketplace command: ${value.type}`)
}
