/**
 * Unit tests for the text-viewer language detection
 * (plugins/sidebar/src/client/files/language.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_NUMBERED_LINES,
  isPlainLanguage,
  languageForPath,
} from '../plugins/sidebar/src/client/files/language.ts'

test('languageForPath detects common extensions', () => {
  assert.equal(languageForPath('src/main.ts'), 'typescript')
  assert.equal(languageForPath('src/main.tsx'), 'tsx')
  assert.equal(languageForPath('index.js'), 'javascript')
  assert.equal(languageForPath('README.md'), 'markdown')
  assert.equal(languageForPath('config.yaml'), 'yaml')
  assert.equal(languageForPath('script.py'), 'python')
  assert.equal(languageForPath('style.css'), 'css')
  assert.equal(languageForPath('run.sh'), 'zsh')
})

test('languageForPath falls back to text for unknown extensions', () => {
  assert.equal(languageForPath('notes.unknownxyz'), 'text')
  assert.equal(languageForPath('no-extension'), 'text')
  assert.equal(languageForPath('LICENSE'), 'text')
})

test('isPlainLanguage covers the plain rendering set', () => {
  assert.equal(isPlainLanguage(''), true)
  assert.equal(isPlainLanguage('text'), true)
  assert.equal(isPlainLanguage('typescript'), false)
  assert.equal(isPlainLanguage('markdown'), false)
})

test('line-number cap constant stays at the Synara policy value', () => {
  assert.equal(MAX_NUMBERED_LINES, 20_000)
})
