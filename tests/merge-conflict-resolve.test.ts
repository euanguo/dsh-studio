/**
 * Unit tests for pure merge-conflict resolution
 * (plugins/sidebar/src/client/diff/merge-conflict-resolve.ts).
 *
 * Regions are derived with the same split semantics the library uses
 * (split with a newline capture group), matching
 * `parseMergeConflictDiffFromFile`'s index conventions.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConflictRegionContents } from '../plugins/sidebar/src/client/diff/merge-conflict-resolve.ts'

const SPLIT = /(?<=\n)/

interface ConflictRegion {
  startLineIndex: number
  separatorLineIndex: number
  endLineIndex: number
}

/** Find the first conflict region's marker indexes (library semantics). */
function firstConflictRegion(content: string): ConflictRegion {
  const lines = content !== '' ? content.split(SPLIT) : []
  const start = lines.findIndex(line => line.startsWith('<<<<<<<'))
  const separator = lines.findIndex(line => line.startsWith('======='))
  const end = lines.findIndex(line => line.startsWith('>>>>>>>'))
  assert.ok(start >= 0 && separator > start && end > separator, 'conflict markers must be present')
  return { startLineIndex: start, separatorLineIndex: separator, endLineIndex: end }
}

const CONTENT = [
  'shared line',
  '<<<<<<< HEAD',
  'ours version',
  '=======',
  'theirs version',
  '>>>>>>> feature-branch',
  'tail line',
  '',
].join('\n')

test('current resolution keeps the ours side and drops markers', () => {
  const resolved = resolveConflictRegionContents(CONTENT, firstConflictRegion(CONTENT), 'current')
  assert.equal(resolved, 'shared line\nours version\ntail line\n')
})

test('incoming resolution keeps the theirs side and drops markers', () => {
  const resolved = resolveConflictRegionContents(CONTENT, firstConflictRegion(CONTENT), 'incoming')
  assert.equal(resolved, 'shared line\ntheirs version\ntail line\n')
})

test('both resolution concatenates ours and theirs', () => {
  const resolved = resolveConflictRegionContents(CONTENT, firstConflictRegion(CONTENT), 'both')
  assert.equal(resolved, 'shared line\nours version\ntheirs version\ntail line\n')
})

test('resolution leaves surrounding lines untouched', () => {
  const content = 'a\n<<<<<<< HEAD\n1\n=======\n2\n>>>>>>> b\nc\n'
  assert.equal(
    resolveConflictRegionContents(content, firstConflictRegion(content), 'current'),
    'a\n1\nc\n',
  )
})

test('windows line endings are preserved', () => {
  const content = 'a\r\n<<<<<<< HEAD\r\n1\r\n=======\r\n2\r\n>>>>>>> b\r\nc\r\n'
  assert.equal(
    resolveConflictRegionContents(content, firstConflictRegion(content), 'incoming'),
    'a\r\n2\r\nc\r\n',
  )
})

test('multiple conflicts resolve independently', () => {
  const content = [
    'top',
    '<<<<<<< HEAD',
    'a1',
    '=======',
    'a2',
    '>>>>>>> b1',
    'mid',
    '<<<<<<< HEAD',
    'b1',
    '=======',
    'b2',
    '>>>>>>> b2',
    'end',
    '',
  ].join('\n')
  const lines = content.split(SPLIT)
  const firstStart = lines.findIndex(line => line.startsWith('<<<<<<<'))
  const firstSep = lines.findIndex(line => line.startsWith('======='))
  const firstEnd = lines.findIndex(line => line.startsWith('>>>>>>>'))
  const secondStart = lines.findIndex((line, index) => index > firstEnd && line.startsWith('<<<<<<<'))
  const secondSep = lines.findIndex((line, index) => index > secondStart && line.startsWith('======='))
  const secondEnd = lines.findIndex((line, index) => index > secondSep && line.startsWith('>>>>>>>'))

  const first = resolveConflictRegionContents(
    content,
    { startLineIndex: firstStart, separatorLineIndex: firstSep, endLineIndex: firstEnd },
    'current',
  )
  assert.ok(first.startsWith('top\na1\nmid\n<<<<<<< HEAD'))

  const second = resolveConflictRegionContents(
    content,
    { startLineIndex: secondStart, separatorLineIndex: secondSep, endLineIndex: secondEnd },
    'incoming',
  )
  assert.ok(second.includes('mid\nb2\nend\n'))
})
