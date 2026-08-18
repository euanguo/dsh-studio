/**
 * Derives the workspace browser tree from Host Workspace order and membership.
 * Unassigned Sessions trail under Ungrouped; only the selected blank Session
 * remains visible.
 */
import { indexSubagentDescendants, type SubagentDescendantSummary } from './subagent-lineage.ts'
import type {
  PendingInteractionStatus, SessionId, SessionListState,
  SessionSearchResultItem, SessionSummary, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Group key for Sessions outside every Workspace. */
export const UNGROUPED_KEY = ''

/* ------------------------------------------------------------------------- *
 * Expansion-key namespaces (P3: view-state keys are prefixed so workspace
 * ids, repo roots and worktree paths can never collide in one dictionary).
 * ------------------------------------------------------------------------- */

/** Expansion-key namespace for the ungrouped session bucket. */
export const UNGROUPED_EXPANSION_KEY = 'ungrouped'
/** Expansion key of one real Workspace group. */
export const workspaceExpansionKey = (workspaceId: string): string => `ws:${workspaceId}`
/** Expansion key of one project row (repo root or bare directory). */
export const repoExpansionKey = (repoRoot: string): string => `repo:${repoRoot}`
/** Expansion key of one worktree row (absolute path). */
export const worktreeExpansionKey = (path: string): string => `wt:${path}`

/** The expansion-key account of one group key (workspace id or ungrouped). */
export function groupExpansionKeyOf(groupKey: string): string {
  return groupKey === UNGROUPED_KEY ? UNGROUPED_EXPANSION_KEY : workspaceExpansionKey(groupKey)
}

/** Display label for the ungrouped bucket row. */
export const UNGROUPED_LABEL = 'Ungrouped'

/** One top-level session row in a group or the flat list. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  updatedAt: number
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id or {@link UNGROUPED_KEY}. */
  key: string
  /** Backing Workspace id; absent only for the ungrouped bucket. */
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  /** Workspace creation time (epoch ms); absent only for the ungrouped bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible sessions in the group. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible session rows (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  title: string
  workspace: string
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for Sessions without a backing Workspace account. */
  ungroupedOrder?: readonly string[]
}

/* ------------------------------------------------------------------------- *
 * Project → WorkTree → Session derivation (the desktop three-level tree).
 * ------------------------------------------------------------------------- */

/** The fixed, non-removable catch-all tab id (non-git dirs + ungrouped). */
export const DEFAULT_GROUP_ID = '__default__'

/** One named group tab in the horizontal strip. */
export interface GroupTab {
  id: string
  /** Display label; absent for the pinned default tab (the renderer localizes it). */
  label?: string
  /** The built-in catch-all tab (cannot be renamed/removed). */
  pinned: boolean
}

/** One project icon resolved by the rail model. */
export interface ProjectIconNode {
  /** Automatic source or explicit user override. */
  source: 'override' | 'local-png' | 'entry-declaration' | 'homepage-favicon' | 'git-provider-avatar' | 'fallback'
  /** Built-in glyph name or a validated image/data URL. */
  value: string
  /** Stable fallback kind when `value` cannot be rendered. */
  fallback: 'project' | 'directory'
}

/** One worktree row: a linked worktree (or the sole dir of a non-git project). */
export interface WorktreeNode {
  key: string
  /** Absolute path of the worktree. */
  path: string
  /** Directory basename. */
  label: string
  /** Short branch name; null when detached or a non-git directory. */
  branch: string | null
  /** Whether this is a real Git Worktree; false/absent means synthetic directory. */
  isGit?: boolean
  /** The repository's main worktree (repo root). */
  main: boolean
  /**
   * DSH workspaces whose cwd lives inside this worktree (host identities in
   * workspace order; actions must address every member, not just one).
   */
  workspaceIds: readonly WorkspaceId[]
  /** All sessions colonized under this worktree (the renderer crops to five when collapsed). */
  sessions: readonly SessionNode[]
  /** Total visible sessions before collapse. */
  sessionCount: number
  expanded: boolean
  containsCurrent: boolean
}

/** One project row: a repository (or a bare non-git directory) grouping worktrees. */
export interface ProjectNode {
  key: string
  /** Repo root for git projects, else the directory path itself. */
  repoRoot: string
  label: string
  isGit: boolean
  /** Project-level icon shared by all of its worktrees. */
  icon?: ProjectIconNode
  /** Short branch of the main worktree (null for non-git projects). */
  mainBranch: string | null
  worktrees: readonly WorktreeNode[]
  worktreeCount: number
  expanded: boolean
  containsCurrent: boolean
}

/** The complete tabbed project tree. */
export interface ProjectTree {
  tabs: readonly GroupTab[]
  activeTab: string
  /** Projects filtered to the active tab. */
  projects: readonly ProjectNode[]
  /** Every project (unfiltered), for cross-tab lookups. */
  allProjects: readonly ProjectNode[]
}

/** Worktree layout lookup result for one workspace cwd. */
export interface WorktreeLayoutMap {
  /** null = confirmed non-git; undefined = unavailable or not observed. */
  get(cwd: string): GitWorktreeLayout | null | undefined
  /** Freshness-aware fact when the adapter can provide one. */
  getFact?(cwd: string): WorktreeFactState | undefined
}

/** Freshness-aware result of one Host worktree lookup. */
export type WorktreeFactState =
  | { status: 'ready'; layout: GitWorktreeLayout | null }
  | { status: 'loading'; lastKnown?: GitWorktreeLayout }
  | { status: 'error'; lastKnown?: GitWorktreeLayout; error: string }

/** Placeholder — replaced by the concrete git module contract. */
export interface GitWorktreeLayout {
  repoRoot: string
  worktrees: readonly { path: string; head: string | null; branch: string | null; main: boolean }[]
}

/** What the active-tab filter + group assignment need from the view store. */
export interface ProjectTreeView {
  expanded: readonly string[]
  activeTab: string
  /** repoRoot → group id (projects absent here live in the default tab). */
  projectGroup: Readonly<Record<string, string>>
  /** Ordered user group ids (the default tab is implicit). */
  groupIds: readonly string[]
  groupLabels: Readonly<Record<string, string>>
  /** repoRoot → user alias (display name overriding the basename). */
  projectAlias: Readonly<Record<string, string>>
}

interface Group {
  key: string
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or the ungrouped label.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return UNGROUPED_LABEL
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base !== undefined && base !== '' ? base : cwd
}

/** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Ordinary sessions are visible; among blank sessions, only the current one
 * is visible. Subagent children use their parent header catalog; archived
 * sessions are visible nowhere, while their accounting slots remain so
 * unarchiving restores position.
 */
function sessionVisible(session: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return session.origin !== 'subagent'
    && !archived.has(session.id)
    && (!session.blank || session.id === current)
}

/**
 * A blank session is the selected Workspace's provisional New Session row;
 * its canonical title never enters search (blank rows are query-excluded)
 * and the renderer localizes its display label.
 */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? 'New Session' : session.displayTitle
}

/** Build one group without projecting session lineage into presentation. */
function buildGroup(
  key: string,
  workspaceId: WorkspaceId | undefined,
  cwd: string | undefined,
  createdAt: number | undefined,
  label: string,
  members: readonly SessionSummary[],
  order: 'account' | 'recency',
): Group {
  const sessions = [...members]
  // Real Workspace order comes from sessionIds. Ungrouped falls back to
  // recency until the browser supplies its persisted local order.
  if (order === 'recency') sessions.sort(byRecency)
  return { key, workspaceId, cwd, createdAt, label, sessions }
}

/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
function orderedUngrouped(members: readonly SessionSummary[], stored: readonly string[]): SessionSummary[] {
  const byId = new Map(members.map(session => [session.id as string, session]))
  const included = new Set<string>()
  const ordered: SessionSummary[] = []
  for (const key of stored) {
    const session = byId.get(key)
    if (session === undefined || included.has(key)) continue
    ordered.push(session)
    included.add(key)
  }
  for (const session of [...members].sort(byRecency)) {
    if (included.has(session.id)) continue
    ordered.push(session)
  }
  return ordered
}

/**
 * Group Sessions by Host Workspace: one group per entity in stable Host
 * order, with members resolved from sessionIds in their stored order. Sessions
 * outside every Workspace trail in the browser-local Ungrouped order, which
 * falls back to recency before that order is initialized.
 */
function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<SessionId>,
  ungroupedOrder: readonly string[] | undefined,
): Group[] {
  const groups: Group[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue // account may lead the list pull; the row appears when the summary lands
      accounted.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    groups.push(buildGroup(
      workspace.workspaceId, workspace.workspaceId, workspace.path,
      Date.parse(workspace.createdAt), workspace.title, members, 'account',
    ))
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter((s): s is SessionSummary =>
      s !== undefined && !accounted.has(s.id) && sessionVisible(s, list.current, archived))
  if (stray.length > 0) {
    groups.push(buildGroup(
      UNGROUPED_KEY,
      undefined,
      undefined,
      undefined,
      UNGROUPED_LABEL,
      ungroupedOrder === undefined ? stray : orderedUngrouped(stray, ungroupedOrder),
      ungroupedOrder === undefined ? 'recency' : 'account',
    ))
  }
  return groups
}

function sessionNode(
  s: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
): SessionNode {
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: s.running,
    runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
    completed: s.completed === true,
    updatedAt: s.updatedAt,
    ...(s.pendingInteraction === undefined ? {} : { pendingInteraction: s.pendingInteraction }),
  }
}

/**
 * Derive the workspace browser groups with every session as a top-level row.
 *
 * Every group shows; sessions populate under expanded groups in the selected
 * local order. Blank sessions are excluded except for the selected
 * provisional New Session row; archived sessions are excluded everywhere.
 * Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param view - local expansion arrays.
 * @returns group sections in render order.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  view: TreeView,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const currentGroup = list.current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(list.current as SessionId))?.workspaceId as string | undefined)
        ?? UNGROUPED_KEY
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {
    const expanded = expandedGroups.has(groupExpansionKeyOf(g.key))
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded ? g.sessions.map(session => sessionNode(session, descendants)) : [],
    })
  }
  return groups
}

/**
 * Derive the tabbed project → worktree → session tree.
 *
 * Each workspace carries a cwd; the worktree layouts (fetched per cwd) group
 * git worktrees under their repo root (project) and turn every non-git cwd
 * into a single-worktree project. Sessions trail under the worktree whose
 * workspace owns them. The pinned default tab collects projects without an
 * explicit group plus every non-git directory.
 * @param list - sessions snapshot.
 * @param workspaces - real workspaces in stable Host order.
 * @param layouts - cwd → worktree layout (null for non-git).
 * @param archivedSessionIds - registry-global archive set.
 * @param view - tab/expanded/group-assignment view state.
 */
export function deriveProjectTree(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  layouts: WorktreeLayoutMap,
  archivedSessionIds: readonly SessionId[],
  view: ProjectTreeView,
  projectIcons?: ReadonlyMap<string, ProjectIconNode>,
): ProjectTree {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const expanded = new Set(view.expanded)
  const current = list.current
  const layoutOf = (cwd: string): GitWorktreeLayout | null | undefined => layouts.get(cwd)

  // Layout cache per repo root (any workspace of the repo carries the same set).
  const layoutByRoot = new Map<string, GitWorktreeLayout>()
  for (const workspace of workspaces) {
    const layout = layoutOf(workspace.path)
    if (layout !== null && layout !== undefined) layoutByRoot.set(layout.repoRoot, layout)
  }

  interface WT {
    path: string
    label: string
    branch: string | null
    main: boolean
    workspaceIds: WorkspaceId[]
    members: SessionSummary[]
  }

  // Longest-prefix worktree match (a workspace may live in a worktree subdir).
  const worktreeOf = (wts: readonly WT[], cwd: string): WT | undefined => {
    let best: WT | undefined
    for (const wt of wts) {
      if (cwd === wt.path || cwd.startsWith(`${wt.path}/`)) {
        if (best === undefined || wt.path.length > best.path.length) best = wt
      }
    }
    return best
  }

  const join = (workspace: WorkspaceView): SessionSummary[] => {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary !== undefined && sessionVisible(summary, current, archived)) members.push(summary)
    }
    return members
  }

  // Project rows: git repos keyed by repoRoot, non-git by cwd (first-appearance order).
  interface Proj { key: string; repoRoot: string; isGit: boolean; workspaceIds: WorkspaceId[] }
  const projectsById = new Map<string, Proj>()
  const order: string[] = []
  for (const workspace of workspaces) {
    const layout = layoutOf(workspace.path)
    const isGit = layout !== null && layout !== undefined && layout.worktrees.length > 0
    const key = isGit ? layout!.repoRoot : workspace.path
    const entry = projectsById.get(key) ?? { key, repoRoot: isGit ? layout!.repoRoot : workspace.path, isGit, workspaceIds: [] }
    if (entry.workspaceIds.length === 0) order.push(key)
    entry.workspaceIds.push(workspace.workspaceId)
    projectsById.set(key, entry)
  }

  const allProjects: ProjectNode[] = order.map((key) => {
    const proj = projectsById.get(key)!
    const layout = proj.isGit ? layoutByRoot.get(key) : undefined
    let wts: WT[]
    if (layout === undefined) {
      // Non-git dir: a single synthetic worktree, members from its workspace.
      // `main: false` — the "main" marker is a git concept and a bare
      // directory must not advertise it (the renderer shows the badge only
      // for git worktrees).
      const workspace = workspaces.find(w => w.path === key)
      wts = [{
        path: key, label: workspaceLabel(key), branch: null, main: false,
        workspaceIds: workspace === undefined ? [] : [workspace.workspaceId],
        members: workspace === undefined ? [] : join(workspace),
      }]
    } else {
      wts = layout.worktrees.map(wt => ({
        path: wt.path, label: workspaceLabel(wt.path), branch: wt.branch, main: wt.main,
        workspaceIds: [], members: [],
      }))
      for (const workspace of workspaces) {
        const l = layoutOf(workspace.path)
        if (l === null || l === undefined || l.repoRoot !== key) continue
        const bucket = worktreeOf(wts, workspace.path)
        if (bucket !== undefined) {
          // Every workspace whose cwd lives under this worktree joins the
          // row: members accumulate and the identity list grows, so row
          // actions address the full set instead of the last workspace.
          bucket.workspaceIds.push(workspace.workspaceId)
          bucket.members.push(...join(workspace))
        }
      }
    }
    const containsCurrent = wts.some(wt => wt.members.some(m => m.id === current))
    return {
      key, repoRoot: proj.repoRoot, label: view.projectAlias[proj.repoRoot] ?? workspaceLabel(proj.repoRoot), isGit: proj.isGit,
      icon: projectIcons?.get(key) ?? {
        source: 'fallback',
        value: proj.isGit ? 'project' : 'directory',
        fallback: proj.isGit ? 'project' : 'directory',
      },
      mainBranch: wts[0]?.branch ?? null,
      worktrees: wts.map(wt => ({
        key: wt.path, path: wt.path, label: wt.label, branch: wt.branch, isGit: proj.isGit, main: wt.main,
        workspaceIds: wt.workspaceIds,
        // Sessions always carry the full member list; the renderer decides
        // the collapsed preview (first five) vs the full expanded run.
        sessions: wt.members.map(m => sessionNode(m, descendants)),
        sessionCount: wt.members.length,
        expanded: expanded.has(worktreeExpansionKey(wt.path)),
        containsCurrent: wt.members.some(m => m.id === current),
      })),
      worktreeCount: wts.length,
      expanded: expanded.has(repoExpansionKey(key)),
      containsCurrent,
    }
  })

  // Tabs: pinned default first, then user groups in stored order. The pinned
  // tab carries no label — the renderer localizes it (t('tab.default')).
  const tabs: GroupTab[] = [{ id: DEFAULT_GROUP_ID, pinned: true }]
  for (const id of view.groupIds) {
    if (id === DEFAULT_GROUP_ID) continue
    tabs.push({ id, label: view.groupLabels[id] ?? id, pinned: false })
  }
  const activeTab = tabs.some(tab => tab.id === view.activeTab) ? view.activeTab : DEFAULT_GROUP_ID

  // A project assigned to a group that no longer exists (settings drift or a
  // half-finished move gesture) must not vanish: it falls back to the pinned
  // tab instead of being filtered out of every tab.
  const groupOf = (repoRoot: string): string => {
    const assigned = view.projectGroup[repoRoot] ?? DEFAULT_GROUP_ID
    return tabs.some(tab => tab.id === assigned) ? assigned : DEFAULT_GROUP_ID
  }
  const projects = allProjects.filter(p => groupOf(p.repoRoot) === activeTab)

  return { tabs, activeTab, projects, allProjects }
}

/**
 * Derive the flat session list ("In one list" mode): every session — fork
 * children included — as a top-level row, strictly newest-first. No grouping,
 * no parent/child adjacency. Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @returns flat rows in render order.
 */
export function deriveFlat(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const rows: SessionSummary[] = []
  for (const id of list.ids) {
    const s = list.byId[id]
    if (s === undefined || !sessionVisible(s, list.current, archived)) continue
    rows.push(s)
  }
  rows.sort(byRecency)
  return rows.map(session => sessionNode(session, descendants))
}

/** Relative-time bucket of a session row's trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  unit: RelativeTimeUnit
  n: number
}

/**
 * Merge immediate title/Workspace substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param query - caller text; surrounding whitespace is ignored.
 * @param archivedSessionIds - registry-global archive set (members never match).
 * @param content - ranked Host content-search page.
 * @param limit - protocol-owned maximum merged row count.
 * @returns bounded deduplicated flat rows and a refine-query hint bit.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)

  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  const labelOf = (summary: SessionSummary): string =>
    workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
  const contentBySession = new Map<SessionId, SessionSearchResultItem>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank placeholders never match a query (their canonical title displays
    // localized, so matching it would tie search to one language).
    if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  local.sort(byRecency)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary)
  }

  return {
    items: ordered.slice(0, limit).map((summary) => {
      const match = contentBySession.get(summary.id)
      return {
        id: summary.id,
        title: sessionTitle(summary),
        workspace: labelOf(summary),
        running: summary.running,
        runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
        ...(summary.pendingInteraction === undefined
          ? {}
          : { pendingInteraction: summary.pendingInteraction }),
        completed: summary.completed === true,
        ...match === undefined ? {} : { snippet: match.snippet },
      }
    }),
    hasMore: content.hasMore || ordered.length > limit,
  }
}

/**
 * Compact relative time for session rows, as a structured bucket the
 * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 * @param updatedAt - epoch ms of the session's last activity.
 * @param now - current epoch ms (injected for pure rendering).
 * @returns the row's trailing time bucket and magnitude.
 */
export function relativeTime(updatedAt: number, now: number): RelativeTime {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/**
 * The worktree session-run visibility decision: a folded worktree hides its
 * sessions outright (the row click must produce a visible change at any
 * session count); an expanded one previews `limit` rows until the run is
 * explicitly widened.
 * @param sessions - the worktree's full session run.
 * @param expanded - whether the worktree row itself is expanded.
 * @param runExpanded - whether the preview was widened to the full run.
 * @param limit - previewed rows while the run stays collapsed.
 * @returns the session rows to render.
 */
export function worktreeVisibleSessions(
  sessions: readonly SessionNode[],
  expanded: boolean,
  runExpanded: boolean,
  limit: number,
): readonly SessionNode[] {
  if (!expanded) return []
  return runExpanded ? sessions : sessions.slice(0, limit)
}
