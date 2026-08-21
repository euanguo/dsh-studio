import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMacBuildArguments } from '../scripts/build-mac-args.mjs'

test('macOS build arguments preserve architecture and parse channel', () => {
  assert.deepEqual(parseMacBuildArguments([]), { requestedArch: undefined, channel: undefined })
  assert.deepEqual(parseMacBuildArguments(['arm64']), { requestedArch: 'arm64', channel: undefined })
  assert.deepEqual(parseMacBuildArguments(['x64', '--channel=stable']), {
    requestedArch: 'x64',
    channel: 'stable',
  })
  assert.deepEqual(parseMacBuildArguments(['--', '--channel', 'dev']), {
    requestedArch: undefined,
    channel: 'dev',
  })
})

test('macOS build arguments reject duplicate or unsupported options', () => {
  assert.throws(
    () => parseMacBuildArguments(['--channel', 'dev', '--channel=stable']),
    /specified more than once/,
  )
  assert.throws(() => parseMacBuildArguments(['--unknown']), /unsupported macOS build option/)
  assert.throws(() => parseMacBuildArguments(['--channel']), /--channel needs a value/)
  assert.throws(() => parseMacBuildArguments(['arm64', 'x64']), /unexpected macOS build argument/)
})
