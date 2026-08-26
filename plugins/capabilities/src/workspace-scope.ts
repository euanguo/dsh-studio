/**
 * workspace-scope.ts — the server-side workspace scope fence for every
 * capability route that carries a client-supplied cwd.
 *
 * Threat model: the same-origin POST fence is transport hygiene, NOT
 * authentication (trust-fence.ts says so itself). Without this module the
 * cwd field was whatever the client asserted, so `fs.tree/read/tail` could
 * address any absolute path on the host. The registry closes that hole by
 * validating the cwd against an allow-set derived from server-side truth:
 *
 *   - registered workspace roots   (`ctx.workspaceRegistry.list()` → `.path`)
 *   - live session cwds            (`ctx.sessions.list()` → `header.cwd`)
 *
 * Both sources are synchronous in-memory registry reads on the host, so
 * `assertAllowed` re-reads them on EVERY assertion (zero staleness window,
 * no change-event plumbing needed); `refresh()` stays public for prefetch
 * and tests. A cwd counts as allowed when it IS a known root or lives
 * INSIDE one (sessions may open subdirectories of a project). Path
 * containment reuses `isWithin` from @dsh-studio/shared/fs-tree — including
 * its case-insensitive Windows branch — rather than reinventing it.
 */
import { CapabilityError } from '@dsh-studio/shared/wire'
import { isWithin } from '@dsh-studio/shared/fs-tree'

/** The server-side facts the registry treats as the allow-set. */
export interface WorkspaceScopeSource {
  /** Registered workspace roots (`ctx.workspaceRegistry.list()` → `.path`). */
  workspaces(): readonly string[]
  /** Live session cwds (`ctx.sessions.list()` → `header.cwd`; blanks ignored). */
  sessions(): readonly (string | undefined)[]
}

export interface WorkspaceScopeRegistry {
  /** Re-read the sources into the root set (also runs before each assertion). */
  refresh(): void
  /** Current normalized root set (deduped; diagnostics/tests). */
  roots(): readonly string[]
  /** True when the cwd is a known root or lives inside one. */
  isAllowed(cwd: string, platform?: NodeJS.Platform): boolean
  /**
   * Reject a client-supplied cwd unless it is an absolute, traversal-free
   * path at/inside a known root. `bad-request` for malformed paths,
   * `forbidden` for well-formed paths outside the allow-set.
   */
  assertAllowed(cwd: string, platform?: NodeJS.Platform): void
}

/** Same absolute-path test as requireAbsolute, WITHOUT its resolve() step —
 *  resolve() would silently absorb `..` segments and relative names, and the
 *  fence must judge the path exactly as the client sent it. */
function isAbsoluteLiteral(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/** True when any path segment is `.` or `..` (escape or no-op attempts). */
function hasTraversalSegments(path: string): boolean {
  return path.split(/[\\/]+/).some(segment => segment === '..' || segment === '.')
}

/** Strip trailing separators (keep "/" and bare drive roots intact). */
function normalizeRoot(path: string): string {
  if (path.length > 1 && /[\\/]/.test(path.at(-1) ?? '') && !/^[A-Za-z]:\\?$/.test(path)) {
    return path.replace(/[\\/]+$/, '')
  }
  return path
}

export function createWorkspaceScopeRegistry(source: WorkspaceScopeSource): WorkspaceScopeRegistry {
  let roots: string[] = []

  const refresh = (): void => {
    const seen = new Set<string>()
    const collected: string[] = []
    const push = (raw: string | undefined): void => {
      if (typeof raw !== 'string' || raw === '' || !isAbsoluteLiteral(raw)) return
      // Literal normalization only: a host resolve() would rewrite Windows
      // drive paths against the current process cwd when tests exercise the
      // win32 branch from a POSIX host, and registered/session paths are
      // already absolute by construction.
      const normalized = normalizeRoot(raw)
      // Windows containment is case-insensitive (isWithin), so dedupe the
      // ROOT SET the same way or repeated registrations would grow it.
      const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
      if (seen.has(key)) return
      seen.add(key)
      collected.push(normalized)
    }
    for (const workspace of source.workspaces()) push(workspace)
    for (const cwd of source.sessions()) push(cwd)
    roots = collected
  }

  return {
    // Both predicates refresh first: the sources are synchronous in-memory
    // host registries, so every read reflects registrations made after
    // construction without any event plumbing.
    refresh,
    roots: () => roots,
    isAllowed: (cwd, platform = process.platform) => {
      refresh()
      return roots.some(root => isWithin(root, cwd, platform))
    },
    assertAllowed: (cwd, platform = process.platform) => {
      // Judge the literal client string first: requireAbsolute() resolves
      // away `.`/`..` and relative names, which must NOT launder an escape.
      if (!isAbsoluteLiteral(cwd)) {
        throw new CapabilityError('bad-request', `"${cwd}" is not an absolute path`)
      }
      if (hasTraversalSegments(cwd)) {
        throw new CapabilityError('bad-request', 'cwd must not contain "." or ".." segments')
      }
      refresh()
      // Containment goes through isWithin's own separator/case normalization
      // on the literal path — no host-dependent resolve() step, so the
      // Windows branch is exercisable from any development host.
      if (!roots.some(root => isWithin(root, cwd, platform))) {
        throw new CapabilityError(
          'forbidden',
          `cwd "${normalizeRoot(cwd)}" is not a registered workspace or active session directory`,
          403,
        )
      }
    },
  }
}
