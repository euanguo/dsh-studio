export interface PruneStats {
  declarationBytes: number
  declarationFiles: number
  devDirectoryBytes: number
  srcTreeBytes: number
  variantBytes: number
  storeEntriesRemoved: number
  nodeDietBytes: number
}

export function pruneRuntimeDependencies(
  runtimeRoot: string,
): Omit<PruneStats, 'nodeDietBytes'>

export function dietNodeRuntime(nodeRuntime: string): Pick<PruneStats, 'nodeDietBytes'>

/** Replace the standalone node binary with the Electron shared-Node bridge. */
export function writeDesktopNodeBridge(nodeRuntime: string, targetExpression: string): boolean

export function summarize(stats: PruneStats): string
