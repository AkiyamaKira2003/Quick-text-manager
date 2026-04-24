'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import Image from 'next/image'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  Globe2,
  ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Move,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import QuickText2ImageLensPanel, { type LensParsedPayload as QuickText2LensParsedPayload } from '@/components/QuickText2ImageLensPanel'
import TextManager from '@/components/TextManager'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/lib/i18n'
import type { LensSearchImageResult, OverlayImageCardState, OverlayRectSnapshot, Settings } from '@/types'

type LensResult = {
  title: string
  url: string
}

type LensFallbackResponse =
  | {
      ok: true
      lensUrl: string
      results: LensResult[]
      extractedText?: string
      aiReply?: string
      translatedReply?: string
      translatedImageSrc?: string
      overviewTitle?: string
      overviewBullets?: string[]
      googleTranslationBullets?: string[]
      parserSource?: 'http' | 'webview' | 'merged'
      fallbackUsed?: boolean
      diagnostics?: unknown
    }
  | {
      ok: false
      error: string
    }

type ImageTranslateHistoryStatus = 'queued' | 'processing' | 'done' | 'error'

type ImageTranslateHistoryEntry = {
  id: string
  signature: string
  status: ImageTranslateHistoryStatus
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
  expiresAt: number
  imageName: string
  previewDataUrl: string
  translatedImageSrc: string
  lensUrl: string
  aiReply: string
  translatedReply: string
  overviewTitle: string
  overviewBullets: string[]
  googleTranslationBullets: string[]
  parserSource: string
  parserStage: string
  resultsCount: number
  error: string
}

type AutoClipboardJob = {
  id: string
  signature: string
  dataUrl: string
  imageName: string
  enqueuedAt: number
}

type AutoClipboardQueueSource = 'poll' | 'paste' | 'probe'

type OverlayImageSessionPayload = {
  previewDataUrl: string
  translatedImageSrc: string
  imageName: string
  lensUrl: string
  lensResults: LensResult[]
  extractedText: string
  aiReply: string
  translatedReply: string
  overviewTitle: string
  overviewBullets: string[]
  googleTranslationBullets: string[]
  lensError: string
  updatedAt: number
}

type OverlayImageSessionCache = {
  previewDataUrl: string
  translatedImageSrc: string
  imageName: string
  lensUrl: string
  lensResults: LensResult[]
  extractedText: string
  aiReply: string
  translatedReply: string
  overviewTitle: string
  overviewBullets: string[]
  googleTranslationBullets: string[]
  lensError: string
  history: ImageTranslateHistoryEntry[]
}

const OVERLAY_IMAGE_SESSION_CACHE: OverlayImageSessionCache = {
  previewDataUrl: '',
  translatedImageSrc: '',
  imageName: '',
  lensUrl: '',
  lensResults: [],
  extractedText: '',
  aiReply: '',
  translatedReply: '',
  overviewTitle: '',
  overviewBullets: [],
  googleTranslationBullets: [],
  lensError: '',
  history: [],
}

type OverlayUnifiedToolsPanelProps = {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => Promise<void>
  displayMode?: 'window' | 'overlay'
  onOverlayTextInteractionChange?: (active: boolean) => void
  captureProbeToken?: number
  onWindowRectChange?: (panel: PanelKey, rect: OverlayRectSnapshot | null) => void
  onImageCardStateChange?: (state: OverlayImageCardState) => void
  hiddenByMorph?: Partial<Record<PanelKey, boolean>>
  playText?: string
  playNote?: string
  playTextColor?: string
  playTextOpacity?: number
  playTextSize?: number
  playNoteSize?: number
  playTextAlign?: Settings['textAlign']
}

type PanelKey = 'text' | 'image'

type Position = {
  x: number
  y: number
}

type Size = {
  width: number
  height: number
}

type PanelPositions = Record<PanelKey, Position>
type PanelSizes = Record<PanelKey, Size>
type PanelHorizontalAlign = 'left' | 'center' | 'right'
type PanelVerticalAlign = 'top' | 'middle' | 'bottom'
type PlayTextContextRole = 'prev' | 'current' | 'next'
type PlayTextContextRow = {
  key: string
  role: PlayTextContextRole
  text: string
  note: string
  empty: boolean
}
const PANEL_GUTTER = 8
const PANEL_DEFAULT_SIZE: Record<PanelKey, { width: number; height: number; minTop: number }> = {
  text: { width: 760, height: 860, minTop: 72 },
  image: { width: 560, height: 760, minTop: 72 },
}
const PANEL_MIN_SIZE: Record<PanelKey, { width: number; height: number }> = {
  text: { width: 520, height: 360 },
  image: { width: 420, height: 320 },
}
const PANEL_MAX_SIZE: Record<PanelKey, { width: number; height: number }> = {
  text: { width: 1400, height: 1100 },
  image: { width: 1200, height: 1100 },
}
const PANEL_EXIT_ANIMATION_MS = 220
const WEBVIEW_LENS_AUTOMATION_TIMEOUT_MS = 16000
const AUTO_CLIPBOARD_IMAGE_POLL_MS = 400
const CAPTURE_PROBE_RETRY_DELAYS_MS = [120, 300, 600, 1000, 1600] as const
const CAPTURE_PROBE_REQUEUE_COOLDOWN_MS = 1800
const QUICK_ADD_BAR_MIN_WIDTH = 280
const QUICK_ADD_BAR_MAX_WIDTH = 520
const QUICK_ADD_BAR_HEIGHT = 56
const PANEL_COLLAPSED_HEADER_HEIGHT = 50
const VIEWPORT_RESIZE_PERSIST_DEBOUNCE_MS = 120
const VIEWPORT_RESIZE_FRAME_INTERVAL_MS = 34

const GOOGLE_LENS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

function createImageClipboardSignature(value: string): string {
  const normalized = String(value || '').trim()
  if (!normalized.startsWith('data:image/')) return ''
  const totalLength = normalized.length
  const head = normalized.slice(0, 180)
  const tail = normalized.slice(-120)
  const midpoint = Math.floor(totalLength / 2)
  const quarter = Math.floor(totalLength / 4)
  const threeQuarter = Math.floor((totalLength * 3) / 4)
  const midA = normalized.slice(Math.max(0, quarter - 24), Math.max(0, quarter + 24))
  const midB = normalized.slice(Math.max(0, midpoint - 24), Math.max(0, midpoint + 24))
  const midC = normalized.slice(Math.max(0, threeQuarter - 24), Math.max(0, threeQuarter + 24))
  return `${totalLength}:${head}:${midA}:${midB}:${midC}:${tail}`
}

function createTranslateHistoryId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => String(item || '').trim()).filter(Boolean)
}

function coerceOverlayImageSessionPayload(input: unknown): OverlayImageSessionPayload | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const previewDataUrl = String(value.previewDataUrl || '').trim()
  const translatedImageSrc = String(value.translatedImageSrc || '').trim()
  const imageName = String(value.imageName || '').trim()
  const lensUrl = String(value.lensUrl || '').trim()
  const lensResults = Array.isArray(value.lensResults)
    ? value.lensResults
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const source = item as Record<string, unknown>
          const title = String(source.title || '').trim()
          const url = String(source.url || '').trim()
          if (!title && !url) return null
          return { title, url }
        })
        .filter((item): item is LensResult => !!item)
    : []
  const extractedText = String(value.extractedText || '').trim()
  const aiReply = String(value.aiReply || '').trim()
  const translatedReply = String(value.translatedReply || '').trim()
  const overviewTitle = String(value.overviewTitle || '').trim()
  const overviewBullets = normalizeStringList(value.overviewBullets)
  const googleTranslationBullets = normalizeStringList(value.googleTranslationBullets)
  const lensError = String(value.lensError || '').trim()
  const updatedAtRaw = Number(value.updatedAt)
  const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : Date.now()

  const hasUsefulPayload =
    previewDataUrl.startsWith('data:image/') ||
    !!translatedImageSrc ||
    !!aiReply ||
    !!translatedReply ||
    !!overviewTitle ||
    overviewBullets.length > 0 ||
    googleTranslationBullets.length > 0 ||
    lensResults.length > 0 ||
    !!lensUrl ||
    !!lensError
  if (!hasUsefulPayload) return null

  return {
    previewDataUrl,
    translatedImageSrc,
    imageName,
    lensUrl,
    lensResults,
    extractedText,
    aiReply,
    translatedReply,
    overviewTitle,
    overviewBullets,
    googleTranslationBullets,
    lensError,
    updatedAt,
  }
}

type ElectronWebviewLike = HTMLElement & {
  executeJavaScript?: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
  getURL?: () => string
  focus?: () => void
  sendInputEvent?: (event: { type: string; keyCode?: string; modifiers?: string[] }) => void
}

function toRectSnapshot(element: HTMLElement | null): OverlayRectSnapshot | null {
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

function colorWithAlpha(input: string, alpha: number): string {
  const normalized = input.trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    const fallback = Math.max(0, Math.min(1, alpha))
    return `rgba(255,255,255,${fallback})`
  }
  const r = Number.parseInt(normalized.slice(1, 3), 16)
  const g = Number.parseInt(normalized.slice(3, 5), 16)
  const b = Number.parseInt(normalized.slice(5, 7), 16)
  const safeAlpha = Math.max(0, Math.min(1, alpha))
  return `rgba(${r},${g},${b},${safeAlpha})`
}

type OverlayIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tip: string
  children: ReactNode
}

function OverlayIconButton({ tip, children, ...props }: OverlayIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button {...props}>{children}</button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" sideOffset={6} className="qt-overlay-portal-tooltip">
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

export default function OverlayUnifiedToolsPanel({
  settings,
  updateSettings,
  displayMode = 'window',
  onOverlayTextInteractionChange,
  captureProbeToken = 0,
  onWindowRectChange,
  onImageCardStateChange,
  hiddenByMorph,
  playText = '',
  playNote = '',
  playTextColor = '#ffffff',
  playTextOpacity = 1,
  playTextSize = 28,
  playNoteSize = 14,
  playTextAlign = 'center',
}: OverlayUnifiedToolsPanelProps) {
  const panelRefs = useRef<Record<PanelKey, HTMLElement | null>>({ text: null, image: null })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const miniWebviewRef = useRef<ElectronWebviewLike | null>(null)
  const workerWebviewRefs = useRef<Array<ElectronWebviewLike | null>>([])
  const workerBusyRef = useRef<Map<number, boolean>>(new Map())
  const dragStateRef = useRef<{
    panel: PanelKey
    originX: number
    originY: number
    startClientX: number
    startClientY: number
  } | null>(null)
  const resizeStateRef = useRef<{
    panel: PanelKey
    startWidth: number
    startHeight: number
    startClientX: number
    startClientY: number
  } | null>(null)
  const exitTimerRef = useRef<number | null>(null)
  const previousEditModeRef = useRef<boolean | null>(null)
  const lastAutoLensRef = useRef<{ signature: string; at: number }>({ signature: '', at: 0 })
  const lensSearchSeqRef = useRef(0)
  const lensFallbackAbortRef = useRef<AbortController | null>(null)
  const autoClipboardPollTimerRef = useRef<number | null>(null)
  const autoClipboardQueueRef = useRef<AutoClipboardJob[]>([])
  const autoClipboardActiveRef = useRef(0)
  const autoClipboardInFlightSignaturesRef = useRef<Map<string, number>>(new Map())
  const probeQueueCooldownRef = useRef<Map<string, number>>(new Map())
  const captureProbeTimersRef = useRef<number[]>([])
  const lastClipboardSignatureRef = useRef(createImageClipboardSignature(OVERLAY_IMAGE_SESSION_CACHE.previewDataUrl))
  const latestAutoClipboardJobIdRef = useRef('')

  const [positions, setPositions] = useState<PanelPositions>(() => ({
    text: { x: settings.overlayToolsPanelX, y: settings.overlayToolsPanelY },
    image: { x: settings.overlayToolsImagePanelX, y: settings.overlayToolsImagePanelY },
  }))
  const [quickAddPosition, setQuickAddPosition] = useState<Position>(() => ({
    x: settings.overlayQuickAddX,
    y: settings.overlayQuickAddY,
  }))
  const [sizes, setSizes] = useState<PanelSizes>(() => ({
    text: {
      width: settings.overlayToolsTextPanelWidth,
      height: settings.overlayToolsTextPanelHeight,
    },
    image: {
      width: settings.overlayToolsImagePanelWidth,
      height: settings.overlayToolsImagePanelHeight,
    },
  }))
  const positionsRef = useRef(positions)
  const quickAddPositionRef = useRef(quickAddPosition)
  const sizesRef = useRef(sizes)
  const [draggingPanel, setDraggingPanel] = useState<PanelKey | null>(null)
  const [resizingPanel, setResizingPanel] = useState<PanelKey | null>(null)
  const [settingsDockPanel, setSettingsDockPanel] = useState<PanelKey | null>(null)
  const [isExitingEditMode, setIsExitingEditMode] = useState(false)
  const [quickViInput, setQuickViInput] = useState('')
  const [quickAddError, setQuickAddError] = useState('')
  const [isQuickAddBusy, setIsQuickAddBusy] = useState(false)
  const [quickAddInputActive, setQuickAddInputActive] = useState(false)
  const quickAddContainerRef = useRef<HTMLElement | null>(null)
  const quickAddInputRef = useRef<HTMLInputElement | null>(null)
  const quickAddDragStateRef = useRef<{
    originX: number
    originY: number
    startClientX: number
    startClientY: number
  } | null>(null)
  const quickAddDragFrameRef = useRef<number | null>(null)
  const quickAddPendingRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const viewportResizeFrameRef = useRef<number | null>(null)
  const viewportResizeLastApplyAtRef = useRef(0)
  const viewportPersistTimerRef = useRef<number | null>(null)
  const pendingViewportPatchRef = useRef<Partial<Settings>>({})

  const [previewDataUrl, setPreviewDataUrl] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.previewDataUrl)
  const [translatedImageSrc, setTranslatedImageSrc] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.translatedImageSrc)
  const [imageName, setImageName] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.imageName)
  const [lensUrl, setLensUrl] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.lensUrl)
  const [lensResults, setLensResults] = useState<LensResult[]>(() => [...OVERLAY_IMAGE_SESSION_CACHE.lensResults])
  const [extractedText, setExtractedText] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.extractedText)
  const [aiReply, setAiReply] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.aiReply)
  const [translatedReply, setTranslatedReply] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.translatedReply)
  const [overviewTitle, setOverviewTitle] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.overviewTitle)
  const [overviewBullets, setOverviewBullets] = useState<string[]>(() => [...OVERLAY_IMAGE_SESSION_CACHE.overviewBullets])
  const [googleTranslationBullets, setGoogleTranslationBullets] = useState<string[]>(
    () => [...OVERLAY_IMAGE_SESSION_CACHE.googleTranslationBullets],
  )
  const [lensError, setLensError] = useState(() => OVERLAY_IMAGE_SESSION_CACHE.lensError)
  const [isSearching, setIsSearching] = useState(false)
  const [isTranslatingReply, setIsTranslatingReply] = useState(false)
  const [imageTranslateHistory, setImageTranslateHistory] = useState<ImageTranslateHistoryEntry[]>(
    () => [...OVERLAY_IMAGE_SESSION_CACHE.history],
  )
  const [autoClipboardQueue, setAutoClipboardQueue] = useState<AutoClipboardJob[]>([])
  const [autoClipboardActiveCount, setAutoClipboardActiveCount] = useState(0)
  const [textWindowCollapsed, setTextWindowCollapsed] = useState(false)
  const [imageWindowCollapsed, setImageWindowCollapsed] = useState(false)
  const [panelToast, setPanelToast] = useState<{ type: 'info' | 'error'; message: string } | null>(null)
  const panelToastTimerRef = useRef<number | null>(null)
  const [miniWebviewReady, setMiniWebviewReady] = useState(false)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const historyLoadedRef = useRef(false)
  const sessionHydratedRef = useRef(false)
  const historySaveTimerRef = useRef<number | null>(null)
  const sessionSaveTimerRef = useRef<number | null>(null)
  const pruneIntervalRef = useRef<number | null>(null)

  const language = settings.uiLanguage
  const textToolVisible = settings.overlayToolsShowTextManager
  const imageToolVisible = settings.overlayToolsShowImageTranslate
  const isOverlayEditMode = settings.appEnabled && settings.overlayInteractive
  const overlayMinimalEditMode = isOverlayEditMode && displayMode === 'overlay'
  const isOverlayDisplayMode = !isOverlayEditMode && displayMode === 'overlay'
  const isPlayMode = displayMode === 'overlay' && settings.appEnabled && settings.overlayVisible && !settings.overlayInteractive
  const textOverlayEnabled = isOverlayDisplayMode && textToolVisible && settings.overlayElementsVisible
  const imageOverlayEnabled = isOverlayDisplayMode && imageToolVisible && settings.overlayPlayShowImageCard
  const textCompactPlay = !isOverlayEditMode && isPlayMode && !isExitingEditMode
  const imageCompactPlay = !isOverlayEditMode && isPlayMode && !isExitingEditMode
  const textGhostVisible = isOverlayEditMode && !textToolVisible
  const imageGhostVisible = isOverlayEditMode && !imageToolVisible
  const shouldRenderTextWindowBase = textToolVisible || textGhostVisible || isExitingEditMode || textOverlayEnabled
  const shouldRenderImageWindowBase = imageToolVisible || imageGhostVisible || isExitingEditMode || imageOverlayEnabled
  const shouldRenderTextWindow = isPlayMode ? true : shouldRenderTextWindowBase
  const shouldRenderImageWindow = isPlayMode ? true : shouldRenderImageWindowBase
  const textIsGhost = !isPlayMode && !textToolVisible && shouldRenderTextWindow
  const imageIsGhost = !isPlayMode && !imageToolVisible && shouldRenderImageWindow
  const modeAnimationClass = isOverlayEditMode ? 'qt-edit-enter' : isExitingEditMode ? 'qt-edit-exit' : ''
  const contentAnimationClass = isOverlayEditMode ? 'qt-overlay-content-enter' : isExitingEditMode ? 'qt-overlay-content-exit' : ''
  const hideTextWindowForMorph = !!hiddenByMorph?.text
  const hideImageWindowForMorph = !!hiddenByMorph?.image
  const miniWebviewUrl = `https://www.google.com/?hl=${encodeURIComponent(language)}`
  const webPreviewUrl = lensUrl || miniWebviewUrl
  const shouldMountMiniWebview = true
  const webPreviewHeight = Math.max(180, Math.min(560, Math.round(settings.overlayToolsWebPreviewHeight || 320)))
  const showMiniWebPreviewBlock =
    shouldMountMiniWebview &&
    !imageIsGhost &&
    !imageCompactPlay &&
    !imageWindowCollapsed &&
    settings.overlayToolsShowWebPreview
  const autoClipboardTranslateEnabled =
    displayMode === 'overlay' &&
    settings.appEnabled &&
    settings.overlayVisible &&
    !settings.overlayInteractive &&
    settings.overlayImageAutoClipboardEnabled
  const autoClipboardMaxConcurrent = Math.max(1, Math.min(6, Math.round(settings.overlayImageAutoClipboardMaxConcurrent || 1)))
  const webviewPoolSize = autoClipboardMaxConcurrent
  const imageHistoryLimit = Math.max(10, Math.min(200, Math.round(settings.overlayImageHistoryLimit || 40)))
  const imageHistoryTtlMs = Math.max(5, Math.min(1440, Math.round(settings.overlayImageHistoryTtlMinutes || 120))) * 60 * 1000
  const compactHistoryVisibleCount = Math.max(1, Math.min(20, Math.round(settings.overlayImageCompactHistoryVisibleCount || 5)))
  const dockCopy = useMemo(
    () => ({
      overlayControls: language === 'vi' ? 'Điều khiển overlay' : 'Overlay controls',
      panelOpacity: t(language, 'overlayTools.windowOpacity'),
      globalOpacity: language === 'vi' ? 'Độ trong suốt tổng' : 'Global opacity',
      nudgePosition: language === 'vi' ? 'Dịch chuyển nhanh' : 'Nudge position',
      snapHorizontal: language === 'vi' ? 'Canh ngang' : 'Horizontal snap',
      snapVertical: language === 'vi' ? 'Canh dọc' : 'Vertical snap',
      left: language === 'vi' ? 'Trái' : 'Left',
      center: language === 'vi' ? 'Giữa' : 'Center',
      right: language === 'vi' ? 'Phải' : 'Right',
      top: language === 'vi' ? 'Trên' : 'Top',
      middle: language === 'vi' ? 'Giữa' : 'Middle',
      bottom: language === 'vi' ? 'Dưới' : 'Bottom',
      moveUp: language === 'vi' ? 'Đẩy lên' : 'Move up',
      moveDown: language === 'vi' ? 'Đẩy xuống' : 'Move down',
      moveLeft: language === 'vi' ? 'Đẩy trái' : 'Move left',
      moveRight: language === 'vi' ? 'Đẩy phải' : 'Move right',
      windowSettings: language === 'vi' ? 'Tùy chỉnh cửa sổ' : 'Window settings',
      closeWindowSettings: language === 'vi' ? 'Đóng tùy chỉnh cửa sổ' : 'Close window settings',
    }),
    [language],
  )

  const blurQuickAddInput = useCallback(() => {
    const input = quickAddInputRef.current
    if (!input) return
    if (document.activeElement === input) {
      input.blur()
    }
  }, [])

  useEffect(() => {
    const workerCount = Math.max(0, webviewPoolSize - 1)
    workerWebviewRefs.current = workerWebviewRefs.current.slice(0, workerCount)
    for (const key of Array.from(workerBusyRef.current.keys())) {
      if (key >= webviewPoolSize) {
        workerBusyRef.current.delete(key)
      }
    }
  }, [webviewPoolSize])

  const playTextContextRows = useMemo<PlayTextContextRow[]>(() => {
    const items = settings.items
    if (!Array.isArray(items) || items.length === 0) {
      return [
        { key: 'prev-empty', role: 'prev', text: '', note: '', empty: true },
        { key: 'current-empty', role: 'current', text: '', note: '', empty: true },
        { key: 'next-empty', role: 'next', text: '', note: '', empty: true },
      ]
    }

    const currentIndex = Math.max(0, Math.min(settings.selectedIndex, items.length - 1))
    const prevItem = currentIndex - 1 >= 0 ? items[currentIndex - 1] : null
    const currentItem = items[currentIndex] ?? null
    const nextItem = currentIndex + 1 < items.length ? items[currentIndex + 1] : null
    const normalize = (value: string | undefined | null) => (typeof value === 'string' ? value.trim() : '')

    return [
      {
        key: `prev-${currentIndex - 1}`,
        role: 'prev',
        text: normalize(prevItem?.text),
        note: normalize(prevItem?.note),
        empty: !prevItem,
      },
      {
        key: `current-${currentIndex}`,
        role: 'current',
        text: normalize(currentItem?.text),
        note: normalize(currentItem?.note),
        empty: !currentItem,
      },
      {
        key: `next-${currentIndex + 1}`,
        role: 'next',
        text: normalize(nextItem?.text),
        note: normalize(nextItem?.note),
        empty: !nextItem,
      },
    ]
  }, [settings.items, settings.selectedIndex])

  const visiblePlayTextContextRows = useMemo<PlayTextContextRow[]>(() => {
    return playTextContextRows.filter((row) => {
      if (row.role === 'current') return true
      return row.text.length > 0 || row.note.length > 0
    })
  }, [playTextContextRows])

  const prevContextIndexRef = useRef<number>(Math.max(0, settings.selectedIndex))
  const [contextAnimationTick, setContextAnimationTick] = useState(0)
  const [contextAnimationDirection, setContextAnimationDirection] = useState<'next' | 'prev'>('next')

  useEffect(() => {
    const items = Array.isArray(settings.items) ? settings.items : []
    if (items.length === 0) {
      prevContextIndexRef.current = 0
      return
    }
    const clampedIndex = Math.max(0, Math.min(settings.selectedIndex, items.length - 1))
    const previousIndex = prevContextIndexRef.current
    if (!Number.isFinite(previousIndex)) {
      prevContextIndexRef.current = clampedIndex
      return
    }
    if (clampedIndex === previousIndex) return

    setContextAnimationDirection(clampedIndex > previousIndex ? 'next' : 'prev')
    setContextAnimationTick((value) => value + 1)
    prevContextIndexRef.current = clampedIndex
  }, [settings.items, settings.selectedIndex])

  const clampSize = useCallback((panel: PanelKey, width: number, height: number): Size => {
    const min = PANEL_MIN_SIZE[panel]
    const max = PANEL_MAX_SIZE[panel]
    const maxWidthByViewport = Math.max(min.width, window.innerWidth - PANEL_GUTTER * 2)
    const maxHeightByViewport = Math.max(min.height, window.innerHeight - PANEL_GUTTER * 2)
    return {
      width: Math.round(Math.min(Math.min(max.width, maxWidthByViewport), Math.max(min.width, width))),
      height: Math.round(Math.min(Math.min(max.height, maxHeightByViewport), Math.max(min.height, height))),
    }
  }, [])

  const clampPosition = useCallback((panel: PanelKey, x: number, y: number, sizeOverride?: Size) => {
    const explicitSize = sizeOverride ?? sizesRef.current[panel]
    const fallback = PANEL_DEFAULT_SIZE[panel]
    const width = explicitSize?.width ?? fallback.width
    const height = explicitSize?.height ?? fallback.height
    const maxX = Math.max(PANEL_GUTTER, window.innerWidth - width - PANEL_GUTTER)
    const maxY = Math.max(fallback.minTop, window.innerHeight - height - PANEL_GUTTER)

    return {
      x: Math.round(Math.min(maxX, Math.max(PANEL_GUTTER, x))),
      y: Math.round(Math.min(maxY, Math.max(fallback.minTop, y))),
    }
  }, [])

  const getQuickAddBarWidthPx = useCallback(() => {
    const viewportWidth = Number.isFinite(window.innerWidth) ? window.innerWidth : 1280
    const maxWidthByViewport = Math.max(QUICK_ADD_BAR_MIN_WIDTH, viewportWidth - PANEL_GUTTER * 2)
    return Math.round(Math.min(QUICK_ADD_BAR_MAX_WIDTH, maxWidthByViewport))
  }, [])

  const clampQuickAddPosition = useCallback(
    (x: number, y: number) => {
      const width = getQuickAddBarWidthPx()
      const maxX = Math.max(PANEL_GUTTER, window.innerWidth - width - PANEL_GUTTER)
      const maxY = Math.max(PANEL_GUTTER, window.innerHeight - QUICK_ADD_BAR_HEIGHT - PANEL_GUTTER)
      return {
        x: Math.round(Math.min(maxX, Math.max(PANEL_GUTTER, x))),
        y: Math.round(Math.min(maxY, Math.max(PANEL_GUTTER, y))),
      }
    },
    [getQuickAddBarWidthPx],
  )

  const setPanelPositionSafe = useCallback(
    (panel: PanelKey, x: number, y: number, sizeOverride?: Size) => {
      const next = clampPosition(panel, x, y, sizeOverride)
      setPositions((current) => {
        const prev = current[panel]
        if (prev.x === next.x && prev.y === next.y) return current
        const updated = { ...current, [panel]: next }
        positionsRef.current = updated
        return updated
      })
      return next
    },
    [clampPosition],
  )

  const setPanelSizeSafe = useCallback(
    (panel: PanelKey, width: number, height: number) => {
      const next = clampSize(panel, width, height)
      setSizes((current) => {
        const prev = current[panel]
        if (prev.width === next.width && prev.height === next.height) return current
        const updated = { ...current, [panel]: next }
        sizesRef.current = updated
        return updated
      })
      return next
    },
    [clampSize],
  )

  const queueViewportSettingsPersist = useCallback(
    (patch: Partial<Settings>) => {
      if (Object.keys(patch).length === 0) return
      pendingViewportPatchRef.current = {
        ...pendingViewportPatchRef.current,
        ...patch,
      }
      if (viewportPersistTimerRef.current !== null) {
        window.clearTimeout(viewportPersistTimerRef.current)
      }
      viewportPersistTimerRef.current = window.setTimeout(() => {
        viewportPersistTimerRef.current = null
        const pending = pendingViewportPatchRef.current
        if (Object.keys(pending).length === 0) return
        pendingViewportPatchRef.current = {}
        void updateSettings(pending)
      }, VIEWPORT_RESIZE_PERSIST_DEBOUNCE_MS)
    },
    [updateSettings],
  )

  useEffect(() => {
    positionsRef.current = positions
  }, [positions])

  useEffect(() => {
    quickAddPositionRef.current = quickAddPosition
  }, [quickAddPosition])

  useEffect(() => {
    sizesRef.current = sizes
  }, [sizes])

  const pushPanelToast = useCallback((type: 'info' | 'error', message: string) => {
    const normalized = message.trim()
    if (!normalized) return
    if (panelToastTimerRef.current !== null) {
      window.clearTimeout(panelToastTimerRef.current)
      panelToastTimerRef.current = null
    }
    setPanelToast({ type, message: normalized })
    panelToastTimerRef.current = window.setTimeout(() => {
      panelToastTimerRef.current = null
      setPanelToast(null)
    }, 2200)
  }, [])

  useEffect(() => {
    return () => {
      if (panelToastTimerRef.current !== null) {
        window.clearTimeout(panelToastTimerRef.current)
        panelToastTimerRef.current = null
      }
      if (autoClipboardPollTimerRef.current !== null) {
        window.clearInterval(autoClipboardPollTimerRef.current)
        autoClipboardPollTimerRef.current = null
      }
      if (lensFallbackAbortRef.current) {
        lensFallbackAbortRef.current.abort()
        lensFallbackAbortRef.current = null
      }
      if (historySaveTimerRef.current !== null) {
        window.clearTimeout(historySaveTimerRef.current)
        historySaveTimerRef.current = null
      }
      if (sessionSaveTimerRef.current !== null) {
        window.clearTimeout(sessionSaveTimerRef.current)
        sessionSaveTimerRef.current = null
      }
      if (captureProbeTimersRef.current.length > 0) {
        for (const timerId of captureProbeTimersRef.current) {
          window.clearTimeout(timerId)
        }
        captureProbeTimersRef.current = []
      }
      if (quickAddDragFrameRef.current !== null) {
        window.cancelAnimationFrame(quickAddDragFrameRef.current)
        quickAddDragFrameRef.current = null
      }
      if (viewportResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportResizeFrameRef.current)
        viewportResizeFrameRef.current = null
      }
      viewportResizeLastApplyAtRef.current = 0
      if (viewportPersistTimerRef.current !== null) {
        window.clearTimeout(viewportPersistTimerRef.current)
        viewportPersistTimerRef.current = null
      }
      pendingViewportPatchRef.current = {}
    }
  }, [])

  useEffect(() => {
    OVERLAY_IMAGE_SESSION_CACHE.previewDataUrl = previewDataUrl
    OVERLAY_IMAGE_SESSION_CACHE.translatedImageSrc = translatedImageSrc
    OVERLAY_IMAGE_SESSION_CACHE.imageName = imageName
    OVERLAY_IMAGE_SESSION_CACHE.lensUrl = lensUrl
    OVERLAY_IMAGE_SESSION_CACHE.lensResults = [...lensResults]
    OVERLAY_IMAGE_SESSION_CACHE.extractedText = extractedText
    OVERLAY_IMAGE_SESSION_CACHE.aiReply = aiReply
    OVERLAY_IMAGE_SESSION_CACHE.translatedReply = translatedReply
    OVERLAY_IMAGE_SESSION_CACHE.overviewTitle = overviewTitle
    OVERLAY_IMAGE_SESSION_CACHE.overviewBullets = [...overviewBullets]
    OVERLAY_IMAGE_SESSION_CACHE.googleTranslationBullets = [...googleTranslationBullets]
    OVERLAY_IMAGE_SESSION_CACHE.lensError = lensError
    OVERLAY_IMAGE_SESSION_CACHE.history = [...imageTranslateHistory]
  }, [
    aiReply,
    extractedText,
    googleTranslationBullets,
    imageTranslateHistory,
    imageName,
    lensError,
    lensResults,
    lensUrl,
    overviewBullets,
    overviewTitle,
    previewDataUrl,
    translatedImageSrc,
    translatedReply,
  ])

  useEffect(() => {
    if (draggingPanel || resizingPanel) return
    setPositions((current) => {
      const nextText = clampPosition('text', settings.overlayToolsPanelX, settings.overlayToolsPanelY)
      const nextImage = clampPosition('image', settings.overlayToolsImagePanelX, settings.overlayToolsImagePanelY)
      const same =
        current.text.x === nextText.x &&
        current.text.y === nextText.y &&
        current.image.x === nextImage.x &&
        current.image.y === nextImage.y
      if (same) return current
      const updated: PanelPositions = {
        text: nextText,
        image: nextImage,
      }
      positionsRef.current = updated
      return updated
    })
  }, [
    clampPosition,
    draggingPanel,
    resizingPanel,
    settings.overlayToolsImagePanelX,
    settings.overlayToolsImagePanelY,
    settings.overlayToolsPanelX,
    settings.overlayToolsPanelY,
  ])

  useEffect(() => {
    if (quickAddDragStateRef.current) return
    setQuickAddPosition((current) => {
      const next = clampQuickAddPosition(settings.overlayQuickAddX, settings.overlayQuickAddY)
      if (current.x === next.x && current.y === next.y) return current
      quickAddPositionRef.current = next
      return next
    })
  }, [clampQuickAddPosition, settings.overlayQuickAddX, settings.overlayQuickAddY])

  useEffect(() => {
    if (resizingPanel) return
    setSizes((current) => {
      const nextText = clampSize('text', settings.overlayToolsTextPanelWidth, settings.overlayToolsTextPanelHeight)
      const nextImage = clampSize('image', settings.overlayToolsImagePanelWidth, settings.overlayToolsImagePanelHeight)
      const same =
        current.text.width === nextText.width &&
        current.text.height === nextText.height &&
        current.image.width === nextImage.width &&
        current.image.height === nextImage.height
      if (same) return current
      const updated: PanelSizes = {
        text: nextText,
        image: nextImage,
      }
      sizesRef.current = updated
      return updated
    })
  }, [
    clampSize,
    resizingPanel,
    settings.overlayToolsImagePanelHeight,
    settings.overlayToolsImagePanelWidth,
    settings.overlayToolsTextPanelHeight,
    settings.overlayToolsTextPanelWidth,
  ])

  useEffect(() => {
    const applyViewportResize = () => {
      const current = positionsRef.current
      const currentSizes = sizesRef.current
      const nextTextSize = clampSize('text', currentSizes.text.width, currentSizes.text.height)
      const nextImageSize = clampSize('image', currentSizes.image.width, currentSizes.image.height)
      const nextSizes: PanelSizes = {
        text: nextTextSize,
        image: nextImageSize,
      }
      const sizePatch: Partial<Settings> = {}
      if (nextTextSize.width !== currentSizes.text.width || nextTextSize.height !== currentSizes.text.height) {
        sizePatch.overlayToolsTextPanelWidth = nextTextSize.width
        sizePatch.overlayToolsTextPanelHeight = nextTextSize.height
      }
      if (nextImageSize.width !== currentSizes.image.width || nextImageSize.height !== currentSizes.image.height) {
        sizePatch.overlayToolsImagePanelWidth = nextImageSize.width
        sizePatch.overlayToolsImagePanelHeight = nextImageSize.height
      }

      const nextText = clampPosition('text', current.text.x, current.text.y)
      const nextImage = clampPosition('image', current.image.x, current.image.y)
      const currentQuickAdd = quickAddPositionRef.current
      const nextQuickAdd = clampQuickAddPosition(currentQuickAdd.x, currentQuickAdd.y)
      const patch: Partial<Settings> = {}

      if (nextText.x !== current.text.x || nextText.y !== current.text.y) {
        patch.overlayToolsPanelX = nextText.x
        patch.overlayToolsPanelY = nextText.y
      }
      if (nextImage.x !== current.image.x || nextImage.y !== current.image.y) {
        patch.overlayToolsImagePanelX = nextImage.x
        patch.overlayToolsImagePanelY = nextImage.y
      }
      if (nextQuickAdd.x !== currentQuickAdd.x || nextQuickAdd.y !== currentQuickAdd.y) {
        patch.overlayQuickAddX = nextQuickAdd.x
        patch.overlayQuickAddY = nextQuickAdd.y
      }

      if (Object.keys(sizePatch).length > 0) {
        sizesRef.current = nextSizes
        setSizes(nextSizes)
      }
      const updated: PanelPositions = {
        text: nextText,
        image: nextImage,
      }
      if (Object.keys(patch).length > 0) {
        positionsRef.current = updated
        setPositions(updated)
      }
      if (nextQuickAdd.x !== currentQuickAdd.x || nextQuickAdd.y !== currentQuickAdd.y) {
        quickAddPositionRef.current = nextQuickAdd
        setQuickAddPosition(nextQuickAdd)
      }
      if (Object.keys(patch).length > 0 || Object.keys(sizePatch).length > 0) {
        queueViewportSettingsPersist({ ...sizePatch, ...patch })
      }
    }

    const runViewportResizeFrame = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const elapsed = now - viewportResizeLastApplyAtRef.current
      if (elapsed < VIEWPORT_RESIZE_FRAME_INTERVAL_MS) {
        viewportResizeFrameRef.current = window.requestAnimationFrame(runViewportResizeFrame)
        return
      }
      viewportResizeFrameRef.current = null
      viewportResizeLastApplyAtRef.current = now
      applyViewportResize()
    }

    const handleResize = () => {
      if (viewportResizeFrameRef.current !== null) return
      viewportResizeFrameRef.current = window.requestAnimationFrame(runViewportResizeFrame)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (viewportResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportResizeFrameRef.current)
        viewportResizeFrameRef.current = null
      }
    }
  }, [clampPosition, clampQuickAddPosition, clampSize, queueViewportSettingsPersist])

  const persistPosition = useCallback(
    (panel: PanelKey, position: Position) => {
      if (panel === 'text') {
        if (position.x === settings.overlayToolsPanelX && position.y === settings.overlayToolsPanelY) return
        void updateSettings({
          overlayToolsPanelX: position.x,
          overlayToolsPanelY: position.y,
        })
        return
      }

      if (position.x === settings.overlayToolsImagePanelX && position.y === settings.overlayToolsImagePanelY) return
      void updateSettings({
        overlayToolsImagePanelX: position.x,
        overlayToolsImagePanelY: position.y,
      })
    },
    [
      settings.overlayToolsImagePanelX,
      settings.overlayToolsImagePanelY,
      settings.overlayToolsPanelX,
      settings.overlayToolsPanelY,
      updateSettings,
    ],
  )

  const persistSize = useCallback(
    (panel: PanelKey, size: Size) => {
      if (panel === 'text') {
        if (size.width === settings.overlayToolsTextPanelWidth && size.height === settings.overlayToolsTextPanelHeight) return
        void updateSettings({
          overlayToolsTextPanelWidth: size.width,
          overlayToolsTextPanelHeight: size.height,
        })
        return
      }
      if (size.width === settings.overlayToolsImagePanelWidth && size.height === settings.overlayToolsImagePanelHeight) return
      void updateSettings({
        overlayToolsImagePanelWidth: size.width,
        overlayToolsImagePanelHeight: size.height,
      })
    },
    [
      settings.overlayToolsImagePanelHeight,
      settings.overlayToolsImagePanelWidth,
      settings.overlayToolsTextPanelHeight,
      settings.overlayToolsTextPanelWidth,
      updateSettings,
    ],
  )

  const persistQuickAddPosition = useCallback(
    (position: Position) => {
      if (position.x === settings.overlayQuickAddX && position.y === settings.overlayQuickAddY) return
      void updateSettings({
        overlayQuickAddX: position.x,
        overlayQuickAddY: position.y,
      })
    },
    [settings.overlayQuickAddX, settings.overlayQuickAddY, updateSettings],
  )

  const translateViToKo = useCallback(
    async (text: string) => {
      const response = await fetch('/api/quick-add-translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          sourceLang: 'vi',
          targetLang: 'ko',
        }),
      })

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        translatedText?: string
      } | null

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || t(language, 'tm.quickAddTranslateFailed'))
      }

      const translatedText = String(payload.translatedText || '').trim()
      if (!translatedText) {
        throw new Error(t(language, 'tm.quickAddTranslateEmpty'))
      }

      return translatedText
    },
    [language],
  )

  const translateTextToVietnamese = useCallback(
    async (text: string) => {
      const sourceText = text.trim()
      if (!sourceText) return ''

      const response = await fetch('/api/image-translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sourceText,
          sourceLang: 'auto',
          targetLang: 'vi',
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean
            translatedText?: string
            error?: string
          }
        | null

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || t(language, 'overlayImage.errorTranslate'))
      }

      return String(payload.translatedText || '').trim()
    },
    [language],
  )

  const handleQuickAdd = useCallback(async () => {
    if (isQuickAddBusy) return
    const sourceText = quickViInput.trim()
    if (!sourceText) return

    setIsQuickAddBusy(true)
    setQuickAddError('')
    try {
      const translatedText = await translateViToKo(sourceText)
      const newItems = [...settings.items, { text: translatedText, note: sourceText }]
      await updateSettings({
        items: newItems,
        selectedIndex: newItems.length - 1,
      })
      setQuickViInput('')
      blurQuickAddInput()
      setQuickAddInputActive(false)
      onOverlayTextInteractionChange?.(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : t(language, 'tm.quickAddTranslateFailed')
      setQuickAddError(message)
    } finally {
      setIsQuickAddBusy(false)
    }
  }, [blurQuickAddInput, isQuickAddBusy, language, onOverlayTextInteractionChange, quickViInput, settings.items, translateViToKo, updateSettings])

  const startQuickAddDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isOverlayEditMode) return
      if (event.button !== 0) return
      if ((event.target as HTMLElement | null)?.closest('button,input,textarea,select,a,label,[data-no-drag="true"]')) return
      event.preventDefault()
      event.stopPropagation()

      const origin = quickAddPositionRef.current
      quickAddDragStateRef.current = {
        originX: origin.x,
        originY: origin.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
      }

      const applyDragFrame = () => {
        quickAddDragFrameRef.current = null
        const dragState = quickAddDragStateRef.current
        const pending = quickAddPendingRef.current
        if (!dragState || !pending) return
        const deltaX = pending.clientX - dragState.startClientX
        const deltaY = pending.clientY - dragState.startClientY
        const next = clampQuickAddPosition(dragState.originX + deltaX, dragState.originY + deltaY)
        setQuickAddPosition((current) => {
          if (current.x === next.x && current.y === next.y) return current
          quickAddPositionRef.current = next
          return next
        })
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        quickAddPendingRef.current = {
          clientX: moveEvent.clientX,
          clientY: moveEvent.clientY,
        }
        if (quickAddDragFrameRef.current !== null) return
        quickAddDragFrameRef.current = window.requestAnimationFrame(applyDragFrame)
      }

      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
        if (quickAddDragFrameRef.current !== null) {
          window.cancelAnimationFrame(quickAddDragFrameRef.current)
          quickAddDragFrameRef.current = null
          applyDragFrame()
        }
        quickAddPendingRef.current = null
        quickAddDragStateRef.current = null
        persistQuickAddPosition(quickAddPositionRef.current)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [clampQuickAddPosition, isOverlayEditMode, persistQuickAddPosition],
  )

  const startDrag = useCallback(
    (panel: PanelKey, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement | null)?.closest('button,input,textarea,select,a,label,[data-no-drag="true"]')) return
      event.preventDefault()

      const origin = positionsRef.current[panel]
      dragStateRef.current = {
        panel,
        originX: origin.x,
        originY: origin.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
      }
      setDraggingPanel(panel)

      let dragFrameId: number | null = null
      let pendingClientX = event.clientX
      let pendingClientY = event.clientY

      const applyDragFrame = () => {
        dragFrameId = null
        const dragState = dragStateRef.current
        if (!dragState || dragState.panel !== panel) return
        const deltaX = pendingClientX - dragState.startClientX
        const deltaY = pendingClientY - dragState.startClientY
        setPanelPositionSafe(panel, dragState.originX + deltaX, dragState.originY + deltaY)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        pendingClientX = moveEvent.clientX
        pendingClientY = moveEvent.clientY
        if (dragFrameId !== null) return
        dragFrameId = window.requestAnimationFrame(applyDragFrame)
      }

      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
        if (dragFrameId !== null) {
          window.cancelAnimationFrame(dragFrameId)
          dragFrameId = null
          applyDragFrame()
        }

        const dragState = dragStateRef.current
        dragStateRef.current = null
        setDraggingPanel((current) => (current === panel ? null : current))

        if (!dragState || dragState.panel !== panel) return
        const currentPosition = positionsRef.current[panel]
        persistPosition(panel, currentPosition)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [persistPosition, setPanelPositionSafe],
  )

  const startResize = useCallback(
    (panel: PanelKey, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const origin = sizesRef.current[panel]
      resizeStateRef.current = {
        panel,
        startWidth: origin.width,
        startHeight: origin.height,
        startClientX: event.clientX,
        startClientY: event.clientY,
      }
      setResizingPanel(panel)

      let resizeFrameId: number | null = null
      let pendingClientX = event.clientX
      let pendingClientY = event.clientY

      const applyResizeFrame = () => {
        resizeFrameId = null
        const resizeState = resizeStateRef.current
        if (!resizeState || resizeState.panel !== panel) return
        const deltaX = pendingClientX - resizeState.startClientX
        const deltaY = pendingClientY - resizeState.startClientY
        const nextSize = setPanelSizeSafe(panel, resizeState.startWidth + deltaX, resizeState.startHeight + deltaY)
        const currentPosition = positionsRef.current[panel]
        const nextPosition = setPanelPositionSafe(panel, currentPosition.x, currentPosition.y, nextSize)
        positionsRef.current = {
          ...positionsRef.current,
          [panel]: nextPosition,
        }
        sizesRef.current = {
          ...sizesRef.current,
          [panel]: nextSize,
        }
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        pendingClientX = moveEvent.clientX
        pendingClientY = moveEvent.clientY
        if (resizeFrameId !== null) return
        resizeFrameId = window.requestAnimationFrame(applyResizeFrame)
      }

      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
        if (resizeFrameId !== null) {
          window.cancelAnimationFrame(resizeFrameId)
          resizeFrameId = null
          applyResizeFrame()
        }
        const resizeState = resizeStateRef.current
        resizeStateRef.current = null
        setResizingPanel((current) => (current === panel ? null : current))
        if (!resizeState || resizeState.panel !== panel) return
        persistSize(panel, sizesRef.current[panel])
        persistPosition(panel, positionsRef.current[panel])
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [persistPosition, persistSize, setPanelPositionSafe, setPanelSizeSafe],
  )

  const resetLensState = useCallback(() => {
    setLensUrl('')
    setLensResults([])
    setExtractedText('')
    setAiReply('')
    setTranslatedReply('')
    setTranslatedImageSrc('')
    setOverviewTitle('')
    setOverviewBullets([])
    setGoogleTranslationBullets([])
    setLensError('')
  }, [])

  const handleQuickText2ClipboardImage = useCallback(
    (dataUrl: string) => {
      const normalized = String(dataUrl || '').trim()
      if (!normalized.startsWith('data:image/')) return
      setPreviewDataUrl(normalized)
      setImageName(t(language, 'overlayImage.clipboardImageName'))
    },
    [language],
  )

  const handleQuickText2LensStatus = useCallback((status: string, hint?: string) => {
    setIsSearching(status === 'loading')
    if (status === 'loading') {
      setLensError('')
      return
    }
    if ((status === 'manual_required' || status === 'error') && hint?.trim()) {
      setLensError(hint.trim())
    }
  }, [])

  const applyQuickText2LensParsed = useCallback(
    (parsed: QuickText2LensParsedPayload) => {
      const normalizedItems = (Array.isArray(parsed.items) ? parsed.items : []).map((item) => ({
        title: String(item.title || '').trim(),
        url: String(item.url || '').trim(),
        snippet: String(item.snippet || '').trim(),
      }))
      const nextResults = normalizedItems
        .filter((item) => item.title || item.url)
        .map((item) => ({
          title: item.title,
          url: item.url,
        }))

      const nextSourceUrl = String(parsed.sourceUrl || '').trim()
      const nextExtractedText = normalizedItems
        .map((item) => item.snippet)
        .filter(Boolean)
        .join('\n')
        .trim()
      const aiFromPayload = String(parsed.aiReply || '').trim()
      const aiFromItems = normalizedItems
        .map((item) => [item.title, item.snippet].filter(Boolean).join('. ').trim())
        .filter(Boolean)
        .join('\n')
        .trim()
      const canonicalAiReply = aiFromPayload || aiFromItems
      const hint = String(parsed.hint || '').trim()
      const translatedImage = String(parsed.translatedImageSrc || '').trim()

      setLensUrl(nextSourceUrl)
      setLensResults(nextResults)
      setExtractedText(nextExtractedText)
      setAiReply(canonicalAiReply)
      setTranslatedReply('')
      setTranslatedImageSrc(translatedImage)
      setOverviewTitle('')
      setOverviewBullets([])
      setGoogleTranslationBullets([])

      if (parsed.status === 'manual_required' || parsed.status === 'error') {
        const message = hint || t(language, 'overlayImage.errorLens')
        setLensError(message)
        return
      }

      if (!canonicalAiReply && parsed.status === 'ready') {
        setLensError(hint || t(language, 'overlayImage.translationMissing'))
        return
      }

      setLensError(hint)
    },
    [language],
  )

  const requestLensViaFallbackApi = useCallback(
    async (payloadImage: string, signal?: AbortSignal): Promise<LensFallbackResponse> => {
      const response = await fetch('/api/google-lens-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          imageDataUrl: payloadImage,
          hl: language,
          vpw: window.innerWidth,
          vph: window.innerHeight,
          limit: 6,
        }),
      })
      const result = (await response.json().catch(() => null)) as LensFallbackResponse | null
      if (!response.ok || !result) {
        return { ok: false, error: t(language, 'overlayImage.errorLens') }
      }
      return result
    },
    [language],
  )

  const requestLensViaElectron = useCallback(
    async (payloadImage: string): Promise<LensSearchImageResult> => {
      const bridge = window.electronAPI?.lensSearchImage
      if (!bridge) {
        return { ok: false, error: 'Electron bridge unavailable.' }
      }
      return bridge({
        imageDataUrl: payloadImage,
        hl: language,
        vpw: window.innerWidth,
        vph: window.innerHeight,
        limit: 6,
      })
    },
    [language],
  )

  const readMiniWebviewUrl = useCallback((webview: ElectronWebviewLike | null): string => {
    if (!webview || typeof webview.getURL !== 'function') return ''
    try {
      return webview.getURL() || ''
    } catch {
      return ''
    }
  }, [])

  const getPoolWebview = useCallback((index: number): ElectronWebviewLike | null => {
    if (index === 0) return miniWebviewRef.current
    return workerWebviewRefs.current[index - 1] || null
  }, [])

  const ensureWebviewReady = useCallback(
    async (webview: ElectronWebviewLike | null, timeoutMs: number): Promise<ElectronWebviewLike | null> => {
      if (!webview) return null
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        const currentUrl = readMiniWebviewUrl(webview)
        if (currentUrl) return webview
        await new Promise((resolve) => window.setTimeout(resolve, 90))
      }
      return null
    },
    [readMiniWebviewUrl],
  )

  const tryAcquireWebviewSlot = useCallback(
    async (
      preferPrimary: boolean,
    ): Promise<{
      index: number
      webview: ElectronWebviewLike
    } | null> => {
      const indexes: number[] = []
      if (preferPrimary) {
        for (let index = 0; index < webviewPoolSize; index += 1) indexes.push(index)
      } else {
        for (let index = 1; index < webviewPoolSize; index += 1) indexes.push(index)
        indexes.push(0)
      }

      for (const index of indexes) {
        if (workerBusyRef.current.get(index)) continue
        const target = getPoolWebview(index)
        const ready = await ensureWebviewReady(target, index === 0 ? 1800 : 1300)
        if (!ready) continue
        workerBusyRef.current.set(index, true)
        return { index, webview: ready }
      }
      return null
    },
    [ensureWebviewReady, getPoolWebview, webviewPoolSize],
  )

  const waitForWebviewSlot = useCallback(
    async (
      preferPrimary: boolean,
      timeoutMs = 12000,
    ): Promise<{
      index: number
      webview: ElectronWebviewLike
    } | null> => {
      const startedAt = Date.now()
      if (preferPrimary) {
        const primaryGraceDeadline = Math.min(timeoutMs, 2600)
        while (Date.now() - startedAt < primaryGraceDeadline) {
          if (!workerBusyRef.current.get(0)) {
            const primary = getPoolWebview(0)
            const readyPrimary = await ensureWebviewReady(primary, 1200)
            if (readyPrimary) {
              workerBusyRef.current.set(0, true)
              return { index: 0, webview: readyPrimary }
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 110))
        }
      }
      while (Date.now() - startedAt < timeoutMs) {
        const acquired = await tryAcquireWebviewSlot(false)
        if (acquired) return acquired
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      }
      return null
    },
    [ensureWebviewReady, getPoolWebview, tryAcquireWebviewSlot],
  )

  const releaseWebviewSlot = useCallback((index: number | null | undefined) => {
    if (!Number.isInteger(index)) return
    workerBusyRef.current.delete(index as number)
  }, [])

  const waitForMiniWebviewResultPage = useCallback(async (webview: ElectronWebviewLike | null, timeoutMs: number, baselineUrl = ''): Promise<string> => {
    if (!webview) return ''
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const currentUrl = readMiniWebviewUrl(webview)
      if (currentUrl.includes('www.google.com/search?')) {
        if (!baselineUrl || currentUrl !== baselineUrl) return currentUrl
      }
      await new Promise((resolve) => window.setTimeout(resolve, 80))
    }
    return ''
  }, [readMiniWebviewUrl])

  const triggerMiniWebviewSearchSubmit = useCallback(async (webview: ElectronWebviewLike): Promise<boolean> => {
    if (typeof webview.executeJavaScript !== 'function') return false
    const submitScript = `(async () => {
      const clickNode = (node) => {
        if (!node) return false;
        try {
          node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        } catch {
          try {
            node.click();
            return true;
          } catch {
            return false;
          }
        }
      };

      const submitCandidates = [
        document.querySelector('button[jsname="Tg7LZd"]'),
        document.querySelector('button.HZVG1b'),
        document.querySelector('form[role="search"] button[type="submit"]'),
        document.querySelector('form#tsf button[type="submit"]'),
        document.querySelector('button[aria-label*="Tìm kiếm"]'),
        document.querySelector('button[aria-label*="Search"]'),
      ].filter(Boolean);

      for (const node of submitCandidates) {
        if (clickNode(node)) return true;
      }

      const textArea = document.querySelector('textarea[name="q"], textarea#APjFqb');
      if (textArea) {
        try {
          textArea.focus();
          textArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          textArea.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
          textArea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
          return true;
        } catch {}
      }

      const form = document.querySelector('form[role="search"], form#tsf, form[action="/search"]');
      if (form) {
        try {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else if (typeof form.submit === 'function') {
            form.submit();
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          return true;
        } catch {}
      }

      return false;
    })()`

    try {
      const submitted = await webview.executeJavaScript<boolean>(submitScript, true)
      return !!submitted
    } catch {
      return false
    }
  }, [])

  const parseMiniWebviewResult = useCallback(async (webview: ElectronWebviewLike): Promise<LensFallbackResponse | null> => {
    if (typeof webview.executeJavaScript !== 'function') return null

    const parseScript = `(async () => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const unique = (items) => {
        const seen = new Set();
        const output = [];
        for (const item of items) {
          const normalized = normalize(item);
          if (!normalized || seen.has(normalized)) continue;
          seen.add(normalized);
          output.push(normalized);
        }
        return output;
      };
      const toText = (node) => normalize(node?.textContent || '');
      const clickNode = (node) => {
        if (!node) return false;
        try {
          node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        } catch {
          try {
            node.click();
            return true;
          } catch {
            return false;
          }
        }
      };
      const isVisible = (node) => {
        if (!node) return false;
        try {
          const style = window.getComputedStyle(node);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        } catch {
          return false;
        }
      };
      const blockedHeadingTokens = ['thông tin tổng quan do ai tạo', 'ai overview', 'bản dịch', 'translation', 'đường liên kết'];
      const overviewContainer = document.querySelector('div.h7Tj7e');
      const overviewContent =
        overviewContainer?.querySelector('div.D5ad8b') ||
        document.querySelector('div.h7Tj7e div.D5ad8b');
      const root =
        overviewContent ||
        overviewContainer ||
        document.querySelector('div[jsname="V3qe9d"]') ||
        document.querySelector('.bzXtMb.M8OgIe.dRpWwb') ||
        document.querySelector('#Odp5De') ||
        document.querySelector('.Wm5I1e') ||
        document.querySelector('#m-x-content');
      if (!root) {
        return { ok: false, error: 'lens-dom-root-missing' };
      }
      const contentRoot =
        root.querySelector('.LT6XE [jsname="dvXlsc"]') ||
        root.querySelector('.LT6XE .f5cPye') ||
        root.querySelector('.LT6XE') ||
        root.querySelector('[jsname="HKDuG"]') ||
        root;

      const headingNodes = Array.from(
        root.querySelectorAll('[role="heading"], h1, h2, h3, div[jsname="cUzNTd"], .rPeykc'),
      );
      let overviewTitle = '';
      for (const node of headingNodes) {
        const text = toText(node);
        if (!text || text.length < 8) continue;
        const lower = text.toLowerCase();
        if (blockedHeadingTokens.some((token) => lower.includes(token))) continue;
        overviewTitle = text;
        break;
      }

      const translationHeading = headingNodes.find((node) => {
        const lower = toText(node).toLowerCase();
        return lower.includes('bản dịch') || lower.includes('translation');
      });

      const listNodes = Array.from(root.querySelectorAll('li'));
      const overviewBulletsRaw = [];
      const translationBulletsRaw = [];
      if (translationHeading) {
        for (const node of listNodes) {
          const text = toText(node);
          if (!text) continue;
          const relation = translationHeading.compareDocumentPosition(node);
          const isAfterTranslationHeading = !!(relation & Node.DOCUMENT_POSITION_FOLLOWING);
          if (isAfterTranslationHeading) translationBulletsRaw.push(text);
          else overviewBulletsRaw.push(text);
        }
      } else {
        for (const node of listNodes) {
          const text = toText(node);
          if (text) overviewBulletsRaw.push(text);
        }
      }

      const looksLikeCommandLine = (line) => {
        const lower = normalize(line).toLowerCase();
        if (!lower) return true;
        const hardSignals = [
          'google.ia',
          'google.sge',
          'jscontroller',
          'jsaction',
          'data-ved',
          'data-hveid',
          'document.getelementbyid',
          'document.queryselector',
          'window.dispatchevent',
          'function(',
          'function ',
          'const ',
          'let ',
          'var ',
          '=>',
          'spdx-license-identifier',
          'closure library',
        ];
        if (hardSignals.some((token) => lower.includes(token))) return true;
        const punctuationCount = (lower.match(/[{}()[\];=<>]/g) || []).length;
        return punctuationCount >= 10;
      };

      const overviewReplyCandidates = unique(
        Array.from(document.querySelectorAll('div.h7Tj7e div.D5ad8b div.rPeykc'))
          .filter((node) => isVisible(node) || !overviewContainer)
          .map((node) => toText(node)),
      ).filter((line) => {
        const lower = line.toLowerCase();
        if (!line || line.length < 4) return false;
        if (blockedHeadingTokens.some((token) => lower.includes(token))) return false;
        if (looksLikeCommandLine(line)) return false;
        return true;
      });
      const aiOverviewText = overviewReplyCandidates[0] || '';

      const overviewBullets = unique(overviewBulletsRaw).filter((line) => !looksLikeCommandLine(line)).slice(0, 12);
      const googleTranslationBullets = unique(translationBulletsRaw)
        .filter((line) => !looksLikeCommandLine(line))
        .slice(0, 24);
      const translatedReply = googleTranslationBullets.join('\\n').trim();
      const translatedImageNode =
        document.querySelector('div[jscontroller="WJaxDe"].Op3uPd img.yp9wMb') ||
        document.querySelector('div.Op3uPd img.yp9wMb');
      const translatedImageSrc = normalize(translatedImageNode?.getAttribute('src') || translatedImageNode?.src || '');
      const translateButton =
        document.querySelector('button[jsname="TtaS0d"][aria-label="Dịch hình ảnh"]') ||
        document.querySelector('button[jsname="TtaS0d"][aria-label*="Dịch"]') ||
        document.querySelector('button[jsname="TtaS0d"]');
      const translateState = (() => {
        try {
          if (!window.__qtLensTranslateState || typeof window.__qtLensTranslateState !== 'object') {
            window.__qtLensTranslateState = {
              pageHref: '',
              firstClickAt: 0,
              lastClickAt: 0,
              clickCount: 0,
            };
          }
          return window.__qtLensTranslateState;
        } catch {
          return { pageHref: '', firstClickAt: 0, lastClickAt: 0, clickCount: 0 };
        }
      })();
      const currentHref = normalize(location?.href || '');
      if (translateState.pageHref !== currentHref) {
        translateState.pageHref = currentHref;
        translateState.firstClickAt = 0;
        translateState.lastClickAt = 0;
        translateState.clickCount = 0;
      }
      if (translateButton && !translatedImageSrc) {
        if (!translateState.firstClickAt) {
          translateState.firstClickAt = Date.now();
        }
        const lastClickAt = Number(translateState.lastClickAt || 0);
        if (Date.now() - lastClickAt > 700) {
          const clicked = clickNode(translateButton);
          if (clicked) {
            translateState.lastClickAt = Date.now();
            translateState.clickCount = Number(translateState.clickCount || 0) + 1;
          }
        }
      }
      const blockedLineTokens = [
        'ai có thể mắc sai sót',
        'hãy xác minh câu trả lời',
        'đường liên kết có liên quan',
        'related links',
        'gửi ý kiến phản hồi',
        'chia sẻ thêm ý kiến phản hồi',
        'báo cáo vấn đề',
        'chính sách quyền riêng tư',
        'cảm ơn bạn',
        'kéo hình ảnh vào đây',
        'tải tệp lên',
        'dán đường liên kết của hình ảnh',
        'thả ảnh vào vị trí bất kỳ',
        'đang tải lên',
      ];
      const overviewReadableText = (() => {
        try {
          const clone = contentRoot.cloneNode(true);
          clone.querySelectorAll('script,style').forEach((node) => node.remove());
          clone.querySelectorAll('br').forEach((node) => node.replaceWith('\\n'));
          clone.querySelectorAll('li,p,div,h1,h2,h3,h4,h5,h6,section,article').forEach((node) => {
            if (!node.textContent) return;
            if (!/\\n\\s*$/.test(node.textContent)) {
              node.appendChild(document.createTextNode('\\n'));
            }
          });
          const raw = String(clone.textContent || '');
          const lines = raw
            .split(/\\r?\\n+/)
            .map((line) => normalize(line).replace(/^[•\\-–\\s]+/g, '').trim())
            .filter(Boolean);
          const uniqueLines = unique(lines).filter((line) => {
            const lower = line.toLowerCase();
            if (blockedLineTokens.some((token) => lower.includes(token))) return false;
            return !looksLikeCommandLine(line);
          });
          return uniqueLines.join('\\n').trim();
        } catch {
          return '';
        }
      })();
      const looksLikeLensUploadPrompt = (() => {
        const sample = [overviewTitle, overviewReadableText].join('\\n').toLowerCase();
        const promptTokens = [
          'tìm bằng hình ảnh qua google ống kính',
          'kéo hình ảnh vào đây',
          'tải tệp lên',
          'dán đường liên kết của hình ảnh',
          'thả ảnh vào vị trí bất kỳ',
        ];
        return promptTokens.some((token) => sample.includes(token));
      })();
      const aiReply =
        aiOverviewText ||
        translatedReply ||
        overviewReadableText ||
        [overviewTitle, ...overviewBullets].filter(Boolean).join('\\n').trim();

      const collapseButton =
        document.querySelector('button[jsaction*="trigger.XBqW7"]') ||
        document.querySelector('button[aria-label*="Thu gọn"]') ||
        document.querySelector('button[aria-label*="Collapse"]') ||
        document.querySelector('button[aria-label*="collapse"]') ||
        document.querySelector('button.XWrYL');
      if (collapseButton) {
        try {
          collapseButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          collapseButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          collapseButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } catch {}
      }

      const isPromptOnlyResult =
        looksLikeLensUploadPrompt &&
        !translatedReply &&
        overviewBullets.length === 0 &&
        !overviewReadableText;
      if ((!aiReply && !translatedReply && !overviewTitle && overviewBullets.length === 0) || isPromptOnlyResult) {
        return { ok: false, error: 'lens-dom-empty' };
      }

      return {
        ok: true,
        lensUrl: location.href,
        results: [],
        extractedText: '',
        aiReply,
        translatedReply,
        translatedImageSrc,
        overviewTitle,
        overviewBullets,
        googleTranslationBullets,
        parserSource: 'webview',
        fallbackUsed: true,
        diagnostics: {
          source: 'mini-webview',
          hasTranslation: googleTranslationBullets.length > 0,
          hasOverviewText: !!overviewReadableText,
          hasTranslatedImage: !!translatedImageSrc,
          translateClicks: Number(translateState.clickCount || 0),
        },
      };
    })()`

    const parsedResult = await webview.executeJavaScript<LensFallbackResponse | null>(parseScript, true)
    if (!parsedResult || typeof parsedResult !== 'object') return null
    if (parsedResult.ok !== true) return null
    return parsedResult
  }, [])

  const waitForMiniWebviewParsedResult = useCallback(
    async (webview: ElectronWebviewLike, timeoutMs: number): Promise<LensFallbackResponse | null> => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        const parsed = await parseMiniWebviewResult(webview)
        if (parsed?.ok) return parsed
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      }
      return null
    },
    [parseMiniWebviewResult],
  )

  const waitForMiniWebviewTranslatedResult = useCallback(
    async (webview: ElectronWebviewLike, timeoutMs: number): Promise<LensFallbackResponse | null> => {
      const startedAt = Date.now()
      let lastParsed: LensFallbackResponse | null = null
      while (Date.now() - startedAt < timeoutMs) {
        const parsed = await parseMiniWebviewResult(webview)
        if (parsed?.ok) {
          lastParsed = parsed
          if (String(parsed.translatedImageSrc || '').trim()) {
            return parsed
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 160))
      }
      return lastParsed
    },
    [parseMiniWebviewResult],
  )

  const requestLensViaMiniWebview = useCallback(
    async (payloadImage: string, targetWebview?: ElectronWebviewLike | null): Promise<LensFallbackResponse | null> => {
      if (!shouldMountMiniWebview) return null

      const webview = await ensureWebviewReady(targetWebview ?? miniWebviewRef.current, 2400)
      if (!webview || typeof webview.executeJavaScript !== 'function') return null
      if (webview === miniWebviewRef.current) {
        setMiniWebviewReady(true)
      }

      const uploadScript = `(async () => {
        const dataUrl = ${JSON.stringify(payloadImage)};
        if (!/^data:image\\//i.test(dataUrl)) return { ok: false, error: 'invalid-image-data-url' };
        const clickNode = (node) => {
          if (!node) return false;
          try {
            node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
          } catch {
            try {
              node.click();
              return true;
            } catch {
              return false;
            }
          }
        };
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const isVisible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const findFirstVisible = (nodes) => {
          for (const node of nodes) {
            if (node && isVisible(node)) return node;
          }
          return null;
        };
        const findUploadInput = () =>
          document.querySelector('div.NzSfif input[type="file"]') ||
          document.querySelector('div[jsname="zR4bwb"] input[type="file"]');
        const findLensTrigger = () => {
          const iconButton = document.querySelector('svg.Gdd5U')?.closest('button,[role="button"],div[role="button"]');
          const candidates = [
            iconButton,
            document.querySelector('[jscontroller="lpsUAf"]'),
            document.querySelector('[jsname="R5mgy"]'),
            document.querySelector('div[jsname="R5mgy"]'),
            document.querySelector('div.nDcEnd'),
            document.querySelector('button[jsname="x5QEge"]'),
            document.querySelector('button[aria-label*="Google Ống kính"]'),
            document.querySelector('button[aria-label*="Google Lens"]'),
            document.querySelector('button[aria-label*="Tìm bằng hình ảnh"]'),
            document.querySelector('button[aria-label*="Chỉnh sửa nội dung tìm kiếm bằng hình ảnh"]'),
            document.querySelector('button[aria-label*="Tìm kiếm bằng hình ảnh"]'),
            document.querySelector('button[aria-label*="Lens"]'),
            document.querySelector('div[role="button"][aria-label*="Tìm bằng hình ảnh"]'),
            document.querySelector('div[role="button"][aria-label*="Tìm kiếm bằng hình ảnh"]'),
            document.querySelector('div[role="button"][aria-label*="Lens"]'),
          ];
          return findFirstVisible(candidates);
        };
        const findLensDialog = () =>
          findFirstVisible([
            document.querySelector('div.NzSfif'),
            document.querySelector('div[jsname="zR4bwb"]'),
          ]);
        const isLensDialogOpen = () => isVisible(findLensDialog());
        const findUploadEntry = () => {
          const candidates = [
            document.querySelector('div.NzSfif span[jsname="tAPGc"]'),
            document.querySelector('div.NzSfif .DV7the'),
            document.querySelector('div.NzSfif [jsname="WKe3se"]'),
            Array.from(document.querySelectorAll('div.NzSfif span, div.NzSfif button, div.NzSfif div[role="button"]')).find((node) =>
              /tải tệp lên|upload/i.test((node.textContent || '').trim()),
            ),
          ];
          return findFirstVisible(candidates);
        };
        const waitForDialogOpen = async (timeoutMs = 3600) => {
          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            if (isLensDialogOpen()) return true;
            await sleep(80);
          }
          return false;
        };
        const ensureDialogOpen = async () => {
          if (isLensDialogOpen()) return true;
          const trigger = findLensTrigger();
          if (!trigger) return false;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            clickNode(trigger);
            const opened = await waitForDialogOpen(1400);
            if (opened) return true;
            await sleep(100);
          }
          return waitForDialogOpen(1800);
        };
        const waitForInput = async (timeoutMs = 5200) => {
          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            const input = findUploadInput();
            if (input) return input;
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          return null;
        };

        const opened = await ensureDialogOpen();
        if (!opened) return { ok: false, error: 'lens-dialog-not-open' };
        const uploadEntry = findUploadEntry();
        if (uploadEntry) {
          clickNode(uploadEntry);
          await sleep(90);
        }
        const input = await waitForInput(5600);
        if (!input) return { ok: false, error: 'lens-upload-input-not-found' };

        try {
          const blob = await fetch(dataUrl).then((response) => response.blob());
          const extension = blob.type.includes('png')
            ? 'png'
            : blob.type.includes('webp')
              ? 'webp'
              : blob.type.includes('bmp')
                ? 'bmp'
                : blob.type.includes('gif')
                  ? 'gif'
                  : 'jpg';
          const file = new File([blob], \`quicktext-lens-\${Date.now()}.\${extension}\`, { type: blob.type || 'image/png' });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          try {
            input.files = transfer.files;
          } catch {
            Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        } catch {
          return { ok: false, error: 'lens-upload-failed' };
        }
      })()`

      try {
        const baselineUrl = readMiniWebviewUrl(webview)
        const uploadResult = await webview.executeJavaScript<{ ok?: boolean }>(uploadScript, true)
        if (!uploadResult?.ok) return null

        let landedUrl = await waitForMiniWebviewResultPage(webview, WEBVIEW_LENS_AUTOMATION_TIMEOUT_MS, baselineUrl)
        if (!landedUrl) {
          const submitted = await triggerMiniWebviewSearchSubmit(webview)
          if (submitted) {
            landedUrl = await waitForMiniWebviewResultPage(webview, 8200, baselineUrl)
          }
        }
        if (!landedUrl) {
          const parsedWithoutNavigation = await waitForMiniWebviewParsedResult(webview, 3200)
          if (parsedWithoutNavigation?.ok) return parsedWithoutNavigation
          return null
        }
        return waitForMiniWebviewParsedResult(webview, 4200)
      } catch {
        return null
      }
    },
    [
      ensureWebviewReady,
      readMiniWebviewUrl,
      shouldMountMiniWebview,
      triggerMiniWebviewSearchSubmit,
      waitForMiniWebviewParsedResult,
      waitForMiniWebviewResultPage,
    ],
  )

  const requestLensViaMiniWebviewClipboard = useCallback(async (targetWebview?: ElectronWebviewLike | null): Promise<LensFallbackResponse | null> => {
    if (!shouldMountMiniWebview) return null

    const webview = await ensureWebviewReady(targetWebview ?? miniWebviewRef.current, 2600)
    if (!webview || typeof webview.executeJavaScript !== 'function') return null
    if (webview === miniWebviewRef.current) {
      setMiniWebviewReady(true)
    }

    try {
      const tryPasteIntoFocusedWebview = async (): Promise<LensFallbackResponse | null> => {
        try {
          const baselineUrl = readMiniWebviewUrl(webview)
          webview.focus?.()
          if (typeof webview.sendInputEvent !== 'function') return null
          webview.sendInputEvent({ type: 'keyDown', keyCode: 'Control' })
          webview.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] })
          webview.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] })
          webview.sendInputEvent({ type: 'keyUp', keyCode: 'Control' })

          let landedUrl = await waitForMiniWebviewResultPage(webview, WEBVIEW_LENS_AUTOMATION_TIMEOUT_MS, baselineUrl)
          if (!landedUrl) {
            const submitted = await triggerMiniWebviewSearchSubmit(webview)
            if (submitted) {
              landedUrl = await waitForMiniWebviewResultPage(webview, 8200, baselineUrl)
            }
          }
          if (!landedUrl) {
            const parsedWithoutNavigation = await waitForMiniWebviewParsedResult(webview, 3200)
            if (parsedWithoutNavigation?.ok) return parsedWithoutNavigation
            return null
          }
          return waitForMiniWebviewParsedResult(webview, 4200)
        } catch {
          return null
        }
      }

      const directPasteResult = await tryPasteIntoFocusedWebview()
      if (directPasteResult?.ok) return directPasteResult

      const prepareScript = `(async () => {
        const clickNode = (node) => {
          if (!node) return false;
          try {
            node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
          } catch {
            try {
              node.click();
              return true;
            } catch {
              return false;
            }
          }
        };
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const isVisible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const findFirstVisible = (nodes) => {
          for (const node of nodes) {
            if (node && isVisible(node)) return node;
          }
          return null;
        };
        const findLensTrigger = () => {
          const iconButton = document.querySelector('svg.Gdd5U')?.closest('button,[role="button"],div[role="button"]');
          const candidates = [
            iconButton,
            document.querySelector('[jscontroller="lpsUAf"]'),
            document.querySelector('[jsname="R5mgy"]'),
            document.querySelector('div[jsname="R5mgy"]'),
            document.querySelector('div.nDcEnd'),
            document.querySelector('button[jsname="x5QEge"]'),
            document.querySelector('button[aria-label*="Google Ống kính"]'),
            document.querySelector('button[aria-label*="Google Lens"]'),
            document.querySelector('button[aria-label*="Tìm bằng hình ảnh"]'),
            document.querySelector('button[aria-label*="Chỉnh sửa nội dung tìm kiếm bằng hình ảnh"]'),
            document.querySelector('button[aria-label*="Tìm kiếm bằng hình ảnh"]'),
            document.querySelector('button[aria-label*="Lens"]'),
            document.querySelector('div[role="button"][aria-label*="Tìm bằng hình ảnh"]'),
            document.querySelector('div[role="button"][aria-label*="Tìm kiếm bằng hình ảnh"]'),
            document.querySelector('div[role="button"][aria-label*="Lens"]'),
          ];
          return findFirstVisible(candidates);
        };
        const findLensDialog = () =>
          findFirstVisible([
            document.querySelector('div.NzSfif'),
            document.querySelector('div[jsname="zR4bwb"]'),
          ]);
        const isLensDialogOpen = () => isVisible(findLensDialog());
        const findPasteTarget = () =>
          findFirstVisible([
            document.querySelector('div.NzSfif [jsname="WKe3se"]'),
            document.querySelector('div.NzSfif .NrdQVe'),
            document.querySelector('div.NzSfif .f6GA0'),
            document.querySelector('div.NzSfif div[role="button"][tabindex]'),
            document.querySelector('div.NzSfif [tabindex="0"]'),
            findLensDialog(),
          ]);
        const waitForDialogOpen = async (timeoutMs = 3600) => {
          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            if (isLensDialogOpen()) return true;
            await sleep(80);
          }
          return false;
        };
        const ensureDialogOpen = async () => {
          if (isLensDialogOpen()) return true;
          const trigger = findLensTrigger();
          if (!trigger) return false;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            clickNode(trigger);
            const opened = await waitForDialogOpen(1400);
            if (opened) return true;
            await sleep(100);
          }
          return waitForDialogOpen(1800);
        };
        const opened = await ensureDialogOpen();
        if (!opened) return { ok: false, error: 'lens-dialog-not-open' };
        const pasteTarget = findPasteTarget();
        if (!pasteTarget) return { ok: false, error: 'lens-paste-target-missing' };
        try {
          if (typeof pasteTarget.focus === 'function') {
            pasteTarget.focus({ preventScroll: true });
          }
        } catch {
          try {
            pasteTarget.focus();
          } catch {}
        }
        clickNode(pasteTarget);
        await sleep(60);
        clickNode(pasteTarget);
        return { ok: true };
      })()`

      const prepared = await webview.executeJavaScript<{ ok?: boolean }>(prepareScript, true)
      if (!prepared?.ok) return null

      return tryPasteIntoFocusedWebview()
    } catch {
      return null
    }
  }, [
    ensureWebviewReady,
    readMiniWebviewUrl,
    shouldMountMiniWebview,
    triggerMiniWebviewSearchSubmit,
    waitForMiniWebviewParsedResult,
    waitForMiniWebviewResultPage,
  ])

  const applyLensPayload = useCallback(
    (result: {
      lensUrl?: string
      results?: LensResult[]
      extractedText?: string
      aiReply?: string
      translatedReply?: string
      translatedImageSrc?: string
      overviewTitle?: string
      overviewBullets?: string[]
      googleTranslationBullets?: string[]
    }) => {
      const nextLensUrl = typeof result.lensUrl === 'string' ? result.lensUrl : ''
      const nextResults = Array.isArray(result.results) ? result.results : []
      const nextExtractedText = typeof result.extractedText === 'string' ? result.extractedText : ''
      const nextAiReply = typeof result.aiReply === 'string' ? result.aiReply : ''
      const nextTranslatedReply = typeof result.translatedReply === 'string' ? result.translatedReply.trim() : ''
      const nextTranslatedImageSrc = typeof result.translatedImageSrc === 'string' ? result.translatedImageSrc.trim() : ''
      const nextOverviewTitle = typeof result.overviewTitle === 'string' ? result.overviewTitle.trim() : ''
      const nextOverviewBullets = Array.isArray(result.overviewBullets)
        ? result.overviewBullets.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : []
      const nextGoogleTranslationBullets = Array.isArray(result.googleTranslationBullets)
        ? result.googleTranslationBullets.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : []
      const normalizeReplyText = (value: string) => {
        const blockedLineTokens = [
          'ai có thể mắc sai sót',
          'hãy xác minh câu trả lời',
          'đường liên kết có liên quan',
          'related links',
          'gửi ý kiến phản hồi',
          'chia sẻ thêm ý kiến phản hồi',
          'báo cáo vấn đề',
          'chính sách quyền riêng tư',
          'cảm ơn bạn',
          'kéo hình ảnh vào đây',
          'tải tệp lên',
          'dán đường liên kết của hình ảnh',
          'thả ảnh vào vị trí bất kỳ',
          'đang tải lên',
        ]
        const rows = String(value || '')
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((line) => line.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
        const seen = new Set<string>()
        const cleaned: string[] = []
        for (const line of rows) {
          const lower = line.toLowerCase()
          if (blockedLineTokens.some((token) => lower.includes(token))) continue
          if (seen.has(line)) continue
          seen.add(line)
          cleaned.push(line)
        }
        return cleaned.join('\n').trim()
      }
      const canonicalAiReply = (() => {
        const normalizedAiReply = normalizeReplyText(nextAiReply)
        if (normalizedAiReply) return normalizedAiReply
        const mergedTranslation =
          normalizeReplyText([...nextGoogleTranslationBullets].filter(Boolean).join('\n')) || normalizeReplyText(nextTranslatedReply)
        if (mergedTranslation) return mergedTranslation
        const mergedOverview = normalizeReplyText([nextOverviewTitle, ...nextOverviewBullets].filter(Boolean).join('\n'))
        if (mergedOverview) return mergedOverview
        return ''
      })()
      const missingReplyMessage = t(language, 'overlayImage.translationMissing')

      setLensUrl(nextLensUrl)
      setLensResults(nextResults)
      setExtractedText(nextExtractedText)
      setAiReply(canonicalAiReply)
      setTranslatedReply(nextTranslatedReply)
      setTranslatedImageSrc(nextTranslatedImageSrc)
      setOverviewTitle(nextOverviewTitle)
      setOverviewBullets(nextOverviewBullets)
      setGoogleTranslationBullets(nextGoogleTranslationBullets)
      if (canonicalAiReply) {
        setLensError('')
      } else {
        setLensError(missingReplyMessage)
        pushPanelToast('info', missingReplyMessage)
      }
    },
    [language, pushPanelToast],
  )

  const coerceHistoryEntry = useCallback(
    (entry: unknown): ImageTranslateHistoryEntry | null => {
      if (!entry || typeof entry !== 'object') return null
      const value = entry as Record<string, unknown>
      const id = String(value.id || '').trim()
      const signature = String(value.signature || '').trim()
      if (!id || !signature) return null
      const statusRaw = String(value.status || '').trim()
      const status: ImageTranslateHistoryStatus =
        statusRaw === 'queued' || statusRaw === 'processing' || statusRaw === 'done' || statusRaw === 'error'
          ? statusRaw
          : 'queued'
      const createdAtNumber = Number(value.createdAt)
      const createdAt = Number.isFinite(createdAtNumber) && createdAtNumber > 0 ? createdAtNumber : Date.now()
      const startedAtRaw = Number(value.startedAt)
      const finishedAtRaw = Number(value.finishedAt)
      const updatedAtRaw = Number(value.updatedAt)
      const expiresAtRaw = Number(value.expiresAt)
      const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : createdAt
      const expiresAt =
        Number.isFinite(expiresAtRaw) && expiresAtRaw > 0 ? expiresAtRaw : Math.max(updatedAt, createdAt) + imageHistoryTtlMs
      return {
        id,
        signature,
        status,
        createdAt,
        startedAt: Number.isFinite(startedAtRaw) && startedAtRaw > 0 ? startedAtRaw : null,
        finishedAt: Number.isFinite(finishedAtRaw) && finishedAtRaw > 0 ? finishedAtRaw : null,
        updatedAt,
        expiresAt,
        imageName: String(value.imageName || '').trim(),
        previewDataUrl: String(value.previewDataUrl || '').trim(),
        translatedImageSrc: String(value.translatedImageSrc || '').trim(),
        lensUrl: String(value.lensUrl || '').trim(),
        aiReply: String(value.aiReply || '').trim(),
        translatedReply: String(value.translatedReply || '').trim(),
        overviewTitle: String(value.overviewTitle || '').trim(),
        overviewBullets: Array.isArray(value.overviewBullets)
          ? value.overviewBullets.map((line) => String(line || '').trim()).filter(Boolean)
          : [],
        googleTranslationBullets: Array.isArray(value.googleTranslationBullets)
          ? value.googleTranslationBullets.map((line) => String(line || '').trim()).filter(Boolean)
          : [],
        parserSource: String(value.parserSource || '').trim(),
        parserStage: String(value.parserStage || '').trim(),
        resultsCount: Math.max(0, Math.round(Number(value.resultsCount) || 0)),
        error: String(value.error || '').trim(),
      }
    },
    [imageHistoryTtlMs],
  )

  const pruneHistoryEntries = useCallback(
    (entries: ImageTranslateHistoryEntry[] | unknown[], now = Date.now()): ImageTranslateHistoryEntry[] => {
      const dedupe = new Set<string>()
      const normalized: ImageTranslateHistoryEntry[] = []
      for (const entry of entries) {
        const coerced = coerceHistoryEntry(entry)
        if (!coerced) continue
        if (coerced.expiresAt <= now) continue
        const key = `${coerced.id}|${coerced.signature}|${coerced.createdAt}`
        if (dedupe.has(key)) continue
        dedupe.add(key)
        normalized.push(coerced)
      }
      normalized.sort((left, right) => right.createdAt - left.createdAt)
      return normalized.slice(0, imageHistoryLimit)
    },
    [coerceHistoryEntry, imageHistoryLimit],
  )

  const trimHistoryEntries = useCallback(
    (entries: ImageTranslateHistoryEntry[]) => pruneHistoryEntries(entries),
    [pruneHistoryEntries],
  )

  const queueAutoClipboardJob = useCallback(
    (
      dataUrl: string,
      imageLabel?: string,
      options?: {
        source?: AutoClipboardQueueSource
      },
    ): AutoClipboardJob | null => {
      const normalized = String(dataUrl || '').trim()
      const signature = createImageClipboardSignature(normalized)
      if (!signature) return null

      const source = options?.source ?? 'poll'
      const signatureInFlightCount = autoClipboardInFlightSignaturesRef.current.get(signature) || 0
      const signatureQueued = autoClipboardQueueRef.current.some((job) => job.signature === signature)
      const allowProbeRequeue = source === 'probe'

      if (!allowProbeRequeue) {
        if (signatureInFlightCount > 0 || signatureQueued) return null
      } else {
        const now = Date.now()
        const lastQueuedAt = probeQueueCooldownRef.current.get(signature) || 0
        if (now - lastQueuedAt < CAPTURE_PROBE_REQUEUE_COOLDOWN_MS) return null
        probeQueueCooldownRef.current.set(signature, now)
      }

      const job: AutoClipboardJob = {
        id: createTranslateHistoryId(),
        signature,
        dataUrl: normalized,
        imageName: imageLabel?.trim() || t(language, 'overlayImage.clipboardImageName'),
        enqueuedAt: Date.now(),
      }

      autoClipboardInFlightSignaturesRef.current.set(signature, signatureInFlightCount + 1)
      latestAutoClipboardJobIdRef.current = job.id
      autoClipboardQueueRef.current = [...autoClipboardQueueRef.current, job]
      setAutoClipboardQueue([...autoClipboardQueueRef.current])
      setImageTranslateHistory((current) =>
        trimHistoryEntries([
          {
            id: job.id,
            signature: job.signature,
            status: 'queued',
            createdAt: job.enqueuedAt,
            startedAt: null,
            finishedAt: null,
            updatedAt: job.enqueuedAt,
            expiresAt: job.enqueuedAt + imageHistoryTtlMs,
            imageName: job.imageName,
            previewDataUrl: job.dataUrl,
            translatedImageSrc: '',
            lensUrl: '',
            aiReply: '',
            translatedReply: '',
            overviewTitle: '',
            overviewBullets: [],
            googleTranslationBullets: [],
            parserSource: '',
            parserStage: 'queued',
            resultsCount: 0,
            error: '',
          },
          ...current,
        ]),
      )

      return job
    },
    [imageHistoryTtlMs, language, trimHistoryEntries],
  )

  const restoreHistoryEntry = useCallback(
    (entry: ImageTranslateHistoryEntry) => {
      if (!entry || !entry.previewDataUrl.startsWith('data:image/')) return
      setPreviewDataUrl(entry.previewDataUrl)
      setImageName(entry.imageName || t(language, 'overlayImage.clipboardImageName'))
      setTranslatedImageSrc(entry.translatedImageSrc || '')
      setLensUrl(entry.lensUrl)
      setAiReply(entry.aiReply)
      setTranslatedReply(entry.translatedReply)
      setOverviewTitle(entry.overviewTitle || '')
      setOverviewBullets(Array.isArray(entry.overviewBullets) ? entry.overviewBullets : [])
      setGoogleTranslationBullets(Array.isArray(entry.googleTranslationBullets) ? entry.googleTranslationBullets : [])
      setLensError(entry.status === 'error' ? entry.error : '')
    },
    [language],
  )

  const runAutoClipboardJob = useCallback(
    async (job: AutoClipboardJob) => {
      let workerSlot: { index: number; webview: ElectronWebviewLike } | null = null
      try {
        const preferPrimary = job.id === latestAutoClipboardJobIdRef.current
        workerSlot = await waitForWebviewSlot(preferPrimary, 14_000)
        if (!workerSlot) {
          throw new Error(
            language === 'vi'
              ? 'Không thể lấy webview worker khả dụng. Hãy mở overlay setting để kiểm tra Lens tab.'
              : 'No available Lens webview worker. Open overlay settings and check Lens tab.',
          )
        }

        const startedAt = Date.now()
        setImageTranslateHistory((current) =>
          trimHistoryEntries(
            current.map((entry) =>
              entry.id === job.id
                ? {
                    ...entry,
                    status: 'processing',
                    startedAt,
                    updatedAt: startedAt,
                    expiresAt: startedAt + imageHistoryTtlMs,
                    parserStage: 'overview',
                  }
                : entry,
            ),
          ),
        )

        const result = await (async () => {
          const viaClipboard = await requestLensViaMiniWebviewClipboard(workerSlot?.webview)
          if (viaClipboard?.ok) return viaClipboard
          const viaWebview = await requestLensViaMiniWebview(job.dataUrl, workerSlot?.webview)
          if (viaWebview?.ok) return viaWebview
          const viaElectron = await requestLensViaElectron(job.dataUrl)
          if (viaElectron?.ok) return viaElectron
          return requestLensViaFallbackApi(job.dataUrl)
        })()

        if (!result || result.ok !== true) {
          throw new Error(
            language === 'vi'
              ? 'Không lấy được dữ liệu Lens từ webview. Có thể cần đăng nhập/captcha trong tab mini.'
              : 'Failed to parse Lens via webview. Mini tab may require login/challenge.',
          )
        }

        let mergedResult = result
        if (!String(result.translatedImageSrc || '').trim() && workerSlot?.webview) {
          const translatingAt = Date.now()
          setImageTranslateHistory((current) =>
            trimHistoryEntries(
              current.map((entry) =>
                entry.id === job.id
                  ? {
                      ...entry,
                      updatedAt: translatingAt,
                      expiresAt: translatingAt + imageHistoryTtlMs,
                      parserStage: 'translate',
                    }
                  : entry,
              ),
            ),
          )
          const translatedResult = await waitForMiniWebviewTranslatedResult(workerSlot.webview, 6200)
          if (translatedResult?.ok) {
            mergedResult = {
              ...result,
              ...translatedResult,
              aiReply: String(translatedResult.aiReply || result.aiReply || '').trim(),
              translatedReply: String(translatedResult.translatedReply || result.translatedReply || '').trim(),
              translatedImageSrc: String(translatedResult.translatedImageSrc || result.translatedImageSrc || '').trim(),
              overviewTitle: String(translatedResult.overviewTitle || result.overviewTitle || '').trim(),
              overviewBullets: Array.isArray(translatedResult.overviewBullets)
                ? translatedResult.overviewBullets
                : Array.isArray(result.overviewBullets)
                  ? result.overviewBullets
                  : [],
              googleTranslationBullets: Array.isArray(translatedResult.googleTranslationBullets)
                ? translatedResult.googleTranslationBullets
                : Array.isArray(result.googleTranslationBullets)
                  ? result.googleTranslationBullets
                  : [],
            }
          }
        }

        const successPayload: LensFallbackResponse = {
          ok: true,
          lensUrl: String(mergedResult.lensUrl || '').trim(),
          results: Array.isArray(mergedResult.results)
            ? mergedResult.results.map((item) => ({
                title: String(item?.title || '').trim(),
                url: String(item?.url || '').trim(),
              }))
            : [],
          extractedText: String(mergedResult.extractedText || '').trim(),
          aiReply: String(mergedResult.aiReply || '').trim(),
          translatedReply: String(mergedResult.translatedReply || '').trim(),
          translatedImageSrc: String((mergedResult as { translatedImageSrc?: unknown }).translatedImageSrc || '').trim(),
          overviewTitle: String(mergedResult.overviewTitle || '').trim(),
          overviewBullets: Array.isArray(mergedResult.overviewBullets)
            ? mergedResult.overviewBullets.map((line) => String(line || '').trim())
            : [],
          googleTranslationBullets: Array.isArray(mergedResult.googleTranslationBullets)
            ? mergedResult.googleTranslationBullets.map((line) => String(line || '').trim())
            : [],
          parserSource:
            typeof mergedResult.parserSource === 'string' && mergedResult.parserSource.trim()
              ? (mergedResult.parserSource as 'http' | 'webview' | 'merged')
              : 'http',
          fallbackUsed: typeof mergedResult.fallbackUsed === 'boolean' ? mergedResult.fallbackUsed : undefined,
          diagnostics: mergedResult.diagnostics,
        }

        let canonicalReply =
          String(successPayload.aiReply || '').trim() ||
          String(successPayload.translatedReply || '').trim() ||
          [String(successPayload.overviewTitle || '').trim(), ...(successPayload.overviewBullets || [])]
            .map((line) => String(line || '').trim())
            .filter(Boolean)
            .join('\n')

        if (!canonicalReply) {
          const extractedText = String(successPayload.extractedText || '').trim()
          if (extractedText) {
            try {
              const translated = await translateTextToVietnamese(extractedText)
              if (translated) canonicalReply = translated
            } catch {
              // Keep empty canonicalReply if fallback translation fails.
            }
          }
        }

        const finishedAt = Date.now()
        setImageTranslateHistory((current) =>
          trimHistoryEntries(
            current.map((entry) =>
              entry.id === job.id
                ? {
                    ...entry,
                    status: 'done',
                    finishedAt,
                    updatedAt: finishedAt,
                    expiresAt: finishedAt + imageHistoryTtlMs,
                    lensUrl: successPayload.lensUrl,
                    aiReply: canonicalReply,
                    translatedReply: String(successPayload.translatedReply || '').trim(),
                    translatedImageSrc: String(successPayload.translatedImageSrc || '').trim(),
                    overviewTitle: String(successPayload.overviewTitle || '').trim(),
                    overviewBullets: Array.isArray(successPayload.overviewBullets)
                      ? successPayload.overviewBullets.map((line) => String(line || '').trim()).filter(Boolean)
                      : [],
                    googleTranslationBullets: Array.isArray(successPayload.googleTranslationBullets)
                      ? successPayload.googleTranslationBullets.map((line) => String(line || '').trim()).filter(Boolean)
                      : [],
                    parserSource: String(successPayload.parserSource || '').trim(),
                    parserStage: String(successPayload.translatedImageSrc || '').trim() ? 'done' : 'translate',
                    resultsCount: successPayload.results.length,
                    error: '',
                  }
                : entry,
            ),
          ),
        )

        if (job.id === latestAutoClipboardJobIdRef.current) {
          setPreviewDataUrl(job.dataUrl)
          setImageName(job.imageName)
          applyLensPayload({
            ...successPayload,
            aiReply: canonicalReply,
          })
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim() ? error.message.trim() : t(language, 'overlayImage.errorLens')
        const finishedAt = Date.now()
        setImageTranslateHistory((current) =>
          trimHistoryEntries(
            current.map((entry) =>
              entry.id === job.id
                ? {
                    ...entry,
                    status: 'error',
                    finishedAt,
                    updatedAt: finishedAt,
                    expiresAt: finishedAt + imageHistoryTtlMs,
                    parserStage: 'error',
                    error: message,
                  }
                : entry,
            ),
          ),
        )
        if (job.id === latestAutoClipboardJobIdRef.current) {
          setPreviewDataUrl(job.dataUrl)
          setImageName(job.imageName)
          setLensError(message)
          pushPanelToast('error', message)
        }
      } finally {
        const inFlightCount = autoClipboardInFlightSignaturesRef.current.get(job.signature) || 0
        if (inFlightCount <= 1) {
          autoClipboardInFlightSignaturesRef.current.delete(job.signature)
        } else {
          autoClipboardInFlightSignaturesRef.current.set(job.signature, inFlightCount - 1)
        }
        autoClipboardActiveRef.current = Math.max(0, autoClipboardActiveRef.current - 1)
        setAutoClipboardActiveCount(autoClipboardActiveRef.current)
        releaseWebviewSlot(workerSlot?.index)
      }
    },
    [
      applyLensPayload,
      imageHistoryTtlMs,
      language,
      pushPanelToast,
      releaseWebviewSlot,
      requestLensViaMiniWebview,
      requestLensViaMiniWebviewClipboard,
      requestLensViaElectron,
      requestLensViaFallbackApi,
      trimHistoryEntries,
      translateTextToVietnamese,
      waitForMiniWebviewTranslatedResult,
      waitForWebviewSlot,
    ],
  )

  const pumpAutoClipboardQueue = useCallback(() => {
    while (autoClipboardActiveRef.current < autoClipboardMaxConcurrent && autoClipboardQueueRef.current.length > 0) {
      const queueSnapshot = [...autoClipboardQueueRef.current]
      const preferJobId = latestAutoClipboardJobIdRef.current
      const primaryIdle = !workerBusyRef.current.get(0)
      let pickIndex = 0
      if (primaryIdle && preferJobId) {
        const latestIndex = queueSnapshot.findIndex((item) => item.id === preferJobId)
        if (latestIndex >= 0) pickIndex = latestIndex
      }
      const [next] = queueSnapshot.splice(pickIndex, 1)
      if (!next) break
      autoClipboardQueueRef.current = queueSnapshot
      setAutoClipboardQueue([...queueSnapshot])

      autoClipboardActiveRef.current += 1
      setAutoClipboardActiveCount(autoClipboardActiveRef.current)

      void runAutoClipboardJob(next).finally(() => {
        pumpAutoClipboardQueue()
      })
    }
  }, [autoClipboardMaxConcurrent, runAutoClipboardJob])

  const clearTranslateHistory = useCallback(() => {
    setImageTranslateHistory([])
  }, [])

  const runLensSearchViaMiniClipboard = useCallback(async (): Promise<boolean> => {
    const clipboardImageDataUrl = (window.electronAPI?.readClipboardImageDataUrl?.() ?? '').trim()
    if (!clipboardImageDataUrl.startsWith('data:image/')) {
      return false
    }

    setPreviewDataUrl(clipboardImageDataUrl)
    setImageName(t(language, 'overlayImage.clipboardImageName'))
    resetLensState()

    const searchSeq = lensSearchSeqRef.current + 1
    lensSearchSeqRef.current = searchSeq
    if (lensFallbackAbortRef.current) {
      lensFallbackAbortRef.current.abort()
      lensFallbackAbortRef.current = null
    }

    setIsSearching(true)
    setLensError('')
    setLensResults([])
    setExtractedText('')
    setAiReply('')

    try {
      const result = (await requestLensViaMiniWebviewClipboard()) ?? (await requestLensViaMiniWebview(clipboardImageDataUrl))
      if (searchSeq !== lensSearchSeqRef.current) return false
      if (!result || result.ok !== true) return false
      applyLensPayload(result)
      return true
    } catch {
      return false
    } finally {
      if (searchSeq === lensSearchSeqRef.current) {
        setIsSearching(false)
      }
    }
  }, [applyLensPayload, language, requestLensViaMiniWebview, requestLensViaMiniWebviewClipboard, resetLensState])

  const runLensSearch = useCallback(
    async (sourceDataUrl?: string) => {
      const payloadImage = (sourceDataUrl ?? previewDataUrl).trim()
      if (!payloadImage) {
        const message = t(language, 'overlayImage.errorNoImage')
        setLensError(message)
        pushPanelToast('info', message)
        return
      }

      const searchSeq = lensSearchSeqRef.current + 1
      lensSearchSeqRef.current = searchSeq
      if (lensFallbackAbortRef.current) {
        lensFallbackAbortRef.current.abort()
        lensFallbackAbortRef.current = null
      }
      setIsSearching(true)
      setLensError('')
      setLensResults([])
      setExtractedText('')
      setAiReply('')

      try {
        const result = await (async () => {
          const miniWebviewResult = await requestLensViaMiniWebview(payloadImage)
          if (miniWebviewResult?.ok) return miniWebviewResult

          if (window.electronAPI?.lensSearchImage) {
            return requestLensViaElectron(payloadImage)
          }

          const abortController = new AbortController()
          lensFallbackAbortRef.current = abortController
          try {
            return await requestLensViaFallbackApi(payloadImage, abortController.signal)
          } finally {
            if (lensFallbackAbortRef.current === abortController) {
              lensFallbackAbortRef.current = null
            }
          }
        })()

        if (searchSeq !== lensSearchSeqRef.current) return

        if (!result || !result.ok) {
          const fallback = t(language, 'overlayImage.errorLens')
          const message = typeof result?.error === 'string' && result.error.trim() ? result.error.trim() : fallback
          throw new Error(message)
        }

        applyLensPayload(result)
      } catch (error) {
        if (searchSeq !== lensSearchSeqRef.current) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        const message = error instanceof Error && error.message.trim() ? error.message.trim() : t(language, 'overlayImage.errorLens')
        setLensError(message)
        pushPanelToast('error', message)
      } finally {
        if (searchSeq === lensSearchSeqRef.current) {
          setIsSearching(false)
        }
      }
    },
    [
      language,
      previewDataUrl,
      pushPanelToast,
      requestLensViaElectron,
      requestLensViaFallbackApi,
      requestLensViaMiniWebview,
      applyLensPayload,
    ],
  )

  const applyImageDataUrl = useCallback(
    (dataUrl: string, name = '', autoSearch = false) => {
      const normalized = dataUrl.trim()
      if (!normalized.startsWith('data:image/')) {
        setLensError(t(language, 'overlayImage.errorNoImage'))
        return false
      }
      setPreviewDataUrl(normalized)
      setImageName(name || t(language, 'overlayImage.clipboardImageName'))
      resetLensState()
      if (autoSearch) {
        const signature = normalized.slice(0, 256)
        const now = Date.now()
        const previous = lastAutoLensRef.current
        if (previous.signature === signature && now - previous.at < 420) return true
        lastAutoLensRef.current = { signature, at: now }
        void runLensSearch(normalized)
      }
      return true
    },
    [language, resetLensState, runLensSearch],
  )

  const pasteImageFromClipboard = useCallback(async () => {
    const usedMiniPaste = await runLensSearchViaMiniClipboard()
    if (usedMiniPaste) return true

    const dataUrl = window.electronAPI?.readClipboardImageDataUrl?.() ?? ''
    const ok = applyImageDataUrl(dataUrl, '', true)
    if (!ok) {
      const message = t(language, 'overlayImage.errorNoClipboardImage')
      setLensError(message)
      pushPanelToast('info', message)
      return false
    }
    return true
  }, [applyImageDataUrl, language, pushPanelToast, runLensSearchViaMiniClipboard])

  const onPickImage = useCallback(
    (file: File | null, source: 'upload' | 'paste' | 'drop' = 'upload') => {
      if (!file) return
      if (!file.type.startsWith('image/')) {
        setLensError(t(language, 'overlayImage.errorNoImage'))
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const nextDataUrl = typeof reader.result === 'string' ? reader.result : ''
        const applied = applyImageDataUrl(nextDataUrl, file.name || '', source === 'paste' || source === 'drop')
        if (!applied) return
      }
      reader.onerror = () => {
        setLensError(t(language, 'overlayImage.errorNoImage'))
      }
      reader.readAsDataURL(file)
    },
    [applyImageDataUrl, language],
  )

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onPickImage(event.target.files?.[0] ?? null, 'upload')
    },
    [onPickImage],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      onPickImage(event.dataTransfer.files?.[0] ?? null, 'drop')
    },
    [onPickImage],
  )

  useEffect(() => {
    // Legacy image-search pipeline is disabled.
    // Ctrl+V / Parse flow is now handled by QuickText2ImageLensPanel.
  }, [])

  useEffect(() => {
    pumpAutoClipboardQueue()
  }, [autoClipboardMaxConcurrent, pumpAutoClipboardQueue])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      const bridge = window.electronAPI?.getOverlayImageSession
      if (typeof bridge !== 'function') {
        setSessionLoaded(true)
        return
      }

      try {
        const rawSession = await bridge()
        if (cancelled) return
        const session = coerceOverlayImageSessionPayload(rawSession)
        if (session) {
          sessionHydratedRef.current = true
          setPreviewDataUrl(session.previewDataUrl)
          setTranslatedImageSrc(session.translatedImageSrc)
          setImageName(session.imageName)
          setLensUrl(session.lensUrl)
          setLensResults(session.lensResults)
          setExtractedText(session.extractedText)
          setAiReply(session.aiReply)
          setTranslatedReply(session.translatedReply)
          setOverviewTitle(session.overviewTitle)
          setOverviewBullets(session.overviewBullets)
          setGoogleTranslationBullets(session.googleTranslationBullets)
          setLensError(session.lensError)
        }
      } catch {
        // Ignore hydration failures and continue with in-memory fallback.
      } finally {
        if (cancelled) return
        setSessionLoaded(true)
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      const bridge = window.electronAPI?.getOverlayImageHistory
      if (typeof bridge !== 'function') {
        historyLoadedRef.current = true
        setImageTranslateHistory((current) => trimHistoryEntries([...current]))
        return
      }
      try {
        const rawEntries = await bridge()
        if (cancelled) return
        const merged = pruneHistoryEntries([...(Array.isArray(rawEntries) ? rawEntries : []), ...imageTranslateHistory])
        historyLoadedRef.current = true
        setImageTranslateHistory(merged)
      } catch {
        if (cancelled) return
        historyLoadedRef.current = true
        setImageTranslateHistory((current) => trimHistoryEntries([...current]))
      }
    }
    void hydrate()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!sessionLoaded || !historyLoadedRef.current) return
    if (sessionHydratedRef.current) return

    const hasLiveSession =
      previewDataUrl.startsWith('data:image/') ||
      translatedImageSrc.trim().length > 0 ||
      aiReply.trim().length > 0 ||
      translatedReply.trim().length > 0 ||
      lensUrl.trim().length > 0 ||
      lensResults.length > 0 ||
      overviewTitle.trim().length > 0 ||
      overviewBullets.length > 0 ||
      googleTranslationBullets.length > 0

    if (hasLiveSession) {
      sessionHydratedRef.current = true
      return
    }

    const fallbackEntry = imageTranslateHistory.find(
      (entry) => entry.status === 'done' && entry.previewDataUrl.startsWith('data:image/'),
    )
    if (fallbackEntry) {
      restoreHistoryEntry(fallbackEntry)
    }
    sessionHydratedRef.current = true
  }, [
    aiReply,
    googleTranslationBullets,
    imageTranslateHistory,
    lensResults,
    lensUrl,
    overviewBullets,
    overviewTitle,
    previewDataUrl,
    restoreHistoryEntry,
    sessionLoaded,
    translatedImageSrc,
    translatedReply,
  ])

  useEffect(() => {
    setImageTranslateHistory((current) => trimHistoryEntries([...current]))
  }, [trimHistoryEntries])

  useEffect(() => {
    if (!sessionLoaded) return
    const save = window.electronAPI?.saveOverlayImageSession
    if (typeof save !== 'function') return
    if (sessionSaveTimerRef.current !== null) {
      window.clearTimeout(sessionSaveTimerRef.current)
      sessionSaveTimerRef.current = null
    }

    const payload: OverlayImageSessionPayload = {
      previewDataUrl: previewDataUrl.trim(),
      translatedImageSrc: translatedImageSrc.trim(),
      imageName: imageName.trim(),
      lensUrl: lensUrl.trim(),
      lensResults: [...lensResults],
      extractedText: extractedText.trim(),
      aiReply: aiReply.trim(),
      translatedReply: translatedReply.trim(),
      overviewTitle: overviewTitle.trim(),
      overviewBullets: [...overviewBullets],
      googleTranslationBullets: [...googleTranslationBullets],
      lensError: lensError.trim(),
      updatedAt: Date.now(),
    }

    sessionSaveTimerRef.current = window.setTimeout(() => {
      sessionSaveTimerRef.current = null
      void save(payload)
    }, 180)
  }, [
    aiReply,
    extractedText,
    googleTranslationBullets,
    imageName,
    lensError,
    lensResults,
    lensUrl,
    overviewBullets,
    overviewTitle,
    previewDataUrl,
    sessionLoaded,
    translatedImageSrc,
    translatedReply,
  ])

  useEffect(() => {
    if (!historyLoadedRef.current) return
    const save = window.electronAPI?.saveOverlayImageHistory
    if (typeof save !== 'function') return
    if (historySaveTimerRef.current !== null) {
      window.clearTimeout(historySaveTimerRef.current)
      historySaveTimerRef.current = null
    }
    historySaveTimerRef.current = window.setTimeout(() => {
      historySaveTimerRef.current = null
      void save(imageTranslateHistory as unknown[])
    }, 160)
  }, [imageTranslateHistory])

  useEffect(() => {
    if (pruneIntervalRef.current !== null) {
      window.clearInterval(pruneIntervalRef.current)
      pruneIntervalRef.current = null
    }
    pruneIntervalRef.current = window.setInterval(() => {
      setImageTranslateHistory((current) => pruneHistoryEntries(current))
    }, 60_000)
    return () => {
      if (pruneIntervalRef.current !== null) {
        window.clearInterval(pruneIntervalRef.current)
        pruneIntervalRef.current = null
      }
    }
  }, [pruneHistoryEntries])

  useEffect(() => {
    const signature = createImageClipboardSignature(previewDataUrl)
    if (signature) {
      lastClipboardSignatureRef.current = signature
    }
  }, [previewDataUrl])

  useEffect(() => {
    if (!autoClipboardTranslateEnabled) {
      if (autoClipboardPollTimerRef.current !== null) {
        window.clearInterval(autoClipboardPollTimerRef.current)
        autoClipboardPollTimerRef.current = null
      }
      return
    }

    const pollClipboard = () => {
      const clipboardImageDataUrl = (window.electronAPI?.readClipboardImageDataUrl?.() ?? '').trim()
      const signature = createImageClipboardSignature(clipboardImageDataUrl)
      if (!signature) return
      if (signature === lastClipboardSignatureRef.current) return

      lastClipboardSignatureRef.current = signature
      const queued = queueAutoClipboardJob(clipboardImageDataUrl, undefined, { source: 'poll' })
      if (!queued) return

      setPreviewDataUrl(clipboardImageDataUrl)
      setImageName(queued.imageName)
      pumpAutoClipboardQueue()
    }

    pollClipboard()
    autoClipboardPollTimerRef.current = window.setInterval(pollClipboard, AUTO_CLIPBOARD_IMAGE_POLL_MS)
    return () => {
      if (autoClipboardPollTimerRef.current !== null) {
        window.clearInterval(autoClipboardPollTimerRef.current)
        autoClipboardPollTimerRef.current = null
      }
    }
  }, [autoClipboardTranslateEnabled, pumpAutoClipboardQueue, queueAutoClipboardJob])

  useEffect(() => {
    const subscribe = window.electronAPI?.onPasteImage
    if (typeof subscribe !== 'function') return

    const unsubscribe = subscribe((dataUrl: string) => {
      const normalized = String(dataUrl || '').trim()
      const signature = createImageClipboardSignature(normalized)
      if (!signature) return
      if (signature === lastClipboardSignatureRef.current) return

      lastClipboardSignatureRef.current = signature
      const queued = queueAutoClipboardJob(normalized, undefined, { source: 'paste' })
      if (!queued) return
      setPreviewDataUrl(normalized)
      setImageName(queued.imageName)
      pumpAutoClipboardQueue()
    })

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [pumpAutoClipboardQueue, queueAutoClipboardJob])

  useEffect(() => {
    if (!captureProbeToken) return
    if (!autoClipboardTranslateEnabled) return

    if (captureProbeTimersRef.current.length > 0) {
      for (const timerId of captureProbeTimersRef.current) {
        window.clearTimeout(timerId)
      }
      captureProbeTimersRef.current = []
    }

    let resolved = false

    const tryQueueFromClipboard = () => {
      if (resolved) return
      const clipboardImageDataUrl = (window.electronAPI?.readClipboardImageDataUrl?.() ?? '').trim()
      const signature = createImageClipboardSignature(clipboardImageDataUrl)
      if (!signature) return

      const queued = queueAutoClipboardJob(clipboardImageDataUrl, undefined, { source: 'probe' })
      if (!queued) return

      resolved = true
      lastClipboardSignatureRef.current = signature
      setPreviewDataUrl(clipboardImageDataUrl)
      setImageName(queued.imageName)
      pumpAutoClipboardQueue()
    }

    tryQueueFromClipboard()

    for (const delay of CAPTURE_PROBE_RETRY_DELAYS_MS) {
      const timerId = window.setTimeout(() => {
        tryQueueFromClipboard()
      }, delay)
      captureProbeTimersRef.current.push(timerId)
    }

    return () => {
      resolved = true
      if (captureProbeTimersRef.current.length > 0) {
        for (const timerId of captureProbeTimersRef.current) {
          window.clearTimeout(timerId)
        }
        captureProbeTimersRef.current = []
      }
    }
  }, [autoClipboardTranslateEnabled, captureProbeToken, pumpAutoClipboardQueue, queueAutoClipboardJob])

  useEffect(() => {
    if (!shouldMountMiniWebview) {
      setMiniWebviewReady(false)
      return
    }

    const webview = miniWebviewRef.current
    if (!webview) {
      setMiniWebviewReady(false)
      return
    }

    const markReady = () => setMiniWebviewReady(true)
    const markLoading = () => setMiniWebviewReady(false)

    webview.addEventListener('dom-ready', markReady as EventListener)
    webview.addEventListener('did-finish-load', markReady as EventListener)
    webview.addEventListener('did-stop-loading', markReady as EventListener)
    webview.addEventListener('did-start-loading', markLoading as EventListener)
    webview.addEventListener('did-fail-load', markLoading as EventListener)

    try {
      if (typeof webview.getURL === 'function' && webview.getURL()) {
        setMiniWebviewReady(true)
      }
    } catch {
      setMiniWebviewReady(false)
    }

    return () => {
      webview.removeEventListener('dom-ready', markReady as EventListener)
      webview.removeEventListener('did-finish-load', markReady as EventListener)
      webview.removeEventListener('did-stop-loading', markReady as EventListener)
      webview.removeEventListener('did-start-loading', markLoading as EventListener)
      webview.removeEventListener('did-fail-load', markLoading as EventListener)
    }
  }, [shouldMountMiniWebview, webPreviewUrl])

  useEffect(() => {
    if (!onImageCardStateChange) return
    const hasImage = previewDataUrl.trim().startsWith('data:image/')
    onImageCardStateChange({
      hasImage,
      previewDataUrl,
      translatedImageSrc,
      imageName,
      isSearching,
      lensUrl,
      lensError,
      resultsCount: lensResults.length,
    })
  }, [imageName, isSearching, lensError, lensResults.length, lensUrl, onImageCardStateChange, previewDataUrl, translatedImageSrc])

  useLayoutEffect(() => {
    if (!onWindowRectChange) return
    if (shouldRenderTextWindow) {
      onWindowRectChange('text', toRectSnapshot(panelRefs.current.text))
    } else {
      onWindowRectChange('text', null)
    }
    if (shouldRenderImageWindow) {
      onWindowRectChange('image', toRectSnapshot(panelRefs.current.image))
    } else {
      onWindowRectChange('image', null)
    }
  }, [
    hideImageWindowForMorph,
    hideTextWindowForMorph,
    isExitingEditMode,
    positions.image.x,
    positions.image.y,
    positions.text.x,
    positions.text.y,
    shouldRenderImageWindow,
    shouldRenderTextWindow,
    sizes.image.height,
    sizes.image.width,
    sizes.text.height,
    sizes.text.width,
    textWindowCollapsed,
    imageWindowCollapsed,
    onWindowRectChange,
  ])

  useEffect(() => {
    return () => {
      if (!onWindowRectChange) return
      onWindowRectChange('text', null)
      onWindowRectChange('image', null)
    }
  }, [onWindowRectChange])

  useEffect(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }

    const previous = previousEditModeRef.current
    previousEditModeRef.current = isOverlayEditMode

    if (isOverlayEditMode) {
      setIsExitingEditMode(false)
      const isEnteringEditMode = previous === null || previous === false
      if (isEnteringEditMode) {
        const patch: Partial<Settings> = {}
        if (!settings.overlayToolsPanelVisible) patch.overlayToolsPanelVisible = true
        if (!settings.overlayToolsShowTextManager) patch.overlayToolsShowTextManager = true
        if (!settings.overlayToolsShowImageTranslate) patch.overlayToolsShowImageTranslate = true
        if (Object.keys(patch).length > 0) {
          void updateSettings(patch)
        }
      }
      return
    }

    if (
      previous !== true ||
      (!settings.overlayToolsPanelVisible && !settings.overlayToolsShowTextManager && !settings.overlayToolsShowImageTranslate)
    ) {
      setIsExitingEditMode(false)
      return
    }

    setIsExitingEditMode(true)
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null
      setIsExitingEditMode(false)
    }, PANEL_EXIT_ANIMATION_MS)
  }, [
    isOverlayEditMode,
    settings.overlayToolsPanelVisible,
    settings.overlayToolsShowImageTranslate,
    settings.overlayToolsShowTextManager,
    updateSettings,
  ])

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (settingsDockPanel === null) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!target) return
      if (target.closest('[data-overlay-dock-panel="true"]')) return
      if (target.closest('[data-overlay-dock-trigger="true"]')) return
      setSettingsDockPanel(null)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSettingsDockPanel(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [settingsDockPanel])

  const clearImage = useCallback(() => {
    setPreviewDataUrl('')
    setImageName('')
    resetLensState()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [resetLensState])

  const hideModule = useCallback(
    (panel: PanelKey) => {
      if (panel === 'text') {
        if (!imageToolVisible) return
        void updateSettings({ overlayToolsShowTextManager: false })
        return
      }
      if (!textToolVisible) return
      void updateSettings({ overlayToolsShowImageTranslate: false })
    },
    [imageToolVisible, textToolVisible, updateSettings],
  )

  const showModule = useCallback(
    (panel: PanelKey) => {
      if (panel === 'text') {
        if (textToolVisible) return
        void updateSettings({ overlayToolsShowTextManager: true })
        return
      }
      if (imageToolVisible) return
      void updateSettings({ overlayToolsShowImageTranslate: true })
    },
    [imageToolVisible, textToolVisible, updateSettings],
  )

  useEffect(() => {
    if (settingsDockPanel === null) return
    if (settingsDockPanel === 'text' && (textIsGhost || textCompactPlay || !shouldRenderTextWindow)) {
      setSettingsDockPanel(null)
      return
    }
    if (settingsDockPanel === 'image' && (imageIsGhost || imageCompactPlay || !shouldRenderImageWindow)) {
      setSettingsDockPanel(null)
    }
  }, [
    imageCompactPlay,
    imageIsGhost,
    settingsDockPanel,
    shouldRenderImageWindow,
    shouldRenderTextWindow,
    textCompactPlay,
    textIsGhost,
  ])

  const toggleSettingsDock = useCallback((panel: PanelKey) => {
    setSettingsDockPanel((current) => (current === panel ? null : panel))
  }, [])

  const movePanelBy = useCallback(
    (panel: PanelKey, deltaX: number, deltaY: number) => {
      const current = positionsRef.current[panel]
      const next = setPanelPositionSafe(panel, current.x + deltaX, current.y + deltaY)
      persistPosition(panel, next)
    },
    [persistPosition, setPanelPositionSafe],
  )

  const alignPanelToViewport = useCallback(
    (panel: PanelKey, horizontal?: PanelHorizontalAlign, vertical?: PanelVerticalAlign) => {
      const currentPosition = positionsRef.current[panel]
      const currentSize = sizesRef.current[panel]
      const panelDefaults = PANEL_DEFAULT_SIZE[panel]

      let nextX = currentPosition.x
      let nextY = currentPosition.y

      if (horizontal === 'left') nextX = PANEL_GUTTER
      if (horizontal === 'center') nextX = Math.round((window.innerWidth - currentSize.width) / 2)
      if (horizontal === 'right') nextX = Math.round(window.innerWidth - currentSize.width - PANEL_GUTTER)

      if (vertical === 'top') nextY = panelDefaults.minTop
      if (vertical === 'middle') nextY = Math.round((window.innerHeight - currentSize.height) / 2)
      if (vertical === 'bottom') nextY = Math.round(window.innerHeight - currentSize.height - PANEL_GUTTER)

      const next = setPanelPositionSafe(panel, nextX, nextY)
      persistPosition(panel, next)
    },
    [persistPosition, setPanelPositionSafe],
  )

  const setPanelOpacity = useCallback(
    (panel: PanelKey, value: number) => {
      if (!Number.isFinite(value)) return
      const clamped = Math.max(0.2, Math.min(1, value))
      if (panel === 'text') {
        void updateSettings({ overlayToolsTextPanelOpacity: clamped })
        return
      }
      void updateSettings({ overlayToolsImagePanelOpacity: clamped })
    },
    [updateSettings],
  )

  const textStyle = useMemo(
    () => ({
      left: `${positions.text.x}px`,
      top: `${positions.text.y}px`,
      width: textCompactPlay ? `${Math.max(320, Math.min(720, Math.round(sizes.text.width * 0.58)))}px` : `${sizes.text.width}px`,
      height: textCompactPlay
        ? 'auto'
        : textWindowCollapsed
          ? `${PANEL_COLLAPSED_HEADER_HEIGHT}px`
          : `${sizes.text.height}px`,
      opacity: textCompactPlay
        ? Math.max(0.22, Math.min(1, playTextOpacity))
        : (textToolVisible ? settings.overlayToolsTextPanelOpacity : Math.max(0.12, settings.overlayToolsTextPanelOpacity * 0.24)) *
          settings.overlayToolsOpacity,
    }),
    [
      playTextOpacity,
      positions.text.x,
      positions.text.y,
      settings.overlayToolsOpacity,
      settings.overlayToolsTextPanelOpacity,
      sizes.text.height,
      sizes.text.width,
      textCompactPlay,
      textWindowCollapsed,
      textToolVisible,
    ],
  )

  const imageStyle = useMemo(
    () => ({
      left: `${positions.image.x}px`,
      top: `${positions.image.y}px`,
      width: imageCompactPlay ? `${Math.max(280, Math.min(460, Math.round(sizes.image.width * 0.62)))}px` : `${sizes.image.width}px`,
      height: imageCompactPlay
        ? 'auto'
        : imageWindowCollapsed
          ? `${PANEL_COLLAPSED_HEADER_HEIGHT}px`
          : `${sizes.image.height}px`,
      opacity:
        ((imageToolVisible ? settings.overlayToolsImagePanelOpacity : Math.max(0.12, settings.overlayToolsImagePanelOpacity * 0.24)) *
          (imageCompactPlay ? settings.overlayHudContextOpacity : 1)) *
        settings.overlayToolsOpacity,
    }),
    [
      imageCompactPlay,
      imageToolVisible,
      positions.image.x,
      positions.image.y,
      settings.overlayHudContextOpacity,
      settings.overlayToolsImagePanelOpacity,
      settings.overlayToolsOpacity,
      sizes.image.height,
      sizes.image.width,
      imageWindowCollapsed,
    ],
  )
  const detachedQuickAddVisible = displayMode === 'overlay' && settings.appEnabled && settings.overlayVisible
  const quickAddBarWidth = useMemo(() => {
    if (typeof window === 'undefined') return 420
    return getQuickAddBarWidthPx()
  }, [getQuickAddBarWidthPx])
  const quickAddStyle = useMemo(
    () => ({
      left: `${quickAddPosition.x}px`,
      top: `${quickAddPosition.y}px`,
      width: `${quickAddBarWidth}px`,
      opacity: settings.overlayToolsOpacity,
    }),
    [quickAddBarWidth, quickAddPosition.x, quickAddPosition.y, settings.overlayToolsOpacity],
  )
  const getQuickAddInteractiveZone = useCallback(() => {
    if (!isOverlayDisplayMode || !detachedQuickAddVisible) return null
    const snapshot = toRectSnapshot(quickAddContainerRef.current)
    if (snapshot) {
      return {
        x: Math.round(snapshot.left),
        y: Math.round(snapshot.top),
        width: Math.round(snapshot.width),
        height: Math.round(snapshot.height),
      }
    }
    return {
      x: Math.round(quickAddPosition.x),
      y: Math.round(quickAddPosition.y),
      width: Math.round(quickAddBarWidth),
      height: QUICK_ADD_BAR_HEIGHT,
    }
  }, [detachedQuickAddVisible, isOverlayDisplayMode, quickAddBarWidth, quickAddPosition.x, quickAddPosition.y])
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.electronAPI?.setOverlayInteractiveZones) return

    const quickAdd = getQuickAddInteractiveZone()
    void window.electronAPI.setOverlayInteractiveZones({ quickAdd, quickAddActive: !!quickAdd && quickAddInputActive }).catch(() => {})
  }, [getQuickAddInteractiveZone, quickAddInputActive])
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.electronAPI?.setOverlayInteractiveZones) return
    return () => {
      void window.electronAPI?.setOverlayInteractiveZones({ quickAdd: null, quickAddActive: false }).catch(() => {})
    }
  }, [])
  const panelPointerClass = displayMode === 'window' || isOverlayEditMode ? 'pointer-events-auto' : 'pointer-events-none'
  const textPanelPointerClass = panelPointerClass
  const panelShellClass =
    'fixed overflow-hidden text-[var(--qt-fg)] qt-overlay-panel qt-overlay-panel-edit qt-motion qt-motion-fast qt-motion-emphasis'
  const panelGhostClass = 'qt-overlay-panel-ghost text-[var(--qt-muted)]'
  const panelHeaderClass = 'qt-overlay-header px-3 py-2'
  const headerIconButtonClass = 'qt-overlay-dock-btn'
  const keepAliveForOverlayPaste = displayMode === 'overlay' && settings.appEnabled && settings.overlayVisible
  const compactHistoryEntries = useMemo(
    () => imageTranslateHistory.slice(0, compactHistoryVisibleCount),
    [compactHistoryVisibleCount, imageTranslateHistory],
  )
  const latestCompactEntry = compactHistoryEntries[0] || null
  const latestDoneEntry = useMemo(
    () => imageTranslateHistory.find((entry) => entry.status === 'done') || null,
    [imageTranslateHistory],
  )
  const compactDisplayImageSrc =
    translatedImageSrc ||
    String(latestDoneEntry?.translatedImageSrc || '').trim() ||
    String(latestCompactEntry?.translatedImageSrc || '').trim() ||
    previewDataUrl ||
    String(latestDoneEntry?.previewDataUrl || '').trim() ||
    String(latestCompactEntry?.previewDataUrl || '').trim() ||
    ''
  const displayReply = (
    aiReply.trim() ||
    translatedReply.trim() ||
    [overviewTitle.trim(), ...overviewBullets].map((line) => String(line || '').trim()).filter(Boolean).join('\n') ||
    String(latestDoneEntry?.aiReply || '').trim() ||
    String(latestDoneEntry?.translatedReply || '').trim() ||
    String(latestCompactEntry?.aiReply || '').trim() ||
    String(latestCompactEntry?.translatedReply || '').trim() ||
    [String(latestDoneEntry?.overviewTitle || '').trim(), ...(latestDoneEntry?.overviewBullets || [])]
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .join('\n')
  ).trim()
  const compactDisplayReply = displayReply
  const showTextDockPanel = settingsDockPanel === 'text' && !textIsGhost && !textCompactPlay
  const showImageDockPanel = settingsDockPanel === 'image' && !imageIsGhost && !imageCompactPlay
  const showTextEditPreview = isOverlayEditMode && !textIsGhost && !textWindowCollapsed
  const showImageEditPreview = isOverlayEditMode && !imageIsGhost && !imageWindowCollapsed

  useEffect(() => {
    if (!onOverlayTextInteractionChange) return
    onOverlayTextInteractionChange(false)
  }, [onOverlayTextInteractionChange])

  useEffect(() => {
    if (!isOverlayDisplayMode || !detachedQuickAddVisible) return

    const handlePointerDownCapture = (event: PointerEvent) => {
      const root = quickAddContainerRef.current
      const target = event.target as Node | null
      if (!root || !target) return
      if (root.contains(target)) return
      blurQuickAddInput()
    }

    const handleWindowBlur = () => {
      blurQuickAddInput()
      setQuickAddInputActive(false)
      onOverlayTextInteractionChange?.(false)
    }

    document.addEventListener('pointerdown', handlePointerDownCapture, true)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownCapture, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [blurQuickAddInput, detachedQuickAddVisible, isOverlayDisplayMode, onOverlayTextInteractionChange])

  useEffect(() => {
    if (!onOverlayTextInteractionChange) return
    return () => {
      onOverlayTextInteractionChange(false)
    }
  }, [onOverlayTextInteractionChange])

  if (!settings.overlayToolsPanelVisible && !isExitingEditMode && !textCompactPlay && !keepAliveForOverlayPaste && !detachedQuickAddVisible) return null

  return (
    <>
      {shouldMountMiniWebview && !shouldRenderImageWindow ? (
        <div className="fixed left-0 top-0 h-0 w-0 overflow-hidden opacity-0 pointer-events-none" aria-hidden>
          <webview
            ref={(node) => {
              miniWebviewRef.current = node as unknown as ElectronWebviewLike
            }}
            src={miniWebviewUrl}
            allowpopups
            useragent={GOOGLE_LENS_USER_AGENT}
            partition="persist:quicktext-google"
            className="h-[1px] w-[1px]"
          />
        </div>
      ) : null}

      {shouldMountMiniWebview && webviewPoolSize > 1 ? (
        <div className="fixed left-0 top-0 h-0 w-0 overflow-hidden opacity-0 pointer-events-none" aria-hidden>
          {Array.from({ length: Math.max(0, webviewPoolSize - 1) }).map((_, index) => (
            <webview
              key={`qt-lens-worker-${index}`}
              ref={(node) => {
                workerWebviewRefs.current[index] = node as unknown as ElectronWebviewLike
              }}
              src={miniWebviewUrl}
              allowpopups
              useragent={GOOGLE_LENS_USER_AGENT}
              partition="persist:quicktext-google"
              className="h-[1px] w-[1px]"
            />
          ))}
        </div>
      ) : null}

      {detachedQuickAddVisible ? (
        <section
          ref={(node) => {
            quickAddContainerRef.current = node
          }}
          data-overlay-toolbox="true"
          onPointerDown={startQuickAddDrag}
          className={`fixed z-[68] qt-overlay-panel qt-overlay-panel-edit px-2 py-2 pointer-events-auto ${
            isOverlayEditMode ? 'cursor-move border-cyan-300/40' : ''
          }`}
          style={quickAddStyle}
        >
          <div className="flex items-center gap-2">
            <input
              ref={quickAddInputRef}
              data-no-drag="true"
              type="text"
              value={quickViInput}
              onChange={(event) => {
                setQuickViInput(event.target.value)
                if (quickAddError) setQuickAddError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  blurQuickAddInput()
                  setQuickAddInputActive(false)
                  onOverlayTextInteractionChange?.(false)
                  return
                }
                if (event.key !== 'Enter') return
                event.preventDefault()
                void handleQuickAdd()
              }}
              onFocus={() => {
                setQuickAddInputActive(true)
                onOverlayTextInteractionChange?.(true)
              }}
              onBlur={() => {
                setQuickAddInputActive(false)
                onOverlayTextInteractionChange?.(false)
              }}
              placeholder={t(language, 'tm.quickAddPlaceholder')}
              className="h-9 min-w-0 flex-1 rounded-lg qt-input px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--qt-primary)]"
            />
            <button
              data-no-drag="true"
              type="button"
              onClick={() => void handleQuickAdd()}
              disabled={isQuickAddBusy || quickViInput.trim().length === 0}
              className="qt-overlay-btn qt-overlay-btn-brand h-9 shrink-0 px-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="size-3.5" />
              {t(language, 'tm.add')}
            </button>
          </div>
          {quickAddError ? <p className="mt-1 text-[11px] text-rose-300">{quickAddError}</p> : null}
        </section>
      ) : null}

      {shouldRenderTextWindow ? (
        <section
          data-qt-window="text"
          ref={(node) => {
            panelRefs.current.text = node
          }}
          data-overlay-toolbox="true"
          className={`${textPanelPointerClass} ${panelShellClass} flex flex-col ${overlayMinimalEditMode ? 'qt-overlay-edit-compact' : ''} ${textIsGhost ? panelGhostClass : ''} ${textCompactPlay ? 'qt-overlay-panel-play transition-[transform,width,height,opacity,background-color,border-color,box-shadow] duration-300' : ''} ${modeAnimationClass} ${hideTextWindowForMorph ? 'opacity-0 pointer-events-none' : ''} z-[65] max-h-[min(88vh,960px)]`}
          style={resizingPanel === 'text' ? { ...textStyle, transition: 'none' } : textStyle}
        >
          {!textCompactPlay ? (
            <header
              data-overlay-toolbox="true"
              onPointerDown={(event) => startDrag('text', event)}
              className={`${panelHeaderClass} ${draggingPanel === 'text' ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">
                    {t(language, 'overlayTools.tabText')}
                  </p>
                  <p className="truncate text-[11px] text-[var(--qt-muted)]">{t(language, 'overlayTools.resizeWindow')}</p>
                </div>
                <div className="qt-overlay-dock" data-no-drag="true">
                  {textIsGhost ? (
                    <OverlayIconButton
                      data-overlay-toolbox="true"
                      data-no-drag="true"
                      onClick={() => showModule('text')}
                      className={headerIconButtonClass}
                      tip={t(language, 'overlayTools.showTextWindow')}
                      aria-label={t(language, 'overlayTools.showTextWindow')}
                    >
                      <Eye className="size-4" />
                    </OverlayIconButton>
                  ) : (
                    <>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        onClick={() => void updateSettings({ overlayElementsVisible: !settings.overlayElementsVisible })}
                        className={`${headerIconButtonClass} ${settings.overlayElementsVisible ? 'qt-overlay-dock-btn-active' : ''}`}
                        tip={t(language, 'overlayTools.togglePlayTextHud')}
                        aria-label={t(language, 'overlayTools.togglePlayTextHud')}
                      >
                        {settings.overlayElementsVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                      </OverlayIconButton>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        data-overlay-dock-trigger="true"
                        onClick={() => toggleSettingsDock('text')}
                        className={`${headerIconButtonClass} ${showTextDockPanel ? 'qt-overlay-dock-btn-active' : ''}`}
                        tip={showTextDockPanel ? dockCopy.closeWindowSettings : dockCopy.windowSettings}
                        aria-label={showTextDockPanel ? dockCopy.closeWindowSettings : dockCopy.windowSettings}
                      >
                        <SlidersHorizontal className="size-4" />
                      </OverlayIconButton>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        onClick={() => setTextWindowCollapsed((value) => !value)}
                        className={headerIconButtonClass}
                        tip={textWindowCollapsed ? t(language, 'overlayTools.expandWindow') : t(language, 'overlayTools.collapseWindow')}
                        aria-label={textWindowCollapsed ? t(language, 'overlayTools.expandWindow') : t(language, 'overlayTools.collapseWindow')}
                      >
                        {textWindowCollapsed ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
                      </OverlayIconButton>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        onClick={() => hideModule('text')}
                        disabled={!imageToolVisible}
                        className={headerIconButtonClass}
                        tip={t(language, 'overlayTools.hideTextWindow')}
                        aria-label={t(language, 'overlayTools.hideTextWindow')}
                      >
                        <EyeOff className="size-4" />
                      </OverlayIconButton>
                    </>
                  )}
                </div>
              </div>
            </header>
          ) : null}

          {showTextDockPanel ? (
            <div
              data-overlay-toolbox="true"
              data-overlay-dock-panel="true"
              data-no-drag="true"
              className="qt-overlay-dock-panel qt-overlay-fade-in absolute right-3 top-[52px] z-20 w-64 space-y-3 p-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--qt-muted)]">{dockCopy.overlayControls}</p>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.panelOpacity}</p>
                <input
                  data-overlay-toolbox="true"
                  data-no-drag="true"
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={settings.overlayToolsTextPanelOpacity}
                  onChange={(event) => setPanelOpacity('text', Number(event.currentTarget.value))}
                  className="qt-overlay-dock-range"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.globalOpacity}</p>
                <input
                  data-overlay-toolbox="true"
                  data-no-drag="true"
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={settings.overlayToolsOpacity}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value)
                    if (!Number.isFinite(value)) return
                    void updateSettings({ overlayToolsOpacity: Math.max(0.2, Math.min(1, value)) })
                  }}
                  className="qt-overlay-dock-range"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.nudgePosition}</p>
                <div className="qt-overlay-dock-move-grid">
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => movePanelBy('text', 0, -16)}
                    className="qt-overlay-dock-mini-btn"
                    tip={dockCopy.moveUp}
                    aria-label={dockCopy.moveUp}
                  >
                    <ArrowUp className="size-3.5" />
                  </OverlayIconButton>
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => movePanelBy('text', -16, 0)}
                    className="qt-overlay-dock-mini-btn"
                    tip={dockCopy.moveLeft}
                    aria-label={dockCopy.moveLeft}
                  >
                    <ArrowLeft className="size-3.5" />
                  </OverlayIconButton>
                  <span className="qt-overlay-dock-move-center" aria-hidden>
                    <Move className="size-3.5" />
                  </span>
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => movePanelBy('text', 16, 0)}
                    className="qt-overlay-dock-mini-btn"
                    tip={dockCopy.moveRight}
                    aria-label={dockCopy.moveRight}
                  >
                    <ArrowRight className="size-3.5" />
                  </OverlayIconButton>
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => movePanelBy('text', 0, 16)}
                    className="qt-overlay-dock-mini-btn"
                    tip={dockCopy.moveDown}
                    aria-label={dockCopy.moveDown}
                  >
                    <ArrowDown className="size-3.5" />
                  </OverlayIconButton>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.snapHorizontal}</p>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('text', 'left', undefined)}
                    className="qt-overlay-dock-mini-btn"
                  >
                    <AlignLeft className="size-3.5" />
                    <span>{dockCopy.left}</span>
                  </button>
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('text', 'center', undefined)}
                    className="qt-overlay-dock-mini-btn"
                  >
                    <AlignCenter className="size-3.5" />
                    <span>{dockCopy.center}</span>
                  </button>
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('text', 'right', undefined)}
                    className="qt-overlay-dock-mini-btn"
                  >
                    <AlignRight className="size-3.5" />
                    <span>{dockCopy.right}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.snapVertical}</p>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('text', undefined, 'top')}
                    className="qt-overlay-dock-mini-btn"
                  >
                    {dockCopy.top}
                  </button>
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('text', undefined, 'middle')}
                    className="qt-overlay-dock-mini-btn"
                  >
                    {dockCopy.middle}
                  </button>
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('text', undefined, 'bottom')}
                    className="qt-overlay-dock-mini-btn"
                  >
                    {dockCopy.bottom}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {textIsGhost ? (
            <div className="px-3 py-2 text-xs text-[var(--qt-muted)]">{t(language, 'overlayTools.ghostHint')}</div>
          ) : (
            <>
              {showTextEditPreview ? (
                <div
                  data-overlay-toolbox="true"
                  className="mx-2 mt-2 shrink-0 rounded-xl border border-[var(--qt-border)] bg-black/25 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.22)] qt-overlay-fade-in"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--qt-muted)]">
                      {language === 'vi' ? 'Preview khi chơi' : 'Gameplay preview'}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        settings.overlayElementsVisible
                          ? 'border-emerald-300/35 text-emerald-200'
                          : 'border-amber-300/35 text-amber-200'
                      }`}
                    >
                      {settings.overlayElementsVisible
                        ? language === 'vi'
                          ? 'Đang hiện'
                          : 'Visible'
                        : language === 'vi'
                          ? 'Đang ẩn'
                          : 'Hidden'}
                    </span>
                  </div>
                  <div
                    className={`qt-play-context-stack qt-play-context-stack-forward space-y-1.5 rounded-lg border border-white/10 bg-black/25 p-2 ${playTextAlign === 'left' ? 'text-left' : playTextAlign === 'right' ? 'text-right' : 'text-center'}`}
                  >
                    {visiblePlayTextContextRows.map((row) => {
                      const baseTextSize = Math.max(16, Math.round(playTextSize))
                      const roleScale = row.role === 'current' ? 0.86 : 0.68
                      const rowTextSize = Math.max(11, Math.round(baseTextSize * roleScale))
                      const rowNoteSize = Math.max(10, Math.round(playNoteSize * (row.role === 'current' ? 0.86 : 0.7)))
                      const rowOpacity =
                        row.role === 'current' ? Math.max(0.24, Math.min(1, playTextOpacity)) : Math.max(0.16, Math.min(0.68, playTextOpacity * 0.6))
                      const roleLabel =
                        row.role === 'current'
                          ? t(language, 'overlayTools.contextCurrent')
                          : row.role === 'prev'
                            ? t(language, 'overlayTools.contextPrev')
                            : t(language, 'overlayTools.contextNext')
                      const rowText = row.text || t(language, 'overlay.hudEmpty')

                      return (
                        <div
                          key={`edit-preview-${row.key}`}
                          className={`qt-play-context-row ${row.role === 'current' ? 'qt-play-context-row-current' : 'qt-play-context-row-side'} ${row.empty ? 'opacity-45' : ''}`}
                        >
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--qt-muted)]">{roleLabel}</p>
                          <p
                            className="truncate whitespace-nowrap leading-tight"
                            style={{
                              fontSize: `${rowTextSize}px`,
                              fontWeight: row.role === 'current' ? 800 : 650,
                              color: colorWithAlpha(playTextColor, rowOpacity),
                              textShadow:
                                row.role === 'current'
                                  ? '0 0 10px rgba(0,0,0,0.92), 0 0 18px rgba(0,0,0,0.7)'
                                  : '0 0 8px rgba(0,0,0,0.82)',
                            }}
                          >
                            {rowText}
                          </p>
                          {row.note ? (
                            <p
                              className="mt-0.5 truncate whitespace-nowrap leading-snug"
                              style={{
                                fontSize: `${rowNoteSize}px`,
                                fontWeight: row.role === 'current' ? 600 : 500,
                                color: colorWithAlpha(playTextColor, Math.max(0.16, rowOpacity * 0.82)),
                                textShadow: '0 0 7px rgba(0,0,0,0.82)',
                              }}
                            >
                              {row.note}
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {textCompactPlay ? (
                <div
                  data-overlay-toolbox="true"
                  onPointerDown={(event) => startDrag('text', event)}
                  className={`px-3 py-2 ${playTextAlign === 'left' ? 'text-left' : playTextAlign === 'right' ? 'text-right' : 'text-center'} ${draggingPanel === 'text' ? 'cursor-grabbing' : 'cursor-grab'} ${contentAnimationClass}`}
                >
                  <div
                    key={`context-${contextAnimationTick}-${settings.selectedIndex}`}
                    className={`qt-play-context-stack qt-play-context-stack-${contextAnimationDirection} space-y-2`}
                  >
                    {visiblePlayTextContextRows.map((row) => {
                      const baseTextSize = Math.max(16, Math.round(playTextSize))
                      const roleScale = row.role === 'current' ? 1 : 0.78
                      const rowTextSize = Math.max(12, Math.round(baseTextSize * roleScale))
                      const rowNoteSize = Math.max(10, Math.round(playNoteSize * (row.role === 'current' ? 1 : 0.82)))
                      const rowOpacity =
                        row.role === 'current' ? Math.max(0.24, Math.min(1, playTextOpacity)) : Math.max(0.16, Math.min(0.7, playTextOpacity * 0.62))
                      const roleLabel =
                        row.role === 'current'
                          ? t(language, 'overlayTools.contextCurrent')
                          : row.role === 'prev'
                            ? t(language, 'overlayTools.contextPrev')
                            : t(language, 'overlayTools.contextNext')
                      const rowText = row.text || t(language, 'overlay.hudEmpty')

                      return (
                        <div
                          key={row.key}
                          className={`qt-play-context-row qt-play-context-row-anim ${row.role === 'current' ? 'qt-play-context-row-current' : 'qt-play-context-row-side'} ${row.empty ? 'opacity-45' : ''}`}
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--qt-muted)]">{roleLabel}</p>
                          <p
                            className="truncate whitespace-nowrap leading-tight"
                            style={{
                              fontSize: `${rowTextSize}px`,
                              fontWeight: row.role === 'current' ? 800 : 650,
                              color: colorWithAlpha(playTextColor, rowOpacity),
                              textShadow:
                                row.role === 'current'
                                  ? '0 0 10px rgba(0,0,0,0.92), 0 0 18px rgba(0,0,0,0.7)'
                                  : '0 0 8px rgba(0,0,0,0.82)',
                            }}
                          >
                            {rowText}
                          </p>
                          {row.note ? (
                            <p
                              className="mt-0.5 truncate whitespace-nowrap leading-snug"
                              style={{
                                fontSize: `${rowNoteSize}px`,
                                fontWeight: row.role === 'current' ? 600 : 500,
                                color: colorWithAlpha(playTextColor, Math.max(0.16, rowOpacity * 0.82)),
                                textShadow: '0 0 7px rgba(0,0,0,0.82)',
                              }}
                            >
                              {row.note}
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div
                data-overlay-toolbox="true"
                className={
                  textCompactPlay || textWindowCollapsed
                    ? 'hidden'
                    : `flex-1 min-h-0 overflow-hidden p-2 ${contentAnimationClass}`
                }
              >
                <TextManager settings={settings} updateSettings={updateSettings} variant="overlay" />
              </div>
            </>
          )}

          {!textIsGhost && isOverlayEditMode && !textWindowCollapsed ? (
            <button
              data-overlay-toolbox="true"
              data-no-drag="true"
              type="button"
              onPointerDown={(event) => startResize('text', event)}
              className={`qt-overlay-resize-handle absolute bottom-1.5 right-1.5 h-5 w-5 cursor-se-resize ${resizingPanel === 'text' ? 'qt-overlay-resize-handle-active' : ''}`}
              title={t(language, 'overlayTools.resizeWindow')}
              aria-label={t(language, 'overlayTools.resizeWindow')}
            />
          ) : null}
        </section>
      ) : null}

      {shouldRenderImageWindow ? (
        <section
          data-qt-window="image"
          ref={(node) => {
            panelRefs.current.image = node
          }}
          data-overlay-toolbox="true"
          className={`${panelPointerClass} ${panelShellClass} ${overlayMinimalEditMode ? 'qt-overlay-edit-compact' : ''} ${imageIsGhost ? panelGhostClass : ''} ${imageCompactPlay ? 'qt-overlay-panel-play transition-[transform,width,height,opacity,background-color,border-color,box-shadow] duration-300' : ''} ${modeAnimationClass} ${hideImageWindowForMorph ? 'opacity-0 pointer-events-none' : ''} z-[66] max-h-[min(88vh,960px)]`}
          style={resizingPanel === 'image' ? { ...imageStyle, transition: 'none' } : imageStyle}
        >
          {!imageCompactPlay ? (
            <header
              data-overlay-toolbox="true"
              onPointerDown={(event) => startDrag('image', event)}
              className={`${panelHeaderClass} ${draggingPanel === 'image' ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">
                    {t(language, 'overlayTools.tabImage')}
                  </p>
                  <p className="truncate text-[11px] text-[var(--qt-muted)]">{t(language, 'overlayTools.resizeWindow')}</p>
                </div>
                <div className="qt-overlay-dock" data-no-drag="true">
                  {imageIsGhost ? (
                    <OverlayIconButton
                      data-overlay-toolbox="true"
                      data-no-drag="true"
                      onClick={() => showModule('image')}
                      className={headerIconButtonClass}
                      tip={t(language, 'overlayTools.showImageWindow')}
                      aria-label={t(language, 'overlayTools.showImageWindow')}
                    >
                      <Eye className="size-4" />
                    </OverlayIconButton>
                  ) : (
                    <>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        onClick={() => void updateSettings({ overlayPlayShowImageCard: !settings.overlayPlayShowImageCard })}
                        className={`${headerIconButtonClass} ${settings.overlayPlayShowImageCard ? 'qt-overlay-dock-btn-active' : ''}`}
                        tip={t(language, 'overlayTools.togglePlayImageCard')}
                        aria-label={t(language, 'overlayTools.togglePlayImageCard')}
                      >
                        {settings.overlayPlayShowImageCard ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                      </OverlayIconButton>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        onClick={() => void updateSettings({ overlayToolsShowWebPreview: !settings.overlayToolsShowWebPreview })}
                        className={`${headerIconButtonClass} ${settings.overlayToolsShowWebPreview ? 'qt-overlay-dock-btn-active' : ''}`}
                        tip={t(language, 'overlayTools.toggleWebBlock')}
                        aria-label={t(language, 'overlayTools.toggleWebBlock')}
                      >
                        {settings.overlayToolsShowWebPreview ? <Globe2 className="size-4" /> : <ImageIcon className="size-4" />}
                      </OverlayIconButton>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        data-overlay-dock-trigger="true"
                        onClick={() => toggleSettingsDock('image')}
                        className={`${headerIconButtonClass} ${showImageDockPanel ? 'qt-overlay-dock-btn-active' : ''}`}
                        tip={showImageDockPanel ? dockCopy.closeWindowSettings : dockCopy.windowSettings}
                        aria-label={showImageDockPanel ? dockCopy.closeWindowSettings : dockCopy.windowSettings}
                      >
                        <SlidersHorizontal className="size-4" />
                      </OverlayIconButton>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        onClick={() => setImageWindowCollapsed((value) => !value)}
                        className={headerIconButtonClass}
                        tip={imageWindowCollapsed ? t(language, 'overlayTools.expandWindow') : t(language, 'overlayTools.collapseWindow')}
                        aria-label={imageWindowCollapsed ? t(language, 'overlayTools.expandWindow') : t(language, 'overlayTools.collapseWindow')}
                      >
                        {imageWindowCollapsed ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
                      </OverlayIconButton>
                      <OverlayIconButton
                        data-overlay-toolbox="true"
                        data-no-drag="true"
                        onClick={() => hideModule('image')}
                        disabled={!textToolVisible}
                        className={headerIconButtonClass}
                        tip={t(language, 'overlayTools.hideImageWindow')}
                        aria-label={t(language, 'overlayTools.hideImageWindow')}
                      >
                        <EyeOff className="size-4" />
                      </OverlayIconButton>
                    </>
                  )}
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    onClick={() => void updateSettings({ overlayToolsPanelVisible: false })}
                    className={`${headerIconButtonClass} qt-overlay-dock-btn-danger`}
                    tip={t(language, 'settings.closeWindow')}
                    aria-label={t(language, 'settings.closeWindow')}
                  >
                    <X className="size-4" />
                  </OverlayIconButton>
                </div>
              </div>
            </header>
          ) : null}

          {showImageDockPanel ? (
            <div
              data-overlay-toolbox="true"
              data-overlay-dock-panel="true"
              data-no-drag="true"
              className="qt-overlay-dock-panel qt-overlay-fade-in absolute right-3 top-[52px] z-20 w-64 space-y-3 p-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--qt-muted)]">{dockCopy.overlayControls}</p>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.panelOpacity}</p>
                <input
                  data-overlay-toolbox="true"
                  data-no-drag="true"
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={settings.overlayToolsImagePanelOpacity}
                  onChange={(event) => setPanelOpacity('image', Number(event.currentTarget.value))}
                  className="qt-overlay-dock-range"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.globalOpacity}</p>
                <input
                  data-overlay-toolbox="true"
                  data-no-drag="true"
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={settings.overlayToolsOpacity}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value)
                    if (!Number.isFinite(value)) return
                    void updateSettings({ overlayToolsOpacity: Math.max(0.2, Math.min(1, value)) })
                  }}
                  className="qt-overlay-dock-range"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.nudgePosition}</p>
                <div className="qt-overlay-dock-move-grid">
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => movePanelBy('image', 0, -16)}
                    className="qt-overlay-dock-mini-btn"
                    tip={dockCopy.moveUp}
                    aria-label={dockCopy.moveUp}
                  >
                    <ArrowUp className="size-3.5" />
                  </OverlayIconButton>
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => movePanelBy('image', -16, 0)}
                    className="qt-overlay-dock-mini-btn"
                    tip={dockCopy.moveLeft}
                    aria-label={dockCopy.moveLeft}
                  >
                    <ArrowLeft className="size-3.5" />
                  </OverlayIconButton>
                  <span className="qt-overlay-dock-move-center" aria-hidden>
                    <Move className="size-3.5" />
                  </span>
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => movePanelBy('image', 16, 0)}
                    className="qt-overlay-dock-mini-btn"
                    tip={dockCopy.moveRight}
                    aria-label={dockCopy.moveRight}
                  >
                    <ArrowRight className="size-3.5" />
                  </OverlayIconButton>
                  <OverlayIconButton
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => movePanelBy('image', 0, 16)}
                    className="qt-overlay-dock-mini-btn"
                    tip={dockCopy.moveDown}
                    aria-label={dockCopy.moveDown}
                  >
                    <ArrowDown className="size-3.5" />
                  </OverlayIconButton>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.snapHorizontal}</p>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('image', 'left', undefined)}
                    className="qt-overlay-dock-mini-btn"
                  >
                    <AlignLeft className="size-3.5" />
                    <span>{dockCopy.left}</span>
                  </button>
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('image', 'center', undefined)}
                    className="qt-overlay-dock-mini-btn"
                  >
                    <AlignCenter className="size-3.5" />
                    <span>{dockCopy.center}</span>
                  </button>
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('image', 'right', undefined)}
                    className="qt-overlay-dock-mini-btn"
                  >
                    <AlignRight className="size-3.5" />
                    <span>{dockCopy.right}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--qt-muted)]">{dockCopy.snapVertical}</p>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('image', undefined, 'top')}
                    className="qt-overlay-dock-mini-btn"
                  >
                    {dockCopy.top}
                  </button>
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('image', undefined, 'middle')}
                    className="qt-overlay-dock-mini-btn"
                  >
                    {dockCopy.middle}
                  </button>
                  <button
                    data-overlay-toolbox="true"
                    data-no-drag="true"
                    type="button"
                    onClick={() => alignPanelToViewport('image', undefined, 'bottom')}
                    className="qt-overlay-dock-mini-btn"
                  >
                    {dockCopy.bottom}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {shouldMountMiniWebview ? (
            <section
              className={
                showMiniWebPreviewBlock
                  ? 'qt-overlay-fade-in qt-overlay-surface space-y-2 p-2'
                  : 'h-0 w-0 overflow-hidden opacity-0 pointer-events-none'
              }
              aria-hidden={!showMiniWebPreviewBlock}
            >
              {showMiniWebPreviewBlock ? (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--qt-muted)]">
                    {t(language, 'overlayImage.webPreview')}
                  </p>
                  {!lensUrl ? (
                    <p className="text-[11px] leading-snug text-[var(--qt-muted)]">
                      {t(language, 'overlayImage.webPreviewSignInHint')}
                    </p>
                  ) : null}
                </>
              ) : null}
              <div
                className={showMiniWebPreviewBlock ? 'qt-overlay-preview-frame relative overflow-hidden' : 'h-[1px] w-[1px] overflow-hidden'}
                style={showMiniWebPreviewBlock ? { height: `${webPreviewHeight}px` } : undefined}
              >
                <webview
                  ref={(node) => {
                    miniWebviewRef.current = node as unknown as ElectronWebviewLike
                  }}
                  src={webPreviewUrl}
                  allowpopups
                  useragent={GOOGLE_LENS_USER_AGENT}
                  partition="persist:quicktext-google"
                  className={showMiniWebPreviewBlock ? 'h-full w-full bg-black/20' : 'h-[1px] w-[1px]'}
                />
              </div>
            </section>
          ) : null}

          {imageIsGhost ? (
            <div className="px-3 py-2 text-xs text-[var(--qt-muted)]">{t(language, 'overlayTools.ghostHint')}</div>
          ) : imageCompactPlay ? (
            <div
              data-overlay-toolbox="true"
              onPointerDown={(event) => startDrag('image', event)}
              className={`px-3 py-2 ${draggingPanel === 'image' ? 'cursor-grabbing' : 'cursor-grab'} ${contentAnimationClass}`}
            >
              <div className="qt-image-compact-card qt-image-compact-overlay">
                {compactDisplayImageSrc ? (
                  <div className="mb-2 overflow-hidden rounded-lg border border-[var(--qt-border)] bg-black/35">
                    <Image
                      src={compactDisplayImageSrc}
                      alt={imageName || 'Translated image'}
                      width={560}
                      height={320}
                      className="h-auto w-full object-contain"
                      unoptimized
                    />
                  </div>
                ) : null}

                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="qt-image-compact-status-label truncate text-[10px] font-semibold uppercase tracking-wide">
                    {t(language, 'overlayImage.compactStatusLabel')}
                  </p>
                  <p className="qt-image-compact-status-value truncate text-[10px] font-semibold">
                    {isSearching
                      ? t(language, 'overlayImage.searching')
                      : lensError
                        ? t(language, 'overlayImage.compactStatusError')
                        : compactDisplayReply
                          ? t(language, 'overlayImage.compactStatusReady')
                          : t(language, 'overlayImage.compactStatusIdle')}
                  </p>
                </div>

                {lensError ? <p className="qt-overlay-text-error mb-1 text-[11px]">{lensError}</p> : null}

                <p className="qt-image-compact-reply max-h-40 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed">
                  {compactDisplayReply || t(language, 'overlayImage.compactNoReply')}
                </p>

                {compactHistoryEntries.length > 0 ? (
                  <div className="mt-2 space-y-1 border-t border-[var(--qt-border)] pt-2">
                    {compactHistoryEntries.map((entry) => {
                      const timeValue = entry.finishedAt || entry.startedAt || entry.createdAt
                      const summary = (entry.aiReply || entry.translatedReply || entry.error || '').trim()
                      return (
                        <button
                          key={entry.id}
                          data-overlay-toolbox="true"
                          type="button"
                          onClick={() => restoreHistoryEntry(entry)}
                          className="w-full rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] px-2 py-1 text-left text-[11px] transition hover:border-[var(--qt-primary)]"
                        >
                          <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--qt-muted)]">
                            <span>{new Date(timeValue).toLocaleTimeString()}</span>
                            <span>{entry.status}</span>
                          </div>
                          <p className="line-clamp-2 whitespace-pre-wrap text-[11px] text-[var(--qt-fg)]">
                            {summary || (language === 'vi' ? 'Không có nội dung' : 'No content')}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : imageWindowCollapsed ? null : (
            <div
              data-overlay-toolbox="true"
              className={`min-h-0 max-h-[min(80vh,840px)] overflow-auto p-3 ${contentAnimationClass}`}
            >
              <section className="space-y-3">
                {showImageEditPreview ? (
                  <section className="qt-overlay-fade-in qt-overlay-surface space-y-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--qt-muted)]">
                        {language === 'vi' ? 'Preview khi chơi' : 'Gameplay preview'}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          settings.overlayPlayShowImageCard
                            ? 'border-emerald-300/35 text-emerald-200'
                            : 'border-amber-300/35 text-amber-200'
                        }`}
                      >
                        {settings.overlayPlayShowImageCard
                          ? language === 'vi'
                            ? 'Đang hiện'
                            : 'Visible'
                          : language === 'vi'
                            ? 'Đang ẩn'
                            : 'Hidden'}
                      </span>
                    </div>
                    <div className="qt-image-compact-card qt-image-compact-overlay">
                      {compactDisplayImageSrc ? (
                        <div className="mb-2 overflow-hidden rounded-lg border border-[var(--qt-border)] bg-black/35">
                          <Image
                            src={compactDisplayImageSrc}
                            alt={imageName || 'Translated image'}
                            width={560}
                            height={320}
                            className="h-auto max-h-44 w-full object-contain"
                            unoptimized
                          />
                        </div>
                      ) : null}

                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="qt-image-compact-status-label truncate text-[10px] font-semibold uppercase tracking-wide">
                          {t(language, 'overlayImage.compactStatusLabel')}
                        </p>
                        <p className="qt-image-compact-status-value truncate text-[10px] font-semibold">
                          {isSearching
                            ? t(language, 'overlayImage.searching')
                            : lensError
                              ? t(language, 'overlayImage.compactStatusError')
                              : compactDisplayReply
                                ? t(language, 'overlayImage.compactStatusReady')
                                : t(language, 'overlayImage.compactStatusIdle')}
                        </p>
                      </div>

                      {lensError ? <p className="qt-overlay-text-error mb-1 text-[11px]">{lensError}</p> : null}

                      <p className="qt-image-compact-reply max-h-24 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed">
                        {compactDisplayReply || t(language, 'overlayImage.compactNoReply')}
                      </p>
                    </div>
                  </section>
                ) : null}

                <section className="qt-overlay-fade-in qt-overlay-surface space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">
                      {language === 'vi' ? 'Auto Clipboard' : 'Auto Clipboard'}
                    </p>
                    <span className="qt-overlay-btn qt-overlay-btn-accent text-[11px]">
                      {language === 'vi' ? 'Luôn bật trong Play mode' : 'Always on in Play mode'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--qt-muted)]">
                    {language === 'vi'
                      ? 'Trong Play mode: cứ có ảnh mới vào clipboard là tự chạy luồng dịch ảnh ngay.'
                      : 'Auto-detect new clipboard images during gameplay and push to translation queue.'}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-[11px] text-[var(--qt-muted)]">
                      <span className="mb-1 block">
                        {language === 'vi' ? 'Tối đa dịch song song' : 'Max concurrent translations'}
                      </span>
                      <input
                        data-overlay-toolbox="true"
                        type="range"
                        min={1}
                        max={6}
                        step={1}
                        value={settings.overlayImageAutoClipboardMaxConcurrent}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value)
                          if (!Number.isFinite(value)) return
                          void updateSettings({ overlayImageAutoClipboardMaxConcurrent: Math.round(value) })
                        }}
                        className="w-full accent-[var(--qt-primary)]"
                      />
                      <span className="mt-1 block text-[10px] text-[var(--qt-muted)]">
                        {language === 'vi'
                          ? `${settings.overlayImageAutoClipboardMaxConcurrent} tác vụ`
                          : `${settings.overlayImageAutoClipboardMaxConcurrent} workers`}
                      </span>
                    </label>
                    <label className="text-[11px] text-[var(--qt-muted)]">
                      <span className="mb-1 block">{language === 'vi' ? 'Số mục lịch sử giữ lại' : 'History size limit'}</span>
                      <input
                        data-overlay-toolbox="true"
                        type="range"
                        min={10}
                        max={200}
                        step={5}
                        value={settings.overlayImageHistoryLimit}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value)
                          if (!Number.isFinite(value)) return
                          void updateSettings({ overlayImageHistoryLimit: Math.round(value) })
                        }}
                        className="w-full accent-[var(--qt-primary)]"
                      />
                      <span className="mt-1 block text-[10px] text-[var(--qt-muted)]">
                        {language === 'vi'
                          ? `${settings.overlayImageHistoryLimit} mục`
                          : `${settings.overlayImageHistoryLimit} items`}
                      </span>
                    </label>
                    <label className="text-[11px] text-[var(--qt-muted)]">
                      <span className="mb-1 block">{language === 'vi' ? 'Tự xoá lịch sử sau' : 'History auto-delete after'}</span>
                      <input
                        data-overlay-toolbox="true"
                        type="range"
                        min={5}
                        max={1440}
                        step={5}
                        value={settings.overlayImageHistoryTtlMinutes}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value)
                          if (!Number.isFinite(value)) return
                          void updateSettings({ overlayImageHistoryTtlMinutes: Math.round(value) })
                        }}
                        className="w-full accent-[var(--qt-primary)]"
                      />
                      <span className="mt-1 block text-[10px] text-[var(--qt-muted)]">
                        {language === 'vi'
                          ? `${settings.overlayImageHistoryTtlMinutes} phút`
                          : `${settings.overlayImageHistoryTtlMinutes} minutes`}
                      </span>
                    </label>
                    <label className="text-[11px] text-[var(--qt-muted)]">
                      <span className="mb-1 block">{language === 'vi' ? 'Số mục ngoài gameplay' : 'Compact gameplay history'}</span>
                      <input
                        data-overlay-toolbox="true"
                        type="range"
                        min={1}
                        max={20}
                        step={1}
                        value={settings.overlayImageCompactHistoryVisibleCount}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value)
                          if (!Number.isFinite(value)) return
                          void updateSettings({ overlayImageCompactHistoryVisibleCount: Math.round(value) })
                        }}
                        className="w-full accent-[var(--qt-primary)]"
                      />
                      <span className="mt-1 block text-[10px] text-[var(--qt-muted)]">
                        {language === 'vi'
                          ? `${settings.overlayImageCompactHistoryVisibleCount} mục`
                          : `${settings.overlayImageCompactHistoryVisibleCount} items`}
                      </span>
                    </label>
                  </div>
                  <p className="text-[11px] text-[var(--qt-muted)]">
                    {language === 'vi'
                      ? `Đang chạy: ${autoClipboardActiveCount} • Chờ: ${autoClipboardQueue.length}`
                      : `Running: ${autoClipboardActiveCount} • Queued: ${autoClipboardQueue.length}`}
                  </p>
                </section>

                <QuickText2ImageLensPanel
                  active={!imageIsGhost && !imageWindowCollapsed && !imageCompactPlay}
                  onStatusChange={handleQuickText2LensStatus}
                  onParsed={applyQuickText2LensParsed}
                  onClipboardImageDataUrl={handleQuickText2ClipboardImage}
                />

                {lensError ? <p className="qt-overlay-alert qt-overlay-alert-error">{lensError}</p> : null}

                {compactDisplayImageSrc ? (
                  <section className="qt-overlay-fade-in qt-overlay-surface space-y-2 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">
                        {language === 'vi' ? 'Ảnh dịch mới nhất' : 'Latest translated image'}
                      </p>
                      <span className="text-[10px] text-[var(--qt-muted)]">
                        {translatedImageSrc || String(latestDoneEntry?.translatedImageSrc || '').trim()
                          ? language === 'vi'
                            ? 'Đã dịch'
                            : 'Translated'
                          : language === 'vi'
                            ? 'Ảnh nguồn'
                            : 'Source image'}
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-[var(--qt-border)] bg-black/35">
                      <Image
                        src={compactDisplayImageSrc}
                        alt={imageName || 'Overlay image'}
                        width={640}
                        height={360}
                        className="h-auto w-full object-contain"
                        unoptimized
                      />
                    </div>
                  </section>
                ) : null}

                <label className="qt-overlay-fade-in qt-overlay-surface block p-2 text-xs text-[var(--qt-muted)]">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="block">{t(language, 'overlayImage.aiReply')}</span>
                    <button
                      data-overlay-toolbox="true"
                      type="button"
                      onClick={async () => {
                        const content = displayReply
                        if (!content) return
                        try {
                          await navigator.clipboard.writeText(content)
                          pushPanelToast('info', t(language, 'overlayImage.copySuccess'))
                        } catch {
                          pushPanelToast('error', t(language, 'overlayImage.copyFailed'))
                        }
                      }}
                      disabled={!displayReply}
                      className="qt-overlay-btn qt-overlay-btn-soft text-[11px]"
                    >
                      {t(language, 'overlayImage.copy')}
                    </button>
                  </div>
                  <div className="qt-overlay-response-box max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-[var(--qt-fg)]">
                    {displayReply || t(language, 'overlayImage.compactNoReply')}
                  </div>
                </label>

                <section className="qt-overlay-fade-in qt-overlay-surface space-y-2 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">
                      {language === 'vi' ? `Lịch sử dịch (${imageTranslateHistory.length})` : `History (${imageTranslateHistory.length})`}
                    </p>
                    <button
                      data-overlay-toolbox="true"
                      type="button"
                      onClick={clearTranslateHistory}
                      className="qt-overlay-btn qt-overlay-btn-soft text-[11px]"
                      disabled={imageTranslateHistory.length === 0}
                    >
                      {language === 'vi' ? 'Xóa lịch sử' : 'Clear history'}
                    </button>
                  </div>

                  {imageTranslateHistory.length === 0 ? (
                    <p className="text-[11px] text-[var(--qt-muted)]">
                      {language === 'vi'
                        ? 'Chưa có bản ghi nào. Hãy copy ảnh mới vào clipboard để app tự dịch.'
                        : 'No history yet. Copy a new image to clipboard to auto-translate.'}
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-1 overflow-auto pr-1">
                      {imageTranslateHistory.map((entry) => {
                        const when = entry.finishedAt || entry.startedAt || entry.createdAt
                        const statusLabel =
                          entry.status === 'done'
                            ? language === 'vi'
                              ? 'Xong'
                              : 'Done'
                            : entry.status === 'error'
                              ? language === 'vi'
                                ? 'Lỗi'
                                : 'Error'
                              : entry.status === 'processing'
                                ? language === 'vi'
                                  ? 'Đang dịch'
                                  : 'Processing'
                                : language === 'vi'
                                  ? 'Chờ'
                                  : 'Queued'
                        const summary = entry.aiReply || entry.translatedReply || entry.error
                        return (
                          <button
                            key={entry.id}
                            data-overlay-toolbox="true"
                            type="button"
                            onClick={() => restoreHistoryEntry(entry)}
                            className="w-full rounded-lg border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] px-2 py-1.5 text-left text-[11px] transition hover:border-[var(--qt-primary)]"
                          >
                            <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--qt-muted)]">
                              <span>{new Date(when).toLocaleTimeString()}</span>
                              <span>{statusLabel}</span>
                            </div>
                            <p className="line-clamp-2 whitespace-pre-wrap text-[11px] text-[var(--qt-fg)]">
                              {summary || (language === 'vi' ? 'Không có nội dung' : 'No content')}
                            </p>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              </section>
            </div>
          )}

          {panelToast ? (
            <div
              data-overlay-toolbox="true"
              className={`absolute bottom-8 left-3 right-3 z-20 qt-overlay-fade-in ${
                panelToast.type === 'error'
                  ? 'qt-overlay-alert qt-overlay-alert-error'
                  : 'qt-overlay-alert qt-overlay-alert-info'
              }`}
            >
              {panelToast.message}
            </div>
          ) : null}

          {!imageIsGhost && isOverlayEditMode && !imageWindowCollapsed ? (
            <button
              data-overlay-toolbox="true"
              data-no-drag="true"
              type="button"
              onPointerDown={(event) => startResize('image', event)}
              className={`qt-overlay-resize-handle absolute bottom-1.5 right-1.5 h-5 w-5 cursor-se-resize ${resizingPanel === 'image' ? 'qt-overlay-resize-handle-active' : ''}`}
              title={t(language, 'overlayTools.resizeWindow')}
              aria-label={t(language, 'overlayTools.resizeWindow')}
            />
          ) : null}
        </section>
      ) : null}
    </>
  )
}
