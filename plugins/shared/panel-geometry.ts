/**
 * Shell three-pane geometry contract — referenced from Synara's
 * `apps/web-next/src/layout/panel-geometry.ts`.
 *
 * - Left / right are independent pixel budgets.
 * - Center is residual flex space.
 * - Open state is chrome-owned; committed widths are geometry-owned.
 *
 * Only `INSPECTOR_PANEL_BUDGET` survives here, consumed by
 * `sidebar-preferences.ts` for the right-rail width budget; every other
 * geometry/state helper was retired as dead (RD-3/R15).
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

export const INSPECTOR_PANEL_BUDGET: SidePanelBudget = {
  id: LayoutPanelId.Inspector,
  defaultSizePx: 360,
  minSizePx: 220,
  maxSizePx: 640,
  collapseThresholdPx: 180,
}