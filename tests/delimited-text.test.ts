/**
 * Unit tests for P1 delimited-text parsing
 * (plugins/sidebar/src/client/files/delimited-text.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  detectDelimiter,
  parseDelimitedRows,
  MAX_CSV_ROWS,
} from '../plugins/sidebar/src/client/files/delimited-text.ts'

test('parseDelimitedRows handles quoted commas and escaped quotes', () => {
  const rows = parseDelimitedRows('a,"b,c",d\n1,"2""x",3\n', ',')
  assert.deepEqual(rows, [
    ['a', 'b,c', 'd'],
    ['1', '2"x', '3'],
  ])
})

test('parseDelimitedRows handles TSV and CRLF', () => {
  const rows = parseDelimitedRows('a\tb\r\nc\td\r\n', '\t')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['c', 'd'],
  ])
})

test('parseDelimitedRows caps at MAX_CSV_ROWS', () => {
  const rows = parseDelimitedRows(Array.from({ length: MAX_CSV_ROWS + 10 }, (_, i) => `r${i}`).join('\n'), ',')
  assert.equal(rows.length, MAX_CSV_ROWS)
})

test('detectDelimiter prefers tabs when they dominate', () => {
  assert.equal(detectDelimiter('x.csv', 'a,b,c\n1,2,3'), ',')
  assert.equal(detectDelimiter('x.csv', 'a\tb\tc\n1\t2\t3'), '\t')
  assert.equal(detectDelimiter('x.tsv', 'a,b,c'), '\t')
})
