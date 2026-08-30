import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectDescendantProcesses,
  parseProcessChildrenMap,
  parseProcessCommandMap,
} from '../plugins/capabilities/src/process-tree-killer.ts'

test('parseProcessChildrenMap builds parent-to-children hierarchy', () => {
  const ps = `
    100 1 /bin/bash
    101 100 node index.js
    102 101 esbuild worker
    200 1 python main.py
  `
  const map = parseProcessChildrenMap(ps)
  assert.equal(map.get(100)?.length, 1)
  assert.equal(map.get(100)?.[0]?.pid, 101)
  assert.equal(map.get(101)?.length, 1)
  assert.equal(map.get(101)?.[0]?.pid, 102)
  assert.equal(map.get(200), undefined)
})

test('parseProcessCommandMap extracts pid to command mapping', () => {
  const ps = `
    100 /bin/bash -l
    101 node --inspect worker.js
  `
  const map = parseProcessCommandMap(ps)
  assert.equal(map.get(100), '/bin/bash -l')
  assert.equal(map.get(101), 'node --inspect worker.js')
  assert.equal(map.get(999), undefined)
})

test('collectDescendantProcesses collects tree in topological order without loops', () => {
  const map = new Map([
    [10, [{ pid: 20, command: 'child 1' }, { pid: 30, command: 'child 2' }]],
    [20, [{ pid: 40, command: 'grandchild' }]],
  ])
  const descendants = collectDescendantProcesses(10, map)
  const pids = descendants.map(d => d.pid)
  assert.deepEqual(pids.sort(), [20, 30, 40])
})

test('collectDescendantProcesses does not silently truncate a large tree', () => {
  const map = new Map<number, Array<{ pid: number; command: string }>>()
  map.set(1, Array.from({ length: 300 }, (_, index) => ({
    pid: index + 2,
    command: `child-${index}`,
  })))
  assert.equal(collectDescendantProcesses(1, map).length, 300)
})
