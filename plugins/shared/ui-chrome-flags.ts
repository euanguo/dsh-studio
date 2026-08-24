/** Shared cross-plugin facade for the one domain-backed flags record. */
import { createUiChromeStorage, type UiChromeStorage } from './ui-chrome-storage.ts'
import {
  UI_CHROME_TABLES,
  defaultUiChromeFlags,
  sanitizeUiChromeFlags,
  type UiChromeFlags,
} from './ui-chrome-tables.ts'

interface FlagsRuntime {
  storage: UiChromeStorage<UiChromeFlags>
  value: UiChromeFlags
  pending: Partial<UiChromeFlags>
  ready: boolean
  loaded: Promise<void> | undefined
}

type GlobalWithFlags = typeof globalThis & { __dshStudioUiChromeFlags?: FlagsRuntime }

function runtime(): FlagsRuntime {
  const root = globalThis as GlobalWithFlags
  if (root.__dshStudioUiChromeFlags === undefined) {
    root.__dshStudioUiChromeFlags = {
      storage: createUiChromeStorage<UiChromeFlags>({
        table: UI_CHROME_TABLES.flags,
        defaults: defaultUiChromeFlags,
        sanitize: sanitizeUiChromeFlags,
        debounceMs: 200,
      }),
      value: defaultUiChromeFlags(),
      pending: {},
      ready: false,
      loaded: undefined,
    }
  }
  return root.__dshStudioUiChromeFlags
}

export async function loadUiChromeFlags(): Promise<UiChromeFlags> {
  const state = runtime()
  state.loaded ??= state.storage.load().then(value => {
    state.value = { ...value, ...state.pending }
    if (Object.keys(state.pending).length > 0) {
      state.storage.save(state.value)
      state.pending = {}
    }
    state.ready = true
  })
  await state.loaded
  return { ...state.value }
}

export function setUiChromeFlag<K extends keyof UiChromeFlags>(key: K, value: UiChromeFlags[K]): void {
  const state = runtime()
  state.value = { ...state.value, [key]: value }
  if (!state.ready) state.pending[key] = value
  state.storage.save(state.value)
}

export async function flushUiChromeFlags(): Promise<void> {
  await runtime().storage.flush()
}
