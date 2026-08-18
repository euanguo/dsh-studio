import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  registerWebglAtlasTarget,
  resetAllTerminalWebglAtlases,
  resetAndRefreshAllTerminalWebglAtlases,
} from '../plugins/shared/terminal-webgl-atlas.ts'

test('WebglAtlasCoordinator tracks live targets and broadcasts reset/refresh across instances', () => {
  let resetCount1 = 0
  let refreshCount1 = 0
  let resetCount2 = 0
  let refreshCount2 = 0

  const unregister1 = registerWebglAtlasTarget({
    resetWebglTextureAtlas: () => { resetCount1 += 1 },
    refreshTerminal: () => { refreshCount1 += 1 },
  })

  const unregister2 = registerWebglAtlasTarget({
    resetWebglTextureAtlas: () => { resetCount2 += 1 },
    refreshTerminal: () => { refreshCount2 += 1 },
  })

  resetAllTerminalWebglAtlases()
  assert.equal(resetCount1, 1)
  assert.equal(resetCount2, 1)
  assert.equal(refreshCount1, 0)
  assert.equal(refreshCount2, 0)

  resetAndRefreshAllTerminalWebglAtlases()
  assert.equal(resetCount1, 2)
  assert.equal(resetCount2, 2)
  assert.equal(refreshCount1, 1)
  assert.equal(refreshCount2, 1)

  unregister1()
  resetAndRefreshAllTerminalWebglAtlases()
  assert.equal(resetCount1, 2)
  assert.equal(resetCount2, 3)

  unregister2()
})
