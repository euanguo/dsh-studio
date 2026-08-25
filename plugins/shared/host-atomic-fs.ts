/**
 * Host-side only — Node file-system + HTTP-body helpers.
 *
 * This module imports `node:` built-ins and must NOT be imported from a
 * client/web bundle. It is used by desktop host routes (preferences, chrome)
 * that persist JSON to disk atomically and read bounded request bodies.
 *
 * @module host-atomic-fs
 */
import { randomBytes } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface WriteFileAtomicOptions {
  /** POSIX permission bits applied to the temporary file (e.g. `0o600`). */
  mode?: number
  /** Human-readable token to place before the random component of the tmp name. */
  suffix?: string
}

/**
 * Write `data` to `path` atomically: write a uniquely-named sibling temporary
 * file in the same directory, then `rename` it over the destination. On any
 * failure before the rename, the temporary file is removed best-effort. The
 * destination directory must already exist (callers `mkdir` first).
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  opts: WriteFileAtomicOptions = {},
): Promise<void> {
  const label = opts.suffix === undefined ? '' : `${opts.suffix}-`
  const temporary = join(dirname(path), `.${label}${randomBytes(6).toString('hex')}.tmp`)
  try {
    await writeFile(temporary, data, opts.mode === undefined ? undefined : { mode: opts.mode })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

/**
 * Synchronous counterpart of {@link writeFileAtomic} for shutdown checkpoints
 * (e.g. Cordis teardown) where the caller cannot await. Same tmp+rename
 * atomicity and mode behavior; the destination directory must already exist
 * (callers `mkdir` first).
 */
export function writeFileAtomicSync(
  path: string,
  data: string | Uint8Array,
  opts: WriteFileAtomicOptions = {},
): void {
  const label = opts.suffix === undefined ? '' : `${opts.suffix}-`
  const temporary = join(dirname(path), `.${label}${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, data, opts.mode === undefined ? undefined : { mode: opts.mode })
    renameSync(temporary, path)
  } catch (error) {
    unlinkSync(temporary)
    throw error
  }
}

/** Minimal event-emitter request shape for a streaming HTTP body. */
export interface HttpBodySource {
  headers: Record<string, string | string[] | undefined>
  on(event: string, callback: (chunk: Uint8Array) => void): void
  once?(event: string, callback: (...args: never[]) => void): void
}

/**
 * Aggregate a request body of at most `maxBytes` bytes and parse it as JSON.
 * Throws when the body exceeds `maxBytes` or when the aggregated content is
 * not valid JSON. Resolves to the parsed value.
 */
export async function readJsonBody(
  req: HttpBodySource,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const collect = (chunk: Uint8Array): void => {
    size += chunk.byteLength
    if (size > maxBytes) {
      throw new Error(`request body exceeds ${maxBytes} bytes`)
    }
    chunks.push(chunk)
  }

  if (req.once !== undefined) {
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk) => {
        try {
          collect(chunk)
        } catch (error) {
          reject(error)
        }
      })
      req.once?.('end', () => resolve())
      req.once?.('error', (error: Error) => reject(error))
    })
  } else {
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk) => {
        try {
          collect(chunk)
        } catch (error) {
          reject(error)
          return
        }
      })
      req.on('end', () => resolve())
    })
  }

  const total = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(total) as unknown
}