/**
 * Replay-safe terminal history sanitizer, ported from synara's
 * `apps/server/src/terminal/output/history.ts`.
 *
 * Raw PTY output is useful for diagnostics and tool reads, but replaying raw
 * cursor/erase/query/mode controls into a fresh xterm can move prompts off
 * screen or leave a TUI in the wrong state. This parser preserves styling,
 * carries incomplete escape sequences across chunks, and exposes title/agent
 * hook signals without coupling the host to Synara contracts.
 */

const SYNARA_TERMINAL_HOOK_OSC_PREFIX = '633;SYNARA_AGENT_EVENT='

export type TerminalHistoryHookEvent = 'Start' | 'Stop' | 'PermissionRequest'

export interface SanitizedTerminalChunk {
  visibleText: string
  pendingControlSequence: string
  titleSignals: string[]
  hookEvents: TerminalHistoryHookEvent[]
  /**
   * True when this chunk contained an erase-screen (CSI ED with mode 2 or
   * 3). The caller must reset its retained transcript to a blank screen:
   * text erased by the user must not resurface in a reconnect replay.
   */
  clearScreen: boolean
}

function isCsiFinalByte(codePoint: number): boolean {
  return codePoint >= 0x40 && codePoint <= 0x7e
}

function shouldKeepCsiSequence(finalByte: string): boolean {
  // Keep SGR styling; strip cursor movement, erase, query/reply and modes.
  return finalByte === 'm'
}

/**
 * CSI Ps J (ED): mode 0/absent = cursor→end, 1 = start→cursor, 2 = whole
 * screen, 3 = whole screen + scrollback. Only 2/3 erase everything the user
 * can see, so only they reset the retained visible projection. Partial
 * erases are cursor-position-dependent and stay stripped like today.
 */
function isFullScreenErase(params: string, finalByte: string): boolean {
  if (finalByte !== 'J') return false
  const mode = params.split(';').filter(part => part !== '').at(-1)
  return mode === '2' || mode === '3'
}

function stripStringTerminator(value: string): string {
  if (value.endsWith('\u001b\\')) return value.slice(0, -2)
  const last = value.at(-1)
  if (last === '\u0007' || last === '\u009c') return value.slice(0, -1)
  return value
}

function findStringTerminatorIndex(input: string, start: number): number | null {
  for (let index = start; index < input.length; index += 1) {
    const codePoint = input.charCodeAt(index)
    if (codePoint === 0x07 || codePoint === 0x9c) return index + 1
    if (codePoint === 0x1b && input.charCodeAt(index + 1) === 0x5c) return index + 2
  }
  return null
}

function isEscapeIntermediateByte(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint <= 0x2f
}

function isEscapeFinalByte(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x7e
}

function findEscapeSequenceEndIndex(input: string, start: number): number | null {
  let cursor = start
  while (cursor < input.length && isEscapeIntermediateByte(input.charCodeAt(cursor))) cursor += 1
  if (cursor >= input.length) return null
  return isEscapeFinalByte(input.charCodeAt(cursor)) ? cursor + 1 : start + 1
}

function extractOscTitle(content: string): string | null {
  const match = content.match(/^(?:0|2);([\s\S]+)$/)
  return match?.[1]?.trim() || null
}

function extractHookEvent(content: string): TerminalHistoryHookEvent | null {
  // DSH accepts the same simple OSC hook vocabulary without importing the
  // upstream Synara contract package.
  const prefix = SYNARA_TERMINAL_HOOK_OSC_PREFIX
  if (!content.startsWith(prefix)) return null
  const eventType = content.slice(prefix.length).trim()
  return eventType === 'Start' || eventType === 'Stop' || eventType === 'PermissionRequest'
    ? eventType
    : null
}

function shouldStripOscSequence(content: string): boolean {
  return /^(10|11|12);(?:\?|rgb:)/.test(content)
    || content.startsWith(SYNARA_TERMINAL_HOOK_OSC_PREFIX)
}

/** Parse one ordered PTY chunk while preserving incomplete escape state. */
export function sanitizeTerminalHistoryChunk(
  pendingControlSequence: string,
  data: string,
): SanitizedTerminalChunk {
  const input = `${pendingControlSequence}${data}`
  let visibleText = ''
  let clearScreen = false
  let index = 0
  const titleSignals: string[] = []
  const hookEvents: TerminalHistoryHookEvent[] = []
  const append = (value: string): void => { visibleText += value }
  const dropVisibleText = (): void => { visibleText = '' }
  const pending = (): SanitizedTerminalChunk => ({
    visibleText,
    pendingControlSequence: input.slice(index),
    titleSignals,
    hookEvents,
    clearScreen,
  })
  const done = (): SanitizedTerminalChunk => ({
    visibleText,
    pendingControlSequence: '',
    titleSignals,
    hookEvents,
    clearScreen,
  })

  while (index < input.length) {
    const codePoint = input.charCodeAt(index)
    if (codePoint === 0x1b) {
      const nextCodePoint = input.charCodeAt(index + 1)
      if (Number.isNaN(nextCodePoint)) {
        return pending()
      }
      if (nextCodePoint === 0x5b) {
        let cursor = index + 2
        while (cursor < input.length && !isCsiFinalByte(input.charCodeAt(cursor))) cursor += 1
        if (cursor >= input.length) {
          return pending()
        }
        const finalByte = input[cursor] ?? ''
        const sequence = input.slice(index, cursor + 1)
        if (shouldKeepCsiSequence(finalByte)) {
          append(sequence)
        } else if (isFullScreenErase(input.slice(index + 2, cursor), finalByte)) {
          // Erase-screen: the user cleared the display. Drop everything
          // retained so far (including pre-clear text of this chunk) so a
          // reconnect replays the post-clear state, not the erased text.
          dropVisibleText()
          clearScreen = true
        }
        index = cursor + 1
        continue
      }
      if (nextCodePoint === 0x5d || nextCodePoint === 0x50 || nextCodePoint === 0x5e || nextCodePoint === 0x5f) {
        const terminatorIndex = findStringTerminatorIndex(input, index + 2)
        if (terminatorIndex === null) {
          return pending()
        }
        const sequence = input.slice(index, terminatorIndex)
        const content = stripStringTerminator(input.slice(index + 2, terminatorIndex))
        const hookEvent = extractHookEvent(content)
        if (hookEvent) hookEvents.push(hookEvent)
        const title = extractOscTitle(content)
        if (title) titleSignals.push(title)
        if (!shouldStripOscSequence(content)) append(sequence)
        index = terminatorIndex
        continue
      }
      const escapeEnd = findEscapeSequenceEndIndex(input, index + 1)
      if (escapeEnd === null) {
        return pending()
      }
      const sequence = input.slice(index, escapeEnd)
      // Save/restore cursor is stateful and unsafe in a fresh replay buffer.
      if (sequence !== '\u001b7' && sequence !== '\u001b8') append(sequence)
      index = escapeEnd
      continue
    }

    if (codePoint === 0x9b) {
      let cursor = index + 1
      while (cursor < input.length && !isCsiFinalByte(input.charCodeAt(cursor))) cursor += 1
      if (cursor >= input.length) {
        return pending()
      }
      const finalByte = input[cursor] ?? ''
      const sequence = input.slice(index, cursor + 1)
      if (shouldKeepCsiSequence(finalByte)) {
        append(sequence)
      } else if (isFullScreenErase(input.slice(index + 1, cursor), finalByte)) {
        dropVisibleText()
        clearScreen = true
      }
      index = cursor + 1
      continue
    }

    if (codePoint === 0x9d || codePoint === 0x90 || codePoint === 0x9e || codePoint === 0x9f) {
      const terminatorIndex = findStringTerminatorIndex(input, index + 1)
      if (terminatorIndex === null) {
        return pending()
      }
      const sequence = input.slice(index, terminatorIndex)
      const content = stripStringTerminator(input.slice(index + 1, terminatorIndex))
      const hookEvent = extractHookEvent(content)
      if (hookEvent) hookEvents.push(hookEvent)
      const title = extractOscTitle(content)
      if (title) titleSignals.push(title)
      if (codePoint !== 0x9d || !shouldStripOscSequence(content)) append(sequence)
      index = terminatorIndex
      continue
    }

    append(input[index] ?? '')
    index += 1
  }

  return done()
}

export class TerminalHistorySanitizer {
  private pendingControlSequence = ''

  feed(data: string): SanitizedTerminalChunk {
    const result = sanitizeTerminalHistoryChunk(this.pendingControlSequence, data)
    this.pendingControlSequence = result.pendingControlSequence
    return result
  }

  reset(): void {
    this.pendingControlSequence = ''
  }

  get pending(): string {
    return this.pendingControlSequence
  }
}

// unwired-capability: restored from HEAD. Persisted-history sanitization is
// now applied through TerminalHistorySanitizer.feed() on the replay path, so
// this one-shot helper is not referenced anywhere in the tree. Kept exported
// (same HEAD signature) for external callers; it is not part of the wired
// terminal flow.
export function sanitizePersistedTerminalHistory(history: string): string {
  if (history.length === 0) return history
  return sanitizeTerminalHistoryChunk('', history).visibleText
}
