import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { test } from 'node:test'
import { desktopNodeEnv } from '../src/desktop-node-env.ts'
import { buildDesktopRuntimeEnvironment } from '../src/runtime-environment.ts'
import { bundledRuntimePaths } from '../src/runtime-paths.ts'

const EXEC_PATH = '/Applications/DSH Studio.app/Contents/MacOS/Electron'

test('user runtime environment preserves the login PATH and removes marketplace override', () => {
  const appDataPath = '/Users/me/.dsh-studio'
  const targetPlatform: NodeJS.Platform = 'darwin'
  const paths = bundledRuntimePaths('/Applications/DSH Studio.app/Contents/Resources', targetPlatform)
  const environment = buildDesktopRuntimeEnvironment({
    appDataPath,
    dshHome: appDataPath,
    // The inherited environment carries only namespaced interpreter plumbing;
    // the run-as-node variable exists solely inside exec boundaries.
    nodeEnvironment: desktopNodeEnv(paths, EXEC_PATH),
    paths,
    platform: targetPlatform,
    profile: 'desktop',
    userEnvironment: {
      env: {
        GIT_CONFIG_GLOBAL: join(appDataPath, 'plugin-marketplace', 'gitconfig'),
        PATH: '/Users/me/.local/bin:/Users/me/.n/bin:/usr/bin',
        SHELL: '/bin/zsh',
      },
      shell: '/bin/zsh',
      source: 'login-shell',
    },
    version: '0.1.2',
  })
  assert.equal(environment.GIT_CONFIG_GLOBAL, undefined)
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(environment.DSH_STUDIO_NODE_EXECUTABLE, EXEC_PATH)
  assert.equal(environment.DSH_STUDIO_HOME, appDataPath)
  assert.deepEqual(environment.PATH?.split(posix.delimiter), [
    '/Users/me/.local/bin',
    '/Users/me/.n/bin',
    '/usr/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    paths.nodeBinDirectory,
    posix.join(paths.runtimeRoot, 'node_modules', '.bin'),
  ])
})

test('Windows runtime environment uses Windows PATH semantics', () => {
  const targetPlatform: NodeJS.Platform = 'win32'
  const paths = bundledRuntimePaths('C:\\Program Files\\DSH Studio\\resources', targetPlatform)
  const environment = buildDesktopRuntimeEnvironment({
    appDataPath: 'C:\\Users\\me\\AppData\\Local\\DSH Studio',
    dshHome: 'C:\\Users\\me\\.dsh-studio',
    nodeEnvironment: desktopNodeEnv(paths, 'C:\\Program Files\\DSH Studio\\DSH Studio.exe'),
    paths,
    platform: targetPlatform,
    profile: 'desktop',
    userEnvironment: {
      env: { Path: 'C:\\Users\\me\\bin;C:\\Windows\\System32' },
      shell: 'C:\\Windows\\System32\\cmd.exe',
      source: 'process',
    },
    version: '0.1.4',
  })
  assert.deepEqual(environment.PATH?.split(win32.delimiter), [
    'C:\\Users\\me\\bin',
    'C:\\Windows\\System32',
    paths.nodeBinDirectory,
    win32.join(paths.runtimeRoot, 'node_modules', '.bin'),
  ])
})

test('marketplace runtime environment owns its isolated Git config without changing user scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-runtime-env-'))
  const targetPlatform: NodeJS.Platform = 'darwin'
  try {
    const paths = bundledRuntimePaths(posix.join('/tmp', 'dsh-studio-runtime-env-fixture', 'Resources'), targetPlatform)
    const userEnvironment = {
      env: { PATH: '/Users/me/.local/bin:/usr/bin', SHELL: '/bin/zsh' },
      shell: '/bin/zsh',
      source: 'login-shell' as const,
    }
    const common = {
      appDataPath: root,
      dshHome: root,
      nodeEnvironment: desktopNodeEnv(paths, EXEC_PATH),
      paths,
      platform: targetPlatform,
      profile: 'desktop',
      userEnvironment,
      version: '0.1.2',
    }
    const user = buildDesktopRuntimeEnvironment(common)
    const marketplace = buildDesktopRuntimeEnvironment({
      ...common,
      githubCliPath: '/opt/homebrew/bin/gh',
      scope: 'marketplace',
    })
    const preview = buildDesktopRuntimeEnvironment({
      ...common,
      dshHome: join(root, 'preview-home'),
      githubCliPath: '/opt/homebrew/bin/gh',
      preview: { pluginId: 'example-plugin', transactionId: 'tx-1' },
      scope: 'marketplace',
    })
    const expected = join(root, 'plugin-marketplace', 'gitconfig')
    assert.equal(user.GIT_CONFIG_GLOBAL, undefined)
    assert.equal(marketplace.GIT_CONFIG_GLOBAL, expected)
    assert.equal(preview.GIT_CONFIG_GLOBAL, expected)
    assert.equal(preview.DSH_STUDIO_PREVIEW, '1')
    // No composed scope may inherit interpreter variables; the marketplace
    // call site adds run-as-node explicitly on its own exec boundary.
    for (const environment of [user, marketplace, preview]) {
      assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined)
    }
    assert.match(readFileSync(expected, 'utf8'), /credential "https:\/\/github\.com"/)
    // Marketplace keeps the bundled runtime first so its pnpm/node stay
    // consistent; only the user scope is user-first.
    assert.deepEqual(marketplace.PATH?.split(posix.delimiter), [
      paths.nodeBinDirectory,
      posix.join(paths.runtimeRoot, 'node_modules', '.bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/me/.local/bin',
      '/usr/bin',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
