/**
 * Shared request-side helpers for the /capabilities route table: path
 * resolution, bounded reads, git-blob payloads, workspace search, settings
 * namespace/op parsing and the settings service face. Split from routes.ts
 * so each namespace handler module imports only what it needs.
 */
import { execFile } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context } from '../context-types.ts'
import type { ResolvedCapabilitiesConfig } from '../config.ts'
import { isWithin, requireAbsolute } from '@dsh-studio/shared/fs-tree'
import * as git from '@dsh-studio/shared/git-core'
import {
  CapabilityError,
  requireString,
} from '@dsh-studio/shared/wire'
import type {
  SourceControlAiSettings,
  SourceControlModelSelection,
} from '../source-control-ai.ts'
import { SIDEBAR_PREFS_NS } from '@dsh-studio/shared/prefs-shared'
import { errorMessage } from '@dsh-studio/shared/errors'

/** An approved path edit shape for the settings.mutate route. */
export interface SettingsPathEdit {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

/** Whether an unknown value is a well-formed path edit. */
export function isSettingsPathOp(value: unknown): value is SettingsPathEdit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.op !== 'set' && record.op !== 'unset') return false
  if (!Array.isArray(record.path) || record.path.some(part => typeof part !== 'string')) return false
  return true
}

/**
 * Resolve which registered settings namespace a client payload addresses.
 * Absent/blank falls back to the sidebar prefs namespace so the side card's
 * historical callers (which never sent `ns`) keep working unchanged; the
 * left-rail sends `dsh-studio-left-rail` explicitly.
 */
export function settingsNamespaceOf(payload: unknown): string {
  const record = payload as { ns?: unknown } | null
  const raw = typeof record?.ns === 'string' && record.ns !== '' ? record.ns : undefined
  // Namespaces are branded kebab-case (no dots) — see dsh-settings'
  // NAMESPACE_PATTERN. A foreign dot-name never matches a registration and is
  // refused by the seam, which is exactly the fence we want.
  return raw ?? SIDEBAR_PREFS_NS
}

/** Parse a source-control model selection payload (or undefined). */
export function modelSelectionOf(value: unknown): SourceControlModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
  if (typeof record.provider !== 'string' || record.provider === '' || typeof record.model !== 'string' || record.model === '') {
    return undefined
  }
  const reasoningEffort = typeof record.reasoningEffort === 'string'
    ? record.reasoningEffort as SourceControlModelSelection['reasoningEffort']
    : undefined
  return reasoningEffort === undefined
    ? { provider: record.provider, model: record.model }
    : { provider: record.provider, model: record.model, reasoningEffort }
}

/** Parse a source-control AI settings payload (or undefined). */
export function sourceControlAiSettingsOf(value: unknown): SourceControlAiSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as SourceControlAiSettings
}

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
      throw new CapabilityError('bad-request', `invalid working directory "${clientCwd}"`)
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
export async function resolveGitPath(cwd: string, raw: string): Promise<string> {
  if (isAbsolute(raw)) return requireAbsolute(raw)
  const root = await git.repoRoot(cwd).catch(() => cwd)
  return requireAbsolute(join(root, raw))
}

/** Refuse mutating fs operations outside the session working directory. */
export function assertWithinSession(cwd: string, path: string, op: string): void {
  if (!isWithin(cwd, path)) {
    throw new CapabilityError('fs-error', `${op} path outside the session working directory`, 403)
  }
}

/** How many leading bytes a binary read returns for client-side detect sniffing. */
export const READ_HEAD_LIMIT = 4096

/** Binary payloads up to this size ship inline (base64) for image/PDF previews. */
export const PREVIEW_LIMIT = 2 * 1024 * 1024

/** Read a git blob (HEAD / index) as base64 for binary previews. */
export function gitBlobBase64(cwd: string, spec: string, relPath: string): Promise<string> {
  const args = ['-C', cwd, 'show', `${spec}:${relPath}`]
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { encoding: 'buffer', timeout: 15_000 }, (error, stdout) => {
      if (error !== null) {
        reject(new CapabilityError('git-error', error.message, 400))
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

/**
 * Search the workspace with `git grep` (D15). Distinguishes "no matches"
 * from "search unavailable": `git grep` exits 1 when nothing matched (that is
 * a legitimate empty result), whereas a spawn failure / timeout / `git` missing
 * is surfaced as an `error` so the UI can show "search unavailable" instead of
 * a misleading empty list. A non-repository workspace degrades to an empty
 * result set without an error (the UI's no-results state covers it).
 */
export function searchWorkspace(
  cwd: string,
  pattern: string,
  caseSensitive: boolean,
): Promise<{ hits: FsSearchHit[]; error: string | null }> {
  const args = ['-C', cwd, 'grep', '--no-color', '-n', '-I', '-E']
  if (!caseSensitive) args.push('-i')
  args.push('-e', pattern)
  return new Promise(resolvePromise => {
    execFile('git', args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      // Exit code 1 = no matches: a real empty result, not a failure.
      if (error !== null && error.code === 1) {
        resolvePromise({ hits: [], error: null })
        return
      }
      if (error !== null) {
        const message = error instanceof Error
          ? error.message
          : `search failed (exit ${String(error.code ?? 'unknown')})`
        resolvePromise({ hits: [], error: message })
        return
      }
      const hits: FsSearchHit[] = []
      for (const line of stdout.split(/\r?\n/)) {
        if (line === '') continue
        const match = /^([^:]+):(\d+):(.*)$/.exec(line)
        if (match === null) continue
        hits.push({ path: match[1]!, line: Number(match[2]), text: match[3] ?? '' })
      }
      resolvePromise({ hits: hits.slice(0, 500), error: null })
    })
  })
}

/** Text read of a file with the size cap; binary detection via NUL probe.
 *  Binary reads also return the first {@link READ_HEAD_LIMIT} bytes (base64)
 *  so the client can re-match viewers by content (`detect`), and — when the
 *  file is small enough — the full base64 payload (`data`) for inline
 *  image/PDF previews. */
export async function readText(path: string, readLimit: number): Promise<{
  content: string
  truncated: boolean
  binary: boolean
  size: number
  head?: string
  data?: string
}> {
  const info = await stat(path).catch((error: unknown) => {
    throw new CapabilityError('fs-error', `cannot read "${path}": ${errorMessage(error)}`, 400)
  })
  if (info.isDirectory()) {
    throw new CapabilityError('fs-error', `"${path}" is a directory`, 400)
  }
  const size = info.size
  const truncated = size > readLimit
  const handle = await open(path, 'r').catch((error: unknown) => {
    throw new CapabilityError('fs-error', `cannot read "${path}": ${errorMessage(error)}`, 400)
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

/**
 * The live face of the plugin-owned settings namespaces, bound to the settings
 * service when it is mounted. The DSH settings RPC domain only serves
 * allowlisted namespaces (api-proxy exposedNamespaces), so clients read and
 * write THESE namespaces through the plugin's own fenced /capabilities routes,
 * which call the seam in-process — no configuration-client gate involved.
 */
export interface CapabilitiesSettingsFace {
  /** The current resolved value + revision for one namespace (undefined while the settings service is absent). */
  get(ns: string): Promise<{ value?: unknown; revision?: number }> | { value?: unknown; revision?: number }
  /** Merge a patch into one namespace's user section (revision-guarded). */
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<{ value?: unknown; revision?: number }>
  /** Wholesale replace of one namespace's user section (deletion-capable). */
  replace(ns: string, section: Record<string, unknown>, expectedRevision?: number): Promise<{ value?: unknown; revision?: number }>
  /** Path-addressed set/unset edits on one namespace (deletion-capable). */
  mutate(ns: string, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>, expectedRevision?: number): Promise<{ value?: unknown; revision?: number }>
}

/** One file-system route handler group dependency set. */
export interface FsHandlerDeps {
  cwdOf(payload: unknown): { cwd: string }
  resolved: ResolvedCapabilitiesConfig
}