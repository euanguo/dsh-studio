/**
 * The first-class terminal surface — rendered both as a right-rail tab and
 * as a center-surface terminal (the middle "+" menu and the rail both open
 * it). Every terminal instance owns an independent pty: the instance id
 * (`tabId`) is the terminal's identity in the host's `/capabilities/ws/terminal`
 * protocol, so opening N terminal tabs spins up N shells.
 *
 * The terminal is PROJECT-dimension: the instance belongs to the project
 * cwd, so a terminal opened in one conversation of a project is the same
 * shell in every conversation of that project (B1: project-shared PTY).
 */
import { useEffect, useSyncExternalStore } from 'react'
import { TerminalView } from '@dsh-studio/shared/terminal-view'
import { touchTerminalInstance } from './runtimes/terminal-runtime.ts'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from './i18n.ts'
import type { SidebarRuntimeSettingsService } from './runtime-settings.ts'

export interface TerminalTabContentProps {
  cwd: string | null
  /** Unique instance id — one shell per tab (right-rail tab id or center
   *  surface id). */
  tabId: string
  runtime: SidebarRuntimeSettingsService
  onTitleChange?(title: string): void
  onLink?(uri: string): void
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
  useEffect(() => {
    if (props.cwd === null || props.cwd === '') return
    touchTerminalInstance({ cwd: props.cwd }, props.tabId)
  }, [props.cwd, props.tabId])
  return (
    <div className="dsh-studio-side-terminal">
      <TerminalView
        sessionId={props.cwd ?? ''}
        tabId={props.tabId}
        cwd={props.cwd}
        fontFamily={preferences.terminalFontFamily}
        fontSize={preferences.terminalFontSize}
         scrollbackRows={preferences.terminalScrollbackRows}
         mouseWheelMultiplier={preferences.terminalMouseWheelMultiplier}
         ligatures={preferences.terminalLigatures}
         gpuAcceleration={preferences.terminalGpuAcceleration}
         {...(props.onTitleChange === undefined ? {} : { onTitleChange: props.onTitleChange })}
         {...(props.onLink === undefined ? {} : { onLink: props.onLink })}
        t={t}
      />
    </div>
  )
}
