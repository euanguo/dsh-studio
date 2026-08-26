/**
 * The sidebar side of the workbench OpenPipeline (target-design §3.2): the
 * ONE wiring between the `workbench.open` / `workbench.registry` kernel
 * services and the sidebar's renderers (center-surface store + side-rail
 * tabs). Every open entry in the sidebar funnels its click INTENT through
 * `workbenchOpen().open({ kind, target, intent })` here; the kernel resolves
 * the descriptor, decides the plan via the shared `resolveOpenPlan` core,
 * and hands exactly one action to the dispatcher installed below. The
 * `preview` flag never appears outside this boundary — the dispatcher is the
 * only place a plan becomes store flags.
 *
 * Identity split (single decision each):
 *  - RAIL kinds (`files`, `review`) are permanent single-instance chips: the
 *    kernel's dedupe map tracks their liveness and replays `activate`.
 *  - CENTER kinds are replaceable/pre-existing-capable identities whose
 *    liveness lives in the center-surface store's surface ids. The pipeline
 *    bookkeeping is released right after dispatch (`deactivate`), so every
 *    click applies a FRESH plan — that is what keeps double-click pin
 *    promotion and preview replacement working without a second decision
 *    point.
 *
 * Target conventions (the shared `OpenTarget` vocabulary, interpreted per
 * kind as its contracts allow):
 *   kind             target.path                        extra
 *   file             file path
 *   diff             file path                          unstaged diff
 *   diff-staged      file path                          staged diff
 *   conflict         file path
 *   diff-all         —                                  unstaged section
 *   diff-all-staged  —                                  staged section
 *   commit           commit hash
 *   commit-file      `<hash>::<file path>`
 *   committed        base ref
 *   committed-file   `<base ref>::<file path>`
 *   browser          resource href (when claimed)
 *   terminal         —                                  one new instance/open
 *
 * Focus invariant: activation only changes which tab is VISIBLE — nothing in
 * this module moves keyboard focus. Background intent stays reserved for
 * center kinds (the store does not accept unactivated appends yet); see
 * workbench-contracts.
 */
import { basename } from '@dsh-studio/shared/path'
import type {
  OpenPipeline,
  OpenPipelineAction,
  OpenPlan,
  OpenRequest,
  PreviewTabsMode,
} from '@dsh-studio/shared/workbench-contracts'
import { useCenterSurfaceStore } from '../surfaces/center-surface-store.ts'
import {
  canOpenTerminalInstance,
  touchTerminalInstance,
} from '../runtimes/terminal-runtime.ts'

/**
 * The sidebar open request: the kernel {@linkcode OpenRequest} plus the
 * render-title hint. The field rides through the pipeline structurally (the
 * kernel forwards the request verbatim) and is interpreted ONLY by the
 * sidebar dispatcher below — it is presentation, never a decision input.
 */
export interface SidebarOpenRequest extends OpenRequest {
  /** Tab title hint; each kind derives the same default the store would. */
  title?: string
}

/** The bound pipeline as feature code consumes it. */
export interface WorkbenchOpenService extends OpenPipeline {
  open(request: SidebarOpenRequest): OpenPlan
}

let bound: OpenPipeline | undefined

/**
 * The ONE open entry for sidebar feature code. Throws when the plugin
 * assembly has not connected the kernel services (no silent opens).
 */
export function workbenchOpen(): WorkbenchOpenService {
  if (bound === undefined) {
    throw new Error('sidebar open pipeline is not connected')
  }
  return bound as WorkbenchOpenService
}

/* ---------- dispatcher ---------- */

/** The structural slice of the sidebar service the rail executor needs. */
export interface SidebarOpenHost {
  getSnapshot(): {
    centerPreviewTabs: PreviewTabsMode
    tabs: ReadonlyArray<{ id: string; type: string }>
  }
  subscribe(listener: () => void): () => void
  openTab(tab: { type: string }): void
  activateTab(id: string): void
}

/** Split `<head>::<tail>` composite targets (see the convention table). */
function splitComposite(path: string): [string, string] {
  const at = path.indexOf('::')
  return at === -1 ? [path, ''] : [path.slice(0, at), path.slice(at + 2)]
}

function executeRail(action: OpenPipelineAction, sidebar: SidebarOpenHost): void {
  const type = action.request.kind
  const existing = sidebar.getSnapshot().tabs.find(tab => tab.type === type)
  // Liveness fallback: if the chip's tab vanished outside the pipeline
  // (external close), an `activate` replay degrades to a fresh open instead
  // of dying silently.
  if (existing !== undefined) {
    if (action.plan.activate) sidebar.activateTab(existing.id)
    return
  }
  sidebar.openTab({ type })
}

function executeCenter(action: OpenPipelineAction): void {
  const request = action.request as SidebarOpenRequest
  const target = action.request.target ?? {}
  const cwd = target.cwd ?? '/'
  const path = target.path
  const store = useCenterSurfaceStore.getState()
  const preview = !action.plan.pinned
  switch (action.request.kind) {
    case 'file':
      store.openFile({
        cwd,
        filePath: path ?? '',
        title: request.title?.trim() || basename(path ?? ''),
        preview,
      })
      break
    case 'diff':
    case 'diff-staged':
      store.openDiff({
        cwd,
        filePath: path ?? '',
        staged: action.request.kind === 'diff-staged',
        title: request.title?.trim() || basename(path ?? ''),
        preview,
      })
      break
    case 'conflict':
      store.openConflict({
        cwd,
        filePath: path ?? '',
        title: request.title?.trim() || basename(path ?? ''),
        preview,
      })
      break
    case 'diff-all':
    case 'diff-all-staged': {
      const staged = action.request.kind === 'diff-all-staged'
      store.openDiffAll({
        cwd,
        staged,
        title: request.title?.trim() || (staged ? 'Staged changes' : 'Changes'),
        preview,
      })
      break
    }
    case 'commit':
      store.openCommit({
        cwd,
        hash: path ?? '',
        title: request.title?.trim() || (path ?? '').slice(0, 7),
        preview,
      })
      break
    case 'commit-file': {
      const [hash, filePath] = splitComposite(path ?? '')
      store.openCommitFile({
        cwd,
        hash,
        filePath,
        title: request.title?.trim() || basename(filePath),
        preview,
      })
      break
    }
    case 'committed':
      store.openCommitted({
        cwd,
        baseRef: path ?? '',
        title: request.title?.trim() || (path ?? ''),
        preview,
      })
      break
    case 'committed-file': {
      const [baseRef, filePath] = splitComposite(path ?? '')
      store.openCommitted({
        cwd,
        baseRef,
        ...(filePath === '' ? {} : { filePath }),
        title: request.title?.trim() || basename(filePath),
        preview,
      })
      break
    }
    case 'browser':
      store.openBrowser({
        cwd,
        title: request.title?.trim() || 'Browser',
        ...(path === undefined ? {} : { resource: path }),
        preview,
      })
      break
    case 'terminal': {
      const scope = { cwd }
      if (!canOpenTerminalInstance(scope)) return
      const surface = store.openTerminal({ cwd, title: request.title?.trim() || 'Terminal' })
      touchTerminalInstance(scope, surface.id)
      break
    }
    default:
      throw new Error(`sidebar open dispatcher: unhandled center kind ${action.request.kind}`)
  }
}

function executeAction(action: OpenPipelineAction, sidebar: SidebarOpenHost, open: OpenPipeline): void {
  if (action.plan.area === 'side-rail') {
    executeRail(action, sidebar)
    return
  }
  executeCenter(action)
  // Center identities are replaceable: release the pipeline bookkeeping so
  // the next open applies a fresh plan (see the module header).
  open.deactivate(action.dedupeKey)
}

/* ---------- connection ---------- */

/**
 * Connect the sidebar dispatcher to the kernel open service and push the live
 * preview-tab preference. Surface registration is owned by the sidebar
 * descriptor events, so this connection has no second routing table.
 * Returns the disposer (HMR-safe: the workbench provides fresh services per
 * activation).
 */
export function connectOpenPipeline(options: {
  open: OpenPipeline
  sidebar: SidebarOpenHost
}): () => void {
  bound = options.open
  options.open.setPreviewTabs(options.sidebar.getSnapshot().centerPreviewTabs)
  const stopPreference = options.sidebar.subscribe(() => {
    options.open.setPreviewTabs(options.sidebar.getSnapshot().centerPreviewTabs)
  })
  const uninstallDispatcher = options.open.installDispatcher(action => {
    executeAction(action, options.sidebar, options.open)
  })
  return () => {
    uninstallDispatcher()
    stopPreference()
    if (bound === options.open) bound = undefined
  }
}
