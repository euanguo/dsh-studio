/**
 * Workbench kernel contracts — the shared vocabulary surface-opening and
 * state-scoping features converge on (see `docs/design.md` "Workbench 内核契约"
 * / `docs/design.en.md` "Workbench Kernel Contracts").
 *
 * Scope discipline: TYPE-ONLY declarations plus pure decision functions and
 * frozen decision tables. No DOM, no React, no cordis imports — browser-safe
 * and host-safe, so any plugin (and tests) can consume it without crossing
 * the value-import ban. The workbench kernel plugin (@dsh-studio/workbench)
 * owns the runtime state behind these types; this module owns the vocabulary.
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

/* ---------- Workbench kernel vocabulary (leaf-1.1 skeleton) ----------
 *
 * The kernel plugin exposes its services only through the fixed ctx ids
 * `workbench.registry` / `workbench.open` / `workbench.layout` /
 * `workbench.events`; every type below is shared
 * vocabulary those services hand across the ctx boundary. Because plugins
 * must never value-import each other, ALL kernel types live here.
 */

/** Disposer returned by every kernel subscription / registration. */
export type Unsubscribe = () => void

/* ---------- Surface descriptors & SurfaceRegistry ---------- */

/** Whether a surface needs a workspace or session to be meaningful. */
export type ScopeNeed = "workspace" | "session" | null

/**
 * When a surface may take keyboard focus. Activation (visibility) is
 * separate from focus; only an explicit user gesture on the surface may
 * focus it (`'on-explicit'`), and some surfaces never take focus at all.
 */
export type FocusPolicy = "never" | "on-explicit"

/** Right-rail chip declaration of a surface. Rail chips are never previews. */
export interface RailSpec {
  /** Icon identifier rendered by the rail host. */
  icon?: string
  /** Stable sort position among rail chips. */
  order?: number
  /** Only one instance of this surface may exist on the rail. */
  single?: boolean
  /** Explicit identity used to dedupe opens of this surface. */
  dedupeKey?: string
}

/** Center-tab declaration of a surface. */
export interface CenterSpec {
  /** Explicit identity used to dedupe opens of this surface. */
  dedupeKey?: string
}

/** File-class viewer declaration: which extensions this surface renders. */
export interface ViewerSpec {
  /** Lowercase file extensions (without dot) this viewer claims. */
  exts: readonly string[]
  /** Higher wins when several viewers claim the same extension. */
  priority?: number
}

/**
 * The ONE descriptor registered per surface kind — replaces the former
 * tab/viewer/surface-renderer registration trio.
 */
export interface SurfaceDescriptor {
  kind: string
  rail?: RailSpec
  center?: CenterSpec
  viewer?: ViewerSpec
  scopeNeed: ScopeNeed
  previewable: boolean
  focusPolicy: FocusPolicy
}

/** What an open request points at. All fields optional; kinds interpret. */
export interface OpenTarget {
  /** Workspace root the request belongs to. */
  cwd?: string
  /** Resource path for surfaces that open one (file/diff). */
  path?: string
  /** Session id for session-scoped resources. */
  sessionId?: string
}

/**
 * Identity used to dedupe opens of `descriptor` for `target`: an explicit
 * dedupeKey from the rail/center spec wins verbatim; otherwise the identity
 * derives from the kind plus whatever resource the request points at. Pure.
 */
export function resolveSurfaceDedupeKey(
  descriptor: Pick<SurfaceDescriptor, "kind" | "center" | "rail">,
  target: OpenTarget,
): string {
  const declared = descriptor.center?.dedupeKey ?? descriptor.rail?.dedupeKey
  if (declared !== undefined) return declared
  return `${descriptor.kind}:${target.path ?? target.sessionId ?? target.cwd ?? ''}`
}

/** The ONE descriptor table every surface registers into (`ctx.get('workbench.registry')`). */
export interface SurfaceRegistry {
  /**
   * Register one surface kind. Throws on an invalid descriptor or a
   * duplicate kind (a kind has exactly one owner). Returns the unregister
   * disposer.
   */
  register(descriptor: SurfaceDescriptor): () => void
  /** Remove a registration; no-op when the kind is unknown. */
  unregister(kind: string): void
  resolve(kind: string): SurfaceDescriptor | undefined
  /** Resolve or throw — the pipeline and future callers fail loudly. */
  require(kind: string): SurfaceDescriptor
  /** Registered kinds in registration order. */
  kinds(): string[]
  /** The surface declaring `key` as its explicit dedupe key, if any. */
  findByDedupeKey(key: string): SurfaceDescriptor | undefined
}

/* ---------- OpenPipeline ---------- */

export interface OpenRequest {
  kind: string
  target?: OpenTarget
  /** Defaults to `'pin'` via {@linkcode resolveOpenPlan}. */
  intent?: OpenIntent
}

/** What the pipeline hands its dispatcher: exactly one action per open. */
export type OpenPipelineAction =
  | { type: "open"; plan: OpenPlan; dedupeKey: string; request: OpenRequest }
  | { type: "activate"; plan: OpenPlan; dedupeKey: string; request: OpenRequest }

export type OpenPipelineDispatcher = (action: OpenPipelineAction) => void

/** The ONE open entry point (`ctx.get('workbench.open')`). */
export interface OpenPipeline {
  /**
   * Resolve the descriptor, decide the plan, dedupe by identity, and hand
   * exactly one action to the installed dispatcher. Throws on unknown kinds
   * and when no dispatcher is installed — silent opens are never acceptable.
   */
  open(request: OpenRequest): OpenPlan
  /**
   * Install the render dispatcher. Installing again supersedes the previous
   * dispatcher (HMR idempotent); the returned disposer removes it.
   */
  installDispatcher(dispatcher: OpenPipelineDispatcher): () => void
  /** The consumer closed the tab/panel behind `dedupeKey`. */
  deactivate(dedupeKey: string): boolean
  isActive(dedupeKey: string): boolean
  /** Push the user's preview-tab preference (settings domain owns it). */
  setPreviewTabs(mode: PreviewTabsMode): void
}

/* ---------- Layout regions & LayoutService ---------- */

/** The five workbench layout regions. */
export type LayoutRegion =
  | "top-rail"
  | "left-rail"
  | "right-panel"
  | "center-tabs"
  | "overlay"

/** Space a claimant reserves inside a region, in CSS pixels. */
export interface LayoutFootprint {
  width?: number
  height?: number
}

/**
 * Declarative z-index base table — the single arbitration fact that replaces
 * per-plugin comment conventions and magic numbers. Within `overlay`, the
 * LayoutService stacks claimants above this base in claim order.
 */
export const LAYOUT_REGION_Z: Readonly<Record<LayoutRegion, number>> =
  Object.freeze({
    "center-tabs": 0,
    "top-rail": 100,
    "left-rail": 100,
    "right-panel": 100,
    overlay: 9000,
  })

export interface LayoutClaimHandle {
  release(): void
}

export interface LayoutPreviewHandle {
  /** Promote the previewed footprint into the owner's committed claim. */
  commit(): void
  /** Drop the preview without touching the committed claim. */
  discard(): void
}

/** Region ownership + footprint negotiation (`ctx.get('workbench.layout')`). */
export interface LayoutService {
  /**
   * Claim `region` for `owner` with an optional footprint. Re-claiming by
   * the same owner replaces its footprint. The returned handle releases the
   * claim exactly once.
   */
  claim(
    region: LayoutRegion,
    owner: string,
    footprint?: LayoutFootprint,
  ): LayoutClaimHandle
  release(region: LayoutRegion, owner: string): boolean
  /**
   * Two-phase footprint for drag hot paths: the preview participates in
   * negotiation immediately but is not committed until `commit()`.
   * Throws when `owner` has no committed claim yet.
   */
  preview(
    region: LayoutRegion,
    owner: string,
    footprint: LayoutFootprint,
  ): LayoutPreviewHandle
  /**
   * The negotiated footprint of `region`: per dimension the MAXIMUM across
   * every claimant's effective (preview-aware) footprint — the region must
   * reserve enough room for all concurrent claimants at once.
   */
  footprint(region: LayoutRegion): LayoutFootprint
  /**
   * Current top z-index of `region`: the frozen base from
   * {@linkcode LAYOUT_REGION_Z}, raised inside `overlay` by that region's
   * stacking layers (one layer slot per active overlay claimant).
   */
  zIndexFor(region: LayoutRegion): number
  /** Active owners of `region` in claim order. */
  claims(region: LayoutRegion): readonly string[]
}

/* ---------- Workspace events ---------- */

/**
 * Fired when the active SESSION changes. Carries both ids because switching
 * sessions inside the same cwd is NOT a workspace change.
 */
export interface SessionChangedEvent {
  sessionId: string
  cwd: string
}

export interface WorkspaceIdentity {
  cwd: string | null
  sessionId: string | null
}

/** Identity switch source (`ctx.get('workbench.events')`). */
export interface WorkspaceEventsService {
  /**
   * Merge the next identity in. A `cwd` field that differs from the current
   * one fires `onWorkspaceChanged(cwd)`; a `sessionId` field that differs
   * fires `onSessionChanged({ sessionId, cwd })` — with the CURRENT cwd at
   * fire time, and only after a workspace change has been delivered.
   */
  identify(next: { cwd?: string; sessionId?: string }): void
  snapshot(): WorkspaceIdentity
  onWorkspaceChanged(callback: (cwd: string) => void): Unsubscribe
  onSessionChanged(callback: (event: SessionChangedEvent) => void): Unsubscribe
}

/* ---------- identity feed (leaf-1.7) ---------- */

/**
 * Structural face of the runtime's atomic current-session projection
 * (`ISessions.currentProvideInfo`): session selection changes AND
 * provider-roster changes publish through this one observable.
 */
export interface SessionCurrentInfoSnapshot {
  sessionId?: string | undefined
}

export interface SessionCurrentInfoFeed {
  getSnapshot(): SessionCurrentInfoSnapshot
  subscribe(listener: () => void): () => void
}

/**
 * The ONE bridge from the runtime's current-session projection into the
 * kernel events service: every publication is offered to `identify`, which
 * fires the two identity events only when the session/cwd actually changed.
 * `cwdOf` resolves the project for the current session at fire time (the
 * sidebar's roster-fallback derivation); a blank/missing result leaves the
 * kernel's last known cwd in place. Seeds immediately from the current
 * snapshot so late wiring still observes startup identity; returns the
 * unsubscribe disposer.
 */
export function forwardSessionIdentity(
  events: WorkspaceEventsService,
  current: SessionCurrentInfoFeed,
  cwdOf?: (sessionId: string | undefined) => string | undefined,
): Unsubscribe {
  const push = (): void => {
    const sessionId = current.getSnapshot().sessionId
    const rawCwd = cwdOf?.(sessionId)
    const cwd = rawCwd !== undefined && rawCwd.trim() !== '' ? rawCwd : undefined
    events.identify({
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(cwd === undefined ? {} : { cwd }),
    })
  }
  push()
  return current.subscribe(push)
}

/* ---------- State slice definition (persistVia vocabulary) ---------- */

/**
 * Definition of ONE persisted state slice: a single table with a single
 * writer, scoped by `scope`, versioned for non-destructive migration.
 */
export interface StateSliceDefinition<T> {
  /** Host-owned persistence table (ui-chrome table or settings namespace). */
  table: string
  scope: ScopeLevel
  /** Current format version; bumps route stored data through `migrate`. */
  version: number
  /**
   * `'migrate'` (default `'reset'`): data whose stored version differs from
   * {@linkcode StateSliceDefinition.version} is migrated forward via
   * `migrate` instead of dropped. Forward versions can never migrate and
   * always follow the reset half of the policy.
   */
  onIncompatible?: "migrate" | "reset"
  /** Map stored `data` written at `fromVersion` up to the current version. */
  migrate?: (raw: unknown, fromVersion: number) => T
}

/**
 * Persistence seam behind every slice. leaf-1.1 ships the in-memory adapter;
 * later leaves wire this onto the shared `persistVia` facade without changing
 * the slice semantics.
 */
/** Host-owned persistence seam behind a persisted slice. */
export interface StatePersistenceAdapter {
  read(table: string, bucket: string): unknown
  write(table: string, bucket: string, value: unknown): void
}
