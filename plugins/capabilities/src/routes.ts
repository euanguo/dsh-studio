/**
 * The /capabilities JSON API route table (M3): every `buildCapabilitiesRoutes`
 * method — workspace cwd, fs operations, git, worktrees, pty release,
 * background jobs, settings and the browser probe. Scoped requests carry
 * the PROJECT cwd (the sidebar data model is project-dimension); the pty
 * routes key terminals by `cwd:tabId` (project-shared shells). The
 * session-derived cwd fallback (`sessionCwdOf`) remains for the host's
 * agent/media surfaces, not the fs/git routes.
 */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { Context } from './context-types.ts'
import { isLoopbackHostname } from './trust-fence.ts'
import { extractFrameAncestors } from './browser-probe.ts'
import type { ResolvedCapabilitiesConfig } from './config.ts'
import { isWithin, requireAbsolute, listDirectory, parentOf, rootLabel } from '@dsh-studio/shared/fs-tree'
import * as git from '@dsh-studio/shared/git-core'
import type { PtyManager } from './pty-manager.ts'
import type { AgentPtyRegistry } from './agent-pty.ts'
import { buildJobsApi, type CapabilitiesJobsRoutes } from './jobs-routes.ts'
import { buildWorktreeRoutes } from './worktree-routes.ts'
import { detectProjectIcon } from './project-icon.ts'
import { terminalSessionKey } from './terminal-session-store.ts'
import {
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  SOURCE_CONTROL_AI_SETTINGS_NS,
  type SourceControlAiGenerator,
  type SourceControlAiSettings,
  type SourceControlModelSelection,
} from './source-control-ai.ts'
import {
  isCapabilitiesWorkspaceMutation,
  mutateWorkspace,
  readWorkspaceFacts,
} from './workspace-git.ts'
import {
  optionalBoolean,
  optionalInteger,
  optionalPathList,
  optionalString,
} from '@dsh-studio/shared/wire'

import { SIDEBAR_PREFS_NS } from '@dsh-studio/shared/prefs-shared'
import {
  CapabilityError,
  requireString,
} from '@dsh-studio/shared/wire'
import { buildFsHandlers } from './routes/fs.ts'
import { buildSettingsHandlers } from './routes/settings.ts'
import { buildPtyHandlers } from './routes/pty.ts'
import { buildGitHandlers } from './routes/git.ts'
import {
  gitBlobBase64,
  readText,
  resolveGitPath,
  searchWorkspace,
  sessionCwdOf,
  isSettingsPathOp,
  modelSelectionOf,
  settingsNamespaceOf,
  sourceControlAiSettingsOf,
  type SettingsPathEdit,
  type CapabilitiesSettingsFace,
} from './routes/shared.ts'

export type ApiMethod = (payload: unknown) => Promise<unknown> | unknown


/** Build the API method table bound to the plugin context, pty manager, agent pty registry, and resolved config. */
export function buildCapabilitiesRoutes(
  ctx: Context,
  ptyManager: PtyManager,
  agentPtyRegistry: AgentPtyRegistry,
  resolved: ResolvedCapabilitiesConfig,
  getSettings: () => CapabilitiesSettingsFace | undefined,
  getSourceControlAiGenerator: () => SourceControlAiGenerator | undefined,
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
    'workspace.cwd': (payload) => {
      const { cwd } = cwdOf(payload)
      return { cwd, root: rootLabel(cwd), parent: parentOf(cwd) ?? null }
    },
    ...buildFsHandlers({ cwdOf, resolved }),
    ...buildGitHandlers({ cwdOf, ctx, getSettings, getSourceControlAiGenerator }),
    ...buildWorktreeRoutes({ cwdScopeOf, getSettings }),
    'project.icon-detect': async (payload) => {
      const cwd = cwdScopeOf(payload)
      return detectProjectIcon(cwd)
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
