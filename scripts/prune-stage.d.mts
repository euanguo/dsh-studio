export interface PruneStats {
  declarationBytes: number
  declarationFiles: number
  devDirectoryBytes: number
  srcTreeBytes: number
  variantBytes: number
  storeEntriesRemoved: number
  nodeDietBytes: number
  baggageBytes: number
  documentBytes: number
  debugBytes: number
  buildCacheBytes: number
}

export function pruneRuntimeDependencies(
  runtimeRoot: string,
): Omit<PruneStats, 'nodeDietBytes'>

export function dietNodeRuntime(nodeRuntime: string): Pick<PruneStats, 'nodeDietBytes'>

export const NODE_EXECUTABLE_ENV: 'DSH_STUDIO_NODE_EXECUTABLE'
export const PNPM_ENTRY_ENV: 'DSH_STUDIO_PNPM_ENTRY'

export interface DesktopNodeAdapterFallbacks {
  posixExecutableSuffix: string
  posixPnpmEntrySuffix: string
  posixDshEntrySuffix: string
  windowsExecutable: string
  windowsPnpmEntry: string
  windowsDshEntry: string
}

export function writeDesktopNodeAdapters(
  nodeRuntime: string,
  options: {
    platform: 'darwin' | 'linux' | 'win32'
    fallbacks: DesktopNodeAdapterFallbacks
  },
): { replacedBinary: boolean; removedBytes: number }

export function summarize(stats: PruneStats): string
