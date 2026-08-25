import { useEffect, useRef } from 'react'
import {
  getTerminalRuntimeOwner,
  type TerminalRuntimeOwnerOptions,
} from './terminal-runtime-owner.ts'

export interface TerminalViewProps extends TerminalRuntimeOwnerOptions {}

/**
 * React adapter for the retained terminal owner. The component owns only a
 * host div: tab switches detach the xterm DOM and surface observers while the
 * module-level owner keeps the PTY socket, xterm buffer, mode tracker, and
 * output scheduler warm until explicit tab close.
 */
export function TerminalView(props: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const ownerKey = `${props.sessionId}:${props.tabId}`

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const owner = getTerminalRuntimeOwner(props)
    owner.attach(container, props)
    return () => { owner.detach() }
  }, [props.cwd, props.sessionId, props.tabId])

  useEffect(() => {
    const owner = getTerminalRuntimeOwner(props)
    owner.update(props)
  }, [
    ownerKey,
    props.fontFamily,
    props.fontSize,
    props.scrollbackRows,
    props.mouseWheelMultiplier,
    props.ligatures,
    props.gpuAcceleration,
    props.onReady,
    props.onTitleChange,
    props.onLink,
    props.onStatus,
    props.t,
  ])

  return <div ref={containerRef} className="dsh-studio-terminal-view" data-terminal-view={props.tabId} />
}
