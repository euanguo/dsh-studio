export type TerminalTabStatus = 'connecting' | 'ready' | 'exited' | 'error'

export interface TerminalTabState {
  id: string
  label: string
  status: TerminalTabStatus
  exitCode: number | null
}

export interface TerminalPanelState {
  collapsed: boolean
  size: number
  fontFamily: string
  fontSize: number
  tabs: TerminalTabState[]
  activeTabId: string | null
}

export interface PersistedPanelState {
  collapsed: boolean
  size: number
  fontFamily?: string
  fontSize?: number
}

export const MIN_PANEL_SIZE = 120
export const MAX_PANEL_SIZE = 900
export const DEFAULT_PANEL_SIZE = 280
export const MIN_TERMINAL_FONT_SIZE = 9
export const MAX_TERMINAL_FONT_SIZE = 32
export const DEFAULT_TERMINAL_FONT_SIZE = 13
export const DEFAULT_TERMINAL_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
export const DEFAULT_TAB_LABEL = 'Shell'

const STORAGE_KEY = 'oh-dsh-desktop.terminal-panel'
const LEGACY_STORAGE_KEYS = [
  'dsh-external.dsh-web-panel',
  'dsh-external.dsh-web-terminal',
  'dsh-external.dsh-web-terminal.bottom',
] as const

function scopedStorageKey(base: string, scope: string | undefined): string {
  return scope === undefined ? base : `${base}:session:${encodeURIComponent(scope)}`
}

/** Whether any persisted dock state exists for a scope (fresh = no state
 *  has ever been written, so the GLOBAL terminal font prefs may seed it).
 *  Mirrors the `createDockStore` read chain (current key first, then the
 *  legacy keys). */
export function hasPersistedDockState(storage: Storage, scope?: string): boolean {
  if (storage.getItem(scopedStorageKey(STORAGE_KEY, scope)) !== null) return true
  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    if (storage.getItem(scopedStorageKey(legacyKey, scope)) !== null) return true
  }
  return false
}

/**
 * The store actions a pair of GLOBAL terminal font prefs produces
 * (`terminalFontFamily` / `terminalFontSize` from the sidebar settings
 * page): an empty family means "follow the theme" (no override), and the
 * size is clamped into the supported 9–32 range. Pure — the service
 * dispatches the result, the unit tests cover the mapping without a store.
 */
export function terminalFontPrefActions(
  family: string,
  size: number,
): TerminalPanelAction[] {
  const actions: TerminalPanelAction[] = []
  if (family.trim() !== '') {
    actions.push({ type: 'set-font-family', fontFamily: family })
  }
  // The default size equals the dock default: applying it would be a
  // redundant write that also clobbers a persisted per-dock font at mount.
  if (Number.isFinite(size) && size !== DEFAULT_TERMINAL_FONT_SIZE) {
    actions.push({ type: 'set-font-size', fontSize: clampFontSize(size) })
  }
  return actions
}

export function clampSize(size: number): number {
  return Math.min(MAX_PANEL_SIZE, Math.max(MIN_PANEL_SIZE, Math.round(size)))
}

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TERMINAL_FONT_SIZE
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(size)))
}

export function normalizeFontFamily(fontFamily: string): string {
  const value = fontFamily.trim().slice(0, 240)
  return value || DEFAULT_TERMINAL_FONT_FAMILY
}

export function nextTabId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `terminal-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
}

export function tabLabelFromCwd(cwd: string): string {
  const source = cwd.trim()
  if (source === '') return DEFAULT_TAB_LABEL
  if (/^[\\/]+$/.test(source) || /^[A-Za-z]:[\\/]+$/.test(source)) return source
  const trimmed = source.replace(/[\\/]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1) || trimmed
}

function readPersisted(storage: Storage, key: string): PersistedPanelState | null {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<PersistedPanelState & { open?: boolean }>
    if (typeof parsed !== 'object' || parsed === null || !Number.isFinite(parsed.size)) return null
    const collapsed = typeof parsed.collapsed === 'boolean'
      ? parsed.collapsed
      : typeof parsed.open === 'boolean' ? !parsed.open : true
    return {
      collapsed,
      size: clampSize(parsed.size as number),
      fontFamily: typeof parsed.fontFamily === 'string'
        ? normalizeFontFamily(parsed.fontFamily)
        : DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: typeof parsed.fontSize === 'number'
        ? clampFontSize(parsed.fontSize)
        : DEFAULT_TERMINAL_FONT_SIZE,
    }
  } catch {
    return null
  }
}

function writePersisted(storage: Storage, key: string, state: PersistedPanelState): void {
  try {
    storage.setItem(key, JSON.stringify(state))
  } catch {
    // Desktop preferences are best-effort when storage is unavailable.
  }
}

function initialState(persisted: PersistedPanelState | null): TerminalPanelState {
  return {
    collapsed: persisted?.collapsed ?? true,
    size: persisted?.size ?? DEFAULT_PANEL_SIZE,
    fontFamily: persisted?.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: persisted?.fontSize ?? DEFAULT_TERMINAL_FONT_SIZE,
    tabs: [],
    activeTabId: null,
  }
}

export type TerminalPanelAction =
  | { type: 'toggle-collapsed' }
  | { type: 'set-collapsed'; collapsed: boolean }
  | { type: 'set-size'; size: number }
  | { type: 'set-font-family'; fontFamily: string }
  | { type: 'set-font-size'; fontSize: number }
  | { type: 'reset-font' }
  | { type: 'add-tab'; id: string }
  | { type: 'activate-tab'; id: string }
  | { type: 'update-tab'; id: string; status: TerminalTabStatus; exitCode?: number | null }
  | { type: 'rename-tab'; id: string; label: string }
  | { type: 'remove-tab'; id: string }

export function panelReducer(state: TerminalPanelState, action: TerminalPanelAction): TerminalPanelState {
  switch (action.type) {
    case 'toggle-collapsed':
      return { ...state, collapsed: !state.collapsed }
    case 'set-collapsed':
      return { ...state, collapsed: action.collapsed }
    case 'set-size':
      return { ...state, size: clampSize(action.size) }
    case 'set-font-family':
      return { ...state, fontFamily: normalizeFontFamily(action.fontFamily) }
    case 'set-font-size':
      return { ...state, fontSize: clampFontSize(action.fontSize) }
    case 'reset-font':
      return {
        ...state,
        fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
        fontSize: DEFAULT_TERMINAL_FONT_SIZE,
      }
    case 'add-tab':
      return {
        ...state,
        tabs: [...state.tabs, {
          id: action.id,
          label: DEFAULT_TAB_LABEL,
          status: 'connecting',
          exitCode: null,
        }],
        activeTabId: action.id,
      }
    case 'activate-tab':
      return state.tabs.some(tab => tab.id === action.id) ? { ...state, activeTabId: action.id } : state
    case 'update-tab':
      return {
        ...state,
        tabs: state.tabs.map(tab => tab.id === action.id
          ? { ...tab, status: action.status, ...(action.exitCode === undefined ? {} : { exitCode: action.exitCode }) }
          : tab),
      }
    case 'rename-tab':
      return {
        ...state,
        tabs: state.tabs.map(tab => tab.id === action.id ? { ...tab, label: action.label } : tab),
      }
    case 'remove-tab': {
      const removedIndex = state.tabs.findIndex(tab => tab.id === action.id)
      if (removedIndex === -1) return state
      const tabs = state.tabs.filter(tab => tab.id !== action.id)
      const activeTabId = state.activeTabId === action.id
        ? tabs[Math.min(removedIndex, tabs.length - 1)]?.id ?? null
        : state.activeTabId
      return { ...state, tabs, activeTabId }
    }
  }
}

export class DockStore {
  private state: TerminalPanelState
  private readonly listeners = new Set<() => void>()
  private readonly persist: (state: PersistedPanelState) => void

  constructor(
    initial: TerminalPanelState,
    persist: (state: PersistedPanelState) => void,
  ) {
    this.state = initial
    this.persist = persist
  }

  getState = (): TerminalPanelState => this.state

  dispatch = (action: TerminalPanelAction): void => {
    const next = panelReducer(this.state, action)
    if (next === this.state) return
    this.state = next
    this.persist({
      collapsed: next.collapsed,
      size: next.size,
      fontFamily: next.fontFamily,
      fontSize: next.fontSize,
    })
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

export function createDockStore(storage: Storage, scope?: string): DockStore {
  const storageKey = scopedStorageKey(STORAGE_KEY, scope)
  let persisted = readPersisted(storage, storageKey)
  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    if (persisted !== null) break
    persisted = readPersisted(storage, scopedStorageKey(legacyKey, scope))
  }
  return new DockStore(initialState(persisted), state => { writePersisted(storage, storageKey, state) })
}
