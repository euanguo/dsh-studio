import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  boundedStagedPatch,
  renderSourceControlAiTemplate,
  SourceControlAiGenerator,
} from '../plugins/capabilities/src/source-control-ai.ts'

test('source-control AI template renders only the explicit variable allowlist', () => {
  assert.equal(
    renderSourceControlAiTemplate(
      '{repository} {branch} {stagedPatch} {unknown}',
      { repository: 'app', branch: 'main', stagedPatch: 'diff' },
    ),
    'app main diff {unknown}',
  )
})

test('source-control AI bounds a large staged patch with a visible marker', () => {
  assert.equal(boundedStagedPatch('abcdef', 4), 'abcd\n\n[Patch truncated to 4 characters.]')
})

test('source-control AI generator preserves an LLM failure message', async () => {
  const generator = new SourceControlAiGenerator({
    async *stream() {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'API key is missing' } } }
    },
  }, async () => 'diff --git a/file b/file')
  await assert.rejects(
    generator.generate({
      cwd: process.cwd(),
      repository: 'app',
      branch: 'main',
      selection: { provider: 'fake', model: 'fake-model' },
      template: '{stagedPatch}',
    }),
    /API key is missing/,
  )
})

test('source-control AI generator cancels an active stream by cwd', async () => {
  let resolveStream: (() => void) | undefined
  const generator = new SourceControlAiGenerator({
    async *stream(options) {
      await new Promise<void>(resolve => {
        resolveStream = resolve
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      yield { type: 'finish', reason: { kind: 'aborted' } }
    },
  }, async () => 'diff --git a/file b/file')
  const pending = generator.generate({
    cwd: '/fixture',
    repository: 'app',
    branch: 'main',
    selection: { provider: 'fake', model: 'fake-model' },
    template: '{stagedPatch}',
  })
  await new Promise<void>(resolve => {
    const check = (): void => {
      if (resolveStream !== undefined) resolve()
      else setImmediate(check)
    }
    check()
  })
  generator.cancel('/fixture')
  await assert.rejects(pending, /cancelled/)
})

test('source-control AI generator normalizes streamed output into one commit line', async () => {
  const generator = new SourceControlAiGenerator({
    async *stream() {
      yield { type: 'text-delta', text: 'feat: add source control\n\nDetails' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }, async () => 'diff --git a/file b/file')
  const result = await generator.generate({
    cwd: process.cwd(),
    repository: 'app',
    branch: 'main',
    selection: { provider: 'fake', model: 'fake-model' },
    template: '{repository} {branch} {stagedPatch}',
  })
  assert.equal(result.message, 'feat: add source control')
})
