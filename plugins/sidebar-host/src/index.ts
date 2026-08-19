/**
 * dsh-better-sidebar host half: the /sidebar JSON API (explorer listing, file
 * read/write, git), the /sidebar/file media route (images), the /sidebar/html
 * preview route, the /sidebar/bundle lazy-chunk route (client code splits),
 * and the terminal WebSocket upgrade. Every route passes the same
 * browser-trust fence as the /api gateway — Host-header loopback or the
 * connection row's `trustedHosts` (the `dsh web` launcher derives LAN IP
 * literals per boot) — with the trustedHosts read live from the connection
 * loader row so the fence never drifts from the deployment's.
 *
 * All operations are conversation-scoped: requests carry a sessionId, the
 * session's authoritative cwd comes from the session store, and terminal
 * processes are keyed by session.
 */
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import type { IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  TerminalOutputBatcher,
  type TerminalOutputAck,
} from './terminal-batcher.ts'
import type { TerminalOutputFrame } from '@oh-dsh/shared/terminal-wire'
import type { Context } from './context-types.ts'
import {
  Config,
  LeftRailSettingsSchema,
  PrefsSchema,
  resolveSidebarConfig,
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  type ResolvedSidebarConfig,
  type SidebarConfig,
  type SidebarPrefs,
} from './config.ts'
import { migrateLegacyLeftRailSlice } from './left-rail-settings-migration.ts'
import { LEFT_RAIL_SETTINGS_NS } from '@oh-dsh/shared/left-rail-preferences'
import { isWithin, requireAbsolute } from '@oh-dsh/shared/fs-tree'
import { decodeHtmlUrl } from './html-route.ts'
import { extractFrameAncestors } from './browser-probe.ts'
import { isTrustedApiRequest, isLoopbackHostname } from './trust-fence.ts'
import { registerBundleRoute } from './bundle-route.ts'
import { buildSidebarRoutes, sessionCwdOf, type SidebarSettingsFace } from './routes.ts'
import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ensureSpawnHelper, PtyManager } from './pty-manager.ts'
import { TerminalSessionStore } from './terminal-session-store.ts'
import { TerminalSubscriptionCoordinator } from './terminal-subscription-coordinator.ts'
import {
  normalizeTerminalRuntimePolicy,
  type TerminalRuntimePolicy,
} from './terminal-policy.ts'
import { resolveShell } from './shell-resolver.ts'
import { AgentPtyRegistry, clampDims, type AgentTerminalHandle } from './agent-pty.ts'
import { buildTerminalReplayPayload, type TerminalReplaySource } from './terminal-replay.ts'
import { registerTools } from './tools.ts'
import {
  readJsonBody,
  requireString,
  SidebarError,
  writeError,
  writeJson,
  writeOk,
} from '@oh-dsh/shared/wire'

export { Config }
export type { SidebarConfig, ResolvedSidebarConfig }
// Re-export the Context augmentation (declare module 'cordis') so consumers
// `import type {} from 'dsh-better-sidebar'` and gain `ctx.betterSidebar`.
// Also re-export the service descriptor types so consumers can type their
// registerTab / registerFileViewer arguments without reaching into /client.
export type { Context } from './context-types.ts'

export type {
  BetterSidebarService,
  TabDescriptor,
  TabComponentProps,
  FileViewerDescriptor,
  FileViewerProps,
  FileFetchStrategy,
} from './client/service.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-better-sidebar'

/** Services required before mounting: the webserver routes, the session store, the loader's connection row, and the tool registry. */
export const inject = ['webServer', 'sessions', 'loader', 'tools']

/** Content types for the media route, by extension. */
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
}

/** Shared pause ownership prevents an old reconnect socket from resuming a PTY
 * while a newer socket is still flow-controlled. */
type PausablePty = { pause(): void; resume(): void }
const ptyPauseOwners = new Map<string, Set<string>>()

function setPtyOutputPaused(
  key: string,
  pty: PausablePty,
  owner: string,
  paused: boolean,
): void {
  const owners = ptyPauseOwners.get(key) ?? new Set<string>()
  if (paused) owners.add(owner)
  else owners.delete(owner)
  if (owners.size === 0) {
    ptyPauseOwners.delete(key)
    pty.resume()
  } else {
    ptyPauseOwners.set(key, owners)
    pty.pause()
  }
}

function releasePtyOutputOwner(key: string, pty: PausablePty, owner: string): void {
  const owners = ptyPauseOwners.get(key)
  if (owners === undefined || !owners.delete(owner)) return
  if (owners.size === 0) {
    ptyPauseOwners.delete(key)
    pty.resume()
  } else {
    ptyPauseOwners.set(key, owners)
  }
}

/** Content type served by /sidebar/file (binary-safe fallback for unknowns). */
export function mediaTypeForPath(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx: Context): string[] {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === 'connection') {
      const config = entry.options.config as { trustedHosts?: string[] } | undefined
      return config?.trustedHosts ?? []
    }
  }
  return []
}


/**
 * Plugin body: mount the fenced routes and the pty lifecycle.
 * @param ctx - host plugin context (webServer, sessions, loader).
 * @param config - deployment-provided limits; the Loader validates against
 * {@link Config} and fills defaults, direct callers get them from
 * {@link resolveSidebarConfig}.
 */
export function apply(ctx: Context, config?: SidebarConfig): void {
  // pnpm strips the executable bit from node-pty's prebuilt spawn-helper;
  // restore it before any terminal can spawn (idempotent).
  ensureSpawnHelper()
  const resolved = resolveSidebarConfig(config)
  const trustedHosts = trustedHostsOf(ctx)
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHosts)
  // Terminal policy is read through the existing settings namespace. The
  // deployment reconnect value remains the fallback when settings are absent.
  let settingsPrefs: SidebarPrefs = { ...SIDEBAR_PREFS_DEFAULTS }
  const getTerminalPolicy = (): TerminalRuntimePolicy => normalizeTerminalRuntimePolicy({
    scrollbackRows: settingsPrefs.terminalScrollbackRows,
    reconnectGraceMs: settingsPrefs.terminalReconnectGraceMs ?? resolved.reconnectGraceMs,
    processKillGraceMs: settingsPrefs.terminalProcessKillGraceMs,
    retainedInactiveSessions: settingsPrefs.terminalRetainedInactiveSessions,
  })
  const terminalStore = new TerminalSessionStore({
    maxRetainedInactiveSessions: () => getTerminalPolicy().retainedInactiveSessions,
    historyLimits: { maxLines: 50_000, maxBytes: 8 * 1024 * 1024 },
  })
  const terminalSubscriptions = new TerminalSubscriptionCoordinator()
  // The terminal shell is resolved AT SPAWN TIME through the shared chain
  // (deployment config → settings `terminalShell` → env/probe/login chains),
  // so a settings change takes effect for NEW terminals while already-open
  // processes keep their shell. Both registries share the same thunk.
  let settingsShell: string | undefined
  const getShell = (): string => resolveShell({
    ...(resolved.shell === undefined ? {} : { explicit: resolved.shell }),
    ...(settingsShell === undefined ? {} : { configured: settingsShell }),
  })
  const ptyManager = new PtyManager(getShell, resolved.terminalsPerSession, {
    getPolicy: getTerminalPolicy,
    store: terminalStore,
  })
  // The agent-owned terminal registry is parallel to the UI-tab registry and
  // shares policy (scrollback and configurable kill escalation).
  const agentPtyRegistry = new AgentPtyRegistry(getShell, {
    getPolicy: getTerminalPolicy,
  })

  // ── User-facing "Side card" preferences ──────────────────────────────────
  // Register the namespace with the settings provider so the Settings page
  // (client half) can render and persist the new-conversation defaults. The
  // DSH settings RPC domain (api-proxy) only serves allowlisted namespaces to
  // configuration clients, so the client reaches this namespace through the
  // plugin's own fenced routes below ('settings.get'/'settings.update'),
  // which call the seam in-process. Deployments without a settings service
  // simply never fill the face and the client falls back to the defaults.
  let settingsFace: SidebarSettingsFace | undefined
  // Migration of any legacy left-rail slice out of the sidebar namespace into
  // oh-dsh-left-rail. The routes gate the left-rail namespace on this promise
  // so a cold-start first read never observes the empty pre-migration window.
  let leftRailMigrationGate: Promise<void> | undefined
  // Await the left-rail migration gate for the left-rail namespace only; the
  // sidebar prefs namespace never waits (it is the migration's source, and
  // reads there must work before the move settles).
  const settingsNamespaceGate = async (rawNs: string, gate: () => Promise<void> | undefined): Promise<void> => {
    if (rawNs === LEFT_RAIL_SETTINGS_NS) await gate()
  }
  // The model-facing terminal tools are gated on the side-card setting
  // `agentTerminalTools` (default off): nothing is injected until the user
  // turns the feature on, and turning it off mid-session unregisters the
  // tools and releases the agent terminals they created.
  let toolsDisposers: (() => void) | null = null
  const syncToolsGate = (scope: { get(): SidebarPrefs }): void => {
    if (scope.get().agentTerminalTools) {
      if (toolsDisposers === null) {
        toolsDisposers = registerTools(ctx, agentPtyRegistry, (sessionId) => sessionCwdOf(ctx, sessionId))
      }
    } else if (toolsDisposers !== null) {
      toolsDisposers()
      toolsDisposers = null
      // The feature is off: release every agent terminal the model created
      // while it was on (they are only reachable through the tools). The
      // registry change fires the push, so the sidebar reconciles them away.
      agentPtyRegistry.disposeAll()
    }
  }
  ctx.inject(['settings'], (sctx) => {
    const sidebarNs: SettingsNamespace = settingsNamespace(SIDEBAR_PREFS_NS)
    // The left-rail view slice gets its OWN namespace + schema (see
    // docs/persistence-architecture.md, decision B). Registering it here
    // gives the slice defaults/validation and a dedicated section in the
    // settings document; the client writes it through replace/mutate so
    // deletions (icon reset, alias clear, group unassign) actually persist.
    const leftRailNs: SettingsNamespace = settingsNamespace(LEFT_RAIL_SETTINGS_NS)
    // The structural settings mirror types `schema` as unknown, so the
    // generic is not inferred here; the real service resolves it from the
    // schemastery schema (PrefsSchema / LeftRailSettingsSchema) — narrow the
    // owner scope explicitly.
    const scope = sctx.settings.register(sidebarNs, PrefsSchema) as {
      get(): SidebarPrefs
      watch(callback: (next: SidebarPrefs, prev: SidebarPrefs) => void): () => void
    }
    sctx.settings.register(leftRailNs, LeftRailSettingsSchema)
    // Move any slice that historically rode in the sidebar namespace into the
    // dedicated namespace, once, idempotently. Failure is contained: the
    // routes still work (reads fall back to the sidebar view), a retry next
    // boot completes the move. The gate lets left-rail reads/writes await the
    // move so the first load never sees an empty target.
    leftRailMigrationGate = migrateLegacyLeftRailSlice({
      describe: (ns) => {
        const descriptor = sctx.settings.describe({ redactSecrets: true })
          .find(candidate => candidate.ns === settingsNamespace(ns))
        return descriptor === undefined
          ? {}
          : { user: descriptor.user, revision: descriptor.revision }
      },
      replace: (ns, section) => sctx.settings.replace(settingsNamespace(ns), section),
      mutate: (ns, ops) => sctx.settings.mutate(settingsNamespace(ns), ops),
    }).then(
      () => undefined,
      (error) => {
        ctx.logger?.warn?.(`[left-rail] settings migration failed: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
    const viewOf = (target: SettingsNamespace): { value?: unknown; revision?: number } => {
      const descriptor = sctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === target)
      return descriptor === undefined
        ? {}
        : { value: descriptor.value, revision: descriptor.revision }
    }
    settingsFace = {
      get: async (rawNs) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        return viewOf(settingsNamespace(rawNs))
      },
      update: async (rawNs, patch, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await sctx.settings.update(settingsNamespace(rawNs), patch, expectedRevision)
        return viewOf(settingsNamespace(rawNs))
      },
      replace: async (rawNs, section, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await sctx.settings.replace(settingsNamespace(rawNs), section, expectedRevision)
        return viewOf(settingsNamespace(rawNs))
      },
      mutate: async (rawNs, ops, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await sctx.settings.mutate(settingsNamespace(rawNs), ops, expectedRevision)
        return viewOf(settingsNamespace(rawNs))
      },
    }
    // Register (or unregister) the terminal tools from the current setting,
    // and keep them in sync with every settings commit. Terminal policy and
    // shell resolution use the same live snapshot.
    settingsPrefs = scope.get()
    settingsShell = settingsPrefs.terminalShell
    syncToolsGate(scope)
    scope.watch((next) => {
      settingsPrefs = next
      settingsShell = next.terminalShell
      syncToolsGate(scope)
    })
  })

  // ── JSON API ────────────────────────────────────────────────────────────
  const api = buildSidebarRoutes(ctx, ptyManager, agentPtyRegistry, resolved, () => settingsFace)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebar/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/sidebar/api/') ? pathname.slice('/sidebar/api/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new SidebarError('not-found', 'unknown sidebar API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const handler = api[method]
        if (handler === undefined) {
          throw new SidebarError('not-found', `unknown sidebar API method "${method}"`, 404)
        }
        writeOk(res, await handler(payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-better-sidebar: /sidebar/api routes')

  // ── Lazy chunk route (client bundle splits) ─────────────────────────────
  // Serves the client half's split bundles (lib/client-<name>.js) so the
  // heavy preview/terminal libraries load on first use, not at page start
  // (see bundle-route.ts / src/client/chunk-loader.ts).
  ctx.effect(() => registerBundleRoute(ctx, fence), 'dsh-better-sidebar: /sidebar/bundle chunk route')

  // ── Media route (images for the editor) ─────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebar/file',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sessionId = url.searchParams.get('sessionId')
        const raw = url.searchParams.get('path')
        if (sessionId === null || raw === null) throw new SidebarError('bad-request', 'sessionId and path are required')
        const cwd = sessionCwdOf(ctx, sessionId, url.searchParams.get('cwd') ?? undefined)
        const path = requireAbsolute(raw)
        if (!isWithin(cwd, path)) {
          // Only files under the session cwd are served as media (the editor
          // opens images from the explorer; produced files go through read).
          // isWithin (not a raw startsWith) so case-mismatched Windows paths
          // and mixed separators cannot be misclassified.
          throw new SidebarError('fs-error', 'media path outside the session working directory', 403)
        }
        const info = await stat(path)
        if (!info.isFile() || info.size > resolved.mediaLimit) {
          throw new SidebarError('fs-error', 'not a file or too large', 400)
        }
        const type = mediaTypeForPath(path)
        const body = await readFile(path)
        // Raw bytes either way (binary-safe); ?download=1 switches the
        // disposition so the browser saves the file instead of showing it.
        const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache' }
        if (url.searchParams.get('download') === '1') {
          headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`
        }
        res.writeHead(200, headers)
        res.end(body)
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-better-sidebar: /sidebar/file media route')

  // ── HTML preview route (sandboxed HTML + its relative assets) ───────────
  // Serves files under the session cwd for the built-in HTML previewer. The
  // URL is path-encoded (see html-route.ts) so the previewed page's relative
  // assets (./style.css, img/x.png) resolve back into this route with the
  // session scope intact — a query-encoded URL would drop the scope when the
  // browser resolves relatives. Every response carries the CSP `sandbox`
  // directive: inside the editor's iframe the sandbox ATTRIBUTE is the
  // boundary, this header is defense-in-depth so even a top-level load of
  // the URL (e.g. a popup opened by a previewed page) stays in an opaque
  // origin with no same-origin access to the GUI.
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebar/html',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const decoded = decodeHtmlUrl(url.pathname)
        if (!decoded.ok) {
          writeError(res, new SidebarError('bad-request', decoded.message, decoded.status))
          return
        }
        const { sessionId, path } = decoded.ref
        // The session's authoritative cwd (client cwd cannot ride in the URL
        // — the path encoding has no query; a detached first request falls
        // back to the process cwd and is normally refused by isWithin, same
        // semantics as the media route's fallback).
        const cwd = sessionCwdOf(ctx, sessionId)
        const absolute = requireAbsolute(path)
        if (!isWithin(cwd, absolute)) {
          throw new SidebarError('fs-error', 'html path outside the session working directory', 403)
        }
        const info = await stat(absolute)
        if (!info.isFile() || info.size > resolved.mediaLimit) {
          throw new SidebarError('fs-error', 'not a file or too large', 400)
        }
        const type = mediaTypeForPath(absolute)
        const body = await readFile(absolute)
        res.writeHead(200, {
          'content-type': type,
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          // The sandbox directive (no allow-same-origin → opaque origin) is
          // the previewer's security boundary even for top-level loads;
          // object-src 'none' blocks plugin embeds.
          'content-security-policy': "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'",
        })
        res.end(body)
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-better-sidebar: /sidebar/html preview route')

  // ── Terminal WebSocket ──────────────────────────────────────────────────
  // One upgrade endpoint serves both UI-tab terminals (?tab=...) and
  // agent-owned terminals (?uuid=...). The two paths attach to different
  // registries but share the wire protocol: input frames are raw text,
  // resize frames are JSON `{type:'resize',cols,rows}`, and a close frame
  // `{type:'close'}` releases the underlying pty (immediate for agent
  // terminals, scheduled-0 for UI tabs which keep the same reconnect grace
  // contract the host has always had).
  const wss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/sidebar/ws/terminal',
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void attachTerminal(ctx, ptyManager, agentPtyRegistry, terminalSubscriptions, ws, req, getTerminalPolicy)
      })
    },
  }), 'dsh-better-sidebar: terminal WebSocket')

  // ── Agent terminals push WebSocket ──────────────────────────────────────
  // Pushes the live list of agent terminals for one session to the sidebar
  // view: the client mirrors the list into tabs (id `agent:<uuid>`,
  // title from the agent's `terminal_create` call). The host fires on every
  // create / close / exit; the client reconciles by adding tabs for new
  // uuids and dropping tabs whose uuids disappeared (the user closing a tab
  // sends `{type:'close'}` on the terminal WS, which kills the pty, which
  // fires a change here, which converges the view).
  const agentListWss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/sidebar/ws/agent-terminals',
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      agentListWss.handleUpgrade(req, socket, head, (ws) => {
        void attachAgentList(agentPtyRegistry, ws, req)
      })
    },
  }), 'dsh-better-sidebar: agent-terminals push WebSocket')

  ctx.effect(() => () => {
    toolsDisposers?.()
    ptyManager.disposeAll()
    agentPtyRegistry.disposeAll()
    terminalSubscriptions.dispose()
     ptyPauseOwners.clear()
    wss.close()
    agentListWss.close()
  }, 'dsh-better-sidebar: teardown')
}

/** Push the live agent-terminal list for one session to a connected sidebar view. */
async function attachAgentList(
  registry: AgentPtyRegistry,
  ws: WebSocket,
  req: IncomingMessage,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null) {
      ws.close(1008, 'sessionId is required')
      return
    }
    const send = (): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(registry.list(sessionId)))
      }
    }
    send()
    const unsubscribe = registry.subscribe(send)
    ws.on('close', () => { unsubscribe() })
    ws.on('error', () => { unsubscribe() })
  } catch (error) {
    ws.close(1011, error instanceof Error ? error.message : String(error))
  }
}

function sendReplayFrame(
  batcher: TerminalOutputBatcher,
  handle: TerminalReplaySource,
  ws: WebSocket,
): void {
  const replay = buildTerminalReplayPayload(handle)
  if (replay === '' || ws.readyState !== WebSocket.OPEN) return
  const replayFrame: TerminalOutputFrame = {
    type: 'output',
    epoch: batcher.outputEpoch,
    sequence: 0,
    bytes: Buffer.byteLength(replay, 'utf8'),
    data: replay,
    replay: true,
  }
  ws.send(JSON.stringify(replayFrame))
}

/**
 * Wire one terminal socket to its pty: replay transcript, pump both ways.
 * Two attach modes share the wire protocol:
 * - `?uuid=...` attaches to an agent-owned terminal (created by the
 *   `terminal_create` tool). The close frame kills the pty immediately
 *   (the agent's terminal closes when the user closes the sidebar tab); a
 *   bare socket drop (refresh, tab switch) leaves the pty alive for the
 *   reconnect grace, exactly like UI-tab terminals.
 * - `?tab=...&sessionId=...` attaches to a UI-tab terminal (the user
 *   created it from the + menu). The close frame schedules a 0-ms close
 *   (the host's reconnect grace keeps the shell alive across a refresh).
 */
async function attachTerminal(
  ctx: Context,
  ptyManager: PtyManager,
  agentPtyRegistry: AgentPtyRegistry,
  terminalSubscriptions: TerminalSubscriptionCoordinator,
  ws: WebSocket,
  req: IncomingMessage,
  getPolicy: () => TerminalRuntimePolicy,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const uuid = url.searchParams.get('uuid')
    if (uuid !== null) {
      const handle = agentPtyRegistry.get(uuid)
      if (handle === undefined) {
        ws.close(1011, `agent terminal "${uuid}" not found`)
        return
      }
      pumpAgentTerminal(agentPtyRegistry, terminalSubscriptions, handle, ws)
      return
    }
    // UI-tab terminal: `?sessionId=<owner>&tab=...&cwd=...`. The owner is the
    // PROJECT cwd (project-shared PTY); the client maps its workspace cwd into
    // the owner slot and also sends the authoritative cwd. The pty is keyed
    // `owner:tab`, so the same project reconnects to the same shell across
    // conversations and refreshes.
    const owner = url.searchParams.get('sessionId')
    const tabId = url.searchParams.get('tab')
    if (owner === null || tabId === null) {
      ws.close(1008, 'either ?uuid or ?sessionId+?tab are required')
      return
    }
    const cwd = sessionCwdOf(ctx, owner, url.searchParams.get('cwd') ?? undefined)
    const handle = ptyManager.open(owner, tabId, cwd, 80, 24)
    const outputOwner = randomUUID()
    const batcher = new TerminalOutputBatcher({
      send: frame => {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify(frame))
      },
      bufferedAmount: () => ws.bufferedAmount,
      pause: () => { setPtyOutputPaused(handle.key, handle.pty, outputOwner, true) },
      resume: () => { setPtyOutputPaused(handle.key, handle.pty, outputOwner, false) },
    })
    const onData = (data: string): void => { batcher.append(data) }
    const onExit = ({ exitCode }: { exitCode: number; signal?: number }): void => {
      batcher.append(`\r\n[process exited with code ${String(exitCode)}]\r\n`)
      batcher.flush()
      releasePtyOutputOwner(handle.key, handle.pty, outputOwner)
    }
    // Subscribe before taking the replay snapshot. Any bytes produced during
    // the snapshot are queued behind it in WebSocket order, so reconnects do
    // not create a history/live-output gap.
    const subscription = terminalSubscriptions.attach(handle.key, handle.pty, {
      onData,
      onExit,
    })
    // Replay is a normal versioned frame, so reconnect uses the same ACK and
    // sequence path as live output. The first frame is marked replay for the
    // client diagnostics; it is still parsed by xterm before ACK.
    sendReplayFrame(batcher, handle, ws)
    ws.on('message', (data) => {
      const text = data.toString('utf8')
      // Control frames are JSON with a known shape; anything else (including
      // JSON that is not a recognized control) is terminal input, verbatim.
      let parsed: unknown = null
      let control: { type?: unknown; cols?: unknown; rows?: unknown } | null = null
      try {
        parsed = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object') {
          control = parsed as { type?: unknown; cols?: unknown; rows?: unknown }
        }
      } catch {
        // Not JSON: terminal input.
      }
      if (control !== null && control.type === 'close') {
        // The owning tab was closed: release the quota immediately.
        ptyManager.scheduleClose(handle.key, 0)
        batcher.dispose()
        return
      }
      if (control !== null && control.type === 'ack') {
        const ack = parsed as Partial<TerminalOutputAck>
        batcher.acknowledge({
          type: 'ack',
          epoch: typeof ack.epoch === 'string' ? ack.epoch : '',
          sequence: typeof ack.sequence === 'number' ? ack.sequence : -1,
          bytes: typeof ack.bytes === 'number' ? ack.bytes : -1,
        })
        return
      }
      if (control !== null && control.type === 'resync') {
        batcher.resetEpoch()
        sendReplayFrame(batcher, handle, ws)
        return
      }
      if (handle.exited) return
      if (
        control !== null
        && control.type === 'resize'
        && typeof control.cols === 'number' && typeof control.rows === 'number'
      ) {
        const dims = clampDims(control.cols, control.rows)
        handle.pty.resize(dims.cols, dims.rows)
        handle.modeReplay?.resize(dims.cols, dims.rows)
      } else {
        handle.pty.write(text)
      }
    })
    ws.on('close', () => {
      subscription.dispose()
            batcher.dispose()
      releasePtyOutputOwner(handle.key, handle.pty, outputOwner)
      // A bare socket drop (refresh, tab switch) leaves the process alive
      // for a grace period so a quick reconnect keeps it; the reconnect's
      // open() cancels the pending close.
      ptyManager.scheduleClose(
        handle.key,
        getPolicy().reconnectGraceMs,
        handle.incarnationId,
      )
    })
  } catch (error) {
    ws.close(1011, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Pump one agent terminal's pty to a connected view. The close frame kills
 * the pty immediately (the agent's terminal closes when the user closes the
 * sidebar tab); a bare socket drop leaves the pty alive — the agent owns
 * the lifetime, and only `terminal_close`, a `{type:'close'}` frame, or
 * plugin teardown kills it.
 */
function pumpAgentTerminal(
  registry: AgentPtyRegistry,
  terminalSubscriptions: TerminalSubscriptionCoordinator,
   handle: AgentTerminalHandle,
  ws: WebSocket,
): void {
  const outputOwner = randomUUID()
  const batcher = new TerminalOutputBatcher({
    send: frame => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify(frame))
    },
    bufferedAmount: () => ws.bufferedAmount,
    pause: () => { setPtyOutputPaused(`agent:${handle.uuid}`, handle.pty, outputOwner, true) },
    resume: () => { setPtyOutputPaused(`agent:${handle.uuid}`, handle.pty, outputOwner, false) },
  })
  const onData = (data: string): void => { batcher.append(data) }
  const onExit = ({ exitCode }: { exitCode: number; signal?: number }): void => {
    batcher.append(`\r\n[process exited with code ${String(exitCode)}]\r\n`)
    batcher.flush()
    releasePtyOutputOwner(`agent:${handle.uuid}`, handle.pty, outputOwner)
  }
  const subscription = terminalSubscriptions.attach(`agent:${handle.uuid}`, handle.pty, {
    onData,
    onExit,
  })
  sendReplayFrame(batcher, handle, ws)
  ws.on('message', (data) => {
    if (handle.exited) return
    const text = data.toString('utf8')
    let parsed: unknown = null
    let control: { type?: unknown; cols?: unknown; rows?: unknown } | null = null
    try {
      parsed = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object') {
        control = parsed as { type?: unknown; cols?: unknown; rows?: unknown }
      }
    } catch {
      // Not JSON: terminal input.
    }
    if (control !== null && control.type === 'close') {
      // The user closed the sidebar tab: kill the pty immediately. The
      // agent's next terminal_list / terminal_send will see it gone.
      registry.close(handle.uuid)
      batcher.dispose()
      return
    }
    if (control !== null && control.type === 'ack') {
      const ack = parsed as Partial<TerminalOutputAck>
      batcher.acknowledge({
        type: 'ack',
        epoch: typeof ack.epoch === 'string' ? ack.epoch : '',
        sequence: typeof ack.sequence === 'number' ? ack.sequence : -1,
        bytes: typeof ack.bytes === 'number' ? ack.bytes : -1,
      })
      return
    }
    if (control !== null && control.type === 'resync') {
      batcher.resetEpoch()
      sendReplayFrame(batcher, handle, ws)
      return
    }
    if (
      control !== null
      && control.type === 'resize'
      && typeof control.cols === 'number' && typeof control.rows === 'number'
    ) {
      const dims = clampDims(control.cols, control.rows)
      handle.pty.resize(dims.cols, dims.rows)
    } else if (control === null) {
      // Raw text input (a JSON-looking string the pty would have received
      // verbatim is reachable in theory but is exotic for an agent terminal;
      // preserve the UI-tab semantics and forward as input).
      handle.pty.write(text)
    }
    // An unrecognized JSON control frame is dropped (the UI-tab path also
    // treats non-resize JSON controls as input, but for an agent terminal
    // there is no realistic input that is also valid JSON).
  })
  ws.on('close', () => {
    subscription.dispose()
        batcher.dispose()
    releasePtyOutputOwner(`agent:${handle.uuid}`, handle.pty, outputOwner)
    // A bare socket drop (refresh, tab switch) leaves the agent's pty alive.
    // The agent owns the lifetime: only `terminal_close`, a `{type:'close'}`
    // frame, or plugin teardown kills it. A reconnecting view reattaches the
    // same shell and gets the full transcript replayed.
  })
}
