/**
 * Desktop-hosted sidebar JSON API: the git / fs / settings capabilities the
 * Oh-DSH client consumes. This is the single host the client talks to —
 * it never depends on the upstream DSH-better-sidebar /sidebar/api route (vendored under plugins/better-sidebar-runtime)
 * directly. The git and fs implementations are REUSED from the upstream
 * vendored framework-agnostic modules (plugins/better-sidebar-runtime/src:
 * git.ts / fs-tree.ts / wire.ts / prefs-shared.ts), so there is exactly one
 * implementation, and any contract change fails the build instead of
 * drifting silently.
 *
 * Wire contract (envelope, method payloads, DTO shapes) is shared with the
 * client through @oh-dsh/shared (plugins/shared/sidebar-api.ts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { open, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import * as git from '../../better-sidebar-runtime/src/git.ts'
import {
  isWithin,
  listDirectory,
  requireAbsolute,
} from '../../better-sidebar-runtime/src/fs-tree.ts'
import {
  readJsonBody,
  requireString,
  SidebarError,
  writeError,
  writeOk,
} from '../../better-sidebar-runtime/src/wire.ts'
import { SIDEBAR_PREFS_NS } from '../../better-sidebar-runtime/src/prefs-shared.ts'
import type { SidebarScope } from '../../shared/sidebar-api.ts'

/** Bound of one directory listing (upstream default listLimit). */
const LIST_LIMIT = 1000

/** Bound of one text read (upstream default readLimit). */
const READ_LIMIT = 512 * 1024

/** Binary payloads up to this size ship inline (base64) for image/PDF previews. */
const PREVIEW_LIMIT = 2 * 1024 * 1024

/** How many leading bytes a binary read returns for client sniffing. */
const READ_HEAD_LIMIT = 4096

/** Structural subset of the DSH settings service (namespace already registered by the upstream host). */
interface SettingsService {
  describe(options?: { redactSecrets?: boolean }): Array<{
    ns: string
    value?: unknown
    revision?: number
  }>
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

interface SidebarApiContext {
  settings: SettingsService
}

/** One API method dispatch entry. */
type ApiMethod = (payload: unknown) => Promise<unknown> | unknown

/** Resolve the request's conversation scope from the payload (cwd must be absolute). */
function scopeOf(payload: unknown): SidebarScope & { cwd: string } {
  const sessionId = requireString(payload, 'sessionId')
  const record = payload as { cwd?: unknown } | null
  const raw = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
  if (raw === undefined) throw new SidebarError('bad-request', 'cwd is required')
  return { sessionId, cwd: requireAbsolute(raw) }
}

/** Worktree-only scope: the workspace browser has no session binding, so the
 *  worktree endpoints accept a bare absolute cwd (same same-origin POST fence). */
function cwdScopeOf(payload: unknown): string {
  const record = payload as { cwd?: unknown } | null
  const raw = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
  if (raw === undefined) throw new SidebarError('bad-request', 'cwd is required')
  return requireAbsolute(raw)
}

/** Resolve a request path that must live under the session cwd (fs.read / fs.tree).
 *  Accepts repo-relative paths (git status reports them) and absolute ones. */
function boundedPath(cwd: string, raw: string): string {
  const path = isAbsolute(raw) ? raw : join(cwd, raw)
  if (!isWithin(cwd, path)) {
    throw new SidebarError('fs-error', 'path outside the session working directory', 403)
  }
  return path
}

/**
 * Text read with a size cap and NUL-probe binary detection, mirroring the
 * upstream host's readText contract (the client matches viewers by content).
 * Binary files up to PREVIEW_LIMIT also return their full base64 payload so
 * the client can render images / PDFs inline (data: URLs).
 */
async function readText(path: string): Promise<{
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
  const truncated = size > READ_LIMIT
  const handle = await open(path, 'r').catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  try {
    const buffer = Buffer.alloc(Math.min(size, READ_LIMIT))
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

/** Build the method table bound to the desktop host context. */
export function buildSidebarApi(ctx: SidebarApiContext): Record<string, ApiMethod> {
  // The side card settings namespace (SIDEBAR_PREFS_NS) is registered by the
  // upstream host; this host reads and writes the SAME namespace through the
  // in-process settings service, so there is one preference store regardless
  // of which host serves the request.
  const settingsView = (ns: string): { value?: unknown; revision?: number } => {
    const descriptor = ctx.settings.describe({ redactSecrets: true })
      .find(candidate => candidate.ns === ns)
    if (descriptor === undefined) return {}
    return {
      ...(descriptor.value === undefined ? {} : { value: descriptor.value }),
      ...(descriptor.revision === undefined ? {} : { revision: descriptor.revision }),
    }
  }
  return {
    'fs.tree': async (payload) => {
      const { cwd } = scopeOf(payload)
      const record = payload as { path?: unknown }
      const target = record.path === undefined
        ? cwd
        : boundedPath(cwd, requireString(payload, 'path'))
      return listDirectory(target, LIST_LIMIT)
    },
    'fs.read': async (payload) => {
      const { cwd } = scopeOf(payload)
      const path = boundedPath(cwd, requireString(payload, 'path'))
      const { content, truncated, binary, size, head, data } = await readText(path)
      if (binary) return { kind: 'binary', size, truncated, ...(data === undefined ? {} : { data }) }
      return { kind: 'text', content, truncated }
    },
    'git.status': async (payload) => {
      const { cwd } = scopeOf(payload)
      // One porcelain v2 subprocess yields isRepo + branch + entries (and
      // upstream/ahead/behind for free) instead of three v1 subprocesses.
      const result = await git.statusV2(cwd)
      // Attach per-entry +N/−M counts (staged entries use the index diff,
      // worktree entries use the unstaged diff). Failures degrade to 0/0 —
      // the counts are decoration, the status list is the contract.
      const [worktree, cached] = await Promise.all([
        git.numstat(cwd, false).catch(() => []),
        git.numstat(cwd, true).catch(() => []),
      ])
      const statsByPath = new Map(
        [...worktree, ...cached].map(stat => [stat.path, stat] as const),
      )
      const stats = result.entries.map(entry => {
        const staged = entry.xy[0] !== ' ' && entry.xy[0] !== '?'
        const found = statsByPath.get(entry.path)
        return found ?? { path: entry.path, additions: 0, deletions: 0 }
      })
      return { isRepo: result.isRepo, branch: result.branch, entries: result.entries, stats }
    },
    'git.branch': (payload) => {
      const cwd = cwdScopeOf(payload)
      return git.branches(cwd)
    },
    'git.log': (payload) => {
      const { cwd } = scopeOf(payload)
      const record = payload as { count?: unknown; skip?: unknown }
      const count = typeof record.count === 'number' && Number.isInteger(record.count) && record.count > 0
        ? record.count
        : undefined
      const skip = typeof record.skip === 'number' && Number.isInteger(record.skip) && record.skip >= 0
        ? record.skip
        : undefined
      return git.log(cwd, count, skip)
    },
    'git.commit-diff': async (payload) => {
      const { cwd } = scopeOf(payload)
      return { diff: await git.commitDiff(cwd, requireString(payload, 'hash')) }
    },
    'git.diff': async (payload) => {
      const { cwd } = scopeOf(payload)
      const record = payload as { path?: unknown; staged?: unknown }
      // `git status` reports repo-relative paths; git resolves them against
      // the -C cwd, so pass them through once verified to stay inside it.
      const raw = record.path === undefined ? undefined : requireString(payload, 'path')
      let path: string | undefined
      if (raw !== undefined) {
        const resolved = isAbsolute(raw) ? raw : join(cwd, raw)
        if (!isWithin(cwd, resolved)) {
          throw new SidebarError('fs-error', 'path outside the session working directory', 403)
        }
        path = raw
      }
      return { diff: await git.diff(cwd, path, record.staged === true) }
    },
    'git.stage': (payload) => {
      const { cwd } = scopeOf(payload)
      const record = payload as { path?: unknown }
      const path = record.path === undefined ? undefined : requireString(payload, 'path')
      return git.stage(cwd, path)
    },
    'git.unstage': (payload) => {
      const { cwd } = scopeOf(payload)
      const record = payload as { path?: unknown }
      const path = record.path === undefined ? undefined : requireString(payload, 'path')
      return git.unstage(cwd, path)
    },
    'git.discard': (payload) => {
      const { cwd } = scopeOf(payload)
      // Discard is destructive: always require an explicit path (no "all").
      return git.discard(cwd, requireString(payload, 'path'))
    },
    'git.checkout': (payload) => {
      const { cwd } = scopeOf(payload)
      return git.checkout(cwd, requireString(payload, 'branch'))
    },
    'git.commit': (payload) => {
      const { cwd } = scopeOf(payload)
      return git.commit(cwd, requireString(payload, 'message'))
    },
    'git.worktree-list': (payload) => {
      const cwd = cwdScopeOf(payload)
      return git.worktreeList(cwd)
    },
    'git.worktree-add': (payload) => {
      const cwd = cwdScopeOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      const branch = requireString(payload, 'branch')
      const record = payload as { createBranch?: unknown } | null
      const createBranch = record?.createBranch === true
      return git.worktreeAdd(cwd, path, branch, createBranch)
    },
    'settings.get': (payload) => {
      const ns = typeof (payload as { ns?: unknown } | null)?.ns === 'string'
        ? (payload as { ns: string }).ns
        : SIDEBAR_PREFS_NS
      return settingsView(ns)
    },
    'settings.update': async (payload) => {
      const record = payload as { ns?: unknown; patch?: unknown; expectedRevision?: unknown } | null
      const ns = typeof record?.ns === 'string' ? record.ns : SIDEBAR_PREFS_NS
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new SidebarError('bad-request', 'patch must be a plain object')
      }
      const expectedRevision = typeof record?.expectedRevision === 'number'
        ? record.expectedRevision
        : undefined
      try {
        await ctx.settings.update(ns, patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        // SettingsConflictError is duck-typed by name to avoid importing the
        // @deepseek-ai/dsh-settings package into this bundle.
        if (error instanceof Error && error.name === 'SettingsConflictError') {
          throw new SidebarError('settings-conflict', error.message, 409)
        }
        throw new SidebarError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
      return settingsView(ns)
    },
  }
}

/** Same-origin POST gate (mirrors the workspace route's fence). */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Mount the /oh-dsh-desktop/sidebar/api prefix route. */
export function registerSidebarApi(
  register: (route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }) => () => void,
  ctx: SidebarApiContext,
): () => void {
  const api = buildSidebarApi(ctx)
  return register({
    kind: 'prefix',
    path: '/oh-dsh-desktop/sidebar/api',
    handler: async (request, response) => {
      try {
        if (!sameOrigin(request)) {
          writeError(response, new SidebarError('forbidden', 'untrusted sidebar API origin', 403))
          return
        }
        if (request.method !== 'POST') {
          writeError(response, new SidebarError('method-error', 'method not allowed', 405))
          return
        }
        const pathname = new URL(request.url ?? '/', 'http://oh-dsh.internal').pathname
        const prefix = '/oh-dsh-desktop/sidebar/api/'
        const method = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined
        if (method === undefined || method.includes('/')) {
          writeError(response, new SidebarError('not-found', 'unknown sidebar API method', 404))
          return
        }
        const payload = await readJsonBody(request)
        const handler = api[method]
        if (handler === undefined) {
          writeError(response, new SidebarError('not-found', `unknown sidebar API method "${method}"`, 404))
          return
        }
        writeOk(response, await handler(payload))
      } catch (error) {
        writeError(response, error)
      }
    },
  })
}
