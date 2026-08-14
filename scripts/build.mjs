import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { desktopBuilds } from './build-config.mjs'
import './check-sidebar-source.mjs'
import { generatePluginStyles } from './plugin-styles.mjs'

// Plugin CSS Modules → scoped styles.ts (runs before the bundles below).
generatePluginStyles('desktop-left-rail', '[data-oh-dsh-left-rail]')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

await Promise.all(desktopBuilds(root).map(options => build(options)))

copyFileSync(join(root, 'src', 'splash.html'), join(dist, 'splash.html'))
copyFileSync(join(root, 'cordis.patch.yml'), join(dist, 'cordis.patch.yml'))
