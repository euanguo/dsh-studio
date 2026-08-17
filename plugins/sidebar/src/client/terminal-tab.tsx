/**
 * The first-class terminal surface — rendered both as a right-rail tab and
 * as a center-surface terminal (the middle "+" menu and the rail both open
 * it). Every terminal instance owns an independent pty: the instance id
 * (`tabId`) is the terminal's identity in the host's `/sidebar/ws/terminal`
 * protocol, so opening N terminal tabs spins up N shells.
 */
import { useSyncExternalStore } from 'react'
import { TerminalView } from '@oh-dsh/shared/terminal-view'
import type { Translate } from '@oh-dsh/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import type { SidebarRuntimeSettingsService } from './runtime-settings.ts'

export interface TerminalTabContentProps {
  sessionId: string
  cwd: string | null
  /** Unique instance id — one shell per tab (right-rail tab id or center
   *  surface id). */
  tabId: string
  runtime: SidebarRuntimeSettingsService
  t: Translate<WorkspaceMessage>
}

/** xterm/PTY body ready to fill a right-rail tab or the center column. */
export function TerminalTabContent(props: TerminalTabContentProps): JSX.Element {
  const preferences = useSyncExternalStore(
    props.runtime.subscribe,
    props.runtime.getSnapshot,
  ).preferences
  // The shared view asks for a `(key: string, params?)` translator; our
  // messages dictionary carries the terminal.process-exited / terminal.error
  // / terminal.unknown keys used inside the view.
  const t: (key: string, params?: Record<string, unknown>) => string =
    (key, params) => props.t(key as WorkspaceMessage, params)
  return (
    <div className="oh-dsh-side-terminal">
      <TerminalView
        sessionId={props.sessionId}
        tabId={props.tabId}
        cwd={props.cwd}
        fontFamily={preferences.terminalFontFamily}
        fontSize={preferences.terminalFontSize}
        t={t}
      />
    </div>
  )
}