/**
 * The /capabilities JSON API route table (M3): every `buildCapabilitiesRoutes`
 * method — fs operations, git, worktrees, workspace facts/mutations, pty
 * release, background jobs and settings. Scoped requests carry the PROJECT
 * cwd (the sidebar data model is project-dimension); the pty routes key
 * terminals by `cwd:tabId` (project-shared shells). The session-derived cwd
 * fallback (`sessionCwdOf`) remains for the host's agent/media surfaces, not
 * the fs/git routes. The orphan surfaces (browser.probe, workspace.cwd,
 * git.revert/cherry-pick/show, fs.tail, agent-pty.close) are restored as
 * unwired dormant handlers (leaf-R2 ④) — the DTO table and client wrappers
 * were restored with them.
 */
import type { Context } from './context-types.ts'
import type { ResolvedCapabilitiesConfig } from './config.ts'
import { requireAbsolute, parentOf, rootLabel } from '@dsh-studio/shared/fs-tree'
import { isLoopbackHostname } from './trust-fence.ts'
import type { PtyManager } from './terminal/pty-manager.ts'
import type { AgentPtyRegistry } from './terminal/agent-pty.ts'
import { buildJobsApi, type CapabilitiesJobsRoutes } from './routes/jobs-routes.ts'
import { buildWorktreeRoutes } from './worktree/worktree-routes.ts'
import { detectProjectIcon } from './project-icon.ts'
import {
  CapabilityError,
  requireString,
} from '@dsh-studio/shared/wire'
import { buildFsHandlers } from './routes/fs.ts'
import { buildSettingsHandlers } from './routes/settings.ts'
import { buildUiChromeHandlers } from './routes/ui-chrome.ts'
import type { UiChromeFace } from './routes/ui-chrome.ts'
import { buildPtyHandlers } from './routes/pty.ts'
import { buildGitHandlers } from './routes/git.ts'
import {
  isCapabilitiesWorkspaceMutation,
  mutateWorkspace,
  readWorkspaceFacts,
} from './workspace-git.ts'
import {
  type CapabilitiesSettingsFace,
} from './routes/shared.ts'
import type { SourceControlAiGenerator } from './source-control-ai.ts'
import type { ApiMethod } from './routes/types.ts'
import type { WorktreeDefaultsResult } from '@dsh-studio/shared/worktree-preferences'

// // unwired-capability (leaf-R2 ④): `extractFrameAncestors` restored inline
// // (its module `browser-probe.ts` was removed in the dormant cut). Kept
// // dependency-free so the parser is unit-testable; re-wiring browser.probe
// // into a surfaced browser tab restores the embed-safety signal it feeds.
/**
 * Extract the `frame-ancestors` source list of a Content-Security-Policy
 * header, or undefined when the directive is absent (or empty). Sources are
 * space-separated tokens (`'none'`, `'self'`, `*`, or origins).
 */
function extractFrameAncestors(csp: string | null): string[] | undefined {
  if (csp === null) return undefined
  for (const directive of csp.split(';')) {
    const parts = directive.trim().split(/\s+/)
    if (parts[0] === 'frame-ancestors') {
      const sources = parts.slice(1).filter(source => source !== '')
      return sources.length === 0 ? undefined : sources
    }
  }
  return undefined
}

/** Build the API method table bound to the plugin context, pty manager, agent pty registry, and resolved config. */
export function buildCapabilitiesRoutes(
  ctx: Context,
  ptyManager: PtyManager,
  agentPtyRegistry: AgentPtyRegistry,
  resolved: ResolvedCapabilitiesConfig,
  getSettings: () => CapabilitiesSettingsFace | undefined,
  getSourceControlAiGenerator: () => SourceControlAiGenerator | undefined,
  getUiChrome: () => Promise<UiChromeFace | undefined>,
  getWorktreeDefaults: () => WorktreeDefaultsResult,
): Record<string, ApiMethod> {
  const cwdOf = (payload: unknown): { cwd: string } => {
    const record = payload as { cwd?: unknown } | null
    const raw = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
    if (raw === undefined) throw new CapabilityError('bad-request', 'cwd is required')
    return { cwd: requireAbsolute(raw) }
  }
  // Worktree-only scope: the workspace browser has no session binding, so the
  // worktree endpoints accept a bare absolute cwd (same same-origin POST fence).
  const cwdScopeOf = (payload: unknown): string => {
    const record = payload as { cwd?: unknown } | null
    const raw = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
    if (raw === undefined) throw new CapabilityError('bad-request', 'cwd is required')
    return requireAbsolute(raw)
  }
  // Background jobs: the LIST rides the harness's `session/jobs` push
  // mirror, so these routes only replay output the model has read (from the
  // session's own event log — no DSH source is touched, the model's
  // job_output cursor is never consumed) and kill (the registry's stock
  // API). A deployment without the jobs registry downgrades kill to a 503.
  const jobsApi: CapabilitiesJobsRoutes = buildJobsApi(ctx, resolved.readLimit)
  return {
    ...buildFsHandlers({ cwdOf, resolved }),
    ...buildGitHandlers({ cwdOf, ctx, getSettings, getSourceControlAiGenerator }),
    ...buildWorktreeRoutes({ cwdScopeOf, getDefaults: getWorktreeDefaults }),
    'project.icon-detect': async (payload) => {
      const cwd = cwdScopeOf(payload)
      return detectProjectIcon(cwd)
    },
    // // unwired-capability (leaf-R2 ④): workspace.cwd restored as a dormant
    // // handler — the sidebar surface that would call it is not mounted. The
    // // workspace browser previously asked this for the breadcrumb/root label.
    'workspace.cwd': (payload) => {
      const { cwd } = cwdOf(payload)
      return { cwd, root: rootLabel(cwd), parent: parentOf(cwd) ?? null }
    },
    // Workspace-level facts/mutations (fork): the same bare-cwd scope as the
    // worktree endpoints, serving the source-control panel's repository
    // snapshot and its branch-create/push actions. Folding them here (from
    // the former self-hosted /dsh-studio/workspace route) keeps ONE host API
    // surface behind ONE trust fence for every panel data channel.
    'workspace.facts': (payload) => {
      return readWorkspaceFacts(cwdScopeOf(payload))
    },
    'workspace.mutate': (payload) => {
      const cwd = cwdScopeOf(payload)
      const record = payload as { mutation?: unknown }
      if (!isCapabilitiesWorkspaceMutation(record.mutation)) {
        throw new CapabilityError('bad-request', 'invalid workspace mutation')
      }
      return mutateWorkspace(cwd, record.mutation)
    },
    // Release a terminal immediately. The WebSocket close frame already does
    // this while the socket is open; this route covers the tab-close that
    // happens while the socket is down (reconnect loop), so a closed tab can
    // never hold the per-session quota until the reconnect grace expires.
    ...buildPtyHandlers({ cwdOf, ptyManager, agentPtyRegistry }),
    'jobs.output': (payload) => jobsApi.output(payload),
    'jobs.kill': (payload) => jobsApi.kill(payload),
    // The side card preferences. The settings service is optional in the
    // composition; while absent the routes report undefined and the client
    // keeps the schema defaults. Writes are revision-guarded: a stale editor
    // is refused with settings-conflict so a concurrent change is never
    // silently overwritten (mirror of the settings seam's own guard).
    ...buildSettingsHandlers({ getSettings }),
    ...buildUiChromeHandlers({ getUiChrome }),
    // // unwired-capability (leaf-R2 ④): browser.probe restored as a dormant
    // // handler — the sidebar browser tab that used it for embed-safety
    // // preview is not mounted, so nothing calls it yet. Re-wiring the tab
    // // surface re-enables the capability as-is (the `extractFrameAncestors`
    // // parser it needs is inlined above).
    'browser.probe': async (payload) => {
      const raw = requireString(payload, 'url')
      let parsed: URL
      try {
        parsed = new URL(raw)
      } catch {
        throw new CapabilityError('bad-request', 'invalid url', 400)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new CapabilityError('bad-request', 'only http/https urls can be probed', 400)
      }
      // Mirror the browser tab's address-bar policy: loopback stays unreachable
      // from the sidebar, so probing it would leak nothing the tab could use.
      if (isLoopbackHostname(parsed.hostname)) {
        throw new CapabilityError('bad-request', 'local addresses are not probed', 400)
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        let response = await fetch(parsed, { method: 'HEAD', redirect: 'follow', signal: controller.signal })
        // Some servers answer HEAD with 405/501; retry once as GET (the
        // body is discarded — only the headers matter).
        if (response.status === 405 || response.status === 501) {
          response = await fetch(parsed, { method: 'GET', redirect: 'follow', signal: controller.signal })
        }
        const csp = response.headers.get('content-security-policy')
        const frameAncestors = extractFrameAncestors(csp)
        const xFrameOptions = response.headers.get('x-frame-options')
        return {
          reachable: true,
          url: response.url,
          status: response.status,
          ...(xFrameOptions !== null ? { xFrameOptions } : {}),
          ...(frameAncestors !== undefined ? { frameAncestors } : {}),
        }
      } catch {
        // DNS / TLS / connection / timeout: nothing to judge — the client
        // keeps the plain iframe.
        return { reachable: false }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}


export { sessionCwdOf, type CapabilitiesSettingsFace } from './routes/shared.ts'