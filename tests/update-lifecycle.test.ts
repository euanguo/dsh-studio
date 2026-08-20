import assert from 'node:assert/strict'
import test from 'node:test'
import type { DesktopUpdateState } from '../src/contracts.ts'
import { scheduleImmediateUpdateInstall, singleFlight } from '../src/update-lifecycle.ts'

function scheduledState(): DesktopUpdateState {
  return {
    status: 'scheduled',
    currentVersion: '1.1.0',
    latestVersion: '1.2.0',
    releaseName: 'v1.2.0',
    releaseNotes: 'notes',
    size: 100,
    platform: 'mac',
    releaseUrl: 'https://github.com/euanguo/dsh-studio-app/releases/tag/v1.2.0',
  }
}

test('immediate update requests install-on-quit before quitting', async () => {
  const commands: string[] = []
  let quitCalls = 0
  const result = await scheduleImmediateUpdateInstall({
    command: async command => {
      commands.push(command.type)
      return scheduledState()
    },
  }, () => { quitCalls += 1 })

  assert.equal(result.status, 'scheduled')
  assert.deepEqual(commands, ['install-on-quit'])
  assert.equal(quitCalls, 1)
})

test('immediate update does not quit when scheduling fails', async () => {
  let quitCalls = 0
  const errorState: DesktopUpdateState = {
    status: 'error',
    currentVersion: '1.1.0',
    stage: 'install',
    code: 'UPDATE_FAILED',
    message: 'cannot schedule update',
    releaseUrl: null,
    retryable: true,
  }
  const result = await scheduleImmediateUpdateInstall({
    command: async () => errorState,
  }, () => { quitCalls += 1 })

  assert.equal(result.status, 'error')
  assert.equal(quitCalls, 0)
})

test('single-flight cleanup shares concurrent calls and resets after completion', async () => {
  let starts = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const cleanup = singleFlight(async () => {
    starts += 1
    await gate
    return starts
  })

  const first = cleanup()
  const second = cleanup()
  assert.equal(first, second)
  assert.equal(starts, 1)

  release()
  assert.deepEqual(await Promise.all([first, second]), [1, 1])
  assert.equal(await cleanup(), 2)
})
