import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseIpynb } from '../plugins/sidebar/src/client/files/ipynb-parse.ts'

test('parseIpynb returns cells for a valid notebook', () => {
  const { cells, error } = parseIpynb(JSON.stringify({
    cells: [
      { cell_type: 'markdown', source: ['# Title'] },
      { cell_type: 'code', source: 'print(1)' },
    ],
  }))
  assert.equal(error, null)
  assert.equal(cells.length, 2)
  assert.equal(cells[0]?.cell_type, 'markdown')
  assert.equal(cells[1]?.cell_type, 'code')
})

test('parseIpynb reports invalid notebooks', () => {
  assert.equal(parseIpynb('not json').error !== null, true)
  assert.equal(parseIpynb('{}').error, 'Not a valid ipynb file.')
  assert.equal(parseIpynb('{"cells":123}').error, 'Not a valid ipynb file.')
})
