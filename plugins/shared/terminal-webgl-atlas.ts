export interface WebglAtlasTarget {
  resetWebglTextureAtlas(): void
  refreshTerminal(): void
}

const liveTargets = new Set<WebglAtlasTarget>()
let globalWindowListenersInstalled = false

export function registerWebglAtlasTarget(target: WebglAtlasTarget): () => void {
  liveTargets.add(target)
  ensureGlobalWindowListeners()
  return () => {
    liveTargets.delete(target)
  }
}

export function resetAllTerminalWebglAtlases(): void {
  for (const target of liveTargets) {
    try {
      target.resetWebglTextureAtlas()
    } catch {
      // Disposed or detached targets should not prevent sibling targets from resetting
    }
  }
}

export function resetAndRefreshAllTerminalWebglAtlases(): void {
  for (const target of [...liveTargets]) {
    try {
      target.resetWebglTextureAtlas()
      target.refreshTerminal()
    } catch {
      // Best effort recovery
    }
  }
}

function ensureGlobalWindowListeners(): void {
  if (globalWindowListenersInstalled || typeof window === 'undefined') return
  globalWindowListenersInstalled = true

  // Recovery on wake from sleep or window focus
  window.addEventListener('focus', () => {
    resetAndRefreshAllTerminalWebglAtlases()
  })

  // Recovery on tab/window visibility return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      resetAndRefreshAllTerminalWebglAtlases()
    }
  })
}
