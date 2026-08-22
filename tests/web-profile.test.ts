import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  ensureWebProfile,
  WEB_BUNDLES,
} from '../src/profile.ts'
import {
  DshRuntimeSupervisor,
  type DshRuntimeOptions,
} from '../src/runtime.ts'
import {
  DEFAULT_DATA_DIR_NAME,
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  main,
  normalizeWebArgs,
  parseLaunchArgs,
  resolveWebVersion,
  UsageError,
} from '../src/web.ts'

test('web profile initializes required bundles and preserves user plugins', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-web-profile-'))
  try {
    const first = ensureWebProfile(join(root, 'home'))
    const manifestPath = join(first.profileDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.name, 'dsh-profile-web')
    assert.deepEqual(manifest.dsh.profile.bundles, WEB_BUNDLES)
    assert.equal(manifest.dsh.profile.bundles.includes('@dsh-studio/desktop'), false)

    manifest.dependencies['example-plugin'] = '1.0.0'
    manifest.dsh.profile.bundles = ['example-plugin', '@dsh-studio/web']
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    writeFileSync(join(first.profileDir, 'cordis.patch.yml'), '- id: custom\n  disabled: true\n')

    const second = ensureWebProfile(join(root, 'home'))
    const upgraded = JSON.parse(readFileSync(join(second.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(upgraded.dsh.profile.bundles, [...WEB_BUNDLES, 'example-plugin'])
    assert.equal(upgraded.dependencies['example-plugin'], '1.0.0')
    assert.match(readFileSync(join(second.profileDir, 'cordis.patch.yml'), 'utf8'), /custom/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('full and web-only distributions expose the same release version', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-web-version-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}\n')
    assert.equal(resolveWebVersion(root), '1.2.3')
    rmSync(join(root, 'package.json'))

    mkdirSync(join(root, 'lib', 'dsh-studio'), { recursive: true })
    writeFileSync(
      join(root, 'lib', 'dsh-studio', 'package.json'),
      '{"version":"4.5.6"}\n',
    )
    assert.equal(resolveWebVersion(root), '4.5.6')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('full distribution keeps app and release manifests distinct', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const releaseManifest = manifest.build.extraResources.find(
    (resource: { to?: string }) => resource.to === 'lib/dsh-studio/package.json',
  )
  assert.equal(releaseManifest.from, 'dist/release-package.json')
})

test('web bundle patch mounts the web-capable DSH Studio plugins', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const patch = readFileSync(join(root, 'web', 'cordis.patch.yml'), 'utf8')
  for (const row of [
    'oh-web',
    'oh-better-sidebar-runtime',
    'oh-desktop-skins',
    'oh-pinned-summary',
    'oh-sidebar',
    'oh-panel-controls',
  ]) {
    assert.match(patch, new RegExp(`- id: ${row}`))
  }
  // Electron-bound surfaces stay out of the web composition. The desktop
  // SHELL row must be absent while the desktop-SKINS provider rides along.
  assert.doesNotMatch(patch, /- id: oh-desktop\n/)
  assert.doesNotMatch(patch, /- id: oh-plugin-marketplace\n/)
})

test('web launcher accepts the pnpm argument separator', () => {
  assert.deepEqual(normalizeWebArgs(['--', '--port', '3180']), ['--port', '3180'])
  assert.deepEqual(normalizeWebArgs(['--port', '3180']), ['--port', '3180'])
})

test('web launcher defaults match the dsh-web-app bundle surface', () => {
  const options = parseLaunchArgs([], {}, false, `/home/user/${DEFAULT_DATA_DIR_NAME}`)
  assert.equal(options.host, DEFAULT_WEB_HOST)
  assert.equal(options.port, DEFAULT_WEB_PORT)
  assert.equal(options.open, false)
  assert.equal(options.dataRoot, `/home/user/${DEFAULT_DATA_DIR_NAME}`)
  assert.deepEqual(options.trustedHosts, [])
  assert.equal(options.help, false)
})

test('web launcher honors environment and flag precedence', () => {
  const base = parseLaunchArgs([], {
    DSH_STUDIO_WEB_HOST: '0.0.0.0',
    DSH_STUDIO_WEB_PORT: '9090',
    DSH_STUDIO_WEB_HOME: '/data/web',
    DSH_STUDIO_WEB_OPEN: '0',
  }, true, '/default')
  assert.equal(base.host, '0.0.0.0')
  assert.equal(base.port, 9090)
  assert.equal(base.dataRoot, '/data/web')
  assert.equal(base.open, false)

  const flags = parseLaunchArgs([
    '--host', '127.0.0.1',
    '--port=8080',
    '--data', '/flags',
    '--open',
    '--trusted-host', 'lab.internal:3080',
    '--trusted-host=10.0.0.9',
  ], {
    DSH_STUDIO_WEB_HOST: '0.0.0.0',
    DSH_STUDIO_WEB_PORT: '9090',
  }, false, '/default')
  assert.equal(flags.host, '127.0.0.1')
  assert.equal(flags.port, 8080)
  assert.equal(flags.dataRoot, '/flags')
  assert.equal(flags.open, true)
  assert.deepEqual(flags.trustedHosts, ['lab.internal:3080', '10.0.0.9'])

  const noOpen = parseLaunchArgs(['--no-open'], { DSH_STUDIO_WEB_OPEN: '1' }, true, '/default')
  assert.equal(noOpen.open, false)

  const isolated = parseLaunchArgs(['--channel', 'dev'], {}, false, '/default')
  assert.match(isolated.dataRoot, /\.dsh-studio-dev$/)
  const explicitWins = parseLaunchArgs(['--channel', 'dev', '--data', '/flags'], {}, false, '/default')
  assert.equal(explicitWins.dataRoot, '/flags')
})

test('web launcher rejects invalid arguments', () => {
  assert.throws(() => parseLaunchArgs(['--port', 'not-a-port'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--port', '70000'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--host'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--unknown'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs([], { DSH_STUDIO_WEB_PORT: 'abc' }, false, '/d'), UsageError)
})

test('web launcher requires trusted hosts for non-loopback exposure', async () => {
  await assert.rejects(
    main(['--host', '0.0.0.0'], {}, { isTTY: false } as NodeJS.WriteStream),
    UsageError,
  )
})

test('web launcher --help short-circuits', () => {
  const options = parseLaunchArgs(['--help'], {}, false, '/d')
  assert.equal(options.help, true)
})

test('web launcher resolves a relative data root before spawning the runtime', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-web-main-'))
  const dataRoot = realpathSync(temp)
  const packaged = join(dataRoot, 'package')
  const nodeBinary = process.platform === 'win32'
    ? join(packaged, 'node-runtime', 'node.exe')
    : join(packaged, 'node-runtime', 'bin', 'node')
  mkdirSync(dirname(nodeBinary), { recursive: true })
  mkdirSync(join(packaged, 'dsh-runtime', 'lib'), { recursive: true })
  writeFileSync(nodeBinary, '')
  writeFileSync(join(packaged, 'dsh-runtime', 'lib', 'bin.js'), '')

  class FailingRuntime extends DshRuntimeSupervisor {
    readonly plan: DshRuntimeOptions

    constructor(plan: DshRuntimeOptions) {
      super(plan)
      this.plan = plan
    }

    async start(): Promise<URL> {
      throw new Error('test runtime never becomes ready')
    }
  }

  const previous = process.cwd()
  let runtime: FailingRuntime | undefined
  process.chdir(dataRoot)
  try {
    const code = await main(
      ['--data', './state'],
      { DSH_STUDIO_WEB_ROOT: packaged, PATH: process.env.PATH },
      { isTTY: false } as NodeJS.WriteStream,
      plan => {
        runtime = new FailingRuntime(plan)
        return runtime
      },
    )
    assert.equal(code, 1)
    assert.ok(runtime)
    assert.equal(runtime.plan.cwd, join(dataRoot, 'state'))
    assert.equal(runtime.plan.env.DSH_HOME, join(dataRoot, 'state'))
    assert.equal(runtime.plan.env.DSH_STUDIO_WEB_DATA, join(dataRoot, 'state'))
    assert.equal(runtime.plan.env.DSH_STUDIO_HOME, join(dataRoot, 'state'))
  } finally {
    process.chdir(previous)
    rmSync(temp, { recursive: true, force: true })
  }
})

test('web launcher defers profile setup until migration can finish', async t => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction behavior')
    return
  }

  // The legacy Web state migration this test exercised was removed with
  // the DSH Studio rename ("no legacy data migration"): a fresh data root
  // no longer probes or moves pre-rename state, so the deferred-setup
  // rejection path no longer exists. Keep the junction scaffold as a
  // placeholder for the next migration that needs Windows deferral.
  t.skip('legacy Web state migration was removed with the DSH Studio rename')
})

