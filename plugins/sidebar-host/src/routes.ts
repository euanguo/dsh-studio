/**
 * The /sidebar JSON API route table (M3): every `buildSidebarRoutes`
 * method — session cwd, fs operations, git, worktrees, pty release,
 * background jobs, settings and the browser probe. All operations are
 * conversation-scoped: requests carry a sessionId and the session's
 * authoritative cwd comes from the session store (see `sessionCwdOf`).
 */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { Context } from './context-types.ts'
import { isLoopbackHostname } from './trust-fence.ts'
import { extractFrameAncestors } from './browser-probe.ts'
import type { ResolvedSidebarConfig } from './config.ts'
import { isWithin, requireAbsolute, listDirectory, parentOf, rootLabel } from '@oh-dsh/shared/fs-tree'
import * as git from '@oh-dsh/shared/git-core'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { PtyManager } from './pty-manager.ts'
import type { AgentPtyRegistry } from './agent-pty.ts'
import { buildJobsApi, type SidebarJobsRoutes } from './jobs-routes.ts'
import { detectProjectIcon } from './project-icon.ts'
import {
  isSidebarWorkspaceMutation,
  mutateWorkspace,
  readWorkspaceFacts,
} from './workspace-git.ts'
import {
  optionalBoolean,
  optionalInteger,
  optionalPathList,
  optionalString,
  requireString,
  SidebarError,
} from '@oh-dsh/shared/wire'

export type ApiMethod = (payload: unknown) => Promise<unknown> | unknown


/**
 * Resolve a session's authoritative working directory. The attached session
 * header wins; while the session is still hydrating from persistence (the
 * web client attaches the current conversation a moment after page load, so
 * the very first sidebar requests can arrive detached) the caller's own
 * list-summary cwd is used; the process cwd is the last resort (blank
 * sessions have no cwd anywhere yet). Never throws for a missing cwd, so
 * explorer/git/terminal work from first paint instead of surfacing
 * "session ... has no working directory".
 */
export function sessionCwdOf(ctx: Context, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '') {
    try {
      return requireAbsolute(clientCwd)
    } catch {
      throw new SidebarError('bad-request', `invalid working directory "${clientCwd}"`)
    }
  }
  return process.cwd()
}

/**
 * Resolve a path that a git command reported — `git status`/`git diff`
 * print paths RELATIVE TO THE REPO TOP LEVEL, which may sit above the
 * session cwd (a session inside a subdirectory of a repository). Absolute
 * paths pass through; relative ones join the repo root (falling back to the
 * cwd when the root cannot be resolved, e.g. a bare directory).
 */
async function resolveGitPath(cwd: string, raw: string): Promise<string> {
  if (isAbsolute(raw)) return requireAbsolute(raw)
  const root = await git.repoRoot(cwd).catch(() => cwd)
  return requireAbsolute(join(root, raw))
}

/** Refuse mutating fs operations outside the session working directory. */
function assertWithinSession(cwd: string, path: string, op: string): void {
  if (!isWithin(cwd, path)) {
    throw new SidebarError('fs-error', `${op} path outside the session working directory`, 403)
  }
}

/** How many leading bytes a binary read returns for client-side detect sniffing. */
const READ_HEAD_LIMIT = 4096

/** Binary payloads up to this size ship inline (base64) for image/PDF previews. */
const PREVIEW_LIMIT = 2 * 1024 * 1024

/** Read a git blob (HEAD / index) as base64 for binary previews. */
function gitBlobBase64(cwd: string, spec: string, relPath: string): Promise<string> {
  const args = ['-C', cwd, 'show', `${spec}:${relPath}`]
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { encoding: 'buffer', timeout: 15_000 }, (error, stdout) => {
      if (error !== null) {
        reject(new SidebarError('git-error', error.message, 400))
        return
      }
      resolvePromise(stdout.toString('base64'))
    })
  })
}

export interface FsSearchHit {
  path: string
  line: number
  text: string
}

/** Search the workspace with `git grep` (falls back to an empty result set
 *  when the workspace is not a repository — the UI shows a no-results state
 *  instead of a hard error). */
function searchWorkspace(cwd: string, pattern: string, caseSensitive: boolean): Promise<FsSearchHit[]> {
  const args = ['-C', cwd, 'grep', '--no-color', '-n', '-I', '-E']
  if (!caseSensitive) args.push('-i')
  args.push('-e', pattern)
  return new Promise(resolvePromise => {
    execFile('git', args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null && error.code !== 1) {
        resolvePromise([])
        return
      }
      const hits: FsSearchHit[] = []
      for (const line of stdout.split(/\r?\n/)) {
        if (line === '') continue
        const match = /^([^:]+):(\d+):(.*)$/.exec(line)
        if (match === null) continue
        hits.push({ path: match[1]!, line: Number(match[2]), text: match[3] ?? '' })
      }
      resolvePromise(hits.slice(0, 500))
    })
  })
}

/** Text read of a file with the size cap; binary detection via NUL probe.
 *  Binary reads also return the first {@link READ_HEAD_LIMIT} bytes (base64)
 *  so the client can re-match viewers by content (`detect`), and — when the
 *  file is small enough — the full base64 payload (`data`) for inline
 *  image/PDF previews. */
async function readText(path: string, readLimit: number): Promise<{
  content: string
  truncated: boolean
  binary: boolean
  size: number
  head?: string
  data?: string
}> {
  const info = await stat(path).catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  if (info.isDirectory()) {
    throw new SidebarError('fs-error', `"${path}" is a directory`, 400)
  }
  const size = info.size
  const truncated = size > readLimit
  const handle = await open(path, 'r').catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  try {
    const buffer = Buffer.alloc(Math.min(size, readLimit))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const slice = buffer.subarray(0, bytesRead)
    const binary = slice.includes(0)
    if (binary) {
      const head = slice.subarray(0, Math.min(slice.length, READ_HEAD_LIMIT)).toString('base64')
      if (size <= PREVIEW_LIMIT) {
        // Re-read the full payload for inline image/PDF previews.
        const full = Buffer.alloc(size)
        const { bytesRead: fullRead } = await handle.read(full, 0, full.length, 0)
        return {
          content: '',
          truncated: false,
          binary,
          size,
          head,
          data: full.subarray(0, fullRead).toString('base64'),
        }
      }
      return { content: '', truncated, binary, size, head }
    }
    return { content: slice.toString('utf8'), truncated, binary: false, size }
  } finally {
    await handle.close()
  }
}

/** One API method dispatch table entry. */

/**
 * The live face of the side card settings namespace, bound to the settings
 * service when it is mounted. The DSH settings RPC domain only serves
 * allowlisted namespaces (api-proxy exposedNamespaces), so the client reads
 * and writes THIS namespace through the plugin's own fenced /sidebar routes,
 * which call the seam in-process — no configuration-client gate involved.
 */
export interface SidebarSettingsFace {
  /** The current resolved value + revision (undefined while the settings service is absent). */
  get(): { value?: unknown; revision?: number }
  /** Merge a patch (revision-guarded) and return the fresh resolved view. */
  update(patch: Record<string, unknown>, expectedRevision?: number): Promise<{ value?: unknown; revision?: number }>
}

/** Build the API method table bound to the plugin context, pty manager, agent pty registry, and resolved config. */
export function buildSidebarRoutes(
  ctx: Context,
  ptyManager: PtyManager,
  agentPtyRegistry: AgentPtyRegistry,
  resolved: ResolvedSidebarConfig,
  getSettings: () => SidebarSettingsFace | undefined,
): Record<string, ApiMethod> {
  const cwdOf = (payload: unknown): { sessionId: string; cwd: string } => {
    const sessionId = requireString(payload, 'sessionId')
    const record = payload as { cwd?: unknown } | null
    const clientCwd = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
    return { sessionId, cwd: sessionCwdOf(ctx, sessionId, clientCwd) }
  }
  // Worktree-only scope: the workspace browser has no session binding, so the
  // worktree endpoints accept a bare absolute cwd (same same-origin POST fence).
  const cwdScopeOf = (payload: unknown): string => {
    const record = payload as { cwd?: unknown } | null
    const raw = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
    if (raw === undefined) throw new SidebarError('bad-request', 'cwd is required')
    return requireAbsolute(raw)
  }
  // Background jobs: the LIST rides the harness's `session/jobs` push
  // mirror, so these routes only replay output the model has read (from the
  // session's own event log — no DSH source is touched, the model's
  // job_output cursor is never consumed) and kill (the registry's stock
  // API). A deployment without the jobs registry downgrades kill to a 503.
  const jobsApi: SidebarJobsRoutes = buildJobsApi(ctx, resolved.readLimit)
  return {
    'session.cwd': (payload) => {
      const { sessionId, cwd } = cwdOf(payload)
      return { sessionId, cwd, root: rootLabel(cwd), parent: parentOf(cwd) ?? null }
    },
    'fs.tree': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { path?: unknown }
      const target = record.path === undefined ? cwd : requireAbsolute(requireString(payload, 'path'))
      return listDirectory(target, resolved.listLimit)
    },
    'fs.read': async (payload) => {
      const { cwd } = cwdOf(payload)
      // Relative paths are git-derived (status/diff report repo-root-relative
      // names; the untracked diff view reads the file through this route).
      const path = await resolveGitPath(cwd, requireString(payload, 'path'))
      const { content, truncated, binary, size, head, data } = await readText(path, resolved.readLimit)
      if (binary) {
        return {
          kind: 'binary',
          size,
          truncated,
          ...(head === undefined ? {} : { head }),
          ...(data === undefined ? {} : { data }),
        }
      }
      return { kind: 'text', content, truncated }
    },
    'fs.write': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      assertWithinSession(cwd, path, 'write')
      const content = requireString(payload, 'content')
      const tmp = `${path}.dsh-sidebar-tmp-${process.pid}`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, path)
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => {})
        throw new SidebarError('fs-error', `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.create': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      assertWithinSession(cwd, path, 'create')
      const record = payload as { directory?: unknown }
      try {
        if (record.directory === true) {
          await mkdir(path, { recursive: false })
        } else {
          await writeFile(path, '', { encoding: 'utf8', flag: 'wx' })
        }
      } catch (error) {
        throw new SidebarError('fs-error', `cannot create "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.rename': async (payload) => {
      const { cwd } = cwdOf(payload)
      const from = requireAbsolute(requireString(payload, 'from'))
      const to = requireAbsolute(requireString(payload, 'to'))
      assertWithinSession(cwd, from, 'rename')
      assertWithinSession(cwd, to, 'rename')
      try {
        await rename(from, to)
      } catch (error) {
        throw new SidebarError('fs-error', `cannot rename "${from}": ${error instanceof Error ? error.message : String(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.delete': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      assertWithinSession(cwd, path, 'delete')
      try {
        await rm(path, { recursive: true, force: false })
      } catch (error) {
        throw new SidebarError('fs-error', `cannot delete "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.copy': async (payload) => {
      const { cwd } = cwdOf(payload)
      const from = requireAbsolute(requireString(payload, 'from'))
      const to = requireAbsolute(requireString(payload, 'to'))
      assertWithinSession(cwd, from, 'copy')
      assertWithinSession(cwd, to, 'copy')
      try {
        await copyFile(from, to)
      } catch (error) {
        throw new SidebarError('fs-error', `cannot copy "${from}": ${error instanceof Error ? error.message : String(error)}`, 400)
      }
      return { ok: true }
    },
    'fs.search': async (payload) => {
      const { cwd } = cwdOf(payload)
      const pattern = requireString(payload, 'pattern')
      return searchWorkspace(cwd, pattern, optionalBoolean(payload, 'caseSensitive') === true)
    },
    'fs.tail': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = await resolveGitPath(cwd, requireString(payload, 'path'))
      const maxBytes = Math.min(optionalInteger(payload, 'maxBytes', 1, Number.MAX_SAFE_INTEGER) ?? 128 * 1024, 512 * 1024)
      const info = await stat(path).catch((error: unknown) => {
        throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
      })
      const handle = await open(path, 'r')
      try {
        const readSize = Math.min(info.size, maxBytes)
        const buffer = Buffer.alloc(readSize)
        const { bytesRead } = await handle.read(buffer, 0, readSize, Math.max(0, info.size - readSize))
        return { content: buffer.subarray(0, bytesRead).toString('utf8'), truncated: info.size > maxBytes }
      } finally {
        await handle.close()
      }
    },
    'git.status': async (payload) => {
      const { cwd } = cwdOf(payload)
      // One porcelain v2 subprocess yields isRepo + branch + entries (and
      // upstream/ahead/behind for free); attach per-entry +N/−M counts so the
      // client's change list can render file stats without extra round-trips.
      const result = await git.statusV2(cwd)
      const [worktree, cached] = await Promise.all([
        git.numstat(cwd, false).catch(() => []),
        git.numstat(cwd, true).catch(() => []),
      ])
      const statsByPath = new Map(
        [...worktree, ...cached].map(stat => [stat.path, stat] as const),
      )
      const stats = result.entries.map(entry => {
        const found = statsByPath.get(entry.path)
        return found ?? { path: entry.path, additions: 0, deletions: 0 }
      })
      return { isRepo: result.isRepo, branch: result.branch, entries: result.entries, stats }
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
    'git.branch': async (payload) => {
      const { cwd } = cwdOf(payload)
      return git.branches(cwd)
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
        throw new SidebarError('bad-request', 'discard requires at least one path')
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
    'git.worktree-list': (payload) => {
      const cwd = cwdScopeOf(payload)
      return git.worktreeList(cwd)
    },
    'git.worktree-add': (payload) => {
      const cwd = cwdScopeOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      const branch = requireString(payload, 'branch')
      return git.worktreeAdd(cwd, path, branch, optionalBoolean(payload, 'createBranch') === true)
    },
    'git.worktree-remove-preview': async (payload) => {
      const cwd = cwdScopeOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      try {
        const preview = await git.worktreeRemovalPreview(cwd, path)
        return {
          repoRoot: preview.repoRoot,
          path: preview.worktree.path,
          branch: preview.worktree.branch,
          main: preview.worktree.main,
          locked: preview.worktree.locked === true,
          prunable: preview.worktree.prunable ?? null,
          dirty: preview.dirty,
          statusEntries: preview.statusEntries,
        }
      } catch (error) {
        if (error instanceof git.GitCommandError) {
          throw new SidebarError('git-error', error.message, 409)
        }
        throw error
      }
    },
    'git.worktree-remove': async (payload) => {
      const cwd = cwdScopeOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      try {
        return { layout: await git.worktreeRemove(cwd, path, optionalBoolean(payload, 'force') === true) }
      } catch (error) {
        if (error instanceof git.GitCommandError) {
          throw new SidebarError('git-error', error.message, 409)
        }
        throw error
      }
    },
    'project.icon-detect': async (payload) => {
      const cwd = cwdScopeOf(payload)
      return detectProjectIcon(cwd)
    },
    // Workspace-level facts/mutations (fork): the same bare-cwd scope as the
    // worktree endpoints, serving the source-control panel's repository
    // snapshot and its branch-create/push actions. Folding them here (from
    // the former self-hosted /oh-dsh/workspace route) keeps ONE host API
    // surface behind ONE trust fence for every panel data channel.
    'workspace.facts': (payload) => {
      return readWorkspaceFacts(cwdScopeOf(payload))
    },
    'workspace.mutate': (payload) => {
      const cwd = cwdScopeOf(payload)
      const record = payload as { mutation?: unknown }
      if (!isSidebarWorkspaceMutation(record.mutation)) {
        throw new SidebarError('bad-request', 'invalid workspace mutation')
      }
      return mutateWorkspace(cwd, record.mutation)
    },
    // Release a terminal immediately. The WebSocket close frame already does
    // this while the socket is open; this route covers the tab-close that
    // happens while the socket is down (reconnect loop), so a closed tab can
    // never hold the per-session quota until the reconnect grace expires.
    'pty.close': (payload) => {
      const sessionId = requireString(payload, 'sessionId')
      const tab = requireString(payload, 'tab')
      ptyManager.close(`${sessionId}:${tab}`)
      return { ok: true }
    },
    /** List durable inactive terminal projections for one session. */
    'pty.retained': (payload) => {
      const sessionId = requireString(payload, 'sessionId')
      return { sessions: ptyManager.retained(sessionId) }
    },
    /** Remove one durable inactive terminal projection. */
    'pty.clear-retained': (payload) => {
      const sessionId = requireString(payload, 'sessionId')
      const tab = requireString(payload, 'tab')
      ptyManager.clearRetained(sessionId, tab)
      return { ok: true }
    },
    /** Restart one shell while preserving its durable history projection. */
    'pty.restart': (payload) => {
      const { sessionId, cwd } = cwdOf(payload)
      const tab = requireString(payload, 'tab')
      const cols = optionalInteger(payload, 'cols', 2, 1024) ?? 80
      const rows = optionalInteger(payload, 'rows', 2, 1024) ?? 24
      const handle = ptyManager.restart(sessionId, tab, cwd, cols, rows)
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
    'settings.get': () => {
      const settings = getSettings()
      return settings?.get() ?? { value: undefined, revision: undefined }
    },
    'settings.update': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new SidebarError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new SidebarError('bad-request', 'patch must be a plain object')
      }
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.update(patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new SidebarError('settings-conflict', error.message, 409)
        }
        throw new SidebarError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
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
        throw new SidebarError('bad-request', 'invalid url', 400)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new SidebarError('bad-request', 'only http/https urls can be probed', 400)
      }
      // Mirror the browser tab's address-bar policy: loopback stays unreachable
      // from the sidebar, so probing it would leak nothing the tab could use.
      if (isLoopbackHostname(parsed.hostname)) {
        throw new SidebarError('bad-request', 'local addresses are not probed', 400)
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
