/**
 * One-time idempotent migration of the three legacy line-comment
 * localStorage keys into the domain-backed `comments` ui-chrome table
 * (F1/F2/M7). Workbench comments lived at `dsh-studio.sidebar.diff-comments.v2`
 * (with a `.v1` legacy source) and review comments at
 * `dsh-studio.sidebar.review-comments.v1`.
 *
 * Migration discipline:
 * - ONLY writes when the new table is EMPTY (both arrays empty), so a user
 *   who already has domain data (or re-runs) never has it clobbered.
 * - Reads the workbench v2 blob (which already carried its own v1 fold-in)
 *   and falls back to v1 when v2 is absent.
 * - DOES NOT delete the legacy keys — they are left in place as an audit
 *   trail for one release cycle, per the repo's non-destructive migration
 *   rule.
 */
import {
  defaultSidebarCommentsChrome,
  sanitizeSidebarComments,
  UI_CHROME_TABLES,
  type PersistedReviewComment,
  type PersistedWorkbenchComment,
  type SidebarCommentsChrome,
} from './ui-chrome-tables.ts'
import { callCapabilitiesGlobalApi } from './contracts/capabilities-api.ts'

const WORKBENCH_V2_KEY = 'dsh-studio.sidebar.diff-comments.v2'
const WORKBENCH_V1_KEY = 'dsh-studio.sidebar.diff-comments.v1'
const REVIEW_KEY = 'dsh-studio.sidebar.review-comments.v1'

interface LegacyWorkbenchComment {
  id?: unknown
  path?: unknown
  filePath?: unknown // v1 field
  startLine?: unknown
  line?: unknown // v1 field
  endLine?: unknown
  contentHash?: unknown
  branch?: unknown
  body?: unknown
  createdAt?: unknown
  resolvedAt?: unknown
}

interface LegacyReviewComment {
  id?: unknown
  workspacePath?: unknown
  branch?: unknown
  commitId?: unknown
  filePath?: unknown
  line?: unknown
  side?: unknown
  body?: unknown
  createdAt?: unknown
  resolvedAt?: unknown
  request?: unknown
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === 'object' && !Array.isArray(item)) : []
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function readWorkbenchV2(): Record<string, unknown>[] | undefined {
  return readJson(WORKBENCH_V2_KEY)
}

function readWorkbenchV1(): Record<string, unknown>[] | undefined {
  return readJson(WORKBENCH_V1_KEY)
}

function readReview(): Record<string, unknown>[] | undefined {
  return readJson(REVIEW_KEY)
}

function readJson(key: string): Record<string, unknown>[] | undefined {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return undefined
    return asArray(JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

/** True when the persisted table holds any comments already. */
function tablesHasData(comments: SidebarCommentsChrome): boolean {
  return comments.workbench.length > 0 || comments.review.length > 0
}

/** Fold the legacy JSON blobs into a SidebarCommentsChrome. */
export function migrateCommentsFromLegacy(
  workbenchV2?: readonly Record<string, unknown>[],
  workbenchV1?: readonly Record<string, unknown>[],
  review?: readonly Record<string, unknown>[],
): SidebarCommentsChrome {
  const workbench: PersistedWorkbenchComment[] = []
  // Prefer the v2 shape (already folded v1 in); fall back to plain v1.
  const primary = workbenchV2 !== undefined && workbenchV2.length > 0
    ? workbenchV2
    : workbenchV1
  for (const entry of primary ?? []) {
    const body = str(entry.body)
    const createdAt = str(entry.createdAt)
    const id = str(entry.id)
    if (id === undefined || body === undefined || createdAt === undefined) continue
    const path = str(entry.path) ?? str(entry.filePath)
    const startLine = typeof entry.startLine === 'number'
      ? entry.startLine
      : (typeof entry.line === 'number' ? entry.line : undefined)
    if (path === undefined || startLine === undefined || !Number.isInteger(startLine)) continue
    workbench.push({
      id,
      path,
      startLine,
      ...(Number.isInteger(entry.endLine) ? { endLine: entry.endLine as number } : {}),
      ...(str(entry.contentHash) !== undefined ? { contentHash: entry.contentHash as string } : {}),
      ...(entry.branch === null || str(entry.branch) !== undefined
        ? { branch: entry.branch as string | null }
        : {}),
      body,
      createdAt,
      ...(str(entry.resolvedAt) !== undefined ? { resolvedAt: entry.resolvedAt as string } : {}),
    })
  }
  const reviewComments: PersistedReviewComment[] = []
  for (const entry of review ?? []) {
    const body = str(entry.body)
    const createdAt = str(entry.createdAt)
    const id = str(entry.id)
    const workspacePath = str(entry.workspacePath)
    const branch = str(entry.branch)
    const commitId = str(entry.commitId)
    const request = str(entry.request)
    if (id === undefined || body === undefined || createdAt === undefined
      || workspacePath === undefined || branch === undefined
      || commitId === undefined || request === undefined) continue
    const side = entry.side === 'new' || entry.side === 'old' ? entry.side : null
    const line = typeof entry.line === 'number' && Number.isInteger(entry.line) && Number(entry.line) > 0
      ? entry.line
      : null
    reviewComments.push({
      id,
      workspacePath,
      branch,
      commitId,
      filePath: typeof entry.filePath === 'string' ? entry.filePath : null,
      line,
      side,
      body,
      createdAt,
      ...(str(entry.resolvedAt) !== undefined ? { resolvedAt: entry.resolvedAt as string } : {}),
      request,
    })
  }
  return { workbench, review: reviewComments }
}

/**
 * Run the migration against the capabilities ui-chrome domain. Call once at
 * plugin bootstrap before surfaces read comments. Legacy keys are kept.
 */
export async function migrateLegacyCommentsIntoDomain(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
  try {
    // Read through the raw RPC so a transport failure stays distinguishable
    // from an empty table: `storage.load()` would return defaults here, and
    // writing the legacy blob over unknown host state could destroy comments
    // that are merely unreachable right now.
    let current: SidebarCommentsChrome | undefined
    try {
      const envelope = await callCapabilitiesGlobalApi<{ value?: unknown }>(
        'ui-chrome.get',
        { table: UI_CHROME_TABLES.comments },
      )
      current = sanitizeSidebarComments(envelope?.value)
    } catch {
      return // domain unreachable — retry on the next boot, never write blind
    }
    if (tablesHasData(current)) return // already migrated / has domain data
    const migrated = migrateCommentsFromLegacy(
      readWorkbenchV2(),
      readWorkbenchV1(),
      readReview(),
    )
    const hasLegacy = migrated.workbench.length > 0 || migrated.review.length > 0
    if (!hasLegacy) return
    await callCapabilitiesGlobalApi<{ value?: unknown }>(
      'ui-chrome.put',
      { table: UI_CHROME_TABLES.comments, value: sanitizeSidebarComments(migrated) },
    )
  } catch {
    // Migration is best-effort: surfaces read defaults if the domain is down.
  }
}