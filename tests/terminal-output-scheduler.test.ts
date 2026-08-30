import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { TerminalOutputScheduler } from '../plugins/shared/terminal/terminal-output-scheduler.ts'

class FakeTerminal {
  writes: Array<{ data: string; callback?: (() => void) | undefined }> = []
  stalled = false
  write(data: string, callback?: (() => void) | undefined): void {
    if (!this.stalled) {
      this.writes.push({ data, callback })
      callback?.()
    } else {
      this.writes.push({ data, callback })
    }
  }
}

const schedulers = new Set<TerminalOutputScheduler>()

afterEach(() => {
  for (const scheduler of schedulers) scheduler.dispose()
  schedulers.clear()
})

describe('TerminalOutputScheduler', () => {
  it('writes queued output and settles ACK exactly once', () => {
    const terminal = new FakeTerminal()
    const scheduler = new TerminalOutputScheduler(terminal)
    schedulers.add(scheduler)
    let acks = 0
    scheduler.enqueue('one', () => { acks += 1 })
    scheduler.enqueue('two', () => { acks += 1 })
    scheduler.drainNow()
    assert.equal(terminal.writes.length, 2)
    assert.equal(acks, 2)
  })

  it('fairly alternates foreground and background queues', () => {
    const terminal = new FakeTerminal()
    const scheduler = new TerminalOutputScheduler(terminal)
    schedulers.add(scheduler)
    scheduler.enqueue('bg1', undefined, { foreground: false })
    scheduler.enqueue('bg2', undefined, { foreground: false })
    scheduler.enqueue('fg1', undefined, { foreground: true })
    scheduler.enqueue('fg2', undefined, { foreground: true })
    scheduler.drainNow()
    assert.deepEqual(terminal.writes.map(write => write.data), ['fg1', 'bg1', 'fg2', 'bg2'])
  })

  it('drops background backlog and settles dropped ACKs', () => {
    const terminal = new FakeTerminal()
    let dropped = 0
    const scheduler = new TerminalOutputScheduler(terminal, {
      maxQueuedChars: 4,
      onBacklogDropped: chars => { dropped += chars },
    })
    schedulers.add(scheduler)
    let acks = 0
    scheduler.enqueue('aaaa', () => { acks += 1 }, { foreground: false })
    scheduler.enqueue('bbbb', () => { acks += 1 }, { foreground: false })
    scheduler.drainNow()
    assert.ok(dropped >= 4)
    // One dropped chunk and one written chunk each settle their ACK exactly once.
    assert.equal(acks, 2)
    assert.equal(terminal.writes.length, 1)
  })

  it('bounds queued output by UTF-8 bytes rather than UTF-16 code units', () => {
    const terminal = new FakeTerminal()
    const scheduler = new TerminalOutputScheduler(terminal, { maxQueuedChars: 3 })
    schedulers.add(scheduler)
    let acks = 0
    scheduler.enqueue('界', () => { acks += 1 }, { foreground: false })
    scheduler.enqueue('a', () => { acks += 1 }, { foreground: false })
    scheduler.drainNow()
    assert.equal(acks, 2)
    assert.equal(terminal.writes.length, 1)
    assert.equal(terminal.writes[0]?.data, 'a')
  })

  it('marks pipeline dead and recovers ACK when parse stalls', async () => {
    const terminal = new FakeTerminal()
    terminal.stalled = true
    let stalls = 0
    const scheduler = new TerminalOutputScheduler(terminal, {
      parseStallTimeoutMs: 5,
      onParseStall: () => { stalls += 1 },
    })
    schedulers.add(scheduler)
    let acks = 0
    scheduler.enqueue('stuck', () => { acks += 1 })
    scheduler.drainNow()
    await new Promise(resolve => setTimeout(resolve, 15))
    assert.equal(stalls, 1)
    assert.equal(acks, 1)
    assert.equal(scheduler.isDead, true)
    scheduler.reset()
    assert.equal(scheduler.isDead, false)
  })
})
