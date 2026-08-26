/**
 * @dsh-studio/workbench client entry — the pure Cordis kernel plugin.
 *
 * Provides the five kernel services under their FIXED ctx ids:
 *
 *   workbench.registry  SurfaceRegistry   (registry.ts)
 *   workbench.open      OpenPipeline      (open-pipeline.ts)
 *   workbench.layout    LayoutService     (layout.ts)
 *   workbench.state     StateStore        (state.ts)
 *   workbench.events    WorkspaceEvents   (events.ts)
 *
 * These ids are the only cross-plugin surface: consumers `ctx.get` them and
 * type the results through `@dsh-studio/shared/workbench-contracts` — never
 * by importing workbench (or each other's) modules. No DOM, no React; the
 * apply body touches nothing but ctx.reflect.
 */
import { createLayoutService } from './layout.ts'
import { createOpenPipeline } from './open-pipeline.ts'
import { createSurfaceRegistry } from './registry.ts'
import { createMemoryAdapter, createStateStore } from './state.ts'
import { createWorkspaceEvents } from './events.ts'

/** Minimal cordis client context this plugin relies on. */
interface WorkbenchContext {
  reflect: {
    provide(
      name: string,
      value: unknown,
      options?: unknown,
    ): (() => void | Promise<void>) | void
  }
}

/** This plugin consumes no injected services — it only provides. */
export const inject: readonly string[] = []

/**
 * Apply the kernel: construct the five services and provide each under its
 * fixed id. Returns the teardown that removes every provider in reverse
 * registration order.
 */
export function apply(ctx: WorkbenchContext): () => void {
  const registry = createSurfaceRegistry()
  const open = createOpenPipeline(registry)
  const layout = createLayoutService()
  const state = createStateStore(createMemoryAdapter())
  const events = createWorkspaceEvents()

  const disposers: Array<() => void> = []
  const provide = (id: string, value: unknown): void => {
    const dispose = ctx.reflect.provide(id, value)
    if (typeof dispose === 'function') {
      disposers.push(() => {
        void dispose()
      })
    }
  }
  provide('workbench.registry', registry)
  provide('workbench.open', open)
  provide('workbench.layout', layout)
  provide('workbench.state', state)
  provide('workbench.events', events)

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
