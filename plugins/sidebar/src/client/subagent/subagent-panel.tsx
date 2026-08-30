/**
 * The Subagent panel: subagent topology (a tree over the sessions list
 * feed's durable parent chain) + the background-jobs list for the current
 * session (output replay + kill through the host `jobs.output` /
 * `jobs.kill` routes).
 *
 * Data sources (all read-only):
 * - the sessions list snapshot: `byId[*].parentId` builds the durable
 *   topology; `running` marks live nodes; `jobsBySession` mirrors the
 *   harness's `session/jobs` push;
 * - `jobs.output` REPLAYS the output the model has read so far (the host
 *   merges the session event log with its live mirror; see
 *   plugins/capabilities/src/jobs-routes.ts).
 *
 * Degradation: a runtime without the subagent/jobs mirrors simply shows an
 * empty topology note + an empty jobs list (the panel never throws).
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import type {
  SessionsService,
  SessionListState,
} from '../client-types.ts'
import type { DesktopSidebarService } from '../contract.ts'
import type { SidebarRuntimeSettingsService } from '../runtime-settings.ts'
import {
  buildSubagentTree,
  jobRowsFor,
  subagentAutoOpenDecision,
  type SubagentTreeNode,
} from './subagent-model.ts'
import {
  SubagentJobsRuntime,
  sidebarJobsTransport,
} from './jobs-runtime.ts'

export interface SubagentPanelProps {
  sidebar: DesktopSidebarService
  sessions: SessionsService
  runtime: SidebarRuntimeSettingsService
  t: Translate<WorkspaceMessage>
}

export function SubagentPanel({
  sidebar,
  sessions,
  runtime,
  t,
}: SubagentPanelProps): JSX.Element {
  // Identity/roster reactivity rides the runtime's current-session
  // projection (leaf-1.7): session selection and provider-roster changes
  // republish it. The roster itself is read fresh at render.
  useSyncExternalStore(
    sessions.currentProvideInfo.subscribe,
    sessions.currentProvideInfo.getSnapshot,
  )
  const list = sessions.list.getSnapshot()
  const prefs = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot).preferences
  const previousRef = useRef<SessionListState | undefined>(undefined)

  // Jobs action state (output replay + kill) lives in a retained runtime keyed
  // by sessionId:jobId so a job in one session never leaks into another (the
  // "dual-key invalidation" requirement). The runtime is per-scope; the panel
  // re-points it when the active session/cwd changes.
  const jobsRuntime = useMemo(() => new SubagentJobsRuntime(sidebarJobsTransport(t)), [t])
  const jobsSnapshot = useSyncExternalStore(jobsRuntime.subscribe, jobsRuntime.getSnapshot)

  // Auto-open: when a new subagent child or a new job appears for the
  // current session (gated by the two toggles), open the sidebar on this
  // page. Job arrivals re-render through the jobs runtime, so its snapshot
  // rides the deps and the decision always reads the freshest roster.
  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = list
    if (previous === undefined) return
    const decision = subagentAutoOpenDecision(previous, list, {
      autoOpenSubagent: prefs.autoOpenSubagent,
      autoOpenJobs: prefs.autoOpenJobs,
    })
    if (decision === null) return
    sidebar.setOpen(true)
    sidebar.activateTab('subagent')
  }, [jobsSnapshot, list, prefs.autoOpenJobs, prefs.autoOpenSubagent, sidebar])

  const current = list.current
  const currentCwd = current === undefined ? undefined : list.byId[current]?.cwd
  const scope = useMemo(
    () => currentCwd === undefined ? null : { cwd: currentCwd },
    [currentCwd],
  )
  const trees = buildSubagentTree(list)
  const jobs = jobRowsFor(list.jobsBySession, current ?? '')
  const hasTopology = trees.length > 0
    || (current !== undefined && list.subagentsByParent?.[current] !== undefined)

  // When the active session/cwd changes, invalidate the previous session's
  // job state (dual-key invalidation on scope + session).
  useEffect(() => {
    jobsRuntime.setScope(scope, current ?? null)
  }, [jobsRuntime, scope, current])

  const readOutput = (jobId: string): void => {
    if (current === undefined) return
    void jobsRuntime.readOutput(current, jobId, t)
  }

  const killJob = (jobId: string): void => {
    if (current === undefined) return
    void jobsRuntime.kill(current, jobId)
  }

  const outputOf = (jobId: string): string | undefined => {
    if (current === undefined) return undefined
    const state = jobsSnapshot.outputs.get(`${current}:${jobId}`)
    if (state === undefined) return undefined
    if (state.status === 'loading') return 'loading'
    if (state.status === 'error') return t('subagent.job-output-failed')
    if (state.status === 'idle') return undefined
    return state.text
  }
  const killingOf = (jobId: string): boolean => {
    if (current === undefined) return false
    return jobsSnapshot.killing.has(`${current}:${jobId}`)
  }

  const refresh = (): void => {
    if (current === undefined) return
    void sessions.refreshSubagents?.(current)
  }

  return (
    <div className={surfaceCss["dsh-studio-subagent-panel"]}>
      <div className={surfaceCss["dsh-studio-subagent-head"]}>
        <strong>{t('subagent.topology')}</strong>
        <Button variant="outline" size="sm" onClick={refresh} disabled={current === undefined}>
          {t('subagent.refresh')}
        </Button>
      </div>
      {!hasTopology ? (
        <p className={surfaceCss["dsh-studio-side-muted"]}>{t('subagent.no-topology')}</p>
      ) : (
        <ul className={surfaceCss["dsh-studio-subagent-tree"]} role="tree">
          {trees.map(node => (
            <TreeNodeRow
              key={node.session.id}
              node={node}
              current={current}
              mainLabel={t('subagent.main-session')}
              onOpen={id => { sessions.open(id) }}
              t={t}
            />
          ))}
          {current !== undefined && list.subagentsByParent?.[current] !== undefined
            ? list.subagentsByParent[current]!.entries.map(entry => (
              entry.kind === 'child' ? (
                <li
                  key={entry.id}
                  className={surfaceCss["dsh-studio-subagent-node"]}
                  role="treeitem"
                  data-activity={entry.activity}
                >
                  <span className={surfaceCss["dsh-studio-subagent-node-dot"]} aria-hidden="true" />
                  <span className={surfaceCss["dsh-studio-subagent-node-main"]}>
                    <strong>{entry.label ?? entry.id}</strong>
                    <code>{entry.id}</code>
                  </span>
                  <span className={surfaceCss["dsh-studio-subagent-node-mode"]}>{entry.mode}</span>
                </li>
              ) : (
                <li key={entry.id} className={`${surfaceCss["dsh-studio-subagent-node"]} is-diagnostic`} role="treeitem">
                  <code>{entry.id}</code>
                  <span>{entry.reason}</span>
                </li>
              )
            ))
            : null}
        </ul>
      )}

      <div className={surfaceCss["dsh-studio-subagent-head"]}>
        <strong>{t('subagent.jobs')}</strong>
      </div>
      {jobs.length === 0 ? (
        <p className={surfaceCss["dsh-studio-side-muted"]}>{t('subagent.no-jobs')}</p>
      ) : (
        <ul className={surfaceCss["dsh-studio-subagent-jobs"]}>
          {jobs.map(job => (
            <li key={job.id} className={surfaceCss["dsh-studio-subagent-job"]} data-status={job.status}>
              <div className={surfaceCss["dsh-studio-subagent-job-main"]}>
                <span className={surfaceCss["dsh-studio-subagent-job-label"]} title={job.label}>
                  {job.label}
                </span>
                <code>{job.id} · {job.kind}</code>
                {job.detail !== undefined
                  ? <small>{job.detail}</small>
                  : null}
              </div>
              <div className={surfaceCss["dsh-studio-subagent-job-actions"]}>
                <span className={surfaceCss["dsh-studio-subagent-job-status"]}>{job.status}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { readOutput(job.id) }}
                  disabled={scope === null}
                >
                  {t('subagent.output')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { killJob(job.id) }}
                  disabled={scope === null || killingOf(job.id)
                    || job.status === 'completed' || job.status === 'killed'
                    || job.status === 'failed'}
                >
                  {t('subagent.kill')}
                </Button>
              </div>
              {outputOf(job.id) !== undefined && (
                <pre className={surfaceCss["dsh-studio-subagent-job-output"]}>
                  {outputOf(job.id) === 'loading' ? t('overlay.loading') : outputOf(job.id)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One topology node row (recursive: children nest under their parent). */
function TreeNodeRow({
  node,
  current,
  mainLabel,
  onOpen,
  t,
}: {
  node: SubagentTreeNode
  current: string | undefined
  mainLabel: string
  onOpen(id: string): void
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const session = node.session
  const isCurrent = session.id === current
  const label = session.displayTitle
    ?? (session.origin === 'subagent' ? session.id : mainLabel)
  return (
    <li className={surfaceCss["dsh-studio-subagent-node"]} role="treeitem" data-current={isCurrent || undefined}>
      <button
        type="button"
        className={surfaceCss["dsh-studio-subagent-node-row"]}
        onClick={() => { onOpen(session.id) }}
      >
        <span
          className={surfaceCss["dsh-studio-subagent-node-dot"]}
          data-running={session.running === true || undefined}
          aria-hidden="true"
        />
        <span className={surfaceCss["dsh-studio-subagent-node-main"]}>
          <strong>{label}</strong>
          <code>{session.id}</code>
        </span>
        {isCurrent ? <span className={surfaceCss["dsh-studio-subagent-node-current"]}>{t('subagent.current')}</span> : null}
      </button>
      {node.children.length > 0 && (
        <ul className={surfaceCss["dsh-studio-subagent-tree"]} role="group">
          {node.children.map(child => (
            <TreeNodeRow
              key={child.session.id}
              node={child}
              current={current}
              mainLabel={mainLabel}
              onOpen={onOpen}
              t={t}
            />
          ))}
        </ul>
      )}
    </li>
  )
}