/**
 * Single-source field descriptors for the durable UI chrome tables (M6).
 *
 * The five ui-chrome tables are validated in two ends that used to drift:
 * the host `zod` schemas (capabilities/ui-chrome-domain.ts) and the browser
 * client sanitizers (ui-chrome-tables.ts). This module holds the field
 * vocabulary ONCE as pure TS data — field names, kinds, enums, defaults,
 * nullability, length bounds — and:
 *  - the host builds its `zod` schemas from these descriptors, and
 *  - the client sanitizers build from the same field names/defaults.
 *
 * Kept free of `zod` so the browser bundle never pulls the schema runtime in
 * (same rule as prefs-shared.ts / left-rail-preferences.ts).
 */

/** A non-nullable string field. */
export interface StringField { kind: 'string'; min?: number }
/** A nullable string field (wire value may be null). */
export interface NullableStringField { kind: 'string'; min?: number; nullable: true }
export interface BoolField { kind: 'boolean' }
export interface NumberField {
  kind: 'number'
  finite?: boolean
  int?: boolean
  nonnegative?: boolean
  min?: number
  positive?: boolean
}
export interface EnumField { kind: 'enum'; values: readonly string[] }
export interface NullableEnumField { kind: 'enum'; values: readonly string[]; nullable: true }
export interface LiteralField { kind: 'literal'; value: string | boolean }
export interface JsonField { kind: 'json' }
export interface ArrayField { kind: 'array'; element: Field }
export interface RecordField { kind: 'record'; value: Field }
export interface ObjectField { kind: 'object'; fields: Record<string, Field> }

/**
 * A discriminated union over a `string` discriminator (`kind`). Each variant
 * carries that key's `literal` plus the extra fields for its shape.
 */
export interface UnionField {
  kind: 'union'
  discriminator: string
  variants: Record<string, Record<string, Field>>
}

/** Whether the field is optional (may be absent; implies a host default). */
export interface Optional {
  optional?: boolean
  /**
   * The value the host applies when the field is absent (zod `.default`).
   * Object/array defaults are expressed as plain JSON objects / arrays.
   */
  default?: string | boolean | number | Record<string, unknown> | unknown[]
}

export type Field =
  | (StringField & Optional)
  | (NullableStringField & Optional)
  | (BoolField & Optional)
  | (NumberField & Optional)
  | (EnumField & Optional)
  | (NullableEnumField & Optional)
  | (LiteralField & Optional)
  | (JsonField & Optional)
  | (ArrayField & Optional)
  | (RecordField & Optional)
  | (ObjectField & Optional)
  | (UnionField & Optional)

/** Object with per-field nullability expressed in the field types above. */
export interface FieldObject {
  kind: 'object'
  fields: Record<string, Field>
}

/** Flatten an object field into the descriptor container shape. */
export function objectOf(fields: Record<string, Field>): FieldObject {
  return { kind: 'object', fields }
}

/** A table's complete single-field schema. */
export interface TableSchema {
  /** True when the whole record may be absent (host supplies defaults instead). */
  recordOptional?: boolean
  fields: Record<string, FieldObject | Field>
}