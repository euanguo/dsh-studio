/**
 * The workbench open pipeline: every center-surface open funnels its click
 * INTENT through `resolveOpenPlan` here instead of hand-computing the
 * `preview` flag, so the user's preview-tab preference is honored in exactly
 * one place.
 *
 * Focus invariant: activation only changes which tab is VISIBLE — no call in
 * this module moves keyboard focus. Background intent is reserved (the store
 * does not accept unactivated appends yet); see workbench-contracts.
 */
import {
  resolveOpenPlan,
  type OpenIntent,
  type PreviewTabsMode,
} from '@dsh-studio/shared/workbench-contracts'
import { useCenterSurfaceStore } from '../surfaces/center-surface-store.ts'

let getPreviewTabs: () => PreviewTabsMode = () => 'default'

/** Bind the pipeline to the live preference (called once from plugin.tsx). */
export function configureOpenPipeline(options: {
  getPreviewTabs(): PreviewTabsMode
}): void {
  getPreviewTabs = options.getPreviewTabs
}

/** Pure decision table (unit-tested): a click intent ⇒ store flags. */
export function planCenterOpen(input: {
  kind: string
  intent: OpenIntent
}, previewTabs: PreviewTabsMode): { preview: boolean; activate: boolean } {
  const plan = resolveOpenPlan({ kind: input.kind, intent: input.intent }, { previewTabs })
  return { preview: !plan.pinned, activate: plan.activate }
}

/**
 * Open a file surface from a click intent. Single click passes `'preview'`
 * (a replaceable tab under `default`, permanent under `disabled`); explicit
 * opens (double click, context menu) pass `'pin'`.
 */
export function openFileSurface(request: {
  cwd: string
  filePath: string
  title: string
  intent?: OpenIntent
  markdownPreview?: boolean
}): void {
  const { preview } = planCenterOpen(
    { kind: 'file', intent: request.intent ?? 'preview' },
    getPreviewTabs(),
  )
  useCenterSurfaceStore.getState().openFile({
    cwd: request.cwd,
    filePath: request.filePath,
    title: request.title,
    preview,
    ...(request.markdownPreview === undefined ? {} : { markdownPreview: request.markdownPreview }),
  })
}

/**
 * Open a diff surface from a click intent. Source-control change rows use
 * this so the preview-tab preference applies uniformly to diffs, conflicts,
 * and plain file opens.
 */
export function openDiffSurface(request: {
  cwd: string
  filePath: string
  staged: boolean
  title: string
  intent?: OpenIntent
}): void {
  const { preview } = planCenterOpen(
    { kind: 'diff', intent: request.intent ?? 'preview' },
    getPreviewTabs(),
  )
  useCenterSurfaceStore.getState().openDiff({
    cwd: request.cwd,
    filePath: request.filePath,
    staged: request.staged,
    title: request.title,
    preview,
  })
}

/** Open a merge-conflict resolver surface from a click intent. */
export function openConflictSurface(request: {
  cwd: string
  filePath: string
  title: string
  intent?: OpenIntent
}): void {
  const { preview } = planCenterOpen(
    { kind: 'conflict', intent: request.intent ?? 'preview' },
    getPreviewTabs(),
  )
  useCenterSurfaceStore.getState().openConflict({
    cwd: request.cwd,
    filePath: request.filePath,
    title: request.title,
    preview,
  })
}

/** Open a diff-all (section-wide) surface from a click intent. */
export function openDiffAllSurface(request: {
  cwd: string
  staged: boolean
  title: string
  intent?: OpenIntent
}): void {
  const { preview } = planCenterOpen(
    { kind: 'diff-all', intent: request.intent ?? 'preview' },
    getPreviewTabs(),
  )
  useCenterSurfaceStore.getState().openDiffAll({
    cwd: request.cwd,
    staged: request.staged,
    title: request.title,
    preview,
  })
}

/** Open a whole-commit diff surface from a click intent. */
export function openCommitSurface(request: {
  cwd: string
  hash: string
  title: string
  intent?: OpenIntent
}): void {
  const { preview } = planCenterOpen(
    { kind: 'commit', intent: request.intent ?? 'preview' },
    getPreviewTabs(),
  )
  useCenterSurfaceStore.getState().openCommit({
    cwd: request.cwd,
    hash: request.hash,
    title: request.title,
    preview,
  })
}

/** Open a single file's diff within a commit from a click intent. */
export function openCommitFileSurface(request: {
  cwd: string
  hash: string
  filePath: string
  title: string
  intent?: OpenIntent
}): void {
  const { preview } = planCenterOpen(
    { kind: 'commit-file', intent: request.intent ?? 'preview' },
    getPreviewTabs(),
  )
  useCenterSurfaceStore.getState().openCommitFile({
    cwd: request.cwd,
    hash: request.hash,
    filePath: request.filePath,
    title: request.title,
    preview,
  })
}

/** Open a committed (base-ref) diff surface from a click intent. */
export function openCommittedSurface(request: {
  cwd: string
  baseRef: string
  filePath?: string
  title: string
  intent?: OpenIntent
}): void {
  const { preview } = planCenterOpen(
    { kind: 'committed', intent: request.intent ?? 'preview' },
    getPreviewTabs(),
  )
  useCenterSurfaceStore.getState().openCommitted({
    cwd: request.cwd,
    baseRef: request.baseRef,
    ...(request.filePath === undefined ? {} : { filePath: request.filePath }),
    title: request.title,
    preview,
  })
}
