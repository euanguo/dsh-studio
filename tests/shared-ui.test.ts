import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cn } from '../plugins/shared/ui/cn.ts'

const root = join(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

test('shared UI source layer avoids duplicate official atoms and styling runtimes', () => {
  const sources = [
    read('plugins/shared/ui/card.tsx'),
    read('plugins/shared/ui/field.tsx'),
    read('plugins/shared/ui/separator.tsx'),
    read('plugins/shared/ui/alert.tsx'),
    read('plugins/shared/ui/empty.tsx'),
    read('plugins/shared/ui/skeleton.tsx'),
    read('plugins/shared/ui/slider.tsx'),
    read('plugins/shared/ui/switch.tsx'),
    read('plugins/shared/ui/textarea.tsx'),
  ].join('\n')
  assert.doesNotMatch(sources, /@deepseek-ai\/dsh-client-ui-primitives/)
  assert.doesNotMatch(sources, /radix-ui|lucide-react|tailwindcss/)
})

test('plugin shared composites keep official chrome ownership explicit', () => {
  // status-line and feedback-state compose shared UI atoms; neither may
  // pull the official primitives package directly.
  assert.doesNotMatch(read('plugins/shared/ui/status-line.tsx'), /@deepseek-ai\/dsh-client-ui-primitives/)
  assert.doesNotMatch(read('plugins/shared/ui/feedback-state.tsx'), /@deepseek-ai\/dsh-client-ui-primitives/)
})

test('cn composes conditional classes without a runtime dependency', () => {
  assert.equal(cn('base', false, ['nested', { active: true, hidden: false }]), 'base nested active')
})
