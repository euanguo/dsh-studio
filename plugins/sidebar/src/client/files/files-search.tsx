/**
 * File-content search for the files browser: the debounced/abortable query
 * hook (`useFileSearch`) plus its presentational rendering (`FilesSearch`).
 * Extracted from files-view.tsx — behavior unchanged except the C12 abort
 * fix: a superseded (aborted) in-flight response can no longer overwrite the
 * latest query's results.
 */
import { useEffect, useState } from 'react'
import type { CapabilitiesScope } from '@dsh-studio/shared/capabilities-api'
import { basename, isUnderRoot, joinPath } from '@dsh-studio/shared/path'
import { EmptyState, Input, LoadingState, ScrollArea } from '@dsh-studio/shared/ui'
import { sidebarApi } from '../sidebar-api.ts'
import { workbenchOpen } from '../open/pipeline.ts'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'

/** File-search debounce (ms) before hitting the runtime. */
const SEARCH_DEBOUNCE_MS = 250
/** File search result rows shown per query. */
const SEARCH_RESULT_LIMIT = 100

export interface FileSearchHit {
  path: string
  line: number
  text: string
}

export interface FileSearchState {
  /** The raw query string (also gates tree-vs-results in the parent). */
  searchQuery: string
  setSearchQuery(query: string): void
  /** Last results, or null when no query is active (tree mode). */
  searchHits: FileSearchHit[] | null
  searchError: string | null
  searching: boolean
}

/** Owns the debounced, abortable file search for one workspace scope. */
export function useFileSearch(
  scope: CapabilitiesScope | null,
  cwd: string | undefined,
): FileSearchState {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<FileSearchHit[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (scope == null || cwd === undefined) return
    if (searchQuery.trim() === '') {
      setSearchHits(null)
      setSearchError(null)
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = window.setTimeout(() => {
      void sidebarApi.fsSearch(scope, searchQuery, false, controller.signal)
        .then(result => {
          // C12: a superseded query aborts its controller; ignore the stale
          // response so the latest hits are never overwritten by slow older ones.
          if (controller.signal.aborted) return
          // D15: distinguish "search unavailable" (result.error) from "no
          // matches" (empty hits, no error).
          setSearchHits(result.hits)
          setSearchError(result.error)
          setSearching(false)
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setSearchHits([])
          setSearchError('search failed')
          setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [cwd, scope, searchQuery])

  return { searchQuery, setSearchQuery, searchHits, searchError, searching }
}

/** Open a search hit in the center (absolute path resolution + preview). */
function openHit(cwd: string | undefined, hit: FileSearchHit): void {
  if (cwd === undefined) return
  const absolute = isUnderRoot(cwd, hit.path) ? hit.path : joinPath(cwd, hit.path)
  workbenchOpen().open({
    kind: 'file',
    target: { cwd, path: absolute },
    intent: 'preview',
    title: basename(hit.path),
  })
}

export interface FilesSearchProps {
  cwd: string | undefined
  query: string
  hits: FileSearchHit[] | null
  error: string | null
  searching: boolean
  onQueryChange(query: string): void
  t: Translate<WorkspaceMessage>
}

/** Search input + results. Renders the input always; results only when a
 *  query is active. The parent decides whether the tree shows alongside. */
export function FilesSearch({
  cwd,
  query,
  hits,
  error,
  searching,
  onQueryChange,
  t,
}: FilesSearchProps): JSX.Element {
  return (
    <>
      <div className={surfaceCss["dsh-studio-files-search"]}>
        <Input
          className={surfaceCss["dsh-studio-files-search-input"]}
          type="search"
          placeholder={t('files.search-placeholder')}
          value={query}
          onChange={event => { onQueryChange(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Escape') onQueryChange('')
          }}
        />
      </div>
      {hits !== null ? (
        <ScrollArea className={`dsh-studio-file-search-results`} viewportClassName="dsh-studio-ui-scroll-viewport-inset">
          {searching ? <LoadingState label={t('files.loading')} /> : null}
          {!searching && error !== null ? (
            <EmptyState title={t('files.search-unavailable')} description={error} />
          ) : null}
          {!searching && error === null && hits.length === 0 ? (
            <EmptyState title={t('files.search-no-matches')} />
          ) : null}
          {hits.slice(0, SEARCH_RESULT_LIMIT).map(hit => (
            <button
              key={`${hit.path}:${hit.line}`}
              type="button"
              className={surfaceCss["dsh-studio-file-search-hit"]}
              onClick={() => { openHit(cwd, hit) }}
            >
              <span className={surfaceCss["dsh-studio-file-search-hit-path"]}>{hit.path}:{hit.line}</span>
              <span className={surfaceCss["dsh-studio-file-search-hit-text"]}>{hit.text}</span>
            </button>
          ))}
        </ScrollArea>
      ) : null}
    </>
  )
}