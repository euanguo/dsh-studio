/**
 * Shared error-to-string helpers. These are deliberately defensive: UI chrome
 * must never throw while merely formatting a message, so every path here is
 * total (always returns a string) and never rethrows.
 */

const MAX_SERIALIZED_LENGTH = 512

/**
 * Produce a stable, human-readable message for an unknown thrown value.
 * - `Error` instances expose their `message`.
 * - strings pass through unchanged.
 * - everything else is safely JSON-serialized and truncated to a bounded
 *   length; circular / bigint values that cannot be stringified fall back to
 *   `String(...)`.
 * Never throws and never returns `undefined`.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return safeStringify(error)
}

function safeStringify(value: unknown): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value) ?? String(value)
  } catch {
    serialized = String(value)
  }
  const trimmed = serialized.trim()
  return trimmed.slice(0, MAX_SERIALIZED_LENGTH)
}