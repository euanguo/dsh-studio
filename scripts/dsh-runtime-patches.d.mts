export const PATCH_FILES: readonly string[]

export function validatePatchPath(path: string): void
export function validatePatchSource(source: string, patchPath: string): void
export function applyDshRuntimePatches(runtimeRoot: string, projectRoot: string): void
export function checkRuntimePatch(
  packageRoot: string,
  patchPath: string,
): {
  forward: { status: number | null; detail: string }
  reverse: { status: number | null; detail: string } | null
}
