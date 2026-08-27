import type {
  MarketplaceAction,
  MarketplaceApprovalDecision,
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceSort,
  MarketplaceSnapshot,
  MarketplaceTarget,
} from '../plugins/plugin-marketplace/src/protocol.ts'
import { sortMarketplacePlugins } from '../plugins/plugin-marketplace/src/client/marketplace-meta.ts'
import { MARKETPLACE_AGENT_TOKEN_ENV, MARKETPLACE_AGENT_URL_ENV } from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'

interface ToolRunContext { concludeTurn(): void }
interface AgentToolResult { data: string; summary: string }
interface GatewayResponse { accepted?: boolean; deferred?: boolean; error?: string; snapshot?: MarketplaceSnapshot }
interface GatewayCredentials { token: string; url: string }
interface ToolDefinition {
  description: string
  execute(args: Record<string, unknown>, exec: ToolRunContext): Promise<unknown>
  name: string
  output: {
    render(args: Record<string, unknown>, value: AgentToolResult): Array<{ text: string; type: 'text' }>
    schema: Record<string, unknown>
  }
  parameters: Record<string, unknown>
}

export interface MarketplaceToolContext {
  on(
    name: 'tools/pre-execute',
    listener: (
      exec: { name: string },
      next: () => Promise<{ kind: 'allow' | 'ask' | 'deny'; reason?: string }>,
    ) => Promise<{ kind: 'allow' | 'ask' | 'deny'; reason?: string }>,
  ): unknown
  tools: { register(definition: ToolDefinition): unknown }
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { summary: { type: 'string' }, data: { type: 'string' } },
  required: ['summary', 'data'],
} as const

function output(): ToolDefinition['output'] {
  return {
    schema: RESULT_SCHEMA,
    render: (_args, value) => [{ type: 'text', text: value.data === '' ? value.summary : `${value.summary}\n${value.data}` }],
  }
}

function result(summary: string, value?: unknown): AgentToolResult {
  return { data: value === undefined ? '' : JSON.stringify(value, undefined, 2), summary }
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function target(args: Record<string, unknown>): MarketplaceTarget {
  const pluginId = typeof args.pluginId === 'string' && args.pluginId.trim() !== '' ? args.pluginId.trim() : null
  const source = typeof args.sourceRef === 'string' && args.sourceRef.trim() !== '' ? args.sourceRef.trim() : null
  if (pluginId !== null && source !== null) throw new Error('provide either pluginId or sourceRef, not both')
  if (pluginId === null && source === null) throw new Error('pluginId or sourceRef must be provided')
  return pluginId === null ? { sourceRef: { input: source as string, kind: 'repository' } } : { pluginId }
}

function confirmations(args: Record<string, unknown>): MarketplaceConfirmation[] {
  if (args.confirmations === undefined) return []
  if (!Array.isArray(args.confirmations)) throw new Error('confirmations must be an array')
  const allowed = new Set<MarketplaceConfirmation>(['allow-build-scripts', 'accept-high-risk', 'accept-source-change'])
  if (args.confirmations.some(value => typeof value !== 'string' || !allowed.has(value as MarketplaceConfirmation))) throw new Error('invalid marketplace confirmation')
  return [...new Set(args.confirmations as MarketplaceConfirmation[])]
}

function pluginView(plugin: MarketplacePlugin): Record<string, unknown> {
  return {
    category: plugin.category,
    compatibility: plugin.compatibility,
    description: plugin.descriptionByLocale,
    downloads: plugin.downloads,
    enabled: plugin.enabled,
    id: plugin.id,
    installed: plugin.installed,
    mechanism: plugin.mechanism,
    npm: plugin.npm,
    preferredChannel: plugin.preferredChannel,
    protected: plugin.protected,
    repository: plugin.repository,
    score: plugin.score,
    stars: plugin.stars,
    tags: plugin.tags,
    title: plugin.title,
    trust: plugin.trust,
    updateAvailable: plugin.updateAvailable,
    url: plugin.url,
    version: plugin.version,
  }
}

function credentialsFromEnvironment(environment: NodeJS.ProcessEnv = process.env): GatewayCredentials | null {
  const url = environment[MARKETPLACE_AGENT_URL_ENV]
  const token = environment[MARKETPLACE_AGENT_TOKEN_ENV]
  delete environment[MARKETPLACE_AGENT_URL_ENV]
  delete environment[MARKETPLACE_AGENT_TOKEN_ENV]
  if (url === undefined || token === undefined) return null
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/v1/marketplace') throw new Error('desktop plugin marketplace gateway must use its loopback endpoint')
  return { token, url: parsed.href }
}

async function gateway(credentials: GatewayCredentials, request: unknown): Promise<GatewayResponse> {
  const response = await fetch(credentials.url, {
    body: JSON.stringify(request),
    headers: { authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(35_000),
  })
  let value: GatewayResponse = {}
  try { value = await response.json() as GatewayResponse } catch {}
  if (!response.ok || value.error !== undefined) throw new Error(value.error ?? `marketplace gateway failed with HTTP ${String(response.status)}`)
  return value
}

async function snapshot(credentials: GatewayCredentials, command?: MarketplaceCommand): Promise<MarketplaceSnapshot> {
  const response = await gateway(credentials, command === undefined ? { type: 'snapshot' } : { type: 'dispatch', command })
  if (response.snapshot === undefined) throw new Error('marketplace gateway omitted its snapshot')
  return requireHealthyMarketplaceSnapshot(response.snapshot)
}

export function requireHealthyMarketplaceSnapshot(value: MarketplaceSnapshot): MarketplaceSnapshot {
  if (value.error !== null) throw new Error(value.error)
  return value
}

function marketplaceTool(definition: Omit<ToolDefinition, 'output'>): ToolDefinition {
  const required: string[] = []
  const properties = Object.fromEntries(Object.entries(definition.parameters).map(([name, raw]) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [name, raw]
    const property = { ...raw as Record<string, unknown> }
    if (property.required === true) required.push(name)
    delete property.required
    return [name, property]
  }))
  return { ...definition, output: output(), parameters: { type: 'object', additionalProperties: false, properties, ...(required.length === 0 ? {} : { required }) } }
}

export function mountMarketplaceAgentTools(ctx: MarketplaceToolContext, environment: NodeJS.ProcessEnv = process.env): void {
  const credentials = credentialsFromEnvironment(environment)
  if (credentials === null) return
  let hostApproval: MarketplaceApprovalDecision | null = null
  const readSnapshot = async (command?: MarketplaceCommand): Promise<MarketplaceSnapshot> => {
    const info = await snapshot(credentials, command)
    hostApproval = info.approval ?? null
    return info
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'desktop_plugin_apply') {
      if (hostApproval?.applyConfirmationRequired === false) return { kind: 'deny', reason: 'There is no active preview to apply.' }
      return { kind: 'ask', reason: 'Apply the staged DSH plugin profile and restart DSH Studio?' }
    }
    if (exec.name === 'desktop_plugin_recover') {
      if (hostApproval?.recoveryConfirmationRequired === false) return { kind: 'deny', reason: 'There is no recoverable plugin profile.' }
      return { kind: 'ask', reason: 'Restore the previous DSH plugin profile and restart DSH Studio?' }
    }
    return await next()
  })

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_search',
    description: 'Search public DSH plugins visible to DSH Studio. Start here instead of guessing plugin names; use compatibility, popularity, trust and install-channel metadata to explain a recommendation. This is read-only.',
    parameters: {
      query: { type: 'string', description: 'Case-insensitive plugin name, description, category, tag or npm name.' },
      status: { type: 'string', enum: ['all', 'installed', 'not-installed', 'updates', 'disabled'], description: 'Optional lifecycle filter.' },
      category: { type: 'string', description: 'Optional exact category.' },
      sort: { type: 'string', enum: ['smart', 'stars', 'downloads', 'updated', 'name'], description: 'Ordering preset.' },
      refresh: { type: 'boolean', description: 'Refresh the catalog before searching.' },
    },
    async execute(args) {
      const info = await readSnapshot(args.refresh === true ? { type: 'refresh', force: true } : undefined)
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const status = typeof args.status === 'string' ? args.status : 'all'
      const category = typeof args.category === 'string' ? args.category : null
      const sort = (typeof args.sort === 'string' ? args.sort : 'smart') as MarketplaceSort
      const plugins = sortMarketplacePlugins(info.catalog.filter(plugin => {
        if (status === 'installed' && !plugin.installed) return false
        if (status === 'not-installed' && plugin.installed) return false
        if (status === 'updates' && !plugin.updateAvailable) return false
        if (status === 'disabled' && (!plugin.installed || plugin.enabled)) return false
        if (category !== null && plugin.category !== category) return false
        return query === '' || [plugin.id, plugin.title, plugin.description, plugin.descriptionByLocale.en, plugin.descriptionByLocale.zh, plugin.category, plugin.npm ?? '', ...plugin.tags].some(value => value.toLowerCase().includes(query))
      }), sort).slice(0, 50).map(pluginView)
      return result(`Found ${String(plugins.length)} matching DSH plugins.`, plugins)
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_status',
    description: 'Inspect DSH plugin lifecycle, progress, source locks and recovery state. This is read-only.',
    parameters: { pluginId: { type: 'string', description: 'Optional exact plugin id.' } },
    async execute(args) {
      const info = await readSnapshot()
      const pluginId = typeof args.pluginId === 'string' ? args.pluginId.trim() : ''
      return result(pluginId === '' ? 'DSH plugin marketplace state.' : `DSH plugin state for ${pluginId}.`, {
        approval: info.approval,
        candidate: info.candidate,
        inputRequest: info.inputRequest,
        lifecycle: info.lifecycle,
        packs: info.packs,
        plan: info.plan,
        plugins: info.catalog.filter(plugin => pluginId === '' || plugin.id === pluginId).map(pluginView),
        progress: info.progress,
        selfUpdate: info.selfUpdate,
        sourceLocks: info.sourceLocks.filter(lock => pluginId === '' || lock.pluginId === pluginId),
      })
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_plan',
    description: 'Plan a DSH plugin install, update, enable, disable or uninstall without changing the live profile. Explain the returned compatibility, trust, channel and risk facts to the user, then pass only explicitly accepted confirmations to execute.',
    parameters: {
      action: { type: 'string', required: true, enum: ['install', 'update', 'enable', 'disable', 'uninstall'] },
      pluginId: { type: 'string', description: 'Catalog plugin id.' },
      sourceRef: { type: 'string', description: 'Public GitHub owner/repo or URL for a direct source.' },
    },
    async execute(args) {
      const info = await readSnapshot({ type: 'plan', action: stringArg(args, 'action') as MarketplaceAction, ...target(args) })
      return result(`Planned ${info.plan?.action ?? 'plugin'} for ${info.plan?.pluginId ?? 'the requested source'}.`, { approval: info.approval, candidate: info.candidate, plan: info.plan })
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_execute',
    description: 'Execute a planned DSH plugin action. Use mode=direct for an eligible low-risk staged install, or mode=preview to open an isolated runtime before applying. Required confirmations must be explicitly supplied.',
    parameters: {
      action: { type: 'string', required: true, enum: ['install', 'update', 'enable', 'disable', 'uninstall'] },
      mode: { type: 'string', required: true, enum: ['direct', 'preview'] },
      confirmations: { type: 'array', items: { type: 'string', enum: ['allow-build-scripts', 'accept-high-risk', 'accept-source-change'] } },
      pluginId: { type: 'string', description: 'Catalog plugin id.' },
      sourceRef: { type: 'string', description: 'Public GitHub owner/repo or URL for a direct source.' },
    },
    async execute(args, exec) {
      const command: MarketplaceCommand = { type: 'execute', action: stringArg(args, 'action') as MarketplaceAction, mode: stringArg(args, 'mode') as 'direct' | 'preview', confirmations: confirmations(args), ...target(args) }
      const response = await gateway(credentials, { type: 'dispatch', command })
      if (response.deferred === true) exec.concludeTurn()
      const info = requireHealthyMarketplaceSnapshot(response.snapshot as MarketplaceSnapshot)
      return result(`DSH plugin ${info.plan?.action ?? 'operation'} accepted.`, { approval: info.approval, inputRequest: info.inputRequest, lifecycle: info.lifecycle, plan: info.plan, progress: info.progress })
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_pack',
    description: 'Install or preview a named DSH plugin pack as one transaction with one profile swap and one recovery point.',
    parameters: {
      packId: { type: 'string', required: true },
      mode: { type: 'string', required: true, enum: ['direct', 'preview'] },
      confirmations: { type: 'array', items: { type: 'string', enum: ['allow-build-scripts', 'accept-high-risk', 'accept-source-change'] } },
    },
    async execute(args, exec) {
      const command: MarketplaceCommand = { type: 'pack', packId: stringArg(args, 'packId'), mode: stringArg(args, 'mode') as 'direct' | 'preview', confirmations: confirmations(args) }
      const response = await gateway(credentials, { type: 'dispatch', command })
      if (response.deferred === true) exec.concludeTurn()
      const info = requireHealthyMarketplaceSnapshot(response.snapshot as MarketplaceSnapshot)
      return result('DSH plugin pack accepted.', { lifecycle: info.lifecycle, progress: info.progress, packs: info.packs })
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_provide',
    description: 'Provide missing configuration for an awaiting DSH plugin installation. Secret values are sent only to the local marketplace gateway and are never included in the tool result.',
    parameters: { transactionId: { type: 'string', required: true }, answers: { type: 'object', required: true, additionalProperties: { type: 'string' } } },
    async execute(args, exec) {
      const answers = args.answers
      if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('answers must be an object')
      const command: MarketplaceCommand = { type: 'provide', transactionId: stringArg(args, 'transactionId'), answers: answers as Record<string, string> }
      const response = await gateway(credentials, { type: 'dispatch', command })
      if (response.deferred === true) exec.concludeTurn()
      const info = requireHealthyMarketplaceSnapshot(response.snapshot as MarketplaceSnapshot)
      return result('Configuration accepted; the DSH plugin operation is continuing.', { inputRequest: info.inputRequest, progress: info.progress })
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_cancel',
    description: 'Cancel the active staging operation before it changes the live profile.',
    parameters: { transactionId: { type: 'string', required: true } },
    async execute(args) {
      const info = await readSnapshot({ type: 'cancel', transactionId: stringArg(args, 'transactionId') })
      return result('Cancelled the DSH plugin staging operation.', { lifecycle: info.lifecycle, progress: info.progress })
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_discard',
    description: 'Discard the staged or isolated DSH plugin operation without changing the live profile.',
    parameters: {},
    async execute() { const info = await readSnapshot({ type: 'discard' }); return result('Discarded the staged DSH plugin operation.', info.lifecycle) },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_apply',
    description: 'After human approval, apply the active isolated DSH plugin preview atomically and restart DSH Studio.',
    parameters: {},
    async execute(_args, exec) {
      const response = await gateway(credentials, { type: 'dispatch', command: { type: 'apply' } })
      if (response.deferred !== true) throw new Error('desktop preview apply was not scheduled')
      exec.concludeTurn()
      return result('DSH plugin preview apply accepted; DSH Studio will restart.')
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_recover',
    description: 'After human approval, restore the previous DSH plugin profile and restart DSH Studio.',
    parameters: {},
    async execute(_args, exec) {
      const response = await gateway(credentials, { type: 'dispatch', command: { type: 'undo' } })
      if (response.deferred !== true) throw new Error('desktop plugin recovery was not scheduled')
      exec.concludeTurn()
      return result('DSH plugin recovery accepted; DSH Studio will restart.')
    },
  }))
}
