/**
 * Wire helpers for the /capabilities JSON API: bounded body reading, response
 * writing, and the shared error envelope. Every API method returns
 * `{ok: true, value}` on success and `{ok: false, error: {code, message}}`
 * (HTTP 4xx/5xx matching the code) on failure.
 */
import { errorMessage } from '@dsh-studio/shared/errors'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Machine-readable error codes of the capabilities API. */
export type CapabilityErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'forbidden'
  | 'method-error'
  | 'fs-error'
  | 'git-error'
  | 'pty-error'
  | 'job-error'
  | 'settings-rejected'
  | 'settings-conflict'
  | 'internal'

/** One API failure with its wire code and HTTP status. */
export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode
  readonly status: number

  constructor(code: CapabilityErrorCode, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 20

/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new CapabilityError('bad-request', 'request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new CapabilityError('bad-request', 'request body is not valid JSON')
  }
}

/** Write a JSON response with the given status. */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** Write the success envelope. */
export function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** Write the failure envelope for any thrown value (unknown → internal 500). */
export function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof CapabilityError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = errorMessage(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/** Narrow an unknown payload value to a string, else throw bad-request. */
export function requireString(payload: unknown, key: string): string {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'string' || value === '') {
    throw new CapabilityError('bad-request', `missing or invalid "${key}"`)
  }
  return value
}

/** Narrow an optional string field (missing → undefined; present but invalid → bad-request). */
export function optionalString(payload: unknown, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | null)?.[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') {
    throw new CapabilityError('bad-request', `invalid "${key}"`)
  }
  return value
}

/** Narrow an optional boolean field (missing → undefined; present but invalid → bad-request). */
export function optionalBoolean(payload: unknown, key: string): boolean | undefined {
  const value = (payload as Record<string, unknown> | null)?.[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new CapabilityError('bad-request', `invalid "${key}"`)
  }
  return value
}

/** Narrow an optional integer field within [min, max] (missing → undefined; invalid → bad-request). */
export function optionalInteger(payload: unknown, key: string, min: number, max: number): number | undefined {
  const value = (payload as Record<string, unknown> | null)?.[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new CapabilityError('bad-request', `invalid "${key}"`)
  }
  return value
}

/** Narrow the optional `paths` array (missing → undefined; must be non-empty strings). */
export function optionalPathList(payload: unknown): string[] | undefined {
  const value = (payload as Record<string, unknown> | null)?.['paths']
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item === '')) {
    throw new CapabilityError('bad-request', 'invalid "paths"')
  }
  return value as string[]
}
