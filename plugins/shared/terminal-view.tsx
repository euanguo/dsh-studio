import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { TerminalSocket } from './terminal-socket.ts'
import { resolveTerminalTheme } from './terminal-theme.ts'

export type TerminalViewStatus = 'connecting' | 'ready' | 'exited' | 'error'

/** The minimal translator the terminal view needs (the caller binds its own
 *  dictionary — the terminal messages reuse the sidebar/terminal keys). */
export type TerminalViewT = (key: string, params?: Record<string, unknown>) => string

export interface TerminalViewProps {
  sessionId: string
  tabId: string
  cwd?: string | null
  fontFamily: string
  fontSize: number
  onReady?(cwd: string): void
  onStatus?(status: TerminalViewStatus, exitCode?: number | null): void
  t: TerminalViewT
}

/** One persistent xterm/PTY pair (shared renderer for the right-rail tab and
 *  the center-surface terminal). It is destroyed only when its tab closes. */
export function TerminalView(props: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const onReadyRef = useRef(props.onReady)
  const onStatusRef = useRef(props.onStatus)
  onReadyRef.current = props.onReady
  onStatusRef.current = props.onStatus

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: props.fontFamily,
      fontSize: props.fontSize,
      scrollback: 5000,
      theme: resolveTerminalTheme(),
    })
    const fitAddon = new FitAddon()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = resolveTerminalTheme()
    })
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme', 'style', 'class'],
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    const socket = new TerminalSocket()
    let exited = false
    const markExited = (code: number | null): void => {
      if (exited) return
      exited = true
      onStatusRef.current?.('exited', code)
      terminal.write(`\r\n\x1b[90m[${props.t('terminal.process-exited', {
        code: code ?? props.t('terminal.unknown'),
      })}]\x1b[0m\r\n`)
    }
    const requestedCwd = props.cwd?.trim()
    socket.connect(terminal.cols, terminal.rows, {
      onOutput: data => { terminal.write(data) },
      onReady: cwd => {
        onStatusRef.current?.('ready')
        onReadyRef.current?.(cwd)
      },
      onExit: markExited,
      onError: message => {
        if (!exited) onStatusRef.current?.('error')
        terminal.write(`\r\n\x1b[31m[${props.t('terminal.error', { message })}]\x1b[0m\r\n`)
      },
    }, {
      sessionId: props.sessionId,
      tabId: props.tabId,
      ...(requestedCwd ? { cwd: requestedCwd } : {}),
    })

    const inputSubscription = terminal.onData(data => { socket.sendInput(data) })
    const resizeSubscription = terminal.onResize(({ cols, rows }) => { socket.sendResize(cols, rows) })
    const fit = (): void => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      try {
        fitAddon.fit()
      } catch {
        // A hidden surface will be fitted when visible again.
      }
    }
    fit()
    const resizeObserver = new ResizeObserver(fit)
    resizeObserver.observe(container)
    terminal.focus()

    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      inputSubscription.dispose()
      resizeSubscription.dispose()
      socket.close()
      if (terminalRef.current === terminal) terminalRef.current = null
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null
      terminal.dispose()
    }
  }, [props.cwd, props.sessionId, props.tabId])

  useEffect(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (terminal === null || fitAddon === null) return
    terminal.options.fontFamily = props.fontFamily
    terminal.options.fontSize = props.fontSize
    try {
      fitAddon.fit()
    } catch {
      // ResizeObserver retries when the surface becomes measurable.
    }
  }, [props.fontFamily, props.fontSize])

  return <div ref={containerRef} className="oh-dsh-terminal-view" data-terminal-view={props.tabId} />
}