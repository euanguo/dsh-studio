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
 *   plugins/sidebar-host/src/jobs-routes.ts).
 *
 * Degradation: a runtime without the subagent/jobs mirrors simply shows an
 * empty topology note + an empty jobs list (the panel never throws).
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { sidebarApi } from '../sidebar-api.ts'
import type { Translate } from '../../../../shared/i18n.ts'
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

export interface SubagentPanelProps {
  sidebar: DesktopSidebarService
  sessions: SessionsService
  runtime: SidebarRuntimeSettingsService
  t: Translate<WorkspaceMessage>
}

/** A job's replayed output, per job id ('…' = loading). */
type OutputState = Record<string, string | 'loading'>

export function SubagentPanel({
  sidebar,
  sessions,
  runtime,
  t,
}: SubagentPanelProps): JSX.Element {
  const list = useSyncExternalStore(
    sessions.list.subscribe,
    sessions.list.getSnapshot,
  )
  const prefs = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot).preferences
  const [outputs, setOutputs] = useState<OutputState>({})
  const [killing, setKilling] = useState<Record<string, boolean>>({})
  const previousRef = useRef<SessionListState | undefined>(undefined)

  // Auto-open: when a new subagent child or a new job appears for the
  // current session (gated by the two toggles), open the sidebar on this
  // page.
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
  }, [list, prefs.autoOpenSubagent, prefs.autoOpenJobs, sidebar])

  const current = list.current
  const scope = current === undefined
    ? null
    : {
        sessionId: current,
        ...(list.byId[current]?.cwd === undefined
          ? {}
          : { cwd: list.byId[current]!.cwd }),
      }
  const trees = buildSubagentTree(list)
  const jobs = jobRowsFor(list.jobsBySession, current ?? '')
  const hasTopology = trees.length > 0
    || (current !== undefined && list.subagentsByParent?.[current] !== undefined)

  const readOutput = (jobId: string): void => {
    if (scope === null) return
    setOutputs(prev => ({ ...prev, [jobId]: 'loading' }))
    void sidebarApi.jobOutput(scope, jobId).then(
      result => {
        setOutputs(prev => ({
          ...prev,
          [jobId]: result.text === '' ? t('subagent.job-output-empty') : result.text,
        }))
      },
      () => {
        setOutputs(prev => ({ ...prev, [jobId]: t('subagent.job-output-failed') }))
      },
    )
  }

  const killJob = (jobId: string): void => {
    if (scope === null) return
    setKilling(prev => ({ ...prev, [jobId]: true }))
    void sidebarApi.jobKill(scope, jobId).finally(() => {
      setKilling(prev => ({ ...prev, [jobId]: false }))
    })
  }

  const refresh = (): void => {
    if (current === undefined) return
    void sessions.refreshSubagents?.(current)
  }

  return (
    <div className="oh-dsh-subagent-panel">
      <div className="oh-dsh-subagent-head">
        <strong>{t('subagent.topology')}</strong>
        <button type="button" onClick={refresh} disabled={current === undefined}>
          {t('subagent.refresh')}
        </button>
      </div>
      {!hasTopology ? (
        <p className="oh-dsh-side-muted">{t('subagent.no-topology')}</p>
      ) : (
        <ul className="oh-dsh-subagent-tree" role="tree">
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
                  className="oh-dsh-subagent-node"
                  role="treeitem"
                  data-activity={entry.activity}
                >
                  <span className="oh-dsh-subagent-node-dot" aria-hidden="true" />
                  <span className="oh-dsh-subagent-node-main">
                    <strong>{entry.label ?? entry.id}</strong>
                    <code>{entry.id}</code>
                  </span>
                  <span className="oh-dsh-subagent-node-mode">{entry.mode}</span>
                </li>
              ) : (
                <li key={entry.id} className="oh-dsh-subagent-node is-diagnostic" role="treeitem">
                  <code>{entry.id}</code>
                  <span>{entry.reason}</span>
                </li>
              )
            ))
            : null}
        </ul>
      )}

      <div className="oh-dsh-subagent-head">
        <strong>{t('subagent.jobs')}</strong>
      </div>
      {jobs.length === 0 ? (
        <p className="oh-dsh-side-muted">{t('subagent.no-jobs')}</p>
      ) : (
        <ul className="oh-dsh-subagent-jobs">
          {jobs.map(job => (
            <li key={job.id} className="oh-dsh-subagent-job" data-status={job.status}>
              <div className="oh-dsh-subagent-job-main">
                <span className="oh-dsh-subagent-job-label" title={job.label}>
                  {job.label}
                </span>
                <code>{job.id} · {job.kind}</code>
                {job.detail !== undefined
                  ? <small>{job.detail}</small>
                  : null}
              </div>
              <div className="oh-dsh-subagent-job-actions">
                <span className="oh-dsh-subagent-job-status">{job.status}</span>
                <button
                  type="button"
                  onClick={() => { readOutput(job.id) }}
                  disabled={scope === null}
                >
                  {t('subagent.output')}
                </button>
                <button
                  type="button"
                  onClick={() => { killJob(job.id) }}
                  disabled={scope === null || killing[job.id] === true
                    || job.status === 'completed' || job.status === 'killed'
                    || job.status === 'failed'}
                >
                  {t('subagent.kill')}
                </button>
              </div>
              {outputs[job.id] !== undefined && (
                <pre className="oh-dsh-subagent-job-output">
                  {outputs[job.id] === 'loading' ? t('overlay.loading') : outputs[job.id]}
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
    <li className="oh-dsh-subagent-node" role="treeitem" data-current={isCurrent || undefined}>
      <button
        type="button"
        className="oh-dsh-subagent-node-row"
        onClick={() => { onOpen(session.id) }}
      >
        <span
          className="oh-dsh-subagent-node-dot"
          data-running={session.running === true || undefined}
          aria-hidden="true"
        />
        <span className="oh-dsh-subagent-node-main">
          <strong>{label}</strong>
          <code>{session.id}</code>
        </span>
        {isCurrent ? <span className="oh-dsh-subagent-node-current">{t('subagent.current')}</span> : null}
      </button>
      {node.children.length > 0 && (
        <ul className="oh-dsh-subagent-tree" role="group">
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