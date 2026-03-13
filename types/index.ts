export interface TextItem {
  text: string
  note: string
}

export type TextAlign = 'left' | 'center' | 'right'
export type UiMode = 'dark' | 'light'
export type UiPalette = 'icon' | 'jade' | 'crimson' | 'dark' | 'light'
export type UiLanguage = 'vi' | 'en'
export type WindowKind = 'main' | 'overlay' | 'hotkeys' | 'overlay-settings' | 'settings'
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
export type HotkeyOverrides = Partial<Record<HotkeyActionId, string>>

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
  hotkey?: string
  overlay_toggle_hotkey?: string
  main_toggle_hotkey?: string
  overlay_edit_hotkey?: string
  app_toggle_hotkey?: string
  app_enabled?: boolean
  delay_range?: [number, number]
  press_enter?: boolean
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
  appToggleHotkey: string
  sendHotkey: string
  overlayToggleHotkey: string
  mainToggleHotkey: string
  overlayEditHotkey: string
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

declare global {
  interface Window {
    electronAPI?: {
      onSendHotkey: (cb: () => void) => () => void
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
      toggleOverlayVisibility: () => Promise<Settings>
      toggleOverlayInteraction: () => Promise<Settings>
      setOverlayInteraction: (interactive: boolean) => Promise<Settings>
      setOverlayMousePassThrough: (passThrough: boolean) => Promise<boolean>
      quitApp: () => void
    }
  }
}
