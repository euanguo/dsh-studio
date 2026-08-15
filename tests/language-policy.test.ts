/**
 * Unit tests for the text-viewer language detection + degradation policy
 * (plugins/sidebar/src/client/files/language.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_HIGHLIGHT_CHARS,
  MAX_NUMBERED_LINES,
  fileViewPolicy,
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

test('fileViewPolicy routes known languages under the size cap to pierre', () => {
  assert.deepEqual(fileViewPolicy('main.ts', 100), { language: 'typescript', pierre: true })
  assert.deepEqual(fileViewPolicy('README.md', 10_000), { language: 'markdown', pierre: true })
})

test('fileViewPolicy degrades oversized files to plain text', () => {
  const policy = fileViewPolicy('main.ts', MAX_HIGHLIGHT_CHARS + 1)
  assert.equal(policy.language, 'typescript')
  assert.equal(policy.pierre, false)
})

test('fileViewPolicy keeps the boundary inclusive at the cap', () => {
  const policy = fileViewPolicy('main.ts', MAX_HIGHLIGHT_CHARS)
  assert.equal(policy.pierre, true)
})

test('fileViewPolicy degrades unknown languages to plain text', () => {
  const policy = fileViewPolicy('data.unknownxyz', 10)
  assert.equal(policy.language, 'text')
  assert.equal(policy.pierre, false)
})

test('line-number cap constant stays at the Synara policy value', () => {
  assert.equal(MAX_NUMBERED_LINES, 20_000)
  assert.equal(MAX_HIGHLIGHT_CHARS, 250_000)
})
