/**
 * OpenPipeline implementation — the ONE open entry point (target-design
 * §3.2). Every open funnels through the shared pure decision core
 * `resolveOpenPlan`, keyed by the registry's descriptors, deduped via the
 * shared identity decision, and handed to a single installed dispatcher.
 * Render dispatch is injected so later leaves attach their hosts without
 * this module ever touching theirs. Consumers receive the service only
 * through the `workbench.open` ctx service.
 *
 * No DOM, no React, no cordis imports.
 */
import {
  resolveOpenPlan,
  resolveSurfaceDedupeKey,
  type OpenPlan,
  type OpenPlanInput,
  type OpenPipeline,
  type OpenPipelineAction,
  type PreviewTabsMode,
} from '@dsh-studio/shared/workbench-contracts'
import type { SurfaceRegistry } from '@dsh-studio/shared/workbench-contracts'

type Dispatcher = (action: OpenPipelineAction) => void

export function createOpenPipeline(registry: SurfaceRegistry): OpenPipeline {
  let dispatcher: Dispatcher | undefined
  let previewTabs: PreviewTabsMode = 'default'
  // dedupeKey → plan of every live open. Previews and pins share the map:
  // both occupy a tab until the consumer deactivates them.
  const active = new Map<string, OpenPlan>()

  return {
    open(request) {
      if (dispatcher === undefined) {
        throw new Error('workbench.open has no dispatcher installed')
      }
      const descriptor = registry.require(request.kind)
      // A center spec routes to tabs; rail-only surfaces are permanent rail
      // chips. The shared decision core owns preview/pin/activate semantics.
      const area = descriptor.center !== undefined ? 'center-tabs' : 'side-rail'
      const input: OpenPlanInput = {
        kind: request.kind,
        area,
        railTabsArePermanent: true,
      }
      if (request.intent !== undefined) input.intent = request.intent
      const plan = resolveOpenPlan(input, { previewTabs })
      const dedupeKey = resolveSurfaceDedupeKey(descriptor, request.target ?? {})
      const existing = active.get(dedupeKey)
      if (existing !== undefined) {
        dispatcher({ type: 'activate', plan: existing, dedupeKey, request })
        return existing
      }
      active.set(dedupeKey, plan)
      dispatcher({ type: 'open', plan, dedupeKey, request })
      return plan
    },
    installDispatcher(next) {
      dispatcher = next
      return () => {
        if (dispatcher === next) dispatcher = undefined
      }
    },
    deactivate(dedupeKey) {
      return active.delete(dedupeKey)
    },
    isActive(dedupeKey) {
      return active.has(dedupeKey)
    },
    setPreviewTabs(mode) {
      previewTabs = mode
    },
  }
}
