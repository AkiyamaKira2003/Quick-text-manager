'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  HOTKEY_ACTIONS,
  comboFromKeyboardEvent,
  createHotkeyPatchFromOverrides,
  deriveHotkeyOverridesFromSettings,
  findHotkeyConflict,
  formatComboForDisplay,
  getEffectiveHotkeyBindings,
  isTypingTarget,
  isReservedCombo,
} from '@/lib/hotkeys'
import { t, type MessageKey } from '@/lib/i18n'
import type { HotkeyActionId, Settings } from '@/types'

type MainHotkeyRow = {
  actionId: HotkeyActionId
  labelKey: MessageKey
}

type QuickHotkeyPanelProps = {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => Promise<void>
  className?: string
}

const MAIN_HOTKEY_ROWS: MainHotkeyRow[] = [
  { actionId: 'app.toggle_enabled', labelKey: 'main.hotkeyAppToggleLabel' },
  { actionId: 'overlay.toggle_visibility', labelKey: 'main.hotkeyOverlayToggleLabel' },
  { actionId: 'overlay.toggle_interaction', labelKey: 'main.hotkeyOverlayEditLabel' },
  { actionId: 'text.send_current', labelKey: 'main.hotkeySendLabel' },
  { actionId: 'main.toggle_visibility', labelKey: 'main.hotkeyMainToggleLabel' },
]

export default function QuickHotkeyPanel({ settings, updateSettings, className = '' }: QuickHotkeyPanelProps) {
  const language = settings.uiLanguage
  const [recordingActionId, setRecordingActionId] = useState<HotkeyActionId | null>(null)
  const [bindStatus, setBindStatus] = useState('')

  const effectiveBindings = useMemo(() => getEffectiveHotkeyBindings(settings), [settings])
  const comboByActionId = useMemo(
    () => new Map(effectiveBindings.map((item) => [item.action.id, formatComboForDisplay(item.combo)])),
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

  useEffect(() => {
    if (!recordingActionId) return

    const action = HOTKEY_ACTIONS.find((item) => item.id === recordingActionId)
    if (!action) return

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setRecordingActionId(null)
        setBindStatus('')
        return
      }

      if (isTypingTarget(event.target)) return
      if (event.repeat || event.isComposing) return
      const combo = comboFromKeyboardEvent(event)
      if (!combo) return
      event.preventDefault()

      const formattedCombo = formatComboForDisplay(combo)
      if (isReservedCombo(combo)) {
        setBindStatus(t(language, 'hk.errorReserved', { combo: formattedCombo }))
        return
      }

      const conflict = findHotkeyConflict({ actionId: action.id, combo, context: action.context }, bindingRecords, action.id)
      if (conflict) {
        const conflictAction = HOTKEY_ACTIONS.find((item) => item.id === conflict.actionId)
        const conflictActionLabel = conflictAction ? t(language, conflictAction.labelKey as MessageKey) : conflict.actionId
        setBindStatus(
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

      void updateSettings(createHotkeyPatchFromOverrides(nextOverrides))
      setRecordingActionId(null)
      setBindStatus(t(language, 'hk.saved', { combo: formattedCombo }))
    }

    window.addEventListener('keydown', handleKeydown, true)
    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
    }
  }, [bindingRecords, language, recordingActionId, settings, updateSettings])

  return (
    <section className={`rounded-3xl border-2 border-[var(--qt-border)] bg-[var(--qt-surface)] p-4 qt-elev-medium ${className}`}>
      <p className="text-xs uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'main.hotkeyStatus')}</p>
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {MAIN_HOTKEY_ROWS.map((row) => (
          <BindHotkeyRow
            key={row.actionId}
            label={t(language, row.labelKey)}
            combo={comboByActionId.get(row.actionId) ?? ''}
            recording={recordingActionId === row.actionId}
            onClick={() => {
              setRecordingActionId((current) => (current === row.actionId ? null : row.actionId))
              setBindStatus('')
            }}
            recordingLabel={t(language, 'hk.recording')}
          />
        ))}
      </div>
      {bindStatus ? (
        <p className="mt-2 rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] px-2 py-1.5 text-xs text-[var(--qt-fg)]">
          {bindStatus}
        </p>
      ) : null}
    </section>
  )
}

type BindHotkeyRowProps = {
  label: string
  combo: string
  recording: boolean
  onClick: () => void
  recordingLabel: string
}

function BindHotkeyRow({ label, combo, recording, onClick, recordingLabel }: BindHotkeyRowProps) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] px-2 py-1.5 text-left hover:border-[var(--qt-primary)]"
    >
      <span className="text-[var(--qt-muted)]">{label}</span>
      <code
        className={`rounded border px-2 py-0.5 text-xs font-semibold ${
          recording
            ? 'border-[var(--qt-accent)] bg-[var(--qt-accent)] text-[var(--qt-on-accent)]'
            : 'border-[var(--qt-border)] bg-[var(--qt-surface)] text-[var(--qt-fg)]'
        }`}
      >
        {recording ? recordingLabel : combo}
      </code>
    </button>
  )
}

function toContextTitle(value: string) {
  if (value === 'global') return 'Global'
  if (value === 'screen') return 'Screen'
  if (value === 'modal') return 'Modal'
  return 'Editor'
}
