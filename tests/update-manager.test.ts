import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { UpdateInfo } from 'electron-updater'
import {
  DesktopUpdateManager,
  officialReleaseUrl,
  selectUpdateFile,
} from '../src/update-manager.ts'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  disableDifferentialDownload = false
  result: { isUpdateAvailable: boolean; updateInfo: UpdateInfo } | null = null
  downloadResult = ['/tmp/DSH Studio-update.zip']
  quitCalls = 0
  installError: Error | undefined
  async checkForUpdates() {
    this.emit('checking-for-update')
    if (this.result?.isUpdateAvailable) this.emit('update-available', this.result.updateInfo)
    else if (this.result !== null) this.emit('update-not-available', this.result.updateInfo)
    return this.result
  }
  async downloadUpdate() {
    this.emit('download-progress', { percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 })
    this.emit('update-downloaded', { downloadedFile: this.downloadResult[0], version: this.result?.updateInfo.version })
    return this.downloadResult
  }
  quitAndInstall() {
    this.quitCalls += 1
    if (this.installError !== undefined) this.emit('error', this.installError)
  }
}

function updateInfo(version: string, file = 'DSH Studio-1.2.0-arm64.zip'): UpdateInfo {
  return {
    version,
    files: [{ url: `https://github.com/euanguo/oh-dsh-app/releases/download/v${version}/${file}`, sha512: 'hash', size: 100 }],
    path: file,
    sha512: 'hash',
    releaseDate: '2026-08-15T00:00:00Z',
    releaseName: `v${version}`,
    releaseNotes: 'Fixes and improvements',
  }
}

test('selectUpdateFile chooses exactly the current architecture asset', () => {
  const info = updateInfo('1.2.0')
  info.files.push({ url: 'https://example.invalid/DSH Studio-1.2.0-x64.zip', sha512: 'hash', size: 100 })
  assert.equal(selectUpdateFile(info, 'mac', 'arm64').url.endsWith('arm64.zip'), true)
  assert.throws(() => selectUpdateFile(info, 'mac', 'ia32'), /no installable update asset/)
})

test('official release URLs are fixed to the trusted repository', () => {
  assert.equal(officialReleaseUrl('1.2.3'), 'https://github.com/euanguo/oh-dsh-app/releases/tag/v1.2.3')
  assert.throws(() => officialReleaseUrl('../evil'), /invalid release version/)
})

test('manager reports available, progress, and downloaded states', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  const states: string[] = []
  manager.subscribe(state => { states.push(state.status) })
  assert.equal((await manager.check()).status, 'available')
  assert.equal((await manager.download()).status, 'downloaded')
  assert.deepEqual(states, ['idle', 'checking', 'available', 'downloading', 'downloaded'])
  assert.equal((await manager.command({ type: 'install-now' })).status, 'scheduled')
  assert.equal(updater.quitCalls, 1)
})

test('manager rejects prereleases and downgrades', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0-beta.1') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  assert.equal((await manager.check()).status, 'not-available')
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.0.0') }
  assert.equal((await manager.check()).status, 'not-available')
})

test('manager offers the official Release page when the platform asset is missing', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0', 'DSH Studio-1.2.0-x64.zip') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  const state = await manager.check()
  assert.equal(state.status, 'unsupported')
  if (state.status === 'unsupported') {
    assert.equal(state.releaseUrl, 'https://github.com/euanguo/oh-dsh-app/releases/tag/v1.2.0')
  }
})

test('manager provides a deb installer fallback without invoking updater install', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0', 'DSH Studio-1.2.0-amd64.deb') }
  const opened: string[] = []
  const manager = new DesktopUpdateManager({
    currentVersion: '1.1.0',
    platform: 'linux',
    packageType: 'deb',
    arch: 'x64',
    updater,
    onOpenInstaller: path => { opened.push(path) },
  })
  await manager.check()
  await manager.download()
  assert.equal('installerPath' in manager.getState(), false)
  assert.equal((await manager.command({ type: 'install-now' })).status, 'scheduled')
  assert.deepEqual(opened, ['/tmp/DSH Studio-update.zip'])
  assert.equal(updater.quitCalls, 0)
  assert.deepEqual(await manager.command({ type: 'install-on-quit' }), manager.getState())
})

test('manager records an explicit install-on-quit request', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  await manager.check()
  await manager.download()
  assert.equal(manager.shouldInstallOnQuit(), false)
  assert.equal((await manager.command({ type: 'install-on-quit' })).status, 'scheduled')
  assert.equal(manager.shouldInstallOnQuit(), true)
  assert.equal(updater.autoInstallOnAppQuit, true)
})

test('manager clears install-on-quit request before attempting immediate install', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  await manager.check()
  await manager.download()
  await manager.command({ type: 'install-on-quit' })
  assert.equal(manager.shouldInstallOnQuit(), true)
  assert.equal((await manager.command({ type: 'install-now' })).status, 'scheduled')
  assert.equal(manager.shouldInstallOnQuit(), false)
})

test('manager preserves a synchronous updater install error for recovery', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  updater.installError = Object.assign(new Error('installer missing'), { code: 'UPDATE_INSTALLER_MISSING' })
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  await manager.check()
  await manager.download()
  const state = await manager.command({ type: 'install-now' })
  assert.equal(state.status, 'error')
  if (state.status === 'error') assert.equal(state.code, 'UPDATE_INSTALLER_MISSING')
})

test('manager exposes actionable retryable errors', async () => {
  const updater = new FakeUpdater()
  updater.result = null
  updater.checkForUpdates = async () => { throw Object.assign(new Error('404 Not Found'), { code: 'HTTP_404' }) }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  const state = await manager.check()
  assert.equal(state.status, 'error')
  if (state.status === 'error') {
    assert.equal(state.stage, 'check')
    assert.equal(state.retryable, true)
    assert.match(state.message, /404/)
  }
})

test('manager turns proxy authentication into a redacted actionable error', () => {
  const updater = new FakeUpdater()
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  updater.emit('login', {}, () => {})
  const state = manager.getState()
  assert.equal(state.status, 'error')
  if (state.status === 'error') {
    assert.equal(state.code, 'PROXY_AUTH_REQUIRED')
    assert.equal(state.retryable, true)
    assert.doesNotMatch(state.message, /password|token/i)
  }
})
