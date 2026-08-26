import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type {
  BundleBuildInput,
  DshCommandInput,
  LoadCatalogOptions,
  MarketplaceAuthResult,
  MarketplacePlatform,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import { startMarketplaceAgentGateway } from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'
import {
  PluginMarketplaceManager,
  type MarketplacePreviewRuntimeInput,
  type MarketplaceRuntime,
} from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import { regenerateManagedAllowBuilds } from '../plugins/plugin-marketplace/src/host/allowbuild-yaml.ts'

// Behavior tests for the leaf-3.3 whole-block allowBuild protocol and the
// error-retention snapshot semantics:
// - G1: the managed block is stripped and regenerated deterministically
//   (idempotent reruns are byte-stable); any allowBuilds key outside the
//   block is rejected with its line number; surrounding YAML bytes
//   (comments, quoting, CRLF) survive untouched.
// - G2: a failed dispatch's error survives repeated snapshots until the next
//   successful dispatch clears it; a deferred agent-gateway failure enters
//   that retention too.

const BEGIN = '# >>> DSH Studio allowed plugin builds'
const END = '# <<< DSH Studio allowed plugin builds'

function blockLines(...entries: string[]): string[] {
  return [BEGIN, 'allowBuilds:', ...entries.map(name => `  '${name}': true`), END]
}

function parseAllowBuilds(text: string): Record<string, boolean> {
  // Structural mini-parse of pnpm-workspace.yaml: only the top-level keys and
  // the managed allowBuilds mapping are asserted on, never raw wording.
  const result: Record<string, boolean> = {}
  let inside = false
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue
    if (/^allowBuilds:\s*$/.test(line)) {
      inside = true
      continue
    }
    if (inside && /^[ \t]/.test(line)) {
      const match = /^[ \t]+(?:'((?:[^']|'')*)'|([^'# \t][^:#]*?)):[ \t]*true[ \t]*$/.exec(line)
      assert.notEqual(match, null, `unparseable allowBuilds entry: ${line}`)
      const name = match![1] !== undefined
        ? match![1].replaceAll("''", "'")
        : match![2]?.trim()
      assert.ok(name, `unparseable allowBuilds key: ${line}`)
      result[name!] = true
      continue
    }
    if (inside && line.trim() !== '') inside = false
  }
  return result
}

/** Run the regeneration and flatten any rejection into its message. */
function regenerateError(text: string): string {
  try {
    regenerateManagedAllowBuilds(text, '@example/probe')
    return ''
  } catch (error) {
    return (error as Error).message
  }
}

test('regenerating without an existing block appends one deterministic sorted block', () => {
  const once = regenerateManagedAllowBuilds('packages:\n  - .\n', '@example/bundle-demo')
  const expected = ['packages:', '  - .', '', ...blockLines('@example/bundle-demo'), ''].join('\n')
  assert.equal(once, expected)

  // Idempotent: rerunning over the produced text is byte-stable.
  assert.equal(regenerateManagedAllowBuilds(once, '@example/bundle-demo'), once)

  // Deterministic merge order: insertion order never leaks into the output.
  const ab = regenerateManagedAllowBuilds(
    regenerateManagedAllowBuilds('packages:\n', '@example/a'),
    '@example/b',
  )
  const ba = regenerateManagedAllowBuilds(
    regenerateManagedAllowBuilds('packages:\n', '@example/b'),
    '@example/a',
  )
  assert.equal(ab, ba)
  assert.deepEqual(Object.keys(parseAllowBuilds(ab)), ['@example/a', '@example/b'])
})

test('regeneration replaces the marked block in place and damages no surrounding byte', () => {
  const original = [
    '# team comment – keep me',
    'packages:',
    '  - .',
    '  - ./tools',
    '',
    ...blockLines('@example/old'),
    '',
    'minimumReleaseAge: 1440',
    '',
  ].join('\n')
  const rewritten = regenerateManagedAllowBuilds(original, '@example/new')

  // Everything outside the markers survives byte-for-byte.
  const beginIndex = rewritten.indexOf(BEGIN)
  const endIndex = rewritten.indexOf(END) + END.length
  assert.equal(rewritten.slice(0, beginIndex), original.slice(0, original.indexOf(BEGIN)))
  assert.equal(rewritten.slice(endIndex), original.slice(original.indexOf(END) + END.length))
  assert.ok(rewritten.includes('# team comment – keep me'))
  assert.ok(rewritten.includes('minimumReleaseAge: 1440'))

  // Old entries are preserved and merged into the sorted block.
  assert.equal(regenerateManagedAllowBuilds(rewritten, '@example/new'), rewritten)
  assert.deepEqual(
    Object.keys(parseAllowBuilds(rewritten)),
    ['@example/new', '@example/old'],
  )
})

test('regeneration preserves CRLF endings, quoted names, and legacy bare entries', () => {
  const crlf = [
    'packages:\r',
    '  - .\r',
    `${BEGIN}\r`,
    'allowBuilds:\r',
    "  '@example/one': true\r",
    '  @example/bare: true\r',
    `${END}\r`,
    'onlyBuiltDependencies:\r',
    '  - esbuild\r',
    '',
  ].join('\n')
  const rewritten = regenerateManagedAllowBuilds(crlf, "@example/two's")

  // Every non-block line keeps its exact bytes including the \r.
  assert.ok(rewritten.includes('packages:\r\n  - .\r\n'))
  assert.ok(rewritten.includes("onlyBuiltDependencies:\r\n  - esbuild\r\n"))

  // The quoted name round-trips (including an escaped quote) and the legacy
  // bare entry is re-emitted through the same quoting rules.
  const parsed = parseAllowBuilds(rewritten.replaceAll('\r\n', '\n'))
  assert.deepEqual(Object.keys(parsed).sort(), ['@example/bare', '@example/one', "@example/two's"])

  // Idempotent on CRLF input too.
  assert.equal(regenerateManagedAllowBuilds(rewritten, '@example/one'), rewritten)
})

test('a foreign allowBuilds key outside the block is rejected with its line number', () => {
  const before = [
    'packages:',
    '  - .',
    'allowBuilds:',
    "  '@rogue/pkg': true",
    '',
    BEGIN,
    'allowBuilds:',
    "  '@example/x': true",
    END,
    '',
  ].join('\n')
  assert.match(regenerateError(before), /line 3/)

  const after = [BEGIN, 'allowBuilds:', "  '@example/x': true", END, 'onlyBuiltDependencies:', '  - esbuild', 'allowBuilds:', "  '@rogue/pkg': true"].join('\n')
  assert.match(regenerateError(after), /line 7/)

  const nested = [BEGIN, 'allowBuilds:', "  '@example/x': true", END, 'something:', '  allowBuilds: {}'].join('\n')
  assert.match(regenerateError(nested), /line 6/)
})

test('an unterminated managed block is reported instead of silently truncated', () => {
  assert.throws(
    () => regenerateManagedAllowBuilds([BEGIN, 'allowBuilds:', "  '@example/x': true"].join('\n'), '@example/y'),
    /managed configuration block is missing # <<< DSH Studio allowed plugin builds/,
  )
})

// ---------------------------------------------------------------------------
// Integration: preview drives allowBuild through the real manager.
// ---------------------------------------------------------------------------

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

class FakePlatform implements MarketplacePlatform {
  async authStatus(): Promise<MarketplaceAuthResult> {
    return { detail: 'test auth', status: 'ready' }
  }

  async buildBundle(_input: BundleBuildInput): Promise<void> {}

  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'index.js'), 'export function apply() {}\n')
  }

  async loadCatalog(_options: LoadCatalogOptions = {}): Promise<unknown> {
    return {
      schema: 'dsh-external-hub/v0.1',
      generated: '2026-08-10T17:17:56.572Z',
      repos: [{
        name: 'bundle-demo',
        repo: 'dsh-external/bundle-demo',
        category: 'plugin',
        description: 'Bundle demo',
        bundle: true,
        repository: false,
        tags: ['web-ui'],
      }],
    }
  }

  async readRepositoryFile(repository: string, path: string): Promise<string | null> {
    if (repository !== 'dsh-external/bundle-demo') return null
    if (path === 'package.json') {
      return JSON.stringify({
        name: '@example/bundle-demo',
        description: 'bundle-demo manifest',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
        license: 'MIT',
        main: './index.js',
        scripts: { prepare: 'node build.mjs' },
        version: '1.0.0',
      })
    }
    if (path === 'cordis.patch.yml') return '- insert:\n    - id: fixture-row\n      name: ./index.js\n'
    if (path === 'index.js') return 'export function apply() {}\n'
    return null
  }

  async resolveCommit(_repository: string): Promise<string> {
    return COMMIT
  }

  async runDsh(input: DshCommandInput): Promise<void> {
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    if (input.args.includes('add')) {
      manifest.dependencies['@example/bundle-demo'] = `link:${input.args.at(-1) as string}`
      if (!manifest.dsh.profile.bundles.includes('@example/bundle-demo')) {
        manifest.dsh.profile.bundles.push('@example/bundle-demo')
      }
    } else if (input.args.includes('remove')) {
      delete manifest.dependencies['@example/bundle-demo']
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles
        .filter(entry => entry !== '@example/bundle-demo')
    }
    writeFileSync(profile, JSON.stringify(manifest, undefined, 2) + '\n')
  }
}

class FakeRuntime implements MarketplaceRuntime {
  failStartLive = false

  async startLive(): Promise<void> {
    if (this.failStartLive) throw new Error('simulated live-start failure')
  }
  async stopLive(): Promise<void> {}
  async startPreview(_input: MarketplacePreviewRuntimeInput): Promise<void> {}
  async stopPreview(): Promise<void> {}
}

interface Fixture {
  appDataPath: string
  cleanup(): void
  manager: PluginMarketplaceManager
  platform: FakePlatform
  profileDir: string
  runtime: FakeRuntime
}

function fixture(): Fixture {
  const appDataPath = mkdtempSync(join(tmpdir(), 'dsh-studio-marketplace-allowbuild-'))
  const dshHome = join(appDataPath, 'dsh')
  const profileDir = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@dsh-studio/desktop'] } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  // A pre-seeded foreign comment plus a differently-shaped packages list must
  // survive a marketplace-managed build allowance untouched.
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), [
    '# operator comment',
    'packages:',
    '  - .',
    'onlyBuiltDependencies:',
    '  - esbuild',
    '',
  ].join('\n'))
  const platform = new FakePlatform()
  const runtime = new FakeRuntime()
  const manager = new PluginMarketplaceManager({
    appDataPath,
    dshHome,
    platform,
    profile: 'desktop',
    runtime,
  })
  return {
    appDataPath,
    cleanup: () => { rmSync(appDataPath, { recursive: true, force: true }) },
    manager,
    platform,
    profileDir,
    runtime,
  }
}

async function driveToPreviewing(setup: Fixture): Promise<MarketplacePreviewRuntimeInput> {
  assert.equal((await setup.manager.dispatch({ type: 'refresh' })).error, null)
  assert.equal(
    (await setup.manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'bundle-demo' })).error,
    null,
  )
  const snapshot = await setup.manager.dispatch({
    type: 'preview',
    confirmations: ['allow-build-scripts'],
  })
  assert.equal(snapshot.error, null)
  const transactionId = snapshot.preview?.transactionId
  assert.ok(typeof transactionId === 'string')
  return { dshHome: '', pluginId: 'bundle-demo', sandboxRoot: '', transactionId }
}

test('a bundle preview regenerates the managed block inside the preview profile without touching surrounding YAML', async () => {
  const setup = fixture()
  try {
    const { transactionId } = await driveToPreviewing(setup)
    const workspacePath = join(
      setup.appDataPath,
      'plugin-marketplace',
      'previews',
      transactionId,
      'dsh',
      'profiles',
      'desktop',
      'pnpm-workspace.yaml',
    )
    assert.equal(existsSync(workspacePath), true)
    const text = readFileSync(workspacePath, 'utf8')

    // Structural contract of the rewritten file.
    assert.deepEqual(Object.keys(parseAllowBuilds(text)), ['@example/bundle-demo'])
    assert.ok(text.startsWith('# operator comment\npackages:\n  - .\n'))
    assert.ok(text.includes('onlyBuiltDependencies:\n  - esbuild\n'))

    // Whole-block shape: markers own the whole allowBuilds key at top level.
    assert.equal(text.includes(BEGIN), true)
    assert.equal(text.includes(END), true)
    const interior = text.slice(text.indexOf(BEGIN), text.indexOf(END))
    assert.match(interior, /^# >>> DSH Studio allowed plugin builds\nallowBuilds:\n  '@example\/bundle-demo': true\n$/)
  } finally {
    setup.cleanup()
  }
})

test('error retention: a failed dispatch error survives repeated snapshots until the next success', async () => {
  const setup = fixture()
  try {
    assert.equal((await setup.manager.dispatch({ type: 'refresh' })).error, null)
    assert.equal(
      (await setup.manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'bundle-demo' })).error,
      null,
    )
    setup.platform.buildBundle = async (): Promise<void> => {
      throw new Error('build exploded')
    }
    const failed = await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts'],
    })
    assert.match(failed.error ?? '', /build exploded/)

    // Read-only snapshots keep surfacing the retained failure.
    assert.match(setup.manager.getSnapshot().error ?? '', /build exploded/)
    assert.match(setup.manager.getSnapshot().error ?? '', /build exploded/)
    assert.match(setup.manager.getSnapshot().error ?? '', /build exploded/)

    // The next successful dispatch supersedes it.
    const refreshed = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(refreshed.error, null)
    assert.equal(setup.manager.getSnapshot().error, null)
  } finally {
    setup.cleanup()
  }
})

test('agent-gateway deferred apply failure enters retention and stays visible', async () => {
  const setup = fixture()
  try {
    await driveToPreviewing(setup)
    setup.runtime.failStartLive = true
    const errors: unknown[] = []
    const stateChanges: Array<() => void> = []
    const gateway = await startMarketplaceAgentGateway(setup.manager, {
      deferMs: 5,
      onError: error => { errors.push(error) },
      onStateChange: () => { stateChanges.push(() => {}) },
    })
    try {
      const response = await fetch(`${gateway.url}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${gateway.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'dispatch', command: { type: 'apply' } }),
      })
      assert.equal(response.status, 202)
      const body = await response.json() as { accepted: boolean; deferred: boolean }
      assert.equal(body.accepted, true)
      assert.equal(body.deferred, true)

      // Wait for the deferred dispatch to land (onStateChange fires last).
      for (let waited = 0; waited < 100 && stateChanges.length === 0; waited += 1) {
        await new Promise(resolve => { setTimeout(resolve, 20) })
      }
      assert.equal(stateChanges.length > 0, true, 'deferred apply never settled')
      assert.equal(errors.length > 0, true, 'deferred apply failure was not reported')

      // The deferred failure is retained across snapshots.
      assert.match(setup.manager.getSnapshot().error ?? '', /failed to apply and was rolled back/)
      assert.match(setup.manager.getSnapshot().error ?? '', /failed to apply and was rolled back/)
      // And the profile was rolled back intact.
      const manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
      }
      assert.deepEqual(manifest.dependencies, {})
    } finally {
      await gateway.close()
    }
  } finally {
    setup.cleanup()
  }
})
