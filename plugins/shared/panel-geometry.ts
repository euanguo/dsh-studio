/**
 * Shell three-pane geometry contract — referenced from Synara's
 * `apps/web-next/src/layout/panel-geometry.ts`.
 *
 * - Left / right are independent pixel budgets.
 * - Center is residual flex space.
 * - Open state is chrome-owned; committed widths are geometry-owned.
 */

export const LayoutPanelId = {
  Navigation: "navigation",
  Center: "center",
  Inspector: "inspector",
} as const
export type LayoutPanelIdType = (typeof LayoutPanelId)[keyof typeof LayoutPanelId]

export type SidePanelId = typeof LayoutPanelId.Navigation | typeof LayoutPanelId.Inspector

export type SidePanelBudget = Readonly<{
  id: SidePanelId
  defaultSizePx: number
  minSizePx: number
  maxSizePx: number
  collapseThresholdPx: number
}>

export type CenterPanelBudget = Readonly<{
  id: typeof LayoutPanelId.Center
  minSizePx: number
}>

export const NAVIGATION_PANEL_BUDGET: SidePanelBudget = {
  id: LayoutPanelId.Navigation,
  defaultSizePx: 300,
  minSizePx: 200,
  maxSizePx: 400,
  collapseThresholdPx: 160,
}

export const INSPECTOR_PANEL_BUDGET: SidePanelBudget = {
  id: LayoutPanelId.Inspector,
  defaultSizePx: 360,
  minSizePx: 220,
  maxSizePx: 640,
  collapseThresholdPx: 180,
}

/**
 * The window is the only hard floor (Electron minWidth). Center has no
 * minimum of its own: left max + right max must fit the smallest window so
 * both side panels can open at any window size.
 */
export const CENTER_PANEL_BUDGET: CenterPanelBudget = {
  id: LayoutPanelId.Center,
  minSizePx: 0,
}

export function clampSidePanelWidth(width: number, budget: SidePanelBudget): number {
  if (!Number.isFinite(width)) return budget.defaultSizePx
  return Math.max(budget.minSizePx, Math.min(budget.maxSizePx, Math.round(width)))
}

export function isCollapsedPanelWidth(widthPx: number): boolean {
  return widthPx <= 1
}

export function computeSidePanelResizeWidth(input: {
  side: "left" | "right"
  startWidth: number
  startClientX: number
  clientX: number
}): number {
  const delta = input.clientX - input.startClientX
  return input.side === "left" ? input.startWidth + delta : input.startWidth - delta
}

export function shouldCollapseSidePanel(input: {
  rawWidth: number
  collapseThresholdPx: number
}): boolean {
  return input.rawWidth < input.collapseThresholdPx
}

/**
 * No forced-close: the window minWidth (1200) already guarantees
 * left max + right max fit, so both side panels can always open.
 */
export function resolveViewportForcedOpenState(input: {
  shellWidthPx: number
  leftOpen: boolean
  rightOpen: boolean
  leftWidthPx: number
  rightWidthPx: number
  centerMinPx: number
}): { leftOpen: boolean; rightOpen: boolean } {
  return { leftOpen: input.leftOpen, rightOpen: input.rightOpen }
}
