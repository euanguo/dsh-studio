import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * Emit the public contract declarations of the sidebar plugin
 * (`contract.ts` + its type-only dependency graph) into
 * `dist/plugins/sidebar/types/`, so the `./client/contract` export subpath
 * resolves types for external consumers without pulling the browser bundle
 * (the type graph is Node-free by construction — see contract.ts).
 */
export function generateContractTypes(root) {
  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  const entry = join(root, 'plugins', 'sidebar', 'src', 'client', 'contract.ts')
  const rootDir = join(root, 'plugins')
  const out = join(root, 'dist', 'plugins', 'sidebar', 'types')
  const result = spawnSync(tsc, [
    '--ignoreConfig',
    entry,
    '--declaration',
    '--emitDeclarationOnly',
    '--outDir', out,
    '--rootDir', rootDir,
    '--module', 'nodenext',
    '--moduleResolution', 'nodenext',
    '--target', 'es2024',
    '--lib', 'es2024,dom',
    '--jsx', 'react-jsx',
    '--skipLibCheck',
    '--allowImportingTsExtensions',
  ], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`contract type generation failed (tsc exit ${String(result.status)})`)
  }
}
