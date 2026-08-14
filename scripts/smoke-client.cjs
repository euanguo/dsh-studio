const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const runtimeUrl = process.argv[2]
const timeoutMs = 20_000

if (runtimeUrl === undefined) throw new Error('runtime URL is required')

app.disableHardwareAcceleration()

function finish(window, error) {
  if (error === undefined) {
    process.stdout.write('DSH Chromium client graph: ready\n')
  } else {
    process.stderr.write(`${error.stack ?? error.message}\n`)
  }
  window.destroy()
  app.exit(error === undefined ? 0 : 1)
}

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    height: 800,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'smoke-client-preload.cjs'),
      sandbox: false,
    },
    width: 1280,
  })
  const startedAt = Date.now()
  let navigationReadyAt = null
  let settled = false

  const settle = error => {
    if (settled) return
    settled = true
    finish(window, error)
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    settle(new Error(`Chromium renderer exited: ${details.reason}`))
  })
  window.webContents.on('did-fail-load', (_event, code, description) => {
    settle(new Error(`Chromium failed to load DSH (${code}): ${description}`))
  })

  await window.loadURL(runtimeUrl)
  const poll = async () => {
    if (settled) return
    try {
      const state = await window.webContents.executeJavaScript(`(() => ({
        body: document.body?.innerText ?? '',
        navigation: (() => {
          const pluginsIcon = document.querySelector('.oh-marketplace-nav svg')
          const settings = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
            .find(button => /settings|设置/i.test([
              button.textContent,
              button.getAttribute('aria-label'),
              button.getAttribute('title'),
            ].filter(Boolean).join(' ')))
          const settingsIcon = settings?.querySelector('svg')
          if (!(pluginsIcon instanceof SVGElement)
            || !(settingsIcon instanceof SVGElement)) return null
          const pluginsRect = pluginsIcon.getBoundingClientRect()
          const settingsRect = settingsIcon.getBoundingClientRect()
          const pluginsBox = pluginsIcon.getBBox()
          const settingsBox = settingsIcon.getBBox()
          const pluginsView = pluginsIcon.viewBox.baseVal
          const settingsView = settingsIcon.viewBox.baseVal
          const pluginsArtwork = {
            height: pluginsBox.height / pluginsView.height * pluginsRect.height,
            width: pluginsBox.width / pluginsView.width * pluginsRect.width,
          }
          const settingsArtwork = {
            height: settingsBox.height / settingsView.height * settingsRect.height,
            width: settingsBox.width / settingsView.width * settingsRect.width,
          }
          return {
            artworkDelta: Math.max(
              Math.abs(pluginsArtwork.height - settingsArtwork.height),
              Math.abs(pluginsArtwork.width - settingsArtwork.width),
            ),
            delta: Math.abs(
              pluginsRect.left + pluginsRect.width / 2
              - settingsRect.left - settingsRect.width / 2
            ),
            pluginsArtwork,
            pluginsBottom: pluginsRect.bottom,
            pluginsCenter: pluginsRect.left + pluginsRect.width / 2,
            pluginsTop: pluginsRect.top,
            settingsArtwork,
            settingsBottom: settingsRect.bottom,
            settingsCenter: settingsRect.left + settingsRect.width / 2,
            settingsTop: settingsRect.top,
            viewportHeight: window.innerHeight,
          }
        })(),
        ready: document.documentElement.dataset.ohDshDesktop === 'true',
      }))()`)
      if (state.ready === true && state.navigation !== null) {
        if (state.navigation.pluginsTop < 0
          || state.navigation.pluginsBottom > state.navigation.viewportHeight
          || state.navigation.settingsTop < 0
          || state.navigation.settingsBottom > state.navigation.viewportHeight) {
          settle(new Error(
            'Plugins and Settings navigation is outside the viewport: '
            + JSON.stringify(state.navigation),
          ))
          return
        }
        if (state.navigation.delta > 0.5) {
          settle(new Error(
            'Plugins and Settings icons are not aligned: '
            + JSON.stringify(state.navigation),
          ))
          return
        }
        if (state.navigation.artworkDelta > 1) {
          settle(new Error(
            'Plugins and Settings icons are not optically sized: '
            + JSON.stringify(state.navigation),
          ))
          return
        }
        navigationReadyAt ??= Date.now()
        if (Date.now() - navigationReadyAt >= 750) {
          settle()
          return
        }
      }
      if (state.body.includes('Failed to load plugins')) {
        settle(new Error(state.body.trim()))
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        settle(new Error(`DSH Chromium client graph timed out:\n${state.body.trim()}`))
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
