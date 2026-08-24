/**
 * Final domain declaration for durable UI chrome. Every table holds one
 * complete DTO record under the fixed `state` key; route callers never choose
 * a storage key.
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { CapabilityError } from '@dsh-studio/shared/wire'
import type { UiChromeFace } from './routes/ui-chrome.ts'
import {
  UI_CHROME_DOMAIN_NAME,
  UI_CHROME_RECORD_KEY,
  UI_CHROME_TABLES,
  type UiChromeTableName,
} from '@dsh-studio/shared/ui-chrome-tables'

const leftRailViewSchema = z.object({
  groupBy: z.enum(['workspace', 'flat']).default('workspace'),
  orderBy: z.enum(['manual', 'updated']).default('updated'),
  groupExpansion: z.record(z.string(), z.boolean()).default({}),
  sessionOrder: z.record(z.string(), z.array(z.string())).default({}),
})

const centerSurfaceBase = {
  id: z.string().min(1),
  cwd: z.string().min(1),
  title: z.string(),
  closable: z.literal(true),
}

const centerSurfaceSchema = z.discriminatedUnion('kind', [
  z.object({ ...centerSurfaceBase, kind: z.literal('conversation'), sessionId: z.string().min(1), isPreview: z.literal(false) }),
  z.object({ ...centerSurfaceBase, kind: z.literal('file'), filePath: z.string().min(1), isPreview: z.boolean(), markdownPreview: z.boolean().optional() }),
  z.object({ ...centerSurfaceBase, kind: z.literal('diff'), filePath: z.string().min(1), staged: z.boolean(), isPreview: z.boolean() }),
  z.object({ ...centerSurfaceBase, kind: z.literal('diff-all'), staged: z.boolean(), isPreview: z.boolean() }),
  z.object({ ...centerSurfaceBase, kind: z.literal('commit'), hash: z.string().min(1), isPreview: z.boolean() }),
  z.object({ ...centerSurfaceBase, kind: z.literal('commit-file'), hash: z.string().min(1), filePath: z.string().min(1), isPreview: z.boolean() }),
  z.object({ ...centerSurfaceBase, kind: z.literal('committed'), baseRef: z.string().min(1), filePath: z.string().min(1).optional(), isPreview: z.boolean() }),
  z.object({ ...centerSurfaceBase, kind: z.literal('conflict'), filePath: z.string().min(1), isPreview: z.boolean() }),
  z.object({ ...centerSurfaceBase, kind: z.literal('browser'), resource: z.string().optional(), isPreview: z.boolean() }),
  z.object({ ...centerSurfaceBase, kind: z.literal('terminal'), isPreview: z.literal(false) }),
])

const centerSurfacesSchema = z.object({
  byCwd: z.record(z.string(), z.object({
    open: z.array(centerSurfaceSchema),
    activeId: z.string().nullable(),
  })),
})

const sidebarChromeSliceSchema = z.object({
  explorer: z.object({
    expandedPaths: z.array(z.string()),
    selectedPath: z.string().nullable(),
  }),
  sourceControl: z.object({
    collapsedSections: z.array(z.string()),
    collapsedDirectories: z.array(z.string()),
    selectedPath: z.string().nullable(),
    commitMessage: z.string(),
  }),
  gitListMode: z.enum(['tree', 'flat']),
})

const sidebarChromeSchema = z.object({
  byScope: z.record(z.string(), sidebarChromeSliceSchema),
})

const jsonValue: any = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValue),
  z.record(z.string(), jsonValue),
]))

const persistedSidebarTabSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string(),
  resource: z.string().optional(),
  meta: jsonValue.optional(),
})

const persistedWorkspaceLayoutSchema = z.object({
  activeId: z.string().nullable(),
  lastUsed: z.number().finite().nonnegative(),
  width: z.number().finite().optional(),
  tabs: z.array(persistedSidebarTabSchema),
  bottomTabs: z.array(persistedSidebarTabSchema).optional(),
  bottomActiveId: z.string().nullable().optional(),
})

const sidebarLayoutsSchema = z.object({
  defaultWidth: z.number().finite(),
  openByDefault: z.boolean(),
  workspaces: z.record(z.string(), persistedWorkspaceLayoutSchema),
  pluginSettings: z.record(z.string(), z.record(z.string(), jsonValue)),
  centerPreviewTabs: z.enum(['default', 'disabled']),
  layoutScope: z.enum(['workspace', 'global']),
})

const flagsSchema = z.object({
  pinnedSummaryOpen: z.boolean().default(false),
  pluginMarketplaceOpen: z.boolean().default(false),
})

const schemas: Record<UiChromeTableName, any> = {
  [UI_CHROME_TABLES.leftRailView]: leftRailViewSchema,
  [UI_CHROME_TABLES.centerSurfaces]: centerSurfacesSchema,
  [UI_CHROME_TABLES.sidebarChrome]: sidebarChromeSchema,
  [UI_CHROME_TABLES.sidebarLayouts]: sidebarLayoutsSchema,
  [UI_CHROME_TABLES.flags]: flagsSchema,
}

export const UI_CHROME_DOMAIN = defineDomain({
  name: UI_CHROME_DOMAIN_NAME,
  version: 1,
  tables: {
    [UI_CHROME_TABLES.leftRailView]: domainTable(leftRailViewSchema),
    [UI_CHROME_TABLES.centerSurfaces]: domainTable(centerSurfacesSchema),
    [UI_CHROME_TABLES.sidebarChrome]: domainTable(sidebarChromeSchema),
    [UI_CHROME_TABLES.sidebarLayouts]: domainTable(sidebarLayoutsSchema),
    [UI_CHROME_TABLES.flags]: domainTable(flagsSchema),
  },
})

export interface UiChromeDomain {
  table(name: UiChromeTableName): {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
  }
  close(): Promise<void>
}

export function parseUiChromeValue(table: UiChromeTableName, value: unknown): unknown {
  return schemas[table].parse(value)
}

export function createUiChromeFace(domain: UiChromeDomain): UiChromeFace {
  return {
    get: table => domain.table(table).get(UI_CHROME_RECORD_KEY),
    async put(table, value) {
      let parsed: unknown
      try {
        parsed = parseUiChromeValue(table, value)
      } catch {
        throw new CapabilityError('bad-request', 'invalid UI chrome value')
      }
      await domain.table(table).put(UI_CHROME_RECORD_KEY, parsed)
      return parsed
    },
    delete: table => domain.table(table).delete(UI_CHROME_RECORD_KEY),
  }
}
