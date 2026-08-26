/**
 * DSH Studio host capability gateway: the /capabilities JSON API (explorer
 * listing, file read/write, git, worktrees, workspace), the
 * /capabilities/file media route (images), the /capabilities/html preview
 * route, the /capabilities/bundle lazy-chunk route (client code splits),
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
import { basename, dirname, extname } from 'node:path'
import { homedir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  TerminalOutputBatcher,
  type TerminalOutputAck,
} from './terminal/terminal-batcher.ts'
import type { TerminalOutputFrame } from '@dsh-studio/shared/terminal-wire'
import type { Context } from './context-types.ts'
import {
  Config,
  LeftRailSettingsSchema,
  PrefsSchema,
  resolveCapabilitiesConfig,
  type CapabilitiesConfig,
  type ResolvedCapabilitiesConfig,
} from './config.ts'
import {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  type SidebarPrefs,
} from '@dsh-studio/shared/prefs-shared'
import { migrateLegacyLeftRailSlice } from './left-rail-settings-migration.ts'
import {
  UI_CHROME_DOMAIN,
  createUiChromeFace,
  type UiChromeDomain,
} from './ui-chrome-domain.ts'
import type { UiChromeFace } from './routes/ui-chrome.ts'
import { cleanupLegacySidebarPrefs } from './sidebar-prefs-cleanup.ts'
import { LEFT_RAIL_SETTINGS_NS } from '@dsh-studio/shared/left-rail-preferences'
import { isWithin, requireAbsolute } from '@dsh-studio/shared/fs-tree'
import { decodeHtmlUrl } from './html-route.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { registerBundleRoute } from './bundle-route.ts'
import { resolveDefaultWorktreeRoot } from '@dsh-studio/shared/worktree-preferences'
import { attachAgentList, attachTerminal, clearPtyPauseOwners } from './terminal/terminal-route.ts'
import { GitWatchCoordinator, attachGitWatch } from './git/git-watch.ts'
import { buildCapabilitiesRoutes, sessionCwdOf, type CapabilitiesSettingsFace } from './routes.ts'
import {
  SourceControlAiGenerator,
  SourceControlAiSettingsSchema,
} from './source-control-ai.ts'
import { SOURCE_CONTROL_AI_SETTINGS_NS } from '@dsh-studio/shared/capabilities-api'
import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ensureSpawnHelper, PtyManager } from './terminal/pty-manager.ts'
import { TerminalSessionStore } from './terminal/terminal-session-store.ts'
import { TerminalSubscriptionCoordinator } from './terminal/terminal-subscription-coordinator.ts'
import {
  normalizeTerminalRuntimePolicy,
  type TerminalRuntimePolicy,
} from './terminal/terminal-policy.ts'
import { resolveShell } from './shell-resolver.ts'
import { AgentPtyRegistry, clampDims, type AgentTerminalHandle } from './terminal/agent-pty.ts'
import { buildTerminalReplayPayload, type TerminalReplaySource } from './terminal/terminal-replay.ts'
import { registerTools } from './tools.ts'
import { WorktreeDelegationRegistry } from './worktree/worktree-orchestration.ts'
import {
  registerWorktreeDelegationTools,
  registerWorktreeTools,
} from './worktree/worktree-tools.ts'
import { errorMessage } from '@dsh-studio/shared/errors'
import {
  readJsonBody,
  requireString,
  CapabilityError,
  writeError,
  writeJson,
  writeOk,
} from '@dsh-studio/shared/wire'

export { Config }
export type { CapabilitiesConfig, ResolvedCapabilitiesConfig }
// The capability gateway is the host-side runtime; the sidebar UI owns its
// browser registry independently.
export type { Context } from './context-types.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-studio-capabilities'

/** Services required before mounting: the webserver routes, the session store, the loader's connection row, and the tool registry. */
export const inject = [
  'webServer',
  'sessions',
  'loader',
  'tools',
  'settings',
  'llm',
  'agents',
  'workspaceRegistry',
]

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

/** Content type served by /capabilities/file (binary-safe fallback for unknowns). */
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
 * {@link resolveCapabilitiesConfig}.
 */
export function apply(ctx: Context, config?: CapabilitiesConfig): void {
  // pnpm strips the executable bit from node-pty's prebuilt spawn-helper;
  // restore it before any terminal can spawn (idempotent).
  ensureSpawnHelper()
  const resolved = resolveCapabilitiesConfig(config)
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
  // M1: the host-resolved DSH data root, derived channel-aware through the
  // shared worktree-defaults resolver (honors DSH_STUDIO_HOME override and the
  // stable/dev sibling pair; injected instead of env-guessed so a bare launch
  // can never write dev history into the stable root). The terminal store
  // owns only the `terminal-sessions` child under it.
  const terminalStoreRoot = dirname(resolveDefaultWorktreeRoot(process.env, homedir()))
  const terminalStore = new TerminalSessionStore({
    root: terminalStoreRoot,
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
    storeRoot: terminalStoreRoot,
  })
  // The agent-owned terminal registry is parallel to the UI-tab registry and
  // shares policy (scrollback and configurable kill escalation).
  const agentPtyRegistry = new AgentPtyRegistry(getShell, {
    getPolicy: getTerminalPolicy,
  })
  const worktreeDelegations = new WorktreeDelegationRegistry(ctx)

  // ── User-facing "Side card" preferences ──────────────────────────────────
  // Register the namespace with the settings provider so the Settings page
  // (client half) can render and persist the new-conversation defaults. The
  // DSH settings RPC domain (api-proxy) only serves allowlisted namespaces to
  // configuration clients, so the client reaches this namespace through the
  // plugin's own fenced routes below ('settings.get'/'settings.update'),
  // which call the seam in-process. Deployments without a settings service
  // simply never fill the face and the client falls back to the defaults.
  let settingsFace: CapabilitiesSettingsFace | undefined
  let sourceControlAiGenerator: SourceControlAiGenerator | undefined
  // Migration of any legacy left-rail slice out of the sidebar namespace into
  // dsh-studio-left-rail. The routes gate the left-rail namespace on this promise
  // so a cold-start first read never observes the empty pre-migration window.
  let leftRailMigrationGate: Promise<void> | undefined
  // UI chrome uses one official domain store. This nested injection keeps the
  // optional service out of the route lifetime; the routes close only over the
  // stable face and gate below, never the child context.
  let uiChromeFace: UiChromeFace | undefined
  let uiChromeGate: Promise<void> | undefined
  ctx.inject(['storageDomain'], (storageCtx) => {
    let disposed = false
    let domain: UiChromeDomain | undefined
    uiChromeGate = storageCtx.storageDomain.open(UI_CHROME_DOMAIN).then(
      (opened) => {
        const candidate = opened as UiChromeDomain
        if (disposed) {
          void candidate.close()
          return
        }
        domain = candidate
        uiChromeFace = createUiChromeFace(candidate)
      },
      (error) => {
        // Loud on purpose: a dark ui-chrome domain silently drops every tab/
        // layout persistence (nothing restores, nothing saves). The plugin
        // context owns the logger; the storage child context may not have one.
        ctx.logger?.warn?.(`[ui-chrome] domain open failed: ${errorMessage(error)}`)
      },
    )
    storageCtx.effect(() => () => {
      disposed = true
      if (domain === undefined) return
      const closing = domain
      domain = undefined
      uiChromeFace = undefined
      void closing.close()
    })
  })
  // Await the left-rail migration gate for the left-rail namespace only; the
  // sidebar prefs namespace never waits (it is the migration's source, and
  // reads there must work before the move settles).
  const settingsNamespaceGate = async (rawNs: string, gate: () => Promise<void> | undefined): Promise<void> => {
    if (rawNs === LEFT_RAIL_SETTINGS_NS) await gate()
  }
  // Model-facing capabilities are independently gated and default off.
  let toolsDisposers: (() => void) | null = null
  let worktreeToolsDisposer: (() => void) | null = null
  let worktreeDelegationToolsDisposer: (() => void) | null = null
  const syncToolsGate = (scope: { get(): SidebarPrefs }): void => {
    const prefs = scope.get()
    if (prefs.agentTerminalTools) {
      if (toolsDisposers === null) {
        toolsDisposers = registerTools(ctx, agentPtyRegistry, (sessionId) => sessionCwdOf(ctx, sessionId))
      }
    } else if (toolsDisposers !== null) {
      toolsDisposers()
      toolsDisposers = null
      agentPtyRegistry.disposeAll()
    }
    if (prefs.agentWorktreeTools) {
      if (worktreeToolsDisposer === null) {
        worktreeToolsDisposer = registerWorktreeTools(ctx, worktreeDelegations)
      }
    } else if (worktreeToolsDisposer !== null) {
      worktreeToolsDisposer()
      worktreeToolsDisposer = null
    }
    if (prefs.agentWorktreeDelegationTools) {
      if (worktreeDelegationToolsDisposer === null) {
        worktreeDelegationToolsDisposer = registerWorktreeDelegationTools(ctx, worktreeDelegations)
      }
    } else if (worktreeDelegationToolsDisposer !== null) {
      worktreeDelegationToolsDisposer()
      worktreeDelegationToolsDisposer = null
    }
  }
  // `settings` and `llm` are top-level injected dependencies. Do not create a
  // nested `ctx.inject()` and retain that child context in HTTP routes: its
  // scoped accessor becomes inactive after the callback settles. The gateway
  // face below must close over the plugin's lifetime-stable `ctx` instead.
  /** Brand-check a raw namespace once, then unwrap it to the plain string the
   *  structural settings face consumes (this bundle stays dsh-settings-free). */
  const namespaceKeyOf = (raw: string): string => settingsNamespace(raw) as unknown as string
  {
    // The left-rail view slice gets its OWN namespace + schema (see
    // docs/persistence-architecture.md, decision B). Registering it here
    // gives the slice defaults/validation and a dedicated section in the
    // settings document; the client writes it through replace/mutate so
    // deletions (icon reset, alias clear, group unassign) actually persist.
    // The structural settings mirror types `schema` as unknown, so the
    // generic is not inferred here; the real service resolves it from the
    // schemastery schema (PrefsSchema / LeftRailSettingsSchema) — narrow the
    // owner scope explicitly.
    const scope = ctx.settings.register(namespaceKeyOf(SIDEBAR_PREFS_NS), PrefsSchema) as {
      get(): SidebarPrefs
      watch(callback: (next: SidebarPrefs, prev: SidebarPrefs) => void): () => void
    }
    ctx.settings.register(namespaceKeyOf(LEFT_RAIL_SETTINGS_NS), LeftRailSettingsSchema)
    ctx.settings.register(
      namespaceKeyOf(SOURCE_CONTROL_AI_SETTINGS_NS),
      SourceControlAiSettingsSchema,
      { applies: 'live' },
    )
    sourceControlAiGenerator = new SourceControlAiGenerator(ctx.llm)
    // Move any slice that historically rode in the sidebar namespace into the
    // dedicated namespace, once, idempotently. Failure is contained: the
    // routes still work (reads fall back to the sidebar view), a retry next
    // boot completes the move. The gate lets left-rail reads/writes await the
    // move so the first load never sees an empty target.
    leftRailMigrationGate = migrateLegacyLeftRailSlice({
      describe: (ns) => {
        const descriptor = ctx.settings.describe({ redactSecrets: true })
          .find(candidate => candidate.ns === namespaceKeyOf(ns))
        return descriptor === undefined
          ? {}
          : { user: descriptor.user, revision: descriptor.revision }
      },
      replace: (ns, section) => ctx.settings.replace(namespaceKeyOf(ns), section),
      mutate: (ns, ops) => ctx.settings.mutate(namespaceKeyOf(ns), ops),
    }).then(
      () => undefined,
      (error) => {
        ctx.logger?.warn?.(`[left-rail] settings migration failed: ${errorMessage(error)}`)
      },
    )
    // Best-effort cleanup of sidebar prefs removed from the schema
    // (openByDefault / defaultWidthPercent / bottomPanelAutoTerminal /
    // browserNoSandbox). No code reads them, so this is housekeeping only;
    // failure is contained and retried next boot.
    void cleanupLegacySidebarPrefs({
      describe: (ns) => {
        const descriptor = ctx.settings.describe({ redactSecrets: true })
          .find(candidate => candidate.ns === namespaceKeyOf(ns))
        return descriptor === undefined
          ? {}
          : { user: descriptor.user, revision: descriptor.revision }
      },
      mutate: (ns, ops) => ctx.settings.mutate(namespaceKeyOf(ns), ops),
    }).then(
      () => undefined,
      (error) => {
        ctx.logger?.warn?.(`[sidebar] legacy pref cleanup failed: ${errorMessage(error)}`)
      },
    )
    const viewOf = (target: string): { value?: unknown; revision?: number } => {
      const descriptor = ctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === target)
      return descriptor === undefined
        ? {}
        : { value: descriptor.value, revision: descriptor.revision }
    }
    settingsFace = {
      get: async (rawNs) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        return viewOf(namespaceKeyOf(rawNs))
      },
      update: async (rawNs, patch, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await ctx.settings.update(namespaceKeyOf(rawNs), patch, expectedRevision)
        return viewOf(namespaceKeyOf(rawNs))
      },
      replace: async (rawNs, section, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await ctx.settings.replace(namespaceKeyOf(rawNs), section, expectedRevision)
        return viewOf(namespaceKeyOf(rawNs))
      },
      mutate: async (rawNs, ops, expectedRevision) => {
        await settingsNamespaceGate(rawNs, () => leftRailMigrationGate)
        await ctx.settings.mutate(namespaceKeyOf(rawNs), ops, expectedRevision)
        return viewOf(namespaceKeyOf(rawNs))
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
  }

  // ── JSON API ────────────────────────────────────────────────────────────
  const api = buildCapabilitiesRoutes(
    ctx,
    ptyManager,
    agentPtyRegistry,
    resolved,
    () => settingsFace,
    () => sourceControlAiGenerator,
    async () => {
      await uiChromeGate
      return uiChromeFace
    },
    () => worktreeDelegations.defaults(),
  )
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/capabilities/api',
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
      const method = pathname.startsWith('/capabilities/api/') ? pathname.slice('/capabilities/api/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new CapabilityError('not-found', 'unknown capabilities API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const handler = api[method]
        if (handler === undefined) {
          throw new CapabilityError('not-found', `unknown capabilities API method "${method}"`, 404)
        }
        writeOk(res, await handler(payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'capabilities: /capabilities/api routes')

  // ── Lazy chunk route (client bundle splits) ─────────────────────────────
  // Serves the client half's split bundles (lib/client-<name>.js) so the
  // heavy preview/terminal libraries load on first use, not at page start
  // (see bundle-route.ts / src/client/chunk-loader.ts).
  ctx.effect(() => registerBundleRoute(ctx, fence), 'capabilities: /capabilities/bundle chunk route')

  // Shared skeleton for the media (/capabilities/file) and HTML preview
  // (/capabilities/html) GET routes: resolve the absolute path and its
  // cwd, enforce isWithin + isFile + size, read binary-safe, then let the
  // caller write its own headers. Error phrasing rides the caller's `scope`
  // so the two routes keep their distinct security/header contracts.
  const serveSessionFile = async (res: ServerResponse, opts: {
    scope: 'media' | 'html'
    sessionId: string
    clientCwd?: string
    resolvePath: () => string
    headers(type: string, path: string): Record<string, string>
  }): Promise<void> => {
    const cwd = sessionCwdOf(ctx, opts.sessionId, opts.clientCwd)
    const absolute = requireAbsolute(opts.resolvePath())
    if (!isWithin(cwd, absolute)) {
      // Only files under the session cwd are served (isWithin, not a raw
      // startsWith, so case-mismatched Windows paths and mixed separators
      // cannot be misclassified).
      throw new CapabilityError('fs-error', `${opts.scope} path outside the session working directory`, 403)
    }
    const info = await stat(absolute)
    if (!info.isFile() || info.size > resolved.mediaLimit) {
      throw new CapabilityError('fs-error', 'not a file or too large', 400)
    }
    const body = await readFile(absolute)
    res.writeHead(200, opts.headers(mediaTypeForPath(absolute), absolute))
    res.end(body)
  }

  // ── Media route (images for the editor) ─────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/capabilities/file',
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
        if (sessionId === null || raw === null) throw new CapabilityError('bad-request', 'sessionId and path are required')
        await serveSessionFile(res, {
          scope: 'media',
          sessionId,
          ...(url.searchParams.get('cwd') === null ? {} : { clientCwd: url.searchParams.get('cwd') as string }),
          resolvePath: () => raw,
          headers: (type, path) => {
            // Raw bytes either way (binary-safe); ?download=1 switches the
            // disposition so the browser saves the file instead of showing it.
            const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache' }
            if (url.searchParams.get('download') === '1') {
              headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`
            }
            return headers
          },
        })
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'capabilities: /capabilities/file media route')

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
    path: '/capabilities/html',
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
          writeError(res, new CapabilityError('bad-request', decoded.message, decoded.status))
          return
        }
        const { sessionId, path } = decoded.ref
        await serveSessionFile(res, {
          scope: 'html',
          sessionId,
          resolvePath: () => path,
          headers: (type) => ({
            'content-type': type,
            'cache-control': 'no-cache',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            // The sandbox directive (no allow-same-origin → opaque origin) is
            // the previewer's security boundary even for top-level loads;
            // object-src 'none' blocks plugin embeds.
            'content-security-policy': "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'",
          }),
        })
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'capabilities: /capabilities/html preview route')

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
    path: '/capabilities/ws/terminal',
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void attachTerminal(ctx, ptyManager, agentPtyRegistry, terminalSubscriptions, ws, req, getTerminalPolicy)
      })
    },
  }), 'capabilities: terminal WebSocket')

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
    path: '/capabilities/ws/agent-terminals',
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      agentListWss.handleUpgrade(req, socket, head, (ws) => {
        void attachAgentList(agentPtyRegistry, ws, req)
      })
    },
  }), 'capabilities: agent-terminals push WebSocket')

  // ── Git freshness push WebSocket ────────────────────────────────────────
  // One cheap status-fingerprint loop per subscribed cwd (single porcelain v2
  // subprocess per tick, only while a panel is actually watching) notifies
  // subscribers on change; clients pull the real data via `git.status`. This
  // replaces the sidebar's fixed 4s poll — see git/git-watch.ts.
  const gitWatchWss = new WebSocketServer({ noServer: true })
  const gitWatchCoordinator = new GitWatchCoordinator()
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/capabilities/ws/git-watch',
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      gitWatchWss.handleUpgrade(req, socket, head, (ws) => {
        attachGitWatch(gitWatchCoordinator, ws, req)
      })
    },
  }), 'capabilities: git-watch push WebSocket')

  ctx.effect(() => () => {
    toolsDisposers?.()
    worktreeToolsDisposer?.()
    worktreeDelegationToolsDisposer?.()
    worktreeDelegations.dispose()
    ptyManager.disposeAll()
    agentPtyRegistry.disposeAll()
    terminalSubscriptions.dispose()
    clearPtyPauseOwners()
    wss.close()
    agentListWss.close()
    gitWatchWss.close()
    gitWatchCoordinator.dispose()
  }, 'capabilities: teardown')
}