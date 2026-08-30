import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  resolveShell,
  shellSpawnArgs,
  windowsPwshCandidateDirs,
  type ShellResolutionOptions,
} from '../plugins/capabilities/src/shell-resolver.ts'

/** Resolve a shell with an injected platform/env/exists/login triple.
 *  The login shell defaults to '' (unset) so the POSIX chain is
 *  deterministic; callers override when testing the passwd step. */
function resolve(options: ShellResolutionOptions): string {
  return resolveShell({
    platform: 'linux',
    env: {},
    exists: () => false,
    loginShell: '',
    ...options,
  })
}

test('POSIX: explicit config wins, then settings shell, then DSH_SIDEBAR_SHELL, then $SHELL, then login shell, then bash', () => {
  assert.equal(resolve({ explicit: '/bin/zsh' }), '/bin/zsh')
  // Deployment config beats the settings page.
  assert.equal(resolve({ explicit: '/bin/zsh', configured: '/bin/fish' }), '/bin/zsh')
  assert.equal(resolve({ configured: '/bin/fish' }), '/bin/fish')
  // The env override is below the settings page but above $SHELL.
  assert.equal(resolve({ configured: '/bin/fish', env: { DSH_SIDEBAR_SHELL: '/bin/sh' } }), '/bin/fish')
  assert.equal(resolve({ env: { DSH_SIDEBAR_SHELL: '/bin/sh', SHELL: '/bin/zsh' } }), '/bin/sh')
  // $SHELL beats the passwd login shell and the bash fallback.
  assert.equal(resolve({ env: { SHELL: '/bin/zsh' }, loginShell: '/bin/fish' }), '/bin/zsh')
  // The login shell (service managers start dsh without $SHELL) beats bash.
  assert.equal(resolve({ loginShell: '/opt/homebrew/bin/zsh' }), '/opt/homebrew/bin/zsh')
  assert.equal(resolve({ loginShell: ' /usr/bin/fish ' }), '/usr/bin/fish')
  // No $SHELL, no passwd entry: bash fallback.
  assert.equal(resolve({}), '/bin/bash')
})

test('POSIX: values are trimmed so whitespace cannot leak into the spawn path', () => {
  assert.equal(resolve({ explicit: ' /usr/bin/zsh ' }), '/usr/bin/zsh')
  assert.equal(resolve({ configured: ' \t/bin/fish\n' }), '/bin/fish')
  assert.equal(resolve({ env: { DSH_SIDEBAR_SHELL: '  /bin/sh ' } }), '/bin/sh')
  assert.equal(resolve({ env: { SHELL: '  /bin/zsh\n' } }), '/bin/zsh')
  // Blank values count as unset.
  assert.equal(resolve({ explicit: '   ', configured: '/bin/zsh' }), '/bin/zsh')
  assert.equal(resolve({ configured: '   ', env: { SHELL: '/bin/zsh' } }), '/bin/zsh')
})

test('Windows: explicit → settings → DSH_SIDEBAR_SHELL → probed pwsh.exe → powershell.exe 5.1', () => {
  const win = (options: ShellResolutionOptions): string => resolve({
    platform: 'win32',
    ...options,
  })
  assert.equal(win({ explicit: 'C:\\Tools\\pwsh.exe' }), 'C:\\Tools\\pwsh.exe')
  assert.equal(win({ configured: 'pwsh.exe' }), 'pwsh.exe')
  assert.equal(win({ env: { DSH_SIDEBAR_SHELL: 'pwsh.exe' } }), 'pwsh.exe')
  // PATH is probed entry by entry; the first directory containing pwsh.exe
  // wins (POSIX host, so the candidate windows join is normalized).
  const fromPath = win({
    env: { PATH: 'C:\\one;C:\\other;C:\\three' },
    exists: path => path.replaceAll('\\', '/') === 'C:/other/pwsh.exe',
  })
  assert.equal(fromPath.replaceAll('\\', '/'), 'C:/other/pwsh.exe')
  // ProgramW6432 (64-bit Program Files) is preferred over ProgramFiles —
  // a 32-bit Node process would otherwise miss the 64-bit PowerShell 7.
  const fromProgram = win({
    env: { ProgramW6432: 'C:\\PF64', ProgramFiles: 'C:\\PF32' },
    exists: path => path.replaceAll('\\', '/') === 'C:/PF64/PowerShell/7/pwsh.exe',
  })
  assert.equal(fromProgram.replaceAll('\\', '/'), 'C:/PF64/PowerShell/7/pwsh.exe')
  // No pwsh anywhere: inbox PowerShell 5.1 fallback.
  assert.equal(win({}), 'powershell.exe')
})

test('POSIX login-shell chain falls back to bash without passwd (no userInfo injection here)', () => {
  // env-less POSIX resolution without userInfo stub → /bin/bash (the
  // passwd step may or may not resolve on the runner; the contract is that
  // SOMETHING concrete is returned, never empty).
  const shell = resolve({})
  assert.equal(typeof shell, 'string')
  assert.ok(shell.length > 0)
})

test('windowsPwshCandidateDirs preserves priority and de-dupes', () => {
  const dirs = windowsPwshCandidateDirs({
    PATH: 'C:\\bin;C:\\bin',
    ProgramW6432: 'C:\\PF64',
    ProgramFiles: 'C:\\PF32',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  })
  // The join uses the host separator, so normalize before comparing —
  // the path priority order and de-dup are the contract.
  const normalized = dirs.map(dir => dir.replaceAll('\\', '/'))
  assert.deepEqual(normalized, [
    'C:/bin',
    'C:/PF64/PowerShell/7',
    'C:/PF64/PowerShell/7-preview',
    'C:/PF32/PowerShell/7',
    'C:/PF32/PowerShell/7-preview',
    'C:/Users/me/AppData/Local/Microsoft/PowerShell/7',
    'C:/Users/me/AppData/Local/Microsoft/PowerShell/7-preview',
    'C:/Users/me/AppData/Local/Programs/PowerShell/7',
    'C:/Users/me/AppData/Local/Programs/PowerShell/7-preview',
  ])
})

test('shellSpawnArgs starts POSIX shells as login shells, Windows takes none', () => {
  assert.deepEqual(shellSpawnArgs('darwin'), ['-l'])
  assert.deepEqual(shellSpawnArgs('linux'), ['-l'])
  assert.deepEqual(shellSpawnArgs('win32'), [])
})