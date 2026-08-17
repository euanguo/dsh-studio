import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import {
  defaultOhDshHome,
  desktopElectronDataRoot,
  migrateLegacyDesktopState,
  migrateLegacyWebState,
  parseOhDshChannel,
  resolveOhDshChannel,
  resolveOhDshHome,
  takeOhDshChannelArgs,
} from '../src/data-root.ts'

const MIGRATED = { complete: true, migrated: true }
const NO_MIGRATION = { complete: true, migrated: false }
const INCOMPLETE_MIGRATION = { complete: false, migrated: false }

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

test('all surfaces resolve one shared Oh-DSH state root', () => {
  assert.equal(defaultOhDshHome('/home/user'), join('/home/user', '.ohdsh'))
  assert.equal(resolveOhDshHome({}, '/home/user'), resolve('/home/user/.ohdsh'))
  assert.equal(
    resolveOhDshHome({ OH_DSH_HOME: '/data/oh-dsh' }, '/home/user'),
    resolve('/data/oh-dsh'),
  )
  assert.equal(
    desktopElectronDataRoot('/data/oh-dsh'),
    join('/data/oh-dsh', 'desktop'),
  )
})

test('stable and dev channels share one resolver and differ only by data root', () => {
  assert.equal(resolveOhDshChannel({}), 'stable')
  assert.equal(resolveOhDshChannel({}, { packaged: true }), 'stable')
  assert.equal(resolveOhDshChannel({}, { packaged: false }), 'dev')
  assert.equal(resolveOhDshChannel({ OH_DSH_CHANNEL: 'dev' }, { packaged: true }), 'dev')
  assert.equal(resolveOhDshChannel({ OH_DSH_CHANNEL: 'stable' }, { packaged: false }), 'stable')
  assert.equal(parseOhDshChannel('production'), 'stable')
  assert.equal(parseOhDshChannel('development'), 'dev')
  assert.equal(
    defaultOhDshHome('/home/user', 'dev'),
    join('/home/user', '.ohdsh-dev'),
  )
  assert.equal(
    resolveOhDshHome({ OH_DSH_CHANNEL: 'dev' }, '/home/user'),
    resolve('/home/user/.ohdsh-dev'),
  )
  assert.equal(
    resolveOhDshHome({ OH_DSH_CHANNEL: 'dev', OH_DSH_HOME: '/data/oh-dsh' }, '/home/user'),
    resolve('/data/oh-dsh'),
  )
  assert.deepEqual(takeOhDshChannelArgs(['--channel', 'dev', '/tmp/workspace']), {
    channelValue: 'dev',
    rest: ['/tmp/workspace'],
  })
  assert.throws(() => parseOhDshChannel('nightly'), /OH_DSH_CHANNEL/)
})

test('legacy Desktop state migrates once without replacing shared state', t => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-desktop-migrate-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const appDataRoot = join(temporaryRoot, 'app-data')
  const legacyRoot = join(appDataRoot, 'Oh-DSH-Desktop')
  const sharedRoot = join(temporaryRoot, '.ohdsh')
  write(join(legacyRoot, 'dsh', 'sessions', 'legacy.json'), 'legacy')
  write(join(legacyRoot, 'dsh', 'sessions', 'current.json'), 'legacy')
  write(join(sharedRoot, 'sessions', 'current.json'), 'current')
  write(join(legacyRoot, 'skins.json'), 'legacy skin')
  write(join(sharedRoot, 'skins.json'), 'current skin')
  write(join(legacyRoot, 'plugin-marketplace', 'receipt.json'), 'receipt')
  write(join(legacyRoot, 'Local Storage', 'leveldb', 'state'), 'legacy ui')
  write(join(sharedRoot, 'desktop', 'Local Storage', 'leveldb', 'state'), 'new ui')

  assert.deepEqual(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedRoot,
  }), MIGRATED)
  assert.equal(
    readFileSync(join(sharedRoot, 'sessions', 'legacy.json'), 'utf8'),
    'legacy',
  )
  assert.equal(
    readFileSync(join(sharedRoot, 'sessions', 'current.json'), 'utf8'),
    'current',
  )
  assert.equal(readFileSync(join(sharedRoot, 'skins.json'), 'utf8'), 'current skin')
  assert.equal(
    readFileSync(join(sharedRoot, 'plugin-marketplace', 'receipt.json'), 'utf8'),
    'receipt',
  )
  assert.equal(
    readFileSync(join(sharedRoot, 'desktop', 'Local Storage', 'leveldb', 'state'), 'utf8'),
    'new ui',
  )
  assert.equal(existsSync(join(legacyRoot, 'dsh', 'sessions', 'legacy.json')), true)

  write(join(legacyRoot, 'dsh', 'sessions', 'late.json'), 'late')
  assert.deepEqual(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedRoot,
  }), NO_MIGRATION)
  assert.equal(existsSync(join(sharedRoot, 'sessions', 'late.json')), false)
})

test('dev channel skips legacy Desktop migration', t => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-desktop-dev-migrate-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const appDataRoot = join(temporaryRoot, 'app-data')
  const legacyRoot = join(appDataRoot, 'Oh-DSH-Desktop')
  const sharedRoot = join(temporaryRoot, '.ohdsh-dev')
  write(join(legacyRoot, 'dsh', 'sessions', 'legacy.json'), 'legacy')

  assert.deepEqual(migrateLegacyDesktopState({
    appDataRoot,
    env: { OH_DSH_CHANNEL: 'dev' },
    ohDshHome: sharedRoot,
  }), NO_MIGRATION)
  assert.equal(existsSync(join(sharedRoot, 'sessions', 'legacy.json')), false)
})

test('legacy Web roots flatten once without replacing shared state', t => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-web-migrate-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const sharedRoot = join(temporaryRoot, '.ohdsh')
  const legacyDefaultRoot = join(temporaryRoot, '.oh-dsh-web')
  write(join(sharedRoot, 'sessions', 'current.json'), 'current')
  write(join(sharedRoot, 'dsh', 'sessions', 'current.json'), 'legacy')
  write(join(sharedRoot, 'dsh', 'sessions', 'flat.json'), 'flat')
  write(join(legacyDefaultRoot, 'dsh', 'sessions', 'default.json'), 'default')
  write(join(legacyDefaultRoot, 'skins.json'), 'legacy skin')
  write(join(legacyDefaultRoot, 'sidebar.json'), 'legacy sidebar')
  write(join(sharedRoot, 'skins.json'), 'current skin')

  assert.deepEqual(migrateLegacyWebState({
    dataRoot: sharedRoot,
    legacyDefaultDataRoot: legacyDefaultRoot,
  }), MIGRATED)
  assert.equal(
    readFileSync(join(sharedRoot, 'sessions', 'current.json'), 'utf8'),
    'current',
  )
  assert.equal(readFileSync(join(sharedRoot, 'sessions', 'flat.json'), 'utf8'), 'flat')
  assert.equal(
    readFileSync(join(sharedRoot, 'sessions', 'default.json'), 'utf8'),
    'default',
  )
  assert.equal(readFileSync(join(sharedRoot, 'skins.json'), 'utf8'), 'current skin')
  assert.equal(
    readFileSync(join(sharedRoot, 'sidebar.json'), 'utf8'),
    'legacy sidebar',
  )
  assert.equal(existsSync(join(sharedRoot, 'dsh', 'sessions', 'flat.json')), true)
  assert.equal(
    existsSync(join(legacyDefaultRoot, 'dsh', 'sessions', 'default.json')),
    true,
  )

  write(join(sharedRoot, 'dsh', 'sessions', 'late-flat.json'), 'late')
  write(join(legacyDefaultRoot, 'dsh', 'sessions', 'late-default.json'), 'late')
  write(join(legacyDefaultRoot, 'sidebar.json'), 'late sidebar')
  assert.deepEqual(migrateLegacyWebState({
    dataRoot: sharedRoot,
    legacyDefaultDataRoot: legacyDefaultRoot,
  }), NO_MIGRATION)
  assert.equal(existsSync(join(sharedRoot, 'sessions', 'late-flat.json')), false)
  assert.equal(existsSync(join(sharedRoot, 'sessions', 'late-default.json')), false)
  assert.equal(
    readFileSync(join(sharedRoot, 'sidebar.json'), 'utf8'),
    'legacy sidebar',
  )
})

test('legacy directory links are followed before migration completes', t => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-linked-migrate-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const appDataRoot = join(temporaryRoot, 'app-data')
  const legacyDesktopRoot = join(appDataRoot, 'Oh-DSH-Desktop')
  const legacyDesktopTarget = join(temporaryRoot, 'legacy-desktop')
  const desktopTarget = join(temporaryRoot, 'desktop-dsh')
  const dependencyTarget = join(temporaryRoot, 'dependency')
  const sharedDesktopRoot = join(temporaryRoot, 'shared-desktop')
  write(join(desktopTarget, 'sessions', 'desktop.json'), 'desktop')
  write(join(dependencyTarget, 'package.json'), '{"name":"linked"}\n')
  mkdirSync(join(desktopTarget, 'node_modules'), { recursive: true })
  const dependencyLink = join(desktopTarget, 'node_modules', 'linked')
  symlinkSync(
    process.platform === 'win32'
      ? dependencyTarget
      : relative(dirname(dependencyLink), dependencyTarget),
    dependencyLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  mkdirSync(legacyDesktopTarget, { recursive: true })
  symlinkSync(
    desktopTarget,
    join(legacyDesktopTarget, 'dsh'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  mkdirSync(appDataRoot, { recursive: true })
  symlinkSync(
    legacyDesktopTarget,
    legacyDesktopRoot,
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  assert.deepEqual(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedDesktopRoot,
  }), MIGRATED)
  assert.equal(
    readFileSync(join(sharedDesktopRoot, 'sessions', 'desktop.json'), 'utf8'),
    'desktop',
  )
  assert.equal(
    lstatSync(join(sharedDesktopRoot, 'node_modules', 'linked')).isSymbolicLink(),
    true,
  )
  assert.equal(
    readFileSync(
      join(sharedDesktopRoot, 'node_modules', 'linked', 'package.json'),
      'utf8',
    ),
    '{"name":"linked"}\n',
  )

  const sharedWebRoot = join(temporaryRoot, 'shared-web')
  const webTarget = join(temporaryRoot, 'web-dsh')
  write(join(webTarget, 'sessions', 'web.json'), 'web')
  mkdirSync(sharedWebRoot, { recursive: true })
  symlinkSync(
    webTarget,
    join(sharedWebRoot, 'dsh'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  assert.deepEqual(
    migrateLegacyWebState({ dataRoot: sharedWebRoot }),
    MIGRATED,
  )
  assert.equal(
    readFileSync(join(sharedWebRoot, 'sessions', 'web.json'), 'utf8'),
    'web',
  )
})

test('unavailable Windows junctions keep migration retryable', t => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction behavior')
    return
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-junction-retry-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const appDataRoot = join(temporaryRoot, 'app-data')
  const legacyRoot = join(appDataRoot, 'Oh-DSH-Desktop')
  const dependencyTarget = join(temporaryRoot, 'dependency')
  const dependencyLink = join(legacyRoot, 'dsh', 'node_modules', 'linked')
  const sharedRoot = join(temporaryRoot, 'shared')
  mkdirSync(dirname(dependencyLink), { recursive: true })
  symlinkSync(dependencyTarget, dependencyLink, 'junction')

  assert.deepEqual(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedRoot,
  }), INCOMPLETE_MIGRATION)

  write(join(dependencyTarget, 'package.json'), '{"name":"linked"}\n')
  assert.deepEqual(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedRoot,
  }), MIGRATED)
  assert.equal(
    readFileSync(join(sharedRoot, 'node_modules', 'linked', 'package.json'), 'utf8'),
    '{"name":"linked"}\n',
  )
})

test('incomplete Web flattening blocks lower-priority imports', t => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction behavior')
    return
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-web-retry-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const sharedRoot = join(temporaryRoot, 'shared')
  const legacyRoot = join(temporaryRoot, 'legacy-web')
  const dependencyTarget = join(temporaryRoot, 'dependency')
  const dependencyLink = join(sharedRoot, 'dsh', 'node_modules', 'linked')
  mkdirSync(dirname(dependencyLink), { recursive: true })
  symlinkSync(dependencyTarget, dependencyLink, 'junction')
  write(
    join(legacyRoot, 'dsh', 'node_modules', 'linked', 'package.json'),
    '{"name":"lower-priority"}\n',
  )

  assert.deepEqual(migrateLegacyWebState({
    dataRoot: sharedRoot,
    legacyDefaultDataRoot: legacyRoot,
  }), INCOMPLETE_MIGRATION)
  assert.equal(existsSync(join(sharedRoot, 'node_modules', 'linked')), false)

  write(join(dependencyTarget, 'package.json'), '{"name":"preferred"}\n')
  assert.deepEqual(migrateLegacyWebState({
    dataRoot: sharedRoot,
    legacyDefaultDataRoot: legacyRoot,
  }), MIGRATED)
  assert.equal(
    readFileSync(join(sharedRoot, 'node_modules', 'linked', 'package.json'), 'utf8'),
    '{"name":"preferred"}\n',
  )
})

test('incomplete legacy Web DSH blocks top-level preference imports', t => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction behavior')
    return
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-web-default-retry-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const sharedRoot = join(temporaryRoot, 'shared')
  const legacyRoot = join(temporaryRoot, 'legacy-web')
  const preferenceTarget = join(temporaryRoot, 'preferred-sidebar')
  const preferenceLink = join(legacyRoot, 'dsh', 'sidebar.json')
  mkdirSync(dirname(preferenceLink), { recursive: true })
  symlinkSync(preferenceTarget, preferenceLink, 'junction')
  write(join(legacyRoot, 'sidebar.json', 'value'), 'lower-priority')

  assert.deepEqual(migrateLegacyWebState({
    dataRoot: sharedRoot,
    legacyDefaultDataRoot: legacyRoot,
  }), INCOMPLETE_MIGRATION)
  assert.equal(existsSync(join(sharedRoot, 'sidebar.json')), false)

  write(join(preferenceTarget, 'value'), 'preferred')
  assert.deepEqual(migrateLegacyWebState({
    dataRoot: sharedRoot,
    legacyDefaultDataRoot: legacyRoot,
  }), MIGRATED)
  assert.equal(
    readFileSync(join(sharedRoot, 'sidebar.json', 'value'), 'utf8'),
    'preferred',
  )
})
