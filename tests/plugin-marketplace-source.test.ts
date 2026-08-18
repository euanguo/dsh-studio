import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  GitHubSourceAdapter,
} from '../plugins/plugin-marketplace/src/host/github-source-adapter.ts'
import {
  CatalogSourceManager,
} from '../plugins/plugin-marketplace/src/host/catalog-source-manager.ts'
import {
  FIXTURE_COMMIT,
  FIXTURE_REPOSITORY,
  PINNED_DSH_VERSION,
  type CatalogSource,
  type RepositorySourceAdapter,
} from '../plugins/plugin-marketplace/src/host/source-types.ts'
import {
  DefaultMarketplaceSourceResolver,
  MarketplaceSourceError,
  normalizedInstallSpec,
  canonicalizeRepositorySource,
} from '../plugins/plugin-marketplace/src/host/source-resolver.ts'
import {
  migrateMarketplaceLocks,
  sourceLockFromCandidate,
} from '../plugins/plugin-marketplace/src/host/source-lock.ts'
import {
  parseMarketplaceCommand,
} from '../plugins/plugin-marketplace/src/protocol.ts'

const FIXTURE_MANIFEST = JSON.stringify({
  name: 'dsh-sandbox-escalation-fix',
  version: '0.1.0',
  license: 'MIT',
  description: 'Static contract fixture for the sandbox escalation fix.',
  main: './src/index.ts',
  exports: { '.': './src/index.ts' },
  peerDependencies: { 'deepseek-harness': '>=0.1.0-rc.5 <0.1.0' },
  scripts: {
    build: 'tsc -p tsconfig.json',
    prepare: 'pnpm run build',
    test: 'node --test',
  },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}, undefined, 2)

const FIXTURE_PATCH = [
  '- insert:',
  '    - id: sandbox-escalation-fix',
  '      name: ./src/index.ts',
  '',
].join('\n')

const FIXTURE_ENTRY = 'export function apply() { return undefined }\n'

class FixtureRepositoryAdapter implements RepositorySourceAdapter {
  readonly reads: Array<{ commit: string; path: string; repository: string }> = []
  readonly refs: Array<{ ref: string | null; repository: string }> = []
  readonly files = new Map<string, string>([
    [`${FIXTURE_REPOSITORY}:package.json`, FIXTURE_MANIFEST],
    [`${FIXTURE_REPOSITORY}:cordis.patch.yml`, FIXTURE_PATCH],
    [`${FIXTURE_REPOSITORY}:src/index.ts`, FIXTURE_ENTRY],
  ])

  async readFile(repository: string, path: string, commit: string): Promise<string | null> {
    this.reads.push({ commit, path, repository })
    return this.files.get(`${repository}:${path}`) ?? null
  }

  async resolveCommit(repository: string, requestedRef: string | null = null): Promise<string> {
    this.refs.push({ ref: requestedRef, repository })
    return FIXTURE_COMMIT
  }
}

function sourceCatalog(id: string, priority: number): CatalogSource {
  return {
    digest: null,
    etag: null,
    enabled: true,
    id,
    kind: 'json',
    label: id,
    lastCommit: null,
    lastError: null,
    lastSuccessfulFetchAt: null,
    locator: `https://example.test/${id}.json`,
    priority,
    signature: null,
    trust: 'user',
  }
}

function resolver(adapter: FixtureRepositoryAdapter): DefaultMarketplaceSourceResolver {
  return new DefaultMarketplaceSourceResolver({
    dshVersion: PINNED_DSH_VERSION,
    repository: adapter,
  })
}

test('public GitHub adapter resolves refs and reads exact commit files without gh', async () => {
  const requests: string[] = []
  const adapter = new GitHubSourceAdapter({
    fetch: async (input): Promise<Response> => {
      requests.push(String(input))
      if (String(input).includes('/commits/feature%2Frc-7')) {
        return new Response(JSON.stringify({ sha: FIXTURE_COMMIT }), { status: 200 })
      }
      return new Response('fixture-file', { status: 200 })
    },
  })
  assert.equal(await adapter.resolveCommit(FIXTURE_REPOSITORY, 'feature/rc-7'), FIXTURE_COMMIT)
  assert.equal(await adapter.readFile(FIXTURE_REPOSITORY, 'src/index.ts', FIXTURE_COMMIT), 'fixture-file')
  assert.equal(requests[0], `https://api.github.com/repos/${FIXTURE_REPOSITORY}/commits/feature%2Frc-7`)
  assert.equal(requests[1], `https://raw.githubusercontent.com/${FIXTURE_REPOSITORY}/${FIXTURE_COMMIT}/src/index.ts`)
})

test('forced fixture resolves directly without a catalog and pins every read', async () => {
  const adapter = new FixtureRepositoryAdapter()
  const candidate = await resolver(adapter).resolveRepository({
    input: `https://github.com/${FIXTURE_REPOSITORY}`,
    kind: 'repository',
  })

  assert.equal(candidate.identity.packageName, 'dsh-sandbox-escalation-fix')
  assert.equal(candidate.identity.repository, FIXTURE_REPOSITORY)
  assert.equal(candidate.mechanism, 'bundle')
  assert.equal(candidate.execution, 'installable')
  assert.equal(candidate.manifest.path, 'package.json')
  assert.equal(candidate.manifest.bundlePatch, 'cordis.patch.yml')
  assert.equal(candidate.source.resolvedCommit, FIXTURE_COMMIT)
  assert.equal(candidate.source.installSpec, `github:${FIXTURE_REPOSITORY}#${FIXTURE_COMMIT}`)
  assert.equal(candidate.buildScripts.prepare, 'pnpm run build')
  assert.equal(candidate.evidence.compatibility?.compatible, true)
  assert.match(candidate.manifest.hash, /^[0-9a-f]{64}$/)
  assert.match(candidate.manifest.patchHash ?? '', /^[0-9a-f]{64}$/)
  assert.match(candidate.manifest.artifactDigest, /^[0-9a-f]{64}$/)
  const lock = sourceLockFromCandidate(candidate)
  assert.equal(lock.installSpec, candidate.source.installSpec)
  assert.equal(lock.resolvedCommit, FIXTURE_COMMIT)
  assert.equal(lock.manifestPath, 'package.json')
  assert.equal(lock.patchHash, candidate.manifest.patchHash)
  assert.equal(lock.artifactDigest, candidate.manifest.artifactDigest)
  assert.ok(adapter.reads.every(read => read.commit === FIXTURE_COMMIT))

  const plan = resolver(adapter).makePlan(candidate, 'install')
  assert.equal(plan.execution, 'installable')
  assert.deepEqual(plan.requirements, ['accept-high-risk', 'allow-build-scripts'])
  assert.ok(plan.riskReasons.includes('untrusted-source'))
  assert.ok(plan.riskReasons.includes('install-scripts'))
})

test('requested refs remain evidence while execution stays exact', async () => {
  const adapter = new FixtureRepositoryAdapter()
  const candidate = await resolver(adapter).resolveRepository({
    input: `https://github.com/${FIXTURE_REPOSITORY}`,
    kind: 'repository',
    requestedRef: 'release/rc-7',
  })
  assert.equal(candidate.source.requestedRef, 'release/rc-7')
  assert.equal(candidate.source.resolvedCommit, FIXTURE_COMMIT)
  assert.deepEqual(adapter.refs, [{ repository: FIXTURE_REPOSITORY, ref: 'release/rc-7' }])
})

test('repository source normalization rejects shell, traversal, and floating install specs', () => {
  assert.equal(
    canonicalizeRepositorySource({ input: FIXTURE_REPOSITORY, kind: 'repository' }).locator,
    `https://github.com/${FIXTURE_REPOSITORY}`,
  )
  assert.throws(
    () => canonicalizeRepositorySource({ input: 'https://github.com/a/b?ref=main', kind: 'repository' }),
    (error: unknown) => error instanceof MarketplaceSourceError && error.code === 'invalid-source-ref',
  )
  assert.throws(
    () => canonicalizeRepositorySource({ input: 'a/b;rm -rf', kind: 'repository' }),
    (error: unknown) => error instanceof MarketplaceSourceError && error.code === 'invalid-source-ref',
  )
  assert.throws(
    () => canonicalizeRepositorySource({ input: 'https://github.com/a/b/tree/main/../escape', kind: 'repository' }),
    (error: unknown) => error instanceof MarketplaceSourceError && error.code === 'invalid-source-ref',
  )
  assert.equal(normalizedInstallSpec(FIXTURE_REPOSITORY, FIXTURE_COMMIT), `github:${FIXTURE_REPOSITORY}#${FIXTURE_COMMIT}`)
  assert.throws(() => normalizedInstallSpec(FIXTURE_REPOSITORY, 'main'), /40-character commit/)
})

test('repository-plugin manifests are diagnostic-only and cannot produce an apply plan', async () => {
  const adapter = new FixtureRepositoryAdapter()
  adapter.files.delete(`${FIXTURE_REPOSITORY}:package.json`)
  adapter.files.set(`${FIXTURE_REPOSITORY}:package.json`, JSON.stringify({
    name: 'repository-only-fixture',
    version: '1.0.0',
    license: 'MIT',
  }))
  adapter.files.set(`${FIXTURE_REPOSITORY}:.dsh-plugin/package.json`, JSON.stringify({
    name: 'repository-only-fixture',
    version: '1.0.0',
    license: 'MIT',
    scripts: { prepare: 'node prepare.js' },
  }))
  const sourceResolver = resolver(adapter)
  const candidate = await sourceResolver.resolveRepository({ input: FIXTURE_REPOSITORY, kind: 'repository' })
  assert.equal(candidate.mechanism, 'repository')
  assert.equal(candidate.execution, 'guide-only')
  assert.equal(candidate.manifest.path, '.dsh-plugin/package.json')
  assert.equal(candidate.risk.level, 'blocked')
  const plan = sourceResolver.makePlan(candidate, 'install')
  assert.equal(plan.execution, 'guide-only')
  assert.equal(plan.riskLevel, 'blocked')
  assert.ok(plan.riskReasons.includes('unsupported-runtime'))
})

test('source locks migrate v2 facts without inventing trust', () => {
  const migrated = migrateMarketplaceLocks([{
    canonicalSource: `github:${FIXTURE_REPOSITORY}`,
    firstSeenCommit: FIXTURE_COMMIT,
    manifestHash: 'a'.repeat(64),
    mechanism: 'bundle',
    packageName: 'dsh-sandbox-escalation-fix',
    pluginId: 'dsh-sandbox-escalation-fix',
    recordedAt: '2026-01-01T00:00:00.000Z',
    resolvedCommit: FIXTURE_COMMIT,
  }])
  assert.equal(migrated.length, 1)
  assert.equal(migrated[0]?.installSpec, `github:${FIXTURE_REPOSITORY}#${FIXTURE_COMMIT}`)
  assert.equal(migrated[0]?.catalogSourceId, null)
  assert.equal(migrated[0]?.artifactDigest, 'a'.repeat(64))
  assert.equal(migrated[0]?.requestedRef, null)
})

test('catalog snapshots merge duplicate identities by priority and retain origin', async () => {
  const docs = new Map<string, unknown>([
    ['low', { schema: 'dsh-external-hub/v0.1', repos: [{ name: 'same', repo: 'owner/same', bundle: true }] }],
    ['high', { schema: 'dsh-external-hub/v0.1', repos: [{ name: 'same', repo: 'owner/same', bundle: false, repository: false }] }],
  ])
  const manager = new CatalogSourceManager(async source => docs.get(source.id))
  const low = await manager.resolveCatalogSource(sourceCatalog('low', 1))
  const high = await manager.resolveCatalogSource(sourceCatalog('high', 2))
  const merged = manager.merge([low, high])
  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.catalogSourceId, 'high')
})

test('protocol accepts a direct sourceRef while retaining pluginId compatibility', () => {
  const command = parseMarketplaceCommand({
    type: 'prepare',
    action: 'install',
    sourceRef: { kind: 'repository', input: `https://github.com/${FIXTURE_REPOSITORY}` },
  })
  assert.equal(command.type, 'prepare')
  assert.equal(command.sourceRef?.kind, 'repository')
  assert.throws(() => parseMarketplaceCommand({
    type: 'prepare',
    action: 'install',
  }), /pluginId or sourceRef/)
})

test('pinned DSH source statically proves bundle-only profile composition', () => {
  const root = '/Users/verger/code_source/front_end/important_project/deepseek-harness'
  const pluginPath = `${root}/apps/cli/src/plugin.ts`
  const profilePath = `${root}/packages/boot/app-boot/src/profile.ts`
  const removalPath = `${root}/.agents/notes/implemented/simplification/2026-08-09-remove-repository-plugin.md`
  if (!existsSync(pluginPath) || !existsSync(profilePath) || !existsSync(removalPath)) return
  const plugin = readFileSync(pluginPath, 'utf8')
  const profile = readFileSync(profilePath, 'utf8')
  const removal = readFileSync(removalPath, 'utf8')
  assert.match(plugin, /dsh\.bundle/)
  assert.match(plugin, /dsh\.profile\.bundles/)
  assert.match(profile, /profile bundle .* declares no dsh\.bundle/)
  assert.match(profile, /loadOverlayPatches\(binName, patchPath\)/)
  assert.match(removal, /\.dsh-plugin/)
  assert.match(removal, /one standalone external-Plugin distribution path/)
})

test('candidate validator tolerates wildcard export patterns when concrete entries exist', async () => {
  const adapter = new FixtureRepositoryAdapter()
  const manifestWithWildcards = JSON.stringify({
    name: 'wildcard-plugin',
    version: '1.0.0',
    license: 'MIT',
    exports: {
      '.': './src/index.ts',
      './*': './dist/*',
      './internal/*': null,
    },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  adapter.files.set('wildcard/repo:package.json', manifestWithWildcards)
  adapter.files.set('wildcard/repo:cordis.patch.yml', FIXTURE_PATCH)
  adapter.files.set('wildcard/repo:src/index.ts', FIXTURE_ENTRY)
  const candidate = await resolver(adapter).resolveRepository({ input: 'wildcard/repo', kind: 'repository' })
  assert.equal(candidate.execution, 'installable')
  assert.deepEqual(candidate.manifest.entryTargets, ['src/index.ts'])
})

test('public GitHub adapter normalizes dot-slash path prefixes safely', async () => {
  const requests: string[] = []
  const adapter = new GitHubSourceAdapter({
    fetch: async (input): Promise<Response> => {
      requests.push(String(input))
      return new Response('dot-slash-content', { status: 200 })
    },
  })
  const content = await adapter.readFile(FIXTURE_REPOSITORY, './src/index.ts', FIXTURE_COMMIT)
  assert.equal(content, 'dot-slash-content')
  assert.equal(requests[0], `https://raw.githubusercontent.com/${FIXTURE_REPOSITORY}/${FIXTURE_COMMIT}/src/index.ts`)
})

test('candidate validator extracts rich author, display name, homepage, and keywords', async () => {
  const adapter = new FixtureRepositoryAdapter()
  const richManifest = JSON.stringify({
    name: 'rich-plugin',
    version: '1.0.0',
    license: 'Apache-2.0',
    description: 'Rich plugin description',
    main: './src/index.ts',
    author: { name: 'Alice Developer' },
    homepage: 'https://example.test/rich',
    keywords: ['search', 'ai', 'dsh'],
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      market: {
        displayName: 'Rich Super Plugin',
        keywords: ['curated', 'ai'],
      },
    },
  })
  adapter.files.set('rich/repo:package.json', richManifest)
  adapter.files.set('rich/repo:cordis.patch.yml', FIXTURE_PATCH)
  adapter.files.set('rich/repo:src/index.ts', FIXTURE_ENTRY)
  const candidate = await resolver(adapter).resolveRepository({ input: 'rich/repo', kind: 'repository' })
  assert.equal(candidate.evidence.metadata?.displayName, 'Rich Super Plugin')
  assert.equal(candidate.evidence.metadata?.author, 'Alice Developer')
  assert.equal(candidate.evidence.metadata?.homepage, 'https://example.test/rich')
  assert.deepEqual(candidate.evidence.metadata?.keywords, ['curated', 'ai', 'search', 'dsh'])
})

test('source resolver canonicalizes github: and @ branch references', () => {
  assert.equal(
    canonicalizeRepositorySource({ input: 'github:owner/repo#feat-1', kind: 'repository' }).requestedRef,
    'feat-1',
  )
  assert.equal(
    canonicalizeRepositorySource({ input: 'owner/repo@v2.0.0', kind: 'repository' }).requestedRef,
    'v2.0.0',
  )
})

