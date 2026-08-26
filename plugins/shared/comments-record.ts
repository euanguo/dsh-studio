/**
 * Single owner of the durable `comments` ui-chrome record. The table stores
 * ONE whole document with two halves (workbench line comments + git-review
 * comments); two independent writer modules used to hold their own stale
 * copy of the other half and erase each other's rows on every save. Every
 * read/write now funnels through this module's cache, so a half-update
 * always rides on the freshest known other-half.
 *
 * Format generations (`COMMENTS_RECORD_VERSION`):
 * - v1 — legacy localStorage workbench blobs keyed `filePath`/`line`;
 * - v2 — domain table with flat `{ workbench, review }` arrays;
 * - v3 — v2 plus: workbench rows carry an explicit cwd scope, review rows are
 *   addressed by their workspace×branch bucket ({@linkcode reviewScopeKey}),
 *   legacy v1 field names folded at load, and the single Q4 cap
 *   ({@linkcode COMMENTS_SANITIZE_LIMIT}). Migration is
 *   READ-TIME (fold → sanitize), idempotent, non-destructive: nothing is
 *   rewritten until the next ordinary half-write, and re-running the
 *   migration on already-migrated data is a fixpoint.
 */
import { createUiChromeStorage } from './ui-chrome-storage.ts'
import {
  defaultSidebarCommentsChrome,
  sanitizeSidebarComments,
  UI_CHROME_TABLES,
  type PersistedReviewComment,
  type PersistedWorkbenchComment,
  type SidebarCommentsChrome,
} from './ui-chrome-tables.ts'

/** Current format generation of the persisted record (see module header). */
export const COMMENTS_RECORD_VERSION = 3

/**
 * Bucket address of one review comment group: the workspace root and the
 * checked-out branch it was written against. Buckets are derived vocabulary
 * over the same rows — the wire format stays one flat array.
 */
const LEGACY_WORKBENCH_SCOPE_KEY = '\u0000legacy-workbench'

/** Address a workbench comment by its owning workspace. */
export function workbenchScopeKey(cwd: string | null | undefined): string {
  return cwd ?? LEGACY_WORKBENCH_SCOPE_KEY
}

/**
 * Group workbench rows into cwd buckets (insertion order preserved within and
 * across buckets). Rows without a cwd stay in a dedicated legacy bucket until
 * a user edits or removes them; they are never assigned to an arbitrary cwd.
 */
export function groupWorkbenchCommentsByScope(
  workbench: readonly PersistedWorkbenchComment[],
): Map<string, PersistedWorkbenchComment[]> {
  const buckets = new Map<string, PersistedWorkbenchComment[]>()
  for (const comment of workbench) {
    const key = workbenchScopeKey(comment.cwd)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [comment])
    else bucket.push(comment)
  }
  return buckets
}

export function reviewScopeKey(workspacePath: string, branch: string): string {
  return `${workspacePath}\u0000${branch}`
}

/**
 * Group review rows into their workspace×branch buckets (insertion order
 * preserved within and across buckets).
 */
export function groupReviewCommentsByScope(
  review: readonly PersistedReviewComment[],
): Map<string, PersistedReviewComment[]> {
  const buckets = new Map<string, PersistedReviewComment[]>()
  for (const comment of review) {
    const key = reviewScopeKey(comment.workspacePath, comment.branch)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [comment])
    else bucket.push(comment)
  }
  return buckets
}

/** Fold one legacy v1 workbench entry's `filePath`/`line` names forward. */
function foldLegacyWorkbenchEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const needsPath = typeof entry.path !== 'string'
  const needsStartLine = typeof entry.startLine !== 'number'
  const needsCwd = entry.cwd !== null && typeof entry.cwd !== 'string'
  if (!needsPath && !needsStartLine && !needsCwd) return entry
  return {
    ...entry,
    ...(needsPath && typeof entry.filePath === 'string' ? { path: entry.filePath } : {}),
    ...(needsStartLine && typeof entry.line === 'number' ? { startLine: entry.line } : {}),
    ...(needsCwd ? { cwd: null } : {}),
  }
}

/**
 * Read-time migration to the current generation: folds legacy v1 workbench
 * entries, then applies the release sanitizer (field guards + Q4 cap).
 * Pure and idempotent — `migrate(migrate(x))` deep-equals `migrate(x)`.
 */
export function migratePersistedCommentsRecord(raw: unknown): SidebarCommentsChrome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return sanitizeSidebarComments(raw)
  }
  const record = raw as Record<string, unknown>
  const workbench = Array.isArray(record.workbench)
    ? record.workbench.map(entry =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry)
          ? foldLegacyWorkbenchEntry(entry as Record<string, unknown>)
          : entry)
    : record.workbench
  return sanitizeSidebarComments({ ...record, workbench })
}

export const commentsStorage = createUiChromeStorage<SidebarCommentsChrome>({
  table: UI_CHROME_TABLES.comments,
  defaults: defaultSidebarCommentsChrome,
  // Every load routes through the version migration so a record written by
  // any older client normalizes before it reaches the cache.
  sanitize: migratePersistedCommentsRecord,
})

let record: SidebarCommentsChrome | undefined

function clone(value: SidebarCommentsChrome): SidebarCommentsChrome {
  return {
    workbench: [...value.workbench],
    review: [...value.review],
  }
}

/**
 * Load the full record once per session (subsequent reads hit the cache).
 * Throws when the domain is unreachable so callers never mistake "down" for
 * "empty" and write defaults over intact host data.
 */
export async function loadCommentsRecord(): Promise<SidebarCommentsChrome> {
  if (record !== undefined) return clone(record)
  const value = await commentsStorage.load()
  if (commentsStorage.availability() === 'unavailable') {
    throw new Error('comments table is unreachable')
  }
  record = value
  return clone(value)
}

/** The freshest known record (defaults before the first successful load). */
export function readCommentsRecord(): SidebarCommentsChrome {
  return clone(record ?? defaultSidebarCommentsChrome())
}

/** Adopt a full record obtained outside the normal load path (hydration). */
export function adoptCommentsRecord(value: SidebarCommentsChrome): void {
  record = clone(value)
}

/** Replace the workbench half, preserving the freshest review half. */
export async function putWorkbenchComments(
  workbench: readonly PersistedWorkbenchComment[],
): Promise<void> {
  await loadCommentsRecord()
  const normalized = workbench.map(comment => ({ ...comment, cwd: comment.cwd ?? null }))
  const next = { ...readCommentsRecord(), workbench: normalized }
  record = next
  commentsStorage.save(clone(next))
}

/**
 * Replace the review half from its workspace×branch buckets, preserving the
 * freshest workbench half. The bucket map is the authoritative whole-half
 * snapshot (flattening it must reproduce every row), so emptied buckets are
 * expressed as empty arrays and removed rows never survive a save. Passing
 * the same buckets twice writes identical bytes — idempotent.
 */
export async function putReviewCommentsByScope(
  groups: ReadonlyMap<string, readonly PersistedReviewComment[]>,
): Promise<void> {
  await loadCommentsRecord()
  const review: PersistedReviewComment[] = []
  for (const rows of groups.values()) review.push(...rows)
  const next = { ...readCommentsRecord(), review }
  record = next
  commentsStorage.save(clone(next))
}
