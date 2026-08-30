/**
 * WorkspaceEvents contract (leaf-1.7): exactly two identity event classes,
 * workspace-before-session delivery ordering, per-channel subscriber order,
 * and the single identity pump that forwards the upstream session feed into
 * `identify`. The retained runtime invalidation that rides workspace changes
 * is covered at the end.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkspaceEvents } from '../plugins/workbench/src/events.ts'
import {
  forwardSessionIdentity,
  type SessionCurrentInfoFeed,
} from '../plugins/shared/contracts/workbench-contracts.ts'
import {
  disposeSidebarRuntimes,
  explorerRuntimeRegistry,
  fileRuntimeRegistry,
  invalidateRetainedRuntimes,
} from '../plugins/sidebar/src/client/runtimes/registry.ts'

/** Manual observable standing in for the runtime's current-session projection. */
function manualCurrent(initial: { sessionId?: string | undefined } = {}): {
  feed: SessionCurrentInfoFeed
  emit(next: { sessionId?: string | undefined }): void
} {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    feed: {
      getSnapshot: () => snapshot,
      subscribe: listener => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    emit: next => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

test('identity switches deliver workspace before session and preserve subscriber order', () => {
  const events = createWorkspaceEvents()
  const seen: string[] = []
  events.onWorkspaceChanged(cwd => { seen.push(`w1:${cwd}`) })
  events.onSessionChanged(event => { seen.push(`s1:${event.sessionId}@${event.cwd}`) })
  events.onWorkspaceChanged(cwd => { seen.push(`w2:${cwd}`) })
  events.onSessionChanged(({ sessionId }) => { seen.push(`s2:${sessionId}`) })

  // First identification: the workspace listeners must already observe the
  // new cwd when the session listeners run.
  events.identify({ cwd: '/repo', sessionId: 's1' })
  assert.deepEqual(seen, ['w1:/repo', 'w2:/repo', 's1:s1@/repo', 's2:s1'])
  assert.deepEqual(events.snapshot(), { cwd: '/repo', sessionId: 's1' })
})

test('same-cwd session switches fire only onSessionChanged', () => {
  const events = createWorkspaceEvents()
  events.identify({ cwd: '/repo', sessionId: 's1' })
  const seen: string[] = []
  events.onWorkspaceChanged(cwd => { seen.push(`workspace:${cwd}`) })
  events.onSessionChanged(({ sessionId, cwd }) => { seen.push(`session:${sessionId}@${cwd}`) })

  // Navigating inside the same project: NOT a workspace change, and the
  // payload carries the still-current cwd.
  events.identify({ sessionId: 's2' })
  assert.deepEqual(seen, ['session:s2@/repo'])

  // A cwd switch alone fires only the workspace channel.
  seen.length = 0
  events.identify({ cwd: '/other' })
  assert.deepEqual(seen, ['workspace:/other'])
})

test('no-op merges and empty identifies stay silent', () => {
  const events = createWorkspaceEvents()
  events.identify({ cwd: '/repo', sessionId: 's1' })
  let fired = 0
  events.onWorkspaceChanged(() => { fired += 1 })
  events.onSessionChanged(() => { fired += 1 })

  events.identify({})
  events.identify({ cwd: '/repo', sessionId: 's1' })
  assert.equal(fired, 0)
})

test('forwardSessionIdentity seeds startup identity and forwards real switches only', () => {
  const events = createWorkspaceEvents()
  const current = manualCurrent({ sessionId: 's1' })
  // The sidebar's cwd resolver: roster fallback sampled at fire time.
  const cwds = new Map([['s1', '/repo'], ['s2', '/repo'], ['s3', '/other']])
  const seen: string[] = []
  events.onWorkspaceChanged(cwd => { seen.push(`workspace:${cwd}`) })
  events.onSessionChanged(({ sessionId }) => { seen.push(`session:${sessionId}`) })

  // Subscribers attached BEFORE the pump see the immediate seed.
  const stop = forwardSessionIdentity(events, current.feed, id => (id === undefined ? undefined : cwds.get(id)))
  assert.deepEqual(seen, ['workspace:/repo', 'session:s1'])

  // Same-identity republications (provider-roster churn) are absorbed.
  current.emit({ sessionId: 's1' })
  assert.deepEqual(seen, ['workspace:/repo', 'session:s1'])

  // A genuine session switch inside the same project fires one event.
  current.emit({ sessionId: 's2' })
  assert.deepEqual(seen, ['workspace:/repo', 'session:s1', 'session:s2'])

  // A project switch fires both channels in order.
  current.emit({ sessionId: 's3' })
  assert.deepEqual(seen, [
    'workspace:/repo',
    'session:s1',
    'session:s2',
    'workspace:/other',
    'session:s3',
  ])

  stop()
  current.emit({ sessionId: 's4' })
  assert.deepEqual(seen.slice(-2), ['workspace:/other', 'session:s3'])
})

test('the blank placeholder contributes no cwd but does switch sessions', () => {
  const events = createWorkspaceEvents()
  const current = manualCurrent({ sessionId: 's1' })
  forwardSessionIdentity(events, current.feed, id => id === 'blank' ? '   ' : `/repo/${id}`)
  const seen: Array<{ sessionId?: string; cwd?: string | null }> = []
  events.onWorkspaceChanged(cwd => { seen.push({ cwd }) })
  events.onSessionChanged(({ sessionId, cwd }) => { seen.push({ sessionId, cwd }) })

  // New-conversation placeholder: the resolver reports a blank cwd. The
  // kernel retains the last known project while the session id moves on.
  current.emit({ sessionId: 'blank' })
  assert.deepEqual(seen, [{ sessionId: 'blank', cwd: '/repo/s1' }])
  assert.deepEqual(events.snapshot(), { cwd: '/repo/s1', sessionId: 'blank' })
})

test('retained runtimes rebuild with fresh data after a workspace invalidation', () => {
  // Fake retained bundles (dispose-observing) planted directly in the cwd-
  // keyed registries — the getters bind real transports, which stay unused.
  const disposed: string[] = []
  const bundle = (family: string) => ({
    runtime: { dispose: () => { disposed.push(family) } },
    cwd: '/repo',
  })
  explorerRuntimeRegistry.set('/repo', bundle('explorer') as never)
  fileRuntimeRegistry.set('/repo', {
    runtime: { dispose: () => { disposed.push('file') } },
    cwd: '/repo',
  } as never)

  invalidateRetainedRuntimes()

  assert.equal(explorerRuntimeRegistry.get('/repo'), undefined)
  assert.equal(fileRuntimeRegistry.get('/repo'), undefined)
  assert.ok(disposed.includes('explorer'), 'evicted bundles must be disposed')

  // Teardown still clears everything, terminals included.
  disposeSidebarRuntimes()
})
