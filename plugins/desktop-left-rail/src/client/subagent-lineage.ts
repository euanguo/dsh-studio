/**
 * Vendored pure subagent-lineage aggregation.
 *
 * Source: `@deepseek-ai/dsh-client-runtime` client — `packages/client/runtime/
 * src/client/sessions/subagent-lineage.ts` at the pinned DSH revision
 * `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` (see `dsh-source.json`).
 *
 * Vendored here (with the upstream license notice retained) so the
 * derivation module (`tree.ts`) carries no runtime bare import and stays
 * directly testable under `node --test`; the tree-derivation tests pin the
 * semantics below, so an upstream change that alters them fails loudly.
 */
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'

/** Descendant counts projected for one possible parent session. */
export interface SubagentDescendantSummary {
  /** All descendants connected through uninterrupted subagent-origin lineage. */
  readonly count: number
  /** Descendants whose exact session summary is currently running. */
  readonly runningCount: number
}

/**
 * Index every subagent descendant under each ancestor it reaches through an
 * uninterrupted subagent-origin chain. Cycles fail soft and orphan owners
 * remain harmless map keys until their summaries arrive.
 * @param summaries - retained session summaries keyed by id.
 * @returns descendant totals and running totals keyed by possible parent id.
 */
export function indexSubagentDescendants(
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): ReadonlyMap<SessionId, SubagentDescendantSummary> {
  const indexed = new Map<SessionId, { count: number; runningCount: number }>()
  for (const descendant of Object.values(summaries)) {
    if (descendant.origin !== 'subagent') continue
    const seen = new Set<SessionId>()
    let current: SessionSummary | undefined = descendant
    while (current?.origin === 'subagent' && current.parentId !== undefined
      && !seen.has(current.id)) {
      seen.add(current.id)
      const aggregate = indexed.get(current.parentId)
      if (aggregate === undefined) {
        indexed.set(current.parentId, {
          count: 1,
          runningCount: descendant.running ? 1 : 0,
        })
      } else {
        aggregate.count += 1
        if (descendant.running) aggregate.runningCount += 1
      }
      current = summaries[current.parentId]
    }
  }
  return indexed
}
