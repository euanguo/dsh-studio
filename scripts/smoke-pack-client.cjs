/**
 * Minimal Electron render harness for the packed-artifact smoke
 * (scripts/smoke-pack.mjs). Loads the booted DSH runtime and asserts the
 * DSH Studio sidebar MOUNTS with no plugin-load error bar — the "mount + no
 * crash" granularity of the CI gate. Deliberately avoids smoke-client.cjs's
 * geometry/vision assertions (those cover the left-rail rework separately).
 */
const { app, BrowserWindow } = require('electron')

const runtimeUrl = process.env.DSH_SMOKE_RUNTIME_URL ?? process.argv[2]
const timeoutMs = 30_000

if (runtimeUrl === undefined) throw new Error('runtime URL is required')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    height: 800,
    show: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: require('node:path').join(__dirname, 'smoke-client-preload.cjs'),
      sandbox: false,
    },
    width: 1280,
  })
  let settled = false
  const settle = (error) => {
    if (settled) return
    settled = true
    if (error === undefined) {
      process.stdout.write('packed-artifact sidebar mounted with no error bar\n')
    } else {
      process.stderr.write(`${error.stack ?? error.message}\n`)
    }
    window.destroy()
    app.exit(error === undefined ? 0 : 1)
  }
  window.webContents.on('render-process-gone', (_event, details) => {
    settle(new Error(`Chromium renderer exited: ${details.reason}`))
  })
  window.webContents.on('did-fail-load', (_event, code, description, validatedUrl, isMainFrame) => {
    if (isMainFrame === false) return
    if (code === -3) return
    settle(new Error(`Chromium failed to load DSH (${code}): ${description} (${validatedUrl})`))
  })

  await window.loadURL(runtimeUrl)
  const startedAt = Date.now()
  const poll = async () => {
    if (settled) return
    try {
      const state = await window.webContents.executeJavaScript(`(() => {
        const onboardingButton = [...document.querySelectorAll('button')]
          .find(button => /^(继续|continue|start using|开始使用|稍后配置|configure later|skip|later)$/i.test((button.textContent ?? '').trim()))
        if (onboardingButton !== undefined) onboardingButton.click()
        return {
          body: document.body?.innerText ?? '',
          sidebarRoot: document.getElementById('dsh-studio-sidebar-root') !== null,
          terminalRoot: document.getElementById('dsh-studio-terminal-root') !== null,
        }
      })()`)
      if (state.body.includes('Failed to load plugins')) {
        settle(new Error(`plugin load failed:\\n${state.body.trim()}`))
        return
      }
      if (state.sidebarRoot && state.terminalRoot) {
        settle()
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        settle(new Error(
          `sidebar mount timed out (sidebar=${String(state.sidebarRoot)}, terminal=${String(state.terminalRoot)}):\\n${state.body.trim()}`,
        ))
        return
      }
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
      return
    }
    setTimeout(() => { void poll() }, 100)
  }
  await poll()
}).catch(error => {
  process.stderr.write(`${error.stack ?? String(error)}\n`)
  app.exit(1)
})
