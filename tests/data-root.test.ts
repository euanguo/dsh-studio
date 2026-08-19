import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  defaultDshStudioHome,
  desktopElectronDataRoot,
  hasDshStudioHomeOverride,
  dshStudioHomeDirectory,
  parseDshStudioChannel,
  resolveDshStudioChannel,
  resolveDshStudioHome,
  takeDshStudioChannelArgs,
} from '../src/data-root.ts'

test('all surfaces resolve the new shared DSH Studio state root', () => {
  assert.equal(dshStudioHomeDirectory(), '.dsh-studio')
  assert.equal(dshStudioHomeDirectory('dev'), '.dsh-studio-dev')
  assert.equal(defaultDshStudioHome('/home/user'), join('/home/user', '.dsh-studio'))
  assert.equal(resolveDshStudioHome({}, '/home/user'), resolve('/home/user/.dsh-studio'))
  assert.equal(
    resolveDshStudioHome({ DSH_STUDIO_HOME: '/data/dsh-studio' }, '/home/user'),
    resolve('/data/dsh-studio'),
  )
  assert.equal(hasDshStudioHomeOverride({ DSH_STUDIO_HOME: '/data/dsh-studio' }), true)
  assert.equal(hasDshStudioHomeOverride({}), false)
  assert.equal(
    desktopElectronDataRoot('/data/dsh-studio'),
    join('/data/dsh-studio', 'desktop'),
  )
})

test('stable and dev channels differ only by the new data root', () => {
  assert.equal(resolveDshStudioChannel({}), 'stable')
  assert.equal(resolveDshStudioChannel({}, { packaged: true }), 'stable')
  assert.equal(resolveDshStudioChannel({}, { packaged: false }), 'dev')
  assert.equal(resolveDshStudioChannel({ DSH_STUDIO_CHANNEL: 'dev' }, { packaged: true }), 'dev')
  assert.equal(resolveDshStudioChannel({ DSH_STUDIO_CHANNEL: 'stable' }, { packaged: false }), 'stable')
  assert.equal(parseDshStudioChannel('production'), 'stable')
  assert.equal(parseDshStudioChannel('development'), 'dev')
  assert.equal(
    resolveDshStudioHome({ DSH_STUDIO_CHANNEL: 'dev' }, '/home/user'),
    resolve('/home/user/.dsh-studio-dev'),
  )
  assert.equal(
    resolveDshStudioHome({ DSH_STUDIO_CHANNEL: 'dev', DSH_STUDIO_HOME: '/data/dsh-studio' }, '/home/user'),
    resolve('/data/dsh-studio'),
  )
  assert.deepEqual(takeDshStudioChannelArgs(['--channel', 'dev', '/tmp/workspace']), {
    channelValue: 'dev',
    rest: ['/tmp/workspace'],
  })
  assert.throws(() => parseDshStudioChannel('nightly'), /DSH_STUDIO_CHANNEL/)
})
