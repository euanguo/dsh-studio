import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bundledRuntimePaths, runtimeSearchPath } from '../src/runtime-paths.ts'

test('bundled runtime paths use POSIX layouts on macOS and Linux', () => {
  const mac = bundledRuntimePaths('/Applications/Oh.app/Contents/Resources', 'darwin')
  assert.equal(mac.nodeBinary, '/Applications/Oh.app/Contents/Resources/node-runtime/bin/node')
  assert.equal(mac.pnpmBinary, '/Applications/Oh.app/Contents/Resources/node-runtime/bin/pnpm')
  assert.equal(
    mac.pnpmEntry,
    '/Applications/Oh.app/Contents/Resources/node-runtime/lib/node_modules/pnpm/bin/pnpm.mjs',
  )
  assert.equal(mac.cliEntry, '/Applications/Oh.app/Contents/Resources/dsh-runtime/lib/bin.js')
  assert.equal(runtimeSearchPath(mac, { PATH: '/custom/bin' }, 'darwin'), [
    '/Applications/Oh.app/Contents/Resources/node-runtime/bin',
    '/Applications/Oh.app/Contents/Resources/dsh-runtime/node_modules/.bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/custom/bin',
  ].join(':'))

  const linux = bundledRuntimePaths('/opt/oh-dsh/resources', 'linux')
  assert.equal(linux.nodeBinary, '/opt/oh-dsh/resources/node-runtime/bin/node')
  assert.equal(runtimeSearchPath(linux, { PATH: '/usr/local/sbin:/usr/bin' }, 'linux'), [
    '/opt/oh-dsh/resources/node-runtime/bin',
    '/opt/oh-dsh/resources/dsh-runtime/node_modules/.bin',
    '/usr/local/sbin:/usr/bin',
  ].join(':'))
})

test('bundled runtime paths use Windows executables and PATH separators', () => {
  const windows = bundledRuntimePaths('C:\\Program Files\\Oh-DSH\\resources', 'win32')
  assert.equal(windows.nodeBinary, 'C:\\Program Files\\Oh-DSH\\resources\\node-runtime\\node.exe')
  assert.equal(windows.pnpmBinary, 'C:\\Program Files\\Oh-DSH\\resources\\node-runtime\\pnpm.cmd')
  assert.equal(
    windows.pnpmEntry,
    'C:\\Program Files\\Oh-DSH\\resources\\node-runtime\\node_modules\\pnpm\\bin\\pnpm.mjs',
  )
  assert.equal(windows.cliEntry, 'C:\\Program Files\\Oh-DSH\\resources\\dsh-runtime\\lib\\bin.js')
  assert.equal(runtimeSearchPath(windows, { Path: 'C:\\Windows\\System32;D:\\Git\\cmd' }, 'win32'), [
    'C:\\Program Files\\Oh-DSH\\resources\\node-runtime',
    'C:\\Program Files\\Oh-DSH\\resources\\dsh-runtime\\node_modules\\.bin',
    'C:\\Windows\\System32;D:\\Git\\cmd',
  ].join(';'))
})
