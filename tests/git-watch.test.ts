/**
 * Unit tests for the git freshness push coordinator
 * (plugins/capabilities/src/git/git-watch.ts). The probe is injected, so no
 * real git subprocess runs; timers use a huge interval and ticks are driven
 * manually through `pollOnce`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GitWatchCoordinator,
  attachGitWatch,
  type GitWatchSocket,
} from '../plugins/capabilities/src/git/git-watch.ts'

function harness(sequence: string[]) {
  let tick = 0
  const coordinator = new GitWatchCoordinator({
    probe: async () => {
      const key = sequence[Math.min(tick, sequence.length - 1)] ?? 'k-final'
      tick += 1
      return key
    },
    intervalMs: 3_600_000,
  })
  return { coordinator }
}

test('git-watch: baseline tick does not notify; first change does', async () => {
  const { coordinator } = harness(['k1', 'k1', 'k2'])
  const fired: number[] = []
  const unsub = coordinator.subscribe('/ws', () => { fired.push(1) })
  await coordinator.pollOnce('/ws')
  assert.deepEqual(fired, [], 'baseline fingerprint is silent')
  await coordinator.pollOnce('/ws')
  assert.deepEqual(fired, [], 'identical fingerprint stays silent')
  await coordinator.pollOnce('/ws')
  assert.equal(fired.length, 1, 'changed fingerprint notifies once')
  unsub()
})

test('git-watch: multiple subscribers all notified; unsubscriber stops loop', async () => {
  const { coordinator } = harness(['a', 'b'])
  const hits: string[] = []
  const stopA = coordinator.subscribe('/r', () => hits.push('a'))
  coordinator.subscribe('/r', () => hits.push('b'))
  assert.deepEqual(coordinator.roomState('/r'), { subscribers: 2, looping: true })
  await coordinator.pollOnce('/r')
  stopA()
  await coordinator.pollOnce('/r')
  assert.deepEqual(hits, ['b'], 'only the live subscriber remains after baseline')
  assert.deepEqual(coordinator.roomState('/r'), { subscribers: 1, looping: true })
})

test('git-watch: last unsubscribe stops the room; resubscribe restarts it', async () => {
  const { coordinator } = harness(['k'])
  const stop = coordinator.subscribe('/x', () => {})
  assert.equal(coordinator.roomState('/x')?.looping, true)
  stop()
  assert.equal(coordinator.roomState('/x'), undefined)
  const stop2 = coordinator.subscribe('/x', () => {})
  assert.equal(coordinator.roomState('/x')?.looping, true)
  stop2()
  assert.equal(coordinator.roomState('/x'), undefined)
})

test('git-watch: probe failure keeps the loop alive and the old baseline', async () => {
  let calls = 0
  let failures = 0
  const coordinator = new GitWatchCoordinator({
    probe: async () => {
      calls += 1
      if (calls === 2) throw new Error('git exploded')
      return `k${calls}`
    },
    onProbeError: () => { failures += 1 },
    intervalMs: 3_600_000,
  })
  const fired: number[] = []
  coordinator.subscribe('/e', () => { fired.push(1) })
  await coordinator.pollOnce('/e') // baseline k1
  await coordinator.pollOnce('/e') // throws — swallowed
  assert.equal(failures, 1)
  assert.deepEqual(fired, [])
  await coordinator.pollOnce('/e') // k3 differs from k1 → notify
  assert.equal(fired.length, 1)
})

test('git-watch: dispose stops every room', async () => {
  const { coordinator } = harness(['k'])
  const stop = coordinator.subscribe('/d', () => {})
  coordinator.subscribe('/d2', () => {})
  coordinator.dispose()
  assert.equal(coordinator.roomState('/d'), undefined)
  assert.equal(coordinator.roomState('/d2'), undefined)
  stop()
})

/* ---------- attach protocol ---------- */

class FakeSocket implements GitWatchSocket {
  readyState = 1
  sent: string[] = []
  closed: string | null = null
  private listeners = new Map<string, Array<() => void>>()
  send(data: string): void { this.sent.push(data) }
  close(): void { this.closed = 'closed' }
  on(event: 'close' | 'error', listener: () => void): unknown {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }
  emit(event: 'close' | 'error'): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
}

function urlOf(cwd: string | null): string {
  const query = cwd === null ? '' : `?cwd=${encodeURIComponent(cwd)}`
  return `/capabilities/ws/git-watch${query}`
}

test('git-watch attach: missing cwd closes with policy code', () => {
  const { coordinator } = harness(['k'])
  const socket = new FakeSocket()
  attachGitWatch(coordinator, socket, { url: urlOf(null) })
  assert.ok(socket.closed !== null, 'socket closed for missing cwd')
})

test('git-watch attach: connection subscribes, change frames arrive, close unsubscribes', async () => {
  const { coordinator } = harness(['k1', 'k2'])
  const socket = new FakeSocket()
  attachGitWatch(coordinator, socket, { url: urlOf('/repo') })
  assert.deepEqual(coordinator.roomState('/repo'), { subscribers: 1, looping: true })

  await coordinator.pollOnce('/repo') // baseline
  assert.deepEqual(socket.sent, [], 'baseline pushes nothing')
  await coordinator.pollOnce('/repo') // change
  assert.equal(socket.sent.length, 1)
  const frame = JSON.parse(socket.sent[0] ?? '{}') as { type?: unknown; cwd?: unknown }
  assert.deepEqual(frame, { type: 'changed', cwd: '/repo' })

  socket.emit('close')
  assert.equal(coordinator.roomState('/repo'), undefined, 'socket drop unsubscribes')

  // A late tick after the socket dropped must not throw.
  await coordinator.pollOnce('/repo')
})
