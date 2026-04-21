'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import Image from 'next/image'
import { Eye, Hash, ImageIcon, Loader2, MessageSquareText, Palette, Ruler, SlidersHorizontal, Type, X } from 'lucide-react'
import OverlayUnifiedToolsPanel from '@/components/OverlayUnifiedToolsPanel'
import { useSettings } from '@/hooks/use-settings'
import { t } from '@/lib/i18n'
import { computeMorphTransform, isRectSnapshotValid } from '@/lib/overlay-morph'
import { computeHorizontalTooltipPlacement } from '@/lib/overlay-tooltip'
import type {
  HotkeyErrorSource,
  OverlayImageCardState,
  OverlayRectSnapshot,
  PythonConfigurePayload,
  PythonEventsResult,
  PythonInputEvent,
  Settings,
} from '@/types'

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
const INPUT_ACTION_CAPTURE_PROBE_DEBOUNCE_MS = 90
const APP_TOGGLE_ACTION_LOCK_MS = 1200
const TOOLBOX_POSITION_TRACK_INTERVAL_MS = 16
const KEYBOARD_MOVE_STEP_PX = 1
const KEYBOARD_MOVE_FAST_STEP_PX = 5
const WHEEL_BUFFER_DEBOUNCE_MS = 56
const WHEEL_MAX_BATCH_STEPS = 6
const PHRASE_SWITCH_TRANSITION_MS = 120
const MORPH_ENTER_DURATION_MS = 260
const MORPH_EXIT_DURATION_MS = 240
const IMAGE_CARD_WIDTH_PX = 248
const IMAGE_CARD_HEIGHT_PX = 124

type SendFeedbackState = 'idle' | 'optimistic' | 'success' | 'error'
type ActionFeedbackState = 'idle' | 'optimistic' | 'success' | 'error'

type ActionFeedback = {
  state: ActionFeedbackState
  message: string
}

type InputEventPayload = PythonInputEvent

type EditableElement = 'text' | 'note' | 'icon' | 'counter'
type OverlayToolId = 'visibility' | 'opacity' | 'color' | 'resize'

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
  iconOpacity: number
  counterOpacity: number
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

type HoverHint = {
  label: string
  anchorEl: HTMLElement
}

type MorphTarget = 'text' | 'image'
type MorphDirection = 'toPlay' | 'toEdit'

type MorphGhost = {
  id: number
  target: MorphTarget
  direction: MorphDirection
  running: boolean
  from: OverlayRectSnapshot
  to: OverlayRectSnapshot
  text?: {
    title: string
    note: string
  }
  image?: {
    previewDataUrl: string
    imageName: string
    isSearching: boolean
    resultsCount: number
    lensError: string
  }
}

function createDefaultActiveToolByElement(): Record<EditableElement, OverlayToolId | null> {
  return {
    text: null,
    note: null,
    icon: null,
    counter: null,
  }
}

function hasAnyActiveTool(state: Record<EditableElement, OverlayToolId | null>) {
  return !!(state.text || state.note || state.icon || state.counter)
}

function createEmptyImageCardState(): OverlayImageCardState {
  return {
    hasImage: false,
    previewDataUrl: '',
    imageName: '',
    isSearching: false,
    lensUrl: '',
    lensError: '',
    resultsCount: 0,
  }
}

function OverlayPageComponent() {
  const { settings, settingsRef, updateSettings } = useSettings()
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendFeedbackState, setSendFeedbackState] = useState<SendFeedbackState>('idle')
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>({ state: 'idle', message: '' })
  const [dragTarget, setDragTarget] = useState<EditableElement | null>(null)
  const [selectedElement, setSelectedElement] = useState<EditableElement>('icon')
  const [hoveredElement, setHoveredElement] = useState<EditableElement | null>(null)
  const [draftOffsets, setDraftOffsets] = useState<Offsets | null>(null)
  const [styleDraft, setStyleDraft] = useState<StyleDraft | null>(null)
  const [displayIndex, setDisplayIndex] = useState(0)
  const [isOpacityEditing, setIsOpacityEditing] = useState(false)
  const [isToolboxOpen, setIsToolboxOpen] = useState(false)
  const [isHudOpacityOpen, setIsHudOpacityOpen] = useState(false)
  const [, setOverlayTextInteractionActive] = useState(false)
  const [captureProbeToken, setCaptureProbeToken] = useState(0)
  const [imageCardState, setImageCardState] = useState<OverlayImageCardState>(() => createEmptyImageCardState())
  const [imageCardDraftOffset, setImageCardDraftOffset] = useState<{ x: number; y: number } | null>(null)
  const [windowRects, setWindowRects] = useState<Record<MorphTarget, OverlayRectSnapshot | null>>({
    text: null,
    image: null,
  })
  const windowRectsRef = useRef<Record<MorphTarget, OverlayRectSnapshot | null>>({ text: null, image: null })
  const [hiddenByMorphTargets, setHiddenByMorphTargets] = useState<Record<MorphTarget, boolean>>({
    text: false,
    image: false,
  })
  const [morphGhosts, setMorphGhosts] = useState<MorphGhost[]>([])
  const [activeToolByElement, setActiveToolByElement] = useState<Record<EditableElement, OverlayToolId | null>>(
    () => createDefaultActiveToolByElement(),
  )
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const textHudRef = useRef<HTMLDivElement | null>(null)
  const imageCardRef = useRef<HTMLDivElement | null>(null)
  const hotspotRefs = useRef<Record<EditableElement, HTMLElement | null>>({
    text: null,
    note: null,
    icon: null,
    counter: null,
  })
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
  const editModeAnimationTimerRef = useRef<number | null>(null)
  const previousInteractiveRef = useRef<boolean | null>(null)
  const pendingMorphToEditRef = useRef<Record<MorphTarget, boolean>>({ text: false, image: false })
  const playRectsRef = useRef<Record<MorphTarget, OverlayRectSnapshot | null>>({ text: null, image: null })
  const morphTargetTokenRef = useRef<Record<MorphTarget, number>>({ text: 0, image: 0 })
  const morphTimersRef = useRef<number[]>([])
  const morphIdRef = useRef(0)
  const pythonSyncTimerRef = useRef<number | null>(null)
  const pythonSyncSignatureRef = useRef('')
  const lastInputActionTriggerAtRef = useRef<Record<string, number>>({})
  const appToggleInFlightUntilRef = useRef(0)
  const lastHotkeyErrorRef = useRef<{ source: HotkeyErrorSource; message: string; at: number }>({
    source: 'unknown',
    message: '',
    at: 0,
  })
  const imageCardDragRef = useRef<{
    startClientX: number
    startClientY: number
    originX: number
    originY: number
  } | null>(null)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const itemCount = settings?.items.length ?? 0
  const activeSettingsIndex = itemCount > 0 ? Math.max(0, Math.min(displayIndex, itemCount - 1)) : 0
  const activeSettingsItem = settings ? settings.items[activeSettingsIndex] ?? null : null
  const activeItemText = (activeSettingsItem?.text ?? '').trim()
  const activeItemNote = activeSettingsItem?.note ?? ''
  const sendHotkey = settings?.sendHotkey?.trim() || null
  const overlayToggleHotkey = settings?.overlayToggleHotkey?.trim() || null
  const mainToggleHotkey = settings?.mainToggleHotkey?.trim() || null
  const overlayEditHotkey = settings?.overlayEditHotkey?.trim() || null
  const appEnabled = settings?.appEnabled ?? true
  const isInteractiveRuntime = !!(settings?.appEnabled && settings?.overlayInteractive)
  const [editModeTransitionPhase, setEditModeTransitionPhase] = useState<'idle' | 'enter' | 'exit'>('idle')
  const activeToolboxElement: EditableElement = selectedElement === 'note' && !activeItemNote ? 'text' : selectedElement

  const setToolForElement = useCallback(
    (target: EditableElement, nextTool: OverlayToolId | null) => {
      setActiveToolByElement((current) => {
        if (current[target] === nextTool) return current
        return {
          ...current,
          [target]: nextTool,
        }
      })
    },
    [],
  )

  const setActiveTool = useCallback(
    (nextTool: OverlayToolId | null) => {
      setToolForElement(activeToolboxElement, nextTool)
    },
    [activeToolboxElement, setToolForElement],
  )

  const resetAllToolboxStates = useCallback(() => {
    setActiveToolByElement((current) => (hasAnyActiveTool(current) ? createDefaultActiveToolByElement() : current))
  }, [])

  const playTextEnabled = false
  const playImageCardEnabled = false

  const handleWindowRectChange = useCallback((panel: MorphTarget, rect: OverlayRectSnapshot | null) => {
    windowRectsRef.current = { ...windowRectsRef.current, [panel]: rect }
    setWindowRects((current) => {
      if (isSameRectSnapshot(current[panel], rect)) return current
      return { ...current, [panel]: rect }
    })
  }, [])

  const handleImageCardStateChange = useCallback((next: OverlayImageCardState) => {
    setImageCardState((current) => (isSameImageCardState(current, next) ? current : next))
  }, [])

  const runMorph = useCallback(
    (
      target: MorphTarget,
      direction: MorphDirection,
      fromRect: OverlayRectSnapshot | null,
      toRect: OverlayRectSnapshot | null,
    ) => {
      if (prefersReducedMotion) return false
      if (!isValidRectSnapshot(fromRect) || !isValidRectSnapshot(toRect)) return false
      if (isNearlySameRect(fromRect, toRect)) return false

      const durationMs = direction === 'toEdit' ? MORPH_ENTER_DURATION_MS : MORPH_EXIT_DURATION_MS
      const id = morphIdRef.current + 1
      morphIdRef.current = id
      const token = morphTargetTokenRef.current[target] + 1
      morphTargetTokenRef.current[target] = token

      setHiddenByMorphTargets((current) => (current[target] ? current : { ...current, [target]: true }))
      setMorphGhosts((current) => [
        ...current,
        {
          id,
          target,
          direction,
          running: false,
          from: fromRect,
          to: toRect,
          text:
            target === 'text'
              ? {
                  title: activeItemText || t(settings?.uiLanguage ?? 'vi', 'overlay.hudEmpty'),
                  note: activeItemNote,
                }
              : undefined,
          image:
            target === 'image'
              ? {
                  previewDataUrl: imageCardState.previewDataUrl,
                  imageName: imageCardState.imageName,
                  isSearching: imageCardState.isSearching,
                  resultsCount: imageCardState.resultsCount,
                  lensError: imageCardState.lensError,
                }
              : undefined,
        },
      ])

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setMorphGhosts((current) => current.map((ghost) => (ghost.id === id ? { ...ghost, running: true } : ghost)))
        })
      })

      const timerId = window.setTimeout(() => {
        morphTimersRef.current = morphTimersRef.current.filter((value) => value !== timerId)
        setMorphGhosts((current) => current.filter((ghost) => ghost.id !== id))
        if (morphTargetTokenRef.current[target] === token) {
          setHiddenByMorphTargets((current) => (current[target] ? { ...current, [target]: false } : current))
        }
      }, durationMs + 34)
      morphTimersRef.current.push(timerId)

      return true
    },
    [activeItemNote, activeItemText, imageCardState, prefersReducedMotion, settings?.uiLanguage],
  )

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
  }, [
    settings?.counterOpacity,
    settings?.fontSize,
    settings?.iconOpacity,
    settings?.noteColor,
    settings?.noteOpacity,
    settings?.noteSize,
    settings?.opacity,
    settings?.textColor,
  ])

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
    if (activeItemNote) return
    setActiveToolByElement((current) => (current.note ? { ...current, note: null } : current))
  }, [activeItemNote])

  useEffect(() => {
    if (!settings || settings.appEnabled) return
    if (!settings.overlayVisible && !settings.overlayInteractive) return
    void updateSettings({
      overlayVisible: false,
      overlayInteractive: false,
    })
  }, [settings, updateSettings])

  useEffect(() => {
    if (!settings?.overlayInteractive || !settings?.appEnabled) {
      setIsOpacityEditing(false)
    }
    if (!settings?.appEnabled) {
      resetAllToolboxStates()
    }
  }, [resetAllToolboxStates, settings?.appEnabled, settings?.overlayInteractive])

  useEffect(() => {
    if (settings?.overlayInteractive && settings?.appEnabled) return
    setIsToolboxOpen(false)
    setIsOpacityEditing(false)
    setIsHudOpacityOpen(false)
    setActiveToolByElement((current) => (hasAnyActiveTool(current) ? createDefaultActiveToolByElement() : current))
    setHoveredElement(null)
  }, [settings?.appEnabled, settings?.overlayInteractive])

  useEffect(() => {
    if (isInteractiveRuntime) return
    imageCardDragRef.current = null
    setImageCardDraftOffset(null)
  }, [isInteractiveRuntime])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      setPrefersReducedMotion(media.matches)
    }
    apply()
    const handleChange = () => apply()
    media.addEventListener('change', handleChange)
    return () => {
      media.removeEventListener('change', handleChange)
    }
  }, [])

  useEffect(() => {
    if (!prefersReducedMotion) return
    for (const timerId of morphTimersRef.current) {
      window.clearTimeout(timerId)
    }
    morphTimersRef.current = []
    setMorphGhosts([])
    setHiddenByMorphTargets({ text: false, image: false })
  }, [prefersReducedMotion])

  useLayoutEffect(() => {
    if (!isInteractiveRuntime && playTextEnabled) {
      playRectsRef.current.text = toRectSnapshotFromElement(textHudRef.current)
    }
    if (!isInteractiveRuntime && playImageCardEnabled) {
      playRectsRef.current.image = toRectSnapshotFromElement(imageCardRef.current)
    }
  }, [displayIndex, imageCardDraftOffset, imageCardState.previewDataUrl, isInteractiveRuntime, playImageCardEnabled, playTextEnabled])

  useEffect(() => {
    let rafOne: number | null = null
    let rafTwo: number | null = null

    const previous = previousInteractiveRef.current
    if (previous === null) {
      previousInteractiveRef.current = isInteractiveRuntime
      return () => {
        if (rafOne !== null) window.cancelAnimationFrame(rafOne)
        if (rafTwo !== null) window.cancelAnimationFrame(rafTwo)
      }
    }
    if (previous === isInteractiveRuntime) {
      return () => {
        if (rafOne !== null) window.cancelAnimationFrame(rafOne)
        if (rafTwo !== null) window.cancelAnimationFrame(rafTwo)
      }
    }
    previousInteractiveRef.current = isInteractiveRuntime
    if (editModeAnimationTimerRef.current !== null) {
      window.clearTimeout(editModeAnimationTimerRef.current)
      editModeAnimationTimerRef.current = null
    }
    setEditModeTransitionPhase(isInteractiveRuntime ? 'enter' : 'exit')
    editModeAnimationTimerRef.current = window.setTimeout(() => {
      editModeAnimationTimerRef.current = null
      setEditModeTransitionPhase('idle')
    }, 260)

    if (isInteractiveRuntime) {
      pendingMorphToEditRef.current = {
        text: playTextEnabled,
        image: playImageCardEnabled,
      }
      return () => {
        if (rafOne !== null) window.cancelAnimationFrame(rafOne)
        if (rafTwo !== null) window.cancelAnimationFrame(rafTwo)
      }
    }

    pendingMorphToEditRef.current = { text: false, image: false }
    rafOne = window.requestAnimationFrame(() => {
      rafTwo = window.requestAnimationFrame(() => {
        const textToRect = playTextEnabled ? toRectSnapshotFromElement(textHudRef.current) : null
        const imageToRect = playImageCardEnabled ? toRectSnapshotFromElement(imageCardRef.current) : null
        const textFromRect = windowRectsRef.current.text
        const imageFromRect = windowRectsRef.current.image
        const textStarted = playTextEnabled ? runMorph('text', 'toPlay', textFromRect, textToRect) : false
        const imageStarted = playImageCardEnabled ? runMorph('image', 'toPlay', imageFromRect, imageToRect) : false

        if (!textStarted) {
          setHiddenByMorphTargets((current) => (current.text ? { ...current, text: false } : current))
        }
        if (!imageStarted) {
          setHiddenByMorphTargets((current) => (current.image ? { ...current, image: false } : current))
        }
      })
    })

    return () => {
      if (rafOne !== null) window.cancelAnimationFrame(rafOne)
      if (rafTwo !== null) window.cancelAnimationFrame(rafTwo)
    }
  }, [isInteractiveRuntime, playImageCardEnabled, playTextEnabled, runMorph])

  useEffect(() => {
    if (!isInteractiveRuntime) return
    const pending = pendingMorphToEditRef.current
    if (!pending.text && !pending.image) return

    let hasUpdate = false
    const nextPending = { ...pending }
    ;(['text', 'image'] as const).forEach((target) => {
      if (!pending[target]) return
      const toRect = windowRectsRef.current[target]
      if (!isValidRectSnapshot(toRect)) return
      const fromRect =
        playRectsRef.current[target] ??
        (target === 'text' ? toRectSnapshotFromElement(textHudRef.current) : toRectSnapshotFromElement(imageCardRef.current))
      runMorph(target, 'toEdit', fromRect, toRect)
      nextPending[target] = false
      hasUpdate = true
    })
    if (hasUpdate) {
      pendingMorphToEditRef.current = nextPending
    }
  }, [isInteractiveRuntime, runMorph, windowRects.image, windowRects.text])

  useEffect(() => {
    if (!isToolboxOpen) {
      setIsOpacityEditing(false)
      setActiveTool(null)
    }
  }, [isToolboxOpen, setActiveTool])

  useEffect(() => {
    if (!isHudOpacityOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!target) return
      if (target.closest('[data-overlay-toolbox="true"]')) return
      setIsHudOpacityOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsHudOpacityOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isHudOpacityOpen])

  useEffect(() => {
    setIsOpacityEditing(
      activeToolByElement.text === 'opacity' ||
        activeToolByElement.note === 'opacity' ||
        activeToolByElement.icon === 'opacity' ||
        activeToolByElement.counter === 'opacity',
    )
  }, [activeToolByElement])

  useEffect(() => {
    if (!settings?.overlayInteractive || !settings?.appEnabled || !isToolboxOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-overlay-toolbox="true"]')) return
      if (target.closest('[data-overlay-hotspot="true"]')) return
      setIsToolboxOpen(false)
      setActiveTool(null)
      setIsOpacityEditing(false)
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [isToolboxOpen, setActiveTool, settings?.appEnabled, settings?.overlayInteractive])

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
    const shouldCaptureOverlay = settings.overlayInteractive && settings.appEnabled

    if (shouldCaptureOverlay) {
      setOverlayPassThrough(false)
      return
    }
    setOverlayPassThrough(true)
  }, [
    setOverlayPassThrough,
    settings?.appEnabled,
    settings?.overlayVisible,
    settings?.overlayInteractive,
  ])

  useEffect(() => {
    if (!settings?.appEnabled || !settings?.overlayVisible || settings?.overlayInteractive) return
    const handleWindowBlur = () => {
      setOverlayTextInteractionActive(false)
    }
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [settings?.appEnabled, settings?.overlayInteractive, settings?.overlayVisible])

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

      if (actionId === 'overlay.capture_probe') {
        if (!current?.appEnabled || !current?.overlayVisible || current.overlayInteractive) return
        setCaptureProbeToken((value) => value + 1)
        return
      }

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
        const toggleNow = Date.now()
        if (toggleNow < appToggleInFlightUntilRef.current) return
        appToggleInFlightUntilRef.current = toggleNow + APP_TOGGLE_ACTION_LOCK_MS
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
            ? 'Đang bật lại app, vui lòng đợi...'
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
        if (current) {
          void updateSettings(
            nextInteractive
              ? {
                  overlayInteractive: true,
                  overlayToolsPanelVisible: true,
                  overlayToolsActiveTab: 'image',
                }
              : { overlayInteractive: false },
          )
        }

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
          if (current) {
            void updateSettings({
              overlayInteractive: current.overlayInteractive,
              overlayToolsPanelVisible: current.overlayToolsPanelVisible,
              overlayToolsActiveTab: current.overlayToolsActiveTab,
            })
          }
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
    const payload: PythonConfigurePayload = {
      text: activeItemText,
      hotkey: sendHotkey,
      press_enter: false,
      block_alt_f4: settings?.blockAltF4WhenEnabled ?? false,
      app_enabled: appEnabled,
      app_toggle_hotkey: null,
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
    mainToggleHotkey,
    settings?.blockAltF4WhenEnabled,
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
      if (editModeAnimationTimerRef.current !== null) {
        window.clearTimeout(editModeAnimationTimerRef.current)
        editModeAnimationTimerRef.current = null
      }
      for (const timerId of morphTimersRef.current) {
        window.clearTimeout(timerId)
      }
      morphTimersRef.current = []
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
      if (event.detail > 1) {
        event.preventDefault()
        return
      }
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
  const rootPointerMode = 'pointer-events-auto'
  const showOverlaySurface = settings.overlayVisible
  const showText = showOverlaySurface && (settings.overlayElementsVisible || isInteractive)
  const showIcon = showOverlaySurface && (settings.overlayShowIcon || isInteractive)
  const showContextHud = false  
  const showImageCard = false
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
  const imageCardOffset = imageCardDraftOffset ?? {
    x: settings.overlayImageCardOffsetXPercent,
    y: settings.overlayImageCardOffsetYPercent,
  }

  const runtimeOpacity = styleDraft.opacity
  const runtimeIconOpacity = styleDraft.iconOpacity
  const effectiveOpacity = isInteractive && !isOpacityEditing ? 1 : runtimeOpacity
  const effectiveIconOpacity =
    isInteractive && !settings.overlayShowIcon ? Math.max(0.3, Math.min(0.45, runtimeIconOpacity)) : runtimeIconOpacity
  const effectiveTextContainerOpacity = isInteractive && !settings.overlayElementsVisible ? 0.58 : 1
  const effectiveHudOpacity = settings.overlayHudContextOpacity
  const effectiveFontSize = styleDraft.fontSize
  const effectiveTextColor = styleDraft.textColor

  const activeElement: EditableElement = activeToolboxElement
  const activeElementLabel = getElementLabel(settings.uiLanguage, activeElement)
  const editableTargets: EditableElement[] = ['icon']
  const textHovered = hoveredElement === 'text'
  const iconHovered = hoveredElement === 'icon'
  const textScale = dragTarget === 'text' || textHovered || (isInteractive && activeElement === 'text') ? 1.02 : 1
  const iconScale = dragTarget === 'icon' || iconHovered || (isInteractive && activeElement === 'icon') ? 1.03 : 1
  const iconWillChange = dragTarget === 'icon' || iconHovered
  const textWillChange = dragTarget === 'text' || textHovered
  const editModeAnimationClass =
    editModeTransitionPhase === 'enter' ? 'qt-edit-enter' : editModeTransitionPhase === 'exit' ? 'qt-edit-exit' : ''
  const currentDisplayText = currentItem?.text?.trim() || t(settings.uiLanguage, 'overlay.hudEmpty')
  const currentDisplayNote = currentItem?.note?.trim() || ''
  const hudTextSize = Math.max(16, effectiveFontSize)
  const hudNoteSize = Math.max(11, Math.round(hudTextSize * 0.54))
  const stopInteractive = async () => {
    setIsOpacityEditing(false)
    setIsToolboxOpen(false)
    setActiveToolByElement((current) => (hasAnyActiveTool(current) ? createDefaultActiveToolByElement() : current))
    if (window.electronAPI?.setOverlayInteraction) {
      await window.electronAPI.setOverlayInteraction(false)
      return
    }
    await updateSettings({ overlayInteractive: false })
  }

  const setHotspotRef = (target: EditableElement) => (node: HTMLElement | null) => {
    hotspotRefs.current[target] = node
  }

  const activateOverlayElement = (target: EditableElement) => {
    setSelectedElement(target)
    setIsToolboxOpen(true)
  }

  const toggleActiveVisibility = async (target: EditableElement) => {
    if (target === 'icon') {
      await updateSettings({ overlayShowIcon: !settings.overlayShowIcon })
      return
    }
    await updateSettings({ overlayElementsVisible: !settings.overlayElementsVisible })
  }

  const startImageCardDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isInteractive) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const container = overlayRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    if (containerRect.width <= 0 || containerRect.height <= 0) return

    const origin = imageCardDraftOffset ?? {
      x: settings.overlayImageCardOffsetXPercent,
      y: settings.overlayImageCardOffsetYPercent,
    }
    let latest = origin
    imageCardDragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    }
    setImageCardDraftOffset(origin)

    const handleMove = (moveEvent: PointerEvent) => {
      const drag = imageCardDragRef.current
      if (!drag) return
      const deltaX = moveEvent.clientX - drag.startClientX
      const deltaY = moveEvent.clientY - drag.startClientY
      latest = {
        x: clampNumber(drag.originX + (deltaX / containerRect.width) * 100, MIN_OFFSET_X_PERCENT, MAX_OFFSET_X_PERCENT),
        y: clampNumber(drag.originY + (deltaY / containerRect.height) * 100, MIN_OFFSET_Y_PERCENT, MAX_OFFSET_Y_PERCENT),
      }
      setImageCardDraftOffset((current) => {
        if (current && current.x === latest.x && current.y === latest.y) return current
        return latest
      })
    }

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      imageCardDragRef.current = null
      setImageCardDraftOffset(null)
      void updateSettings({
        overlayImageCardOffsetXPercent: latest.x,
        overlayImageCardOffsetYPercent: latest.y,
      })
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
  }

  const imageCardStyle = withWillChange(
    {
      ...toOffsetStyle(imageCardOffset.x, imageCardOffset.y, isInteractive ? 1.02 : 1),
      width: `${IMAGE_CARD_WIDTH_PX}px`,
      minHeight: `${IMAGE_CARD_HEIGHT_PX}px`,
      opacity: isInteractive ? Math.min(0.9, effectiveHudOpacity * 0.86) : effectiveHudOpacity,
    },
    showImageCard || isInteractive,
  )

  return (
    <div
      ref={overlayRef}
      className={`relative h-dvh w-full bg-transparent select-none ${rootPointerMode}`}
    >
      {showIcon ? (
        <div
          ref={setHotspotRef('icon')}
          data-overlay-hotspot="true"
          data-overlay-element="icon"
          style={withWillChange(
            {
              ...toOffsetStyle(offsets.iconX, offsets.iconY, iconScale),
              opacity: effectiveIconOpacity,
            },
            iconWillChange,
          )}
          onPointerDown={(event) => startDrag('icon', event)}
          onPointerEnter={() => setHoveredElement('icon')}
          onPointerLeave={() => setHoveredElement((current) => (current === 'icon' ? null : current))}
          onClick={() => {
            if (!isInteractive) return
            activateOverlayElement('icon')
          }}
          className={`absolute z-30 h-14 w-14 overflow-hidden rounded-lg touch-none border qt-motion qt-motion-fast qt-motion-emphasis ${
            isInteractive
              ? dragTarget === 'icon'
                ? 'cursor-grabbing qt-overlay-hud-shell qt-overlay-hud-shell-active'
                : activeElement === 'icon'
                  ? 'cursor-move qt-overlay-hud-shell qt-overlay-hud-shell-active'
                  : 'cursor-move qt-overlay-hud-shell'
              : iconHovered
                ? 'cursor-pointer qt-overlay-hud-shell qt-overlay-hud-shell-hover'
                : 'cursor-default border-transparent bg-transparent'
          } ${isInteractive && !settings.overlayShowIcon ? 'border-dashed' : ''}`}
        >
          <Image src="/icon.png" alt={t(settings.uiLanguage, 'overlay.logoAlt')} fill sizes="56px" className="rounded-lg object-cover" />
        </div>
      ) : null}

      {showContextHud ? (
        <div
          ref={(node) => {
            textHudRef.current = node
            setHotspotRef('text')(node)
          }}
          data-overlay-hotspot="true"
          data-overlay-element="text"
          style={withWillChange(
            {
              ...toOffsetStyle(offsets.textX, offsets.textY, textScale, settings.textAlign),
              opacity: effectiveTextContainerOpacity * effectiveHudOpacity,
            },
            textWillChange,
          )}
          onPointerDown={(event) => startDrag('text', event)}
          onPointerEnter={() => setHoveredElement('text')}
          onPointerLeave={() => setHoveredElement((current) => (current === 'text' ? null : current))}
          onClick={() => {
            if (!isInteractive) return
            activateOverlayElement('text')
          }}
          className={`absolute z-20 max-w-[96%] rounded-xl px-3 py-2 touch-none qt-motion qt-motion-fast qt-motion-emphasis qt-overlay-single ${alignmentClass} ${editModeAnimationClass} ${
            isInteractive
              ? dragTarget === 'text'
                ? 'cursor-grabbing qt-overlay-hud-shell qt-overlay-hud-shell-active'
                : activeElement === 'text'
                  ? 'cursor-move qt-overlay-hud-shell qt-overlay-hud-shell-active'
                  : 'cursor-move qt-overlay-hud-shell'
              : textHovered
                ? 'cursor-text qt-overlay-hud-shell qt-overlay-hud-shell-hover'
                : 'cursor-default border border-transparent bg-transparent'
          } ${isInteractive && !settings.overlayElementsVisible ? 'border-dashed' : ''}`}
        >
          <div className="space-y-1.5">
            <p
              className="break-words whitespace-pre-wrap leading-tight qt-overlay-main-line"
              style={{
                fontSize: `${hudTextSize}px`,
                fontWeight: 800,
                color: withOpacity(effectiveTextColor, effectiveOpacity),
                textShadow: '0 0 10px rgba(0,0,0,0.92), 0 0 18px rgba(0,0,0,0.7)',
              }}
            >
              {currentDisplayText}
            </p>
            {currentDisplayNote ? (
              <p
                className="break-words whitespace-pre-wrap leading-snug qt-overlay-note-line"
                style={{
                  fontSize: `${hudNoteSize}px`,
                  fontWeight: 600,
                  color: withOpacity(effectiveTextColor, effectiveOpacity * 0.86),
                  textShadow: '0 0 8px rgba(0,0,0,0.84)',
                }}
              >
                {currentDisplayNote}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {showImageCard ? (
        <div
          ref={imageCardRef}
          data-overlay-hotspot="true"
          data-overlay-element="image-card"
          style={imageCardStyle}
          onPointerDown={startImageCardDrag}
          className={`absolute z-[26] overflow-hidden rounded-xl border qt-motion qt-motion-fast qt-motion-emphasis qt-overlay-image-card-shell ${
            isInteractive
              ? 'cursor-move qt-overlay-image-card-shell-edit'
              : 'pointer-events-none'
          }`}
        >
          <div className="qt-overlay-image-card-media relative h-[76px] w-full overflow-hidden">
            <Image src={imageCardState.previewDataUrl} alt={imageCardState.imageName || 'image-preview'} fill sizes="248px" className="object-cover" />
          </div>
          <div className="px-2 py-1.5">
            <p className="truncate text-[11px] font-semibold text-[var(--qt-fg)]">{imageCardState.imageName || t(settings.uiLanguage, 'overlayImage.windowTitle')}</p>
            <p className="truncate text-[10px] text-[var(--qt-muted)]">
              {imageCardState.isSearching
                ? t(settings.uiLanguage, 'overlayImage.searching')
                : imageCardState.lensError
                  ? imageCardState.lensError
                  : imageCardState.resultsCount > 0
                    ? `${imageCardState.resultsCount} ${t(settings.uiLanguage, 'overlayImage.searchResults')}`
                    : t(settings.uiLanguage, 'overlayImage.searchNoResult')}
            </p>
          </div>
        </div>
      ) : null}

      {morphGhosts.length > 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[74]">
          {morphGhosts.map((ghost) => (
            <div key={`morph-${ghost.id}`} style={buildMorphGhostStyle(ghost, ghost.running)}>
              {ghost.target === 'text' ? (
                <div className="qt-overlay-surface h-full w-full px-3 py-2">
                  <p className="truncate text-sm font-semibold text-[var(--qt-fg)]">{ghost.text?.title || t(settings.uiLanguage, 'overlay.hudEmpty')}</p>
                  {ghost.text?.note ? <p className="mt-1 line-clamp-2 text-xs text-[var(--qt-muted)]">{ghost.text.note}</p> : null}
                </div>
              ) : (
                <div className="qt-overlay-preview-frame h-full w-full">
                  {ghost.image?.previewDataUrl ? (
                    <div className="relative h-full w-full">
                      <Image src={ghost.image.previewDataUrl} alt={ghost.image.imageName || 'morph-image'} fill sizes="360px" className="object-cover" />
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-[var(--qt-muted)]">
                      {t(settings.uiLanguage, 'overlayImage.searching')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <OverlayUnifiedToolsPanel
        settings={settings}
        updateSettings={updateSettings}
        displayMode="overlay"
        onOverlayTextInteractionChange={setOverlayTextInteractionActive}
        captureProbeToken={captureProbeToken}
        onWindowRectChange={handleWindowRectChange}
        onImageCardStateChange={handleImageCardStateChange}
        hiddenByMorph={hiddenByMorphTargets}
        playText={currentDisplayText}
        playNote={currentDisplayNote}
        playTextColor={effectiveTextColor}
        playTextOpacity={effectiveOpacity * effectiveHudOpacity}
        playTextSize={hudTextSize}
        playNoteSize={hudNoteSize}
        playTextAlign={settings.textAlign}
      />

      {isInteractive ? (
        <>
          <div data-overlay-toolbox="true" className={`absolute right-4 top-4 z-40 flex items-center gap-2 ${editModeAnimationClass}`}>
            <div className="qt-overlay-edit-chip">
              <p className="text-xs font-semibold tracking-wide text-[var(--qt-fg)]">
                {t(settings.uiLanguage, 'overlay.editModeActive')}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{activeElementLabel}</p>
            </div>
            <div className="relative">
              <button
                data-overlay-toolbox="true"
                onClick={() => setIsHudOpacityOpen((current) => !current)}
                className="qt-overlay-edit-btn"
                aria-label={t(settings.uiLanguage, 'overlay.hudOpacity')}
                title={t(settings.uiLanguage, 'overlay.hudOpacityHint')}
              >
                <Palette className="size-3.5" />
                {t(settings.uiLanguage, 'overlay.hudOpacity')}
              </button>
              {isHudOpacityOpen ? (
                <div data-overlay-toolbox="true" className="qt-overlay-popover absolute right-0 top-10 z-50 w-44 p-2">
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={settings.overlayHudContextOpacity}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value)
                      if (!Number.isFinite(value)) return
                      void updateSettings({ overlayHudContextOpacity: value })
                    }}
                    className="w-full accent-[var(--qt-primary)]"
                  />
                </div>
              ) : null}
            </div>
            <button
              data-overlay-toolbox="true"
              onClick={() => void updateSettings({ overlayToolsPanelVisible: !settings.overlayToolsPanelVisible })}
              className={`qt-overlay-edit-btn ${
                settings.overlayToolsPanelVisible
                  ? 'qt-overlay-edit-btn-active'
                  : ''
              }`}
              aria-label={t(settings.uiLanguage, 'settings.overlayTools')}
              title={t(settings.uiLanguage, 'settings.overlayTools')}
            >
              <SlidersHorizontal className="size-3.5" />
              {settings.overlayToolsPanelVisible ? t(settings.uiLanguage, 'main.enabled') : t(settings.uiLanguage, 'main.disabled')}
            </button>
            <button
              data-overlay-toolbox="true"
              onClick={() => void stopInteractive()}
              className="qt-overlay-edit-btn qt-overlay-edit-btn-danger qt-motion qt-motion-fast qt-motion-emphasis hover:scale-105"
              aria-label={t(settings.uiLanguage, 'overlay.exitEdit')}
              title={t(settings.uiLanguage, 'overlay.exitEdit')}
            >
              <X className="size-4" />
            </button>
          </div>

          {(editableTargets as EditableElement[]).map((target) => {
            const isTargetVisible = target === 'text' ? settings.overlayToolsShowTextManager || showContextHud : showIcon
            const isTargetPanelOpen = isTargetVisible && isToolboxOpen && activeElement === target
            if (!isTargetPanelOpen) return null

            const targetActiveTool = activeToolByElement[target] ?? null
            const targetLabel = getElementLabel(settings.uiLanguage, target)
            const targetVisible = target === 'icon' ? settings.overlayShowIcon : settings.overlayElementsVisible
            const targetOpacity = target === 'text' ? runtimeOpacity : runtimeIconOpacity
            const targetSupportsTextStyle = target === 'text'

            return (
              <OverlayElementToolbox
                key={`overlay-toolbox-${target}`}
                language={settings.uiLanguage}
                anchorEl={hotspotRefs.current[target]}
                target={target}
                label={targetLabel}
                activeTool={targetActiveTool}
                visibilityEnabled={targetVisible}
                opacityValue={targetOpacity}
                supportsTextStyle={targetSupportsTextStyle}
                colorValue={effectiveTextColor}
                sizeValue={effectiveFontSize}
                onActivateTarget={() => activateOverlayElement(target)}
                onSetTool={(tool) => {
                  setSelectedElement(target)
                  setIsToolboxOpen(true)
                  setToolForElement(target, tool)
                }}
                onCloseTool={() => {
                  setToolForElement(target, null)
                }}
                onDismissPanel={() => {
                  setToolForElement(target, null)
                  if (activeElement === target) {
                    setIsToolboxOpen(false)
                  }
                }}
                onToggleVisibility={() => void toggleActiveVisibility(target)}
                onOpacityChange={(value) => {
                  if (target === 'text') {
                    setStyleDraft((current) => (current ? { ...current, opacity: value } : current))
                    queueStylePatch({ opacity: value })
                    return
                  }
                  setStyleDraft((current) => (current ? { ...current, iconOpacity: value } : current))
                  queueStylePatch({ iconOpacity: value })
                }}
                onColorChange={(value) => {
                  if (!targetSupportsTextStyle) return
                  setStyleDraft((current) => (current ? { ...current, textColor: value } : current))
                  queueStylePatch({ textColor: value })
                }}
                onSizeChange={(value) => {
                  if (!targetSupportsTextStyle) return
                  setStyleDraft((current) => (current ? { ...current, fontSize: value } : current))
                  queueStylePatch({ fontSize: value })
                }}
                onResetPosition={() => void resetElementPosition(target)}
              />
            )
          })}
        </>
      ) : null}

      {sendFeedbackState !== 'idle' ? (
        <div className="absolute bottom-4 left-4 z-30 max-w-[60%] qt-overlay-fade-in">
          <div className="qt-overlay-float-surface px-3 py-2 qt-motion qt-motion-fast">
            {sendFeedbackState === 'optimistic' || isSending ? (
              <div>
                <p className="text-[11px] tracking-wide text-[var(--qt-muted)]">{t(settings.uiLanguage, 'overlay.sendQueued')}</p>
                <div className="mt-1.5 space-y-1">
                  <div className="qt-overlay-pulse-track w-28 animate-pulse" />
                  <div className="qt-overlay-pulse-track-soft w-20 animate-pulse" />
                </div>
              </div>
            ) : null}
            {sendFeedbackState === 'success' && !isSending ? (
              <p className="qt-overlay-text-success text-xs tracking-wide">{t(settings.uiLanguage, 'overlay.sendSuccess')}</p>
            ) : null}
            {sendFeedbackState === 'error' && !isSending ? (
              <p className="qt-overlay-text-error text-xs tracking-wide">{sendError || t(settings.uiLanguage, 'overlay.sendFailed')}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {actionFeedback.state !== 'idle' ? (
        <div className="absolute bottom-4 right-4 z-30 max-w-[60%] qt-overlay-fade-in">
          <div
            className={`px-3 py-2 qt-motion qt-motion-fast ${
              actionFeedback.state === 'error'
                ? 'qt-overlay-alert qt-overlay-alert-error'
                : actionFeedback.state === 'success'
                  ? 'qt-overlay-alert qt-overlay-alert-info'
                  : 'qt-overlay-float-surface'
            }`}
          >
            {actionFeedback.state === 'optimistic' ? (
              <div className="space-y-1.5">
                <p className="text-[11px] tracking-wide text-[var(--qt-muted)]">{actionFeedback.message}</p>
                <div className="qt-overlay-pulse-track w-24 animate-pulse" />
              </div>
            ) : actionFeedback.state === 'error' ? (
              <p className="qt-overlay-text-error text-xs tracking-wide">{actionFeedback.message}</p>
            ) : (
              <p className="text-xs tracking-wide text-[var(--qt-fg)]">{actionFeedback.message}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default memo(OverlayPageComponent)

type OverlayElementToolboxProps = {
  language: 'vi' | 'en'
  anchorEl: HTMLElement | null
  target: EditableElement
  label: string
  activeTool: OverlayToolId | null
  visibilityEnabled: boolean
  opacityValue: number
  supportsTextStyle: boolean
  colorValue: string
  sizeValue: number
  onActivateTarget: () => void
  onSetTool: (tool: OverlayToolId | null) => void
  onCloseTool: () => void
  onDismissPanel: () => void
  onToggleVisibility: () => void
  onOpacityChange: (value: number) => void
  onColorChange: (value: string) => void
  onSizeChange: (value: number) => void
  onResetPosition: () => void
}

function OverlayElementToolbox({
  language,
  anchorEl,
  target,
  label,
  activeTool,
  visibilityEnabled,
  opacityValue,
  supportsTextStyle,
  colorValue,
  sizeValue,
  onActivateTarget,
  onSetTool,
  onCloseTool,
  onDismissPanel,
  onToggleVisibility,
  onOpacityChange,
  onColorChange,
  onSizeChange,
  onResetPosition,
}: OverlayElementToolboxProps) {
  const [barStyle, setBarStyle] = useState<CSSProperties>(() => toToolboxStyle())
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>(() => toToolboxStyle())
  const [hoverHint, setHoverHint] = useState<HoverHint | null>(null)
  const [hoverHintStyle, setHoverHintStyle] = useState<CSSProperties>(() => toToolboxStyle())
  const liveAnchorRef = useRef<HTMLElement | null>(anchorEl)
  const barStyleRef = useRef<CSSProperties>(barStyle)
  const tooltipStyleRef = useRef<CSSProperties>(tooltipStyle)
  const hoverHintStyleRef = useRef<CSSProperties>(hoverHintStyle)

  const barRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const hoverHintRef = useRef<HTMLDivElement | null>(null)
  const toolButtonRefs = useRef<Record<OverlayToolId, HTMLButtonElement | null>>({
    visibility: null,
    opacity: null,
    color: null,
    resize: null,
  })

  const setToolButtonRef = useCallback(
    (tool: OverlayToolId) => (node: HTMLButtonElement | null) => {
      toolButtonRefs.current[tool] = node
    },
    [],
  )

  const applyBarStyle = useCallback((nextStyle: CSSProperties) => {
    if (isToolboxStyleEqual(barStyleRef.current, nextStyle)) return false
    barStyleRef.current = nextStyle
    setBarStyle(nextStyle)
    return true
  }, [])

  const applyTooltipStyle = useCallback((nextStyle: CSSProperties) => {
    if (isToolboxStyleEqual(tooltipStyleRef.current, nextStyle)) return false
    tooltipStyleRef.current = nextStyle
    setTooltipStyle(nextStyle)
    return true
  }, [])

  const applyHoverHintStyle = useCallback((nextStyle: CSSProperties) => {
    if (isToolboxStyleEqual(hoverHintStyleRef.current, nextStyle)) return false
    hoverHintStyleRef.current = nextStyle
    setHoverHintStyle(nextStyle)
    return true
  }, [])

  const showHoverHint = useCallback((hintLabel: string, hintAnchor: HTMLElement) => {
    setHoverHint({ label: hintLabel, anchorEl: hintAnchor })
  }, [])

  const hideHoverHint = useCallback((hintAnchor: HTMLElement) => {
    setHoverHint((current) => {
      if (!current) return current
      return current.anchorEl === hintAnchor ? null : current
    })
  }, [])

  useEffect(() => {
    liveAnchorRef.current = anchorEl
  }, [anchorEl])

  const resolveLiveAnchor = useCallback(() => {
    const current = liveAnchorRef.current
    if (current && current.isConnected) return current

    const fallback = document.querySelector<HTMLElement>(`[data-overlay-element="${target}"]`)
    if (fallback) {
      liveAnchorRef.current = fallback
      return fallback
    }
    return null
  }, [target])

  useEffect(() => {
    setHoverHint(null)
  }, [activeTool, target])

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return

    let frameId: number | null = null
    let disposed = false
    let lastTickAt = 0

    const updatePosition = () => {
      if (disposed) return
      const liveAnchor = resolveLiveAnchor()
      if (!liveAnchor) {
        applyBarStyle(toToolboxStyle())
        applyTooltipStyle(toToolboxStyle())
        return
      }
      const anchorRect = liveAnchor.getBoundingClientRect()
      const barRect = bar.getBoundingClientRect()
      applyBarStyle(computeHorizontalTooltipStyle(anchorRect, barRect))

      if (!activeTool || !tooltipRef.current) {
        applyTooltipStyle(toToolboxStyle())
        return
      }

      const tooltipAnchorRect = toolButtonRefs.current[activeTool]?.getBoundingClientRect() ?? anchorRect
      const tooltipRect = tooltipRef.current.getBoundingClientRect()
      applyTooltipStyle(computeHorizontalTooltipStyle(tooltipAnchorRect, tooltipRect))
    }

    const trackPosition = (now: number) => {
      if (disposed) return
      if (now - lastTickAt >= TOOLBOX_POSITION_TRACK_INTERVAL_MS) {
        lastTickAt = now
        updatePosition()
      }
      frameId = window.requestAnimationFrame(trackPosition)
    }

    updatePosition()
    frameId = window.requestAnimationFrame(trackPosition)

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      disposed = true
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [activeTool, anchorEl, applyBarStyle, applyTooltipStyle, resolveLiveAnchor])

  useLayoutEffect(() => {
    if (!hoverHint || !hoverHintRef.current) {
      applyHoverHintStyle(toToolboxStyle())
      return
    }
    let frameId: number | null = null
    let disposed = false
    let lastTickAt = 0

    const updatePosition = () => {
      if (disposed) return
      const anchorRect = hoverHint.anchorEl.getBoundingClientRect()
      const hintRect = hoverHintRef.current?.getBoundingClientRect()
      if (!hintRect) return
      applyHoverHintStyle(computeHorizontalTooltipStyle(anchorRect, hintRect))
    }

    const trackPosition = (now: number) => {
      if (disposed) return
      if (now - lastTickAt >= TOOLBOX_POSITION_TRACK_INTERVAL_MS) {
        lastTickAt = now
        updatePosition()
      }
      frameId = window.requestAnimationFrame(trackPosition)
    }

    updatePosition()
    frameId = window.requestAnimationFrame(trackPosition)

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      disposed = true
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [applyHoverHintStyle, hoverHint])

  const opacityPercent = Math.round(opacityValue * 100)
  const activeToolLabel =
    activeTool === 'visibility'
      ? t(language, 'overlay.visibility')
      : activeTool === 'opacity'
        ? t(language, 'overlay.opacity')
        : activeTool === 'color'
          ? t(language, 'overlay.color')
          : activeTool === 'resize'
            ? t(language, 'overlay.size')
            : ''
  const visibilityLabel =
    target === 'icon'
      ? t(language, 'main.overlayShowIcon')
      : target === 'counter'
        ? t(language, 'main.overlayShowCounter')
        : t(language, 'settings.overlayElementsMaster')

  return (
    <>
      <div
        ref={barRef}
        data-overlay-toolbox="true"
        style={barStyle}
        className="qt-overlay-float-surface-strong pointer-events-auto z-50 flex items-center gap-1.5 px-2 py-1.5"
      >
        <button
          data-overlay-toolbox="true"
          onClick={onActivateTarget}
          className="qt-overlay-tool-btn qt-overlay-tool-btn-active"
          title={label}
          aria-label={label}
        >
          {renderElementIcon(target)}
        </button>

        <button
          ref={setToolButtonRef('visibility')}
          data-overlay-toolbox="true"
          onClick={() => onSetTool(activeTool === 'visibility' ? null : 'visibility')}
          className={`qt-overlay-tool-btn ${
            activeTool === 'visibility'
              ? 'qt-overlay-tool-btn-active'
              : ''
          }`}
          title={t(language, 'overlay.visibility')}
          aria-label={t(language, 'overlay.visibility')}
          onMouseEnter={(event) => showHoverHint(t(language, 'overlay.visibility'), event.currentTarget)}
          onMouseLeave={(event) => hideHoverHint(event.currentTarget)}
          onFocus={(event) => showHoverHint(t(language, 'overlay.visibility'), event.currentTarget)}
          onBlur={(event) => hideHoverHint(event.currentTarget)}
        >
          <Eye className="size-3.5" />
        </button>

        <button
          ref={setToolButtonRef('opacity')}
          data-overlay-toolbox="true"
          onClick={() => onSetTool(activeTool === 'opacity' ? null : 'opacity')}
          className={`qt-overlay-tool-btn ${
            activeTool === 'opacity'
              ? 'qt-overlay-tool-btn-active'
              : ''
          }`}
          title={t(language, 'overlay.opacity')}
          aria-label={t(language, 'overlay.opacity')}
          onMouseEnter={(event) => showHoverHint(t(language, 'overlay.opacity'), event.currentTarget)}
          onMouseLeave={(event) => hideHoverHint(event.currentTarget)}
          onFocus={(event) => showHoverHint(t(language, 'overlay.opacity'), event.currentTarget)}
          onBlur={(event) => hideHoverHint(event.currentTarget)}
        >
          <SlidersHorizontal className="size-3.5" />
        </button>

        <button
          ref={setToolButtonRef('color')}
          data-overlay-toolbox="true"
          disabled={!supportsTextStyle}
          onClick={() => onSetTool(activeTool === 'color' ? null : 'color')}
          className={`qt-overlay-tool-btn ${
            activeTool === 'color'
              ? 'qt-overlay-tool-btn-active'
              : ''
          }`}
          title={t(language, 'overlay.color')}
          aria-label={t(language, 'overlay.color')}
          onMouseEnter={(event) => showHoverHint(t(language, 'overlay.color'), event.currentTarget)}
          onMouseLeave={(event) => hideHoverHint(event.currentTarget)}
          onFocus={(event) => showHoverHint(t(language, 'overlay.color'), event.currentTarget)}
          onBlur={(event) => hideHoverHint(event.currentTarget)}
        >
          <Palette className="size-3.5" />
        </button>

        <button
          ref={setToolButtonRef('resize')}
          data-overlay-toolbox="true"
          disabled={!supportsTextStyle}
          onClick={() => onSetTool(activeTool === 'resize' ? null : 'resize')}
          className={`qt-overlay-tool-btn ${
            activeTool === 'resize'
              ? 'qt-overlay-tool-btn-active'
              : ''
          }`}
          title={t(language, 'overlay.size')}
          aria-label={t(language, 'overlay.size')}
          onMouseEnter={(event) => showHoverHint(t(language, 'overlay.size'), event.currentTarget)}
          onMouseLeave={(event) => hideHoverHint(event.currentTarget)}
          onFocus={(event) => showHoverHint(t(language, 'overlay.size'), event.currentTarget)}
          onBlur={(event) => hideHoverHint(event.currentTarget)}
        >
          <Ruler className="size-3.5" />
        </button>

        <button
          data-overlay-toolbox="true"
          onClick={onDismissPanel}
          className="qt-overlay-tool-btn"
          title={t(language, 'overlay.exitEdit')}
          aria-label={t(language, 'overlay.exitEdit')}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {hoverHint ? (
        <div
          ref={hoverHintRef}
          data-overlay-toolbox="true"
          style={hoverHintStyle}
          className="qt-overlay-float-surface pointer-events-none z-[60] max-w-[260px] px-2 py-1 text-[11px] text-[var(--qt-fg)] transition-[left,top] duration-100 ease-out qt-overlay-fade-in"
        >
          {hoverHint.label}
        </div>
      ) : null}

      {activeTool ? (
        <div
          ref={tooltipRef}
          data-overlay-toolbox="true"
          style={tooltipStyle}
          className="qt-overlay-float-surface-strong pointer-events-auto z-[55] w-[340px] max-w-[94vw] p-3 transition-[left,top] duration-100 ease-out qt-overlay-fade-in"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">{activeToolLabel}</p>
            <button
              onClick={onCloseTool}
              className="qt-overlay-tool-btn h-7 w-7"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <p className="qt-overlay-surface mb-2 px-2 py-1 text-[11px] text-[var(--qt-muted)]">
            {label} · {visibilityEnabled ? t(language, 'main.enabled') : t(language, 'main.disabled')} · {opacityPercent}%
          </p>

          {activeTool === 'visibility' ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--qt-muted)]">
                {visibilityLabel} · {visibilityEnabled ? t(language, 'main.enabled') : t(language, 'main.disabled')}
              </p>
              <button
                onClick={onToggleVisibility}
                className="qt-overlay-btn qt-overlay-btn-brand w-full py-1.5"
              >
                {visibilityEnabled ? t(language, 'main.disabled') : t(language, 'main.enabled')}
              </button>
            </div>
          ) : null}

          {activeTool === 'opacity' ? (
            <OverlaySlider
              label={`${t(language, 'overlay.opacity')} · ${label}`}
              value={opacityValue}
              min={0.2}
              max={1}
              step={0.05}
              formatValue={(nextValue) => `${Math.round(clampNumber(nextValue, 0, 1) * 100)}%`}
              onChange={onOpacityChange}
            />
          ) : null}

          {activeTool === 'color' ? (
            supportsTextStyle ? (
              <label className="flex items-center justify-between gap-2 text-xs text-[var(--qt-muted)]">
                <span>{t(language, 'overlay.color')}</span>
                <input
                  type="color"
                  value={colorValue}
                  onChange={(event) => {
                    const parsed = normalizeColorInput(event.target.value)
                    if (!parsed) return
                    onColorChange(parsed)
                  }}
                  className="qt-overlay-surface h-9 w-14 cursor-pointer p-0.5"
                />
              </label>
            ) : (
              <p className="text-xs text-[var(--qt-muted)]">{t(language, 'overlay.selectHint')}</p>
            )
          ) : null}

          {activeTool === 'resize' ? (
            supportsTextStyle ? (
              <OverlaySlider
                label={t(language, 'overlay.size')}
                value={sizeValue}
                min={target === 'text' ? 24 : 12}
                max={target === 'text' ? 120 : 72}
                step={1}
                formatValue={(nextValue) => `${Math.round(nextValue)}px`}
                onChange={onSizeChange}
              />
            ) : (
              <p className="text-xs text-[var(--qt-muted)]">{t(language, 'overlay.selectHint')}</p>
            )
          ) : null}

          <button
            onClick={onResetPosition}
            className="qt-overlay-btn qt-overlay-btn-soft mt-2 w-full py-1.5"
          >
            {t(language, 'overlay.resetPosition')}
          </button>
        </div>
      ) : null}
    </>
  )
}

type OverlaySliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  formatValue?: (value: number) => string
  onChange: (value: number) => void
}

function OverlaySlider({ label, value, min, max, step, formatValue, onChange }: OverlaySliderProps) {
  const safeMin = Number.isFinite(min) ? min : 0
  const safeMax = Number.isFinite(max) ? max : safeMin + 1
  const normalizedMin = Math.min(safeMin, safeMax)
  const normalizedMax = Math.max(safeMin, safeMax)
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1
  const clampedValue = clampNumber(value, normalizedMin, normalizedMax)
  const ratio = normalizedMax === normalizedMin ? 0 : (clampedValue - normalizedMin) / (normalizedMax - normalizedMin)
  const progressPercent = clampNumber(ratio * 100, 0, 100)
  const bubblePercent = clampNumber(ratio * 100, 7, 93)
  const displayValue = formatOverlaySliderValue(clampedValue, safeStep, formatValue)
  const minLabel = formatOverlaySliderValue(normalizedMin, safeStep, formatValue)
  const maxLabel = formatOverlaySliderValue(normalizedMax, safeStep, formatValue)

  return (
    <label className="block text-xs text-[var(--qt-muted)]">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="qt-overlay-range-value">
          {displayValue}
        </span>
      </div>
      <div className="relative mt-2">
        <div className="qt-overlay-range-track pointer-events-none" />
        <div
          className="qt-overlay-range-fill pointer-events-none"
          style={{ width: `${progressPercent}%` }}
        />
        <div
          className="qt-overlay-range-bubble pointer-events-none z-10 qt-overlay-fade-in"
          style={{
            left: `${bubblePercent}%`,
          }}
        >
          {displayValue}
        </div>
        <input
          type="range"
          min={normalizedMin}
          max={normalizedMax}
          step={safeStep}
          value={clampedValue}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value)
            if (Number.isFinite(parsed)) onChange(clampNumber(parsed, normalizedMin, normalizedMax))
          }}
          className="relative z-10 h-6 w-full accent-[var(--qt-primary)]"
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--qt-muted)]/90">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </label>
  )
}

function formatOverlaySliderValue(value: number, step: number, formatter?: (value: number) => string) {
  if (typeof formatter === 'function') return formatter(value)
  if (!Number.isFinite(value)) return '0'

  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  return value.toFixed(decimals).replace(/\.?0+$/, '')
}

function renderElementIcon(target: EditableElement) {
  if (target === 'text') return <Type className="size-3.5" />
  if (target === 'note') return <MessageSquareText className="size-3.5" />
  if (target === 'icon') return <ImageIcon className="size-3.5" />
  return <Hash className="size-3.5" />
}

function toRectSnapshotFromElement(element: HTMLElement | null): OverlayRectSnapshot | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    return null
  }
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function isValidRectSnapshot(rect: OverlayRectSnapshot | null): rect is OverlayRectSnapshot {
  return isRectSnapshotValid(rect)
}

function isSameRectSnapshot(a: OverlayRectSnapshot | null, b: OverlayRectSnapshot | null) {
  if (a === b) return true
  if (!a || !b) return false
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

function isNearlySameRect(a: OverlayRectSnapshot, b: OverlayRectSnapshot) {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

function isSameImageCardState(a: OverlayImageCardState, b: OverlayImageCardState) {
  return (
    a.hasImage === b.hasImage &&
    a.previewDataUrl === b.previewDataUrl &&
    a.imageName === b.imageName &&
    a.isSearching === b.isSearching &&
    a.lensUrl === b.lensUrl &&
    a.lensError === b.lensError &&
    a.resultsCount === b.resultsCount
  )
}

function buildMorphGhostStyle(ghost: MorphGhost, running: boolean): CSSProperties {
  const transform = computeMorphTransform(ghost.from, ghost.to)
  const baseScale = ghost.direction === 'toPlay' ? 0.98 : 1.01
  return {
    position: 'fixed',
    left: `${ghost.from.left}px`,
    top: `${ghost.from.top}px`,
    width: `${ghost.from.width}px`,
    height: `${ghost.from.height}px`,
    transformOrigin: 'top left',
    transform: running
      ? `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scaleX}, ${transform.scaleY})`
      : `scale(${baseScale})`,
    opacity: running ? 0.08 : 0.96,
    transitionProperty: 'transform, opacity',
    transitionDuration: `${ghost.direction === 'toEdit' ? MORPH_ENTER_DURATION_MS : MORPH_EXIT_DURATION_MS}ms`,
    transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
    willChange: 'transform, opacity',
  }
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
    position: 'fixed',
    left: '50%',
    bottom: '4.5rem',
    transform: 'translateX(-50%)',
  }
}

function isToolboxStyleEqual(current: CSSProperties, next: CSSProperties) {
  return (
    current.position === next.position &&
    current.left === next.left &&
    current.top === next.top &&
    current.bottom === next.bottom &&
    current.transform === next.transform
  )
}

function computeHorizontalTooltipStyle(anchorRect: DOMRect, tooltipRect: DOMRect): CSSProperties {
  const { left, top } = computeHorizontalTooltipPlacement(anchorRect, tooltipRect, {
    width: window.innerWidth,
    height: window.innerHeight,
  })

  return {
    position: 'fixed',
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
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
  if (actionId === 'overlay.capture_probe') {
    return INPUT_ACTION_CAPTURE_PROBE_DEBOUNCE_MS
  }
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
    iconOpacity: settings.iconOpacity,
    counterOpacity: settings.counterOpacity,
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
    a.iconOpacity === b.iconOpacity &&
    a.counterOpacity === b.counterOpacity &&
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
