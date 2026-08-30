import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  type DshDependencyFacts,
  TYPES_SANDBOX_PREFIX,
  clientExternalsFor,
  deriveDshSource,
  deriveInject,
  deriveTsconfigPaths,
  hostExternalsFor,
  isSpecifierCovered,
  readDependencyFacts,
  resolveConfiguredTypePaths,
  resolveTypesDeclaration,
  resolveTypesEntry,
} from '../scripts/sync-dsh-dependencies.mjs'

/** Minimal valid fact source used as fixture baseline. */
const FIXTURE_FACTS = () => ({
  runtime: {
    source: 'npm',
    package: '@deepseek-ai/dsh',
    version: '9.9.9-test',
    integrity: 'sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==',
    tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-9.9.9-test.tgz',
    packageManager: 'pnpm@11.20.0',
  },
  // Declared registration order is deliberately NOT alphabetical: the
  // generator must preserve it verbatim instead of re-sorting.
  inject: [
    '@dsh-studio/sidebar',
    '@deepseek-ai/dsh-client-runtime',
    '@dsh-studio/plugin-marketplace',
  ],
  externals: {
    clientBase: ['react', 'react-dom/client', 'react/jsx-runtime'],
    hostCapabilities: ['@deepseek-ai/*', 'cordis', 'ws'],
    runtimeClient: {
      module: '@deepseek-ai/dsh-client-runtime/client',
      plugins: ['sidebar'],
    },
  },
  typePackages: {
    '@deepseek-ai/dsh-brand': '@deepseek-ai/dsh-brand/lib/types/index.d.ts',
    '@deepseek-ai/dsh-session/surface': '@deepseek-ai/dsh-session/lib/types/surface.d.ts',
  },
  bundles: {
    desktop: ['@deepseek-ai/dsh-base'],
    web: ['@deepseek-ai/dsh-base'],
    tui: ['@deepseek-ai/dsh-base'],
  },
})

function factsRoot(facts: DshDependencyFacts) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dependencies-'))
  mkdirSync(join(root, 'config'), { recursive: true })
  writeFileSync(
    join(root, 'config', 'dsh-dependencies.json'),
    `${JSON.stringify(facts, undefined, 2)}\n`,
  )
  return root
}

test('inject list keeps declared registration order and rejects duplicates', () => {
  const facts = FIXTURE_FACTS()
  assert.deepEqual(deriveInject(facts), [
    '@dsh-studio/sidebar',
    '@deepseek-ai/dsh-client-runtime',
    '@dsh-studio/plugin-marketplace',
  ])

  const root = factsRoot({ ...facts, inject: ['@dsh-studio/a', '@dsh-studio/a'] })
  assert.throws(() => readDependencyFacts(root), /duplicate/i)
  rmSync(root, { recursive: true, force: true })
})

test('pinned release manifest derives field-for-field from the runtime pin', () => {
  const derived = deriveDshSource(FIXTURE_FACTS())
  assert.deepEqual(derived, {
    source: 'npm',
    package: '@deepseek-ai/dsh',
    version: '9.9.9-test',
    integrity: 'sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==',
    tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-9.9.9-test.tgz',
    packageManager: 'pnpm@11.20.0',
  })

  const git = deriveDshSource({
    ...FIXTURE_FACTS(),
    runtime: {
      source: 'git',
      repository: 'https://example.com/dsh.git',
      ref: 'abc',
      revision: 'a'.repeat(40),
      version: '0.0.0',
    },
  })
  assert.equal(git.source, 'git')
  assert.equal(git.revision, 'a'.repeat(40))
})

test('exports.types resolution accepts string and condition forms only', () => {
  assert.equal(resolveTypesEntry({ '.': './lib/types/index.d.ts' }, ''), './lib/types/index.d.ts')
  assert.equal(
    resolveTypesEntry({ './client': { types: './lib/types/client.d.ts' } }, 'client'),
    './lib/types/client.d.ts',
  )
  assert.equal(resolveTypesEntry({ './client': { default: './client.js' } }, 'client'), null)
  assert.equal(resolveTypesEntry({ '.': './index.js' }, 'missing'), null)
  assert.equal(resolveTypesEntry(undefined, ''), null)
})

test('typePackages seed tsconfig paths into the npm-types sandbox in declared order', () => {
  const paths = deriveTsconfigPaths(FIXTURE_FACTS())
  assert.deepEqual(Object.keys(paths), [
    '@deepseek-ai/dsh-brand',
    '@deepseek-ai/dsh-session/surface',
  ])
  assert.deepEqual(paths['@deepseek-ai/dsh-brand'], [
    `${TYPES_SANDBOX_PREFIX}@deepseek-ai/dsh-brand/lib/types/index.d.ts`,
  ])
})

test('host externals apply to the capabilities gateway only', () => {
  const facts = FIXTURE_FACTS()
  assert.deepEqual(hostExternalsFor(facts, 'capabilities'), ['@deepseek-ai/*', 'cordis', 'ws'])
  assert.deepEqual(hostExternalsFor(facts, 'sidebar'), [])
})

test('client externals append the injected runtime module per configured plugin', () => {
  const facts = FIXTURE_FACTS()
  assert.deepEqual(clientExternalsFor(facts, 'sidebar'), [
    'react',
    'react-dom/client',
    'react/jsx-runtime',
    '@deepseek-ai/dsh-client-runtime/client',
  ])
  assert.deepEqual(clientExternalsFor(facts, 'panel-controls'), [
    'react',
    'react-dom/client',
    'react/jsx-runtime',
  ])
})

test('externals matcher covers exact entries and wildcards but not strangers', () => {
  const facts = FIXTURE_FACTS()
  assert.equal(isSpecifierCovered(facts, 'react'), true)
  assert.equal(isSpecifierCovered(facts, 'react/jsx-runtime'), true)
  assert.equal(isSpecifierCovered(facts, '@deepseek-ai/dsh-tools'), true) // @deepseek-ai/*
  assert.equal(isSpecifierCovered(facts, 'unlisted/stranger'), false)
  // Positive control for the absence assertion: removing every pattern makes
  // even official specifiers uncovered.
  const bare = {
    ...facts,
    externals: {
      ...facts.externals,
      clientBase: [],
      hostCapabilities: [],
      runtimeClient: { ...facts.externals.runtimeClient, module: '' },
    },
  }
  assert.equal(isSpecifierCovered(bare, '@deepseek-ai/dsh-tools'), false)
})

test('fact source validation rejects malformed sections', () => {
  const facts = FIXTURE_FACTS()
  const traversal = factsRoot({
    ...facts,
    typePackages: { '@deepseek-ai/dsh-x': '../escape.d.ts' },
  })
  assert.throws(() => readDependencyFacts(traversal), /traversal/)
  rmSync(traversal, { recursive: true, force: true })

  const emptyInject = factsRoot({ ...facts, inject: [] })
  assert.throws(() => readDependencyFacts(emptyInject), /non-empty/)
  rmSync(emptyInject, { recursive: true, force: true })
})

test('declarations resolve through exports.types inside an installed sandbox', () => {
  const packages = mkdtempSync(join(tmpdir(), 'dsh-types-sandbox-'))
  try {
    const writePackage = (
      name: string,
      pkgJson: Record<string, unknown>,
      files: Record<string, string>,
    ) => {
      const dir = join(packages, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkgJson))
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(join(dir, rel, '..'), { recursive: true })
        writeFileSync(join(dir, rel), body)
      }
    }
    writePackage('@deepseek-ai/pkg-string', { exports: { '.': './lib/types/index.d.ts' } }, {
      'lib/types/index.d.ts': 'export {}',
    })
    writePackage('@deepseek-ai/pkg-condition', { exports: { './client': { types: './types.d.ts' } } }, {
      'types.d.ts': 'export {}',
    })
    writePackage('@deepseek-ai/pkg-broken', { exports: { '.': './lib/types/missing.d.ts' } }, {})

    assert.equal(
      resolveTypesDeclaration(packages, '@deepseek-ai/pkg-string'),
      '@deepseek-ai/pkg-string/lib/types/index.d.ts',
    )
    assert.equal(
      resolveTypesDeclaration(packages, '@deepseek-ai/pkg-condition/client'),
      '@deepseek-ai/pkg-condition/types.d.ts',
    )
    assert.equal(resolveTypesDeclaration(packages, '@deepseek-ai/pkg-broken'), null)
    assert.equal(resolveTypesDeclaration(packages, '@deepseek-ai/pkg-absent'), null)
  } finally {
    rmSync(packages, { recursive: true, force: true })
  }
})

test('configured type paths resolve in bulk and report every missing specifier', () => {
  const packages = mkdtempSync(join(tmpdir(), 'dsh-types-bulk-'))
  try {
    const writePackage = (name: string, pkgJson: Record<string, unknown>) => {
      const dir = join(packages, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkgJson))
      mkdirSync(join(dir, 'lib', 'types'), { recursive: true })
      writeFileSync(join(dir, 'lib/types/index.d.ts'), 'export {}')
    }
    writePackage('@deepseek-ai/pkg-ok-root', { exports: { '.': './lib/types/index.d.ts' } })
    writePackage('@deepseek-ai/pkg-ok-sub', { exports: { './client': { types: './lib/types/index.d.ts' } } })

    const facts = {
      ...FIXTURE_FACTS(),
      typePackages: {
        '@deepseek-ai/pkg-ok-root': '@deepseek-ai/pkg-ok-root/lib/types/index.d.ts',
        '@deepseek-ai/pkg-ok-sub/client': '@deepseek-ai/pkg-ok-sub/lib/types/index.d.ts',
        '@deepseek-ai/pkg-missing': '@deepseek-ai/pkg-missing/lib/types/index.d.ts',
      },
    }
    const { resolved, missing } = resolveConfiguredTypePaths(packages, facts)
    assert.deepEqual(missing, ['@deepseek-ai/pkg-missing'])
    assert.deepEqual(resolved, {
      '@deepseek-ai/pkg-ok-root': '@deepseek-ai/pkg-ok-root/lib/types/index.d.ts',
      '@deepseek-ai/pkg-ok-sub/client': '@deepseek-ai/pkg-ok-sub/lib/types/index.d.ts',
    })
    // The build:dsh rewrite feeds the resolved facts straight back into the
    // shared seed derivation: sandbox-relative targets, no local path logic.
    assert.deepEqual(
      deriveTsconfigPaths({ ...facts, typePackages: resolved }),
      deriveTsconfigPaths({
        ...facts,
        typePackages: {
          '@deepseek-ai/pkg-ok-root': '@deepseek-ai/pkg-ok-root/lib/types/index.d.ts',
          '@deepseek-ai/pkg-ok-sub/client': '@deepseek-ai/pkg-ok-sub/lib/types/index.d.ts',
        },
      }),
    )
  } finally {
    rmSync(packages, { recursive: true, force: true })
  }
})

test('guard --build-dsh proves the build:dsh single-source contract on this tree', () => {
  // Behavior test of the guard CLI's structural mode (not a grep of the
  // sources from the test itself): the guard reconciles that build-dsh
  // consumes the shared rules and owns no duplicate resolution block.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'guards', 'guard-dsh-dependencies.mjs'), '--build-dsh'], { encoding: 'utf8' })
  assert.equal(result.status, 0, `guard --build-dsh failed:\n${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /BUILD-DSH-SINGLE-SOURCE-OK/)
})
