import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TERMINAL_MESSAGES } from '../plugins/panel-controls/src/terminal/i18n.ts'
import {
  TERMINAL_SIDEBAR_SHARED_KEYS,
  TERMINAL_SIDEBAR_SHARED_MESSAGES,
} from '../plugins/shared/terminal-messages.ts'
import { WORKSPACE_MESSAGES } from '../plugins/sidebar/src/client/i18n.ts'
import { PINNED_SUMMARY_MESSAGES } from '../plugins/pinned-summary/src/i18n.ts'
import { DESKTOP_SKINS_MESSAGES } from '../plugins/desktop-skins/src/client/i18n.ts'
import { MARKETPLACE_MESSAGES } from '../plugins/plugin-marketplace/src/client/i18n.ts'
import {
  en as leftRailEn,
  zh as leftRailZh,
} from '../plugins/desktop-left-rail/src/client/locales.ts'

/**
 * i18n discipline contract (leaf-5.1).
 *
 * Guarded contract: every DSH Studio plugin registers its message table
 * under exactly one locale namespace through the shared/i18n engine, and
 * every message key that appears in more than one table is reconciled by
 * an explicit policy instead of silent copy-paste drift:
 *
 *   - terminal ↔ sidebar: four live `terminal.*` keys spread from the
 *     shared terminal slice's single source; the fifth formerly
 *     duplicated key (`terminal.toggle`) is owned by the terminal table
 *     alone after the sidebar's stale copy was removed as dead code;
 *   - sidebar ↔ desktop-left-rail: the relative-time bucket keys (`time.*`)
 *     must stay byte-identical so the selection pill and the left rail
 *     render the same localized shapes (C37);
 *   - any other collision is a namespace-scoped coincidence that different
 *     features resolve independently, and is listed explicitly below —
 *     a new unlisted duplicate fails this guard until it is single-sourced
 *     or consciously allowlisted here.
 *
 * This is an inventory-reconciliation guard over real registered artifacts
 * (the tables plugins actually register), not a source-wording grep.
 */

type Dict = Record<string, string>

interface LocaleTable {
  readonly namespace: string
  readonly messages: Record<'en' | 'zh', Dict>
}

const TABLES: readonly LocaleTable[] = [
  { namespace: 'dsh-studio.terminal', messages: TERMINAL_MESSAGES },
  { namespace: 'dsh-studio.sidebar', messages: WORKSPACE_MESSAGES },
  { namespace: 'dsh-studio.pinned-summary', messages: PINNED_SUMMARY_MESSAGES },
  { namespace: 'dsh-studio.desktop-skins', messages: DESKTOP_SKINS_MESSAGES },
  { namespace: 'dsh-studio.plugin-marketplace', messages: MARKETPLACE_MESSAGES },
  { namespace: 'workspace', messages: { en: leftRailEn, zh: leftRailZh } },
]

const LOCALES = ['en', 'zh'] as const

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort()
}

test('every plugin locale table registers a unique namespace with complete dictionaries', () => {
  const namespaces = new Set<string>()
  for (const table of TABLES) {
    assert(
      !namespaces.has(table.namespace),
      `namespace ${table.namespace} is registered more than once`,
    )
    namespaces.add(table.namespace)

    for (const locale of LOCALES) {
      const dict: Dict = table.messages[locale]
      const keys = Object.keys(dict)
      assert(keys.length > 0, `${table.namespace} ${locale} dictionary is empty`)
      for (const key of keys) {
        assert.equal(
          typeof dict[key],
          'string',
          `${table.namespace} ${locale} key ${key} is not a string`,
        )
      }
    }

    // The engine's LocaleMessages shape requires both locales to carry the
    // same key set; pin it at runtime too.
    assert.deepEqual(
      Object.keys(table.messages.en).sort(),
      Object.keys(table.messages.zh).sort(),
      `${table.namespace} en/zh key sets differ`,
    )
  }
})

test('terminal keys duplicated across the terminal and sidebar tables share one source', () => {
  for (const key of TERMINAL_SIDEBAR_SHARED_KEYS) {
    for (const locale of LOCALES) {
      const shared = TERMINAL_SIDEBAR_SHARED_MESSAGES[locale]
      assert.equal(
        WORKSPACE_MESSAGES[locale][key],
        TERMINAL_MESSAGES[locale][key],
        `sidebar ${locale} key ${key} is not the shared terminal slice's single-source string`,
      )
      assert.equal(
        WORKSPACE_MESSAGES[locale][key],
        shared[key],
        `sidebar ${locale} key ${key} does not come from the shared terminal slice`,
      )
    }
  }

  // The fifth formerly duplicated key: the sidebar's stale copy was dead
  // code, so dedup removes it from the workspace table entirely instead of
  // single-sourcing a string nothing renders through the sidebar namespace.
  assert('terminal.toggle' in TERMINAL_MESSAGES.en)
  assert('terminal.toggle' in TERMINAL_MESSAGES.zh)
  assert(!('terminal.toggle' in WORKSPACE_MESSAGES.en))
  assert(!('terminal.toggle' in WORKSPACE_MESSAGES.zh))
})

test('relative-time bucket keys stay identical between the sidebar and left rail', () => {
  const timeKeys = [
    'time.now',
    'time.minutes',
    'time.hours',
    'time.days',
    'time.months',
    'time.years',
    'time.ago',
  ] as const
  for (const key of timeKeys) {
    for (const locale of LOCALES) {
      assert.equal(
        WORKSPACE_MESSAGES[locale][key],
        locale === 'en' ? leftRailEn[key] : leftRailZh[key],
        `sidebar and left-rail ${locale} copies of ${key} drifted apart`,
      )
    }
  }
})

test('cross-table key overlap stays within the reconciled or allowlisted sets', () => {
  const singleSourced: ReadonlySet<string> = new Set(TERMINAL_SIDEBAR_SHARED_KEYS)
  const intentionalSync: ReadonlySet<string> = new Set([
    'time.now',
    'time.minutes',
    'time.hours',
    'time.days',
    'time.months',
    'time.years',
    'time.ago',
  ])
  // Different features that coincidentally share a flat key name; their
  // namespaces keep them apart and their strings may diverge freely.
  const coincidences: ReadonlySet<string> = new Set([
    'summary.title',
    'search.placeholder',
    'search.clear',
  ])

  for (let i = 0; i < TABLES.length; i++) {
    for (let j = i + 1; j < TABLES.length; j++) {
      const first = TABLES[i]!
      const second = TABLES[j]!
      const pair = [first.namespace, second.namespace].sort().join(' <-> ')
      for (const locale of LOCALES) {
        const firstDict: Dict = first.messages[locale]
        const secondDict: Dict = second.messages[locale]
        for (const key of Object.keys(firstDict)) {
          if (!(key in secondDict)) continue

          if (pair === 'dsh-studio.sidebar <-> dsh-studio.terminal') {
            assert(
              singleSourced.has(key),
              `terminal/sidebar duplicate key ${key} (${locale}) must come from `
                + `the shared terminal slice's single source`,
            )
            assert.equal(
              firstDict[key],
              secondDict[key],
              `duplicate key ${key} (${pair}, ${locale}) diverged between tables`,
            )
            continue
          }
          if (pair === 'dsh-studio.sidebar <-> workspace' && intentionalSync.has(key)) {
            assert.equal(
              firstDict[key],
              secondDict[key],
              `intentionally synced key ${key} (${pair}, ${locale}) diverged`,
            )
            continue
          }
          assert(
            coincidences.has(key),
            `unexpected cross-table duplicate key ${key} (${pair}, ${locale}); `
              + 'single-source it or extend the reconciliation policy in this test',
          )
        }
      }
    }
  }
})

test('left-rail zh/en dictionaries keep identical key sets and placeholder parity', () => {
  const zhDict: Dict = leftRailZh
  const enDict: Dict = leftRailEn
  const zhKeys = Object.keys(zhDict).sort()
  assert.deepEqual(Object.keys(enDict).sort(), zhKeys, 'left-rail en keys must mirror zh exactly')

  for (const key of zhKeys) {
    assert.deepEqual(
      placeholders(enDict[key]!),
      placeholders(zhDict[key]!),
      `placeholder mismatch between locales for left-rail key ${key}`,
    )
  }
})
