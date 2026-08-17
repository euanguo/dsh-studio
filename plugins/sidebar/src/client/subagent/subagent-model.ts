/**
 * Pure subagent/jobs model helpers for the Subagent panel: topology tree
 * building, auto-open decisions and job row selection. Everything here is
 * snapshot math — no React, no services — so the unit tests cover the
 * decisions without mounting the panel.
 */
import type {
  SessionListState,
  SessionSummary,
  SidebarJobView,
} from '../client-types.ts'

/** One topology node: a session (root or child) with its direct children. */
export interface SubagentTreeNode {
  session: SessionSummary & { id: string }
  /** Direct children (their `parentId` points at this node's session id). */
  children: SubagentTreeNode[]
}

/**
 * Build the subagent topology forest from the sessions list snapshot:
 * sessions carrying `origin: 'subagent'` / a `parentId` are grouped under
 * their durable direct parent (present in `byId` or not — a missing parent
 * yields an orphan child under an implicit parent row). Root sessions sort
 * first, then children depth-first; each level keeps the feed order.
 */
export function buildSubagentTree(list: SessionListState): SubagentTreeNode[] {
  const byId = list.byId
  // First pass: collect every child id under its durable parent (feed order).
  const childrenByParent = new Map<string, string[]>()
  for (const [id, summary] of Object.entries(byId)) {
    const parentId = summary.parentId
    if (parentId === undefined || parentId === '') continue
    const existing = childrenByParent.get(parentId)
    if (existing === undefined) childrenByParent.set(parentId, [id])
    else existing.push(id)
  }
  // Nodes reference the FINAL child arrays (built lazily from the map), so
  // a child's own children are never stale.
  const nodeOf = (id: string): SubagentTreeNode => ({
    session: { ...(byId[id] ?? {}), id } as SessionSummary & { id: string },
    children: (childrenByParent.get(id) ?? []).map(nodeOf),
  })
  // Roots: sessions without a parent, or whose parent is not in the feed
  // (an orphan stays visible instead of vanishing).
  const roots: SubagentTreeNode[] = []
  const emitted = new Set<string>()
  for (const [id, summary] of Object.entries(byId)) {
    const parentId = summary.parentId
    if (parentId !== undefined && parentId !== '' && Object.hasOwn(byId, parentId)) continue
    if (emitted.has(id)) continue
    emitted.add(id)
    roots.push(nodeOf(id))
  }
  return roots
}

/** The auto-open decision after one sessions snapshot change. */
export type SubagentAutoOpen = 'subagent' | 'jobs' | null

/**
 * Decide whether the sidebar should auto-activate (and land on the subagent
 * page / jobs section) after a snapshot change:
 * - a NEW direct subagent child of the CURRENT session (a `parentId` that
 *   was absent before) → 'subagent';
 * - a NEW job id for the CURRENT session (absent before) → 'jobs';
 * - otherwise null. The prefs gate each kind independently.
 */
export function subagentAutoOpenDecision(
  previous: SessionListState,
  next: SessionListState,
  prefs: { autoOpenSubagent: boolean; autoOpenJobs: boolean },
): SubagentAutoOpen {
  const current = next.current
  if (current === undefined) return null
  if (prefs.autoOpenSubagent) {
    const previousChildren = new Set(
      Object.entries(previous.byId)
        .filter(([, summary]) => summary.parentId === current)
        .map(([id]) => id),
    )
    const hasNewChild = Object.entries(next.byId)
      .some(([id, summary]) => summary.parentId === current && !previousChildren.has(id))
    if (hasNewChild) return 'subagent'
  }
  if (prefs.autoOpenJobs) {
    const previousJobs = new Set((previous.jobsBySession?.[current] ?? []).map(job => job.id))
    const hasNewJob = (next.jobsBySession?.[current] ?? [])
      .some(job => !previousJobs.has(job.id))
    if (hasNewJob) return 'jobs'
  }
  return null
}

/** The job rows of one session, newest first (stable within a tick). */
export function jobRowsFor(
  jobsBySession: Readonly<Record<string, readonly SidebarJobView[]>> | undefined,
  sessionId: string,
): readonly SidebarJobView[] {
  const rows = jobsBySession?.[sessionId] ?? []
  return [...rows].sort((left, right) => right.startedAt - left.startedAt)
}