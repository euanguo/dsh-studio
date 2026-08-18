/**
 * Headless xterm mode/screen replay for retained PTYs.
 *
 * Adapted from Synara's `apps/server/src/terminal/terminalModeReplay.ts`.
 * The headless terminal consumes the same raw PTY stream as the renderer, so a
 * reconnect can rebuild the active screen and input modes instead of replaying
 * raw cursor controls into a blank xterm.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Terminal: HeadlessTerminal } = require('@xterm/headless') as typeof import('@xterm/headless')

export interface TerminalModeReplayTracker {
  feed(data: string): void
  resize(cols: number, rows: number): void
  buildPreamble(): string
  buildScreenReplay(): string
  dispose(): void
}

type HeadlessTerminalInternals = {
  _core?: {
    _writeBuffer?: { writeSync(data: string | Uint8Array): void }
    coreService?: { isCursorHidden?: boolean }
    mouseStateService?: { activeEncoding?: string }
    optionsService?: { rawOptions: { vtExtensions?: { kittyKeyboard?: boolean } } }
  }
}

interface KittyKeyboardReplayState {
  flags: number
  pendingSequence: string
  stack: number[]
}

const KITTY_KEYBOARD_SEQUENCE_PATTERN = /(?:\u001b\[|\u009b)([<>=])([0-9;]*)u/g

function parseKittyFlags(rawParams: string): number {
  const flags = Number(rawParams.split(';')[0] ?? '')
  return Number.isInteger(flags) && flags > 0 ? flags : 0
}

function retainPotentialKittySequenceTail(input: string, startIndex: number): string {
  const tail = input.slice(startIndex)
  const escCsiIndex = tail.lastIndexOf('\u001b[')
  const c1CsiIndex = tail.lastIndexOf('\u009b')
  const csiIndex = Math.max(escCsiIndex, c1CsiIndex)
  return csiIndex >= 0 ? tail.slice(csiIndex, csiIndex + 128) : ''
}

function feedKittyKeyboardReplayState(state: KittyKeyboardReplayState, data: string): void {
  const input = `${state.pendingSequence}${data}`
  let processedUntil = 0
  KITTY_KEYBOARD_SEQUENCE_PATTERN.lastIndex = 0
  for (const match of input.matchAll(KITTY_KEYBOARD_SEQUENCE_PATTERN)) {
    processedUntil = (match.index ?? 0) + match[0].length
    const command = match[1]
    if (command === '>') {
      state.stack.push(state.flags)
      state.flags = parseKittyFlags(match[2] ?? '')
    } else if (command === '<') {
      state.flags = state.stack.pop() ?? 0
    } else if (command === '=') {
      state.flags = parseKittyFlags(match[2] ?? '')
      state.stack.length = 0
    }
  }
  state.pendingSequence = retainPotentialKittySequenceTail(input, processedUntil)
}

function colorSgr(
  prefix: 38 | 48,
  color: number,
  isDefault: boolean,
  isPalette: boolean,
  isRgb: boolean,
): string[] {
  if (isDefault) return []
  if (isRgb) {
    return [String(prefix), '2', String((color >> 16) & 0xff), String((color >> 8) & 0xff), String(color & 0xff)]
  }
  if (isPalette) return [String(prefix), '5', String(color)]
  return []
}

type HeadlessCell = ReturnType<import('@xterm/headless').IBuffer['getNullCell']>

function cellSgr(cell: HeadlessCell): string {
  const parts = [
    ...(cell.isBold() ? ['1'] : []),
    ...(cell.isDim() ? ['2'] : []),
    ...(cell.isItalic() ? ['3'] : []),
    ...(cell.isUnderline() ? ['4'] : []),
    ...(cell.isBlink() ? ['5'] : []),
    ...(cell.isInverse() ? ['7'] : []),
    ...(cell.isInvisible() ? ['8'] : []),
    ...(cell.isStrikethrough() ? ['9'] : []),
    ...(cell.isOverline() ? ['53'] : []),
    ...colorSgr(38, cell.getFgColor(), cell.isFgDefault(), cell.isFgPalette(), cell.isFgRGB()),
    ...colorSgr(48, cell.getBgColor(), cell.isBgDefault(), cell.isBgPalette(), cell.isBgRGB()),
  ]
  return parts.length > 0 ? `\u001b[0;${parts.join(';')}m` : '\u001b[0m'
}

function cellHasVisibleState(cell: HeadlessCell): boolean {
  return cell.getChars().length > 0
    || !cell.isFgDefault()
    || !cell.isBgDefault()
    || Boolean(
      cell.isBold()
      || cell.isDim()
      || cell.isItalic()
      || cell.isUnderline()
      || cell.isBlink()
      || cell.isInverse()
      || cell.isInvisible()
      || cell.isStrikethrough()
      || cell.isOverline(),
    )
}

export function createTerminalModeReplayTracker(cols: number, rows: number): TerminalModeReplayTracker {
  const terminal = new HeadlessTerminal({
    cols,
    rows,
    scrollback: 1,
    allowProposedApi: true,
  })
  const internals = terminal as unknown as HeadlessTerminalInternals
  const rawOptions = internals._core?.optionsService?.rawOptions
  const writeBuffer = internals._core?._writeBuffer
  if (!rawOptions || typeof writeBuffer?.writeSync !== 'function') {
    terminal.dispose()
    throw new Error('@xterm/headless internals unavailable for terminal mode replay')
  }
  rawOptions.vtExtensions = { kittyKeyboard: true }
  const kittyKeyboardState: KittyKeyboardReplayState = { flags: 0, pendingSequence: '', stack: [] }

  return {
    feed(data: string): void {
      feedKittyKeyboardReplayState(kittyKeyboardState, data)
      writeBuffer.writeSync(data)
    },
    resize(nextCols: number, nextRows: number): void {
      if (terminal.cols === nextCols && terminal.rows === nextRows) return
      terminal.resize(nextCols, nextRows)
    },
    buildPreamble(): string {
      const modes = terminal.modes
      const parts: string[] = []
      if (modes.applicationCursorKeysMode) parts.push('\u001b[?1h')
      if (modes.applicationKeypadMode) parts.push('\u001b[?66h')
      if (modes.bracketedPasteMode) parts.push('\u001b[?2004h')
      if (modes.insertMode) parts.push('\u001b[4h')
      if (modes.originMode) parts.push('\u001b[?6h')
      if (modes.reverseWraparoundMode) parts.push('\u001b[?45h')
      if (modes.sendFocusMode) parts.push('\u001b[?1004h')
      if (modes.mouseTrackingMode === 'x10') parts.push('\u001b[?9h')
      if (modes.mouseTrackingMode === 'vt200') parts.push('\u001b[?1000h')
      if (modes.mouseTrackingMode === 'drag') parts.push('\u001b[?1002h')
      if (modes.mouseTrackingMode === 'any') parts.push('\u001b[?1003h')
      if (internals._core?.mouseStateService?.activeEncoding === 'SGR') parts.push('\u001b[?1006h')
      if (internals._core?.mouseStateService?.activeEncoding === 'SGR_PIXELS') parts.push('\u001b[?1016h')
      if (!modes.wraparoundMode) parts.push('\u001b[?7l')
      if (internals._core?.coreService?.isCursorHidden === true) parts.push('\u001b[?25l')
      if (kittyKeyboardState.flags > 0) parts.push(`\u001b[=${kittyKeyboardState.flags};1u`)
      return parts.join('')
    },
    buildScreenReplay(): string {
      const buffer = terminal.buffer.active
      if (buffer.type !== 'alternate') {
        return ''
      }
      const startLine = Math.max(0, buffer.baseY)
      const endLine = Math.min(buffer.length, startLine + terminal.rows)
      const parts = [
        '\u001b[?1049h',
        '\u001b[2J\u001b[H',
      ]
      let activeSgr = '\u001b[0m'
      const cell = buffer.getNullCell()
      for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
        const line = buffer.getLine(lineIndex)
        parts.push(`\u001b[${lineIndex - startLine + 1};1H`)
        let lastVisibleColumn = -1
        if (line) {
          for (let column = 0; column < line.length; column += 1) {
            const current = line.getCell(column, cell)
            if (current && current.getWidth() > 0 && cellHasVisibleState(current)) lastVisibleColumn = column
          }
          for (let column = 0; column <= lastVisibleColumn; column += 1) {
            const current = line.getCell(column, cell)
            if (!current || current.getWidth() === 0) continue
            const nextSgr = cellSgr(current)
            if (nextSgr !== activeSgr) {
              parts.push(nextSgr)
              activeSgr = nextSgr
            }
            parts.push(current.getChars() || ' ')
          }
        }
      }
      parts.push('\u001b[0m', `\u001b[${Math.max(1, buffer.cursorY + 1)};${Math.max(1, buffer.cursorX + 1)}H`)
      return parts.join('')
    },
    dispose(): void {
      terminal.dispose()
    },
  }
}
