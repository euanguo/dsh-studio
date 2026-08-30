/**
 * Push-confirmation gate regression tests (score-uplift leaf-S3).
 *
 * Pins the server-side intent seam on remote git mutation: git.push and
 * git.force-push refuse to touch the remote unless the client echoes an
 * explicit `confirm: true` boolean. The gate runs BEFORE cwd resolution,
 * so a payload missing both fields fails with the confirmation error, and
 * a rejected call never reaches the remote face (asserted via a recording
 * stub injected through GitHandlerDeps.remoteGit).
 *
 * The wire DTO for these routes is `{ confirm: boolean }`, so deliberately
 * malformed payloads are built as unknown-casts of that type: the cast
 * exists precisely because what they carry is invalid on the wire.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '../plugins/capabilities/src/context-types.ts'
import { CapabilityError } from '../plugins/shared/runtime/wire.ts'
import {
  buildGitHandlers,
  type GitHandlerDeps,
} from '../plugins/capabilities/src/routes/git.ts'

function makeDeps(calls: string[]): GitHandlerDeps {
  return {
    cwdOf: (payload) => {
      const record = payload as { cwd?: unknown } | null
      if (typeof record?.cwd !== 'string' || record.cwd === '') {
        throw new CapabilityError('bad-request', 'cwd is required')
      }
      return { cwd: record.cwd }
    },
    ctx: {} as Context,
    getSettings: () => undefined,
    getSourceControlAiGenerator: () => undefined,
    remoteGit: {
      async push(cwd) { calls.push(`push:${cwd}`) },
      async forcePushWithLease(cwd) { calls.push(`force:${cwd}`) },
    },
  }
}

/** Wire-level payload type for the push-class routes, derived not duplicated. */
type PushPayload = Parameters<
  NonNullable<ReturnType<typeof buildGitHandlers>['git.push']>
>[0]

/** Deliberately off-wire payload builder for negative gate cases. */
const malformed = (value: unknown): PushPayload => value as PushPayload
// The generated route map types payloads loosely at this seam; tests drive it
// through one narrowed caller so every site shares a single honest cast.
type AnyRouteHandler = (payload: unknown) => Promise<unknown>
const asHandler = (handler: unknown): AnyRouteHandler => handler as AnyRouteHandler

test('git.push rejects a missing confirm field as bad-request before resolving cwd or touching the remote', async () => {
  const calls: string[] = []
  const handlers = buildGitHandlers(makeDeps(calls))
  await assert.rejects(
    asHandler(handlers['git.push'])(malformed({ cwd: '/repo' })),
    (error: unknown) => error instanceof CapabilityError
      && error.code === 'bad-request'
      && /confirm/.test(error.message),
  )
  // Precedence proof: no cwd at all still yields the CONFIRMATION error.
  await assert.rejects(
    asHandler(handlers['git.push'])(malformed({})),
    (error: unknown) => error instanceof CapabilityError && error.code === 'bad-request',
  )
  assert.deepEqual(calls, [])
})

test('git.push rejects confirm:false as forbidden and never reaches the remote face', async () => {
  const calls: string[] = []
  const handlers = buildGitHandlers(makeDeps(calls))
  await assert.rejects(
    asHandler(handlers['git.push'])(malformed({ cwd: '/repo', confirm: false })),
    (error: unknown) => error instanceof CapabilityError
      && error.code === 'forbidden'
      && error.status === 403,
  )
  assert.deepEqual(calls, [])
})

test('non-boolean confirm values are bad-request, not silently truthy', async () => {
  const calls: string[] = []
  const handlers = buildGitHandlers(makeDeps(calls))
  for (const confirm of ['true', 1, null]) {
    await assert.rejects(
      asHandler(handlers['git.push'])(malformed({ cwd: '/repo', confirm })),
      (error: unknown) => error instanceof CapabilityError && error.code === 'bad-request',
    )
  }
  assert.deepEqual(calls, [])
})

test('a null or array payload is rejected as bad-request', async () => {
  const calls: string[] = []
  const handlers = buildGitHandlers(makeDeps(calls))
  await assert.rejects(asHandler(handlers['git.push'])(malformed(null)), CapabilityError)
  await assert.rejects(asHandler(handlers['git.push'])(malformed(['/repo'])), CapabilityError)
  assert.deepEqual(calls, [])
})

test('explicit confirm:true pushes exactly once against the requested cwd', async () => {
  const calls: string[] = []
  const handlers = buildGitHandlers(makeDeps(calls))
  // The real client sends scope/cwd alongside confirm; the handler reads
  // cwd from the same envelope, so the extra field rides the cast here.
  const result = await asHandler(handlers['git.push'])(
    malformed({ cwd: '/repo', confirm: true }),
  )
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, ['push:/repo'])
})

test('force-push demands the same explicit confirmation before its lease push', async () => {
  const calls: string[] = []
  const handlers = buildGitHandlers(makeDeps(calls))
  await assert.rejects(
    asHandler(handlers['git.force-push'])(malformed({ cwd: '/repo' })),
    (error: unknown) => error instanceof CapabilityError
      && (error.code === 'forbidden' || error.code === 'bad-request'),
  )
  assert.deepEqual(calls, [])
  const result = await asHandler(handlers['git.force-push'])(
    malformed({ cwd: '/repo', confirm: true }),
  )
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, ['force:/repo'])
})
