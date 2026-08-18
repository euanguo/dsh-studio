export type TerminalActivityState = 'idle' | 'running' | 'review' | 'attention' | 'exited'

export interface TerminalActivitySnapshot {
  state: TerminalActivityState
  unreadOutput: boolean
}

export type TerminalActivityEvent =
  | { type: 'input' }
  | { type: 'output'; attached: boolean }
  | { type: 'attention' }
  | { type: 'reveal' }
  | { type: 'exit' }
  | { type: 'reset' }

export const INITIAL_TERMINAL_ACTIVITY: TerminalActivitySnapshot = {
  state: 'idle',
  unreadOutput: false,
}

/** Pure activity transition used by the retained terminal owner. */
export function transitionTerminalActivity(
  snapshot: TerminalActivitySnapshot,
  event: TerminalActivityEvent,
): TerminalActivitySnapshot {
  switch (event.type) {
    case 'input':
      return { state: 'running', unreadOutput: false }
    case 'output':
      return event.attached
        ? { state: 'running', unreadOutput: false }
        : { state: 'review', unreadOutput: true }
    case 'attention':
      return { state: 'attention', unreadOutput: snapshot.unreadOutput }
    case 'reveal':
      return { state: 'running', unreadOutput: false }
    case 'exit':
      return { state: 'exited', unreadOutput: snapshot.unreadOutput }
    case 'reset':
      return INITIAL_TERMINAL_ACTIVITY
  }
}
