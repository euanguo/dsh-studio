/**
 * Client half of the git freshness push (`/capabilities/ws/git-watch`).
 * One connection == one cwd subscription, mirroring the server lifecycle.
 *
 * Reconnect policy: exponential backoff (400ms → 5s cap) while the panel
 * wants freshness; the owner uses `onConnection(false)` to switch to its
 * fallback poll and `onConnection(true)` to drop it again after a catch-up
 * refresh. Closing the handle stops everything.
 */

/** Fallback poll cadence used only while the push socket is disconnected. */
export const GIT_FALLBACK_POLL_MS = 4_000

const RECONNECT_BASE_MS = 400
const RECONNECT_CAP_MS = 5_000

export interface GitWatchOptions {
  /** A change frame arrived — pull fresh data through the normal RPCs. */
  onChanged(): void
  /** Socket connectivity flipped; `true` means the push channel is usable. */
  onConnection?(connected: boolean): void
}

export interface GitWatchHandle {
  close(): void
}

export function openGitWatch(cwd: string, options: GitWatchOptions): GitWatchHandle {
  let closed = false
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0

  const connect = (): void => {
    if (closed) return
    const url = `${window.location.origin.replace(/^http/, 'ws')}/capabilities/ws/git-watch?cwd=${encodeURIComponent(cwd)}`
    try {
      socket = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }
    socket.onopen = () => {
      attempt = 0
      options.onConnection?.(true)
    }
    socket.onmessage = event => {
      try {
        const frame = JSON.parse(String(event.data)) as { type?: unknown }
        if (frame.type === 'changed') options.onChanged()
      } catch {
        // Ignore malformed frames; the next change re-notifies.
      }
    }
    socket.onclose = () => {
      socket = null
      if (closed) return
      options.onConnection?.(false)
      scheduleReconnect()
    }
    socket.onerror = () => {}
  }

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer !== undefined) return
    const delay = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempt, 4))
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, delay)
  }

  connect()

  return {
    close(): void {
      closed = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      options.onConnection?.(false)
      socket?.close()
      socket = null
    },
  }
}
