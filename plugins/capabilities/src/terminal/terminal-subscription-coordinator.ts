export interface TerminalPtySubscriptionLike {
  onData(callback: (data: string) => void): { dispose(): void }
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

export interface TerminalOutputSubscriber {
  onData(data: string): void
  onExit(event: { exitCode: number; signal?: number }): void
}

export interface TerminalSubscriptionHandle {
  id: string
  primary: boolean
  dispose(): void
}

interface Entry {
  pty: TerminalPtySubscriptionLike
  dataSubscription: { dispose(): void }
  exitSubscription: { dispose(): void }
  subscribers: Map<string, TerminalOutputSubscriber>
  primaryId: string | null
}

/**
 * One PTY listener with many independently flow-controlled subscribers.
 * Replay/ACK state stays at the socket batcher; this module only prevents
 * duplicate node-pty listeners and makes primary ownership explicit.
 */
export class TerminalSubscriptionCoordinator {
  private readonly entries = new Map<string, Entry>()
  private nextId = 0

  attach(key: string, pty: TerminalPtySubscriptionLike, subscriber: TerminalOutputSubscriber): TerminalSubscriptionHandle {
    let entry = this.entries.get(key)
    if (entry !== undefined && entry.pty !== pty) {
      this.disposeEntry(key, entry)
      entry = undefined
    }
    if (entry === undefined) {
      const subscribers = new Map<string, TerminalOutputSubscriber>()
      entry = {
        pty,
        dataSubscription: pty.onData(data => {
          const current = this.entries.get(key)
          if (current === undefined) return
          for (const target of [...current.subscribers.values()]) target.onData(data)
        }),
        exitSubscription: pty.onExit(event => {
          const current = this.entries.get(key)
          if (current === undefined) return
          for (const target of [...current.subscribers.values()]) target.onExit(event)
        }),
        subscribers,
        primaryId: null,
      }
      this.entries.set(key, entry)
    }
    const id = `${key}:${++this.nextId}`
    entry.subscribers.set(id, subscriber)
    if (entry.primaryId === null) entry.primaryId = id
    const primary = entry.primaryId === id
    let disposed = false
    return {
      id,
      primary,
      dispose: () => {
        if (disposed) return
        disposed = true
        const current = this.entries.get(key)
        if (current === undefined || !current.subscribers.delete(id)) return
        if (current.primaryId === id) {
          current.primaryId = current.subscribers.keys().next().value ?? null
        }
        if (current.subscribers.size === 0) this.disposeEntry(key, current)
      },
    }
  }

  subscriberCount(key: string): number {
    return this.entries.get(key)?.subscribers.size ?? 0
  }

  primaryId(key: string): string | null {
    return this.entries.get(key)?.primaryId ?? null
  }

  dispose(): void {
    for (const [key, entry] of [...this.entries]) this.disposeEntry(key, entry)
  }

  private disposeEntry(key: string, entry: Entry): void {
    if (this.entries.get(key) === entry) this.entries.delete(key)
    entry.subscribers.clear()
    entry.dataSubscription.dispose()
    entry.exitSubscription.dispose()
    entry.primaryId = null
  }
}
