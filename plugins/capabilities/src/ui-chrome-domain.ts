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
  UI_CHROME_TABLE_SCHEMAS,
  type UiChromeTableName,
} from '@dsh-studio/shared/ui-chrome-tables'
import type { Field, TableSchema } from '@dsh-studio/shared/ui-chrome-schema'

/**
 * M6: the host zod schemas are derived from the single-source field
 * descriptors in `ui-chrome-tables.ts` (`UI_CHROME_TABLE_SCHEMAS`) instead of
 * a second hand-written copy. The builder below maps each descriptor kind to
 * the identical zod validation the hand-written schemas previously encoded, so
 * host validation strength is unchanged by construction.
 */

/** A lazily-built JSON value (sidebarLayouts plugin blobs, tab `meta`). */
const jsonField: any = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonField),
  z.record(z.string(), jsonField),
]))

function buildField(field: Field): any {
  switch (field.kind) {
    case 'string':
      return (typeof field.min === 'number'
        ? z.string().min(field.min)
        : z.string()) as any
    case 'boolean':
      return z.boolean()
    case 'number': {
      let schema = z.number()
      if (field.finite) schema = schema.finite()
      if (field.int) schema = schema.int()
      if (field.nonnegative) schema = schema.nonnegative()
      if (field.positive) schema = schema.positive()
      if (field.min !== undefined) schema = schema.min(field.min)
      return schema
    }
    case 'enum':
      return ('nullable' in field
        ? z.enum(field.values).nullable()
        : z.enum(field.values)) as any
    case 'literal':
      return z.literal(field.value)
    case 'json':
      return jsonField
    case 'array':
      return z.array(buildField(field.element))
    case 'record':
      return z.record(z.string(), buildField(field.value))
    case 'object': {
      const shape: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(field.fields)) shape[key] = buildField(value)
      return z.object(shape)
    }
    case 'union': {
      return z.discriminatedUnion(field.discriminator, Object.entries(field.variants).map(([, variant]) => {
        const shape: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(variant)) shape[key] = buildField(value)
        return z.object(shape)
      }))
    }
    default:
      return z.unknown()
  }
}

/** Apply `optional` / `default` wrappers in the same order the hand-written
 *  schemas used (`.optional()` then `.default()`). */
function buildFieldWrapped(field: Field): any {
  let schema = buildField(field)
  if (field.optional === true) {
    schema = (schema as any).optional()
  } else if (field.default !== undefined) {
    const value = field.kind === 'object' || field.kind === 'union' || field.kind === 'json'
      ? JSON.parse(JSON.stringify(field.default))
      : field.default
    schema = (schema as any).default(value)
  }
  return schema
}

function buildObjectSchema(descriptor: TableSchema): any {
  const shape: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(descriptor.fields)) {
    shape[key] = value.kind === 'object'
      ? buildObjectSchema(value)
      : buildFieldWrapped(value)
  }
  return z.object(shape)
}

const schemas: Record<UiChromeTableName, any> = Object.fromEntries(
  Object.entries(UI_CHROME_TABLE_SCHEMAS).map(([table, descriptor]) => [table, buildObjectSchema(descriptor)]),
) as Record<UiChromeTableName, any>

/**
 * The comments table is out of scope for the M6 five-table pilot (it belongs
 * to the comments migration) and keeps its hand-written schema.
 */
const workbenchCommentSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  startLine: z.number().int(),
  endLine: z.number().int().optional(),
  contentHash: z.string().optional(),
  branch: z.string().nullable().optional(),
  body: z.string().min(1),
  createdAt: z.string().min(1),
  resolvedAt: z.string().optional(),
})

const reviewCommentSchema = z.object({
  id: z.string().min(1),
  workspacePath: z.string().min(1),
  branch: z.string().min(1),
  commitId: z.string().min(1),
  filePath: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  side: z.enum(['new', 'old']).nullable(),
  body: z.string().min(1),
  createdAt: z.string().min(1),
  resolvedAt: z.string().optional(),
  request: z.string().min(1),
})

const commentsSchema = z.object({
  workbench: z.array(workbenchCommentSchema),
  review: z.array(reviewCommentSchema),
})

schemas[UI_CHROME_TABLES.comments] = commentsSchema

export const UI_CHROME_DOMAIN = defineDomain({
  name: UI_CHROME_DOMAIN_NAME,
  version: 1,
  tables: {
    [UI_CHROME_TABLES.leftRailView]: domainTable(schemas[UI_CHROME_TABLES.leftRailView]),
    [UI_CHROME_TABLES.centerSurfaces]: domainTable(schemas[UI_CHROME_TABLES.centerSurfaces]),
    [UI_CHROME_TABLES.sidebarChrome]: domainTable(schemas[UI_CHROME_TABLES.sidebarChrome]),
    [UI_CHROME_TABLES.sidebarLayouts]: domainTable(schemas[UI_CHROME_TABLES.sidebarLayouts]),
    [UI_CHROME_TABLES.flags]: domainTable(schemas[UI_CHROME_TABLES.flags]),
    [UI_CHROME_TABLES.comments]: domainTable(schemas[UI_CHROME_TABLES.comments]),
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
