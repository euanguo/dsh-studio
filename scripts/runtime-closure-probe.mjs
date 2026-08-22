/**
 * Runtime closure probe — staging regression contract.
 *
 * Imports the heavyweight and native-adjacent modules the packaged runtime
 * can actually load, from inside the staged tree, and fails loudly on any
 * broken resolution. Runs with the staged Node after pruning, so a probe
 * miss means the pruner deleted something the runtime truly needs
 * (e.g. an exports-unreachable build directory).
 *
 * Bare specifiers are resolved against the staged runtime root with import
 * conditions (import > default > node > require) read from each package's
 * exports map — mirrors what the bundled runtime's own loaders do.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULES = [
  // LLM provider matrix (pulled in by @earendil-works/pi-ai).
  '@earendil-works/pi-ai',
  'openai',
  '@google/genai',
  '@anthropic-ai/sdk',
  '@mistralai/mistralai',
  '@aws-sdk/client-bedrock-runtime',
  '@smithy/node-http-handler',
  // Telemetry/validation/data layers.
  '@opentelemetry/api',
  '@opentelemetry/core',
  '@opentelemetry/sdk-trace',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/semantic-conventions',
  'zod',
  'zod-to-json-schema',
  'typebox',
  'protobufjs',
  'koffi',
  '@modelcontextprotocol/sdk/client',
  '@modelcontextprotocol/sdk/server',
  'hono',
  'ajv',
  'web-streams-polyfill',
  // Native-capable modules used by the sessions/terminals surface.
  'node-pty',
  'ws',
  'sharp',
  '@xterm/headless',
]

const IMPORT_ORDER = ['import', 'default', 'node', 'require']

/** Pick the first import-condition value from an exports condition set. */
function pickConditions(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickConditions(item)
      if (picked !== undefined) return picked
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  for (const key of IMPORT_ORDER) {
    if (Object.hasOwn(value, key)) {
      const picked = pickConditions(value[key])
      if (picked !== undefined) return picked
    }
  }
  return undefined
}

/** Resolve one bare or subpath specifier with import semantics. */
function resolveImportEntry(runtimeRoot, specifier) {
  const parts = specifier.split('/')
  const scoped = specifier.startsWith('@')
  const packageName = scoped ? `${parts[0]}/${parts[1]}` : parts[0]
  const subpath = scoped ? parts.slice(2).join('/') : parts.slice(1).join('/')
  const packageDir = join(runtimeRoot, 'node_modules', ...packageName.split('/'))
  if (!existsSync(join(packageDir, 'package.json'))) throw new Error(`package not found: ${specifier}`)
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  let entry
  const exportsMap = manifest.exports
  if (exportsMap !== undefined && exportsMap !== null && typeof exportsMap === 'object') {
    if (Array.isArray(exportsMap)) {
      entry = pickConditions(exportsMap)
    } else {
      const sub = subpath === '' ? '.' : `./${subpath}`
      const direct = exportsMap[sub]
      if (direct !== undefined) entry = pickConditions(direct)
      else if (exportsMap['./*'] !== undefined && subpath !== '') {
        const pattern = String(exportsMap['./*'])
        entry = pickConditions(pattern.replace('*', subpath))
      } else {
        throw new Error(`subpath not exported: ${specifier}`)
      }
    }
  } else {
    entry = manifest.main ?? './index.js'
  }
  if (typeof entry !== 'string') throw new Error(`no import entry for: ${specifier}`)
  const base = join(packageDir, entry)
  if (existsSync(base)) return base
  // Legacy main entries often omit the extension (web-streams-polyfill:
  // `main: dist/polyfill`); replicate CJS extension resolution.
  for (const extension of ['.js', '.mjs', '.cjs', '.json']) {
    const withExtension = base + extension
    if (existsSync(withExtension)) return withExtension
  }
  return base
}

const runtimeRoot = process.argv[2] ?? process.cwd()
const failures = []
for (const specifier of MODULES) {
  try {
    const entry = resolveImportEntry(runtimeRoot, specifier)
    await import(pathToFileURL(entry).href)
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    if (message.includes('Cannot find module') || message.includes("No 'exports'") || message.includes('No "exports"')) {
      failures.push(`${specifier}: ${message}`)
    }
  }
}
if (failures.length > 0) {
  console.error(`runtime closure probe failed (${failures.length}):`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exitCode = 1
} else {
  console.log(`runtime closure probe OK (${MODULES.length} modules)`)
}
