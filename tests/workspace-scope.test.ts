/** WorkspaceScopeRegistry unit behavior: the server-side cwd fence that
 *  every capability route consults before a handler body runs. Covers the
 *  allow-set derivation (server bootstrap roots ∪ registered workspaces ∪ live
 *  session cwds), the traversal/malformation rejections, the case-insensitive Windows branch,
 *  and the refresh-on-assertion freshness contract. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CapabilityError } from '../plugins/shared/runtime/wire.ts'
import { createWorkspaceScopeRegistry, type WorkspaceScopeSource } from '../plugins/capabilities/src/workspace-scope.ts'

function make(overrides: {
  workspaces?: string[]
  sessions?: (string | undefined)[]
  bootstrap?: (string | undefined)[]
} = {}) {
  const state = {
    workspaces: overrides.workspaces ?? ['/repo'],
    sessions: overrides.sessions ?? ([] as (string | undefined)[]),
    bootstrap: overrides.bootstrap ?? ([] as (string | undefined)[]),
  }
  const source: WorkspaceScopeSource = {
    workspaces: () => state.workspaces,
    sessions: () => state.sessions,
    bootstrap: () => state.bootstrap,
  }
  return { registry: createWorkspaceScopeRegistry(source), state }
}

test('rejects an unregistered absolute cwd with forbidden', () => {
  const { registry } = make()
  assert.throws(
    () => registry.assertAllowed('/etc/passwd'),
    (error: unknown) => error instanceof CapabilityError && error.code === 'forbidden',
  )
})

test('allows a registered workspace root and a subdirectory session inside it', () => {
  const { registry } = make({ workspaces: ['/repo'], sessions: ['/repo/packages/app'] })
  assert.equal(registry.isAllowed('/repo'), true)
  assert.equal(registry.isAllowed('/repo/packages/app'), true)
  registry.assertAllowed('/repo')
  registry.assertAllowed('/repo/packages/app')
})

test('allows a server-configured bootstrap root before registry attachment', () => {
  const { registry } = make({ bootstrap: ['/bootstrap/workspace'] })
  assert.doesNotThrow(() => registry.assertAllowed('/bootstrap/workspace/project'))
  assert.equal(registry.isAllowed('/client/guess'), false)
})

test('derives additional roots from live session cwds', () => {
  const { registry } = make({ sessions: ['/elsewhere/session-cwd'] })
  assert.equal(registry.isAllowed('/elsewhere/session-cwd'), true)
  assert.doesNotThrow(() => registry.assertAllowed('/elsewhere/session-cwd'))
})

test('rejects .. escape segments as bad-request before containment is judged', () => {
  const { registry } = make({ workspaces: ['/repo'] })
  for (const attempt of ['/repo/../secrets', '/../etc', '/repo/sub/../../outside']) {
    assert.throws(
      () => registry.assertAllowed(attempt),
      (error: unknown) => error instanceof CapabilityError && error.code === 'bad-request',
      `expected ${attempt} to be rejected`,
    )
  }
})

test('rejects relative paths and single-dot segments as malformed', () => {
  const { registry } = make({ workspaces: ['/repo'] })
  assert.throws(() => registry.assertAllowed('repo'), CapabilityError)
  assert.throws(() => registry.assertAllowed('/repo/./x'), CapabilityError)
})

test('windows roots match case-insensitively including the drive letter', () => {
  const { registry } = make({ workspaces: ['C:\\Users\\Me\\project'] })
  assert.equal(registry.isAllowed('c:/users/me/project/sub/file.ts', 'win32'), true)
  assert.doesNotThrow(() => registry.assertAllowed('C:\\USERS\\ME\\PROJECT', 'win32'))
  // POSIX semantics stay case-sensitive on the same data.
  assert.equal(registry.isAllowed('c:/users/me/project', 'linux'), false)
})

test('refresh picks up sources added after construction — explicitly and per assertion', () => {
  const { registry, state } = make()
  assert.equal(registry.isAllowed('/late'), false)

  // Explicit refresh reflects the new registration immediately.
  state.workspaces.push('/late')
  registry.refresh()
  assert.deepEqual([...registry.roots()].sort(), ['/late', '/repo'])
  assert.equal(registry.isAllowed('/late'), true)

  // And a brand-new source entry is honored by the next assertion even
  // without a manual refresh (the assertion refreshes internally).
  state.sessions.push('/newer/session')
  assert.doesNotThrow(() => registry.assertAllowed('/newer/session'))
})
