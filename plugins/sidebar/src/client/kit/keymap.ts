/**
 * Unified keymap (plan 0.4 / P9.1): every sidebar shortcut registers here
 * with a stable action id, a default binding, and a run callback. One
 * capture-phase listener (installed by the plugin root) matches and runs
 * the last registration per id — surfaces register while mounted, so the
 * ACTIVE surface's actions win naturally and unmounting a surface releases
 * its shortcuts. Bindings can be overridden per-action through
 * localStorage (`oh-dsh-desktop.keymap.v1`) for the future rebinding UI.
 */

export interface KeyBinding {
  /** Meta on macOS / Ctrl elsewhere — the platform primary modifier. */
  mod: boolean
  /** Plain Control (may be combined with Meta on macOS). */
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** `event.key`; single characters stored lowercase. */
  key: string
}

/** Convenience constructor: unspecified modifiers default to false. */
export function binding(partial: Partial<KeyBinding> & { key: string }): KeyBinding {
  return {
    mod: partial.mod ?? false,
    ctrl: partial.ctrl ?? false,
    shift: partial.shift ?? false,
    alt: partial.alt ?? false,
    key: partial.key,
  }
}

/** Canonical display form: `Mod+Shift+V`, `Ctrl+Shift+G`, `Shift+F7`, `Escape`. */
export function bindingToString(value: KeyBinding): string {
  const parts: string[] = []
  if (value.mod) parts.push('Mod')
  if (value.ctrl) parts.push('Ctrl')
  if (value.shift) parts.push('Shift')
  if (value.alt) parts.push('Alt')
  parts.push(value.key.length === 1 ? value.key.toUpperCase() : value.key)
  return parts.join('+')
}

/**
 * Parse a binding string produced by {@link bindingToString} (modifier
 * order-independent). Returns null on unknown modifiers or a missing key.
 */
export function parseBindingString(text: string): KeyBinding | null {
  const rawParts = text.trim().split('+')
  // A trailing '+' leaves the key segment empty: "Mod+" is malformed.
  if (rawParts.at(-1)?.trim().length === 0) return null
  const parts = rawParts.map(part => part.trim()).filter(part => part.length > 0)
  if (parts.length === 0) return null
  const result: KeyBinding = { mod: false, ctrl: false, shift: false, alt: false, key: '' }
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase()
    if (lower === 'mod' || lower === 'cmd' || lower === 'meta') result.mod = true
    else if (lower === 'ctrl' || lower === 'control') result.ctrl = true
    else if (lower === 'shift') result.shift = true
    else if (lower === 'alt' || lower === 'option') result.alt = true
    else return null
  }
  const key = parts.at(-1)!
  if (key.length === 0) return null
  result.key = key.length === 1 ? key.toLowerCase() : key
  return result
}

/**
 * Whether a keyboard event carries this binding. `mod` matches Meta-or-Ctrl
 * (the platform primary); `ctrl` matches a held Control key (Meta may be
 * held too, mirroring the legacy handler); a binding with neither never
 * matches while any of the two is held.
 */
export function eventMatchesBinding(value: KeyBinding, event: KeyboardEvent): boolean {
  if (value.mod) {
    if (!(event.metaKey || event.ctrlKey)) return false
  } else if (value.ctrl) {
    if (!event.ctrlKey) return false
  } else if (event.metaKey || event.ctrlKey) {
    return false
  }
  if (value.shift !== event.shiftKey) return false
  if (value.alt !== event.altKey) return false
  return value.key.length === 1
    ? event.key.toLowerCase() === value.key
    : event.key === value.key
}

const STORAGE_KEY = 'oh-dsh-desktop.keymap.v1'

/** Per-action binding overrides (`{ [actionId]: 'Mod+Shift+V' }`). */
export function readKeymapOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0) out[id] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Persist one action's override (the future rebinding UI's write path). */
export function writeKeymapOverride(id: string, bindingText: string): void {
  try {
    const overrides = readKeymapOverrides()
    overrides[id] = bindingText
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Storage may be unavailable (private mode); rebinding is best-effort.
  }
}

interface RegisteredAction {
  id: string
  binding: KeyBinding
  run: (event: KeyboardEvent) => boolean
}

/** Last registration per action id wins (surface mount order = recency). */
const actions = new Map<string, RegisteredAction>()

/**
 * Register a keymap action. Returns the unregister function; re-registering
 * the same id replaces the previous registration. `run` returns whether the
 * event was consumed — only consumed events are preventDefault-ed, so
 * conditional shortcuts (Escape while maximized) leave the event alone
 * otherwise.
 */
export function registerKeymapAction(
  id: string,
  defaultBinding: KeyBinding,
  run: (event: KeyboardEvent) => boolean,
): () => void {
  const overrideText = readKeymapOverrides()[id]
  const effective = overrideText === undefined
    ? defaultBinding
    : (parseBindingString(overrideText) ?? defaultBinding)
  actions.set(id, { id, binding: effective, run })
  return () => {
    const current = actions.get(id)
    if (current !== undefined && current.run === run) actions.delete(id)
  }
}

/** A shortcut with no modifiers must not hijack typing or select contexts. */
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.tagName === 'INPUT'
      || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT'
      || target.isContentEditable)
}

/**
 * Install the single capture-phase keydown listener. Returns the uninstall
 * function; the plugin root installs it once for the app lifetime.
 */
export function installKeymap(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // Held keys re-fire keydown; skip repeats so toggles (Mod+Alt+B, Escape)
    // don't flip state several times per press.
    if (event.repeat) return
    for (const action of actions.values()) {
      if (!eventMatchesBinding(action.binding, event)) continue
      if (isEditableTarget(event.target)
        && !(action.binding.mod || action.binding.ctrl || action.binding.alt)) {
        continue
      }
      const handled = action.run(event)
      if (handled) event.preventDefault()
      return
    }
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => { window.removeEventListener('keydown', onKeyDown, true) }
}
