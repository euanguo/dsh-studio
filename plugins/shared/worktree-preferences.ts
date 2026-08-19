/**
 * WorkTree location vocabulary shared by BOTH halves:
 *   - the host (sidebar-host) resolves the effective store root from the
 *     left-rail settings namespace plus the DSH Studio data root, and
 *   - the client (desktop-left-rail) derives the per-creation default path
 *     from the host-resolved root.
 *
 * Naming follows the Orca reference (src/main/ipc/worktree-logic.ts): a
 * Unicode-preserving slug, optional repo-name nesting under the store root
 * (`{root}/{repoName}/{name}` vs `{root}/{name}`). Pure string operations
 * only — this module loads in browser bundles (node:path is unavailable).
 */
import { joinPath, normalizePath } from './path.ts'
import {
  DSH_STUDIO_CHANNEL_ENV,
  DSH_STUDIO_DEV_CHANNEL,
  DSH_STUDIO_HOME_ENV,
  dshStudioHomeDirectoryName,
} from './data-root-names.ts'

/** Directory name under the DSH Studio data root holding linked worktrees. */
export const WORKTREE_STORE_DIR_NAME = 'worktrees'

/** Fallback directory name when a branch/name slugifies to nothing. */
export const WORKTREE_NAME_FALLBACK = 'new'

/**
 * Whether a value is an absolute path on any supported platform: POSIX
 * (`/…`), Windows drive (`C:\…` / `C:/…`), or UNC (`\\…`).
 */
function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/')
    || value.startsWith('\\')
    || /^[A-Za-z]:[\\/]/.test(value)
}

/**
 * Sanitize a user-supplied worktree store directory: trimmed, separator-
 * normalized, trailing slashes stripped. Rejects relative paths and
 * non-strings with undefined (relative roots are ambiguous across the
 * host/renderer split — the default and the custom override are both
 * absolute host paths).
 */
export function sanitizeWorktreeDir(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const normalized = normalizePath(trimmed)
  if (!isAbsolutePathLike(normalized)) return undefined
  return normalized
}

/**
 * Slugify a worktree name (branch name or free text) into a safe directory
 * segment. Orca's rule (worktree-logic.ts sanitizeWorktreeName): keep
 * Unicode letters/numbers plus `._-` (CJK names survive), fold every other
 * run to one `-`, collapse `..` (git check-ref-format), trim leading and
 * trailing separators. Returns '' when nothing survives.
 */
export function slugifyWorktreeName(input: string): string {
  const sanitized = input
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
  return sanitized === '.' || sanitized === '..' ? '' : sanitized
}

/** Inputs of {@link computeWorktreeLocation}. */
export interface WorktreeLocationInput {
  /** Store root (already the effective one: user override or data-root default). */
  readonly root: string
  /** Nest under a repo-name subfolder (Orca `nestWorkspaces`; default true). */
  readonly nest: boolean
  /** Repository root path (the main worktree / repo identity). */
  readonly repoRoot: string
  /** Worktree name (branch or free text); empty slug falls back to 'new'. */
  readonly name: string
}

/**
 * Compute the default filesystem location for one new worktree, the single
 * naming rule shared by the dialog's auto-fill and its placeholder:
 *   nest  → `{root}/{repoName}/{name}`
 *   flat  → `{root}/{name}`
 * where repoName is the repo root's basename minus a `.git` suffix and name
 * is the Orca-style slug (fallback `new`).
 */
export function computeWorktreeLocation(input: WorktreeLocationInput): string {
  const segment = slugifyWorktreeName(input.name)
  const name = segment === '' ? WORKTREE_NAME_FALLBACK : segment
  if (!input.nest) return joinPath(input.root, name)
  const repoName = normalizePath(input.repoRoot).split('/').filter(part => part !== '').pop()
  const cleanRepo = repoName === undefined ? '' : repoName.replace(/\.git$/, '')
  if (cleanRepo === '' || slugifyWorktreeName(cleanRepo) === '') return joinPath(input.root, name)
  return joinPath(input.root, slugifyWorktreeName(cleanRepo), name)
}

/**
 * Resolve the DEFAULT worktree store root: the DSH Studio data root (env
 * override honored — every launcher exports it) plus the `worktrees`
 * segment. `fallbackHome` is the host-computed user home used only when the
 * env override is absent (a bare `dsh --profile` launch); the dev-channel
 * sibling pair is honored there via the shared channel name.
 */
export function resolveDefaultWorktreeRoot(
  env: Readonly<Record<string, string | undefined>>,
  fallbackHome: string,
): string {
  const override = env[DSH_STUDIO_HOME_ENV]?.trim()
  if (override !== undefined && override !== '') {
    return joinPath(sanitizeWorktreeDir(override) ?? normalizePath(override), WORKTREE_STORE_DIR_NAME)
  }
  const channel = env[DSH_STUDIO_CHANNEL_ENV]?.trim() === DSH_STUDIO_DEV_CHANNEL
    ? DSH_STUDIO_DEV_CHANNEL
    : undefined
  const home = joinPath(fallbackHome, dshStudioHomeDirectoryName(channel ?? 'stable'))
  return joinPath(home, WORKTREE_STORE_DIR_NAME)
}

/** Host response of `git.worktree-defaults`: the resolution the dialog consumes. */
export interface WorktreeDefaultsResult {
  /** Effective store root (user override when valid, else the data-root default). */
  readonly root: string
  /** Whether new worktrees nest under a repo-name subfolder. */
  readonly nest: boolean
  /** True when a valid user override produced `root` (false = data-root default). */
  readonly custom: boolean
}
