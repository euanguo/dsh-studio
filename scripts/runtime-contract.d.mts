export interface RuntimeContract {
  readonly runtime: {
    readonly nodeVersion: string
    readonly sizeBudgetBytes: Readonly<Record<'darwin' | 'linux' | 'win32', number>>
    readonly fileBudget: number
  }
  readonly app: {
    readonly sizeBudgetBytes: Readonly<Record<'darwin' | 'linux' | 'win32', number>>
  }
}

export function loadRuntimeContract(
  contractPath?: string,
): RuntimeContract

export function measureTree(rootPath: string): { bytes: number; files: number }

export function assertRuntimeBudget(
  runtimeRoot: string,
  platform: 'darwin' | 'linux' | 'win32',
  contract?: RuntimeContract,
): { bytes: number; files: number; path: string }

export function verifyPackagedApplication(
  packageRoot: string,
  options: {
    platform: 'darwin' | 'linux' | 'win32'
    contract?: RuntimeContract
  },
): { app: { bytes: number; files: number }; runtime: { bytes: number; files: number } }
