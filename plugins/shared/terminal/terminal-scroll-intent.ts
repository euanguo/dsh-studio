/** Pure user-scroll intent state for terminal output and reveal controls. */
export type TerminalScrollIntent = 'following' | 'paused' | 'revealed'

export interface TerminalScrollIntentState {
  intent: TerminalScrollIntent
  unseenOutput: boolean
}

export type TerminalScrollIntentEvent =
  | { type: 'user-scroll'; atBottom: boolean }
  | { type: 'programmatic-output' }
  | { type: 'return-to-bottom' }
  | { type: 'reveal' }
  | { type: 'reset' }

export const INITIAL_TERMINAL_SCROLL_INTENT: TerminalScrollIntentState = {
  intent: 'following',
  unseenOutput: false,
}

/** Returns whether the terminal should follow newly appended output. */
export function isTerminalScrollPinned(state: TerminalScrollIntentState): boolean {
  return state.intent === 'following'
}

/** Applies one scroll event without mutating the previous state. */
export function transitionTerminalScrollIntent(
  state: TerminalScrollIntentState,
  event: TerminalScrollIntentEvent,
): TerminalScrollIntentState {
  switch (event.type) {
    case 'user-scroll':
      return event.atBottom
        ? { intent: 'following', unseenOutput: false }
        : { intent: 'paused', unseenOutput: state.unseenOutput }
    case 'programmatic-output':
      return state.intent === 'following'
        ? { intent: 'following', unseenOutput: false }
        : { ...state, unseenOutput: true }
    case 'return-to-bottom':
      return { intent: 'following', unseenOutput: false }
    case 'reveal':
      return { intent: 'revealed', unseenOutput: false }
    case 'reset':
      return INITIAL_TERMINAL_SCROLL_INTENT
  }
}

/** Folds a sequence of events into the resulting intent state. */
export function reduceTerminalScrollIntent(
  events: readonly TerminalScrollIntentEvent[],
  initial: TerminalScrollIntentState = INITIAL_TERMINAL_SCROLL_INTENT,
): TerminalScrollIntentState {
  return events.reduce(transitionTerminalScrollIntent, initial)
}
