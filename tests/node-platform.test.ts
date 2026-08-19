import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  nodeDistributionPlatform,
  resolveNodeDistributionPlatform,
} from '../src/node-platform.ts'

test('Node distribution platforms normalize native Windows hosts', () => {
  assert.equal(nodeDistributionPlatform('win32'), 'win')
  assert.equal(nodeDistributionPlatform('darwin'), 'darwin')
  assert.equal(nodeDistributionPlatform('linux'), 'linux')
})

test('Node distribution platform overrides remain authoritative', () => {
  assert.equal(resolveNodeDistributionPlatform({
    DSH_STUDIO_NODE_PLATFORM: 'linux',
  }, 'win32'), 'linux')
  assert.equal(resolveNodeDistributionPlatform({}, 'win32'), 'win')
})
