'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import Image from 'next/image'
import { useSettings } from '@/hooks/use-settings'
import { t } from '@/lib/i18n'
import type { HotkeyErrorSource, PythonConfigurePayload, PythonEventsResult, PythonInputEvent, Settings } from '@/types'

const API_ENDPOINTS = {
  send: '/api/send',
  inputEvents: '/api/input-events',
  pythonConfig: '/api/python-config',
} as const
const MIN_OFFSET_X_PERCENT = -70
const MAX_OFFSET_X_PERCENT = 70
const MIN_OFFSET_Y_PERCENT = -45
const MAX_OFFSET_Y_PERCENT = 45
const DEFAULT_NOTE_OFFSET_Y_PERCENT = 16
const DEFAULT_ICON_OFFSET_X_PERCENT = -45
const DEFAULT_ICON_OFFSET_Y_PERCENT = -43
const DEFAULT_COUNTER_OFFSET_X_PERCENT = -33
const DEFAULT_COUNTER_OFFSET_Y_PERCENT = -43
const DEFAULT_SNAP_TOLERANCE_PX = 10
const DEFAULT_DRAG_DELAY_MS = 80
const DEFAULT_DRAG_FRICTION_MS = 5
const DEFAULT_PRECISE_DRAG_FACTOR = 0.35
const SNAP_EDGE_X_TARGETS = [MIN_OFFSET_X_PERCENT, MAX_OFFSET_X_PERCENT]
const SNAP_EDGE_Y_TARGETS = [MIN_OFFSET_Y_PERCENT, MAX_OFFSET_Y_PERCENT]
const DRAG_CLICK_TOLERANCE_PX = 2
const INPUT_POLL_FAST_MS = 140
const INPUT_POLL_IDLE_MS = 360
const INPUT_POLL_HIDDEN_MS = 900
const INPUT_POLL_OVERLAY_OFF_MS = 420
const INPUT_POLL_APP_OFF_MS = 240
const INPUT_POLL_DEGRADED_MS = 1400
const STYLE_SAVE_DEBOUNCE_MS = 140
const INDEX_SAVE_DEBOUNCE_MS = 90
const HOTKEY_ERROR_DEBOUNCE_MS = 1800
const SEND_SUCCESS_FEEDBACK_MS = 820
const SEND_ERROR_FEEDBACK_MS = 2400
const ACTION_SUCCESS_FEEDBACK_MS = 900
const ACTION_ERROR_FEEDBACK_MS = 2400
const INPUT_ACTION_DEFAULT_DEBOUNCE_MS = 200
const INPUT_ACTION_TOGGLE_DEBOUNCE_MS = 650
const KEYBOARD_MOVE_STEP_PX = 1
const KEYBOARD_MOVE_FAST_STEP_PX = 5
const WHEEL_BUFFER_DEBOUNCE_MS = 56
const WHEEL_MAX_BATCH_STEPS = 6
const PHRASE_SWITCH_TRANSITION_MS = 120

type SendFeedbackState = 'idle' | 'optimistic' | 'success' | 'error'
type ActionFeedbackState = 'idle' | 'optimistic' | 'success' | 'error'

type ActionFeedback = {
  state: ActionFeedbackState
  message: string
}

type InputEventPayload = PythonInputEvent

type EditableElement = 'text' | 'note' | 'icon' | 'counter'

type Offsets = {
  textX: number
  textY: number
  noteX: number
  noteY: number
  iconX: number
  iconY: number
  counterX: number
  counterY: number
}

type StyleDraft = {
  opacity: number
  noteOpacity: number
  fontSize: number
  noteSize: number
  textColor: string
  noteColor: string
}

type DragSession = {
  target: EditableElement
  seed: Offsets
  startClientX: number
  startClientY: number
  maxTravelPx: number
  activated: boolean
  dragTimerId: number | null
  frictionTimerId: number | null
  lastComputed: Offsets | null
}

type DragUiPatch = {
  draftOffsets?: Offsets | null
  dragTarget?: EditableElement | null
  selectedElement?: EditableElement
  toolboxOpen?: boolean
}

function OverlayPageComponent() {
  const { settings, settingsRef, updateSettings } = useSettings()
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendFeedbackState, setSendFeedbackState] = useState<SendFeedbackState>('idle')
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>({ state: 'idle', message: '' })
  const [dragTarget, setDragTarget] = useState<EditableElement | null>(null)
  const [selectedElement, setSelectedElement] = useState<EditableElement>('text')
  const [hoveredElement, setHoveredElement] = useState<EditableElement | null>(null)
  const [draftOffsets, setDraftOffsets] = useState<Offsets | null>(null)
  const [styleDraft, setStyleDraft] = useState<StyleDraft | null>(null)
  const [displayIndex, setDisplayIndex] = useState(0)
  const [isOpacityEditing, setIsOpacityEditing] = useState(false)
  const [isToolboxOpen, setIsToolboxOpen] = useState(false)

  const overlayRef = useRef<HTMLDivElement | null>(null)
  const toolboxRef = useRef<HTMLDivElement | null>(null)
  const offsetsRef = useRef<Offsets | null>(null)
  const pendingDragUiPatchRef = useRef<DragUiPatch | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const dragSessionRef = useRef<DragSession | null>(null)
  const isSendingRef = useRef(false)
  const lastInputEventIdRef = useRef(0)
  const pollingRef = useRef(false)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const overlayPassThroughRef = useRef<boolean>(true)
  const styleSaveTimerRef = useRef<number | null>(null)
  const pendingStylePatchRef = useRef<Partial<Settings>>({})
  const displayIndexRef = useRef(0)
  const indexSaveTimerRef = useRef<number | null>(null)
  const sendFeedbackTimerRef = useRef<number | null>(null)
  const actionFeedbackTimerRef = useRef<number | null>(null)
  const wheelFlushTimerRef = useRef<number | null>(null)
  const switchTransitionTimerRef = useRef<number | null>(null)
  const sendCurrentRef = useRef<() => Promise<void>>(async () => undefined)
  const wheelBufferRef = useRef(0)
  const queuedSwitchStepsRef = useRef(0)
  const switchAnimatingRef = useRef(false)
  const pythonSyncTimerRef = useRef<number | null>(null)
  const pythonSyncSignatureRef = useRef('')
  const lastInputActionTriggerAtRef = useRef<Record<string, number>>({})
  const lastHotkeyErrorRef = useRef<{ source: HotkeyErrorSource; message: string; at: number }>({
    source: 'unknown',
    message: '',
    at: 0,
  })
  const itemCount = settings?.items.length ?? 0
  const activeSettingsIndex = itemCount > 0 ? Math.max(0, Math.min(displayIndex, itemCount - 1)) : 0
  const activeSettingsItem = settings ? settings.items[activeSettingsIndex] ?? null : null
  const activeItemText = (activeSettingsItem?.text ?? '').trim()
  const activeItemNote = activeSettingsItem?.note ?? ''
  const sendHotkey = settings?.sendHotkey.trim() ?? ''
  const appToggleHotkey = settings?.appToggleHotkey.trim() ?? ''
  const overlayToggleHotkey = settings?.overlayToggleHotkey.trim() ?? ''
  const mainToggleHotkey = settings?.mainToggleHotkey.trim() ?? ''
  const overlayEditHotkey = settings?.overlayEditHotkey.trim() ?? ''
  const appEnabled = settings?.appEnabled ?? true

  const reportSendTelemetry = useCallback((payload: { success: boolean; latencyMs: number; error?: string }) => {
    if (!window.electronAPI?.reportSendTelemetry) return
    void window.electronAPI.reportSendTelemetry(payload).catch(() => {
      // Keep overlay flow independent from telemetry IPC.
    })
  }, [])

  const reportHotkeyError = useCallback((source: HotkeyErrorSource, message: string) => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage) return

    const now = Date.now()
    const previous = lastHotkeyErrorRef.current
    if (previous.source === source && previous.message === normalizedMessage && now - previous.at < HOTKEY_ERROR_DEBOUNCE_MS) {
      return
    }

    lastHotkeyErrorRef.current = { source, message: normalizedMessage, at: now }

    if (!window.electronAPI?.reportHotkeyError) return
    void window.electronAPI.reportHotkeyError({ source, message: normalizedMessage }).catch(() => {
      // Keep overlay flow independent from telemetry IPC.
    })
  }, [])

  const clearSendFeedbackTimer = useCallback(() => {
    if (sendFeedbackTimerRef.current === null) return
    window.clearTimeout(sendFeedbackTimerRef.current)
    sendFeedbackTimerRef.current = null
  }, [])

  const scheduleSendFeedbackReset = useCallback(
    (delayMs: number) => {
      clearSendFeedbackTimer()
      sendFeedbackTimerRef.current = window.setTimeout(() => {
        sendFeedbackTimerRef.current = null
        setSendFeedbackState('idle')
        setSendError('')
      }, delayMs)
    },
    [clearSendFeedbackTimer],
  )

  const clearActionFeedbackTimer = useCallback(() => {
    if (actionFeedbackTimerRef.current === null) return
    window.clearTimeout(actionFeedbackTimerRef.current)
    actionFeedbackTimerRef.current = null
  }, [])

  const scheduleActionFeedbackReset = useCallback(
    (delayMs: number) => {
      clearActionFeedbackTimer()
      actionFeedbackTimerRef.current = window.setTimeout(() => {
        actionFeedbackTimerRef.current = null
        setActionFeedback({ state: 'idle', message: '' })
      }, delayMs)
    },
    [clearActionFeedbackTimer],
  )

  const showActionFeedback = useCallback(
    (state: Exclude<ActionFeedbackState, 'idle'>, message: string, delayMs?: number) => {
      const normalized = message.trim()
      if (!normalized) return
      clearActionFeedbackTimer()
      setActionFeedback({ state, message: normalized })

      if (state === 'optimistic') return
      scheduleActionFeedbackReset(delayMs ?? (state === 'error' ? ACTION_ERROR_FEEDBACK_MS : ACTION_SUCCESS_FEEDBACK_MS))
    },
    [clearActionFeedbackTimer, scheduleActionFeedbackReset],
  )

  const clearWheelFlushTimer = useCallback(() => {
    if (wheelFlushTimerRef.current === null) return
    window.clearTimeout(wheelFlushTimerRef.current)
    wheelFlushTimerRef.current = null
  }, [])

  const clearSwitchTransitionTimer = useCallback(() => {
    if (switchTransitionTimerRef.current === null) return
    window.clearTimeout(switchTransitionTimerRef.current)
    switchTransitionTimerRef.current = null
  }, [])

  const queueDragUiPatch = useCallback((patch: DragUiPatch) => {
    const current = pendingDragUiPatchRef.current ?? {}
    pendingDragUiPatchRef.current = { ...current, ...patch }
    if (dragFrameRef.current !== null) return

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null
      const pending = pendingDragUiPatchRef.current
      pendingDragUiPatchRef.current = null
      if (!pending) return

      if ('selectedElement' in pending) {
        setSelectedElement((previous) => (previous === pending.selectedElement ? previous : pending.selectedElement ?? previous))
      }

      if ('toolboxOpen' in pending) {
        setIsToolboxOpen((previous) => (previous === !!pending.toolboxOpen ? previous : !!pending.toolboxOpen))
      }

      if ('dragTarget' in pending) {
        setDragTarget((previous) => (previous === (pending.dragTarget ?? null) ? previous : (pending.dragTarget ?? null)))
      }

      if ('draftOffsets' in pending) {
        const nextOffsets = pending.draftOffsets ?? null
        setDraftOffsets((previous) => {
          if (!nextOffsets) return previous === null ? previous : null
          return previous && isSameOffsets(previous, nextOffsets) ? previous : nextOffsets
        })
      }
    })
  }, [])

  const queueDraftOffsets = useCallback(
    (next: Offsets) => {
      queueDragUiPatch({ draftOffsets: next })
    },
    [queueDragUiPatch],
  )

  const setOverlayPassThrough = useCallback((passThrough: boolean) => {
    if (overlayPassThroughRef.current === passThrough) return
    overlayPassThroughRef.current = passThrough
    if (!window.electronAPI?.setOverlayMousePassThrough) return
    void window.electronAPI.setOverlayMousePassThrough(passThrough).catch(() => {
      // Keep renderer responsive even if Electron IPC fails.
    })
  }, [])

  const getLiveOffsets = useCallback((): Offsets => {
    const current = settingsRef.current
    const fallback: Offsets = {
      textX: current?.textOffsetXPercent ?? 0,
      textY: current?.textOffsetYPercent ?? 0,
      noteX: current?.noteOffsetXPercent ?? 0,
      noteY: current?.noteOffsetYPercent ?? DEFAULT_NOTE_OFFSET_Y_PERCENT,
      iconX: current?.iconOffsetXPercent ?? DEFAULT_ICON_OFFSET_X_PERCENT,
      iconY: current?.iconOffsetYPercent ?? DEFAULT_ICON_OFFSET_Y_PERCENT,
      counterX: current?.counterOffsetXPercent ?? DEFAULT_COUNTER_OFFSET_X_PERCENT,
      counterY: current?.counterOffsetYPercent ?? DEFAULT_COUNTER_OFFSET_Y_PERCENT,
    }
    return draftOffsets ?? offsetsRef.current ?? fallback
  }, [draftOffsets, settingsRef])

  useEffect(() => {
    isSendingRef.current = isSending
  }, [isSending])

  useEffect(() => {
    if (!settings) return
    const nextStyle = toStyleDraftFromSettings(settings)
    setStyleDraft((current) => {
      if (current && isSameStyleDraft(current, nextStyle)) return current
      return nextStyle
    })
  }, [settings?.opacity, settings?.noteOpacity, settings?.fontSize, settings?.noteSize, settings?.textColor, settings?.noteColor])

  useEffect(() => {
    if (!settings) return
    const maxIndex = Math.max(0, itemCount - 1)
    const nextIndex = Math.min(maxIndex, Math.max(0, settings.selectedIndex))
    displayIndexRef.current = nextIndex
    setDisplayIndex((current) => (current === nextIndex ? current : nextIndex))
  }, [itemCount, settings?.selectedIndex])

  useEffect(() => {
    if (selectedElement !== 'note') return
    if (activeItemNote) return
    setSelectedElement('text')
  }, [activeItemNote, selectedElement])

  useEffect(() => {
    if (!settings || settings.appEnabled) return
    if (!settings.overlayVisible && !settings.overlayInteractive) return
    void updateSettings({
      overlayVisible: false,
      overlayInteractive: false,
    })
  }, [settings, updateSettings])

  useEffect(() => {
    if ((!settings?.overlayInteractive || !settings?.appEnabled) && isOpacityEditing) {
      setIsOpacityEditing(false)
    }
  }, [isOpacityEditing, settings?.appEnabled, settings?.overlayInteractive])

  useEffect(() => {
    if (settings?.overlayInteractive && settings?.appEnabled) return
    setIsToolboxOpen(false)
    setHoveredElement(null)
  }, [settings?.appEnabled, settings?.overlayInteractive])

  useEffect(() => {
    if (!isToolboxOpen && isOpacityEditing) {
      setIsOpacityEditing(false)
    }
  }, [isOpacityEditing, isToolboxOpen])

  useEffect(() => {
    if (!settings?.overlayInteractive || !settings?.appEnabled || !isToolboxOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-overlay-toolbox="true"]')) return
      if (target.closest('[data-overlay-hotspot="true"]')) return
      setIsToolboxOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [isToolboxOpen, settings?.appEnabled, settings?.overlayInteractive])

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent'
    document.documentElement.style.backgroundColor = 'transparent'
    return () => {
      document.body.style.backgroundColor = ''
      document.documentElement.style.backgroundColor = ''
    }
  }, [])

  useEffect(() => {
    if (!settings) return
    if (settings.overlayInteractive && settings.appEnabled) {
      setOverlayPassThrough(false)
      return
    }
    setOverlayPassThrough(true)
  }, [setOverlayPassThrough, settings?.appEnabled, settings?.overlayInteractive])

  const sendCurrent = useCallback(async () => {
    const current = settingsRef.current
    if (!current || isSendingRef.current) return
    if (!current.appEnabled) return

    const activeIndex = Math.max(0, Math.min(displayIndexRef.current, current.items.length - 1))
    const item = current.items[activeIndex]
    if (!item) return

    isSendingRef.current = true
    setIsSending(true)
    clearSendFeedbackTimer()
    setSendError('')
    setSendFeedbackState('optimistic')
    const startedAt = performance.now()

    try {
      if (window.electronAPI?.pythonSend) {
        const result = await window.electronAPI.pythonSend({ text: item.text })
        if (!result.ok) {
          throw new Error(result.error || `Send failed (${result.status})`)
        }
      } else {
        const response = await fetch(API_ENDPOINTS.send, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: item.text }),
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(payload?.error ?? `Send failed (${response.status})`)
        }
      }
      reportSendTelemetry({
        success: true,
        latencyMs: Math.max(0, performance.now() - startedAt),
      })
      setSendFeedbackState('success')
      scheduleSendFeedbackReset(SEND_SUCCESS_FEEDBACK_MS)
    } catch (error) {
      console.error('Send failed:', error)
      const raw = error instanceof Error ? error.message : 'Send failed.'
      setSendError(localizeOverlayError(current.uiLanguage, raw))
      setSendFeedbackState('error')
      reportSendTelemetry({
        success: false,
        latencyMs: Math.max(0, performance.now() - startedAt),
        error: raw,
      })
      scheduleSendFeedbackReset(SEND_ERROR_FEEDBACK_MS)
    } finally {
      isSendingRef.current = false
      setIsSending(false)
    }
  }, [clearSendFeedbackTimer, reportSendTelemetry, scheduleSendFeedbackReset, settingsRef])

  useEffect(() => {
    sendCurrentRef.current = sendCurrent
  }, [sendCurrent])

  const triggerInputAction = useCallback(
    async (actionId: string) => {
      if (!actionId) return
      const now = Date.now()
      const debounceMs = getInputActionDebounceMs(actionId)
      const previousAt = Number(lastInputActionTriggerAtRef.current[actionId] || 0)
      if (now - previousAt < debounceMs) return
      lastInputActionTriggerAtRef.current[actionId] = now

      const current = settingsRef.current
      const language = current?.uiLanguage ?? 'vi'

      if (actionId === 'overlay.toggle_visibility') {
        if (current?.appEnabled === false) return
        const nextVisible = current ? !current.overlayVisible : true
        showActionFeedback('optimistic', t(language, 'overlay.toggleOverlayQueued'))
        if (current) void updateSettings({ overlayVisible: nextVisible })

        try {
          if (window.electronAPI?.toggleOverlayVisibility) {
            await window.electronAPI.toggleOverlayVisibility()
          }
          showActionFeedback(
            'success',
            t(language, 'overlay.toggleOverlaySuccess', {
              state: t(language, nextVisible ? 'overlay.stateEnabled' : 'overlay.stateDisabled'),
            }),
          )
        } catch (error) {
          if (current) void updateSettings({ overlayVisible: current.overlayVisible })
          const raw = error instanceof Error ? error.message : t(language, 'overlay.toggleFailed')
          reportHotkeyError('overlay-action', raw)
          showActionFeedback('error', localizeOverlayActionError(language, raw), ACTION_ERROR_FEEDBACK_MS)
        }
        return
      }

      if (actionId === 'main.toggle_visibility') {
        if (current?.appEnabled === false) return
        showActionFeedback('optimistic', t(language, 'overlay.toggleMainQueued'))
        try {
          if (window.electronAPI?.toggleMainWindow) {
            window.electronAPI.toggleMainWindow()
          }
          showActionFeedback('success', t(language, 'overlay.toggleMainSuccess'))
        } catch (error) {
          const raw = error instanceof Error ? error.message : t(language, 'overlay.toggleFailed')
          reportHotkeyError('overlay-action', raw)
          showActionFeedback('error', localizeOverlayActionError(language, raw), ACTION_ERROR_FEEDBACK_MS)
        }
        return
      }

      if (actionId === 'app.toggle_enabled') {
        if (!current) return
        const nextEnabled = !current.appEnabled
        const nextPatch = nextEnabled
          ? {
              appEnabled: true,
              overlayVisible: true,
              overlayInteractive: false,
            }
          : {
              appEnabled: false,
              overlayVisible: false,
              overlayInteractive: false,
            }
        const loadingMessage = nextEnabled
          ? language === 'vi'
            ? 'Dang bat lai app, vui long doi...'
            : 'Re-enabling app, please wait...'
          : t(language, 'overlay.toggleAppQueued')
        showActionFeedback('optimistic', loadingMessage)
        try {
          if (window.electronAPI?.saveSettings) {
            await window.electronAPI.saveSettings({
              patch: nextPatch,
              immediate: true,
              awaitFlush: nextEnabled,
            })
          } else {
            await updateSettings(nextPatch)
          }
          showActionFeedback(
            'success',
            t(language, 'overlay.toggleAppSuccess', {
              state: t(language, nextEnabled ? 'main.appStateOn' : 'main.appStateOff'),
            }),
          )
        } catch (error) {
          const raw = error instanceof Error ? error.message : t(language, 'overlay.toggleFailed')
          reportHotkeyError('overlay-action', raw)
          showActionFeedback('error', localizeOverlayActionError(language, raw), ACTION_ERROR_FEEDBACK_MS)
        }
        return
      }

      if (actionId === 'overlay.toggle_interaction') {
        if (current?.appEnabled === false) return
        const nextInteractive = current ? !current.overlayInteractive : false
        showActionFeedback('optimistic', t(language, 'overlay.toggleEditQueued'))
        if (current) void updateSettings({ overlayInteractive: nextInteractive })

        try {
          if (window.electronAPI?.toggleOverlayInteraction) {
            await window.electronAPI.toggleOverlayInteraction()
          }
          showActionFeedback(
            'success',
            t(language, 'overlay.toggleEditSuccess', {
              state: t(language, nextInteractive ? 'overlay.stateEnabled' : 'overlay.stateDisabled'),
            }),
          )
        } catch (error) {
          if (current) void updateSettings({ overlayInteractive: current.overlayInteractive })
          const raw = error instanceof Error ? error.message : t(language, 'overlay.toggleFailed')
          reportHotkeyError('overlay-action', raw)
          showActionFeedback('error', localizeOverlayActionError(language, raw), ACTION_ERROR_FEEDBACK_MS)
        }
      }
    },
    [reportHotkeyError, settingsRef, showActionFeedback, updateSettings],
  )

  useEffect(() => {
    if (!window.electronAPI?.onSendHotkey) return
    return window.electronAPI.onSendHotkey(() => {
      void sendCurrentRef.current()
    })
  }, [])

  useEffect(() => {
    if (!settings?.overlayInteractive || !settings?.appEnabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      const key = event.key.toLowerCase()
      const isMoveKey =
        key === 'w' ||
        key === 'a' ||
        key === 's' ||
        key === 'd' ||
        key === 'arrowup' ||
        key === 'arrowleft' ||
        key === 'arrowdown' ||
        key === 'arrowright'
      if (!isMoveKey && key !== 'c') return
      if (event.repeat && !isMoveKey) return

      event.preventDefault()

      if (key === 'c') {
        const snapshot = getLiveOffsets()
        const active = selectedElement
        const next = resetOffsetsForTarget(snapshot, active)
        const patch = getOffsetPatchForTarget(next, active)
        offsetsRef.current = next
        queueDraftOffsets(next)
        void updateSettings(patch as Partial<Settings>)
        return
      }

      const current = settingsRef.current
      const container = overlayRef.current
      if (!current || !container) return

      const activeIndex = Math.max(0, Math.min(displayIndexRef.current, current.items.length - 1))
      const item = current.items[activeIndex]
      const activeElement = selectedElement === 'note' && !item?.note ? 'text' : selectedElement
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      const stepPx = event.shiftKey ? KEYBOARD_MOVE_FAST_STEP_PX : KEYBOARD_MOVE_STEP_PX
      const moveX = key === 'a' || key === 'arrowleft' ? -stepPx : key === 'd' || key === 'arrowright' ? stepPx : 0
      const moveY = key === 'w' || key === 'arrowup' ? -stepPx : key === 's' || key === 'arrowdown' ? stepPx : 0
      if (moveX === 0 && moveY === 0) return

      const moveXPercent = (moveX / rect.width) * 100
      const moveYPercent = (moveY / rect.height) * 100
      const snapshot = getLiveOffsets()
      const point = getOffsetByTarget(snapshot, activeElement)
      const next = setOffsetByTarget(
        snapshot,
        activeElement,
        clampOffsetX(point.x + moveXPercent),
        clampOffsetY(point.y + moveYPercent),
      )
      const patch = getOffsetPatchForTarget(next, activeElement)
      offsetsRef.current = next
      queueDraftOffsets(next)
      void updateSettings(patch)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [getLiveOffsets, queueDraftOffsets, selectedElement, settings?.appEnabled, settings?.overlayInteractive, settingsRef, updateSettings])

  useEffect(() => {
    if (!sendHotkey || !appToggleHotkey || !overlayToggleHotkey || !mainToggleHotkey || !overlayEditHotkey) return

    const payload: PythonConfigurePayload = {
      text: activeItemText,
      hotkey: sendHotkey,
      press_enter: false,
      app_enabled: appEnabled,
      app_toggle_hotkey: appToggleHotkey,
      overlay_toggle_hotkey: overlayToggleHotkey,
      main_toggle_hotkey: mainToggleHotkey,
      overlay_edit_hotkey: overlayEditHotkey,
    }
    const signature = JSON.stringify(payload)
    if (signature === pythonSyncSignatureRef.current) return
    pythonSyncSignatureRef.current = signature

    if (pythonSyncTimerRef.current !== null) {
      window.clearTimeout(pythonSyncTimerRef.current)
    }
    pythonSyncTimerRef.current = window.setTimeout(() => {
      pythonSyncTimerRef.current = null
      void (async () => {
        try {
          if (window.electronAPI?.pythonConfigure) {
            const result = await window.electronAPI.pythonConfigure(payload)
            if (result.ok) return

            const message = result.error?.trim() || `Python config failed (${result.status})`
            reportHotkeyError('python-config', message)
            return
          }

          const response = await fetch(API_ENDPOINTS.pythonConfig, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store',
          })
          if (response.ok) return

          const body = (await response.json().catch(() => null)) as { error?: string } | null
          const message = body?.error?.trim() || `Python config failed (${response.status})`
          reportHotkeyError('python-config', message)
        } catch {
          reportHotkeyError('python-config', 'Python config unavailable')
        }
      })()
    }, 90)
  }, [
    activeItemText,
    appEnabled,
    appToggleHotkey,
    mainToggleHotkey,
    overlayEditHotkey,
    overlayToggleHotkey,
    reportHotkeyError,
    sendHotkey,
  ])

  const flushStylePatch = useCallback(() => {
    const patch = pendingStylePatchRef.current
    pendingStylePatchRef.current = {}
    if (Object.keys(patch).length === 0) return
    void updateSettings(patch)
  }, [updateSettings])

  const flushIndexPatch = useCallback(() => {
    if (indexSaveTimerRef.current !== null) {
      window.clearTimeout(indexSaveTimerRef.current)
      indexSaveTimerRef.current = null
    }
    const nextIndex = displayIndexRef.current
    const current = settingsRef.current
    if (!current) return
    if (nextIndex === current.selectedIndex) return
    void updateSettings({ selectedIndex: nextIndex })
  }, [settingsRef, updateSettings])

  const scheduleIndexPatchFlush = useCallback(() => {
    if (indexSaveTimerRef.current !== null) {
      window.clearTimeout(indexSaveTimerRef.current)
    }
    indexSaveTimerRef.current = window.setTimeout(() => {
      indexSaveTimerRef.current = null
      flushIndexPatch()
    }, INDEX_SAVE_DEBOUNCE_MS)
  }, [flushIndexPatch])

  const applySwitchStep = useCallback(
    (direction: 1 | -1, silentFeedback = false) => {
      const current = settingsRef.current
      if (!current || current.items.length === 0) return false
      if (!current.appEnabled) return false

      const nextIndex = (displayIndexRef.current + direction + current.items.length) % current.items.length
      if (nextIndex === displayIndexRef.current) return false

      displayIndexRef.current = nextIndex
      setDisplayIndex(nextIndex)
      if (!silentFeedback) {
        showActionFeedback(
          'success',
          t(current.uiLanguage, 'overlay.switchSuccess', {
            current: nextIndex + 1,
            total: current.items.length,
          }),
        )
      }
      scheduleIndexPatchFlush()
      return true
    },
    [scheduleIndexPatchFlush, settingsRef, showActionFeedback],
  )

  const processSwitchQueue = useCallback(() => {
    if (switchAnimatingRef.current) return
    if (queuedSwitchStepsRef.current === 0) return

    const direction: 1 | -1 = queuedSwitchStepsRef.current > 0 ? 1 : -1
    queuedSwitchStepsRef.current -= direction
    const silentFeedback = queuedSwitchStepsRef.current !== 0

    const switched = applySwitchStep(direction, silentFeedback)
    if (!switched) {
      queuedSwitchStepsRef.current = 0
      return
    }

    switchAnimatingRef.current = true
    clearSwitchTransitionTimer()
    switchTransitionTimerRef.current = window.setTimeout(() => {
      switchTransitionTimerRef.current = null
      switchAnimatingRef.current = false
      processSwitchQueue()
    }, PHRASE_SWITCH_TRANSITION_MS)
  }, [applySwitchStep, clearSwitchTransitionTimer])

  const enqueueSwitchSteps = useCallback(
    (stepDelta: number) => {
      const next = Number.isFinite(stepDelta) ? Math.trunc(stepDelta) : 0
      if (next === 0) return
      if (queuedSwitchStepsRef.current !== 0 && Math.sign(queuedSwitchStepsRef.current) !== Math.sign(next)) {
        queuedSwitchStepsRef.current = next
      } else {
        queuedSwitchStepsRef.current += next
      }
      processSwitchQueue()
    },
    [processSwitchQueue],
  )

  const flushWheelBuffer = useCallback(() => {
    const buffered = wheelBufferRef.current
    if (buffered === 0) return

    const itemCount = settingsRef.current?.items.length ?? 0
    const stepThreshold = getDynamicWheelThreshold(itemCount)
    const direction = buffered > 0 ? 1 : -1
    const magnitude = Math.abs(buffered)
    const steps = Math.trunc(magnitude / stepThreshold)
    const remainder = magnitude % stepThreshold
    wheelBufferRef.current = direction * remainder
    if (steps === 0) return

    const compressedSteps = compressWheelSteps(direction * steps)
    enqueueSwitchSteps(compressedSteps)
  }, [enqueueSwitchSteps, settingsRef])

  const queueWheelDelta = useCallback(
    (delta: number) => {
      if (settingsRef.current?.appEnabled === false) return
      const normalizedDelta = Number.isFinite(delta) ? Math.trunc(delta) : 0
      if (normalizedDelta === 0) return

      const direction = normalizedDelta > 0 ? 1 : -1
      const isFirstImpulse =
        wheelBufferRef.current === 0 &&
        queuedSwitchStepsRef.current === 0 &&
        !switchAnimatingRef.current &&
        wheelFlushTimerRef.current === null

      if (isFirstImpulse) {
        // First wheel impulse should feel instant: switch immediately once.
        enqueueSwitchSteps(direction)
        wheelBufferRef.current += normalizedDelta - direction
      } else {
        wheelBufferRef.current += normalizedDelta
      }

      clearWheelFlushTimer()
      wheelFlushTimerRef.current = window.setTimeout(() => {
        wheelFlushTimerRef.current = null
        flushWheelBuffer()
      }, WHEEL_BUFFER_DEBOUNCE_MS)
    },
    [clearWheelFlushTimer, enqueueSwitchSteps, flushWheelBuffer, settingsRef],
  )

  const queueStylePatch = useCallback(
    (patch: Partial<Settings>) => {
      pendingStylePatchRef.current = { ...pendingStylePatchRef.current, ...patch }
      if (styleSaveTimerRef.current !== null) {
        window.clearTimeout(styleSaveTimerRef.current)
      }
      styleSaveTimerRef.current = window.setTimeout(() => {
        styleSaveTimerRef.current = null
        flushStylePatch()
      }, STYLE_SAVE_DEBOUNCE_MS)
    },
    [flushStylePatch],
  )

  useEffect(() => {
    return () => {
      if (styleSaveTimerRef.current !== null) {
        window.clearTimeout(styleSaveTimerRef.current)
        styleSaveTimerRef.current = null
      }
      clearSendFeedbackTimer()
      clearActionFeedbackTimer()
      clearWheelFlushTimer()
      clearSwitchTransitionTimer()
      wheelBufferRef.current = 0
      queuedSwitchStepsRef.current = 0
      switchAnimatingRef.current = false
      if (pythonSyncTimerRef.current !== null) {
        window.clearTimeout(pythonSyncTimerRef.current)
        pythonSyncTimerRef.current = null
      }
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      pendingDragUiPatchRef.current = null
      flushStylePatch()
      flushIndexPatch()
    }
  }, [
    clearActionFeedbackTimer,
    clearSendFeedbackTimer,
    clearSwitchTransitionTimer,
    clearWheelFlushTimer,
    flushIndexPatch,
    flushStylePatch,
  ])

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | null = null
    let idleStreak = 0
    let activeRequest: AbortController | null = null

    const scheduleNext = (delayMs: number) => {
      if (cancelled) return
      timeoutId = window.setTimeout(() => {
        void poll()
      }, delayMs)
    }

    const poll = async () => {
      if (cancelled) return
      if (pollingRef.current) {
        scheduleNext(INPUT_POLL_FAST_MS)
        return
      }

      pollingRef.current = true

      let sawInput = false
      let degraded = false
      let degradedMessage = ''
      try {
        const after = lastInputEventIdRef.current
        let payload: PythonEventsResult
        if (window.electronAPI?.pythonGetInputEvents) {
          payload = await window.electronAPI.pythonGetInputEvents(after)
        } else {
          activeRequest = new AbortController()
          const response = await fetch(`${API_ENDPOINTS.inputEvents}?after=${after}`, {
            method: 'GET',
            cache: 'no-store',
            signal: activeRequest.signal,
          })
          if (!response.ok) {
            degraded = true
            degradedMessage = `Python events error (${response.status})`
            return
          }
          payload = (await response.json()) as PythonEventsResult
        }
        if (!payload.ok) {
          degraded = true
          degradedMessage = payload.error || 'Python events unavailable'
          return
        }

        const events = Array.isArray(payload.events) ? payload.events : []
        if (typeof payload.last_id === 'number' && payload.last_id > lastInputEventIdRef.current) {
          lastInputEventIdRef.current = payload.last_id
        }

        let totalDelta = 0
        const queuedActions: string[] = []
        const queuedActionSet = new Set<string>()
        for (const event of events) {
          if (typeof event.id === 'number' && event.id > lastInputEventIdRef.current) {
            lastInputEventIdRef.current = event.id
          }
          const isAppEnabled = !!settingsRef.current?.appEnabled
          if (event.type === 'wheel') {
            if (!isAppEnabled) continue
            totalDelta += event.delta
            continue
          }
          if (event.type === 'action' && typeof event.action === 'string' && event.action) {
            if (!isAppEnabled && event.action !== 'app.toggle_enabled') continue
            if (queuedActionSet.has(event.action)) continue
            queuedActionSet.add(event.action)
            queuedActions.push(event.action)
          }
        }

        if (totalDelta !== 0) {
          sawInput = true
          queueWheelDelta(totalDelta)
        }
        if (queuedActions.length > 0) {
          sawInput = true
          for (const actionId of queuedActions) {
            await triggerInputAction(actionId)
          }
        }
        degraded = payload.degraded === true
        if (degraded && typeof payload.error === 'string' && payload.error.trim()) {
          degradedMessage = payload.error.trim()
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          degraded = true
          degradedMessage = error instanceof Error ? error.message : 'Input events polling failed'
        }
      } finally {
        activeRequest = null
        pollingRef.current = false
      }

      if (cancelled) return

      if (degraded && degradedMessage) {
        reportHotkeyError('input-events', degradedMessage)
      }

      if (sawInput) {
        idleStreak = 0
      } else {
        idleStreak = Math.min(idleStreak + 1, 10)
      }

      const isHidden = document.visibilityState !== 'visible'
      const overlayVisible = settingsRef.current?.overlayVisible !== false
      const appEnabled = !!settingsRef.current?.appEnabled
      const nextDelay = sawInput
        ? INPUT_POLL_FAST_MS
        : !appEnabled
          ? INPUT_POLL_APP_OFF_MS
        : degraded
          ? INPUT_POLL_DEGRADED_MS
          : !overlayVisible
            ? INPUT_POLL_OVERLAY_OFF_MS
            : isHidden
            ? INPUT_POLL_HIDDEN_MS
            : idleStreak >= 3
              ? INPUT_POLL_IDLE_MS
              : INPUT_POLL_FAST_MS
      scheduleNext(nextDelay)
    }

    scheduleNext(INPUT_POLL_FAST_MS)

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      if (activeRequest) {
        activeRequest.abort()
      }
    }
  }, [queueWheelDelta, reportHotkeyError, settingsRef, triggerInputAction])

  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current()
        dragCleanupRef.current = null
      }
      const dragSession = dragSessionRef.current
      if (dragSession) {
        if (dragSession.dragTimerId !== null) {
          window.clearTimeout(dragSession.dragTimerId)
        }
        if (dragSession.frictionTimerId !== null) {
          window.clearTimeout(dragSession.frictionTimerId)
        }
      }
      dragSessionRef.current = null
    }
  }, [])

  const resetElementPosition = useCallback(
    async (target: EditableElement) => {
      const snapshot = getLiveOffsets()
      const next = resetOffsetsForTarget(snapshot, target)
      offsetsRef.current = next
      queueDraftOffsets(next)
      await updateSettings(getOffsetPatchForTarget(next, target))
    },
    [getLiveOffsets, queueDraftOffsets, updateSettings],
  )

  const startDrag = useCallback(
    (target: EditableElement, event: ReactPointerEvent<HTMLElement>) => {
      if (isOpacityEditing) return
      if (!settingsRef.current?.overlayInteractive) return
      const container = overlayRef.current
      const current = settingsRef.current
      if (!container || !current) return

      queueDragUiPatch({ selectedElement: target, toolboxOpen: true })
      event.preventDefault()

      if (dragCleanupRef.current) {
        dragCleanupRef.current()
        dragCleanupRef.current = null
      }

      const previousSession = dragSessionRef.current
      if (previousSession) {
        if (previousSession.dragTimerId !== null) window.clearTimeout(previousSession.dragTimerId)
        if (previousSession.frictionTimerId !== null) window.clearTimeout(previousSession.frictionTimerId)
      }

      const seed = getLiveOffsets()
      const session: DragSession = {
        target,
        seed,
        startClientX: event.clientX,
        startClientY: event.clientY,
        maxTravelPx: 0,
        activated: false,
        dragTimerId: null,
        frictionTimerId: null,
        lastComputed: null,
      }
      dragSessionRef.current = session
      offsetsRef.current = seed

      const computeNextOffsets = (clientX: number, clientY: number, precise: boolean) => {
        const rect = container.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return null

        const preciseFactor = clampNumber(
          current.overlayPreciseDragFactor ?? DEFAULT_PRECISE_DRAG_FACTOR,
          0.08,
          0.7,
        )
        const multiplier = precise ? preciseFactor : 1
        const dxPercent = ((clientX - session.startClientX) / rect.width) * 100 * multiplier
        const dyPercent = ((clientY - session.startClientY) / rect.height) * 100 * multiplier
        const snapTolerancePx = clampNumber(current.overlaySnapTolerancePx ?? DEFAULT_SNAP_TOLERANCE_PX, 4, 28)
        const snapToleranceX = (snapTolerancePx / rect.width) * 100
        const snapToleranceY = (snapTolerancePx / rect.height) * 100

        const activePoint = getOffsetByTarget(session.seed, target)
        const rawX = activePoint.x + dxPercent
        const rawY = activePoint.y + dyPercent
        const peerTargets = (['text', 'note', 'icon', 'counter'] as EditableElement[]).filter((item) => item !== target)
        const peerPoints = peerTargets.map((peer) => getOffsetByTarget(session.seed, peer))

        const snappedX = snapWithTolerance(
          clampOffsetX(rawX),
          [0, ...SNAP_EDGE_X_TARGETS, ...peerPoints.map((item) => item.x)],
          snapToleranceX,
        )
        const snappedY = snapWithTolerance(
          clampOffsetY(rawY),
          [0, ...SNAP_EDGE_Y_TARGETS, ...peerPoints.map((item) => item.y)],
          snapToleranceY,
        )

        const base = offsetsRef.current ?? seed
        return setOffsetByTarget(base, target, snappedX, snappedY)
      }

      const queueDragFrame = (next: Offsets) => {
        const frictionMs = clampNumber(current.overlayDragFrictionMs ?? DEFAULT_DRAG_FRICTION_MS, 0, 24)
        session.lastComputed = next

        if (session.frictionTimerId !== null) {
          window.clearTimeout(session.frictionTimerId)
          session.frictionTimerId = null
        }

        if (frictionMs <= 0) {
          offsetsRef.current = next
          queueDraftOffsets(next)
          return
        }

        session.frictionTimerId = window.setTimeout(() => {
          session.frictionTimerId = null
          const computed = session.lastComputed
          if (!computed) return
          offsetsRef.current = computed
          queueDraftOffsets(computed)
        }, frictionMs)
      }

      const updateFromPointer = (clientX: number, clientY: number, precise: boolean) => {
        const next = computeNextOffsets(clientX, clientY, precise)
        if (!next) return
        queueDragFrame(next)
      }

      const activateDrag = () => {
        if (dragSessionRef.current !== session || session.activated) return
        session.activated = true
        queueDragUiPatch({ dragTarget: target })
        updateFromPointer(event.clientX, event.clientY, event.altKey)
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const travel = Math.hypot(moveEvent.clientX - session.startClientX, moveEvent.clientY - session.startClientY)
        session.maxTravelPx = Math.max(session.maxTravelPx, travel)
        if (!session.activated) return
        updateFromPointer(moveEvent.clientX, moveEvent.clientY, moveEvent.altKey)
      }

      const cleanupListeners = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleEnd)
        window.removeEventListener('pointercancel', handleEnd)
      }

      const handleEnd = () => {
        cleanupListeners()
        dragCleanupRef.current = null

        if (session.dragTimerId !== null) {
          window.clearTimeout(session.dragTimerId)
          session.dragTimerId = null
        }
        if (session.frictionTimerId !== null) {
          window.clearTimeout(session.frictionTimerId)
          session.frictionTimerId = null
        }

        const finalOffsets = session.lastComputed ?? offsetsRef.current ?? session.seed
        const didDrag = session.activated && session.maxTravelPx > DRAG_CLICK_TOLERANCE_PX
        dragSessionRef.current = null
        queueDragUiPatch({ dragTarget: null, draftOffsets: null })

        if (!didDrag) return
        offsetsRef.current = finalOffsets
        void updateSettings({
          textOffsetXPercent: finalOffsets.textX,
          textOffsetYPercent: finalOffsets.textY,
          noteOffsetXPercent: finalOffsets.noteX,
          noteOffsetYPercent: finalOffsets.noteY,
          iconOffsetXPercent: finalOffsets.iconX,
          iconOffsetYPercent: finalOffsets.iconY,
          counterOffsetXPercent: finalOffsets.counterX,
          counterOffsetYPercent: finalOffsets.counterY,
        })
      }

      const dragDelayMs = clampNumber(current.overlayDragDelayMs ?? DEFAULT_DRAG_DELAY_MS, 0, 180)
      if (dragDelayMs <= 0) {
        activateDrag()
      } else {
        session.dragTimerId = window.setTimeout(() => {
          session.dragTimerId = null
          activateDrag()
        }, dragDelayMs)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleEnd)
      window.addEventListener('pointercancel', handleEnd)
      dragCleanupRef.current = cleanupListeners
    },
    [getLiveOffsets, isOpacityEditing, queueDragUiPatch, queueDraftOffsets, settingsRef, updateSettings],
  )

  if (!settings || !styleDraft) return null

  const isInteractive = settings.appEnabled && settings.overlayInteractive
  const activeIndex = Math.max(0, Math.min(displayIndex, settings.items.length - 1))
  const currentItem = settings.items[activeIndex]
  const alignmentClass =
    settings.textAlign === 'left' ? 'text-left' : settings.textAlign === 'right' ? 'text-right' : 'text-center'
  const rootPointerMode = isInteractive ? 'pointer-events-auto' : 'pointer-events-none'
  const showOverlaySurface = settings.overlayElementsVisible && settings.overlayVisible
  const showText = showOverlaySurface
  const showNote = showOverlaySurface && !!currentItem?.note
  const showIcon = showOverlaySurface && (settings.overlayShowIcon || (isInteractive && !isOpacityEditing))
  const showCounter = showOverlaySurface && (settings.overlayShowCounter || (isInteractive && !isOpacityEditing))
  const offsets = draftOffsets ?? {
    textX: settings.textOffsetXPercent,
    textY: settings.textOffsetYPercent,
    noteX: settings.noteOffsetXPercent,
    noteY: settings.noteOffsetYPercent,
    iconX: settings.iconOffsetXPercent,
    iconY: settings.iconOffsetYPercent,
    counterX: settings.counterOffsetXPercent,
    counterY: settings.counterOffsetYPercent,
  }

  const runtimeOpacity = styleDraft.opacity
  const runtimeNoteOpacity = styleDraft.noteOpacity
  const effectiveOpacity = isInteractive && !isOpacityEditing ? 1 : runtimeOpacity
  const effectiveNoteOpacity = isInteractive && !isOpacityEditing ? 1 : runtimeNoteOpacity
  const effectiveFontSize = styleDraft.fontSize
  const effectiveNoteSize = styleDraft.noteSize
  const effectiveTextColor = styleDraft.textColor
  const effectiveNoteColor = styleDraft.noteColor

  const activeElement: EditableElement =
    selectedElement === 'note' && !currentItem?.note ? 'text' : selectedElement
  const activeElementLabel = getElementLabel(settings.uiLanguage, activeElement)
  const activeSupportsTextStyle = activeElement === 'text' || activeElement === 'note'
  const activeSupportsOpacity = activeElement === 'text' || activeElement === 'note'
  const activeSupportsAlign = activeElement === 'text' || activeElement === 'note'
  const activeVisibilityValue = activeElement === 'icon' ? settings.overlayShowIcon : activeElement === 'counter' ? settings.overlayShowCounter : true
  const textHovered = hoveredElement === 'text'
  const noteHovered = hoveredElement === 'note'
  const iconHovered = hoveredElement === 'icon'
  const counterHovered = hoveredElement === 'counter'
  const textScale = dragTarget === 'text' || textHovered || (isInteractive && activeElement === 'text') ? 1.02 : 1
  const noteScale = dragTarget === 'note' || noteHovered || (isInteractive && activeElement === 'note') ? 1.02 : 1
  const iconScale = dragTarget === 'icon' || iconHovered || (isInteractive && activeElement === 'icon') ? 1.03 : 1
  const counterScale =
    dragTarget === 'counter' || counterHovered || (isInteractive && activeElement === 'counter') ? 1.03 : 1
  const iconWillChange = dragTarget === 'icon' || iconHovered
  const counterWillChange = dragTarget === 'counter' || counterHovered
  const textWillChange = dragTarget === 'text' || textHovered
  const noteWillChange = dragTarget === 'note' || noteHovered
  const toolboxStyle = toToolboxStyle()

  const stopInteractive = async () => {
    setIsOpacityEditing(false)
    setIsToolboxOpen(false)
    if (window.electronAPI?.setOverlayInteraction) {
      await window.electronAPI.setOverlayInteraction(false)
      return
    }
    await updateSettings({ overlayInteractive: false })
  }

  const resetActivePosition = async () => {
    await resetElementPosition(activeElement)
  }

  return (
    <div
      ref={overlayRef}
      className={`relative h-dvh w-full bg-transparent select-none ${rootPointerMode}`}
    >
      {showIcon ? (
        <div
          data-overlay-hotspot="true"
          data-overlay-element="icon"
          style={withWillChange(toOffsetStyle(offsets.iconX, offsets.iconY, iconScale), iconWillChange)}
          onPointerDown={(event) => startDrag('icon', event)}
          onPointerEnter={() => setHoveredElement('icon')}
          onPointerLeave={() => setHoveredElement((current) => (current === 'icon' ? null : current))}
          onDoubleClick={() => void resetElementPosition('icon')}
          onClick={() => {
            if (!isInteractive) return
            setSelectedElement('icon')
            setIsToolboxOpen(true)
          }}
          className={`absolute z-30 h-14 w-14 overflow-hidden rounded-lg touch-none border qt-motion qt-motion-fast qt-motion-emphasis ${
            isInteractive
              ? dragTarget === 'icon'
                ? 'cursor-grabbing border-[var(--qt-primary)] bg-[var(--qt-surface)]/95 ring-2 ring-[var(--qt-primary)]/80'
                : activeElement === 'icon'
                  ? 'cursor-move border-[var(--qt-primary)] bg-[var(--qt-surface)]/90 ring-2 ring-[var(--qt-primary)]/65'
                  : 'cursor-move border-white/35 bg-[var(--qt-surface)]/80'
              : iconHovered
                ? 'cursor-pointer border-[var(--qt-primary)]/70 bg-[var(--qt-surface)]/90'
                : 'cursor-default border-[var(--qt-border)] bg-[var(--qt-surface)]/78'
          } ${settings.overlayShowIcon ? 'opacity-95' : 'opacity-65 border-dashed'}`}
        >
          <Image src="/icon.png" alt={t(settings.uiLanguage, 'overlay.logoAlt')} fill sizes="56px" className="rounded-lg object-cover" />
        </div>
      ) : null}

      {showCounter ? (
        <p
          data-overlay-hotspot="true"
          data-overlay-element="counter"
          style={withWillChange(toOffsetStyle(offsets.counterX, offsets.counterY, counterScale), counterWillChange)}
          onPointerDown={(event) => startDrag('counter', event)}
          onPointerEnter={() => setHoveredElement('counter')}
          onPointerLeave={() => setHoveredElement((current) => (current === 'counter' ? null : current))}
          onDoubleClick={() => void resetElementPosition('counter')}
          onClick={() => {
            if (!isInteractive) return
            setSelectedElement('counter')
            setIsToolboxOpen(true)
          }}
          className={`absolute z-30 inline-flex rounded-md border px-2 py-0.5 text-sm tracking-wide touch-none qt-motion qt-motion-fast qt-motion-emphasis ${
            isInteractive
              ? dragTarget === 'counter'
                ? 'cursor-grabbing border-[var(--qt-primary)] bg-[var(--qt-chip-bg)] ring-2 ring-[var(--qt-primary)]/75 text-[var(--qt-chip-text)]'
                : activeElement === 'counter'
                  ? 'cursor-move border-[var(--qt-primary)] bg-[var(--qt-chip-bg)] ring-2 ring-[var(--qt-primary)]/55 text-[var(--qt-chip-text)]'
                  : 'cursor-move border-[var(--qt-chip-border)] bg-[var(--qt-chip-bg)] text-[var(--qt-chip-text)]'
              : counterHovered
                ? 'cursor-pointer border-[var(--qt-primary)]/70 bg-[var(--qt-chip-bg)] text-[var(--qt-chip-text)]'
                : 'cursor-default border-[var(--qt-chip-border)] bg-[var(--qt-chip-bg)] text-[var(--qt-chip-text)]'
          } ${settings.overlayShowCounter ? 'opacity-100' : 'opacity-70 border-dashed'}`}
        >
          {t(settings.uiLanguage, 'overlay.counterLabel', {
            current: activeIndex + 1,
            total: settings.items.length,
          })}
        </p>
      ) : null}

      {showText ? (
        <div
          data-overlay-hotspot="true"
          data-overlay-element="text"
          style={withWillChange(toOffsetStyle(offsets.textX, offsets.textY, textScale, settings.textAlign), textWillChange)}
          onPointerDown={(event) => startDrag('text', event)}
          onPointerEnter={() => setHoveredElement('text')}
          onPointerLeave={() => setHoveredElement((current) => (current === 'text' ? null : current))}
          onDoubleClick={() => void resetElementPosition('text')}
          onClick={() => {
            if (!isInteractive) return
            setSelectedElement('text')
            setIsToolboxOpen(true)
          }}
          className={`absolute z-20 max-w-[96%] rounded-xl px-3 py-2 touch-none qt-motion qt-motion-fast qt-motion-emphasis ${alignmentClass} ${
            isInteractive
              ? dragTarget === 'text'
                ? 'cursor-grabbing border border-[var(--qt-primary)] bg-black/30 ring-2 ring-[var(--qt-primary)]/80'
                : activeElement === 'text'
                  ? 'cursor-move border border-[var(--qt-primary)] bg-black/24 ring-2 ring-[var(--qt-primary)]/60'
                  : 'cursor-move border border-white/35 bg-black/16 hover:border-[var(--qt-primary)]/80'
              : textHovered
                ? 'cursor-text border border-[var(--qt-primary)]/50 bg-black/12 shadow-[0_0_10px_rgba(64,217,255,0.18)]'
                : 'cursor-default border border-transparent bg-transparent'
          }`}
        >
          <p
            key={`text-${activeIndex}`}
            className="qt-overlay-fade-in break-words whitespace-pre-wrap font-extrabold leading-tight tracking-wide"
            style={{
              fontSize: `${effectiveFontSize}px`,
              color: withOpacity(effectiveTextColor, effectiveOpacity),
              textShadow: '0 0 12px rgba(0,0,0,0.96), 0 0 26px rgba(0,0,0,0.82)',
            }}
          >
            {currentItem?.text || ''}
          </p>
        </div>
      ) : null}

      {showNote && currentItem?.note ? (
        <div
          data-overlay-hotspot="true"
          data-overlay-element="note"
          style={withWillChange(toOffsetStyle(offsets.noteX, offsets.noteY, noteScale, settings.textAlign), noteWillChange)}
          onPointerDown={(event) => startDrag('note', event)}
          onPointerEnter={() => setHoveredElement('note')}
          onPointerLeave={() => setHoveredElement((current) => (current === 'note' ? null : current))}
          onDoubleClick={() => void resetElementPosition('note')}
          onClick={() => {
            if (!isInteractive) return
            setSelectedElement('note')
            setIsToolboxOpen(true)
          }}
          className={`absolute z-20 max-w-[96%] rounded-xl px-3 py-2 touch-none qt-motion qt-motion-fast qt-motion-emphasis ${alignmentClass} ${
            isInteractive
              ? dragTarget === 'note'
                ? 'cursor-grabbing border border-[var(--qt-accent)] bg-black/30 ring-2 ring-[var(--qt-accent)]/80'
                : activeElement === 'note'
                  ? 'cursor-move border border-[var(--qt-accent)] bg-black/24 ring-2 ring-[var(--qt-accent)]/60'
                  : 'cursor-move border border-white/35 bg-black/16 hover:border-[var(--qt-accent)]/80'
              : noteHovered
                ? 'cursor-text border border-[var(--qt-accent)]/50 bg-black/12 shadow-[0_0_10px_rgba(255,77,149,0.18)]'
                : 'cursor-default border border-transparent bg-transparent'
          }`}
        >
          <p
            key={`note-${activeIndex}`}
            className="qt-overlay-fade-in break-words whitespace-pre-wrap font-semibold leading-snug"
            style={{
              fontSize: `${effectiveNoteSize}px`,
              color: withOpacity(effectiveNoteColor, effectiveNoteOpacity),
              textShadow: '0 0 10px rgba(0,0,0,0.92), 0 0 20px rgba(0,0,0,0.75)',
            }}
          >
            {currentItem.note}
          </p>
        </div>
      ) : null}

      {isInteractive ? (
        <>
          <div data-overlay-toolbox="true" className="absolute right-4 top-4 z-40 flex items-center gap-2">
            <div className="rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface)]/95 px-3 py-1.5 text-xs text-[var(--qt-fg)] qt-elev-soft">
              {t(settings.uiLanguage, 'overlay.editModeActive')}
            </div>
            <button
              data-overlay-toolbox="true"
              onClick={() => void stopInteractive()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--qt-accent)] bg-[var(--qt-accent)] text-sm font-bold text-[var(--qt-on-accent)] qt-elev-soft qt-motion qt-motion-fast qt-motion-emphasis hover:scale-105"
              aria-label={t(settings.uiLanguage, 'overlay.exitEdit')}
              title={t(settings.uiLanguage, 'overlay.exitEdit')}
            >
              X
            </button>
          </div>

          {isToolboxOpen ? (
            <div
              ref={toolboxRef}
              data-overlay-toolbox="true"
              style={toolboxStyle}
              className="pointer-events-auto absolute z-50 w-[320px] max-w-[95vw] max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-white/20 bg-black/70 p-3 qt-elev-medium qt-blur-soft qt-overlay-fade-in"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--qt-fg)]">
                  {t(settings.uiLanguage, 'overlay.editorTitle')} - {activeElementLabel}
                </p>
                <button
                  onClick={() => setIsToolboxOpen(false)}
                  className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-[var(--qt-fg)] hover:bg-white/15"
                  title={t(settings.uiLanguage, 'overlay.exitEdit')}
                >
                  x
                </button>
              </div>

              {isOpacityEditing ? (
                <div className="mt-3 space-y-3">
                  {activeSupportsOpacity ? (
                    <OverlaySlider
                      label={t(settings.uiLanguage, 'overlay.opacity')}
                      value={activeElement === 'text' ? runtimeOpacity : runtimeNoteOpacity}
                      min={0.2}
                      max={1}
                      step={0.05}
                      onChange={(value) => {
                        if (activeElement === 'text') {
                          setStyleDraft((current) => (current ? { ...current, opacity: value } : current))
                          queueStylePatch({ opacity: value })
                          return
                        }
                        setStyleDraft((current) => (current ? { ...current, noteOpacity: value } : current))
                        queueStylePatch({ noteOpacity: value })
                      }}
                    />
                  ) : null}

                  <button
                    onClick={() => setIsOpacityEditing(false)}
                    className="w-full rounded-md border border-[var(--qt-primary)] bg-[var(--qt-primary)] py-1.5 text-xs font-semibold text-[var(--qt-on-primary)]"
                  >
                    {t(settings.uiLanguage, 'overlay.opacityDone')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    <button
                      onClick={() => {
                        setSelectedElement('text')
                        setIsOpacityEditing(false)
                      }}
                      className={`rounded-md border py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        activeElement === 'text'
                          ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                          : 'border-white/20 bg-white/10 text-[var(--qt-fg)]'
                      }`}
                    >
                      {t(settings.uiLanguage, 'overlay.elementText')}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedElement('note')
                        setIsOpacityEditing(false)
                      }}
                      disabled={!currentItem?.note}
                      className={`rounded-md border py-1 text-[11px] font-semibold uppercase tracking-wide disabled:opacity-40 ${
                        activeElement === 'note'
                          ? 'border-[var(--qt-accent)] bg-[var(--qt-accent)] text-[var(--qt-on-accent)]'
                          : 'border-white/20 bg-white/10 text-[var(--qt-fg)]'
                      }`}
                    >
                      {t(settings.uiLanguage, 'overlay.elementNote')}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedElement('icon')
                        setIsOpacityEditing(false)
                      }}
                      className={`rounded-md border py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        activeElement === 'icon'
                          ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                          : 'border-white/20 bg-white/10 text-[var(--qt-fg)]'
                      }`}
                    >
                      {t(settings.uiLanguage, 'overlay.elementIcon')}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedElement('counter')
                        setIsOpacityEditing(false)
                      }}
                      className={`rounded-md border py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        activeElement === 'counter'
                          ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                          : 'border-white/20 bg-white/10 text-[var(--qt-fg)]'
                      }`}
                    >
                      {t(settings.uiLanguage, 'overlay.elementCounter')}
                    </button>
                  </div>

                  <div className="mt-2 space-y-2">
                    {activeSupportsOpacity ? (
                      <button
                        onClick={() => setIsOpacityEditing(true)}
                        className="w-full rounded-md border border-[var(--qt-primary)]/60 bg-[var(--qt-primary)]/20 py-1.5 text-xs font-semibold text-[var(--qt-fg)] hover:bg-[var(--qt-primary)]/30"
                      >
                        {t(settings.uiLanguage, 'overlay.opacityAdjust')}
                      </button>
                    ) : null}

                    {activeSupportsTextStyle ? (
                      <OverlaySlider
                        label={t(settings.uiLanguage, 'overlay.size')}
                        value={activeElement === 'text' ? effectiveFontSize : effectiveNoteSize}
                        min={activeElement === 'text' ? 24 : 12}
                        max={activeElement === 'text' ? 120 : 72}
                        step={1}
                        onChange={(value) => {
                          if (activeElement === 'text') {
                            setStyleDraft((current) => (current ? { ...current, fontSize: value } : current))
                            queueStylePatch({ fontSize: value })
                            return
                          }
                          setStyleDraft((current) => (current ? { ...current, noteSize: value } : current))
                          queueStylePatch({ noteSize: value })
                        }}
                      />
                    ) : null}

                    {activeSupportsTextStyle ? (
                      <label className="flex items-center justify-between gap-2 text-xs text-[var(--qt-muted)]">
                        <span>{t(settings.uiLanguage, 'overlay.color')}</span>
                        <input
                          type="color"
                          value={activeElement === 'text' ? effectiveTextColor : effectiveNoteColor}
                          onChange={(event) => {
                            const parsed = normalizeColorInput(event.target.value)
                            if (!parsed) return
                            if (activeElement === 'text') {
                              setStyleDraft((current) => (current ? { ...current, textColor: parsed } : current))
                              queueStylePatch({ textColor: parsed })
                              return
                            }
                            setStyleDraft((current) => (current ? { ...current, noteColor: parsed } : current))
                            queueStylePatch({ noteColor: parsed })
                          }}
                          className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-white/10 p-0.5"
                        />
                      </label>
                    ) : null}
                  </div>

                  {activeSupportsAlign ? (
                    <div className="mt-2">
                      <p className="mb-1 text-xs text-[var(--qt-muted)]">{t(settings.uiLanguage, 'overlay.align')}</p>
                      <div className="grid grid-cols-3 gap-1">
                        {(['left', 'center', 'right'] as const).map((align) => (
                          <button
                            key={align}
                            onClick={() => void updateSettings({ textAlign: align })}
                            className={`rounded-md border py-1 text-[11px] uppercase tracking-wide ${
                              settings.textAlign === align
                                ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                                : 'border-white/20 bg-white/10 text-[var(--qt-fg)]'
                            }`}
                          >
                            {align}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {activeElement === 'icon' || activeElement === 'counter' ? (
                    <button
                      onClick={() => {
                        if (activeElement === 'icon') {
                          void updateSettings({ overlayShowIcon: !settings.overlayShowIcon })
                          return
                        }
                        void updateSettings({ overlayShowCounter: !settings.overlayShowCounter })
                      }}
                      className="mt-2 w-full rounded-md border border-white/20 bg-white/10 py-1.5 text-xs font-semibold text-[var(--qt-fg)] hover:bg-white/15"
                    >
                      {activeElement === 'icon' ? t(settings.uiLanguage, 'main.overlayShowIcon') : t(settings.uiLanguage, 'main.overlayShowCounter')} ·{' '}
                      {activeVisibilityValue ? t(settings.uiLanguage, 'main.enabled') : t(settings.uiLanguage, 'main.disabled')}
                    </button>
                  ) : null}

                  <button
                    onClick={() => void resetActivePosition()}
                    className="mt-2 w-full rounded-md border border-white/20 bg-white/10 py-1.5 text-xs font-semibold text-[var(--qt-fg)] hover:bg-white/15"
                  >
                    {t(settings.uiLanguage, 'overlay.resetPosition')}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {sendFeedbackState !== 'idle' ? (
        <div className="absolute bottom-4 left-4 z-30 max-w-[60%] qt-overlay-fade-in">
          <div className="rounded-lg border border-[var(--qt-border)]/70 bg-black/45 px-3 py-2 qt-elev-soft qt-motion qt-motion-fast">
            {sendFeedbackState === 'optimistic' || isSending ? (
              <div>
                <p className="text-[11px] tracking-wide text-[var(--qt-muted)]">{t(settings.uiLanguage, 'overlay.sendQueued')}</p>
                <div className="mt-1.5 space-y-1">
                  <div className="h-1.5 w-28 rounded-full bg-white/20 animate-pulse" />
                  <div className="h-1.5 w-20 rounded-full bg-white/15 animate-pulse" />
                </div>
              </div>
            ) : null}
            {sendFeedbackState === 'success' && !isSending ? (
              <p className="text-xs tracking-wide text-emerald-300/95">{t(settings.uiLanguage, 'overlay.sendSuccess')}</p>
            ) : null}
            {sendFeedbackState === 'error' && !isSending ? (
              <p className="text-xs tracking-wide text-red-300/95">{sendError || t(settings.uiLanguage, 'overlay.sendFailed')}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {actionFeedback.state !== 'idle' ? (
        <div className="absolute bottom-4 right-4 z-30 max-w-[60%] qt-overlay-fade-in">
          <div
            className={`rounded-lg border px-3 py-2 qt-elev-soft qt-motion qt-motion-fast ${
              actionFeedback.state === 'error'
                ? 'border-red-500/55 bg-red-500/18'
                : actionFeedback.state === 'success'
                  ? 'border-cyan-400/45 bg-cyan-500/15'
                  : 'border-[var(--qt-border)]/70 bg-black/45'
            }`}
          >
            {actionFeedback.state === 'optimistic' ? (
              <div className="space-y-1.5">
                <p className="text-[11px] tracking-wide text-[var(--qt-muted)]">{actionFeedback.message}</p>
                <div className="h-1.5 w-24 rounded-full bg-white/20 animate-pulse" />
              </div>
            ) : actionFeedback.state === 'error' ? (
              <p className="text-xs tracking-wide text-red-300/95">{actionFeedback.message}</p>
            ) : (
              <p className="text-xs tracking-wide text-cyan-100">{actionFeedback.message}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default memo(OverlayPageComponent)

type OverlaySliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function OverlaySlider({ label, value, min, max, step, onChange }: OverlaySliderProps) {
  return (
    <label className="block text-xs text-[var(--qt-muted)]">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
        className="mt-1 w-full accent-[var(--qt-primary)]"
      />
    </label>
  )
}

function toOffsetStyle(
  xPercent: number,
  yPercent: number,
  scale = 1,
  anchor: Settings['textAlign'] | 'center' = 'center',
): CSSProperties {
  const anchorTransform =
    anchor === 'left' ? 'translate(0, -50%)' : anchor === 'right' ? 'translate(-100%, -50%)' : 'translate(-50%, -50%)'

  return {
    left: `${50 + xPercent}%`,
    top: `${50 + yPercent}%`,
    transform: `${anchorTransform} scale(${scale})`,
  }
}

function toToolboxStyle(): CSSProperties {
  return {
    right: '1rem',
    top: '3.75rem',
  }
}

function withWillChange(style: CSSProperties, enabled: boolean): CSSProperties {
  if (!enabled) return style
  return { ...style, willChange: 'transform, opacity' }
}

function getDynamicWheelThreshold(_itemCount: number) {
  return 1
}

function getInputActionDebounceMs(actionId: string) {
  if (
    actionId === 'app.toggle_enabled' ||
    actionId === 'overlay.toggle_visibility' ||
    actionId === 'main.toggle_visibility' ||
    actionId === 'overlay.toggle_interaction'
  ) {
    return INPUT_ACTION_TOGGLE_DEBOUNCE_MS
  }
  return INPUT_ACTION_DEFAULT_DEBOUNCE_MS
}

function compressWheelSteps(stepDelta: number) {
  const normalized = Number.isFinite(stepDelta) ? Math.trunc(stepDelta) : 0
  if (normalized === 0) return 0
  return Math.max(-WHEEL_MAX_BATCH_STEPS, Math.min(WHEEL_MAX_BATCH_STEPS, normalized))
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clampOffsetX(value: number) {
  if (!Number.isFinite(value)) return 0
  const clamped = Math.min(MAX_OFFSET_X_PERCENT, Math.max(MIN_OFFSET_X_PERCENT, value))
  return Math.round(clamped * 100) / 100
}

function clampOffsetY(value: number) {
  if (!Number.isFinite(value)) return 0
  const clamped = Math.min(MAX_OFFSET_Y_PERCENT, Math.max(MIN_OFFSET_Y_PERCENT, value))
  return Math.round(clamped * 100) / 100
}

function snapWithTolerance(value: number, targets: number[], tolerance: number) {
  let snapped = value
  let minDistance = tolerance + 1

  for (const target of targets) {
    if (!Number.isFinite(target)) continue
    const distance = Math.abs(value - target)
    if (distance > tolerance || distance >= minDistance) continue
    snapped = target
    minDistance = distance
  }

  return Math.round(snapped * 100) / 100
}

function getOffsetByTarget(current: Offsets, target: EditableElement) {
  if (target === 'text') return { x: current.textX, y: current.textY }
  if (target === 'note') return { x: current.noteX, y: current.noteY }
  if (target === 'icon') return { x: current.iconX, y: current.iconY }
  return { x: current.counterX, y: current.counterY }
}

function setOffsetByTarget(current: Offsets, target: EditableElement, x: number, y: number): Offsets {
  if (target === 'text') return { ...current, textX: x, textY: y }
  if (target === 'note') return { ...current, noteX: x, noteY: y }
  if (target === 'icon') return { ...current, iconX: x, iconY: y }
  return { ...current, counterX: x, counterY: y }
}

function resetOffsetsForTarget(current: Offsets, target: EditableElement): Offsets {
  if (target === 'text') return { ...current, textX: 0, textY: 0 }
  if (target === 'note') return { ...current, noteX: 0, noteY: DEFAULT_NOTE_OFFSET_Y_PERCENT }
  if (target === 'icon') {
    return {
      ...current,
      iconX: DEFAULT_ICON_OFFSET_X_PERCENT,
      iconY: DEFAULT_ICON_OFFSET_Y_PERCENT,
    }
  }
  return {
    ...current,
    counterX: DEFAULT_COUNTER_OFFSET_X_PERCENT,
    counterY: DEFAULT_COUNTER_OFFSET_Y_PERCENT,
  }
}

function getOffsetPatchForTarget(current: Offsets, target: EditableElement): Partial<Settings> {
  if (target === 'text') {
    return { textOffsetXPercent: current.textX, textOffsetYPercent: current.textY }
  }
  if (target === 'note') {
    return { noteOffsetXPercent: current.noteX, noteOffsetYPercent: current.noteY }
  }
  if (target === 'icon') {
    return { iconOffsetXPercent: current.iconX, iconOffsetYPercent: current.iconY }
  }
  return {
    counterOffsetXPercent: current.counterX,
    counterOffsetYPercent: current.counterY,
  }
}

function getElementLabel(language: Settings['uiLanguage'], target: EditableElement) {
  if (target === 'text') return t(language, 'overlay.elementText')
  if (target === 'note') return t(language, 'overlay.elementNote')
  if (target === 'icon') return t(language, 'overlay.elementIcon')
  return t(language, 'overlay.elementCounter')
}

function normalizeColorInput(value: string) {
  const normalized = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized
  return ''
}

function toStyleDraftFromSettings(settings: Settings): StyleDraft {
  return {
    opacity: settings.opacity,
    noteOpacity: settings.noteOpacity,
    fontSize: settings.fontSize,
    noteSize: settings.noteSize,
    textColor: settings.textColor,
    noteColor: settings.noteColor,
  }
}

function isSameStyleDraft(a: StyleDraft, b: StyleDraft) {
  return (
    a.opacity === b.opacity &&
    a.noteOpacity === b.noteOpacity &&
    a.fontSize === b.fontSize &&
    a.noteSize === b.noteSize &&
    a.textColor === b.textColor &&
    a.noteColor === b.noteColor
  )
}

function withOpacity(colorHex: string, opacity: number) {
  const safeColor = normalizeColorInput(colorHex) || '#ffffff'
  const r = Number.parseInt(safeColor.slice(1, 3), 16)
  const g = Number.parseInt(safeColor.slice(3, 5), 16)
  const b = Number.parseInt(safeColor.slice(5, 7), 16)
  const alpha = clampNumber(opacity, 0, 1)
  return `rgba(${r},${g},${b},${alpha})`
}

function isSameOffsets(a: Offsets, b: Offsets) {
  return (
    a.textX === b.textX &&
    a.textY === b.textY &&
    a.noteX === b.noteX &&
    a.noteY === b.noteY &&
    a.iconX === b.iconX &&
    a.iconY === b.iconY &&
    a.counterX === b.counterX &&
    a.counterY === b.counterY
  )
}

function localizeOverlayError(language: 'vi' | 'en', message: string) {
  const fallback = t(language, 'overlay.sendFailed')
  const normalized = message.trim()
  if (!normalized) return fallback
  if (language === 'en') return normalized

  const detail = normalized.replace(/^Send failed[:\s-]*/i, '').trim() || normalized

  if (detail.includes('Python service timeout')) {
    return `Python service phản hồi quá chậm. Chi tiết: ${detail}`
  }
  if (detail.includes('Python service unavailable')) {
    return `Không kết nối được Python service. Chi tiết: ${detail}`
  }
  if (detail.includes('Invalid PYTHON_API_BASE_URL')) {
    return `Cấu hình đường dẫn Python API không hợp lệ. Chi tiết: ${detail}`
  }
  if (detail.includes('`text` is required')) {
    return `Thiếu nội dung text cần gửi. Chi tiết: ${detail}`
  }
  if (detail.includes('Payload must be a JSON object')) {
    return `Dữ liệu gửi lên không đúng định dạng JSON object. Chi tiết: ${detail}`
  }
  if (detail.includes('Invalid JSON payload')) {
    return `Payload JSON không hợp lệ. Chi tiết: ${detail}`
  }
  if (detail.includes('Python service error')) {
    return `Python service trả lỗi. Chi tiết: ${detail}`
  }
  if (detail.includes('`delay_range`')) {
    return `Giá trị delay_range không hợp lệ. Chi tiết: ${detail}`
  }

  return `Lỗi gửi câu. Chi tiết: ${detail}`
}

function localizeOverlayActionError(language: 'vi' | 'en', message: string) {
  const fallback = t(language, 'overlay.toggleFailed')
  const normalized = message.trim()
  if (!normalized) return fallback
  if (language === 'en') return normalized

  const detail = normalized.replace(/^Action failed[:\s-]*/i, '').trim() || normalized

  if (detail.includes('unavailable')) {
    return `Tác vụ thất bại do dịch vụ chưa sẵn sàng. Chi tiết: ${detail}`
  }
  if (detail.includes('timeout')) {
    return `Tác vụ bị quá thời gian chờ. Chi tiết: ${detail}`
  }
  if (detail.includes('failed')) {
    return `Tác vụ thất bại. Chi tiết: ${detail}`
  }

  return `Lỗi tác vụ overlay. Chi tiết: ${detail}`
}
