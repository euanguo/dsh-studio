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
 * All operations are conversation-scoped: requests carry a sessionId and a
 * registry-validated cwd (see workspace-scope.ts), and terminal processes
 * are keyed by session.
 *
 * Construction lives in ./factories/*: this file is the composition root —
 * it builds the pieces in dependency order, wires them into the fenced web
 * server, and owns the teardown order.
 */
import type { IncomingMessage } from 'node:http'
import {
  resolveCapabilitiesConfig,
  type CapabilitiesConfig,
  type ResolvedCapabilitiesConfig,
} from './config.ts'
import { Config } from './config.ts'
import type { SidebarPrefs } from '@dsh-studio/shared/prefs-shared'
import { SIDEBAR_PREFS_DEFAULTS } from '@dsh-studio/shared/prefs-shared'
import type { Context } from './context-types.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { registerBundleRoute } from './bundle-route.ts'
import { buildCapabilitiesRoutes, sessionCwdOf } from './routes.ts'
import { registerTools } from './tools.ts'
import {
  registerWorktreeDelegationTools,
  registerWorktreeTools,
} from './worktree/worktree-tools.ts'
import { clearPtyPauseOwners } from './terminal/terminal-route.ts'
import { CapabilityError, readJsonBody, writeError, writeJson, writeOk } from '@dsh-studio/shared/wire'
import { createTerminalAssembly } from './factories/terminal-assembly.ts'
import { createUiChromeDomain } from './factories/ui-chrome-domain.ts'
import { createSettingsDomain } from './factories/settings-domain.ts'
import { registerSessionFileRoutes, mediaTypeForPath } from './factories/session-file-routes.ts'
import { registerPushChannels } from './factories/push-channels.ts'

export { Config }
export type { CapabilitiesConfig, ResolvedCapabilitiesConfig }
// The capability gateway is the host-side runtime; the sidebar UI owns its
// browser registry independently.
export type { Context } from './context-types.ts'
export { mediaTypeForPath }

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
  const resolved = resolveCapabilitiesConfig(config)
  const trustedHosts = trustedHostsOf(ctx)
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHosts)
  // Terminal policy and shell resolution read the live settings snapshot;
  // the settings domain below feeds both on every committed change.
  let settingsPrefs: SidebarPrefs = { ...SIDEBAR_PREFS_DEFAULTS }
  const terminals = createTerminalAssembly(ctx, { resolved, getPrefs: () => settingsPrefs })
  const { worktreeDelegations, ptyManager, agentPtyRegistry, terminalSubscriptions } = terminals
  const uiChrome = createUiChromeDomain(ctx)

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

  const settings = createSettingsDomain(ctx, {
    onInitial: (scope) => {
      settingsPrefs = scope.get()
      terminals.setShellFromPrefs(settingsPrefs)
      syncToolsGate(scope)
    },
    onChange: (next, scope) => {
      settingsPrefs = next
      terminals.setShellFromPrefs(next)
      syncToolsGate(scope)
    },
  })

  // ── JSON API ────────────────────────────────────────────────────────────
  const api = buildCapabilitiesRoutes(
    ctx,
    ptyManager,
    agentPtyRegistry,
    resolved,
    () => settings.settingsFace,
    () => settings.sourceControlAiGenerator,
    () => uiChrome.awaitFace(),
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
  ctx.effect(() => registerBundleRoute(ctx, fence), 'capabilities: /capabilities/bundle chunk route')

  // ── Media + HTML preview GET routes ─────────────────────────────────────
  registerSessionFileRoutes(ctx, { fence, resolved })

  // ── Push channels (terminal / agent-terminals / git-watch WebSockets) ───
  const channels = registerPushChannels(ctx, {
    fence,
    ptyManager,
    agentPtyRegistry,
    terminalSubscriptions,
    getTerminalPolicy: terminals.getTerminalPolicy,
  })

  ctx.effect(() => () => {
    toolsDisposers?.()
    worktreeToolsDisposer?.()
    worktreeDelegationToolsDisposer?.()
    worktreeDelegations.dispose()
    ptyManager.disposeAll()
    agentPtyRegistry.disposeAll()
    terminalSubscriptions.dispose()
    clearPtyPauseOwners()
    channels.wss.close()
    channels.agentListWss.close()
    channels.gitWatchWss.close()
    channels.gitWatchCoordinator.dispose()
  }, 'capabilities: teardown')
}
