import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildDesktopRuntimeEnvironment } from '../src/runtime-environment.ts'
import { bundledRuntimePaths } from '../src/runtime-paths.ts'

test('user runtime environment preserves the login PATH and removes marketplace override', () => {
  const appDataPath = '/Users/me/.dsh-studio'
  const paths = bundledRuntimePaths('/Applications/DSH Studio.app/Contents/Resources', 'darwin')
  const environment = buildDesktopRuntimeEnvironment({
    appDataPath,
    dshHome: appDataPath,
    nodeEnvironment: { ELECTRON_RUN_AS_NODE: '1' },
    paths,
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
  assert.equal(environment.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(environment.DSH_STUDIO_HOME, appDataPath)
  assert.deepEqual(environment.PATH?.split(':'), [
    paths.nodeBinDirectory,
    join(paths.runtimeRoot, 'node_modules', '.bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/Users/me/.local/bin',
    '/Users/me/.n/bin',
    '/usr/bin',
  ])
})

test('marketplace runtime environment owns its isolated Git config without changing user scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-runtime-env-'))
  try {
    const paths = bundledRuntimePaths(join(root, 'Resources'), 'darwin')
    const userEnvironment = {
      env: { PATH: '/Users/me/.local/bin:/usr/bin', SHELL: '/bin/zsh' },
      shell: '/bin/zsh',
      source: 'login-shell' as const,
    }
    const common = {
      appDataPath: root,
      dshHome: root,
      nodeEnvironment: { ELECTRON_RUN_AS_NODE: '1' },
      paths,
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
    assert.match(readFileSync(expected, 'utf8'), /credential "https:\/\/github\.com"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
