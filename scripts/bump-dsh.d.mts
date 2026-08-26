export const repoRoot: string
export const BUMP_STEP_IDS: readonly string[]

export interface BumpConflict {
  readonly step: string
  readonly expected: string
  readonly actual: string
  readonly file: string
  readonly fix: string
}

export function stableStringify(value: unknown): string
export function firstDifferencePath(expected: unknown, actual: unknown, prefix?: string): string
export function evaluateFactsStep(input: {
  configFacts: Record<string, unknown>
  manifest: Record<string, unknown>
}): BumpConflict[]
export function evaluateLockStep(input: {
  version: string
  releaseLockText: string | null
  assemblyLockText: string | null
}): BumpConflict[]
export function evaluatePatchStructureStep(relativePath: string, patchText: string): BumpConflict[]
export function patchApplyConflicts(input: {
  relativePath: string
  forward: { status: number | null; detail: string }
  reverse: { status: number | null; detail: string } | null
  snippet: string
}): BumpConflict[]
export function patchTargetSnippet(clientJsText: string, patchText: string, window?: number): string
export function selectorMarkerFromModuleText(moduleText: string): string | null
export function expectedSelectorMarker(input: {
  spec: { source: string; revision?: string }
  envDshSource?: string
  assemblyHasWebAssets: boolean
}): string | null
export function evaluateSelectorsStep(input: {
  moduleText: string
  expectedMarker: string | null
}): BumpConflict[]
export function evaluateTypesStep(input: {
  sandboxManifest: { devDependencies?: Record<string, string> } | null
  typePackages: Record<string, string>
  version: string
}): BumpConflict[]
export function renderConflictReport(conflicts: readonly BumpConflict[]): string
export function collectPreflightConflicts(
  root?: string,
  spec?: Record<string, unknown>,
): { conflicts: BumpConflict[]; notes: string[] }
