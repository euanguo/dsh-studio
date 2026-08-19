import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * Prove the sidebar public contract is consumable by an EXTERNAL plugin:
 * a browser-only consumer that `import type {} from
 * '@dsh-studio/sidebar/client/contract'` (the cordis augmentation trigger) and
 * uses the full descriptor/service vocabulary compiles with `skipLibCheck:
 * false`-style strictness against the built declarations. Any Node type
 * leaking into the contract graph, any broken export subpath, or any
 * contract member that does not typecheck from outside breaks this gate.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const contractTypes = join(
  root,
  'dist', 'plugins', 'sidebar', 'types', 'sidebar', 'src', 'client', 'contract.d.ts',
)

const consumerSource = `import type {} from '@dsh-studio/sidebar/client/contract'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
  SidebarSettingsRenderProps,
  SidebarTabDescriptor,
  SidebarTabSeed,
  SidebarViewerDescriptor,
} from '@dsh-studio/sidebar/client/contract'

const tab: SidebarTabDescriptor = {
  id: 'my-plugin:db',
  title: () => 'Database',
  order: 50,
  single: true,
  available: (_scope, _state) => true,
  urlTarget: url => url.hostname === 'docs.example.com',
  badge: (_scope, _state) => 3,
  onOpen: (_tab, _scope) => {},
  onActivate: (_tab, _scope) => {},
  onClose: (_tab, _scope) => {},
  settings: {
    toggles: [{ key: 'agentTerminalTools', title: 'Tools' }],
    pluginToggles: [{ key: 'pageSize', title: 'Page size', type: 'number', min: 1, max: 100, unit: 'px' }],
    render: (props: SidebarSettingsRenderProps) => null,
  },
  render: (_props: SidebarRenderProps) => null,
}

const viewer: SidebarViewerDescriptor = {
  id: 'my-plugin:csv',
  title: 'CSV',
  exts: ['csv'],
  priority: 10,
  fetchStrategy: 'custom',
  detect: (_path, _head) => false,
  settings: { pluginToggles: [{ key: 'quote', title: 'Quote' }] },
  render: input => null,
}

const service: DesktopSidebarService = null as unknown as DesktopSidebarService
const seed: SidebarTabSeed = { type: 'my-plugin:db', title: 'DB', meta: { page: 1 } }
service.registerTab(tab)
service.registerViewer(viewer)
service.openTab(seed, { sessionId: 's', cwd: '/w' })
service.updatePluginSetting('my-plugin:db', 'pageSize', 25)
`

export function checkConsumerTypes() {
  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-studio-contract-consumer-'))
  try {
    writeFileSync(join(dir, 'consumer.ts'), consumerSource)
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2024',
        lib: ['es2024', 'dom'],
        jsx: 'react-jsx',
        skipLibCheck: false,
        paths: {
          '@dsh-studio/sidebar/client/contract': [contractTypes],
          // The consumer lives in a scratch directory: route react to the
          // repo's type package so the contract's ReactNode resolves.
          react: [join(root, 'plugins', 'sidebar', 'node_modules', '@types', 'react', 'index.d.ts')],
        },
      },
      files: ['consumer.ts'],
    }, null, 2))
    const result = spawnSync(tsc, ['-p', join(dir, 'tsconfig.json')], { stdio: 'inherit' })
    if (result.status !== 0) {
      throw new Error('sidebar contract consumer type check failed')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
