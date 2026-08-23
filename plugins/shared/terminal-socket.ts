/**
 * Terminal WebSocket client for the DSH Studio desktop terminal (shared).
 *
 * The socket owns reconnect coordination and parses the versioned output frame
 * emitted by the host batcher. ACKs are sent only from the xterm write/parse
 * callback, so host flow control tracks renderer consumption rather than mere
 * receipt. Legacy raw-text frames remain accepted during staged upgrades.
 */
import {
  GenerationGate,
} from './client-runtime.ts'
import {
  TerminalRecoveryCoordinator,
} from './terminal-recovery.ts'
import type {
  TerminalOutputAck,
  TerminalOutputFrame,
} from './terminal-wire.ts'

export interface TerminalSocketHandlers {
  onOutput(data: string, acknowledge?: () => void): void
  onReady(cwd: string): void
  onExit(code: number | null): void
  onError(message: string): void
}

export interface TerminalSocketScope {
  cwd?: string
  sessionId: string
  tabId: string
}

export const CAPABILITIES_TERMINAL_WS_PATH = '/capabilities/ws/terminal'

export function terminalWebSocketUrl(scope: TerminalSocketScope): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${protocol}//${window.location.host}${CAPABILITIES_TERMINAL_WS_PATH}`)
  url.searchParams.set('sessionId', scope.sessionId)
  url.searchParams.set('tab', scope.tabId)
  if (scope.cwd !== undefined) url.searchParams.set('cwd', scope.cwd)
  return url.href
}

function isOutputFrame(value: unknown): value is TerminalOutputFrame {
  if (value === null || typeof value !== 'object') return false
  const frame = value as Partial<TerminalOutputFrame>
  return frame.type === 'output'
    && typeof frame.epoch === 'string'
    && typeof frame.sequence === 'number'
    && typeof frame.bytes === 'number'
    && typeof frame.data === 'string'
}

/** One terminal instance's socket and reconnect loop. */
export class TerminalSocket {
  private readonly url: string | undefined
  private socket: WebSocket | undefined
  private status: 'connecting' | 'ready' | 'closed' = 'connecting'
  private exitProbe = ''
  private scope: TerminalSocketScope | undefined
  private cols = 80
  private rows = 24
  private handlers: TerminalSocketHandlers | undefined
  private manualClose = false
  private outputEpoch: string | undefined = undefined
  private lastSequence: number | undefined = undefined
  private awaitingResync = false
  private readonly generation = new GenerationGate()
  private readonly recovery = new TerminalRecoveryCoordinator<void>({
    recover: async () => { await this.openSocket() },
    classifyError: () => 'retryable',
    onPermanentFailure: (_input, error) => {
      this.handlers?.onError(error instanceof Error ? error.message : String(error))
    },
  })

  constructor(url?: string) {
    this.url = url
  }

  connect(
    cols: number,
    rows: number,
    handlers: TerminalSocketHandlers,
    scope: TerminalSocketScope,
  ): void {
    if (this.scope !== undefined) return
    this.scope = scope
    this.cols = cols
    this.rows = rows
    this.handlers = handlers
    this.manualClose = false
    this.status = 'connecting'
    this.outputEpoch = undefined
    this.lastSequence = undefined
    this.awaitingResync = false
    const generation = this.generation.current()
    void this.recovery.ensure('terminal-socket', undefined, generation).catch(error => {
      if (!this.manualClose) handlers.onError(error instanceof Error ? error.message : String(error))
    })
  }

  sendInput(data: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data)
  }

  sendResize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.sendControl({ type: 'resize', cols, rows })
  }

  /** Detach a rendered tab without telling the host to kill its PTY. */
  disconnect(): void {
    this.cleanup(false)
  }

  /** Reconnect the same scoped PTY after renderer parse-pipeline failure. */
  recover(): void {
    if (this.manualClose || this.scope === undefined || this.handlers === undefined) return
    this.generation.next()
    const socket = this.socket
    this.socket = undefined
    this.status = 'connecting'
    if (socket !== undefined) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
    void this.recovery.ensure('terminal-socket', undefined, this.generation.current()).catch(error => {
      if (!this.manualClose) this.handlers?.onError(error instanceof Error ? error.message : String(error))
    })
  }

  /** Request a renderer resync: the host resets its output epoch and re-sends the replay envelope. */
  requestResync(): void {
    if (this.manualClose || this.scope === undefined || this.handlers === undefined) return
    this.awaitingResync = true
    this.outputEpoch = undefined
    this.lastSequence = undefined
    this.sendControl({ type: 'resync' })
  }

  /** Backwards-compatible explicit close; component cleanup uses disconnect(). */
  close(): void {
    this.terminate()
  }

  /** Explicitly terminate the PTY for a user-closed tab. */
  terminate(): void {
    this.cleanup(true)
  }

  private cleanup(terminatePty: boolean): void {
    this.manualClose = true
    this.generation.next()
    this.recovery.cancel('terminal-socket')
    const socket = this.socket
    this.socket = undefined
    this.scope = undefined
    this.handlers = undefined
    this.status = 'closed'
    if (socket === undefined) return
    socket.onclose = null
    socket.onerror = null
    if (terminatePty && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'close' }))
    }
    socket.close()
  }

  private openSocket(): Promise<void> {
    const scope = this.scope
    const handlers = this.handlers
    const generation = this.generation.current()
    if (scope === undefined || handlers === undefined || this.manualClose) {
      return Promise.reject(new Error('terminal socket is closed'))
    }
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url ?? terminalWebSocketUrl(scope))
      this.socket = socket
      let opened = false
      let settled = false
      const settleOpen = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      socket.onopen = () => {
        if (!this.generation.isCurrent(generation) || this.manualClose) {
          socket.close()
          return
        }
        opened = true
        this.status = 'ready'
        handlers.onReady(scope.cwd ?? '')
        this.sendControl({ type: 'resize', cols: this.cols, rows: this.rows })
        settleOpen()
      }
      socket.onmessage = event => {
        if (!this.generation.isCurrent(generation) || this.manualClose) return
        if (typeof event.data !== 'string') return
        let parsed: unknown
        try {
          parsed = JSON.parse(event.data)
        } catch {
          parsed = null
        }
        if (isOutputFrame(parsed)) {
          const acknowledge = () => {
            this.sendControl({
              type: 'ack',
              epoch: parsed.epoch,
              sequence: parsed.sequence,
              bytes: parsed.bytes,
            } satisfies TerminalOutputAck)
          }
          if (parsed.replay === true) {
            this.outputEpoch = parsed.epoch
            this.lastSequence = parsed.sequence
            this.awaitingResync = false
            handlers.onOutput(parsed.data, undefined)
            this.exitProbe = (this.exitProbe + parsed.data).slice(-1024)
            const frameExit = /\[process exited with code (null|-?\d+)\]/.exec(this.exitProbe)
            if (frameExit !== null && this.status !== 'closed') {
              this.status = 'closed'
              handlers.onExit(frameExit[1] === 'null' ? null : Number(frameExit[1]))
            }
            return
          }
          if (this.awaitingResync) {
            acknowledge()
            return
          }
          if (this.outputEpoch === undefined) {
            this.outputEpoch = parsed.epoch
            this.lastSequence = parsed.sequence
            handlers.onOutput(parsed.data, acknowledge)
            this.exitProbe = (this.exitProbe + parsed.data).slice(-1024)
            const frameExit = /\[process exited with code (null|-?\d+)\]/.exec(this.exitProbe)
            if (frameExit !== null && this.status !== 'closed') {
              this.status = 'closed'
              handlers.onExit(frameExit[1] === 'null' ? null : Number(frameExit[1]))
            }
            return
          }
          if (parsed.epoch !== this.outputEpoch) {
            acknowledge()
            return
          }
          const expected = (this.lastSequence ?? -1) + 1
          if (parsed.sequence > expected) {
            acknowledge()
            this.requestResync()
            return
          }
          if (parsed.sequence < expected) {
            acknowledge()
            return
          }
          this.lastSequence = parsed.sequence
          handlers.onOutput(parsed.data, acknowledge)
          this.exitProbe = (this.exitProbe + parsed.data).slice(-1024)
          const frameExit = /\[process exited with code (null|-?\d+)\]/.exec(this.exitProbe)
          if (frameExit !== null && this.status !== 'closed') {
            this.status = 'closed'
            handlers.onExit(frameExit[1] === 'null' ? null : Number(frameExit[1]))
          }
          return
        }
        handlers.onOutput(event.data)
        this.exitProbe = (this.exitProbe + event.data).slice(-1024)
        const exit = /\[process exited with code (null|-?\d+)\]/.exec(this.exitProbe)
        if (exit !== null && this.status !== 'closed') {
          this.status = 'closed'
          handlers.onExit(exit[1] === 'null' ? null : Number(exit[1]))
        }
      }
      socket.onerror = () => {
        if (!this.generation.isCurrent(generation)) return
        handlers.onError('connection failed')
        if (!opened && !settled) {
          settled = true
          reject(new Error('connection failed'))
        }
      }
      socket.onclose = () => {
        if (!this.generation.isCurrent(generation)) return
        if (!opened && !settled) {
          settled = true
          reject(new Error('connection closed before ready'))
          return
        }
        if (this.socket === socket) this.socket = undefined
        if (this.manualClose) return
        this.status = 'connecting'
        // A transient transport drop is not a process exit. The coordinator
        // retries the same scoped socket with exponential backoff and the host
        // reconnect grace keeps the PTY alive for warm reattach.
        void this.recovery.ensure('terminal-socket', undefined, this.generation.current()).catch(error => {
          if (!this.manualClose) handlers.onError(error instanceof Error ? error.message : String(error))
        })
      }
    })
  }

  private sendControl(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }
}
