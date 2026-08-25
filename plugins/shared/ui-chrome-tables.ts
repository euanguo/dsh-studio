/**
 * Browser-safe DTOs and names for durable UI chrome. The host owns validation
 * and persistence; clients use these values only through ui-chrome routes.
 */
import type { Field, NumberField, TableSchema } from './ui-chrome-schema.ts'

/** Runtime storage descriptor name. The JSON backend accepts snake_case only. */
export const UI_CHROME_DOMAIN_NAME = 'dsh_studio_ui'
/** One full-state record is stored in every table. */
export const UI_CHROME_RECORD_KEY = 'state'

export const UI_CHROME_TABLES = {
  leftRailView: 'left_rail_view',
  centerSurfaces: 'center_surfaces',
  sidebarChrome: 'sidebar_chrome',
  sidebarLayouts: 'sidebar_layouts',
  flags: 'flags',
  /** Line comments (workbench + review), migrated out of localStorage. */
  comments: 'comments',
} as const

export type UiChromeTableName = typeof UI_CHROME_TABLES[keyof typeof UI_CHROME_TABLES]

export const UI_CHROME_TABLE_NAMES = Object.freeze(Object.values(UI_CHROME_TABLES))

export function isUiChromeTableName(value: unknown): value is UiChromeTableName {
  return typeof value === 'string'
    && (UI_CHROME_TABLE_NAMES as readonly string[]).includes(value)
}

export interface ExplorerChromeSlice {
  readonly expandedPaths: readonly string[]
  readonly selectedPath: string | null
}

export interface SourceControlChromeSlice {
  readonly collapsedSections: readonly string[]
  readonly collapsedDirectories: readonly string[]
  readonly selectedPath: string | null
  readonly commitMessage: string
}

export type GitListMode = 'tree' | 'flat'

/** Diff rendering preferences (unified/split + word wrap), persisted per
 *  workspace like the rest of the sidebar chrome (F10/Q5). */
export interface DiffViewChromeSlice {
  readonly layout: 'unified' | 'split'
  readonly wordWrap: boolean
}

export interface SidebarChromeSlice {
  readonly explorer: ExplorerChromeSlice
  readonly sourceControl: SourceControlChromeSlice
  readonly gitListMode: GitListMode
  readonly diffView: DiffViewChromeSlice
}

export interface SidebarChromeState {
  byScope: Record<string, SidebarChromeSlice>
}

export function defaultSidebarChromeSlice(): SidebarChromeSlice {
  return {
    explorer: { expandedPaths: [], selectedPath: null },
    sourceControl: {
      collapsedSections: [],
      collapsedDirectories: [],
      selectedPath: null,
      commitMessage: '',
    },
    gitListMode: 'tree',
    diffView: { layout: 'unified', wordWrap: false },
  }
}

export function defaultSidebarChromeState(): SidebarChromeState {
  return { byScope: {} }
}

export function sanitizeSidebarChrome(value: unknown): SidebarChromeState {
  const record = isRecord(value) ? value : {}
  const raw = isRecord(record.byScope) ? record.byScope : {}
  const byScope: Record<string, SidebarChromeSlice> = {}
  for (const [scope, entry] of Object.entries(raw).slice(0, 500)) {
    if (!validKey(scope) || !isRecord(entry)) continue
    const explorer = isRecord(entry.explorer) ? entry.explorer : {}
    const sourceControl = isRecord(entry.sourceControl) ? entry.sourceControl : {}
    const diffView = isRecord(entry.diffView) ? entry.diffView : {}
    const strings = (candidate: unknown): string[] => Array.isArray(candidate)
      ? candidate.filter(item => typeof item === 'string' && validKey(item)).slice(0, 2_000)
      : []
    byScope[scope] = {
      explorer: {
        expandedPaths: strings(explorer.expandedPaths),
        selectedPath: typeof explorer.selectedPath === 'string' ? explorer.selectedPath : null,
      },
      sourceControl: {
        collapsedSections: strings(sourceControl.collapsedSections),
        collapsedDirectories: strings(sourceControl.collapsedDirectories),
        selectedPath: typeof sourceControl.selectedPath === 'string' ? sourceControl.selectedPath : null,
        commitMessage: typeof sourceControl.commitMessage === 'string' ? sourceControl.commitMessage : '',
      },
      gitListMode: entry.gitListMode === 'flat' ? 'flat' : 'tree',
      diffView: {
        layout: diffView.layout === 'split' ? 'split' : 'unified',
        wordWrap: diffView.wordWrap === true,
      },
    }
  }
  return { byScope }
}

export interface UiChromeFlags {
  pinnedSummaryOpen: boolean
  pluginMarketplaceOpen: boolean
}

export function defaultUiChromeFlags(): UiChromeFlags {
  return { pinnedSummaryOpen: false, pluginMarketplaceOpen: false }
}

export function sanitizeUiChromeFlags(value: unknown): UiChromeFlags {
  const record = isRecord(value) ? value : {}
  return {
    pinnedSummaryOpen: record.pinnedSummaryOpen === true,
    pluginMarketplaceOpen: record.pluginMarketplaceOpen === true,
  }
}

export interface LeftRailViewChrome {
  groupBy: 'workspace' | 'flat'
  orderBy: 'manual' | 'updated'
  groupExpansion: Record<string, boolean>
  sessionOrder: Record<string, string[]>
}

export function defaultLeftRailViewChrome(): LeftRailViewChrome {
  return {
    groupBy: 'workspace',
    orderBy: 'updated',
    groupExpansion: {},
    sessionOrder: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validKey(value: string): boolean {
  return value.length > 0 && value.length <= 4096 && !value.includes('\0')
}

function booleanMap(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {}
  const result: Record<string, boolean> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 2_000)) {
    if (validKey(key) && typeof entry === 'boolean') result[key] = entry
  }
  return result
}

function stringArrayMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}
  const result: Record<string, string[]> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 2_000)) {
    if (!validKey(key) || !Array.isArray(entry)) continue
    const values = entry.slice(0, 2_000)
    if (values.every(item => typeof item === 'string' && validKey(item))) {
      result[key] = [...values]
    }
  }
  return result
}

/** Drop malformed persisted fields and restore missing fields to final defaults. */
export function sanitizeLeftRailViewChrome(value: unknown): LeftRailViewChrome {
  const record = isRecord(value) ? value : {}
  return {
    groupBy: record.groupBy === 'flat' ? 'flat' : 'workspace',
    orderBy: record.orderBy === 'manual' ? 'manual' : 'updated',
    groupExpansion: booleanMap(record.groupExpansion),
    sessionOrder: stringArrayMap(record.sessionOrder),
  }
}

/* ── comments table (F1/F2/M7) ───────────────────────────────────────── */

/** A persisted workbench (file/diff) comment; contentType 'workbench'. */
export interface PersistedWorkbenchComment {
  id: string
  /** Absolute path (Electron surface) or git-relative (diff surface). */
  path: string
  /** 1-based anchor line — the range start. */
  startLine: number
  /** Range end when the comment spans multiple lines. */
  endLine?: number
  /** Anchor-line content hash ⇒ drift/outdated detection. */
  contentHash?: string
  /** Branch stamp on write; legacy null stays visible across branches. */
  branch?: string | null
  body: string
  createdAt: string
  /** Resolution timestamp; resolved comments stay listed but are excluded
   *  from new "add to conversation" payloads. */
  resolvedAt?: string
}

/** A persisted Git-review comment; contentType 'review'. */
export interface PersistedReviewComment {
  id: string
  workspacePath: string
  branch: string
  commitId: string
  filePath: string | null
  line: number | null
  side: 'new' | 'old' | null
  body: string
  createdAt: string
  resolvedAt?: string
  request: string
}

/** One `comments` table record: the two comment families coexist here,
 *  discriminated by the parent array they land in (kind: 'workbench' vs
 *  'review'). Formerly two local-storage keys + the workbench v2/v1 pair.
 */
export interface SidebarCommentsChrome {
  workbench: readonly PersistedWorkbenchComment[]
  review: readonly PersistedReviewComment[]
}

export function defaultSidebarCommentsChrome(): SidebarCommentsChrome {
  return { workbench: [], review: [] }
}

function isNonEmptyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function validIntegerInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value)
}

export function sanitizeSidebarComments(value: unknown): SidebarCommentsChrome {
  const record = isRecord(value) ? value : {}
  const toWorkbench = (entry: unknown): PersistedWorkbenchComment | undefined => {
    if (!isRecord(entry) || !isNonEmptyKey(entry.id) || !isNonEmptyKey(entry.path)
      || !validIntegerInt(entry.startLine) || !isNonEmptyKey(entry.body)
      || !isNonEmptyKey(entry.createdAt)) return undefined
    return {
      id: entry.id,
      path: entry.path,
      startLine: entry.startLine as number,
      ...(validIntegerInt(entry.endLine) ? { endLine: entry.endLine as number } : {}),
      ...(isNonEmptyKey(entry.contentHash) ? { contentHash: entry.contentHash } : {}),
      ...(entry.branch === null || isNonEmptyKey(entry.branch) ? { branch: entry.branch as string | null } : {}),
      body: entry.body,
      createdAt: entry.createdAt,
      ...(isNonEmptyKey(entry.resolvedAt) ? { resolvedAt: entry.resolvedAt } : {}),
    }
  }
  const toReview = (entry: unknown): PersistedReviewComment | undefined => {
    if (!isRecord(entry) || !isNonEmptyKey(entry.id) || !isNonEmptyKey(entry.workspacePath)
      || !isNonEmptyKey(entry.branch) || !isNonEmptyKey(entry.commitId)
      || !isNonEmptyKey(entry.body) || !isNonEmptyKey(entry.createdAt)
      || !isNonEmptyKey(entry.request)) return undefined
    const side = entry.side === 'new' || entry.side === 'old' ? entry.side : null
    const line = validIntegerInt(entry.line) && Number(entry.line) > 0 ? entry.line as number : null
    return {
      id: entry.id,
      workspacePath: entry.workspacePath,
      branch: entry.branch,
      commitId: entry.commitId,
      filePath: nullableString(entry.filePath),
      line,
      side,
      body: entry.body,
      createdAt: entry.createdAt,
      ...(isNonEmptyKey(entry.resolvedAt) ? { resolvedAt: entry.resolvedAt } : {}),
      request: entry.request,
    }
  }
  const workbench = Array.isArray(record.workbench)
    ? record.workbench.map(toWorkbench).slice(0, 500).filter((c): c is PersistedWorkbenchComment => c !== undefined)
    : []
  const review = Array.isArray(record.review)
    ? record.review.map(toReview).slice(0, 500).filter((c): c is PersistedReviewComment => c !== undefined)
    : []
  return { workbench, review }
}

/* ── single-source field descriptors (M6) ─────────────────────────────── */
/**
 * The shared, zod-free descriptors for the five durable ui-chrome tables.
 * `ui-chrome-domain.ts` builds its host `zod` schemas from these; the client
 * sanitizers above are the release-time field guards over the same names.
 * This is the only vocabulary source for the field names, enums and defaults.
 */

const s = (min?: number): Field => (min === undefined ? { kind: 'string' } : { kind: 'string', min })
const nb = (min?: number): Field => (
  min === undefined ? { kind: 'string', nullable: true } : { kind: 'string', nullable: true, min }
)
const fl = (): Field => ({ kind: 'boolean' })
const num = (extra: Omit<NumberField, 'kind'> = {}): Field => ({ kind: 'number', ...extra })
const en = (values: readonly string[]): Field => ({ kind: 'enum', values })
const el = (value: string | boolean): Field => ({ kind: 'literal', value })
const json = (): Field => ({ kind: 'json' })
const arr = (element: Field): Field => ({ kind: 'array', element })
const rec = (value: Field): Field => ({ kind: 'record', value })
const obj = (fields: Record<string, Field>): Field => ({ kind: 'object', fields })
const union = (discriminator: string, variants: Record<string, Record<string, Field>>): Field => ({
  kind: 'union',
  discriminator,
  variants,
})
// `opt` marks a field optional; `dflt` supplies the host default.
const o = (field: Field): Field => ({ ...field, optional: true })
const def = (field: Field, value: string | boolean | number | Record<string, never> | never[]): Field => ({
  ...field,
  default: value,
})

/** A raw JSON value (sidebarLayouts plugin blobs, tab `meta`). */
const jsonValue: Field = json()

/** centerSurface base fields shared by every kind. */
const centerSurfaceBase: Record<string, Field> = {
  id: s(1), cwd: s(1), title: s(), closable: el(true), kind: s(),
}

const centerSurface: Field = union('kind', {
  conversation: { ...centerSurfaceBase, kind: el('conversation'), sessionId: s(1), isPreview: el(false) },
  file: { ...centerSurfaceBase, kind: el('file'), filePath: s(1), isPreview: fl(), markdownPreview: o(fl()) },
  diff: { ...centerSurfaceBase, kind: el('diff'), filePath: s(1), staged: fl(), isPreview: fl() },
  'diff-all': { ...centerSurfaceBase, kind: el('diff-all'), staged: fl(), isPreview: fl() },
  commit: { ...centerSurfaceBase, kind: el('commit'), hash: s(1), isPreview: fl() },
  'commit-file': { ...centerSurfaceBase, kind: el('commit-file'), hash: s(1), filePath: s(1), isPreview: fl() },
  committed: { ...centerSurfaceBase, kind: el('committed'), baseRef: s(1), filePath: o(s(1)), isPreview: fl() },
  conflict: { ...centerSurfaceBase, kind: el('conflict'), filePath: s(1), isPreview: fl() },
  browser: { ...centerSurfaceBase, kind: el('browser'), resource: o(s()), isPreview: fl() },
  terminal: { ...centerSurfaceBase, kind: el('terminal'), isPreview: el(false) },
})

const persistedSidebarTab: Field = obj({
  id: s(1), type: s(1), title: s(), resource: o(s()), meta: o(json()),
})

const persistedWorkspaceLayout: Field = obj({
  activeId: nb(), lastUsed: num({ finite: true, nonnegative: true }),
  width: o(num({ finite: true })), tabs: arr(persistedSidebarTab),
  bottomTabs: o(arr(persistedSidebarTab)), bottomActiveId: o(nb()),
})

const sidebarChromeSlice: Field = obj({
  explorer: obj({ expandedPaths: arr(s()), selectedPath: nb() }),
  sourceControl: obj({
    collapsedSections: arr(s()), collapsedDirectories: arr(s()),
    selectedPath: nb(), commitMessage: s(),
  }),
  gitListMode: en(['tree', 'flat']),
  diffView: obj({ layout: en(['unified', 'split']), wordWrap: fl() }),
})

/**
 * The five durable table descriptors reference one `TableSchema`; the host
 * derives zod from them and the client keeps the field vocabulary in sync.
 */
export const UI_CHROME_TABLE_SCHEMAS: Record<string, TableSchema> = {
  [UI_CHROME_TABLES.leftRailView]: {
    fields: {
      groupBy: def(en(['workspace', 'flat']), 'workspace'),
      orderBy: def(en(['manual', 'updated']), 'updated'),
      groupExpansion: def(rec(fl()), {}),
      sessionOrder: def(rec(arr(s())), {}),
    },
  },
  [UI_CHROME_TABLES.centerSurfaces]: {
    fields: { byCwd: rec(obj({ open: arr(centerSurface), activeId: nb() })) },
  },
  [UI_CHROME_TABLES.sidebarChrome]: {
    fields: { byScope: rec(sidebarChromeSlice) },
  },
  [UI_CHROME_TABLES.sidebarLayouts]: {
    fields: {
      defaultWidth: num({ finite: true }),
      openByDefault: fl(),
      workspaces: rec(persistedWorkspaceLayout),
      pluginSettings: rec(rec(jsonValue)),
      centerPreviewTabs: en(['default', 'disabled']),
      layoutScope: en(['workspace', 'global']),
    },
  },
  [UI_CHROME_TABLES.flags]: {
    fields: {
      pinnedSummaryOpen: def(fl(), false),
      pluginMarketplaceOpen: def(fl(), false),
    },
  },
}
