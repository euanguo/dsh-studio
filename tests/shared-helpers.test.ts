import { randomBytes } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { errorMessage } from '../plugins/shared/errors.ts'
import { relativeTimeParts } from '../plugins/shared/time.ts'
import {
  readJsonBody,
  writeFileAtomic,
  type HttpBodySource,
} from '../plugins/shared/host-atomic-fs.ts'

/**
 * Minimal `expect`-style assertion helper over `node:assert/strict`. Kept
 * local to this file so every check is a behavioral assertion (risk-free; it
 * does not mutate the code under test).
 */
function expect(actual: unknown): {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeNull(): void
  toMatch(pattern: RegExp): void
} {
  return {
    toBe(expected) {
      assert.strictEqual(actual, expected)
    },
    toEqual(expected) {
      assert.deepEqual(actual, expected)
    },
    toBeNull() {
      assert.strictEqual(actual, null)
    },
    toMatch(pattern) {
      assert.match(String(actual), pattern)
    },
  }
}

type RejectsArg = RegExp | (new (...a: any[]) => Error)
async function expectRejects(promise: Promise<unknown>, match?: RejectsArg): Promise<void> {
  let threw = false
  try { await promise } catch (e) {
    threw = true
    if (match === undefined) return
    const ok = typeof match === 'function' ? e instanceof match : e instanceof Error && match.test(e.message)
    if (!ok) throw new Error(`rejection mismatch: ${String(e)}`)
    return
  }
  if (!threw) throw new Error('expected promise to reject')
}

test('errorMessage: Error message, string, JSON object and cyclic fallback', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom')
  expect(errorMessage('raw string')).toBe('raw string')
  expect(errorMessage({ code: 42, reason: 'x' })).toBe('{"code":42,"reason":"x"}')
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  // Cyclic structures cannot be JSON stringified; falls back to String(value).
  expect(errorMessage(cyclic)).toBe(String(cyclic))
})

test('errorMessage: undefined and numbers do not throw and serialize', () => {
  expect(errorMessage(undefined)).toBe('undefined')
  expect(errorMessage(42)).toMatch(/42/)
})

test('relativeTimeParts: invalid inputs return null', () => {
  expect(relativeTimeParts('not-a-date')).toBeNull()
  expect(relativeTimeParts(NaN)).toBeNull()
  expect(relativeTimeParts(Infinity)).toBeNull()
})

test('relativeTimeParts: sub-minute bucket is min at value 0', () => {
  const now = Date.now()
  expect(relativeTimeParts(now - 30_000)).toEqual({ value: 0, unit: 'min' })
})

test('relativeTimeParts: minute, hour, day buckets match tree semantics', () => {
  const now = Date.now()
  expect(relativeTimeParts(now - 5 * 60_000)).toEqual({ value: 5, unit: 'min' })
  expect(relativeTimeParts(now - 3 * 3_600_000)).toEqual({ value: 3, unit: 'hour' })
  expect(relativeTimeParts(now - 2 * 86_400_000)).toEqual({ value: 2, unit: 'day' })
})

test('relativeTimeParts: month and year buckets use 30d / 365d dividers', () => {
  const now = Date.now()
  expect(relativeTimeParts(now - 4 * 30 * 86_400_000)).toEqual({ value: 4, unit: 'month' })
  expect(relativeTimeParts(now - 2 * 365 * 86_400_000)).toEqual({ value: 2, unit: 'year' })
})

test('relativeTimeParts: a future timestamp clamps to the origin (min/0)', () => {
  const now = Date.now()
  expect(relativeTimeParts(now + 86_400_000)).toEqual({ value: 0, unit: 'min' })
})

test('writeFileAtomic: writes content atomically and leaves no temp siblings', async () => {
  const dir = await makeTempDir('atomic-success')
  const target = join(dir, 'prefs.json')
  await writeFileAtomic(target, '{"a":1}', { mode: 0o600, suffix: 'prefs' })

  expect(await readFile(target, 'utf8')).toBe('{"a":1}')
  const mode = (await stat(target)).mode & 0o777
  if (process.platform !== 'win32') expect(mode).toBe(0o600)
  expect(await readdir(dir)).toEqual(['prefs.json'])
})

test('writeFileAtomic: cleans up its temp file when the write fails', async () => {
  const dir = await makeTempDir('atomic-fail')
  const target = join(dir, 'does-not-exist', 'prefs.json') // parent dir missing
  await expectRejects(writeFileAtomic(target, '{}'))
  expect(await readdir(dir)).toEqual([])
})

test('readJsonBody: parses an aggregated JSON body under the limit', async () => {
  const body = JSON.stringify({ ok: true, n: 7 })
  expect(await readJsonBody(streamingSource(body), 1024)).toEqual({ ok: true, n: 7 })
})

test('readJsonBody: rejects a body that exceeds maxBytes', async () => {
  await expectRejects(
    readJsonBody(streamingSource('{"pad":"x'.padEnd(4096, 'x') + '"}'), 4096),
    /exceeds 4096 bytes/,
  )
})

test('readJsonBody: rejects invalid JSON', async () => {
  await expectRejects(readJsonBody(streamingSource('not json'), 1024), SyntaxError)
})

async function makeTempDir(label: string): Promise<string> {
  const dir = join(tmpdir(), `shared-helpers-${label}-${randomBytes(4).toString('hex')}`)
  await import('node:fs/promises').then(({ mkdir }) => mkdir(dir, { recursive: true }))
  return dir
}

function streamingSource(body: string): HttpBodySource {
  const chunks = new TextEncoder().encode(body)
  const listeners = new Map<string, Array<Parameters<HttpBodySource['on']>[1]>>()
  return {
    headers: { 'content-type': 'application/json' },
    on(event, callback) {
      const list = listeners.get(event) ?? []
      list.push(callback)
      listeners.set(event, list)
      // Emit data immediately for the head of the stream on first 'data' listen.
      if (event === 'data' && list.length === 1) {
        for (const chunk of splitInto(chunks)) list.forEach((cb) => cb(chunk))
      } else if (event === 'end' && list.length === 1) {
        list.forEach((cb) => cb(new Uint8Array(0)))
      }
      return undefined as never
    },
  }
}

function splitInto(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length === 0) return [bytes]
  const mid = Math.ceil(bytes.length / 2)
  return [bytes.subarray(0, mid), bytes.subarray(mid)]
}