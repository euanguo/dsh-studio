#!/usr/bin/env node
/**
 * guard-effect-abort.mjs — S6 race discipline for sidebar runtime modules.
 *
 * Contract: every module under `plugins/sidebar/src/client/runtimes/` that
 * performs async transport work (async fn, Promise chain, or a live
 * WebSocket) must carry an explicit cancellation/teardown mechanism:
 * AbortController / AbortSignal / GenerationGate, a forwarded `signal`, or
 * an explicit `.close()` teardown. Modules without async work are exempt.
 * Pure presence check — it cannot prove correct wiring, only that the
 * discipline was not dropped wholesale (the rescan d7 rules generalized).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = join(root, 'plugins', 'sidebar', 'src', 'client', 'runtimes')

const ASYNC_RE = /\basync\s+\w+\s*\(|\basync\s*\(|Promise<|\.then\(|new WebSocket/
const MARKER_RE = /AbortController|AbortSignal|GenerationGate|\bsignal\b|\.close\(/

const violations = []
for (const name of readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()) {
  const file = join(dir, name)
  const text = readFileSync(file, 'utf8')
  if (!ASYNC_RE.test(text)) continue
  if (!MARKER_RE.test(text)) violations.push(`plugins/sidebar/src/client/runtimes/${name}: async runtime lacks AbortController/AbortSignal/GenerationGate/signal/close teardown`)
}

if (violations.length > 0) {
  console.log('guard-effect-abort violations:')
  for (const v of violations) console.log(`  ${v}`)
  console.log('GUARD-FAIL(async runtime missing cancellation discipline)')
  process.exit(1)
}
console.log('GUARD-OK')
