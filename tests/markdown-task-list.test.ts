/**
 * Unit tests for P1 markdown task-list helpers
 * (plugins/sidebar/src/client/files/markdown-task-list.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  findTaskMarkerSourceLines,
  toggleMarkdownTaskMarker,
} from '../plugins/sidebar/src/client/files/markdown-task-list.ts'

test('toggleMarkdownTaskMarker flips GFM task markers', () => {
  assert.equal(toggleMarkdownTaskMarker('- [ ] todo', 1, true), '- [x] todo')
  assert.equal(toggleMarkdownTaskMarker('- [x] done', 1, false), '- [ ] done')
  assert.equal(toggleMarkdownTaskMarker('- [X] done', 1, false), '- [ ] done')
  assert.equal(toggleMarkdownTaskMarker('* [ ] star', 1, true), '* [x] star')
  assert.equal(toggleMarkdownTaskMarker('1. [ ] ordered', 1, true), '1. [x] ordered')
  assert.equal(toggleMarkdownTaskMarker('    - [ ] nested', 1, true), '    - [x] nested')
  assert.equal(toggleMarkdownTaskMarker('> - [ ] quoted', 1, true), '> - [x] quoted')
})

test('toggleMarkdownTaskMarker rejects non-task lines and invalid lines', () => {
  assert.equal(toggleMarkdownTaskMarker('plain text', 1, true), null)
  assert.equal(toggleMarkdownTaskMarker('- [ ] only', 0, true), null)
  assert.equal(toggleMarkdownTaskMarker('- [ ] only', 9, true), null)
})

test('findTaskMarkerSourceLines returns 1-based line numbers in order', () => {
  const source = [
    '# Title',
    '',
    '- [ ] first',
    '  - [x] second',
    'not a task',
    '1. [ ] third',
  ].join('\n')
  assert.deepEqual(findTaskMarkerSourceLines(source), [3, 4, 6])
  assert.deepEqual(findTaskMarkerSourceLines('# no tasks'), [])
})

test('toggleMarkdownTaskMarker preserves indentation and trailing content', () => {
  assert.equal(
    toggleMarkdownTaskMarker('  - [ ] fix **this** now', 1, true),
    '  - [x] fix **this** now',
  )
})
