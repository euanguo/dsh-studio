export interface DshDependencyFacts {
  readonly runtime: Record<string, string>
  readonly inject: string[]
  readonly externals: {
    readonly clientBase: string[]
    readonly hostCapabilities: string[]
    readonly runtimeClient: {
      readonly module: string
      readonly plugins: string[]
    }
  }
  readonly typePackages: Record<string, string>
  readonly bundles: Record<string, string[]>
}

export const FACTS_PATH: string
export const repoRoot: string
export const TYPES_SANDBOX_PREFIX: string

export function readDependencyFacts(rootDir?: string): DshDependencyFacts
export function deriveDshSource(facts: DshDependencyFacts): Record<string, string>
export function deriveInject(facts: DshDependencyFacts): string[]
export function resolveTypesEntry(pkgExports: unknown, subpath: string): string | null
export function resolveTypesDeclaration(packagesRoot: string, specifier: string): string | null
export function deriveTsconfigPaths(facts: DshDependencyFacts): Record<string, string[]>
export function isSpecifierCovered(facts: DshDependencyFacts, specifier: string): boolean
export function hostExternalsFor(facts: DshDependencyFacts, pluginDirectory: string): string[]
export function clientBaseExternals(facts: DshDependencyFacts): string[]
export function clientExternalsFor(facts: DshDependencyFacts, pluginDirectory: string): string[]
export function resolveConfiguredTypePaths(
  packagesRoot: string,
  facts: DshDependencyFacts,
): { resolved: Record<string, string>; missing: string[] }
