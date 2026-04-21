'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { PromptDialog, type PromptDialogSubmit } from '@/components/PromptDialog'
import { ArrowDown, ArrowUp, Copy, ListChecks, Pencil, Plus, Search, Shuffle, StickyNote, Trash2 } from 'lucide-react'
import { t } from '@/lib/i18n'
import { getKoreanTypingHint } from '@/lib/hangul-ime'
import type { Settings, TextItem } from '@/types'

const VIRTUALIZATION_THRESHOLD = 80
const VIRTUAL_ESTIMATED_ITEM_HEIGHT = 72
const VIRTUAL_ROW_GAP_PX = 8
const VIRTUAL_OVERSCAN_PX = 360
const SEARCH_DEBOUNCE_MS = 120
const RESIZE_SYNC_EPSILON_PX = 1

type Props = {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => Promise<void>
  variant?: 'main' | 'overlay'
}

const RESET_EMPTY_ITEM: TextItem = { text: '', note: '' }

export default function TextManager({ settings, updateSettings, variant = 'main' }: Props) {
  const [queryInput, setQueryInput] = useState('')
  const [queryDebounced, setQueryDebounced] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
  const [overlayOnlyWithNote, setOverlayOnlyWithNote] = useState(false)
  const [overlayOnlyWithHint, setOverlayOnlyWithHint] = useState(false)
  const [overlayNewestFirst, setOverlayNewestFirst] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [virtualVersion, setVirtualVersion] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const virtualVersionFrameRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)
  const listWidthRef = useRef(0)
  const rowHeightsRef = useRef<Map<number, number>>(new Map())

  const selectedItem = settings.items[settings.selectedIndex]
  const language = settings.uiLanguage
  const deferredQuery = useDeferredValue(queryDebounced)
  const selectedIndexSet = useMemo(() => new Set(selectedIndexes), [selectedIndexes])
  const isOverlayVariant = variant === 'overlay'

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQueryDebounced(queryInput)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [queryInput])

  useEffect(() => {
    if (!actionNotice) return
    const timer = window.setTimeout(() => {
      setActionNotice('')
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [actionNotice])

  const filtered = useMemo(() => {
    const keyword = deferredQuery.trim().toLowerCase()
    const base = settings.items
      .map((item, index) => ({ item, index, hint: getKoreanTypingHint(item.text) }))
      .filter(({ item, hint }) => {
        if (!keyword) return true
        return (
          item.text.toLowerCase().includes(keyword) ||
          item.note.toLowerCase().includes(keyword) ||
          hint.toLowerCase().includes(keyword)
        )
      })
      .filter(({ item, hint }) => {
        if (!isOverlayVariant) return true
        if (overlayOnlyWithNote && !item.note.trim()) return false
        if (overlayOnlyWithHint && !hint) return false
        return true
      })

    if (!isOverlayVariant || !overlayNewestFirst) return base
    return [...base].reverse()
  }, [deferredQuery, isOverlayVariant, overlayNewestFirst, overlayOnlyWithHint, overlayOnlyWithNote, settings.items])

  const useVirtualization = filtered.length >= VIRTUALIZATION_THRESHOLD

  const scheduleVirtualVersionBump = useCallback(() => {
    if (virtualVersionFrameRef.current !== null) return
    virtualVersionFrameRef.current = window.requestAnimationFrame(() => {
      virtualVersionFrameRef.current = null
      setVirtualVersion((value) => value + 1)
    })
  }, [])

  useEffect(() => {
    if (!useVirtualization) return
    const node = listRef.current
    if (!node) return

    const syncViewport = () => {
      let didInvalidateRows = false
      const nextWidth = node.clientWidth
      if (Math.abs(nextWidth - listWidthRef.current) >= RESIZE_SYNC_EPSILON_PX) {
        listWidthRef.current = nextWidth
        rowHeightsRef.current.clear()
        didInvalidateRows = true
      }
      const nextHeight = node.clientHeight
      setViewportHeight((current) => (Math.abs(current - nextHeight) >= RESIZE_SYNC_EPSILON_PX ? nextHeight : current))
      const nextScrollTop = node.scrollTop
      pendingScrollTopRef.current = nextScrollTop
      setScrollTop((current) => (Math.abs(current - nextScrollTop) >= RESIZE_SYNC_EPSILON_PX ? nextScrollTop : current))
      return didInvalidateRows
    }

    if (syncViewport()) {
      scheduleVirtualVersionBump()
    }
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (syncViewport()) {
        scheduleVirtualVersionBump()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [scheduleVirtualVersionBump, useVirtualization])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
      if (virtualVersionFrameRef.current !== null) {
        window.cancelAnimationFrame(virtualVersionFrameRef.current)
        virtualVersionFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const heights = rowHeightsRef.current
    for (const key of heights.keys()) {
      if (key >= settings.items.length) heights.delete(key)
    }
  }, [settings.items.length])

  useEffect(() => {
    setSelectedIndexes((current) => current.filter((index) => index >= 0 && index < settings.items.length))
  }, [settings.items.length])

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!useVirtualization) return
      pendingScrollTopRef.current = event.currentTarget.scrollTop
      if (scrollRafRef.current !== null) return

      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null
        setScrollTop(pendingScrollTopRef.current)
      })
    },
    [useVirtualization],
  )

  const registerVirtualRow = useCallback((itemIndex: number, element: HTMLElement | null) => {
    if (!element) return
    const nextHeight = Math.ceil(element.getBoundingClientRect().height)
    const previousHeight = rowHeightsRef.current.get(itemIndex) ?? 0
    if (Math.abs(previousHeight - nextHeight) < 1) return
    rowHeightsRef.current.set(itemIndex, nextHeight)
    scheduleVirtualVersionBump()
  }, [scheduleVirtualVersionBump])

  const virtualWindow = useMemo(() => {
    if (!useVirtualization || filtered.length === 0) return null

    const offsets: number[] = new Array(filtered.length)
    const heights: number[] = new Array(filtered.length)
    let cursor = 0

    for (let i = 0; i < filtered.length; i += 1) {
      const itemIndex = filtered[i].index
      const rowHeight = rowHeightsRef.current.get(itemIndex) ?? VIRTUAL_ESTIMATED_ITEM_HEIGHT
      offsets[i] = cursor
      heights[i] = rowHeight
      cursor += rowHeight + VIRTUAL_ROW_GAP_PX
    }

    const totalHeight = Math.max(0, cursor - VIRTUAL_ROW_GAP_PX)
    const viewStart = Math.max(0, scrollTop - VIRTUAL_OVERSCAN_PX)
    const viewEnd = scrollTop + Math.max(1, viewportHeight) + VIRTUAL_OVERSCAN_PX

    let startIndex = 0
    while (startIndex < filtered.length && offsets[startIndex] + heights[startIndex] < viewStart) {
      startIndex += 1
    }

    let endIndex = startIndex
    while (endIndex < filtered.length && offsets[endIndex] < viewEnd) {
      endIndex += 1
    }

    endIndex = Math.max(startIndex, Math.min(filtered.length - 1, endIndex))

    return {
      offsets,
      totalHeight,
      startIndex,
      endIndex,
    }
  }, [filtered, scrollTop, useVirtualization, viewportHeight, virtualVersion])

  const saveAction = async (action: () => Promise<void>) => {
    if (isBusy) return
    setIsBusy(true)
    setActionError('')
    setActionNotice('')
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : t(language, 'tm.actionFailed')
      setActionError(message)
      throw error
    } finally {
      setIsBusy(false)
    }
  }

  const addPhrase = async ({ value, note }: PromptDialogSubmit) => {
    const newItems: TextItem[] = [...settings.items, { text: value, note }]
    await saveAction(async () => {
      await updateSettings({
        items: newItems,
        selectedIndex: newItems.length - 1,
      })
    })
  }

  const editPhrase = async ({ value, note }: PromptDialogSubmit) => {
    const index = settings.selectedIndex
    if (!settings.items[index]) return

    const newItems = [...settings.items]
    newItems[index] = { text: value, note }

    await saveAction(async () => {
      await updateSettings({ items: newItems, selectedIndex: index })
    })
  }

  const deleteSelected = async () => {
    if (isBusy) return
    if (settings.items.length <= 1) {
      setActionError(t(language, 'tm.errorAtLeastOne'))
      return
    }

    if (!confirm(t(language, 'tm.confirmDelete'))) return

    const selectedIndex = settings.selectedIndex
    const newItems = settings.items.filter((_, index) => index !== selectedIndex)
    const nextIndex = Math.max(0, Math.min(selectedIndex, newItems.length - 1))

    await saveAction(async () => {
      await updateSettings({ items: newItems, selectedIndex: nextIndex })
    })
  }

  const clearAllPhrases = async () => {
    if (isBusy) return
    if (!confirm(t(language, 'tm.confirmClearAll'))) return
    await saveAction(async () => {
      await updateSettings({
        items: [{ ...RESET_EMPTY_ITEM }],
        selectedIndex: 0,
      })
      setQueryInput('')
      setQueryDebounced('')
      setSelectedIndexes([])
      setIsMultiSelectMode(false)
      setActionNotice('')
    })
  }

  const toggleMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode((current) => {
      const next = !current
      if (!next) setSelectedIndexes([])
      return next
    })
  }, [])

  const toggleRowSelection = useCallback((index: number) => {
    setSelectedIndexes((current) => {
      const exists = current.includes(index)
      if (exists) return current.filter((value) => value !== index)
      return [...current, index]
    })
  }, [])

  const selectAllFiltered = useCallback(() => {
    setSelectedIndexes(filtered.map(({ index }) => index))
  }, [filtered])

  const clearSelectedRows = useCallback(() => {
    setSelectedIndexes([])
  }, [])

  const deleteMultiSelected = async () => {
    if (isBusy) return
    if (selectedIndexes.length === 0) return
    if (!confirm(t(language, 'tm.confirmDeleteMultiple', { count: selectedIndexes.length }))) return

    const removeSet = new Set(selectedIndexes)
    const nextItems = settings.items.filter((_, index) => !removeSet.has(index))
    const safeItems = nextItems.length > 0 ? nextItems : [{ ...RESET_EMPTY_ITEM }]
    const fallbackIndex = settings.selectedIndex >= safeItems.length ? safeItems.length - 1 : settings.selectedIndex
    const nextSelectedIndex = Math.max(0, fallbackIndex)

    await saveAction(async () => {
      await updateSettings({
        items: safeItems,
        selectedIndex: nextSelectedIndex,
      })
      setSelectedIndexes([])
      if (safeItems.length === 1 && safeItems[0].text === '' && safeItems[0].note === '') {
        setIsMultiSelectMode(false)
      }
    })
  }

  const moveSelected = async (direction: -1 | 1) => {
    if (isBusy) return

    const from = settings.selectedIndex
    const to = from + direction
    if (to < 0 || to >= settings.items.length) return

    const newItems = [...settings.items]
    const [moved] = newItems.splice(from, 1)
    newItems.splice(to, 0, moved)

    await saveAction(async () => {
      await updateSettings({ items: newItems, selectedIndex: to })
    })
  }

  const copySelectedToClipboard = useCallback(async () => {
    if (!selectedItem && selectedIndexes.length === 0) return

    const sourceItems =
      isMultiSelectMode && selectedIndexes.length > 0
        ? settings.items.filter((_item, index) => selectedIndexSet.has(index))
        : selectedItem
          ? [selectedItem]
          : []
    if (sourceItems.length === 0) return

    const payload = sourceItems
      .map((item) => {
        const note = item.note.trim()
        return note ? `${item.text}\n${note}` : item.text
      })
      .join('\n\n')

    try {
      await navigator.clipboard.writeText(payload)
      setActionError('')
      setActionNotice(t(language, 'tm.overlayCopied', { count: sourceItems.length }))
    } catch {
      setActionError(t(language, 'tm.overlayCopyFailed'))
    }
  }, [isMultiSelectMode, language, selectedIndexes.length, selectedIndexSet, selectedItem, settings.items])

  const pickRandomFromFiltered = useCallback(async () => {
    if (filtered.length === 0 || isBusy) return
    const target = filtered[Math.floor(Math.random() * filtered.length)]
    if (!target) return

    try {
      await updateSettings({ selectedIndex: target.index })
      setActionError('')
      setActionNotice(t(language, 'tm.overlayRandomPicked', { index: target.index + 1 }))
    } catch {
      setActionError(t(language, 'tm.actionFailed'))
    }
  }, [filtered, isBusy, language, updateSettings])

  const shellClass = isOverlayVariant
    ? 'h-full min-h-0 qt-overlay-manager-shell qt-elev-medium overflow-hidden flex flex-col'
    : 'h-full rounded-3xl border-2 border-[var(--qt-border)] bg-[var(--qt-surface)] qt-elev-medium overflow-hidden flex flex-col'
  const headerClass = isOverlayVariant
    ? 'qt-overlay-manager-header px-5 py-4 shrink-0'
    : 'px-5 py-4 border-b border-[var(--qt-border)] bg-[var(--qt-surface-soft)]'
  const listClass = isOverlayVariant
    ? 'qt-overlay-manager-list m-3 p-4 pb-10 overflow-y-auto flex-1 min-h-0'
    : 'm-3 rounded-xl border-2 border-[var(--qt-border)] p-4 overflow-y-auto flex-1'

  return (
    <section className={shellClass}>
      <header className={headerClass}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[var(--qt-fg)]">{t(language, 'tm.title')}</h2>
          </div>
          <div className="max-w-full text-right">
            <p className="max-w-full truncate text-[11px] text-[var(--qt-muted)]">
              {isMultiSelectMode
                ? `${t(language, 'tm.multiDeleteSelected', { count: selectedIndexes.length })}`
                : `${t(language, 'tm.selectedPrefix')} ${selectedItem?.text || t(language, 'main.none')}`}
            </p>
          </div>
        </div>

        {isOverlayVariant ? (
          <>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="qt-overlay-manager-stat">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'tm.overlayStatTotal')}</p>
                <p className="text-lg font-semibold text-[var(--qt-fg)]">{settings.items.length}</p>
              </div>
              <div className="qt-overlay-manager-stat">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'tm.overlayStatFiltered')}</p>
                <p className="text-lg font-semibold text-[var(--qt-fg)]">{filtered.length}</p>
              </div>
              <div className="qt-overlay-manager-stat">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'tm.overlayStatPicked')}</p>
                <p className="text-lg font-semibold text-[var(--qt-fg)]">{isMultiSelectMode ? selectedIndexes.length : 1}</p>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setOverlayOnlyWithNote((value) => !value)}
                className={`qt-overlay-manager-chip ${overlayOnlyWithNote ? 'qt-overlay-manager-chip-active' : ''}`}
              >
                <StickyNote className="size-3.5" />
                {t(language, 'tm.overlayFilterNote')}
              </button>
              <button
                onClick={() => setOverlayOnlyWithHint((value) => !value)}
                className={`qt-overlay-manager-chip ${overlayOnlyWithHint ? 'qt-overlay-manager-chip-active' : ''}`}
              >
                ⌨
                {t(language, 'tm.overlayFilterHint')}
              </button>
              <button
                onClick={() => setOverlayNewestFirst((value) => !value)}
                className={`qt-overlay-manager-chip ${overlayNewestFirst ? 'qt-overlay-manager-chip-active' : ''}`}
              >
                {t(language, 'tm.overlayFilterNewest')}
              </button>
              <button
                onClick={() => void copySelectedToClipboard()}
                className="qt-overlay-btn qt-overlay-btn-soft h-8 px-2.5 text-[11px]"
              >
                <Copy className="size-3.5" />
                {t(language, 'tm.overlayCopy')}
              </button>
              <button
                onClick={() => void pickRandomFromFiltered()}
                className="qt-overlay-btn qt-overlay-btn-success h-8 px-2.5 text-[11px]"
              >
                <Shuffle className="size-3.5" />
                {t(language, 'tm.overlayRandom')}
              </button>
            </div>

            <div className="mt-1 text-[10px] text-[var(--qt-muted)]">{t(language, 'tm.overlayContextHint')}</div>
          </>
        ) : null}

        <div className="qt-stagger-sm mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--qt-muted)]" />
            <input
              type="text"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={t(language, 'tm.searchPlaceholder')}
              className="h-9 w-full rounded-lg qt-input pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[var(--qt-primary)]"
            />
          </div>
          <button
            onClick={toggleMultiSelectMode}
            title={isMultiSelectMode ? t(language, 'tm.multiExit') : t(language, 'tm.multiSelect')}
            aria-label={isMultiSelectMode ? t(language, 'tm.multiExit') : t(language, 'tm.multiSelect')}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold qt-motion qt-motion-fast ${
              isMultiSelectMode
                ? 'qt-overlay-btn qt-overlay-btn-brand'
                : 'qt-overlay-btn qt-overlay-btn-soft'
            }`}
          >
            <ListChecks className="size-4" />
            {isMultiSelectMode ? t(language, 'tm.multiExit') : t(language, 'tm.multiSelect')}
          </button>
          <button
            onClick={() => setIsAddOpen(true)}
            disabled={isBusy}
            title={t(language, 'tm.add')}
            aria-label={t(language, 'tm.add')}
            className="group h-9 shrink-0 min-w-9 px-3 rounded-lg text-sm font-medium qt-btn-primary qt-motion qt-motion-fast hover:brightness-105 disabled:opacity-45"
          >
            <span className="inline-flex items-center justify-center group-hover:hidden">
              <Plus className="size-4" />
            </span>
            <span className="hidden group-hover:inline">{t(language, 'tm.add')}</span>
          </button>
          <button
            onClick={() => setIsEditOpen(true)}
            disabled={isBusy || !selectedItem || isMultiSelectMode}
            title={t(language, 'tm.edit')}
            aria-label={t(language, 'tm.edit')}
            className="group h-9 shrink-0 min-w-9 px-3 rounded-lg text-sm font-medium qt-btn-soft qt-motion qt-motion-fast hover:brightness-105 disabled:opacity-45"
          >
            <span className="inline-flex items-center justify-center group-hover:hidden">
              <Pencil className="size-4" />
            </span>
            <span className="hidden group-hover:inline">{t(language, 'tm.edit')}</span>
          </button>
          <button
            onClick={() => void moveSelected(-1)}
            title={t(language, 'tm.up')}
            aria-label={t(language, 'tm.up')}
            className="group h-9 shrink-0 min-w-9 px-3 rounded-lg text-sm font-medium qt-btn-soft qt-motion qt-motion-fast hover:brightness-105 disabled:opacity-40"
            disabled={isBusy || settings.selectedIndex <= 0 || isMultiSelectMode}
          >
            <span className="inline-flex items-center justify-center group-hover:hidden">
              <ArrowUp className="size-4" />
            </span>
            <span className="hidden group-hover:inline">{t(language, 'tm.up')}</span>
          </button>
          <button
            onClick={() => void moveSelected(1)}
            title={t(language, 'tm.down')}
            aria-label={t(language, 'tm.down')}
            className="group h-9 shrink-0 min-w-9 px-3 rounded-lg text-sm font-medium qt-btn-soft qt-motion qt-motion-fast hover:brightness-105 disabled:opacity-40"
            disabled={isBusy || settings.selectedIndex >= settings.items.length - 1 || isMultiSelectMode}
          >
            <span className="inline-flex items-center justify-center group-hover:hidden">
              <ArrowDown className="size-4" />
            </span>
            <span className="hidden group-hover:inline">{t(language, 'tm.down')}</span>
          </button>
          <button
            onClick={() => void deleteSelected()}
            title={t(language, 'tm.delete')}
            aria-label={t(language, 'tm.delete')}
            className="group h-9 shrink-0 min-w-9 px-3 rounded-lg text-sm font-medium qt-overlay-btn qt-overlay-btn-danger disabled:opacity-40"
            disabled={isBusy || isMultiSelectMode}
          >
            <span className="inline-flex items-center justify-center group-hover:hidden">
              <Trash2 className="size-4" />
            </span>
            <span className="hidden group-hover:inline">{t(language, 'tm.delete')}</span>
          </button>
          <button
            onClick={() => void clearAllPhrases()}
            title={t(language, 'tm.clearAll')}
            aria-label={t(language, 'tm.clearAll')}
            className="h-9 shrink-0 rounded-lg px-3 text-sm font-medium qt-overlay-btn qt-overlay-btn-danger disabled:opacity-40"
            disabled={isBusy}
          >
            {t(language, 'tm.clearAll')}
          </button>
          {isMultiSelectMode ? (
            <>
              <button
                onClick={selectAllFiltered}
                className="h-9 shrink-0 rounded-lg px-3 text-xs font-semibold qt-overlay-btn qt-overlay-btn-soft"
                disabled={isBusy || filtered.length === 0}
              >
                {t(language, 'tm.multiSelectAllFiltered')}
              </button>
              <button
                onClick={clearSelectedRows}
                className="h-9 shrink-0 rounded-lg px-3 text-xs font-semibold qt-overlay-btn qt-overlay-btn-soft"
                disabled={isBusy || selectedIndexes.length === 0}
              >
                {t(language, 'tm.multiClearSelection')}
              </button>
              <button
                onClick={() => void deleteMultiSelected()}
                className="h-9 shrink-0 rounded-lg px-3 text-xs font-semibold qt-overlay-btn qt-overlay-btn-danger disabled:opacity-45"
                disabled={isBusy || selectedIndexes.length === 0}
              >
                {t(language, 'tm.multiDeleteSelected', { count: selectedIndexes.length })}
              </button>
            </>
          ) : null}
        </div>

        {actionError ? <p className="qt-overlay-text-error mt-2 text-xs">{actionError}</p> : null}
        {actionNotice ? <p className="qt-overlay-text-success mt-2 text-xs">{actionNotice}</p> : null}
      </header>

      <div
        ref={listRef}
        onScroll={handleListScroll}
        className={listClass}
      >
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-4 text-center text-sm text-[var(--qt-muted)]">
            {t(language, 'tm.noResults')}
          </div>
        ) : useVirtualization && virtualWindow ? (
          <div className="relative" style={{ height: `${virtualWindow.totalHeight}px` }}>
            {filtered.slice(virtualWindow.startIndex, virtualWindow.endIndex + 1).map(({ item, index, hint }, localIndex) => {
              const absoluteIndex = virtualWindow.startIndex + localIndex
              const selected = settings.selectedIndex === index
              const multiSelected = selectedIndexSet.has(index)
              return (
                <article
                  key={`${item.text}-${index}`}
                  ref={(element) => registerVirtualRow(index, element)}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${virtualWindow.offsets[absoluteIndex]}px`,
                  }}
                  className={`group rounded-xl border px-3 py-2.5 cursor-pointer ${
                    isOverlayVariant
                      ? isMultiSelectMode
                        ? multiSelected
                          ? 'qt-overlay-manager-row qt-overlay-manager-row-multi'
                          : 'qt-overlay-manager-row'
                        : selected
                          ? 'qt-overlay-manager-row qt-overlay-manager-row-selected'
                          : 'qt-overlay-manager-row'
                      : isMultiSelectMode
                        ? multiSelected
                          ? 'border-cyan-400/70 bg-cyan-500/14 shadow-[inset_2px_0_0_0_rgba(34,211,238,0.8)]'
                          : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] hover:border-cyan-400/50'
                        : selected
                          ? 'border-[var(--qt-primary)] bg-[var(--qt-surface-soft)] shadow-[inset_2px_0_0_0_var(--qt-primary)]'
                          : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] hover:border-[var(--qt-primary)]'
                  }`}
                  onClick={() => {
                    if (isMultiSelectMode) {
                      toggleRowSelection(index)
                      return
                    }
                    void updateSettings({ selectedIndex: index })
                  }}
                  onDoubleClick={() => {
                    if (isMultiSelectMode) return
                    setIsEditOpen(true)
                  }}
                >
                  {isMultiSelectMode ? (
                    <label className="mb-1 inline-flex items-center gap-2 text-[11px] text-[var(--qt-muted)]">
                      <input
                        type="checkbox"
                        checked={multiSelected}
                        onChange={() => toggleRowSelection(index)}
                        onClick={(event) => event.stopPropagation()}
                        className={`size-4 ${isOverlayVariant ? 'accent-[var(--qt-primary)]' : 'accent-cyan-400'}`}
                      />
                      #{index + 1}
                    </label>
                  ) : null}
                  <p className="text-[15px] font-semibold text-[var(--qt-fg)] break-words whitespace-pre-wrap">{item.text}</p>
                  {item.note ? <p className="mt-1 text-xs text-[var(--qt-muted)] break-words whitespace-pre-wrap">{item.note}</p> : null}
                  {hint ? (
                    <p className={`mt-1 text-[11px] break-words whitespace-pre-wrap ${isOverlayVariant ? 'qt-overlay-manager-hint' : 'text-cyan-300/85'}`}>⌨ {hint}</p>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(({ item, index, hint }) => {
              const selected = settings.selectedIndex === index
              const multiSelected = selectedIndexSet.has(index)
              return (
                <article
                  key={`${item.text}-${index}`}
                  className={`group rounded-xl border px-3 py-2.5 cursor-pointer ${
                    isOverlayVariant
                      ? isMultiSelectMode
                        ? multiSelected
                          ? 'qt-overlay-manager-row qt-overlay-manager-row-multi'
                          : 'qt-overlay-manager-row'
                        : selected
                          ? 'qt-overlay-manager-row qt-overlay-manager-row-selected'
                          : 'qt-overlay-manager-row'
                      : isMultiSelectMode
                        ? multiSelected
                          ? 'border-cyan-400/70 bg-cyan-500/14 shadow-[inset_2px_0_0_0_rgba(34,211,238,0.8)]'
                          : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] hover:border-cyan-400/50'
                        : selected
                          ? 'border-[var(--qt-primary)] bg-[var(--qt-surface-soft)] shadow-[inset_2px_0_0_0_var(--qt-primary)]'
                          : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] hover:border-[var(--qt-primary)]'
                  }`}
                  onClick={() => {
                    if (isMultiSelectMode) {
                      toggleRowSelection(index)
                      return
                    }
                    void updateSettings({ selectedIndex: index })
                  }}
                  onDoubleClick={() => {
                    if (isMultiSelectMode) return
                    setIsEditOpen(true)
                  }}
                >
                  {isMultiSelectMode ? (
                    <label className="mb-1 inline-flex items-center gap-2 text-[11px] text-[var(--qt-muted)]">
                      <input
                        type="checkbox"
                        checked={multiSelected}
                        onChange={() => toggleRowSelection(index)}
                        onClick={(event) => event.stopPropagation()}
                        className={`size-4 ${isOverlayVariant ? 'accent-[var(--qt-primary)]' : 'accent-cyan-400'}`}
                      />
                      #{index + 1}
                    </label>
                  ) : null}
                  <p className="text-[15px] font-semibold text-[var(--qt-fg)] break-words whitespace-pre-wrap">{item.text}</p>
                  {item.note ? <p className="mt-1 text-xs text-[var(--qt-muted)] break-words whitespace-pre-wrap">{item.note}</p> : null}
                  {hint ? (
                    <p className={`mt-1 text-[11px] break-words whitespace-pre-wrap ${isOverlayVariant ? 'qt-overlay-manager-hint' : 'text-cyan-300/85'}`}>⌨ {hint}</p>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </div>

      {isOverlayVariant ? (
        <div className="shrink-0 border-t border-[var(--qt-border)] bg-[color-mix(in_srgb,var(--qt-surface)_86%,transparent)] px-3 py-2 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsAddOpen(true)}
              disabled={isBusy}
              className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold qt-overlay-btn qt-overlay-btn-brand disabled:opacity-45"
            >
              {t(language, 'tm.add')}
            </button>
            <button
              onClick={() => setIsEditOpen(true)}
              disabled={isBusy || !selectedItem || isMultiSelectMode}
              className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold qt-overlay-btn qt-overlay-btn-soft disabled:opacity-45"
            >
              {t(language, 'tm.edit')}
            </button>
            {isMultiSelectMode ? (
              <button
                onClick={() => void deleteMultiSelected()}
                disabled={isBusy || selectedIndexes.length === 0}
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold qt-overlay-btn qt-overlay-btn-danger disabled:opacity-45"
              >
                {t(language, 'tm.multiDeleteSelected', { count: selectedIndexes.length })}
              </button>
            ) : (
              <button
                onClick={() => void deleteSelected()}
                disabled={isBusy}
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold qt-overlay-btn qt-overlay-btn-danger disabled:opacity-45"
              >
                {t(language, 'tm.delete')}
              </button>
            )}
            <button
              onClick={() => void clearAllPhrases()}
              disabled={isBusy}
              className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold qt-overlay-btn qt-overlay-btn-danger disabled:opacity-45"
            >
              {t(language, 'tm.clearAll')}
            </button>
          </div>
        </div>
      ) : null}

      <PromptDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        title={t(language, 'dialog.addTitle')}
        description={t(language, 'dialog.addDescription')}
        label={t(language, 'dialog.phraseLabel')}
        noteLabel={t(language, 'dialog.noteLabel')}
        extraNoteLabel={t(language, 'dialog.koreanTypingLabel')}
        extraNotePlaceholder={t(language, 'dialog.koreanTypingPlaceholder')}
        extraNoteBuilder={getKoreanTypingHint}
        submitLabel={t(language, 'dialog.addSubmit')}
        placeholder={t(language, 'dialog.enterTextPlaceholder')}
        notePlaceholder={t(language, 'dialog.notePlaceholder')}
        cancelLabel={t(language, 'prompt.cancel')}
        savingLabel={t(language, 'prompt.saving')}
        requiredTextError={t(language, 'prompt.requiredText')}
        saveFailedError={t(language, 'prompt.saveFailed')}
        onSubmit={addPhrase}
      />

      <PromptDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        title={t(language, 'dialog.editTitle')}
        description={t(language, 'dialog.editDescription')}
        label={t(language, 'dialog.phraseLabel')}
        noteLabel={t(language, 'dialog.noteLabel')}
        extraNoteLabel={t(language, 'dialog.koreanTypingLabel')}
        extraNotePlaceholder={t(language, 'dialog.koreanTypingPlaceholder')}
        extraNoteBuilder={getKoreanTypingHint}
        defaultValue={selectedItem?.text ?? ''}
        defaultNote={selectedItem?.note ?? ''}
        submitLabel={t(language, 'dialog.saveSubmit')}
        placeholder={t(language, 'dialog.enterTextPlaceholder')}
        notePlaceholder={t(language, 'dialog.notePlaceholder')}
        cancelLabel={t(language, 'prompt.cancel')}
        savingLabel={t(language, 'prompt.saving')}
        requiredTextError={t(language, 'prompt.requiredText')}
        saveFailedError={t(language, 'prompt.saveFailed')}
        onSubmit={editPhrase}
      />
    </section>
  )
}
