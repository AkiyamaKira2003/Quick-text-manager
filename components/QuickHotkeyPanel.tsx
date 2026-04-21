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
  isHotkeyActionActive,
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
  const stateByActionId = useMemo(
    () =>
      new Map(
        MAIN_HOTKEY_ROWS.map((row) => [
          row.actionId,
          isHotkeyActionActive(
            {
              appEnabled: settings.appEnabled,
              overlayVisible: settings.overlayVisible,
              overlayInteractive: settings.overlayInteractive,
            },
            row.actionId,
          ),
        ]),
      ),
    [settings.appEnabled, settings.overlayInteractive, settings.overlayVisible],
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
    ;(window as unknown as { __qtHotkeyRecording?: boolean }).__qtHotkeyRecording = !!recordingActionId
    return () => {
      ;(window as unknown as { __qtHotkeyRecording?: boolean }).__qtHotkeyRecording = false
    }
  }, [recordingActionId])

  useEffect(() => {
    if (!recordingActionId) return

    const action = HOTKEY_ACTIONS.find((item) => item.id === recordingActionId)
    if (!action) return

    let pendingModifier: string | null = null

    const applyCombo = (combo: string) => {
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

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        const nextOverrides = deriveHotkeyOverridesFromSettings(settings)
        nextOverrides[action.id] = null
        void updateSettings(createHotkeyPatchFromOverrides(nextOverrides))
        setRecordingActionId(null)
        setBindStatus(t(language, 'hk.saved', { combo: t(language, 'main.none') }))
        return
      }

      if (isTypingTarget(event.target)) return
      if (event.repeat || event.isComposing) return
      const modifierToken = getModifierToken(event)
      if (modifierToken) {
        pendingModifier = modifierToken
        event.preventDefault()
        return
      }
      const combo = comboFromKeyboardEvent(event)
      if (!combo) return
      event.preventDefault()
      pendingModifier = null
      applyCombo(combo)
    }

    const handleKeyup = (event: KeyboardEvent) => {
      if (!pendingModifier) return
      const modifierToken = getModifierToken(event)
      if (!modifierToken) return
      if (modifierToken !== pendingModifier) {
        pendingModifier = null
        return
      }
      pendingModifier = null
      event.preventDefault()
      applyCombo(modifierToken)
    }

    window.addEventListener('keydown', handleKeydown, true)
    window.addEventListener('keyup', handleKeyup, true)
    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
      window.removeEventListener('keyup', handleKeyup, true)
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
            active={stateByActionId.get(row.actionId) ?? false}
            recording={recordingActionId === row.actionId}
            onClick={() => {
              setRecordingActionId((current) => (current === row.actionId ? null : row.actionId))
              setBindStatus('')
            }}
            recordingLabel={t(language, 'hk.recording')}
            activeLabel={t(language, 'main.enabled')}
            inactiveLabel={t(language, 'main.disabled')}
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
  active: boolean
  recording: boolean
  onClick: () => void
  recordingLabel: string
  activeLabel: string
  inactiveLabel: string
}

function BindHotkeyRow({
  label,
  combo,
  active,
  recording,
  onClick,
  recordingLabel,
  activeLabel,
  inactiveLabel,
}: BindHotkeyRowProps) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-2 py-1.5 text-left ${
        active
          ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)]/14 hover:border-[var(--qt-primary)]'
          : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] hover:border-[var(--qt-primary)]'
      }`}
    >
      <div className="min-w-0">
        <p className={`truncate text-sm font-semibold ${active ? 'text-[var(--qt-fg)]' : 'text-[var(--qt-muted)]'}`}>{label}</p>
        <p className={`text-[10px] uppercase tracking-wide ${active ? 'text-emerald-300/90' : 'text-[var(--qt-muted)]'}`}>
          {active ? activeLabel : inactiveLabel}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-300' : 'bg-[var(--qt-muted)]/70'}`} />
        <code
          className={`rounded border px-2 py-0.5 text-xs font-semibold ${
            recording
              ? 'border-[var(--qt-accent)] bg-[var(--qt-accent)] text-[var(--qt-on-accent)]'
              : active
                ? 'border-[var(--qt-primary)] bg-[var(--qt-surface)] text-[var(--qt-fg)]'
                : 'border-[var(--qt-border)] bg-[var(--qt-surface)] text-[var(--qt-fg)]'
          }`}
        >
          {recording ? recordingLabel : combo}
        </code>
      </div>
    </button>
  )
}

function toContextTitle(value: string) {
  if (value === 'global') return 'Global'
  if (value === 'screen') return 'Screen'
  if (value === 'modal') return 'Modal'
  return 'Editor'
}

function getModifierToken(event: KeyboardEvent): 'Shift' | 'Ctrl' | 'Alt' | 'Meta' | null {
  const code = String(event.code || '')
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift'
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl'
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt'
  if (code === 'MetaLeft' || code === 'MetaRight') return 'Meta'
  return null
}
