import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  DesktopSkinPreferencesStorage,
  type PreferencesFetch,
} from '../plugins/desktop-skins/src/client/preferences-storage.ts'
import {
  ACTIVE_SKIN_KEY,
  DesktopSkinsController,
  FALLBACK_THEME_KEY,
  type StorageLike,
  type ThemeService,
  type ThemeSnapshot,
} from '../plugins/desktop-skins/src/client/skin-controller.ts'
import type { SkinDomPort } from '../plugins/desktop-skins/src/client/skin-dom.ts'
import {
  DESKTOP_SKINS,
  type DesktopSkin,
} from '../plugins/desktop-skins/src/client/skins.ts'
import {
  parseSkinPreferences,
  type DesktopSkinPreferences,
} from '../plugins/desktop-skins/src/preferences.ts'
import {
  loadSkinPreferences,
  saveSkinPreferences,
} from '../plugins/desktop-skins/src/preferences-server.ts'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class FakeThemeService implements ThemeService {
  readonly custom = new Map<string, Pick<DesktopSkin, 'id' | 'colorScheme' | 'tokens'>>()
  private snapshot: ThemeSnapshot

  constructor(preference: 'light' | 'dark' | 'system' = 'system') {
    this.snapshot = this.builtinSnapshot(preference, 0)
  }

  getTheme(): ThemeSnapshot {
    return this.snapshot
  }

  register(skin: Pick<DesktopSkin, 'id' | 'colorScheme' | 'tokens'>): () => void {
    this.custom.set(skin.id, skin)
    return () => { this.custom.delete(skin.id) }
  }

  setTheme(id: string): void {
    const custom = this.custom.get(id)
    const revision = this.snapshot.revision + 1
    if (custom !== undefined) {
      this.snapshot = {
        preference: id,
        active: custom,
        revision,
      }
      return
    }
    if (id !== 'light' && id !== 'dark' && id !== 'system') {
      throw new Error(`unknown theme: ${id}`)
    }
    this.snapshot = this.builtinSnapshot(id, revision)
  }

  private builtinSnapshot(
    preference: 'light' | 'dark' | 'system',
    revision: number,
  ): ThemeSnapshot {
    const id = preference === 'system' ? 'light' : preference
    return {
      preference,
      active: {
        id,
        colorScheme: id,
        tokens: {},
      },
      revision,
    }
  }
}

class FakeSkinDom implements SkinDomPort {
  active: string | undefined

  apply(skin: DesktopSkin | undefined): void {
    this.active = skin?.id
  }

  dispose(): void {
    this.active = undefined
  }
}

test('desktop skins are namespaced and keep every app surface on one opaque base', () => {
  assert.equal(DESKTOP_SKINS.length, 8)
  assert.equal(new Set(DESKTOP_SKINS.map(skin => skin.id)).size, DESKTOP_SKINS.length)
  for (const skin of DESKTOP_SKINS) {
    const chatgpt = skin.id.startsWith('oh-dsh-skin-chatgpt')
    assert.match(skin.id, /^oh-dsh-skin-/)
    assert.ok(Object.keys(skin.tokens).length >= 30)
    assert.match(skin.tokens['--dsw-alias-bg-base'] ?? '', /^#[0-9a-f]{6}$/i)
    assert.match(skin.tokens['--dsw-specific-sidebar-fill'] ?? '', /^#[0-9a-f]{6}$/i)
    // Non-ChatGPT skins keep one opaque base for every surface; the
    // ChatGPT pair deliberately deepens the sidebar rail (measured).
    if (!chatgpt) {
      assert.equal(skin.tokens['--dsw-alias-bg-base'], skin.tokens['--dsw-specific-sidebar-fill'])
    }
    // Only the ChatGPT pair carries an atmosphere stylesheet; the geometry
    // tokens now gate on the exact data-oh-dsh-skin attribute (every skin
    // consumes the same geometry, so the sub-string chatgpt gate is gone).
    assert.equal(skin.css === undefined, !chatgpt)
    if (chatgpt) {
      assert.match(skin.css ?? '', /data-oh-dsh-skin\]/)
      assert.match(skin.css ?? '', /--gw-skin-radius-pill/)
    }
  }
})

test('light ChatGPT skin adapts the HoverCard surface and feedback label', () => {
  const day = DESKTOP_SKINS.find(skin => skin.id === 'oh-dsh-skin-chatgpt-day')
  assert.ok(day?.css)
  assert.match(day.css, /body\[data-oh-dsh-skin\] \._card_1b2ny_13 \{[^}]*background: var\(--dsw-alias-bg-layer-1\) !important;/s)
  assert.match(day.css, /body\[data-oh-dsh-skin\] \._card_1b2ny_13 \{[^}]*color: var\(--dsw-alias-label-primary\) !important;/s)
})

test('desktop skins restore a persisted choice after theme registration', () => {
  const storage = new MemoryStorage()
  storage.setItem(ACTIVE_SKIN_KEY, 'oh-dsh-skin-porcelain')
  const theme = new FakeThemeService('dark')
  const dom = new FakeSkinDom()
  const controller = new DesktopSkinsController(theme, storage, dom)

  controller.start()

  assert.equal(theme.custom.size, DESKTOP_SKINS.length)
  assert.equal(theme.getTheme().active.id, 'oh-dsh-skin-porcelain')
  assert.equal(controller.getSnapshot().activeId, 'oh-dsh-skin-porcelain')
  assert.equal(storage.getItem(FALLBACK_THEME_KEY), 'dark')
  assert.equal(dom.active, 'oh-dsh-skin-porcelain')
})

test('choosing Original restores the appearance used before a skin', () => {
  const storage = new MemoryStorage()
  const theme = new FakeThemeService('dark')
  const dom = new FakeSkinDom()
  const controller = new DesktopSkinsController(theme, storage, dom)
  controller.start()

  controller.setSkin('oh-dsh-skin-jade-circuit')
  assert.equal(storage.getItem(ACTIVE_SKIN_KEY), 'oh-dsh-skin-jade-circuit')
  assert.equal(storage.getItem(FALLBACK_THEME_KEY), 'dark')

  controller.setSkin(null)
  // Clearing the choice falls back to the default ChatGPT skin for the
  // scheme (dark here), not the official theme.
  assert.equal(theme.getTheme().active.id, 'oh-dsh-skin-chatgpt-night')
  assert.equal(storage.getItem(ACTIVE_SKIN_KEY), null)
  assert.equal(controller.getSnapshot().activeId, 'oh-dsh-skin-chatgpt-night')
  assert.equal(dom.active, 'oh-dsh-skin-chatgpt-night')
})

test('a durable skin choice outlasts an official appearance change', () => {
  const storage = new MemoryStorage()
  const theme = new FakeThemeService('system')
  const dom = new FakeSkinDom()
  const controller = new DesktopSkinsController(theme, storage, dom)
  controller.start()
  controller.setSkin('oh-dsh-skin-ember-dusk')

  theme.setTheme('light')
  controller.adopt(theme.getTheme())

  // The official light/dark pair is replaced by the ChatGPT skins, so an
  // official appearance change re-asserts the durable skin choice instead of
  // taking over.
  assert.equal(storage.getItem(ACTIVE_SKIN_KEY), 'oh-dsh-skin-ember-dusk')
  assert.equal(storage.getItem(FALLBACK_THEME_KEY), 'light')
  assert.equal(theme.getTheme().active.id, 'oh-dsh-skin-ember-dusk')
  assert.equal(controller.getSnapshot().activeId, 'oh-dsh-skin-ember-dusk')
  assert.equal(dom.active, 'oh-dsh-skin-ember-dusk')
})

test('official themes resolve to the default ChatGPT pair (builtin appearance is replaced)', () => {
  const storage = new MemoryStorage()
  const theme = new FakeThemeService('dark')
  const dom = new FakeSkinDom()
  const controller = new DesktopSkinsController(theme, storage, dom)
  controller.start()

  // ui-theme's async settings-scope adoption reverts the preference to the
  // durable builtin and re-emits `theme/change`; the controller must re-assert
  // the default ChatGPT skin instead of stripping it.
  theme.setTheme('system')
  controller.adopt(theme.getTheme())

  assert.equal(storage.getItem(ACTIVE_SKIN_KEY), null)
  assert.equal(storage.getItem(FALLBACK_THEME_KEY), 'system')
  assert.equal(theme.getTheme().active.id, 'oh-dsh-skin-chatgpt-day')
  assert.equal(controller.getSnapshot().activeId, 'oh-dsh-skin-chatgpt-day')
  assert.equal(dom.active, 'oh-dsh-skin-chatgpt-day')
})

test('desktop skins reject unknown choices and release theme registrations', () => {
  const storage = new MemoryStorage()
  const theme = new FakeThemeService()
  const dom = new FakeSkinDom()
  const controller = new DesktopSkinsController(theme, storage, dom)
  controller.start()

  assert.throws(
    () => { controller.setSkin('oh-dsh-skin-missing') },
    /unknown desktop skin/,
  )
  controller.dispose()
  assert.equal(theme.custom.size, 0)
  assert.equal(dom.active, undefined)
})

test('runtime teardown preserves the selected skin for the next launch', () => {
  const storage = new MemoryStorage()
  const theme = new FakeThemeService('dark')
  const dom = new FakeSkinDom()
  const controller = new DesktopSkinsController(theme, storage, dom)
  controller.start()
  controller.setSkin('oh-dsh-skin-porcelain')

  controller.dispose()
  controller.adopt(theme.getTheme())

  assert.equal(storage.getItem(ACTIVE_SKIN_KEY), 'oh-dsh-skin-porcelain')
  assert.equal(theme.getTheme().active.id, 'oh-dsh-skin-chatgpt-night')
  assert.equal(theme.custom.size, 0)
})

test('desktop skin preferences survive outside the changing Web origin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oh-dsh-desktop-skins-'))
  const path = join(directory, 'desktop-skins.json')
  const preferences: DesktopSkinPreferences = {
    activeId: 'oh-dsh-skin-porcelain',
    fallbackTheme: 'dark',
  }
  try {
    await saveSkinPreferences(path, preferences)
    assert.deepEqual(await loadSkinPreferences(path), preferences)
    assert.equal((await readFile(path, 'utf8')).endsWith('\n'), true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('client preference writes are coalesced and validated', async () => {
  let persisted: DesktopSkinPreferences = {
    activeId: null,
    fallbackTheme: 'system',
  }
  const writes: DesktopSkinPreferences[] = []
  const request: PreferencesFetch = async (_input, init) => {
    if (init?.method === 'PUT') {
      const value = parseSkinPreferences(JSON.parse(init.body ?? 'null') as unknown)
      assert.ok(value)
      persisted = value
      writes.push(value)
    }
    return {
      ok: true,
      status: 200,
      json: async () => persisted,
    }
  }
  const storage = new DesktopSkinPreferencesStorage(request)
  await storage.load()

  storage.setItem(ACTIVE_SKIN_KEY, 'oh-dsh-skin-deep-current')
  storage.setItem(FALLBACK_THEME_KEY, 'dark')
  await storage.settle()

  assert.deepEqual(persisted, {
    activeId: 'oh-dsh-skin-deep-current',
    fallbackTheme: 'dark',
  })
  assert.equal(writes.length, 1)
})
