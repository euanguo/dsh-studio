import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../src/plugin.ts'
import {
  mountMarketplaceAgentTools,
  requireHealthyMarketplaceSnapshot,
} from '../src/marketplace-tools.ts'

test('desktop Host plugin publishes capability, prompt, and bash environment', () => {
  const previous = {
    appData: process.env.DSH_STUDIO_DESKTOP_APP_DATA,
    profile: process.env.DSH_STUDIO_DESKTOP_PROFILE,
    version: process.env.DSH_STUDIO_DESKTOP_VERSION,
  }
  process.env.DSH_STUDIO_DESKTOP_APP_DATA = '/tmp/dsh-desktop-data'
  process.env.DSH_STUDIO_DESKTOP_PROFILE = 'desktop'
  process.env.DSH_STUDIO_DESKTOP_VERSION = '9.8.7'
  let capability: unknown
  let prompt = ''
  let resolvedEnvironment: Record<string, string> = {}
  const sections: string[] = []
  const context = {
    effect: <T>(effect: () => T): T => effect(),
    get: () => undefined,
    logger: {
      debug: () => {},
      warn: () => {},
    },
    on: () => {},
    inject: (names: string[], callback: (ctx: unknown) => void): void => {
      if (names[0] === 'systemPrompt') {
        callback({
          systemPrompt: {
            section: (section: { text: () => string }) => { sections.push(section.text()) },
          },
        })
      }
      if (names[0] === 'bashEnv') {
        callback({
          bashEnv: {
            register: (entry: { resolve: () => Record<string, string> }) => {
              resolvedEnvironment = entry.resolve()
            },
          },
        })
      }
    },
    provide: (name: string, value: unknown): void => {
      if (name === 'desktop') capability = value
    },
    tools: {
      register: () => {},
    },
  }
  try {
    apply(context as Parameters<typeof apply>[0])
    assert.deepEqual(capability, {
      appDataPath: '/tmp/dsh-desktop-data',
      kind: 'electron',
      platform: process.platform,
      profile: 'desktop',
      version: '9.8.7',
    })
    prompt = sections.join('\n')
    assert.match(prompt, /DSH Studio/)
    assert.doesNotMatch(prompt, /ChatGPT|OpenAI/)
    assert.deepEqual(resolvedEnvironment, {
      DSH_STUDIO_DESKTOP: '1',
      DSH_STUDIO_DESKTOP_APP_DATA: '/tmp/dsh-desktop-data',
      DSH_STUDIO_DESKTOP_PROFILE: 'desktop',
      DSH_STUDIO_DESKTOP_VERSION: '9.8.7',
    })
  } finally {
    if (previous.appData === undefined) delete process.env.DSH_STUDIO_DESKTOP_APP_DATA
    else process.env.DSH_STUDIO_DESKTOP_APP_DATA = previous.appData
    if (previous.profile === undefined) delete process.env.DSH_STUDIO_DESKTOP_PROFILE
    else process.env.DSH_STUDIO_DESKTOP_PROFILE = previous.profile
    if (previous.version === undefined) delete process.env.DSH_STUDIO_DESKTOP_VERSION
    else process.env.DSH_STUDIO_DESKTOP_VERSION = previous.version
  }
})

test('desktop Agent tools share the guarded marketplace transaction owner', async () => {
  const names: string[] = []
  const definitions: unknown[] = []
  type AgentPolicy = Parameters<Parameters<typeof mountMarketplaceAgentTools>[0]['on']>[1]
  let policy: AgentPolicy | undefined
  const environment: NodeJS.ProcessEnv = {
    DSH_STUDIO_MARKETPLACE_AGENT_TOKEN: 'secret-token',
    DSH_STUDIO_MARKETPLACE_AGENT_URL: 'http://127.0.0.1:43210/v1/marketplace',
  }
  mountMarketplaceAgentTools({
    on: (_name, listener) => { policy = listener },
    tools: {
      register: definition => {
        names.push(definition.name)
        definitions.push(definition)
      },
    },
  }, environment)
  assert.deepEqual(names, [
    'desktop_plugin_search',
    'desktop_plugin_status',
    'desktop_plugin_prepare',
    'desktop_plugin_preview',
    'desktop_plugin_discard',
    'desktop_plugin_apply',
    'desktop_plugin_recover',
  ])
  assert.equal(environment.DSH_STUDIO_MARKETPLACE_AGENT_TOKEN, undefined)
  assert.equal(environment.DSH_STUDIO_MARKETPLACE_AGENT_URL, undefined)
  const first = definitions[0] as {
    output: { schema: { properties: Record<string, Record<string, unknown>>; required: string[] } }
    parameters: { properties: Record<string, Record<string, unknown>>; type: string }
  }
  assert.equal(first.parameters.type, 'object')
  assert.equal(first.parameters.properties.query?.required, undefined)
  assert.deepEqual(first.output.schema.required, ['summary', 'data'])
  assert.equal(first.output.schema.properties.summary?.required, undefined)
  assert.ok(policy)
  assert.deepEqual(
    await policy({ name: 'desktop_plugin_apply' }, async () => ({ kind: 'allow' })),
    {
      kind: 'ask',
      reason: 'Apply the tested plugin preview to DSH Studio?',
    },
  )
  assert.deepEqual(
    await policy({ name: 'desktop_plugin_search' }, async () => ({ kind: 'allow' })),
    { kind: 'allow' },
  )
})

test('desktop Agent tools reject marketplace failures instead of reporting an empty catalog', () => {
  assert.throws(() => requireHealthyMarketplaceSnapshot({
    auth: { detail: 'catalog unavailable', status: 'error' },
    busy: false,
    catalog: [],
    catalogGeneratedAt: null,
    error: 'GitHub returned 404 for the configured catalog',
    installed: [],
    lastAction: null,
    lifecycle: {
      candidate: null,
      current: { profile: 'desktop', state: 'live' },
      previous: null,
    },
    plan: null,
    preview: null,
    sourceLocks: [],
    undoAvailable: false,
  }), /404/)
})
