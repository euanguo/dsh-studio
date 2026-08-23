/**
 * Workbench kernel contracts — the shared vocabulary surface-opening and
 * state-scoping features converge on (see `docs/design.md` "Workbench 内核契约"
 * / `docs/design.en.md` "Workbench Kernel Contracts").
 *
 * Scope discipline: TYPE-ONLY declarations plus TWO pure decision functions.
 * No DOM, no React, no cordis imports — browser-safe and host-safe, so any
 * plugin (and tests) can consume it without crossing the value-import ban.
 *
 * Focus invariant (every opener must uphold it): an open NEVER moves keyboard
 * focus or scroll position. `activate` controls which tab is VISIBLE; only an
 * explicit user gesture (click/keyboard on the tab itself) may focus an
 * element. Agent-driven and link-driven opens therefore pass
 * `intent: 'background'` or rely on activation-without-focus.
 */

/** How an open request intends to land. */
export type OpenIntent =
  /** Replaceable single preview; never covers a pinned tab. */
  | "preview"
  /** Permanent tab. */
  | "pin"
  /** Append without changing the active tab (no focus, no view swap). */
  | "background"

/** Where an opened surface lives today. */
export type SurfaceArea = "side-rail" | "center-tabs"

/** Whether single-click opens create replaceable previews. */
export type PreviewTabsMode = "default" | "disabled"

/** Which dimension a persisted state bucket follows. */
export type ScopeLevel = "workspace" | "session" | "global"

export interface OpenPlanInput {
  /** Surface kind (descriptor id or center-surface kind). */
  kind: string
  /** Defaults to `'pin'`. */
  intent?: OpenIntent
  /** Explicit area wins over the default routing. */
  area?: SurfaceArea
  /**
   * Conversation-like kinds are ALWAYS pinned center tabs regardless of
   * intent (closing them never discards the session; previews make no sense).
   */
  alwaysPinnedKind?: boolean
  /**
   * Side-rail tabs have no preview concept: every open there is permanent.
   * Declared explicitly so future rail previews cannot silently regress.
   */
  railTabsArePermanent?: boolean
}

export interface OpenPlanContext {
  /** The user's preview-tab preference. */
  previewTabs: PreviewTabsMode
}

export interface OpenPlan {
  area: SurfaceArea
  /** Center only: false ⇒ replaceable preview tab. Rail tabs are always permanent. */
  pinned: boolean
  /** False only for `intent: 'background'`: append without activation. */
  activate: boolean
}

/**
 * The ONE open decision every entry point funnels through. Pure — the same
 * table the smoke tests assert on, with no store or DOM access.
 */
export function resolveOpenPlan(
  input: OpenPlanInput,
  context: OpenPlanContext,
): OpenPlan {
  const intent: OpenIntent = input.intent ?? "pin"
  const activate = intent !== "background"
  const area: SurfaceArea = input.area ?? "center-tabs"
  if (area === "side-rail") {
    // Rail tabs are permanent today; `railTabsArePermanent === false` would
    // mean rail previews shipped — refuse loudly instead of guessing.
    if (input.railTabsArePermanent === false) {
      throw new Error("side-rail preview tabs are not supported")
    }
    return { area, pinned: true, activate }
  }
  if (input.alwaysPinnedKind) return { area, pinned: true, activate }
  if (intent === "preview") {
    // Previews disabled ⇒ a preview intent upgrades to a permanent tab.
    const previewsEnabled = context.previewTabs === "default"
    return { area, pinned: !previewsEnabled, activate }
  }
  return { area, pinned: true, activate }
}

/** The synthetic bucket every `global`-scoped state reads and writes. */
export const GLOBAL_SCOPE_BUCKET = "__global__"

/**
 * The ONE bucket-key decision for persisted state: stores stop interpreting
 * scope on their own and ask here instead. `workspace` / `session` bucket by
 * the caller-provided key (cwd / session id); `global` collapses onto one
 * bucket, which is exactly the `layoutScope: 'global'` preference semantics.
 */
export function resolveScopeBucket(
  level: ScopeLevel,
  key: string | null | undefined,
): string {
  if (level === "global") return GLOBAL_SCOPE_BUCKET
  const normalized = key?.trim() ?? ""
  return normalized === "" ? GLOBAL_SCOPE_BUCKET : normalized
}
