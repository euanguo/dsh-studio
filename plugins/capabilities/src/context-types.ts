/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation both halves share. A third-party plugin resolves
 * outside the DSH monorepo's single cordis instance, so the upstream
 * `declare module 'cordis'` augmentations do not reach this Context — and
 * the npm cordis package does not declare the DSH-vendored runtime members
 * (`ctx.effect`, service properties). The members below mirror the actual
 * runtime shapes this plugin touches:
 * - webServer: @deepseek-ai/dsh-host-webserver (the WebServer)
 * - sessions: host side @deepseek-ai/dsh-session (SessionStore), client
 *   side the runtime ISessions list feed
 * - conversation: client side ui-conversation's IConversation (composer
 *   draft), read lazily through `ctx.get` — cross-plugin service reads need
 *   an inject declaration, so the direct property is never typed here
 * - loader: @cordisjs/plugin-loader (entry options)
 * - slots: the client runtime SlotRegistry
 * - effect: the DSH-vendored cordis lifecycle helper
 * Drift from upstream is contained to this file.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from 'cordis'
export interface CapabilitiesUserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly unknown[]
  readonly source: Record<string, unknown>
}

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface CapabilitiesWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration (mirror of WebUpgradeRoute). */
export interface CapabilitiesWebUpgradeRoute {
  path: string
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface CapabilitiesWebServer {
  register(route: CapabilitiesWebRoute): () => void
  registerUpgrade(route: CapabilitiesWebUpgradeRoute): () => void
}

/** A published session's header slice the sidebar reads (authoritative cwd). */
export interface CapabilitiesSessionHeader {
  cwd?: string
}

/** The host session store face (`ctx.sessions.get(id)` returns the live session). */
export interface CapabilitiesSessionStore {
  get(id: string): {
    header: CapabilitiesSessionHeader
    /**
     * The live session's append-only event log (immutable snapshot; absent
     * on sessions the runtime has not hydrated). Read-only access — the
     * jobs.output route replays `job_output` tool/result rows from it.
     */
    events?: readonly CapabilitiesSessionEvent[]
  } | undefined
}

/** Live session face used by WorkTree delegation. */
export interface CapabilitiesLiveSession {
  readonly id: string
  readonly header: {
    readonly cwd?: string
    readonly parentSession?: string
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
  }
  readonly events: readonly CapabilitiesSessionEvent[]
  readonly seq: number
}

/** Host session store extensions used by the delegation registry. */
export interface CapabilitiesRuntimeSessions extends CapabilitiesSessionStore {
  list(): readonly CapabilitiesLiveSession[]
  create(id?: string, options?: {
    meta?: {
      cwd?: string
      parentSession?: string
      origin?: 'subagent'
      delegationDepth?: number
    }
  }): CapabilitiesLiveSession
  flush(session: CapabilitiesLiveSession): Promise<boolean>
}

/** One workspace record exposed by the durable workspace registry. */
export interface CapabilitiesWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  attachSession(sessionId: string): Promise<void>
}

/** Workspace registry operations needed by WorkTree tools and delegation. */
export interface CapabilitiesWorkspaceRegistry {
  list(): readonly CapabilitiesWorkspace[]
  create(path: string, title?: string): Promise<CapabilitiesWorkspace>
  resolveByPath(path: string): Promise<CapabilitiesWorkspace | undefined>
  delete(id: string): Promise<boolean>
}

/** One loader entry's options slice (the connection row's resolved config). */
export interface CapabilitiesLoaderEntry {
  options: { name: string; config?: unknown }
}

/** The loader face used to read the connection row's trustedHosts config. */
export interface CapabilitiesLoader {
  entries(): Iterable<CapabilitiesLoaderEntry>
}

/** Registration options the sidebar passes to `ctx.slots.register` (subset of the real options). */
export interface CapabilitiesSlotRegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string | (() => string)
  /** Chain routing selector (returns the matched value, or null to pass on). */
  select?: (owner: unknown) => unknown
  priority?: number
  locale?: string
  registrant?: string
  /** Business-face factory; args depend on the slot scope. */
  inject?: (...args: any[]) => Record<string, unknown>
  children?: Record<string, unknown>
}

/** The client slots service face (register returns the disposer). */
export interface CapabilitiesSlotsService {
  register(options: CapabilitiesSlotRegisterOptions, component: unknown): () => void
  /**
   * Run a callback for each declaration lifetime of a slot (the runtime
   * SlotRegistry.inject): a no-op while the slot is undeclared, so the
   * settings section registration waits for the settings shell.
   */
  inject(key: string, callback: () => () => void): () => void
}

/** The client session list row the sidebar reads (cwd for the explorer). */
export interface CapabilitiesSessionSummary {
  id: string
  cwd?: string
  displayTitle: string
  /** Coarse durable origin for navigation filtering (subagent children). */
  origin?: 'subagent'
  /** Durable direct parent session id (present on subagent children). */
  parentId?: string
  /** Whether the session's agent is currently running. */
  running?: boolean
}

/** One healthy subagent catalog child row (structural mirror of the runtime). */
export interface CapabilitiesSubagentChildEntry {
  kind: 'child'
  id: string
  /** Whether the child Agent driver is running at the Host sampling boundary. */
  activity: 'running' | 'inactive'
  /** Whether a direct descendant has durable `origin: 'subagent'`. */
  hasChildren: boolean
  mode: 'one-shot' | 'continuable'
  label?: string
}

/** One unreadable catalog row (corrupt / unsupported / unavailable). */
export interface CapabilitiesSubagentDiagnosticEntry {
  kind: 'diagnostic'
  id: string
  reason: 'corrupt' | 'unsupported' | 'unavailable'
}

/** The per-parent lazy catalog delivered through the sessions list feed. */
export interface CapabilitiesSubagentCatalog {
  entries: Array<CapabilitiesSubagentChildEntry | CapabilitiesSubagentDiagnosticEntry>
  parentAvailable: boolean
  state: 'loading' | 'ready' | 'error'
  error: { code?: string; message?: string } | null
}

/** Durable parent/child address that selects subagent transport in the client. */
export interface CapabilitiesSubagentAddress {
  parentstring: string
  childstring: string
  mode: 'one-shot' | 'continuable'
}

/** Minimal structural mirror of one session event (the subagent history tail). */
export interface CapabilitiesSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

/** One history row: the durable event plus an optional tool presentation view. */
export interface CapabilitiesHistoryEntry {
  event: CapabilitiesSessionEvent
  view?: unknown
}

/** Lifecycle status set of one background job (closed wire union). */
export type CapabilitiesJobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

/**
 * One background job as the client mirror sees it (wire `JobView` shape:
 * id/kind/label/status/detail?/startedAt/finishedAt?).
 */
export interface CapabilitiesJobView {
  /** Registry-issued `<kind>-N` identity, stable for the job's whole life. */
  id: string
  /** Producer kind (`bash`, `pwsh`, `subagent`, …; open string by design). */
  kind: string
  /** Producer-supplied one-line label: the command, or the delegation description. */
  label: string
  /** Current lifecycle state. */
  status: CapabilitiesJobStatus
  /** Kind-specific status detail ('exit code: 3'), present once supplied. */
  detail?: string
  /** Epoch ms when the job was registered. */
  startedAt: number
  /** Epoch ms when the job settled; absent while live. */
  finishedAt?: number
}

/** Runtime model route accepted by the AgentRegistry factory. */
export interface CapabilitiesAgentOptions {
  provider?: string
  model?: string
  maxTokens?: number
}

/** Runtime agent/session creation request used by the delegation registry. */
export interface CapabilitiesCreateAgentOptions {
  sessionId: string
  meta?: {
    cwd?: string
    parentSession?: string
    origin?: 'subagent'
    delegationDepth?: number
  }
  agentOptions?: CapabilitiesAgentOptions
  setup?: (ctx: { get(name: string): unknown }) => void | Promise<void>
}

/** Agent handle returned by the runtime creation factory. */
export interface CapabilitiesAgentHandle {
  readonly agent: CapabilitiesDelegationAgent
  dispose(): Promise<void>
}

/** The live agent face required by WorkTree delegation. */
export interface CapabilitiesDelegationAgent extends CapabilitiesAgent {
  readonly session: CapabilitiesLiveSession
  followup(message: CapabilitiesUserMessage): void
  whenIdle(): Promise<void>
  cancel(cause: { readonly kind: 'user' | 'parent' | 'disposed' }): void
}

/** The host agent registry face (structural mirror of the runtime `ctx.agents`). */
export interface CapabilitiesAgentsService {
  /** The live agent registered under a session id, or undefined when not live. */
  get(id: string): CapabilitiesAgent | undefined
  /** Create and publish a complete agent/session under the caller's fiber. */
  create(options: CapabilitiesCreateAgentOptions): Promise<CapabilitiesAgentHandle>
}

/** RPC result slot mirror (`RpcResult<T>` on the wire). */
export type CapabilitiesRpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Unary response mirror (`RpcResponse<T>` on the wire). */
export interface CapabilitiesRpcResponse<T> {
  rpcId: unknown
  result: CapabilitiesRpcResult<T>
}

/** The wire face the Subagent activity summary needs (subset of `ctx.connection`). */
export interface CapabilitiesConnectionHandle {
  api: {
    subagents: {
      history(
        payload: CapabilitiesSubagentAddress & { beforeSeq?: number; maxMessages?: number },
        signal?: AbortSignal,
      ): Promise<CapabilitiesRpcResponse<{ events: CapabilitiesHistoryEntry[]; hasMore: boolean }>>
    }
  }
}

/** The client session list snapshot the sidebar subscribes to. */
export interface CapabilitiesSessionList {
  current: string | undefined
  byId: Record<string, CapabilitiesSessionSummary>
  /** Direct durable catalogs keyed by their selected parent address. */
  subagentsByParent?: Readonly<Record<string, CapabilitiesSubagentCatalog>>
  /**
   * Background jobs per session, last-wins from the harness's `session/jobs`
   * push (a missing key is an empty set). Absent on runtime snapshots older
   * than the jobs mirror — the sidebar simply shows no job rows.
   */
  jobsBySession?: Readonly<Record<string, readonly CapabilitiesJobView[]>>
}

/** The client sessions service face (only the list feed is needed). */
export interface CapabilitiesSessionsService {
  list: {
    getSnapshot(): CapabilitiesSessionList
    subscribe(fn: () => void): () => void
  }
  /**
   * Select a listed session as current (mirror of the runtime ISessions.open)
   * — used to jump back to the main agent from the topology root node.
   */
  open?(id: string): void
  /**
   * Resolve an Agent-scoped context view for one session (mirror of the
   * runtime ISessions.scope) — the ticket `ctx.conversation.input.for`
   * requires to reach that session's composer.
   */
  scope(id: string): Context | undefined
  /**
   * Open a healthy catalog child through its exact direct-parent address
   * (mirror of the runtime ISessions.openSubagent).
   */
  openSubagent?(address: CapabilitiesSubagentAddress): void
  /**
   * Resolve an already discovered direct-parent address without opening it.
   */
  subagentAddress?(id: string): CapabilitiesSubagentAddress | undefined
  /**
   * Mark whether a catalog surface is consuming live membership updates.
   */
  setSubagentCatalogOpen?(parentstring: string, open: boolean): void
  /**
   * Refresh one direct-child catalog.
   */
  refreshSubagents?(parentstring: string): Promise<void>
}

/**
 * The invariant service face (mirror of @deepseek-ai/dsh-invariants'
 * InvariantRegistry). The upstream augmentation does not reach this Context
 * (dual-cordis-instance resolution), so the register signature is restated
 * structurally, exactly like the other service faces above.
 */
export interface CapabilitiesInvariantsService {
  /** Reserve one package's checks and install them in the service's child fiber. */
  register(
    packageName: string,
    installer: (ctx: Context, fail: (message: string) => never) => void | Promise<void>,
  ): () => void
}

/**
 * The settings service face (mirror of @deepseek-ai/dsh-settings'
 * SettingsProvider). Namespace arguments are plain strings: the branded
 * SettingsNamespace produced by `settingsNamespace()` is unwrapped at the
 * call sites, keeping this bundle free of the @deepseek-ai/dsh-settings
 * dependency.
 */
export interface CapabilitiesSettingsService {
  /**
   * Register one namespace schema (the resolved value layers schema defaults,
   * then the composition base, then the user document).
   */
  register<T>(
    ns: string,
    schema: unknown,
    options?: { base?: Partial<T>; applies?: 'live' | 'restart' },
  ): {
    get(): T
    watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
    update(patch: object): Promise<void>
    replace(section: object): Promise<void>
  }
  /** Redacted descriptors of every registered namespace (secrets stripped). */
  describe(options?: { redactSecrets?: boolean }): Array<{
    ns: string
    value?: unknown
    base?: unknown
    user?: unknown
    applies: 'live' | 'restart'
    revision: number
  }>
  /** Service-level merge write with the revision guard (a stale writer is refused). */
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
  /** Service-level wholesale replace of one namespace's user section (deletion-capable). */
  replace(ns: string, section: object, expectedRevision?: number): Promise<void>
  /** Service-level path-addressed set/unset edits (deletion-capable). */
  mutate(ns: string, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>, expectedRevision?: number): Promise<void>
}

/**
 * The tools service face (mirror of @deepseek-ai/dsh-tools' ToolRuntime).
 * The host half registers model-facing tools here; the registry attaches the
 * returned disposer to the contributing fiber so unloading unregisters them.
 */
export interface CapabilitiesToolsService {
  /** Register one tool definition (raw JSON-Schema or defineTool-sugar form). */
  register(tool: unknown): () => void
}

/** Structural LLM runtime face required by Source Control AI. */
export interface CapabilitiesLlmService {
  listProviders(): Array<{ id: string }>
  listModels(provider: string): Promise<Array<{ id: string; name: string }>>
  resolveModelInfo(provider: string, model: string): Promise<{
    reasoning?: { efforts: ReadonlyArray<{ id: string; name: string }> }
  }>
  stream(options: {
    provider: string
    model: string
    reasoningEffort?: string
    system?: string
    messages: readonly unknown[]
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<{ type: string; text?: string; reason?: { kind?: string } }>
}

/**
 * The agent face a tool sees on `exec.agent` (mirror of @deepseek-ai/dsh-agent's
 * Agent). Only the slices the terminal tools touch are restated: the live
 * session identity and its header cwd, both readonly.
 */
export interface CapabilitiesAgent {
  /** The live session identity shared with the session log. */
  readonly id: string
  readonly options: CapabilitiesAgentOptions
  readonly ctx?: { get(name: string): unknown }
  /** The live session this agent drives. */
  readonly status: 'idle' | 'running'
  readonly session: {
    /** The session's header (validated cwd, lineage metadata). */
    readonly header: { readonly cwd?: string; readonly parentSession?: string }
    /** Durable append-only events for result extraction. */
    readonly events?: readonly CapabilitiesSessionEvent[]
  }
}

declare module 'cordis' {
  interface Context {
    webServer: CapabilitiesWebServer
    sessions: CapabilitiesRuntimeSessions & CapabilitiesSessionsService
    connection: CapabilitiesConnectionHandle
    loader: CapabilitiesLoader
    slots: CapabilitiesSlotsService
    workspaceRegistry: CapabilitiesWorkspaceRegistry
    settings: CapabilitiesSettingsService
    invariants: CapabilitiesInvariantsService
    tools: CapabilitiesToolsService
    llm: CapabilitiesLlmService
    /**
     * The host live-agent registry (`ctx.get('agents')`; optional — used to
     * resolve the caller the jobs fence compares against).
     */
    agents: CapabilitiesAgentsService
    /**
     * Subscribe to the session append feed (mirror of the cordis event API):
     * the listener receives every appended session event with the LIVE
     * Session instance that appended it. The api-proxy pushes the same feed
     * to browsers; the sidebar uses it to mirror job_output events the
     * session store's own log can lag behind (restart divergence). Returns
     * the disposer.
     */
    on(event: 'session/event', listener: (session: unknown, event: CapabilitiesSessionEvent) => void): () => void
    on(event: 'tools/pre-execute', listener: (exec: { name: string }, next: () => Promise<unknown>) => unknown): () => void
    on(event: string, listener: (...args: any[]) => unknown): () => void
    /**
     * Register a lifecycle callback (DSH-vendored cordis): runs at plugin
     * activation; its returned cleanup runs at disposal.
     */
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type { Context }
