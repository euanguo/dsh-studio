import assert from 'node:assert/strict'
import { test } from 'node:test'
// Behavioral tests for the three capability-route safety primitives
// (isWithin / assertWithinSession / isTrustedApiRequest) plus the pure
// process-tree decision helpers. All inputs are synthetic strings or plain
// data — no filesystem, network, or real processes are touched. Raw `..`
// segments are expected to be resolved by callers before these guards run;
// that upstream contract is recorded in the leaf-S2 ledger rather than
// asserted here.
import { isWithin } from '../plugins/shared/fs-tree.ts'
import { assertWithinSession } from '../plugins/capabilities/src/routes/shared.ts'
import {
  isTrustedApiRequest,
  isLoopbackHostname,
} from '../plugins/capabilities/src/trust-fence.ts'
import {
  collectDescendantProcesses,
  parseProcessChildrenMap,
  parseProcessCommandMap,
  terminateProcessTreeWithGrace,
  type KillEscalationSlot,
} from '../plugins/capabilities/src/process-tree-killer.ts'

// ---------------------------------------------------------------------------
// isWithin — separator tolerance, case policy per platform, prefix traps.
// ---------------------------------------------------------------------------

test('isWithin accepts a nested path under its base', () => {
  assert.equal(isWithin('/repo', '/repo/sub/file.png'), true)
})

test('isWithin treats the base itself as within', () => {
  assert.equal(isWithin('/repo', '/repo'), true)
  assert.equal(isWithin('/', '/'), true)
})

test('isWithin rejects the sibling-prefix trap (/foo vs /foobar)', () => {
  assert.equal(isWithin('/foo', '/foobar'), false)
  assert.equal(isWithin('/foo', '/foobar/baz'), false)
})

test('isWithin ignores a trailing separator on the base', () => {
  assert.equal(isWithin('/repo/', '/repo/a.txt'), true)
  assert.equal(isWithin('C:\\repo\\', 'C:\\repo\\a.txt', 'win32'), true)
})

test('isWithin normalizes mixed separators on both arguments', () => {
  assert.equal(
    isWithin('C:\\Users\\me', 'c:/users/me/file.png', 'win32'),
    true,
  )
})

test('isWithin compares case-insensitively only when platform is win32', () => {
  assert.equal(isWithin('/Repo', '/repo/file', 'win32'), true)
  assert.equal(isWithin('/Repo', '/repo/file'), false)
})

test('isWithin rejects targets above or beside the base', () => {
  assert.equal(isWithin('/repo/sub', '/repo'), false)
  assert.equal(isWithin('/repo', '/other/file'), false)
})

test('isWithin applies the sibling-prefix trap on win32 too', () => {
  assert.equal(isWithin('C:\\foo', 'C:\\foobar\\file', 'win32'), false)
})

// ---------------------------------------------------------------------------
// assertWithinSession — mutating fs operations stay inside the session cwd.
// ---------------------------------------------------------------------------

const SESSION = '/sessions/w1'

function withinError(cwd: string, path: string, op: string): { code: string; status: number; message: string } {
  try {
    assertWithinSession(cwd, path, op)
  } catch (error) {
    return error as { code: string; status: number; message: string }
  }
  throw new Error(`expected ${op} of ${path} to be refused`)
}

test('assertWithinSession allows a path inside the session cwd', () => {
  assert.doesNotThrow(() => assertWithinSession(SESSION, `${SESSION}/src/app.ts`, 'write'))
})

test('assertWithinSession allows the session cwd itself', () => {
  assert.doesNotThrow(() => assertWithinSession(SESSION, SESSION, 'remove'))
})

test('assertWithinSession refuses paths outside the session with op and 403', () => {
  const error = withinError(SESSION, '/other/repo/file', 'write')
  assert.equal(error.code, 'fs-error')
  assert.equal(error.status, 403)
  assert.match(error.message, /write/)
  assert.match(error.message, /outside the session working directory/)
})

test('assertWithinSession refuses the sibling-prefix escape (/w1 vs /w1x)', () => {
  const error = withinError(SESSION, `${SESSION}x/file`, 'rename')
  assert.equal(error.status, 403)
  assert.match(error.message, /rename/)
})

// ---------------------------------------------------------------------------
// isTrustedApiRequest — DNS-rebinding / cross-site fence (NOT authentication).
// ---------------------------------------------------------------------------

function request(headers: Record<string, string>): { headers: Record<string, string> } {
  return { headers }
}

test('loopback Host authorities are trusted without any allowlist entry', () => {
  assert.equal(isTrustedApiRequest(request({ host: 'localhost:50839' }), []), true)
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1' }), []), true)
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.55:9222' }), []), true)
  assert.equal(isTrustedApiRequest(request({ host: '[::1]:50839' }), []), true)
  assert.equal(isLoopbackHostname('127.0.0.55'), true)
})

test('a request without a parsable Host is refused', () => {
  assert.equal(isTrustedApiRequest(request({}), []), false)
  assert.equal(isTrustedApiRequest(request({ host: 'bad host:9' }), []), false)
})

test('a non-loopback Host with an empty allowlist is refused (rebinding contract)', () => {
  // The fence sees only the Host header; an attacker-controlled name can
  // never become trusted by resolving it, because trust requires the exact
  // configured authority — absence means refusal.
  assert.equal(isTrustedApiRequest(request({ host: 'attacker.example.net' }), []), false)
  assert.equal(isLoopbackHostname('attacker.example.net'), false)
})

test('a loopback lookalike octet fails the loopback check', () => {
  assert.equal(isLoopbackHostname('127.0.0.256'), false)
  assert.equal(isLoopbackHostname('127.1'), false)
})

test('a trusted authority matches by exact host:port', () => {
  const allow = ['studio.example.com:8443']
  assert.equal(
    isTrustedApiRequest(request({ host: 'studio.example.com:8443' }), allow),
    true,
  )
  assert.equal(
    isTrustedApiRequest(request({ host: 'studio.example.com:9999' }), allow),
    false,
  )
})

test('a port-less trusted authority matches any single port of that host', () => {
  const allow = ['app.example.com']
  assert.equal(
    isTrustedApiRequest(request({ host: 'app.example.com:9999' }), allow),
    true,
  )
})

test('Host matching is case-insensitive', () => {
  assert.equal(
    isTrustedApiRequest(request({ host: 'APP.example.COM' }), ['App.Example.com']),
    true,
  )
})

test('cross-site fetch markers refuse even a loopback Host', () => {
  assert.equal(
    isTrustedApiRequest(
      request({ host: 'localhost:50839', 'sec-fetch-site': 'cross-site' }),
      [],
    ),
    false,
  )
})

test('Origin must agree with the Host when present', () => {
  const same = request({ host: 'localhost:50839', origin: 'http://localhost:50839' })
  const other = request({ host: 'localhost:50839', origin: 'http://evil.example:80' })
  const malformed = request({ host: 'localhost:50839', origin: 'not-a-url' })
  assert.equal(isTrustedApiRequest(same, []), true)
  assert.equal(isTrustedApiRequest(other, []), false)
  assert.equal(isTrustedApiRequest(malformed, []), false)
})

// ---------------------------------------------------------------------------
// process-tree-killer pure decision helpers (no processes spawned).
// ---------------------------------------------------------------------------

test('parseProcessChildrenMap groups captured commands by parent pid', () => {
  const ps = [
    '  101    1   launchd',
    '  201  101 zsh -lc "echo a  b"',
    '  202  101 node server.js',
  ].join('\r\n')
  const map = parseProcessChildrenMap(ps)
  // Column split collapses command-internal whitespace runs.
  assert.deepEqual(map.get(101), [
    { pid: 201, command: 'zsh -lc "echo a b"' },
    { pid: 202, command: 'node server.js' },
  ])
  const launchd = map.get(1)?.[0]
  assert.ok(launchd, 'expected pid 101 captured under parent 1')
  assert.equal(launchd.command, 'launchd')
})

test('parseProcessChildrenMap skips malformed rows instead of throwing', () => {
  const map = parseProcessChildrenMap(
    ['not-a-pid 1 x', '12 34', '   ', '55 oops 7'].join('\n'),
  )
  // '12 34' has no command; '55 oops 7' has a non-numeric second column.
  assert.equal(map.size, 0)
})

test('parseProcessCommandMap reads pid/command pairs and skips junk', () => {
  const map = parseProcessCommandMap(
    ['   42   /bin/zsh -l', 'garbage-line', '77'].join('\n'),
  )
  assert.equal(map.get(42), '/bin/zsh -l')
  assert.equal(map.has(77), false)
  assert.equal(map.size, 1)
})

test('collectDescendantProcesses walks nested children depth-first', () => {
  const map = parseProcessChildrenMap(
    ['2 1 sh', '3 2 node', '4 3 esbuild', '9 88 unrelated'].join('\n'),
  )
  assert.deepEqual(collectDescendantProcesses(1, map), [
    { pid: 2, command: 'sh' },
    { pid: 3, command: 'node' },
    { pid: 4, command: 'esbuild' },
  ])
})

test('collectDescendantProcesses survives pid cycles via its visited set', () => {
  // A recycled/looped edge (3 -> 1) must not hang the walk or duplicate nodes.
  const map = new Map([
    [1, [{ pid: 2, command: 'a' }]],
    [2, [{ pid: 3, command: 'b' }]],
    [3, [{ pid: 1, command: 'root-again' }]],
  ])
  assert.deepEqual(collectDescendantProcesses(1, map), [
    { pid: 2, command: 'a' },
    { pid: 3, command: 'b' },
  ])
  assert.deepEqual(collectDescendantProcesses(404, map), [])
})

test('terminateProcessTreeWithGrace falls back to pty.kill on an invalid pid', () => {
  let kills = 0
  let cleared = false
  let armed = false
  const slot: KillEscalationSlot = {
    clear() { cleared = true },
    set() { armed = true },
  }
  terminateProcessTreeWithGrace({ pid: 0, kill: () => { kills += 1 } }, 10, () => false, slot)
  assert.equal(kills, 1)
  // The guard returns before touching the escalation bookkeeping.
  assert.equal(cleared, false)
  assert.equal(armed, false)
})
