import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_TERMINAL_FONT_FALLBACKS,
  buildTerminalFontFamily,
} from '../plugins/shared/terminal-font.ts'

test('buildTerminalFontFamily generates full fallback list when user font is empty', () => {
  const result = buildTerminalFontFamily('')
  assert.equal(result.includes('ui-monospace'), true)
  assert.equal(result.includes('"Symbols Nerd Font Mono"'), true)
  assert.equal(result.includes('"MesloLGS Nerd Font"'), true)
  assert.equal(result.includes('"JetBrainsMono Nerd Font"'), true)
  assert.equal(result.endsWith('monospace'), true)
})

test('buildTerminalFontFamily prepends user font and deduplicates without case sensitivity', () => {
  const result = buildTerminalFontFamily('JetBrains Mono')
  assert.equal(result.startsWith('"JetBrains Mono", ui-monospace'), true)

  const existing = buildTerminalFontFamily('meslolgs nerd font')
  const count = (result.match(/MesloLGS Nerd Font/gi) || []).length
  assert.equal(count, 1)
})

test('buildTerminalFontFamily handles comma-separated user font strings and quotes properly', () => {
  const result = buildTerminalFontFamily('Fira Code, "Custom Hack"')
  assert.equal(result.includes('"Fira Code"'), true)
  assert.equal(result.includes('"Custom Hack"'), true)
})
