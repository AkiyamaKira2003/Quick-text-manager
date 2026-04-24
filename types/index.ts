export interface TextItem {
  text: string
  note: string
}

export type TextAlign = 'left' | 'center' | 'right'
export type UiMode = 'dark' | 'light'
export type UiPalette = 'icon' | 'jade' | 'crimson' | 'dark' | 'light'
export type UiLanguage = 'vi' | 'en'
export type OverlayToolsTab = 'text' | 'image'
export type OverlayToolsWindowTab = OverlayToolsTab | 'settings'
export type WindowMode = 'manager' | 'overlay'
export type WindowKind = 'main' | 'overlay' | 'overlay-image' | 'hotkeys' | 'overlay-settings' | 'settings' | 'tray-menu'
export type HotkeyContext = 'global' | 'screen' | 'modal' | 'editor'
export type HotkeyCategory = 'core' | 'overlay' | 'text'
export type HotkeyErrorSource = 'python-config' | 'input-events' | 'overlay-action' | 'unknown'
export type KnownHotkeyActionId =
  | 'overlay.toggle_visibility'
  | 'main.toggle_visibility'
  | 'overlay.toggle_interaction'
  | 'app.toggle_enabled'
  | 'text.send_current'
export type HotkeyActionId = KnownHotkeyActionId | (string & {})
export type HotkeyOverrides = Partial<Record<HotkeyActionId, string | null>>

export interface SendTelemetry {
  successCount: number
  failureCount: number
  sampleCount: number
  totalLatencyMs: number
  avgLatencyMs: number
  minLatencyMs: number | null
  maxLatencyMs: number | null
  lastLatencyMs: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastError: string
}

export interface HotkeyTelemetry {
  errorCount: number
  lastError: string
  lastErrorAt: number | null
  lastErrorSource: HotkeyErrorSource
}

export interface TelemetrySnapshot {
  send: SendTelemetry
  hotkey: HotkeyTelemetry
  updatedAt: number
}

export interface ProfilingRuntimeState {
  enabled: boolean
  intervalMs: number
  durationMs: number
  isTracing: boolean
  nextCaptureAt: number | null
  lastCaptureAt: number | null
  lastTracePath: string
  lastError: string
  totalTraces: number
}

export type AppUpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'installing'
  | 'error'
  | 'unsupported'

export interface AppUpdateState {
  supported: boolean
  stage: AppUpdateStage
  currentVersion: string
  availableVersion: string
  downloadedVersion: string
  downloadPercent: number
  releaseName: string
  releaseDate: string
  error: string
  checkedAt: number | null
  updatedAt: number
}

export interface AppUpdateInstallResult {
  ok: boolean
  state: AppUpdateState
}

export interface ProfilingReactCommitInput {
  id: string
  phase: 'mount' | 'update' | 'nested-update'
  actualDurationMs: number
  baseDurationMs: number
  startTimeMs: number
  commitTimeMs: number
  capturedAt: number
  route: string
}

export interface ProfilingPerformanceEntryInput {
  entryType: string
  name: string
  startTimeMs: number
  durationMs: number
  detail?: string
  capturedAt: number
  route: string
}

export interface ProfilingBatchReport {
  ok: boolean
  accepted: number
}

export interface ProfilingConfigPatch {
  enabled?: boolean
  intervalMs?: number
  durationMs?: number
}

export interface SendTelemetryInput {
  success: boolean
  latencyMs: number
  error?: string
}

export interface HotkeyErrorTelemetryInput {
  source?: HotkeyErrorSource
  message: string
}

export interface PythonSendPayload {
  text: string
  delay_range?: [number, number]
  press_enter?: boolean
}

export interface PythonConfigurePayload {
  text?: string
  hotkey?: string | null
  overlay_toggle_hotkey?: string | null
  main_toggle_hotkey?: string | null
  overlay_edit_hotkey?: string | null
  app_toggle_hotkey?: string | null
  block_alt_f4?: boolean
  app_enabled?: boolean
  delay_range?: [number, number]
  press_enter?: boolean
}

export interface LensSearchImageRequest {
  imageDataUrl: string
  hl?: string
  vpw?: number
  vph?: number
  limit?: number
}

export interface LensSearchResultItem {
  title: string
  url: string
}

export interface OverlayRectSnapshot {
  left: number
  top: number
  width: number
  height: number
}

export interface OverlayImageCardState {
  hasImage: boolean
  previewDataUrl: string
  translatedImageSrc?: string
  imageName: string
  isSearching: boolean
  lensUrl: string
  lensError: string
  resultsCount: number
}

export type LensSearchImageResult =
  | {
      ok: true
      lensUrl: string
      results: LensSearchResultItem[]
      extractedText?: string
      aiReply?: string
      translatedReply?: string
      translatedImageSrc?: string
      overviewTitle?: string
      overviewBullets?: string[]
      googleTranslationBullets?: string[]
      parserSource?: 'http' | 'webview' | 'merged'
      fallbackUsed?: boolean
      diagnostics?: {
        fallbackReasons?: string[]
        http?: {
          hasLinks?: boolean
          hasOcr?: boolean
          hasOverview?: boolean
          missingBlocks?: string[]
        }
        fallback?: {
          durationMs?: number
          challengeDetected?: boolean
          diagnostics?: {
            hasLinks?: boolean
            hasOcr?: boolean
            hasOverview?: boolean
            missingBlocks?: string[]
          }
          error?: string
        } | null
        merged?: {
          hasLinks?: boolean
          hasOcr?: boolean
          hasOverview?: boolean
          missingBlocks?: string[]
        }
      }
      correlationId?: string
    }
  | {
      ok: false
      error: string
      status?: number
      correlationId?: string
    }

export type PythonBridgeFailure = {
  ok: false
  status: number
  error: string
}

export type PythonSendResult = { ok: true } | PythonBridgeFailure

export type PythonConfigureResult = { ok: true; skipped?: boolean; config?: unknown } | PythonBridgeFailure

export type PythonWheelInputEvent = {
  id: number
  type: 'wheel'
  delta: number
}

export type PythonActionInputEvent = {
  id: number
  type: 'action'
  action: string
}

export type PythonInputEvent = PythonWheelInputEvent | PythonActionInputEvent

export type PythonEventsResult =
  | {
      ok: true
      events: PythonInputEvent[]
      last_id: number
      degraded?: boolean
      error?: string
    }
  | {
      ok: false
      error: string
    }

export interface Settings {
  appEnabled: boolean
  blockAltF4WhenEnabled: boolean
  appToggleHotkey: string | null
  sendHotkey: string | null
  overlayToggleHotkey: string | null
  mainToggleHotkey: string | null
  overlayEditHotkey: string | null
  hotkeyOverrides: HotkeyOverrides
  uiMode: UiMode
  uiPalette: UiPalette
  uiLanguage: UiLanguage
  overlayVisible: boolean
  overlayInteractive: boolean
  overlaySmartClickThrough: boolean
  overlayElementsVisible: boolean
  overlayShowIcon: boolean
  overlayShowCounter: boolean
  overlayToolsShowTextManager: boolean
  overlayToolsShowImageTranslate: boolean
  overlayToolsPanelVisible: boolean
  overlayToolsActiveTab: OverlayToolsTab
  overlayToolsPanelX: number
  overlayToolsPanelY: number
  overlayQuickAddX: number
  overlayQuickAddY: number
  overlayToolsImagePanelX: number
  overlayToolsImagePanelY: number
  overlayToolsTextPanelWidth: number
  overlayToolsTextPanelHeight: number
  overlayToolsImagePanelWidth: number
  overlayToolsImagePanelHeight: number
  overlayToolsOpacity: number
  overlayToolsTextPanelOpacity: number
  overlayToolsImagePanelOpacity: number
  overlayHudContextOpacity: number
  overlayPlayShowImageCard: boolean
  overlayImageCardOffsetXPercent: number
  overlayImageCardOffsetYPercent: number
  overlayToolsAutoSearchOnPaste: boolean
  overlayToolsShowWebPreview: boolean
  overlayToolsWebPreviewHeight: number
  overlayImageAutoClipboardEnabled: boolean
  overlayImageAutoClipboardMaxConcurrent: number
  overlayImageHistoryLimit: number
  overlayImageHistoryTtlMinutes: number
  overlayImageCompactHistoryVisibleCount: number
  overlayImageBlockUploadPreview: boolean
  overlayImageBlockResults: boolean
  overlayImageBlockWebPreview: boolean
  overlayImageBlockOcr: boolean
  overlayImageBlockAiReply: boolean
  overlayImageBlockTranslatedReply: boolean
  overlayImageBlockOverview: boolean
  overlayImageBlockGoogleTranslation: boolean
  overlayImageBlockLensUrl: boolean
  overlaySnapTolerancePx: number
  overlayDragDelayMs: number
  overlayDragFrictionMs: number
  overlayPreciseDragFactor: number
  iconOffsetXPercent: number
  iconOffsetYPercent: number
  counterOffsetXPercent: number
  counterOffsetYPercent: number
  opacity: number
  noteOpacity: number
  iconOpacity: number
  counterOpacity: number
  textColor: string
  noteColor: string
  fontSize: number
  noteSize: number
  textAlign: TextAlign
  textOffsetXPercent: number
  textOffsetYPercent: number
  noteOffsetXPercent: number
  noteOffsetYPercent: number
  items: TextItem[]
  selectedIndex: number
  overlayX: number
  overlayY: number
  overlayWidth: number
  overlayHeight: number
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
}

export interface SaveSettingsPayload {
  patch: Partial<Settings>
  awaitFlush?: boolean
  immediate?: boolean
}

export interface OverlayInteractiveZoneRect {
  x: number
  y: number
  width: number
  height: number
  enabled?: boolean
}

export interface OverlayInteractiveZonesPayload {
  quickAdd?: OverlayInteractiveZoneRect | null
  quickAddActive?: boolean
}

declare global {
  interface Window {
    electronAPI?: {
      onSendHotkey: (cb: () => void) => () => void
      onPasteImage: (cb: (dataUrl: string) => void) => () => void
      onSettingsUpdated: (cb: (settings: Settings) => void) => () => void
      onTelemetryUpdated: (cb: (telemetry: TelemetrySnapshot) => void) => () => void
      onProfilingUpdated: (cb: (state: ProfilingRuntimeState) => void) => () => void
      onUpdateState: (cb: (state: AppUpdateState) => void) => () => void
      getSettings: () => Promise<Settings>
      getTelemetry: () => Promise<TelemetrySnapshot>
      getProfilingState: () => Promise<ProfilingRuntimeState>
      getUpdateState: () => Promise<AppUpdateState>
      checkForUpdates: () => Promise<AppUpdateState>
      installUpdateNow: () => Promise<AppUpdateInstallResult>
      setProfilingConfig: (partial: ProfilingConfigPatch) => Promise<ProfilingRuntimeState>
      reportReactProfileCommits: (payload: ProfilingReactCommitInput[]) => Promise<ProfilingBatchReport>
      reportPerformanceEntries: (payload: ProfilingPerformanceEntryInput[]) => Promise<ProfilingBatchReport>
      pythonSend: (payload: PythonSendPayload) => Promise<PythonSendResult>
      pythonConfigure: (payload: PythonConfigurePayload) => Promise<PythonConfigureResult>
      pythonGetInputEvents: (after: number) => Promise<PythonEventsResult>
      lensSearchImage: (payload: LensSearchImageRequest) => Promise<LensSearchImageResult>
      saveSettings: (partial: Partial<Settings> | SaveSettingsPayload) => Promise<Settings>
      reportSendTelemetry: (payload: SendTelemetryInput) => Promise<TelemetrySnapshot>
      reportHotkeyError: (payload: HotkeyErrorTelemetryInput) => Promise<TelemetrySnapshot>
      getWindowKind: () => Promise<WindowKind>
      notifyMainRendererReady: () => void
      hideMainWindow: () => void
      showMainWindow: () => void
      toggleMainWindow: () => void
      openSettingsWindow: () => void
      hideSettingsWindow: () => void
      closeSettingsWindow: () => void
      openHotkeyWindow: () => void
      closeHotkeyWindow: () => void
      openOverlaySettingsWindow: () => void
      closeOverlaySettingsWindow: () => void
      openOverlayImageWindow: (tab?: OverlayToolsWindowTab) => void
      closeOverlayImageWindow: () => void
      setWindowMode: (mode: WindowMode) => Promise<Settings>
      readClipboardImageDataUrl: () => string
      getOverlayImageSession: () => Promise<unknown>
      saveOverlayImageSession: (payload: Record<string, unknown>) => Promise<{ ok: true }>
      getOverlayImageHistory: () => Promise<unknown[]>
      saveOverlayImageHistory: (entries: unknown[]) => Promise<{ ok: true }>
      toggleOverlayVisibility: () => Promise<Settings>
      toggleOverlayInteraction: () => Promise<Settings>
      setOverlayInteraction: (interactive: boolean) => Promise<Settings>
      setOverlayMousePassThrough: (passThrough: boolean) => Promise<boolean>
      setOverlayInteractiveZones: (zones: OverlayInteractiveZonesPayload) => Promise<boolean>
      quitApp: () => void
    }
  }
}
