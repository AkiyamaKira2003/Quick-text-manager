'use client'

import { useCallback, useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { t, type MessageKey } from '@/lib/i18n'
import {
  HOTKEY_ACTIONS,
  comboFromKeyboardEvent,
  createHotkeyPatchFromOverrides,
  deriveHotkeyOverridesFromSettings,
  findHotkeyConflict,
  formatComboForDisplay,
  getEffectiveHotkeyBindings,
  isReservedCombo,
} from '@/lib/hotkeys'
import type { HotkeyActionId, HotkeyCategory, Settings } from '@/types'
import { CircleDot, Eraser, Keyboard, ListFilter, RotateCcw, Search } from 'lucide-react'

type HotkeyManagerProps = {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => Promise<void>
}

const CATEGORY_OPTIONS: Array<{ value: 'all' | HotkeyCategory; labelKey: MessageKey }> = [
  { value: 'all', labelKey: 'hk.filterAll' },
  { value: 'core', labelKey: 'hk.filterCore' },
  { value: 'overlay', labelKey: 'hk.filterOverlay' },
  { value: 'text', labelKey: 'hk.filterText' },
]

export default function HotkeyManager({ settings, updateSettings }: HotkeyManagerProps) {
  const language = settings.uiLanguage
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | HotkeyCategory>('all')
  const [recordingActionId, setRecordingActionId] = useState<HotkeyActionId | null>(null)
  const [statusText, setStatusText] = useState('')

  const effectiveBindings = useMemo(() => getEffectiveHotkeyBindings(settings), [settings])
  const effectiveByActionId = useMemo(
    () => new Map(effectiveBindings.map((item) => [item.action.id, item])),
    [effectiveBindings],
  )
  const bindingRecords = useMemo(
    () =>
      effectiveBindings.map((item) => ({
        actionId: item.action.id,
        combo: item.combo,
        context: item.context,
      })),
    [effectiveBindings],
  )

  const filteredActions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return HOTKEY_ACTIONS.filter((action) => {
      if (category !== 'all' && action.category !== category) return false
      if (!normalizedQuery) return true

      const label = t(language, action.labelKey as MessageKey).toLowerCase()
      const description = t(language, action.descriptionKey as MessageKey).toLowerCase()
      const combo = formatComboForDisplay(effectiveByActionId.get(action.id)?.combo ?? action.defaultCombo).toLowerCase()
      return label.includes(normalizedQuery) || description.includes(normalizedQuery) || combo.includes(normalizedQuery)
    })
  }, [category, effectiveByActionId, language, query])

  const applyOverrides = useCallback(
    async (nextOverrides: Settings['hotkeyOverrides']) => {
      const patch = createHotkeyPatchFromOverrides(nextOverrides)
      await updateSettings(patch)
    },
    [updateSettings],
  )

  const resetAction = useCallback(
    async (actionId: HotkeyActionId) => {
      const nextOverrides = deriveHotkeyOverridesFromSettings(settings)
      delete nextOverrides[actionId]
      await applyOverrides(nextOverrides)
      setStatusText(t(language, 'hk.resetDone'))
    },
    [applyOverrides, language, settings],
  )

  const resetCategory = useCallback(
    async (targetCategory: HotkeyCategory) => {
      const nextOverrides = deriveHotkeyOverridesFromSettings(settings)
      for (const action of HOTKEY_ACTIONS) {
        if (action.category !== targetCategory) continue
        delete nextOverrides[action.id]
      }
      await applyOverrides(nextOverrides)
      setStatusText(t(language, 'hk.resetDone'))
    },
    [applyOverrides, language, settings],
  )

  const resetAll = useCallback(async () => {
    await applyOverrides({})
    setStatusText(t(language, 'hk.resetDone'))
  }, [applyOverrides, language])

  useEffect(() => {
    if (!recordingActionId) return

    const action = HOTKEY_ACTIONS.find((item) => item.id === recordingActionId)
    if (!action) return

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setRecordingActionId(null)
        setStatusText('')
        return
      }

      if (event.repeat || event.isComposing) return
      const combo = comboFromKeyboardEvent(event)
      if (!combo) return
      event.preventDefault()

      const formattedCombo = formatComboForDisplay(combo)
      if (isReservedCombo(combo)) {
        setStatusText(t(language, 'hk.errorReserved', { combo: formattedCombo }))
        return
      }

      const conflict = findHotkeyConflict(
        { actionId: action.id, combo, context: action.context },
        bindingRecords,
        action.id,
      )
      if (conflict) {
        const conflictAction = HOTKEY_ACTIONS.find((item) => item.id === conflict.actionId)
        const conflictActionLabel = conflictAction ? t(language, conflictAction.labelKey as MessageKey) : conflict.actionId
        setStatusText(
          t(language, 'hk.errorConflict', {
            combo: formattedCombo,
            action: conflictActionLabel,
            context: t(language, `hk.context${toContextTitle(conflict.context)}` as MessageKey),
          }),
        )
        return
      }

      const nextOverrides = deriveHotkeyOverridesFromSettings(settings)
      const normalizedDefault = formatComboForDisplay(action.defaultCombo)
      if (formattedCombo === normalizedDefault) {
        delete nextOverrides[action.id]
      } else {
        nextOverrides[action.id] = combo
      }

      void applyOverrides(nextOverrides)
      setRecordingActionId(null)
      setStatusText(t(language, 'hk.saved', { combo: formattedCombo }))
    }

    window.addEventListener('keydown', handleKeydown, true)
    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
    }
  }, [applyOverrides, bindingRecords, language, recordingActionId, settings])

  return (
    <section className="rounded-2xl border border-[var(--qt-border)] bg-[var(--qt-surface)] p-4 sm:p-5 qt-elev-medium">
      <header className="qt-stagger-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--qt-fg)]">{t(language, 'hk.title')}</h3>
          <p className="mt-1 text-xs text-[var(--qt-muted)]">{t(language, 'hk.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <IconHoverButton
            onClick={() => void resetAll()}
            icon={<RotateCcw className="size-4" />}
            label={t(language, 'hk.resetAll')}
            className="h-8 min-w-8 border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-xs text-[var(--qt-fg)] hover:border-[var(--qt-primary)]"
          />
          {category !== 'all' ? (
            <IconHoverButton
              onClick={() => void resetCategory(category)}
              icon={<Eraser className="size-4" />}
              label={t(language, 'hk.resetCategory')}
              className="h-8 min-w-8 border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-xs text-[var(--qt-fg)] hover:border-[var(--qt-primary)]"
            />
          ) : null}
        </div>
      </header>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--qt-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(language, 'hk.searchPlaceholder')}
            className="h-9 w-full rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] pl-9 pr-3 text-sm text-[var(--qt-fg)] outline-none focus:border-[var(--qt-primary)]"
          />
        </div>
        <div className="relative">
          <ListFilter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--qt-muted)]" />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as 'all' | HotkeyCategory)}
            className="h-9 w-full rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] pl-9 pr-3 text-sm text-[var(--qt-fg)] outline-none focus:border-[var(--qt-primary)]"
          >
            {CATEGORY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {t(language, item.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {statusText ? (
        <p className="mt-2 rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] px-2.5 py-2 text-xs text-[var(--qt-fg)]">
          {statusText}
        </p>
      ) : null}

      <div className="qt-stagger-sm mt-3 space-y-2">
        {filteredActions.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-3 text-sm text-[var(--qt-muted)]">
            {t(language, 'hk.noResults')}
          </div>
        ) : (
          filteredActions.map((action) => {
            const binding = effectiveByActionId.get(action.id)
            const combo = formatComboForDisplay(binding?.combo ?? action.defaultCombo)
            const contextText = t(language, `hk.context${toContextTitle(action.context)}` as MessageKey)
            const sourceText = binding?.source === 'default' ? t(language, 'hk.sourceDefault') : t(language, 'hk.sourceCustom')
            const isRecording = recordingActionId === action.id

            return (
              <article key={action.id} className="rounded-xl border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--qt-fg)]">{t(language, action.labelKey as MessageKey)}</p>
                    <p className="mt-1 text-xs text-[var(--qt-muted)]">{t(language, action.descriptionKey as MessageKey)}</p>
                    <p className="mt-1 text-[11px] text-[var(--qt-muted)]">
                      {contextText} • {sourceText}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <code className="rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface)] px-2 py-1 text-xs font-semibold text-[var(--qt-fg)]">
                      {combo}
                    </code>
                    <IconHoverButton
                      onClick={() => {
                        setRecordingActionId((current) => (current === action.id ? null : action.id))
                        setStatusText('')
                      }}
                      icon={isRecording ? <CircleDot className="size-4 animate-pulse" /> : <Keyboard className="size-4" />}
                      label={isRecording ? t(language, 'hk.recording') : t(language, 'hk.record')}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        isRecording
                          ? 'border border-[var(--qt-accent)] bg-[var(--qt-accent)] text-[var(--qt-on-accent)]'
                          : 'border border-[var(--qt-border)] bg-[var(--qt-surface)] text-[var(--qt-fg)]'
                      }`}
                    />
                    <IconHoverButton
                      onClick={() => void resetAction(action.id)}
                      icon={<RotateCcw className="size-4" />}
                      label={t(language, 'hk.resetAction')}
                      className="rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface)] px-2 py-1 text-xs font-semibold text-[var(--qt-fg)]"
                    />
                  </div>
                </div>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

function toContextTitle(value: string) {
  if (value === 'global') return 'Global'
  if (value === 'screen') return 'Screen'
  if (value === 'modal') return 'Modal'
  return 'Editor'
}

type IconHoverButtonProps = {
  label: string
  icon: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

function IconHoverButton({ label, icon, className, title, 'aria-label': ariaLabel, ...props }: IconHoverButtonProps) {
  return (
    <button
      {...props}
      title={title ?? label}
      aria-label={ariaLabel ?? label}
      className={`group inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${className ?? ''}`}
    >
      <span className="inline-flex items-center justify-center group-hover:hidden">{icon}</span>
      <span className="hidden group-hover:inline">{label}</span>
    </button>
  )
}

