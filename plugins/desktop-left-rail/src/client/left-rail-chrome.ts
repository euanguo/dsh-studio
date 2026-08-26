/** Durable UI chrome for the workspace browser's reproducible view state. */
import {
  UI_CHROME_TABLES,
  defaultLeftRailViewChrome,
  sanitizeLeftRailViewChrome,
  type LeftRailViewChrome,
} from '@dsh-studio/shared/ui-chrome-tables'
import { callCapabilitiesGlobalApi } from '@dsh-studio/shared/capabilities-api'
import { persistVia } from '@dsh-studio/shared/store-persistence'

export type { LeftRailViewChrome } from '@dsh-studio/shared/ui-chrome-tables'

const TABLE = UI_CHROME_TABLES.leftRailView

/*
 * The write channel is the shared persistVia facade in its pull-driven
 * (ui-chrome-flags) form: `saveLeftRailChrome` snapshots + fires, and the
 * facade's default backend — built inside @dsh-studio/shared/
 * store-persistence, the one place that may construct ui-chrome storage —
 * debounces the put onto the host-owned `left_rail_view` table.
 *
 * Hydration is deliberately NOT delegated to the facade: its strict-load
 * retry loop eventually falls open to defaults with saves enabled, while
 * this channel must keep persistence paused entirely when a hydrate fails
 * (commit 7595452) so an intact host record can never be clobbered with
 * defaults. The consumer gates its save effect on the strict read below.
 */
let latest: LeftRailViewChrome | undefined

const chromePersist = persistVia<LeftRailViewChrome>(
  {
    // Writes are pull-driven via saveLeftRailChrome → fire(); no push source
    // exists at module scope, so the subscription seat stays empty.
    subscribe: () => () => {},
    snapshot: () => latest ?? defaultLeftRailViewChrome(),
    apply: value => { latest = value },
  },
  {
    table: TABLE,
    defaults: defaultLeftRailViewChrome,
    sanitize: sanitizeLeftRailViewChrome,
    debounceMs: 300,
    // Required by the facade contract but unreachable here: hydration is
    // surface-owned (strict gate below) and this facade never hydrates.
    merge: stored => stored,
    hydrate: false,
  },
)

export async function loadLeftRailChrome(signal?: AbortSignal): Promise<LeftRailViewChrome> {
  // Strict by design: the consumer's hydrate→save-back effect must not run
  // on transport-failure defaults, or it would overwrite the stored chrome.
  // This read probe goes straight over the shared capabilities transport;
  // every WRITE still flows through the persistVia channel above.
  const result = await callCapabilitiesGlobalApi<{ value?: unknown }>(
    'ui-chrome.get',
    { table: TABLE },
    signal,
  )
  return sanitizeLeftRailViewChrome(result.value)
}

export function saveLeftRailChrome(value: LeftRailViewChrome): void {
  latest = value
  chromePersist.fire()
}

export function flushLeftRailChrome(): Promise<void> {
  return chromePersist.flush()
}
