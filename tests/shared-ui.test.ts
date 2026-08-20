import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cn } from '../plugins/shared/ui/cn.ts'

const root = join(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

test('shadcn package config targets the existing DSH theme and shared UI seam', () => {
  const config = JSON.parse(read('plugins/shared/components.json')) as {
    tailwind: { css: string }
    aliases: { ui: string; utils: string }
    iconLibrary: string
  }
  assert.equal(config.tailwind.css, 'theme.css')
  assert.equal(config.aliases.ui, 'ui')
  assert.equal(config.aliases.utils, 'ui/cn')
  assert.equal(config.iconLibrary, 'tabler')

  const packageJson = JSON.parse(read('plugins/shared/package.json')) as {
    exports: Record<string, string>
  }
  assert.equal(packageJson.exports['./ui'], './ui/index.ts')
  assert.equal(packageJson.exports['./ui/card'], './ui/card.tsx')
  assert.equal(packageJson.exports['./ui-styles'], './ui/styles.ts')
  assert.equal(packageJson.exports['./ui.css'], './ui/ui.css')
})

test('shared UI semantic variables resolve through DSW aliases', () => {
  const theme = read('plugins/shared/theme.css')
  for (const token of [
    '--dsh-studio-ui-background',
    '--dsh-studio-ui-foreground',
    '--dsh-studio-ui-card',
    '--dsh-studio-ui-muted',
    '--dsh-studio-ui-border',
    '--dsh-studio-ui-primary',
    '--dsh-studio-ui-destructive',
  ]) {
    assert.match(theme, new RegExp(`${token}:\\s*var\\(--dsw-`))
  }
  assert.match(read('plugins/shared/ui/ui.css'), /--dsh-studio-ui-card/)
})

test('shared UI source layer avoids duplicate official atoms and styling runtimes', () => {
  const sources = [
    read('plugins/shared/ui/card.tsx'),
    read('plugins/shared/ui/field.tsx'),
    read('plugins/shared/ui/separator.tsx'),
    read('plugins/shared/ui/alert.tsx'),
    read('plugins/shared/ui/empty.tsx'),
    read('plugins/shared/ui/skeleton.tsx'),
  ].join('\n')
  assert.doesNotMatch(sources, /@deepseek-ai\/dsh-client-ui-primitives/)
  assert.doesNotMatch(sources, /@base-ui\/react|radix-ui|lucide-react|tailwindcss/)
})

test('cn composes conditional classes without a runtime dependency', () => {
  assert.equal(cn('base', false, ['nested', { active: true, hidden: false }]), 'base nested active')
})

test('legacy shared component paths delegate to the canonical UI source layer', () => {
  assert.match(read('plugins/shared/list-row.tsx'), /from '\.\/ui\/list-row\.tsx'/)
  assert.match(read('plugins/shared/surface-tab.tsx'), /from '\.\/ui\/surface-tab\.tsx'/)
  assert.match(read('plugins/shared/scrollable.tsx'), /from '\.\/ui\/scrollable\.tsx'/)
})
