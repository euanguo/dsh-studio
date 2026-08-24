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
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
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
    'git.status': async (payload) => {
      const { cwd } = cwdOf(payload)
      // One porcelain v2 subprocess yields isRepo + branch + entries (and
      // upstream/ahead/behind for free); attach per-entry +N/−M counts so the
      // client's change list can render file stats without extra round-trips.
      const [result, worktree, cached, upstream] = await Promise.all([
        git.statusV2(cwd),
        git.numstat(cwd, false).catch(() => []),
        git.numstat(cwd, true).catch(() => []),
        git.readUpstreamStatus(cwd),
      ])
      const statsByPath = new Map(
        [...worktree, ...cached].map(stat => [stat.path, stat] as const),
      )
      const stats = result.entries.map(entry => {
        const found = statsByPath.get(entry.path)
        return found ?? { path: entry.path, additions: 0, deletions: 0 }
      })
      return {
        isRepo: result.isRepo,
        branch: result.branch,
        entries: result.entries,
        stats,
        upstream,
      }
    },
    'git.diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      const raw = optionalString(payload, 'path')
      const path = raw === undefined ? undefined : await resolveGitPath(cwd, raw)
      const context = optionalInteger(payload, 'context', 0, 200)
      return { diff: await git.diff(cwd, path, optionalBoolean(payload, 'staged') === true, context) }
    },
    'git.image-diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      const rel = requireString(payload, 'path')
      const staged = optionalBoolean(payload, 'staged') === true
      const abs = await resolveGitPath(cwd, rel)
      const oldData = await gitBlobBase64(cwd, staged ? 'HEAD' : '', rel)
      const newData = staged
        ? await gitBlobBase64(cwd, '', rel)
        : (await readFile(abs)).toString('base64')
      return { oldData, newData }
    },
    'git.stage': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.stage(cwd, optionalPathList(payload))
      return { ok: true }
    },
    'git.unstage': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.unstage(cwd, optionalPathList(payload))
      return { ok: true }
    },
    'git.commit': async (payload) => {
      const { cwd } = cwdOf(payload)
      const message = requireString(payload, 'message')
      await git.commit(cwd, message)
      return { ok: true }
    },
    'git.generate-commit-message': async (payload) => {
      const { cwd } = cwdOf(payload)
      const generator = getSourceControlAiGenerator()
      const settings = getSettings()
      if (generator === undefined || settings === undefined) {
        throw new CapabilityError('settings-rejected', 'Source Control AI is not available in this deployment', 503)
      }
      const [configured, fallback, upstream, root] = await Promise.all([
        settings.get(SOURCE_CONTROL_AI_SETTINGS_NS),
        settings.get('agent-default-model'),
        git.readUpstreamStatus(cwd),
        git.repoRoot(cwd),
      ])
      const configuredSettings = sourceControlAiSettingsOf(configured.value)
      if (configuredSettings?.enabled === false) {
        throw new CapabilityError('settings-rejected', 'Source Control AI is disabled in Settings', 409)
      }
      const selection = modelSelectionOf(configuredSettings?.defaultModel)
        ?? modelSelectionOf(fallback.value)
      if (selection === undefined) {
        throw new CapabilityError('settings-rejected', 'Choose a default model in Settings before generating a commit message', 409)
      }
      if (upstream.branch === null) {
        throw new CapabilityError('git-error', 'cannot generate a commit message from a detached HEAD', 409)
      }
      return generator.generate({
        cwd,
        repository: basename(root),
        branch: upstream.branch,
        selection,
        template: configuredSettings?.promptTemplate ?? DEFAULT_COMMIT_MESSAGE_PROMPT,
      })
    },
    'git.cancel-generate-commit-message': (payload) => {
      const { cwd } = cwdOf(payload)
      getSourceControlAiGenerator()?.cancel(cwd)
      return { ok: true }
    },
    'source-control-ai.settings': async () => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new CapabilityError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      return settings.get(SOURCE_CONTROL_AI_SETTINGS_NS)
    },
    'source-control-ai.update-settings': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new CapabilityError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new CapabilityError('bad-request', 'patch must be a plain object')
      }
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      const nextPatch = patch as Record<string, unknown>
      if (nextPatch.defaultModel === null) {
        const { defaultModel: _clear, ...rest } = nextPatch
        await settings.update(SOURCE_CONTROL_AI_SETTINGS_NS, rest, expectedRevision)
        return settings.mutate(SOURCE_CONTROL_AI_SETTINGS_NS, [{ op: 'unset', path: ['defaultModel'] }])
      }
      return settings.update(SOURCE_CONTROL_AI_SETTINGS_NS, nextPatch, expectedRevision)
    },
    'source-control-ai.models': async () => {
      const settings = getSettings()
      const fallback = settings === undefined ? {} : await settings.get('agent-default-model')
      const groups = await Promise.all(ctx.llm.listProviders().map(async provider => {
        const catalog = await ctx.llm.listModels(provider.id)
        return Promise.all(catalog.map(async model => {
          const resolvedModel = await ctx.llm.resolveModelInfo(provider.id, model.id)
          return {
            provider: provider.id,
            id: model.id,
            name: model.name,
            reasoningEfforts: [...(resolvedModel.reasoning?.efforts ?? [])].map(effort => ({
              id: effort.id,
              name: effort.name,
            })),
          }
        }))
      }))
      return {
        models: groups.flat(),
        defaultModel: (fallback.value ?? {}) as { provider?: string; model?: string; reasoningEffort?: string },
      }
    },
    'git.branch': async (payload) => {
      const { cwd } = cwdOf(payload)
      return git.branches(cwd)
    },
    'git.upstream': async (payload) => {
      const { cwd } = cwdOf(payload)
      return git.readUpstreamStatus(cwd)
    },
    'git.fetch': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.fetch(cwd)
      return { ok: true }
    },
    'git.pull': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.pullFastForward(cwd)
      return { ok: true }
    },
    'git.push': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.push(cwd)
      return { ok: true }
    },
    'git.force-push': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.forcePushWithLease(cwd)
      return { ok: true }
    },
    'git.sync': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.syncFastForward(cwd)
      return { ok: true }
    },
    'git.abort-merge': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.abortMerge(cwd)
      return { ok: true }
    },
    'git.abort-rebase': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.abortRebase(cwd)
      return { ok: true }
    },
    'git.checkout': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.checkout(cwd, requireString(payload, 'branch'))
      return { ok: true }
    },
    'git.log': async (payload) => {
      const { cwd } = cwdOf(payload)
      const count = optionalInteger(payload, 'count', 1, 1000)
      const skip = optionalInteger(payload, 'skip', 0, 100_000)
      return git.log(cwd, count, skip)
    },
    'git.commit-diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      return { diff: await git.commitDiff(cwd, requireString(payload, 'hash')) }
    },
    'git.commit-files': async (payload) => {
      const { cwd } = cwdOf(payload)
      return git.commitFiles(cwd, requireString(payload, 'hash'))
    },
    'git.commit-file-diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      return {
        diff: await git.commitFileDiff(
          cwd,
          requireString(payload, 'hash'),
          requireString(payload, 'path'),
        ),
      }
    },
    'git.committed-files': async (payload) => {
      const { cwd } = cwdOf(payload)
      const baseRef = await git.upstreamRef(cwd)
      if (baseRef === null) return { baseRef: null, entries: [] }
      return { baseRef, entries: await git.committedFiles(cwd, baseRef) }
    },
    'git.committed-diff': async (payload) => {
      const { cwd } = cwdOf(payload)
      const baseRef = requireString(payload, 'baseRef')
      const path = optionalString(payload, 'path')
      return { diff: await git.committedDiff(cwd, baseRef, path) }
    },
    'git.discard': async (payload) => {
      const { cwd } = cwdOf(payload)
      const paths = optionalPathList(payload)
      if (paths === undefined || paths.length === 0) {
        throw new CapabilityError('bad-request', 'discard requires at least one path')
      }
      await git.discard(cwd, await Promise.all(paths.map(raw => resolveGitPath(cwd, raw))))
      return { ok: true }
    },
    'git.revert': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.revert(cwd, requireString(payload, 'hash'))
      return { ok: true }
    },
    'git.cherry-pick': async (payload) => {
      const { cwd } = cwdOf(payload)
      await git.cherryPick(cwd, requireString(payload, 'hash'))
      return { ok: true }
    },
    'git.show': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = await resolveGitPath(cwd, requireString(payload, 'path'))
      const rev = requireString(payload, 'rev')
      return { content: await git.show(cwd, rev, path) }
    },
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
    'pty.close': (payload) => {
      const { cwd } = cwdOf(payload)
      const tab = requireString(payload, 'tab')
      ptyManager.close(terminalSessionKey(cwd, tab))
      return { ok: true }
    },
    /** List durable inactive terminal projections for one project. */
    'pty.retained': (payload) => {
      const { cwd } = cwdOf(payload)
      return { sessions: ptyManager.retained(cwd) }
    },
    /** Remove one durable inactive terminal projection. */
    'pty.clear-retained': (payload) => {
      const { cwd } = cwdOf(payload)
      const tab = requireString(payload, 'tab')
      ptyManager.clearRetained(cwd, tab)
      return { ok: true }
    },
    /** Restart one shell while preserving its durable history projection. */
    'pty.restart': (payload) => {
      const { cwd } = cwdOf(payload)
      const tab = requireString(payload, 'tab')
      const cols = optionalInteger(payload, 'cols', 2, 1024) ?? 80
      const rows = optionalInteger(payload, 'rows', 2, 1024) ?? 24
      const handle = ptyManager.restart(cwd, tab, cwd, cols, rows)
      return { ok: true, incarnationId: handle.incarnationId }
    },
    // Release an agent terminal by uuid. The WS close frame already does
    // this while the socket is open; this route covers the tab-close that
    // happens while the socket is down (reconnect loop) so a closed agent
    // tab never leaves a zombie pty behind. Idempotent.
    'agent-pty.close': (payload) => {
      const uuid = requireString(payload, 'uuid')
      agentPtyRegistry.close(uuid)
      return { ok: true }
    },
    // Background jobs: read one job's output (a REPLAY of what the model
    // has read so far, from the owner session's event log — the model's
    // job_output cursor is never touched, so the human pane can never steal
    // the agent's bytes), and kill one job. The job LIST itself arrives
    // through the harness's session/jobs push mirror, so no list route
    // exists. Kill is fenced to the owning session by the jobs registry.
    'jobs.output': (payload) => jobsApi.output(payload),
    'jobs.kill': (payload) => jobsApi.kill(payload),
    // The side card preferences. The settings service is optional in the
    // composition; while absent the routes report undefined and the client
    // keeps the schema defaults. Writes are revision-guarded: a stale editor
    // is refused with settings-conflict so a concurrent change is never
    // silently overwritten (mirror of the settings seam's own guard).
    'settings.get': (payload) => {
      const settings = getSettings()
      const ns = settingsNamespaceOf(payload)
      return settings?.get(ns) ?? { value: undefined, revision: undefined }
    },
    'settings.update': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new CapabilityError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { ns?: unknown; patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new CapabilityError('bad-request', 'patch must be a plain object')
      }
      const ns = settingsNamespaceOf(payload)
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.update(ns, patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new CapabilityError('settings-conflict', error.message, 409)
        }
        throw new CapabilityError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    // Wholesale replace of one namespace's user section. Unlike a merge patch,
    // replace expresses deletion — keys absent from the section are removed —
    // so this is the reset-to-auto / clear-alias / remove-group path.
    'settings.replace': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new CapabilityError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { ns?: unknown; section?: unknown; expectedRevision?: unknown } | null
      const section = record?.section
      if (section === null || typeof section !== 'object' || Array.isArray(section)) {
        throw new CapabilityError('bad-request', 'section must be a plain object')
      }
      const ns = settingsNamespaceOf(payload)
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.replace(ns, section as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new CapabilityError('settings-conflict', error.message, 409)
        }
        throw new CapabilityError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    // Path-addressed set/unset edits on one namespace (the native delete op).
    'settings.mutate': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new CapabilityError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { ns?: unknown; ops?: unknown; expectedRevision?: unknown } | null
      const rawOps = record?.ops
      if (!Array.isArray(rawOps) || rawOps.length === 0 || !rawOps.every(isSettingsPathOp)) {
        throw new CapabilityError('bad-request', 'ops must be a non-empty array of {op,path} edits')
      }
      const ns = settingsNamespaceOf(payload)
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.mutate(ns, rawOps as SettingsPathEdit[], expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new CapabilityError('settings-conflict', error.message, 409)
        }
        throw new CapabilityError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    // Probe a URL's RESPONSE HEADERS so the sidebar browser can explain an
    // iframe refusal: X-Frame-Options / CSP frame-ancestors are exactly the
    // signals the browser enforces when it refuses to embed a site. The
    // probe is display-only (headers back to the caller), restricted to
    // http(s) non-loopback URLs with a hard timeout, and gated by the same
    // trust fence as every other route — a cross-site page cannot reach it.
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
