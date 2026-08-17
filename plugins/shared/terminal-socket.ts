/**
 * Terminal WebSocket client for the Oh-DSH desktop terminal (shared).
 *
 * Talks the Better Sidebar raw-PTY protocol over
 * `/sidebar/ws/terminal?sessionId=…&tab=…&cwd=…` — one socket per terminal
 * instance (`tabId`), so every terminal tab owns an independent shell.
 * Moved here from plugins/panel-controls so the right-rail terminal tab and
 * the center-surface terminal render the same wired component.
 */

export interface TerminalSocketHandlers {
  onOutput(data: string): void
  onReady(cwd: string): void
  onExit(code: number | null): void
  onError(message: string): void
}

export interface TerminalSocketScope {
  cwd?: string
  sessionId: string
  tabId: string
}

export const BETTER_SIDEBAR_TERMINAL_WS_PATH = '/sidebar/ws/terminal'

export function terminalWebSocketUrl(scope: TerminalSocketScope): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${protocol}//${window.location.host}${BETTER_SIDEBAR_TERMINAL_WS_PATH}`)
  url.searchParams.set('sessionId', scope.sessionId)
  url.searchParams.set('tab', scope.tabId)
  if (scope.cwd !== undefined) url.searchParams.set('cwd', scope.cwd)
  return url.href
}

/** One terminal instance's socket. Closed on unmount → the host releases
 *  the pty; a later mount of the same tab id reconnects a fresh shell. */
export class TerminalSocket {
  private readonly url: string | undefined
  private socket: WebSocket | undefined
  private status: 'connecting' | 'ready' | 'closed' = 'connecting'
  private exitProbe = ''

  constructor(url?: string) {
    this.url = url
  }

  connect(
    cols: number,
    rows: number,
    handlers: TerminalSocketHandlers,
    scope: TerminalSocketScope,
  ): void {
    if (this.socket !== undefined) return
    const socket = new WebSocket(this.url ?? terminalWebSocketUrl(scope))
    this.socket = socket
    this.status = 'connecting'
    socket.onopen = () => {
      this.status = 'ready'
      handlers.onReady(scope.cwd ?? '')
      this.sendControl({ type: 'resize', cols, rows })
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      handlers.onOutput(event.data)
      this.exitProbe = (this.exitProbe + event.data).slice(-256)
      const exit = /\[process exited with code (-?\d+)\]/.exec(this.exitProbe)
      if (exit !== null && this.status !== 'closed') {
        this.status = 'closed'
        handlers.onExit(Number(exit[1]))
      }
    }
    socket.onclose = () => {
      if (this.status === 'closed') return
      this.status = 'closed'
      handlers.onExit(null)
    }
    socket.onerror = () => { handlers.onError('connection failed') }
  }

  sendInput(data: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data)
  }

  sendResize(cols: number, rows: number): void {
    this.sendControl({ type: 'resize', cols, rows })
  }

  close(): void {
    const socket = this.socket
    this.socket = undefined
    if (socket === undefined) return
    socket.onclose = null
    socket.onerror = null
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'close' }))
    socket.close()
  }

  private sendControl(message: { type: 'resize'; cols: number; rows: number }): void {
    if (this.socket?.readyState === WebSocket.OPEN) socketSend(this.socket, message)
  }
}

function socketSend(socket: WebSocket, message: unknown): void {
  socket.send(JSON.stringify(message))
}