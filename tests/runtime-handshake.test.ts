/**
 * Runtime handshake behavior tests (kernel-refactor leaf-2.4).
 *
 * READY_LINE stdout output is only a URL *candidate*; DshRuntimeSupervisor
 * must confirm every candidate over HTTP before start() resolves, fail safe
 * on malformed/false-positive candidates (keep waiting instead of loading a
 * wrong URL), and on the readiness timeout tear the child down with
 * SIGTERM escalated to SIGKILL — awaiting the real process exit before
 * rejecting. All scenarios drive real child processes against fake DSH
 * runtime scripts and real loopback HTTP servers; no Electron.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DshRuntimeSupervisor } from '../src/runtime.ts'

/** Write one fake DSH runtime script that plays the given source. */
function writeFakeRuntime(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-handshake-'))
  const entry = join(root, 'fake-dsh.mjs')
  writeFileSync(entry, source)
  return entry
}

function removeFakeRuntime(entry: string): void {
  rmSync(join(entry, '..'), { recursive: true, force: true })
}

function supervisorFor(
  entry: string,
  options: {
    readyTimeoutMs?: number
    killEscalationMs?: number
    onLog?: (stream: 'stderr' | 'stdout', line: string) => void
  } = {},
): DshRuntimeSupervisor {
  return new DshRuntimeSupervisor({
    args: [],
    cliEntry: entry,
    cwd: join(entry, '..'),
    env: process.env,
    nodeBinary: process.execPath,
    readyTimeoutMs: options.readyTimeoutMs ?? 5_000,
    killEscalationMs: options.killEscalationMs ?? 5_000,
    ...(options.onLog !== undefined ? { onLog: options.onLog } : {}),
  })
}

/** A fake DSH runtime: serve HTTP 200 first, then announce the URL line. */
const SERVE_200_THEN_ANNOUNCE = `
import http from 'node:http'
const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok') })
server.listen(0, '127.0.0.1', () => {
  console.log('dsh web: http://127.0.0.1:' + server.address().port)
})
setInterval(() => {}, 1_000)
process.on('SIGTERM', () => process.exit(0))
`

test('start resolves only when the READY_LINE candidate answers HTTP 200', async () => {
  const entry = writeFakeRuntime(SERVE_200_THEN_ANNOUNCE)
  const lines: Array<{ line: string; stream: string }> = []
  const supervisor = supervisorFor(entry, {
    onLog: (stream, line) => { lines.push({ stream, line }) },
  })
  try {
    const url = await supervisor.start()
    // The resolved URL is exactly the announced candidate, confirmed by HTTP.
    const announced = lines.find(entry => entry.line.startsWith('dsh web: '))
    assert.ok(announced !== undefined, 'the candidate line must have been logged')
    assert.equal(url.href, new URL(announced.line.replace(/^dsh web: /, '')).href)
    assert.equal(supervisor.running, true)
    await supervisor.stop()
    assert.equal(supervisor.running, false)
  } finally {
    await supervisor.stop()
    removeFakeRuntime(entry)
  }
})

test('a regex-matched candidate whose port refuses HTTP never becomes ready', async () => {
  // Port 1 has no listener: the candidate line matches READY_LINE but every
  // HTTP probe is refused, which must fail safe (keep waiting) until the
  // readiness timeout — not resolve into a loadURL against a dead port.
  const entry = writeFakeRuntime(`
console.log('dsh web: http://127.0.0.1:1')
setInterval(() => {}, 1_000)
// Ignore SIGTERM so the teardown must escalate to SIGKILL to make progress.
process.on('SIGTERM', () => {})
`)
  const readyTimeoutMs = 400
  const killEscalationMs = 300
  const supervisor = supervisorFor(entry, { readyTimeoutMs, killEscalationMs })
  try {
    const startedAt = Date.now()
    await assert.rejects(supervisor.start(), /did not become ready within 400 ms/)
    // The rejection may only happen after the full escalation window AND the
    // child's real exit: SIGTERM is ignored, so progress requires SIGKILL.
    const elapsed = Date.now() - startedAt
    assert.ok(
      elapsed >= (process.platform === 'win32'
        ? readyTimeoutMs - 50
        : readyTimeoutMs + killEscalationMs - 50),
      `start() returned too early (${String(elapsed)} ms): exit was not awaited`,
    )
    assert.equal(supervisor.running, false, 'child must be gone after the escalation chain')
  } finally {
    await supervisor.stop()
    removeFakeRuntime(entry)
  }
})

test('a malformed candidate line is ignored and later candidates still confirm', async () => {
  // 'http://[' matches READY_LINE's \\S+ tail but is not a valid URL: the
  // supervisor must swallow it and keep waiting for the real announcement.
  const entry = writeFakeRuntime(`
import http from 'node:http'
console.log('dsh web: http://[')
const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok') })
server.listen(0, '127.0.0.1', () => {
  console.log('dsh web: http://127.0.0.1:' + server.address().port)
})
setInterval(() => {}, 1_000)
process.on('SIGTERM', () => process.exit(0))
`)
  const supervisor = supervisorFor(entry)
  try {
    const url = await supervisor.start()
    // The malformed candidate never wins: the resolved URL is the later,
    // well-formed announcement with a real port.
    assert.ok(url.hostname === '127.0.0.1')
    assert.ok(/^\d+$/.test(url.port), `resolved ${url.href} must carry a real port`)
    await supervisor.stop()
  } finally {
    await supervisor.stop()
    removeFakeRuntime(entry)
  }
})

test('an HTTP-reachable but non-200 false positive keeps waiting until timeout', async () => {
  // An unrelated server owns the announced port and answers 404: the
  // handshake must treat the candidate as unconfirmed and time out.
  const entry = writeFakeRuntime(`
import http from 'node:http'
const server = http.createServer((_req, res) => { res.writeHead(404); res.end('nope') })
server.listen(0, '127.0.0.1', () => {
  console.log('dsh web: http://127.0.0.1:' + server.address().port)
})
setInterval(() => {}, 1_000)
process.on('SIGTERM', () => process.exit(0))
`)
  const supervisor = supervisorFor(entry, { readyTimeoutMs: 350, killEscalationMs: 250 })
  try {
    await assert.rejects(supervisor.start(), /did not become ready within 350 ms/)
    assert.equal(supervisor.running, false)
  } finally {
    await supervisor.stop()
    removeFakeRuntime(entry)
  }
})
