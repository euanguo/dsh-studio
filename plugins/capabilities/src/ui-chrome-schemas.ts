/**
 * Pure zod derivation for the durable UI chrome tables. The host zod schemas
 * are derived from the single-source field descriptors in
 * `ui-chrome-tables.ts` (`UI_CHROME_TABLE_SCHEMAS`) instead of a second
 * hand-written copy.
 *
 * The derivation is ONE recursive path: every field, at every nesting level
 * (top-level table fields, nested objects, record values, array elements and
 * union variants), goes through `buildZodField`, which applies the leaf
 * mapping, then generic nullability, then the `optional` / `default` markers.
 * Splitting the wrapping per level is what broke this domain once: nullable
 * strings and optional fields inside nested objects silently lost their
 * markers, so opening the domain rejected records the clients legitimately
 * wrote (`invalid-record`) and the whole ui-chrome storage went dark.
 *
 * This module is deliberately free of cordis / storage-domain imports so the
 * schema contract stays testable without a runtime medium.
 */
import { z } from 'zod'
import {
  UI_CHROME_TABLES,
  UI_CHROME_TABLE_SCHEMAS,
  type UiChromeTableName,
} from '@dsh-studio/shared/ui-chrome-tables'
import type { Field } from '@dsh-studio/shared/ui-chrome-schema'

/** A lazily-built JSON value (sidebarLayouts plugin blobs, tab `meta`). */
const jsonField: any = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonField),
  z.record(z.string(), jsonField),
]))

function buildNumberSchema(field: Extract<Field, { kind: 'number' }>): any {
  let schema = z.number()
  if (field.finite) schema = schema.finite()
  if (field.int) schema = schema.int()
  if (field.nonnegative) schema = schema.nonnegative()
  if (field.positive) schema = schema.positive()
  if (field.min !== undefined) schema = schema.min(field.min)
  return schema
}

/** Build one object's zod schema with per-field wrapping applied. */
function buildZodObject(fields: Record<string, Field>): any {
  const shape: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(fields)) shape[key] = buildZodField(field)
  return z.object(shape)
}

function buildUnwrappedField(field: Field): any {
  switch (field.kind) {
    case 'string':
      return (typeof field.min === 'number'
        ? z.string().min(field.min)
        : z.string()) as any
    case 'boolean':
      return z.boolean()
    case 'number':
      return buildNumberSchema(field)
    case 'enum':
      return z.enum(field.values) as any
    case 'literal':
      return z.literal(field.value)
    case 'json':
      return jsonField
    case 'array':
      return z.array(buildZodField(field.element))
    case 'record':
      return z.record(z.string(), buildZodField(field.value))
    case 'object':
      return buildZodObject(field.fields)
    case 'union': {
      const variants = Object.entries(field.variants).map(([, fields]) => buildZodObject(fields))
      return z.discriminatedUnion(field.discriminator, variants as any)
    }
    default:
      return z.unknown()
  }
}

/** Apply `optional` / `default` after generic nullability, on every level. */
function buildZodField(field: Field): any {
  const unwrapped = buildUnwrappedField(field)
  const nullable = 'nullable' in field && field.nullable === true
  let schema = nullable ? unwrapped.nullable() : unwrapped
  if (field.optional === true) {
    return (schema as any).optional()
  }
  if (field.default !== undefined) {
    const value = field.kind === 'object' || field.kind === 'union' || field.kind === 'json'
      ? JSON.parse(JSON.stringify(field.default))
      : field.default
    schema = (schema as any).default(value)
  }
  return schema
}

const descriptorSchemas: Record<UiChromeTableName, any> = Object.fromEntries(
  Object.entries(UI_CHROME_TABLE_SCHEMAS).map(([table, descriptor]) => [table, buildZodObject(descriptor.fields)]),
) as Record<UiChromeTableName, any>

/**
 * The comments table is out of scope for the M6 five-table pilot (it belongs
 * to the comments migration) and keeps its hand-written schema.
 */
const workbenchCommentSchema = z.object({
  id: z.string().min(1),
  // Optional for one release so pre-scope rows remain readable; the client
  // sanitizer normalizes absent values to the legacy null scope.
  cwd: z.string().min(1).nullable().optional(),
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

descriptorSchemas[UI_CHROME_TABLES.comments] = commentsSchema

/** One derived host zod schema per ui-chrome table. */
export const uiChromeTableZodSchemas: Record<UiChromeTableName, any> = descriptorSchemas

/** Validate one wire value against its table's host schema. */
export function parseUiChromeValue(table: UiChromeTableName, value: unknown): unknown {
  return uiChromeTableZodSchemas[table].parse(value)
}
