import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TerminalSubscriptionCoordinator } from '../plugins/capabilities/src/terminal-subscription-coordinator.ts'

class FakePty {
  dataListeners = new Set<(data: string) => void>()
  exitListeners = new Set<(event: { exitCode: number }) => void>()
  onData(callback: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(callback)
    return { dispose: () => { this.dataListeners.delete(callback) } }
  }
  onExit(callback: (event: { exitCode: number }) => void): { dispose(): void } {
    this.exitListeners.add(callback)
    return { dispose: () => { this.exitListeners.delete(callback) } }
  }
  emitData(data: string): void { for (const listener of this.dataListeners) listener(data) }
  emitExit(exitCode: number): void { for (const listener of this.exitListeners) listener({ exitCode }) }
}

test('coordinator installs one PTY listener and fans out to subscribers', () => {
  const pty = new FakePty()
  const coordinator = new TerminalSubscriptionCoordinator()
  const first: string[] = []
  const second: string[] = []
  const primary = coordinator.attach('s:t', pty, {
    onData: data => { first.push(data) },
    onExit: event => { first.push(`exit:${String(event.exitCode)}`) },
  })
  const secondary = coordinator.attach('s:t', pty, {
    onData: data => { second.push(data) },
    onExit: event => { second.push(`exit:${String(event.exitCode)}`) },
  })
  assert.equal(primary.primary, true)
  assert.equal(secondary.primary, false)
  assert.equal(pty.dataListeners.size, 1)
  pty.emitData('hello')
  pty.emitExit(3)
  assert.deepEqual(first, ['hello', 'exit:3'])
  assert.deepEqual(second, ['hello', 'exit:3'])
  secondary.dispose()
  assert.equal(coordinator.primaryId('s:t'), primary.id)
  primary.dispose()
  assert.equal(pty.dataListeners.size, 0)
})

test('coordinator elects a new primary and replaces stale pty entries', () => {
  const firstPty = new FakePty()
  const secondPty = new FakePty()
  const coordinator = new TerminalSubscriptionCoordinator()
  const first = coordinator.attach('key', firstPty, { onData: () => {}, onExit: () => {} })
  const replacement = coordinator.attach('key', secondPty, { onData: () => {}, onExit: () => {} })
  assert.equal(firstPty.dataListeners.size, 0)
  assert.equal(replacement.primary, true)
  assert.equal(coordinator.subscriberCount('key'), 1)
  coordinator.dispose()
  assert.equal(secondPty.dataListeners.size, 0)
})
