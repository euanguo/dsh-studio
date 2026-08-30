/**
 * Search ownership for the workspace browser. The query outlives the tree and
 * the input (both wide-only) so collapsing never drops an in-progress filter.
 * One `useSearchControl` keeps the state and effects; the presentational
 * `SearchHeaderSlot` and `RailSearchControl` render the wide search input and
 * the collapsed 36px rail control respectively (they share the one state).
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { cn } from '../shim/cn.ts'
import type { SessionSearchResultItem } from '@deepseek-ai/dsh-client-runtime/client'
import { IconCloseFill14, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ToolbarAction } from '@dsh-studio/shared/ui'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { WorkspaceBrowserCss as css } from '../styles.ts'
import type { RemoteSearchState } from '../workspace-browser-views.tsx'

/** Column slide length: rail-search focus waits it out (see source comment). */
export const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
export const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
export const SEARCH_QUERY_MAX_CODE_UNITS = 500

/** Keep controlled input and RPC payload inside the session.search wire contract. */
export function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

export interface SearchControl {
  query: string
  setQuery: (value: string) => void
  normalizedQuery: string
  searchExpanded: boolean
  setSearchExpanded: (value: boolean) => void
  remoteSearch: RemoteSearchState
  searchRoot: RefObject<HTMLDivElement>
  searchInput: RefObject<HTMLInputElement>
  searchOnExpand: boolean
  setSearchOnExpand: (value: boolean) => void
  onOpenSearch: () => void
}

/** Owns the search state and its focus/click-outside/remote-search effects. */
export function useSearchControl({
  wide,
  searchSessions,
  closePicker,
}: {
  wide: boolean
  searchSessions: (query: string, signal: AbortSignal) => Promise<{ items: readonly SessionSearchResultItem[]; hasMore: boolean }>
  closePicker: () => void
}): SearchControl {
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '', status: 'idle', items: [], hasMore: false,
  })
  const searchRoot = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery, status: 'loading', items: [], hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery, status: 'ready', items: result.items, hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery, status: 'error', items: [], hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  const onOpenSearch = (): void => {
    closePicker()
    setSearchExpanded(true)
  }
  return {
    query, setQuery, normalizedQuery, searchExpanded, setSearchExpanded, remoteSearch,
    searchRoot, searchInput, searchOnExpand, setSearchOnExpand, onOpenSearch,
  }
}

export function SearchHeaderSlot({
  control,
  groupBy,
  t,
}: {
  control: SearchControl
  groupBy: 'workspace' | 'flat'
  t: WorkspaceBrowserProps['t']
}): JSX.Element {
  return (
    <>
      {/* Wide search control: opens the input and the section label hides. */}
      <span className={cn(css.sectionLabel, css.wide, control.searchExpanded && css.sectionLabelHidden)}>
        {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
      </span>
      <div className={cn(css.searchSlot, control.searchExpanded && css.searchSlotExpanded)}>
        <div
          ref={control.searchRoot}
          className={cn(css.search, control.searchExpanded && css.searchExpanded)}
          onClick={control.onOpenSearch}
        >
          <ToolbarAction
            variant="ghost"
            className={css.searchButton}
            icon={<IconSearchOutline16 size={control.searchExpanded ? 11 : 14} />}
            label={t('search.sessions.aria')}
            aria-expanded={control.searchExpanded}
            onClick={control.onOpenSearch}
          />
          <input
            ref={control.searchInput}
            className={css.searchInput}
            type="text"
            placeholder={t('search.placeholder')}
            maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
            value={control.query}
            tabIndex={control.searchExpanded ? 0 : -1}
            onChange={(e) => { control.setQuery(sanitizeSearchQuery(e.target.value)) }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              control.setQuery('')
              control.setSearchExpanded(false)
            }}
          />
          {control.searchExpanded && (
            <ToolbarAction
              variant="ghost"
              className={css.clearButton}
              icon={<IconCloseFill14 />}
              label={t('search.clear')}
              onClick={(e) => {
                e.stopPropagation()
                control.setQuery('')
                control.setSearchExpanded(false)
              }}
            />
          )}
        </div>
      </div>
    </>
  )
}

/** The collapsed rail keeps search as its own 36px control. */
export function RailSearchControl({
  control,
  expandSidebar,
  t,
}: {
  control: SearchControl
  expandSidebar: () => void
  t: WorkspaceBrowserProps['t']
}): JSX.Element {
  return (
    <div className={css.search}>
      <ToolbarAction
        variant="ghost"
        className={css.searchButton}
        icon={<IconSearchOutline16 size={18} />}
        label={t('search.sessions.aria')}
        onClick={() => {
          control.setSearchExpanded(true)
          control.setSearchOnExpand(true)
          expandSidebar()
        }}
      />
    </div>
  )
}