/**
 * Desktop environment governance guards.
 *
 * Contract: variables the desktop app injects into inherited command
 * environments must be `DSH_*`-namespaced or semantics-safe; interpreter
 * plumbing with global semantics (`ELECTRON_RUN_AS_NODE`) exists only inside
 * exec boundaries — the spawn env of our own Electron-as-Node launches — and
 * is scrubbed from the supervisor process at boot so agent sessions and
 * their tool shells inherit a clean environment. Without these guards, a
 * leaked run-as-node variable silently flips every Electron binary an agent
 * launches into plain-Node mode.
 */
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  desktopInterpreterSpawnEnv,
  desktopNodeEnv,
  desktopNodeLauncher,
} from '../src/desktop-node-env.ts'
import {
  DESKTOP_INTERPRETER_ENV_KEYS,
  ensureEnvScrubModule,
  envScrubModuleSource,
} from '../src/env-scrub.ts'
import { buildDesktopRuntimeEnvironment } from '../src/runtime-environment.ts'
import { bundledRuntimePaths } from '../src/runtime-paths.ts'

const EXEC_PATH = '/Applications/DSH Studio.app/Contents/MacOS/Electron'

/** Keys the builder itself adds that are not DSH-namespaced but intended. */
const NON_NAMESPACED_ALLOWLIST = new Set(['NODE_USE_ENV_PROXY', 'PATH'])

function composedUserEnvironment() {
  const paths = bundledRuntimePaths('/Applications/DSH Studio.app/Contents/Resources', 'darwin')
  const userEnv = {
    ANDROID_HOME: '/android',
    GOPATH: '/go',
    PATH: '/Users/me/.local/bin:/usr/bin',
    SHELL: '/bin/zsh',
  }
  const environment = buildDesktopRuntimeEnvironment({
    appDataPath: '/Users/me/.dsh-studio',
    dshHome: '/Users/me/.dsh-studio',
    nodeEnvironment: desktopNodeEnv(paths, EXEC_PATH),
    paths,
    profile: 'desktop',
    userEnvironment: { env: userEnv, shell: '/bin/zsh', source: 'login-shell' },
    version: '0.1.2',
  })
  return { environment, userEnv }
}

test('guard: injected keys are namespaced or allowlisted, and no interpreter variable leaks', () => {
  const { environment, userEnv } = composedUserEnvironment()
  for (const key of DESKTOP_INTERPRETER_ENV_KEYS) {
    assert.equal(environment[key], undefined, `${key} must never enter inherited environments`)
  }
  for (const key of Object.keys(environment)) {
    if (key in userEnv) continue
    if (NON_NAMESPACED_ALLOWLIST.has(key)) continue
    assert.match(
      key,
      /^DSH_/,
      `injected key "${key}" must be DSH-namespaced or allowlisted`,
    )
  }
})

test('exec boundary: interpreter launch env carries run-as-node, ambient env does not', () => {
  const paths = { pnpmEntry: '/resources/dsh-runtime/node_modules/pnpm/bin.cjs' }
  const ambient = desktopNodeEnv(paths, EXEC_PATH)
  assert.equal(ambient.ELECTRON_RUN_AS_NODE, undefined)
  const execEnv = desktopInterpreterSpawnEnv(paths, EXEC_PATH)
  assert.equal(execEnv.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(execEnv.DSH_STUDIO_NODE_EXECUTABLE, EXEC_PATH)
  const launcher = desktopNodeLauncher(paths, EXEC_PATH)
  assert.equal(launcher.command, EXEC_PATH)
  assert.equal(launcher.env?.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(launcher.interpreter, true)
})

test('scrub module: generated deterministically and written idempotently', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-env-scrub-'))
  try {
    const modulePath = ensureEnvScrubModule(root)
    assert.ok(modulePath !== null)
    assert.equal(modulePath, join(root, 'cache/dsh-studio-env-scrub.cjs'))
    const first = readFileSync(modulePath, 'utf8')
    assert.equal(first, envScrubModuleSource())
    // Idempotent rewrite: same content on the second call.
    assert.equal(ensureEnvScrubModule(root), modulePath)
    assert.equal(readFileSync(modulePath, 'utf8'), first)
    for (const key of DESKTOP_INTERPRETER_ENV_KEYS) {
      assert.match(first, new RegExp(`delete process\\.env\\["${key}"\\]`))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('behavior: electron-as-node honors the scrub preload by unsetting the variable', { skip: !hasElectronBinary() }, t => {
  const electronBinary = resolveElectronBinary()
  if (electronBinary === null) return t.skip('electron binary unavailable')
  const root = mkdtempSync(join(tmpdir(), 'dsh-studio-env-scrub-live-'))
  try {
    const modulePath = ensureEnvScrubModule(root)
    assert.ok(modulePath !== null)
    const script = 'console.log(process.env.ELECTRON_RUN_AS_NODE === undefined ? "scrubbed" : "present")'
    const base = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    const withoutScrub = spawnSync(electronBinary, ['-e', script], { encoding: 'utf8', env: base })
    assert.equal(withoutScrub.stdout?.trim(), 'present', 'control: the variable reaches the child unchanged')
    const withScrub = spawnSync(
      electronBinary,
      ['--require', modulePath, '-e', script],
      { encoding: 'utf8', env: base },
    )
    assert.equal(withScrub.stdout?.trim(), 'scrubbed', 'the preload unsets the variable for descendants')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** Resolve the dev electron binary path the way its CLI shim does. */
function resolveElectronBinary(): string | null {
  try {
    const require = createRequire(import.meta.url)
    const candidate = require('../node_modules/electron/index.js') as unknown
    if (typeof candidate !== 'string') return null
    return existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

function hasElectronBinary(): boolean {
  return resolveElectronBinary() !== null
}
