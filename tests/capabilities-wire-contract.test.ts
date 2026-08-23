import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Wire-contract ↔ host route-table drift guard.
 *
 * The /capabilities/api surface is defined twice: once as the shared request-DTO
 * map (CapabilitiesApiRequests — the client's compile-time vocabulary) and once
 * as the host's method table in capabilities/src/routes.ts (the runtime
 * dispatch). Nothing in the build aligns them, so a method added on one side
 * only fails at runtime: a client call 404s, or a host capability becomes
 * unreachable. (The historical `paths` vs `path` stage/unstage bug was
 * exactly this class.) These contracts pin the two directions:
 *
 * 1. every CapabilitiesApiRequests key has a route — the client can never call
 *    into a 404;
 * 2. every route key has a DTO — no host capability goes untyped (and
 *    unfetchable through the typed client).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function dtoKeys(): string[] {
  const source = readFileSync(
    join(root, 'plugins', 'shared', 'capabilities-api.ts'),
    'utf8',
  )
  const body = source.match(/export interface CapabilitiesApiRequests \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(body !== undefined, 'CapabilitiesApiRequests interface found in shared/capabilities-api.ts')
  const keys = [...body.matchAll(/'([a-z-]+\.[a-z-]+)':/g)].map(match => match[1]!)
  assert.ok(keys.length > 0, 'CapabilitiesApiRequests parsed with keys')
  return keys.sort()
}

function routeKeys(): string[] {
  const sources = [
    'routes.ts',
    'worktree-routes.ts',
  ].map(file => readFileSync(join(root, 'plugins', 'capabilities', 'src', file), 'utf8'))
  // Method-table entries are quoted keys in the capability route modules.
  return sources.flatMap(source => [...source.matchAll(/^ {4}'([a-z-]+\.[a-z-]+)':/gm)]
    .map(match => match[1]!)).sort()
}

test('every wire DTO method has a host route', () => {
  const routes = new Set(routeKeys())
  const missing = dtoKeys().filter(key => !routes.has(key))
  assert.deepEqual(
    missing,
    [],
    'CapabilitiesApiRequests methods without a routes.ts implementation (client 404s)',
  )
})

test('every host route has a wire DTO', () => {
  const dtos = new Set(dtoKeys())
  const untyped = routeKeys().filter(key => !dtos.has(key))
  assert.deepEqual(
    untyped,
    [],
    'routes.ts methods without a CapabilitiesApiRequests DTO (unreachable through the typed client)',
  )
})
