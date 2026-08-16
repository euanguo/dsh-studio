/**
 * Unit tests for the porcelain v2 status parser (plugins/shared/git-core.ts).
 * Sample outputs mirror real `git status --porcelain=2 --branch` formats
 * (verified against git 2.x with `core.quotePath=false`).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCommitFilesZ, parsePorcelainV2 } from '../plugins/shared/git-core.ts'

test('parsePorcelainV2: branch/upstream/ahead-behind plus ordinary entries', () => {
  const result = parsePorcelainV2([
    '# branch.oid e84fb1f9ad637e482604d36836d3fb29a87cb30c',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +1 -0',
    '1 .M N... 100644 100644 100644 51308db94af3fc1a8e00503436214e0aa264a4bd 51308db94af3fc1a8e00503436214e0aa264a4bd plugins/side.ts',
    '1 M. N... 100644 100644 100644 aaaa bbbb staged.ts',
    '? untracked.ts',
  ].join('\n'))

  assert.equal(result.isRepo, true)
  assert.equal(result.branch, 'main')
  assert.equal(result.upstream, 'origin/main')
  assert.equal(result.ahead, 1)
  assert.equal(result.behind, 0)
  assert.deepEqual(result.entries, [
    { path: 'plugins/side.ts', xy: '.M' },
    { path: 'staged.ts', xy: 'M.' },
    { path: 'untracked.ts', xy: '??' },
  ])
})

test('parsePorcelainV2: paths containing spaces are kept literal', () => {
  const result = parsePorcelainV2([
    '# branch.head main',
    '1 M. N... 100644 100644 100644 aaaa bbbb has space.txt',
  ].join('\n'))
  assert.deepEqual(result.entries, [{ path: 'has space.txt', xy: 'M.' }])
})

test('parsePorcelainV2: rename rows split path/origPath on TAB', () => {
  const result = parsePorcelainV2([
    '# branch.head main',
    '2 R. N... 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 78981922613b2afb6025042ff6bd878ac1994e85 R100 new.txt\told.txt',
  ].join('\n'))
  assert.deepEqual(result.entries, [{ path: 'new.txt', xy: 'R.' }])
})

test('parsePorcelainV2: unmerged rows map to conflict entries', () => {
  const result = parsePorcelainV2([
    '# branch.head main',
    'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflicted.ts',
  ].join('\n'))
  assert.deepEqual(result.entries, [{ path: 'conflicted.ts', xy: 'UU' }])
})

test('parsePorcelainV2: detached HEAD and no upstream', () => {
  const result = parsePorcelainV2([
    '# branch.head (detached)',
    '? lone.ts',
  ].join('\n'))
  assert.equal(result.branch, undefined)
  assert.equal(result.upstream, undefined)
  assert.equal(result.ahead, 0)
  assert.equal(result.behind, 0)
  assert.deepEqual(result.entries, [{ path: 'lone.ts', xy: '??' }])
})

test('parsePorcelainV2: CRLF tolerance and ignored lines', () => {
  const result = parsePorcelainV2('# branch.head main\r\n! ignored-dir/\r\n')
  assert.equal(result.branch, 'main')
  assert.deepEqual(result.entries, [])
})

test('parseCommitFilesZ: status + path are separate NUL fields; rename new path wins', () => {
  const result = parseCommitFilesZ([
    'M', '\0', 'src/a.ts', '\0',
    'A', '\0', 'src/new.ts', '\0',
    'R100', '\0', 'src/old.ts', '\0', 'src/renamed.ts', '\0',
    'D', '\0', 'src/gone.ts', '\0',
  ].join(''))
  assert.deepEqual(result, [
    { path: 'src/a.ts', status: 'M', additions: 0, deletions: 0 },
    { path: 'src/new.ts', status: 'A', additions: 0, deletions: 0 },
    { path: 'src/renamed.ts', status: 'R', additions: 0, deletions: 0 },
    { path: 'src/gone.ts', status: 'D', additions: 0, deletions: 0 },
  ])
})

test('parseCommitFilesZ: empty output yields no entries', () => {
  assert.deepEqual(parseCommitFilesZ(''), [])
})
