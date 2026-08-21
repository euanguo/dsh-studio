export function parseMacBuildArguments(args: readonly string[]): {
  readonly requestedArch: string | undefined
  readonly channel: 'stable' | 'dev' | undefined
}
