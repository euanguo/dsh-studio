import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TerminalSocket, type TerminalSocketHandlers } from '../plugins/shared/terminal-socket.ts'

class FakeWebSocket {
  static OPEN = 1
  static readonly instances: FakeWebSocket[] = []
  static last: FakeWebSocket
  readonly sent: unknown[] = []
  readyState = FakeWebSocket.OPEN
  onopen?: (() => void) | null
  onmessage?: ((event: { data: string }) => void) | null
  onerror?: (() => void) | null
  onclose?: (() => void) | null
  constructor() {
    FakeWebSocket.last = this
    FakeWebSocket.instances.push(this)
  }
  send(message: string): void {
    this.sent.push(message)
  }
  close(): void {}
}

test('socket detects sequence gap, settles ACK, and requests resync', () => {
  const original = globalThis.WebSocket
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  try {
    const outputs: string[] = []
    const handlers: TerminalSocketHandlers = {
      onOutput: data => { outputs.push(data) },
      onReady: () => {},
      onExit: () => {},
      onError: () => {},
    }
    const socket = new TerminalSocket('ws://test')
    socket.connect(80, 24, handlers, { sessionId: 's', tabId: 't' })
    const ws = FakeWebSocket.last
    ws.onopen?.()
    assert.deepEqual(
      ws.sent.map(value => JSON.parse(value as string)).filter(control => control.type === 'resize'),
      [{ type: 'resize', cols: 80, rows: 24 }],
    )
    ws.onmessage?.({ data: JSON.stringify({ type: 'output', epoch: 'ep1', sequence: 1, bytes: 3, data: 'aaa' }) })
    ws.onmessage?.({ data: JSON.stringify({ type: 'output', epoch: 'ep1', sequence: 2, bytes: 3, data: 'bbb' }) })
    assert.deepEqual(outputs, ['aaa', 'bbb'])
    // Sequence 4 is skipped: sequence 3 is missing.
    ws.sent.length = 0
    ws.onmessage?.({ data: JSON.stringify({ type: 'output', epoch: 'ep1', sequence: 4, bytes: 3, data: 'ccc' }) })
    // Gap data is not rendered.
    assert.deepEqual(outputs, ['aaa', 'bbb'])
    const controlSent = ws.sent.map(value => JSON.parse(value as string))
    assert.deepEqual(controlSent[0], { type: 'ack', epoch: 'ep1', sequence: 4, bytes: 3 })
    assert.deepEqual(controlSent[1], { type: 'resync' })
    // After resync, host replies with a fresh replay envelope.
    ws.sent.length = 0
    ws.onmessage?.({ data: JSON.stringify({ type: 'output', epoch: 'ep2', sequence: 0, bytes: 4, data: 'replay', replay: true }) })
    assert.deepEqual(outputs, ['aaa', 'bbb', 'replay'])
    // Live output with the new epoch starts again cleanly.
    ws.onmessage?.({ data: JSON.stringify({ type: 'output', epoch: 'ep2', sequence: 1, bytes: 3, data: 'ddd' }) })
    assert.deepEqual(outputs, ['aaa', 'bbb', 'replay', 'ddd'])
  } finally {
    globalThis.WebSocket = original
  }
})
