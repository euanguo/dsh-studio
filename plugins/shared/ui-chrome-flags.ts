/**
 * Shared cross-plugin facade for the one domain-backed flags record. A thin
 * wrapper over `persistVia` (template C): the domain value hydrates once, a
 * write before hydration is merged field-wise on top of the stored record,
 * and every later write debounces through the host storage client.
 */
import {
  UI_CHROME_TABLES,
  defaultUiChromeFlags,
  sanitizeUiChromeFlags,
  type UiChromeFlags,
} from './ui-chrome-tables.ts'
import { persistVia, type PersistViaHandle } from './store-persistence.ts'

interface FlagsRuntime {
  value: UiChromeFlags
  /** Subscriber set so the facade (and any future observer) can attach. */
  subscribers: Set<() => void>
  persist: PersistViaHandle
}

type GlobalWithFlags = typeof globalThis & { __dshStudioUiChromeFlags?: FlagsRuntime }

function runtime(): FlagsRuntime {
  const root = globalThis as GlobalWithFlags
  if (root.__dshStudioUiChromeFlags === undefined) {
    const subscribers = new Set<() => void>()
    const state: { value: UiChromeFlags } = { value: defaultUiChromeFlags() }
    const handle = persistVia<UiChromeFlags>(
      {
        // Writes are pull-driven via `setUiChromeFlag` → `fire()`; the store
        // subscription is kept only for the facade contract and future observers.
        subscribe: listener => {
          subscribers.add(listener)
          return () => subscribers.delete(listener)
        },
        snapshot: () => state.value,
        apply: value => { state.value = value },
      },
      {
        table: UI_CHROME_TABLES.flags,
        defaults: defaultUiChromeFlags,
        sanitize: sanitizeUiChromeFlags,
        merge: (stored, current) => ({ ...stored, ...current }),
        debounceMs: 200,
      },
    )
    root.__dshStudioUiChromeFlags = {
      value: state.value,
      subscribers,
      persist: handle,
    }
  }
  return root.__dshStudioUiChromeFlags
}

export async function loadUiChromeFlags(): Promise<UiChromeFlags> {
  const state = runtime()
  await state.persist.ready
  return { ...state.value }
}

export function setUiChromeFlag<K extends keyof UiChromeFlags>(key: K, value: UiChromeFlags[K]): void {
  const state = runtime()
  if (state.value[key] === value) return
  state.value = { ...state.value, [key]: value }
  state.persist.fire()
}