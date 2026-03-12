'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { PromptDialog, type PromptDialogSubmit } from '@/components/PromptDialog'
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { t } from '@/lib/i18n'
import { getKoreanTypingHint } from '@/lib/hangul-ime'
import type { Settings, TextItem } from '@/types'

const VIRTUALIZATION_THRESHOLD = 80
const VIRTUAL_ESTIMATED_ITEM_HEIGHT = 72
const VIRTUAL_ROW_GAP_PX = 8
const VIRTUAL_OVERSCAN_PX = 360
const SEARCH_DEBOUNCE_MS = 120

type Props = {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => Promise<void>
}

export default function TextManager({ settings, updateSettings }: Props) {
  const [queryInput, setQueryInput] = useState('')
  const [queryDebounced, setQueryDebounced] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [virtualVersion, setVirtualVersion] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const pendingScrollTopRef = useRef(0)
  const rowHeightsRef = useRef<Map<number, number>>(new Map())

  const selectedItem = settings.items[settings.selectedIndex]
  const language = settings.uiLanguage
  const deferredQuery = useDeferredValue(queryDebounced)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQueryDebounced(queryInput)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [queryInput])

  const filtered = useMemo(() => {
    const keyword = deferredQuery.trim().toLowerCase()
    return settings.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!keyword) return true
        return (
          item.text.toLowerCase().includes(keyword) ||
          item.note.toLowerCase().includes(keyword) ||
          getKoreanTypingHint(item.text).toLowerCase().includes(keyword)
        )
      })
  }, [deferredQuery, settings.items])

  const useVirtualization = filtered.length >= VIRTUALIZATION_THRESHOLD

  useEffect(() => {
    if (!useVirtualization) return
    const node = listRef.current
    if (!node) return

    const syncViewport = () => {
      setViewportHeight(node.clientHeight)
      pendingScrollTopRef.current = node.scrollTop
      setScrollTop(node.scrollTop)
    }

    syncViewport()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      syncViewport()
      setVirtualVersion((value) => value + 1)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [useVirtualization])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const heights = rowHeightsRef.current
    for (const key of heights.keys()) {
      if (key >= settings.items.length) heights.delete(key)
    }
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
    setVirtualVersion((value) => value + 1)
  }, [])

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

  return (
    <section className="h-full rounded-3xl border-2 border-[var(--qt-border)] bg-[var(--qt-surface)] qt-elev-medium overflow-hidden flex flex-col">
      <header className="px-5 py-4 border-b border-[var(--qt-border)] bg-[var(--qt-surface-soft)]">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[var(--qt-fg)]">{t(language, 'tm.title')}</h2>
          </div>
          <div className="max-w-full text-right">
            <p className="max-w-full truncate text-[11px] text-[var(--qt-muted)]">
              {t(language, 'tm.selectedPrefix')} {selectedItem?.text || t(language, 'main.none')}
            </p>
          </div>
        </div>

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
            disabled={isBusy || !selectedItem}
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
            disabled={isBusy || settings.selectedIndex <= 0}
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
            disabled={isBusy || settings.selectedIndex >= settings.items.length - 1}
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
            className="group h-9 shrink-0 min-w-9 px-3 rounded-lg border border-red-500/45 bg-red-500/15 text-red-200 text-sm font-medium qt-motion qt-motion-fast hover:bg-red-500/25 disabled:opacity-40"
            disabled={isBusy}
          >
            <span className="inline-flex items-center justify-center group-hover:hidden">
              <Trash2 className="size-4" />
            </span>
            <span className="hidden group-hover:inline">{t(language, 'tm.delete')}</span>
          </button>
        </div>

        {actionError ? <p className="mt-2 text-xs text-red-300">{actionError}</p> : null}
      </header>

      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="m-3 rounded-xl border-2 border-[var(--qt-border)] p-4 overflow-y-auto flex-1"
      >
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-4 text-center text-sm text-[var(--qt-muted)]">
            {t(language, 'tm.noResults')}
          </div>
        ) : useVirtualization && virtualWindow ? (
          <div className="relative" style={{ height: `${virtualWindow.totalHeight}px` }}>
            {filtered.slice(virtualWindow.startIndex, virtualWindow.endIndex + 1).map(({ item, index }, localIndex) => {
              const absoluteIndex = virtualWindow.startIndex + localIndex
              const selected = settings.selectedIndex === index
              const koreanTypingHint = getKoreanTypingHint(item.text)
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
                    selected
                      ? 'border-[var(--qt-primary)] bg-[var(--qt-surface-soft)] shadow-[inset_2px_0_0_0_var(--qt-primary)]'
                      : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] hover:border-[var(--qt-primary)]'
                  }`}
                  onClick={() => void updateSettings({ selectedIndex: index })}
                  onDoubleClick={() => setIsEditOpen(true)}
                >
                  <p className="text-[15px] font-semibold text-[var(--qt-fg)] break-words whitespace-pre-wrap">{item.text}</p>
                  {item.note ? <p className="mt-1 text-xs text-[var(--qt-muted)] break-words whitespace-pre-wrap">{item.note}</p> : null}
                  {koreanTypingHint ? (
                    <p className="mt-1 text-[11px] text-cyan-300/85 break-words whitespace-pre-wrap">⌨ {koreanTypingHint}</p>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(({ item, index }) => {
              const selected = settings.selectedIndex === index
              const koreanTypingHint = getKoreanTypingHint(item.text)
              return (
                <article
                  key={`${item.text}-${index}`}
                  className={`group rounded-xl border px-3 py-2.5 cursor-pointer ${
                    selected
                      ? 'border-[var(--qt-primary)] bg-[var(--qt-surface-soft)] shadow-[inset_2px_0_0_0_var(--qt-primary)]'
                      : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] hover:border-[var(--qt-primary)]'
                  }`}
                  onClick={() => void updateSettings({ selectedIndex: index })}
                  onDoubleClick={() => setIsEditOpen(true)}
                >
                  <p className="text-[15px] font-semibold text-[var(--qt-fg)] break-words whitespace-pre-wrap">{item.text}</p>
                  {item.note ? <p className="mt-1 text-xs text-[var(--qt-muted)] break-words whitespace-pre-wrap">{item.note}</p> : null}
                  {koreanTypingHint ? (
                    <p className="mt-1 text-[11px] text-cyan-300/85 break-words whitespace-pre-wrap">⌨ {koreanTypingHint}</p>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </div>

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
