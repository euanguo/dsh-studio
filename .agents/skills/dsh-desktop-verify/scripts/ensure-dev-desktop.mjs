#!/usr/bin/env node
/**
 * DSH Studio (Dev) desktop lifecycle helper for the `dsh-desktop-verify` skill.
 *
 * This helper ONLY manages the app process lifecycle — start / status / stop /
 * logs. It never triggers or drives any feature: every UI interaction must go
 * through chrome-use commands (snapshot/click/fill/eval/screenshot/test/suite)
 * as documented in SKILL.md.
 *
 * It wraps the repository's own dev launcher (`node scripts/dev.mjs`), which
 * already:
 *   - forces DSH_STUDIO_CHANNEL=dev (data root ~/.dsh-studio-dev),
 *   - spawns Electron with extra Chromium args from DSH_STUDIO_ELECTRON_ARGS
 *     (the repository's official CDP opening for chrome-use / DevTools).
 *
 * Usage:
 *   node <this>/scripts/ensure-dev-desktop.mjs ensure [--port 9222] [--force-restart]
 *   node <this>/scripts/ensure-dev-desktop.mjs status
 *   node <this>/scripts/ensure-dev-desktop.mjs stop
 *   node <this>/scripts/ensure-dev-desktop.mjs logs [--tail 80]
 *   node <this>/scripts/ensure-dev-desktop.mjs recover   # force-clear + fresh start
 *   # recover is the deterministic fix for CDP hangs (restart races/zombies).
 *
 * Environment: DSH_VERIFY_CDP_PORT overrides the default CDP port (9222).
 * State and logs are written under <repo>/tmp/dsh-dev-desktop/ (gitignored).
 */
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..') // .agents/skills/<skill>/scripts -> repo root
const STATE_DIR = join(ROOT, 'tmp', 'dsh-dev-desktop')
const STATE_FILE = join(STATE_DIR, 'state.json')
const LOG_FILE = join(STATE_DIR, 'dev-desktop.log')
const DEFAULT_PORT = Number(process.env.DSH_VERIFY_CDP_PORT ?? 9222)
const READY_TIMEOUT_MS = 90_000
const STOP_GRACE_MS = 8_000

function log(message) {
  process.stdout.write(`[dsh-desktop] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[dsh-desktop] ${message}\n`)
  process.exit(1)
}

function prereqError() {
  return [
    'staged DSH runtime is missing (needed by `pnpm run dev`)',
    'first run the one-time setup from the repo root:',
    '  CI=true pnpm run build:dsh && CI=true pnpm run stage:dsh',
  ].join('\n')
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return null
  }
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 })
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** List CDP page targets of the app under test, or [] when unreachable. */
async function cdpTargets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    if (!response.ok) return []
    const targets = await response.json()
    return Array.isArray(targets) ? targets : []
  } catch {
    return []
  }
}

async function cdpVersion(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function summarizeTargets(port, targets) {
  const pages = targets.filter(target => target.type === 'page')
  if (pages.length === 0) return `no page target yet on :${port}`
  return pages
    .map(target => `${target.type} "${target.title}" ${target.url}`)
    .join('\n')
}

/** Find Electron processes of the DEV channel that could hold the lock. */
function foreignDevElectron() {
  // The DEV channel userData dir ends with .../dsh-studio-dev/desktop. The
  // production app (.../dsh-studio/desktop) is intentionally NOT matched, so
  // this helper can never touch the installed production instance.
  const result = spawnSync('pgrep', ['-fl', 'dsh-studio-dev/desktop'], { encoding: 'utf8', timeout: 15_000 })
  return (result.stdout ?? '').split('\n').filter(Boolean)
}

/**
 * Wait for CDP, self-healing the Electron main-process restart race: a full
 * `pnpm run build` rewrites dist/main.js → dev.mjs restarts Electron → the
 * old instance can still hold :port for a moment → the respawn exits code 0
 * (bind() failed) and CDP never comes up, leaving `ensure` stuck for the
 * full timeout. Here, while waiting, we watch the launcher log for the
 * bind-failure signature and kill the stale DEV electrons holding the port;
 * dev.mjs then respawns cleanly into the freed port.
 */
function waitForCdp(port, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now()
    let healed = false
    const timer = setInterval(async () => {
      const version = await cdpVersion(port)
      if (version !== null) {
        clearInterval(timer)
        resolve(version)
        return
      }
      // Self-heal once: detect the restart-race signature and clear the port.
      if (!healed && Date.now() - started > 3_000) {
        healed = true
        try {
          const logText = readFileSync(LOG_FILE, 'utf8').slice(-8_000)
          if (/bind\(\) failed: Address already in use|Cannot start http server for devtools/.test(logText)) {
            log('detected the Electron restart-race (bind() failed) — clearing stale DEV instance(s) holding :' + port)
            for (const line of foreignDevElectron()) {
              const pid = Number.parseInt(line.trim().split(/\s+/)[0], 10)
              if (Number.isInteger(pid) && pid > 0) killTree(pid, 'SIGTERM')
            }
          }
        } catch {
          // log unreadable; keep waiting
        }
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        resolve(null)
      }
    }, 1_000)
  })
}

function killTree(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
}

async function ensure(options) {
  if (!existsSync(join(ROOT, '.stage', 'dsh-runtime', 'lib', 'bin.js'))) fail(prereqError())

  const port = options.port

  // 1) Already serving CDP on the requested port? Reuse it (the app may be
  //    running from any launcher, including a previous `ensure`).
  const live = await cdpVersion(port)
  if (live !== null && !options.forceRestart) {
    const targets = await cdpTargets(port)
    log(`DEV desktop already reachable on CDP :${port}`)
    log(`browser: ${live.Browser ?? '?'}`)
    log(`targets:\n${summarizeTargets(port, targets)}`)
    log(`(state file: ${STATE_FILE})`)
    return
  }

  // 2) Our own recorded launcher may be alive while the app is down or CDP is
  //    gone. Notable cause: the Electron main-process restart race — dev.mjs
  //    respawns ~250ms after SIGTERM, and the old instance can still hold the
  //    CDP port / the single-instance lock, so the new app either exits code 0
  //    or (bind() failed) runs without a CDP server. Deterministic recovery:
  //    tear our stale launcher tree down and start fresh.
  const state = readState()
  if (state !== null && pidAlive(state.launcherPid) && !live) {
    log(`our launcher pid ${state.launcherPid} is alive but CDP :${port} is down — restarting the DEV app fresh`)
    killTree(state.launcherPid, 'SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 4_000))
    rmSync(STATE_FILE, { force: true })
  } else if (state !== null && !pidAlive(state.launcherPid)) {
    rmSync(STATE_FILE, { force: true })
  }

  // 3) Collision with a DEV instance NOT owned by this helper that holds the
  //    Electron single-instance lock while exposing no CDP port: a CDP launch
  //    would silently exit (code 0). Never touch it without --force-restart.
  const holders = foreignDevElectron()
  if (holders.length > 0 && (await cdpVersion(port)) === null) {
    if (options.forceRestart) {
      log(`stopping DEV instance(s) holding the lock:\n${holders.join('\n')}`)
      for (const line of holders) {
        const pid = Number.parseInt(line.trim().split(/\s+/)[0], 10)
        if (Number.isInteger(pid) && pid > 0) killTree(pid, 'SIGTERM')
      }
      await new Promise(resolve => setTimeout(resolve, 3_000))
    } else {
      fail(
        [
          'a DSH Studio (Dev) instance is already running WITHOUT a CDP port;',
          'a new CDP launch would exit silently on the Electron single-instance lock.',
          'options:',
          `  - restart it with CDP: ${'node ' + fileURLToPath(import.meta.url) + ' ensure --force-restart'}`,
          `  - stop it first: ${'node ' + fileURLToPath(import.meta.url) + ' stop'}`,
          'holders:',
          ...holders.map(line => `    ${line}`),
        ].join('\n'),
      )
    }
  }

  // 4) Launch the repository dev launcher detached, with CDP enabled.
  //    stdout/stderr are bound straight to the log file fd (no pipes), so this
  //    helper process exits once readiness is reported — the launcher keeps
  //    running detached and keeps writing to the log on its own.
  mkdirSync(STATE_DIR, { recursive: true })
  const logFd = openSync(LOG_FILE, 'a')
  const launcher = spawn('pnpm', ['run', 'dev'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      DSH_STUDIO_CHANNEL: 'dev',
      DSH_STUDIO_ELECTRON_ARGS: `--remote-debugging-port=${port}`,
    },
  })
  closeSync(logFd)
  const launcherPid = launcher.pid
  launcher.on('exit', code => {
    log(`dev launcher (pid ${launcherPid}) exited code=${String(code)}`)
  })
  launcher.unref()

  writeState({ launcherPid, port, startedAt: new Date().toISOString(), logFile: LOG_FILE })
  log(`launched \`pnpm run dev\` (launcher pid ${launcherPid}, CDP port ${port})`)
  log(`waiting for CDP on http://127.0.0.1:${port}/json/version …`)

  const version = await waitForCdp(port, READY_TIMEOUT_MS)
  if (version === null) {
    fail(
      [
        `CDP endpoint did not come up within ${READY_TIMEOUT_MS / 1000}s.`,
        `launcher log: ${LOG_FILE}`,
        'common causes: a foreign DEV instance holds the single-instance lock',
        '(rerun with --force-restart), or the staged runtime is stale',
        '(rerun the one-time CI=true pnpm run build:dsh && CI=true pnpm run stage:dsh).',
      ].join('\n'),
    )
  }

  const targets = await cdpTargets(port)
  log(`CDP ready: ${version.Browser ?? '?'}`)
  log(`targets:\n${summarizeTargets(port, targets)}`)
  log(`launcher log: ${LOG_FILE}`)
  log('next steps (chrome-use):')
  log(`  chrome-use --session dsh-dev-<task> connect ${port}`)
  log(`  chrome-use --session dsh-dev-<task> tab`)
}

async function status() {
  const port = DEFAULT_PORT
  const version = await cdpVersion(port)
  if (version !== null) {
    const targets = await cdpTargets(port)
    log(`CDP :${port} UP — ${version.Browser ?? '?'}`)
    log(`targets:\n${summarizeTargets(port, targets)}`)
  } else {
    log(`CDP :${port} not responding — the DEV desktop is not reachable.`)
  }
  const state = readState()
  if (state !== null) {
    log(`launcher pid ${state.launcherPid} alive=${pidAlive(state.launcherPid)} started=${state.startedAt}`)
    log(`log: ${state.logFile}`)
  } else {
    log('no state recorded (this helper never launched it).')
  }
}

async function stop() {
  const state = readState()
  if (state !== null && pidAlive(state.launcherPid)) {
    log(`sending SIGTERM to dev launcher process group ${state.launcherPid}`)
    killTree(state.launcherPid, 'SIGTERM')
    const started = Date.now()
    while (pidAlive(state.launcherPid) && Date.now() - started < STOP_GRACE_MS) {
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    if (pidAlive(state.launcherPid)) {
      log('grace period elapsed; sending SIGKILL')
      killTree(state.launcherPid, 'SIGKILL')
    }
  } else {
    log('no live launcher recorded — nothing to stop.')
  }
  rmSync(STATE_FILE, { force: true })
  log('state cleared. If chrome-use sessions remain, close them: chrome-use --session <name> close')
}

function logs(options) {
  const tail = options.tail
  if (!existsSync(LOG_FILE)) {
    log(`no dev launcher log yet: ${LOG_FILE}`)
    return
  }
  const size = statSync(LOG_FILE).size
  const start = Math.max(0, size - tail * 4_000)
  let content = readFileSync(LOG_FILE, 'utf8')
  if (start > 0) content = content.slice(content.lastIndexOf('\n', start) + 1)
  process.stdout.write(content.endsWith('\n') ? content : content + '\n')
}

function parseArgs(argv) {
  const command = argv[0] ?? 'status'
  const options = { port: DEFAULT_PORT, forceRestart: false, tail: 80 }
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--port') options.port = Number(argv[++index])
    else if (arg === '--force-restart') options.forceRestart = true
    else if (arg === '--tail') options.tail = Number(argv[++index])
  }
  return { command, options }
}

async function recover() {
  // Nuke EVERYTHING on the DEV channel: our launcher tree + any foreign DEV
  // electron, clear the state file, then start fresh. This is the deterministic
  // fix for repeated CDP hangs (restart races, zombie instances).
  const state = readState()
  if (state !== null && pidAlive(state.launcherPid)) {
    log(`stopping launcher tree ${state.launcherPid}`)
    killTree(state.launcherPid, 'SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 3_000))
  }
  for (const line of foreignDevElectron()) {
    const pid = Number.parseInt(line.trim().split(/\s+/)[0], 10)
    if (Number.isInteger(pid) && pid > 0) {
      log(`stopping leftover DEV electron ${pid}`)
      killTree(pid, 'SIGTERM')
    }
  }
  rmSync(STATE_FILE, { force: true })
  await new Promise(resolve => setTimeout(resolve, 2_000))
  log('port cleared; starting fresh')
  await ensure({ port: options.port, forceRestart: true })
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'recover') void recover()
else if (command === 'ensure') void ensure(options)
else if (command === 'status') void status()
else if (command === 'stop') void stop()
else if (command === 'logs') logs(options)
else {
  fail(`unknown command "${command}"; use ensure | status | stop | logs`)
}
