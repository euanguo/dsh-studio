import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_SIDEBAR_RUNTIME_PREFERENCES,
  parseSidebarRuntimePreferences,
  SidebarRuntimeSettingsService,
} from '../plugins/sidebar/src/client/runtime-settings.ts'

test('sidebar runtime settings default missing upstream fields safely', () => {
  assert.deepEqual(parseSidebarRuntimePreferences({
    agentTerminalTools: true,
    interceptOpenPath: false,
  }), {
    ...DEFAULT_SIDEBAR_RUNTIME_PREFERENCES,
    agentTerminalTools: true,
    interceptOpenPath: false,
  })
})

test('sidebar runtime settings keep WorkTree Agent tools disabled by default', () => {
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.agentWorktreeTools, false)
  assert.equal(parseSidebarRuntimePreferences({ agentWorktreeTools: true }).agentWorktreeTools, true)
})

test('sidebar runtime settings default the per-protocol intercept flags', () => {
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptHttp, true)
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptHttps, false)
  // An old document without the flags resolves to the defaults, http keeps
  // working for existing users, https stays off.
  const parsed = parseSidebarRuntimePreferences({ browserInterceptLinks: true })
  assert.equal(parsed.browserInterceptHttp, true)
  assert.equal(parsed.browserInterceptHttps, false)
  // Explicit booleans are honored.
  assert.equal(parseSidebarRuntimePreferences({ browserInterceptHttps: true }).browserInterceptHttps, true)
  assert.equal(parseSidebarRuntimePreferences({ browserInterceptHttp: false }).browserInterceptHttp, false)
})

test('sidebar runtime settings default the HTML viewer sandbox flags to sandboxed', () => {
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.htmlViewerNoSandbox, false)
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.htmlViewerDefaultUnsafe, false)
  const parsed = parseSidebarRuntimePreferences({})
  assert.equal(parsed.htmlViewerNoSandbox, false)
  assert.equal(parsed.htmlViewerDefaultUnsafe, false)
  assert.equal(parseSidebarRuntimePreferences({ htmlViewerNoSandbox: true }).htmlViewerNoSandbox, true)
  assert.equal(parseSidebarRuntimePreferences({ htmlViewerDefaultUnsafe: true }).htmlViewerDefaultUnsafe, true)
})

test('sidebar runtime settings default the terminal font prefs to theme-following', () => {
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalFontFamily, '')
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalFontSize, 13)
  const parsed = parseSidebarRuntimePreferences({})
  assert.equal(parsed.terminalFontFamily, '')
  assert.equal(parsed.terminalFontSize, 13)
  assert.equal(parseSidebarRuntimePreferences({ terminalFontFamily: 'JetBrains Mono' }).terminalFontFamily, 'JetBrains Mono')
  assert.equal(parseSidebarRuntimePreferences({ terminalFontSize: 16 }).terminalFontSize, 16)
})

test('sidebar runtime settings clamp terminal lifecycle and renderer policies', () => {
  const parsed = parseSidebarRuntimePreferences({
    terminalFontSize: 100,
    terminalScrollbackRows: 999,
    terminalReconnectGraceMs: 999_999,
    terminalProcessKillGraceMs: 1,
    terminalRetainedInactiveSessions: -2,
    terminalMouseWheelMultiplier: 10,
    terminalLigatures: true,
    terminalGpuAcceleration: 'on',
  })
  assert.equal(parsed.terminalFontSize, 32)
  assert.equal(parsed.terminalScrollbackRows, 1_000)
  assert.equal(parsed.terminalReconnectGraceMs, 120_000)
  assert.equal(parsed.terminalProcessKillGraceMs, 250)
  assert.equal(parsed.terminalRetainedInactiveSessions, 0)
  assert.equal(parsed.terminalMouseWheelMultiplier, 4)
  assert.equal(parsed.terminalLigatures, true)
  assert.equal(parsed.terminalGpuAcceleration, 'on')
  assert.equal(parseSidebarRuntimePreferences({ terminalGpuAcceleration: 'invalid' }).terminalGpuAcceleration, 'auto')
})

test('sidebar runtime settings default terminalShell to unset', () => {
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalShell, '')
  assert.equal(parseSidebarRuntimePreferences({}).terminalShell, '')
  assert.equal(parseSidebarRuntimePreferences({ terminalShell: '/bin/zsh' }).terminalShell, '/bin/zsh')
})

test('sidebar runtime settings default the subagent/jobs auto-open toggles on', () => {
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.autoOpenSubagent, true)
  assert.equal(DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.autoOpenJobs, true)
  const parsed = parseSidebarRuntimePreferences({})
  assert.equal(parsed.autoOpenSubagent, true)
  assert.equal(parsed.autoOpenJobs, true)
  assert.equal(parseSidebarRuntimePreferences({ autoOpenSubagent: false }).autoOpenSubagent, false)
  assert.equal(parseSidebarRuntimePreferences({ autoOpenJobs: false }).autoOpenJobs, false)
})

test('sidebar runtime settings serialize revision-guarded updates', async () => {
  const writes: Array<{
    patch: Record<string, unknown>
    revision: number | undefined
  }> = []
  let value = { ...DEFAULT_SIDEBAR_RUNTIME_PREFERENCES }
  let revision = 4
  const service = new SidebarRuntimeSettingsService({
    settingsGet: async () => ({ revision, value }),
    settingsUpdate: async (patch, expectedRevision) => {
      writes.push({ patch, revision: expectedRevision })
      value = { ...value, ...patch }
      revision += 1
      return { revision, value }
    },
  })

  await service.start()
  await Promise.all([
    service.update({ agentTerminalTools: true }),
    service.update({ browserInterceptLinks: false }),
  ])

  assert.deepEqual(writes, [
    { patch: { agentTerminalTools: true }, revision: 4 },
    { patch: { browserInterceptLinks: false }, revision: 5 },
  ])
  assert.equal(service.getSnapshot().preferences.agentTerminalTools, true)
  assert.equal(service.getSnapshot().preferences.browserInterceptLinks, false)
  assert.equal(service.getSnapshot().revision, 6)
})
