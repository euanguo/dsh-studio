import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DshRuntimeSupervisor } from '../src/runtime.ts'

test('runtime supervisor waits for the DSH settlement URL and stops cleanly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-'))
  const entry = join(root, 'fake-runtime.mjs')
  // The readiness handshake requires HTTP confirmation of the announced
  // URL (kernel-refactor leaf-2.4), so the fake runtime serves 200 on the
  // loopback port before printing the settlement line.
  writeFileSync(entry, [
    "console.log('booting')",
    "import('node:http').then(({ default: http }) => {",
    '  const server = http.createServer((_req, res) => { res.writeHead(200); res.end() })',
    "  server.listen(43210, '127.0.0.1', () => console.log('dsh web: http://127.0.0.1:43210'))",
    '})',
    'setInterval(() => {}, 1000)',
    "process.on('SIGTERM', () => process.exit(0))",
  ].join('\n'))
  const lines: string[] = []
  const supervisor = new DshRuntimeSupervisor({
    args: [],
    cliEntry: entry,
    cwd: root,
    env: process.env,
    nodeBinary: process.execPath,
    onLog: (_stream, line) => { lines.push(line) },
    readyTimeoutMs: 2_000,
  })
  try {
    const url = await supervisor.start()
    assert.equal(url.href, 'http://127.0.0.1:43210/')
    assert.equal(supervisor.running, true)
    assert.deepEqual(lines, ['booting', 'dsh web: http://127.0.0.1:43210'])
    await supervisor.stop()
    assert.equal(supervisor.running, false)
  } finally {
    await supervisor.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
