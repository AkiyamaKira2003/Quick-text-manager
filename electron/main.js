const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, dialog, contentTracing } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')
const { z } = require('zod')
const fsp = fs.promises

let cachedAutoUpdater = undefined
function resolveAutoUpdater() {
  if (cachedAutoUpdater !== undefined) return cachedAutoUpdater
  try {
    const module = require('electron-updater')
    cachedAutoUpdater = module?.autoUpdater || null
  } catch {
    cachedAutoUpdater = null
  }
  return cachedAutoUpdater
}

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')
const TELEMETRY_PATH = path.join(app.getPath('userData'), 'telemetry.json')
const PROFILING_DIR = path.join(app.getPath('userData'), 'profiling')
const REACT_PROFILE_LOG_PATH = path.join(PROFILING_DIR, 'react-commits.ndjson')
const RENDERER_PERF_LOG_PATH = path.join(PROFILING_DIR, 'renderer-performance.ndjson')
const STARTUP_SPLASH_IMAGE_FILENAME = 'logo.png'
const STARTUP_SPLASH_LEGACY_IMAGE_FILENAME = 'logo.jpg'
const STARTUP_SPLASH_FALLBACK_IMAGE_FILENAME = 'icon_full.png'
const APP_DISPLAY_NAME = 'QuickText'
const APP_USER_MODEL_ID = 'com.quicktext.desktop'
const STARTUP_SPLASH_LOAD_TIMEOUT_MS = 60000
const STARTUP_MAIN_READY_GRACE_MS = 2200
const STARTUP_MAIN_COMPILE_HINT_DELAY_MS = 1800
const STARTUP_OVERLAY_PREWARM_TIMEOUT_MS = 18000
const STARTUP_SPLASH_FADE_OUT_MS = 260
const STARTUP_SPLASH_FALLBACK_RATIO = 2.35
const STARTUP_SPLASH_LOGO_BASE_HEIGHT = 320
const STARTUP_SPLASH_LOGO_MIN_RATIO = 1.2
const STARTUP_SPLASH_LOGO_MAX_RATIO = 4
const STARTUP_SPLASH_ELLIPSE_CROP_FACTOR = 1.34
const STARTUP_SPLASH_IMAGE_SCALE = 1
const STARTUP_SPLASH_WINDOW_HORIZONTAL_PADDING = 28
const STARTUP_SPLASH_WINDOW_VERTICAL_PADDING = 64
const STARTUP_SPLASH_WINDOW_MIN_WIDTH = 420
const STARTUP_SPLASH_WINDOW_MAX_WIDTH = 1040
const STARTUP_SPLASH_WINDOW_MIN_HEIGHT = 280
const STARTUP_SPLASH_WINDOW_MAX_HEIGHT = 620
const PACKAGED_RENDERER_HOST = '127.0.0.1'
const PACKAGED_RENDERER_PORT = parseIntegerEnv('QT_RENDERER_PORT', 3000, 1024, 65535)
const PACKAGED_RENDERER_MAX_PORT_SCAN = 40
const PACKAGED_RENDERER_BOOT_TIMEOUT_MS = 45000
const STARTUP_SPLASH_LABELS = {
  vi: {
    initializing: 'Đang khởi động QuickText...',
    bootRenderer: 'Đang khởi động renderer...',
    loadingSettings: 'Đang nạp cài đặt...',
    loadingTelemetry: 'Đang khôi phục thống kê...',
    loadingWindows: 'Đang tạo cửa sổ...',
    creatingMain: 'Đang tạo cửa sổ chính...',
    loadingInterface: 'Đang tải giao diện...',
    compilingMain: 'Đang chuẩn bị giao diện...',
    preparingControls: 'Đang khởi tạo điều khiển...',
    creatingOverlay: 'Đang tạo overlay...',
    applyingSettings: 'Đang áp dụng cài đặt...',
    registeringHotkeys: 'Đang đăng ký phím tắt...',
    creatingTray: 'Đang tạo khay hệ thống...',
    syncingState: 'Đang đồng bộ trạng thái...',
    waitingMainReady: 'Đang chờ giao diện sẵn sàng...',
    startingOverlay: 'Đang kích hoạt overlay...',
    uiReady: 'Giao diện đã sẵn sàng...',
    finalizing: 'Đang hoàn tất...',
    ready: 'Sẵn sàng',
  },
  en: {
    initializing: 'Booting QuickText...',
    bootRenderer: 'Starting renderer...',
    loadingSettings: 'Loading settings...',
    loadingTelemetry: 'Restoring telemetry...',
    loadingWindows: 'Creating windows...',
    creatingMain: 'Creating main window...',
    loadingInterface: 'Loading interface...',
    compilingMain: 'Compiling interface...',
    preparingControls: 'Preparing controls...',
    creatingOverlay: 'Creating overlay...',
    applyingSettings: 'Applying settings...',
    registeringHotkeys: 'Registering hotkeys...',
    creatingTray: 'Creating tray menu...',
    syncingState: 'Syncing runtime state...',
    waitingMainReady: 'Waiting for UI ready...',
    startingOverlay: 'Starting overlay...',
    uiReady: 'UI is ready...',
    finalizing: 'Finalizing startup...',
    ready: 'Ready',
  },
}
const DEFAULT_PYTHON_API_BASE_URL = 'http://127.0.0.1:5000'
const OVERLAY_TOGGLE_HOTKEY = 'Ctrl+Shift+1'
const DEFAULT_OVERLAY_EDIT_HOTKEY = 'Tab'
const DEFAULT_SEND_HOTKEY = '4'
const DEFAULT_MAIN_TOGGLE_HOTKEY = 'Delete'
const DEFAULT_APP_TOGGLE_HOTKEY = 'Shift+5'
const OVERLAY_FULLSCREEN_SIZE = 10000
const SETTINGS_WRITE_DEBOUNCE_MS = 160
const PYTHON_SEND_TIMEOUT_MS = 5000
const PYTHON_CONFIG_TIMEOUT_MS = 3000
const PYTHON_EVENTS_TIMEOUT_MS = 3000
const PYTHON_RETRY_BASE_DELAY_MS = 140
const TELEMETRY_MAX_ERROR_LENGTH = 320
const TELEMETRY_MAX_LATENCY_MS = 120000
const TELEMETRY_ROTATE_MAX_BYTES = 2 * 1024 * 1024
const TELEMETRY_RETENTION_FILES = 5
const TELEMETRY_WRITE_DEBOUNCE_MS = 220
const TRAY_MENU_REFRESH_DEBOUNCE_MS = 90
const OVERLAY_REFIT_DEBOUNCE_MS = 220
const OVERLAY_DEFER_BOOT_MS = 260
const STARTUP_PHASE_LOG_ENABLED = parseBooleanEnv('QT_STARTUP_PHASE_LOG', false)
const OVERLAY_LIFECYCLE_LOG_ENABLED = parseBooleanEnv('QT_OVERLAY_LIFECYCLE_LOG', false)
const SKIP_ADMIN_CHECK = parseBooleanEnv('QT_SKIP_ADMIN_CHECK', false)
const AUTO_UPDATE_STARTUP_DELAY_MS = 2800
const AUTO_UPDATE_FEED_URL = String(process.env.QT_UPDATE_FEED_URL || process.env.ELECTRON_UPDATE_URL || '').trim()
const PROFILING_MAX_ERROR_LENGTH = 420
const PROFILING_DEFAULT_ENABLED = parseBooleanEnv('QT_PROFILE_ENABLED', true)
const PROFILING_DEFAULT_INTERVAL_MS = parseIntegerEnv('QT_PROFILE_INTERVAL_MS', 8 * 60 * 1000, 60 * 1000, 45 * 60 * 1000)
const PROFILING_DEFAULT_DURATION_MS = parseIntegerEnv('QT_PROFILE_DURATION_MS', 8000, 1000, 60 * 1000)
const PROFILING_TRACE_MAX_FILES = parseIntegerEnv('QT_PROFILE_MAX_TRACES', 20, 5, 120)
const PROFILING_MAX_BATCH_ITEMS = 300
const PROFILING_LOG_ROTATE_BYTES = 20 * 1024 * 1024
const PROFILING_TRACE_CATEGORIES = [
  'toplevel',
  'blink.console',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-v8.cpu_profiler',
  'disabled-by-default-v8.runtime_stats',
  'v8.execute',
  'electron',
]
const HOTKEY_ACTIONS = [
  { id: 'app.toggle_enabled', settingKey: 'appToggleHotkey', defaultCombo: DEFAULT_APP_TOGGLE_HOTKEY },
  { id: 'overlay.toggle_visibility', settingKey: 'overlayToggleHotkey', defaultCombo: OVERLAY_TOGGLE_HOTKEY },
  { id: 'main.toggle_visibility', settingKey: 'mainToggleHotkey', defaultCombo: DEFAULT_MAIN_TOGGLE_HOTKEY },
  { id: 'overlay.toggle_interaction', settingKey: 'overlayEditHotkey', defaultCombo: DEFAULT_OVERLAY_EDIT_HOTKEY },
  { id: 'text.send_current', settingKey: 'sendHotkey', defaultCombo: DEFAULT_SEND_HOTKEY },
]
const RESERVED_HOTKEYS = new Set(
  [
    'Alt+F4',
    'Ctrl+W',
    'Ctrl+L',
    'Ctrl+Tab',
    'Ctrl+Shift+Tab',
    'Meta+Q',
    'Meta+W',
    'Meta+M',
    'Meta+H',
    'Meta+Space',
  ].map((value) => normalizeHotkeyToken(value)),
)
const TRAY_LABELS = {
  vi: {
    showManager: 'Hiện Manager',
    hideManager: 'Ẩn Manager',
    settings: 'Cài đặt',
    showOverlay: 'Hiện Overlay',
    hideOverlay: 'Ẩn Overlay',
    overlayActive: 'Overlay: Chỉnh sửa',
    overlayPassive: 'Overlay: Thụ động',
    quit: 'Thoát',
  },
  en: {
    showManager: 'Show Manager',
    hideManager: 'Hide Manager',
    settings: 'Settings',
    showOverlay: 'Show Overlay',
    hideOverlay: 'Hide Overlay',
    overlayActive: 'Overlay: Active',
    overlayPassive: 'Overlay: Passive',
    quit: 'Quit',
  },
}
const ADMIN_MESSAGES = {
  vi: {
    title: 'QuickText cần quyền quản trị viên',
    body: 'QuickText cần quyền quản trị để chạy overlay trên game. Vui lòng mở app bằng quyền quản trị viên.',
    relaunchFailed: '[admin] Không thể tự mở lại bằng quyền quản trị. Hãy chạy app bằng Run as administrator.',
  },
  en: {
    title: 'QuickText requires Administrator',
    body: 'QuickText needs Administrator permission to run overlay above games. Please run the app as Administrator.',
    relaunchFailed: '[admin] Unable to relaunch as Administrator. Run the app as Admin manually.',
  },
}
const PYTHON_POLICY = {
  send: { timeoutMs: PYTHON_SEND_TIMEOUT_MS, retries: 1, baseBackoffMs: PYTHON_RETRY_BASE_DELAY_MS },
  configure: { timeoutMs: PYTHON_CONFIG_TIMEOUT_MS, retries: 1, baseBackoffMs: PYTHON_RETRY_BASE_DELAY_MS },
  events: { timeoutMs: PYTHON_EVENTS_TIMEOUT_MS, retries: 0, baseBackoffMs: PYTHON_RETRY_BASE_DELAY_MS },
}

const DEFAULT_SETTINGS = {
  appEnabled: true,
  appToggleHotkey: DEFAULT_APP_TOGGLE_HOTKEY,
  sendHotkey: DEFAULT_SEND_HOTKEY,
  overlayToggleHotkey: OVERLAY_TOGGLE_HOTKEY,
  mainToggleHotkey: DEFAULT_MAIN_TOGGLE_HOTKEY,
  overlayEditHotkey: DEFAULT_OVERLAY_EDIT_HOTKEY,
  hotkeyOverrides: {},
  uiMode: 'dark',
  uiPalette: 'icon',
  uiLanguage: 'vi',
  overlayVisible: true,
  overlayInteractive: false,
  overlaySmartClickThrough: true,
  overlayElementsVisible: true,
  overlayShowIcon: false,
  overlayShowCounter: false,
  overlaySnapTolerancePx: 10,
  overlayDragDelayMs: 80,
  overlayDragFrictionMs: 5,
  overlayPreciseDragFactor: 0.35,
  iconOffsetXPercent: -45,
  iconOffsetYPercent: -43,
  counterOffsetXPercent: -33,
  counterOffsetYPercent: -43,
  opacity: 1,
  noteOpacity: 0.88,
  textColor: '#ffffff',
  noteColor: '#ffffff',
  fontSize: 48,
  noteSize: 20,
  textAlign: 'center',
  textOffsetXPercent: 0,
  textOffsetYPercent: 0,
  noteOffsetXPercent: 0,
  noteOffsetYPercent: 16,
  items: [
    { text: '네 사람입니다', note: 'Vâng, tôi là người chơi thật' },
    { text: '매크로 아니에요', note: 'Không phải macro đâu' },
    { text: '직접 플레이 중입니다', note: 'Tôi đang chơi trực tiếp' },
    { text: '잠깐 사냥 중이었어요', note: 'Nãy giờ đang farm quái thôi' },
    { text: '확인 감사합니다', note: 'Cảm ơn đã kiểm tra' },
    { text: '네 지금 있습니다', note: 'Vâng tôi đang ở đây' },
    { text: '답변 늦어서 죄송합니다', note: 'Xin lỗi trả lời hơi chậm' },
    { text: '그냥 파밍 중이에요', note: 'Chỉ đang farm bình thường thôi' },
  ],
  selectedIndex: 0,
  overlayX: 0,
  overlayY: 0,
  overlayWidth: OVERLAY_FULLSCREEN_SIZE,
  overlayHeight: OVERLAY_FULLSCREEN_SIZE,
  windowX: 200,
  windowY: 150,
  windowWidth: 920,
  windowHeight: 680,
}

const DEFAULT_TELEMETRY = {
  send: {
    successCount: 0,
    failureCount: 0,
    sampleCount: 0,
    totalLatencyMs: 0,
    avgLatencyMs: 0,
    minLatencyMs: null,
    maxLatencyMs: null,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: '',
    lastRequestId: '',
  },
  hotkey: {
    errorCount: 0,
    lastError: '',
    lastErrorAt: null,
    lastErrorSource: 'unknown',
    lastRequestId: '',
  },
  updatedAt: 0,
}
const SETTINGS_WINDOW_DEFAULT = {
  width: 500,
  height: 760,
  minWidth: 440,
  minHeight: 620,
}
const SETTINGS_WINDOW_GAP_PX = 12
const SETTINGS_WINDOW_SAFE_MARGIN_PX = 8
const SETTINGS_WINDOW_SYNC_DEBOUNCE_MS = 16
let mainWindow = null
let overlayWindow = null
let hotkeyWindow = null
let startupSplashWindow = null
let tray = null
let isQuitting = false
let runtimeCleanedUp = false
let currentSettings = null
let currentTelemetry = null
let mainBoundsPersistTimer = null
let mainBoundsSignature = ''
let settingsWriteTimer = null
let pendingSettingsWrite = null
let settingsWritePromise = Promise.resolve()
let lastSettingsWriteError = null
let quittingAfterSettingsFlush = false
let hotkeySignature = ''
let overlayMousePassThrough = true
let overlayBoundsSignature = ''
let telemetryWritePromise = Promise.resolve()
let pendingTelemetryWrite = null
let telemetryWriteTimer = null
let trayMenuRefreshTimer = null
let trayMenuSignature = ''
let overlayRefitTimer = null
let overlayBootTimer = null
let runtimeStateSyncTimer = null
let settingsWindowSyncTimer = null
let settingsWindowRestorePending = false
let suppressSettingsBlurClose = false
let startupSplashActive = false
let startupSplashStartedAt = 0
let startupSplashProgress = 0
let mainRendererReadySenderId = 0
let correlationSeed = 0
let profilingState = createDefaultProfilingState()
let profilingScheduleTimer = null
let profilingStopTimer = null
let profilingCurrentTrace = null
let profilingLogWritePromise = Promise.resolve()
let packagedRendererProcess = null
let packagedRendererStopping = false
let packagedRendererPort = PACKAGED_RENDERER_PORT
let screenListenersRegistered = false
let updateRuntime = createDefaultUpdateRuntime()
let updateCheckPromise = null
let autoUpdaterInitialized = false
const appBootEpochMs = Date.now()
const overlayLifecycleStats = {
  createCount: 0,
  closeCount: 0,
}
const hasSingleInstanceLock = app.requestSingleInstanceLock()
configureDesktopIdentity()

function safeConsoleError(...args) {
  try {
    console.error(...args)
  } catch (error) {
    if (!isEpipeError(error)) {
      // Ignore logging failures in detached/closed stdio contexts.
    }
  }
}

function safeConsoleInfo(...args) {
  try {
    console.info(...args)
  } catch (error) {
    if (!isEpipeError(error)) {
      // Ignore logging failures in detached/closed stdio contexts.
    }
  }
}

function configureDesktopIdentity() {
  try {
    app.setName(APP_DISPLAY_NAME)
  } catch {
    // Ignore name override failures and continue with Electron defaults.
  }

  if (process.platform !== 'win32') return
  if (typeof app.setAppUserModelId !== 'function') return

  try {
    app.setAppUserModelId(APP_USER_MODEL_ID)
  } catch {
    // Ignore model id assignment failures in non-standard runtimes.
  }
}

function isEpipeError(error) {
  return !!error && typeof error === 'object' && error.code === 'EPIPE'
}

let processErrorGuardsAttached = false
function attachProcessErrorGuards() {
  if (processErrorGuardsAttached) return
  processErrorGuardsAttached = true

  const handleStreamError = (streamName, error) => {
    if (isEpipeError(error)) return
    safeConsoleError(`[process:${streamName}] stream error:`, error)
  }

  if (process.stdout && typeof process.stdout.on === 'function') {
    process.stdout.on('error', (error) => {
      handleStreamError('stdout', error)
    })
  }
  if (process.stderr && typeof process.stderr.on === 'function') {
    process.stderr.on('error', (error) => {
      handleStreamError('stderr', error)
    })
  }

  process.on('uncaughtException', (error) => {
    if (isEpipeError(error)) return
    safeConsoleError('[main] uncaught exception:', error)
    if (!isQuitting) {
      requestAppQuit()
    }
  })

  process.on('unhandledRejection', (reason) => {
    if (isEpipeError(reason)) return
    safeConsoleError('[main] unhandled rejection:', reason)
  })
}

attachProcessErrorGuards()

function getPerfElapsedMs() {
  return Math.max(0, Date.now() - appBootEpochMs)
}

function logStartupPhase(phase, detail = '') {
  if (!STARTUP_PHASE_LOG_ENABLED) return
  const suffix = detail ? ` ${detail}` : ''
  safeConsoleInfo(`[startup:+${getPerfElapsedMs()}ms] ${phase}${suffix}`)
}

function logOverlayLifecycle(phase, detail = '') {
  if (!OVERLAY_LIFECYCLE_LOG_ENABLED) return
  const suffix = detail ? ` ${detail}` : ''
  safeConsoleInfo(
    `[overlay:+${getPerfElapsedMs()}ms] ${phase}${suffix} (create=${overlayLifecycleStats.createCount}, close=${overlayLifecycleStats.closeCount})`,
  )
}

function createDefaultUpdateRuntime() {
  return {
    supported: false,
    stage: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: '',
    downloadedVersion: '',
    downloadPercent: 0,
    releaseName: '',
    releaseDate: '',
    error: '',
    checkedAt: null,
    updatedAt: Date.now(),
  }
}

function getUpdateRuntimeSnapshot() {
  return { ...updateRuntime }
}

function setUpdateRuntimePatch(patch = {}, options = {}) {
  updateRuntime = {
    ...updateRuntime,
    ...patch,
    updatedAt: Date.now(),
  }
  if (options.broadcast !== false) {
    broadcastUpdateState()
  }
  return getUpdateRuntimeSnapshot()
}

function broadcastUpdateState() {
  broadcastToWindows('update:state', getUpdateRuntimeSnapshot())
}

function applyUpdateInfo(info, options = {}) {
  const version = typeof info?.version === 'string' ? info.version : ''
  const releaseName = typeof info?.releaseName === 'string' ? info.releaseName : ''
  const releaseDate =
    typeof info?.releaseDate === 'string'
      ? info.releaseDate
      : info?.releaseDate instanceof Date
        ? info.releaseDate.toISOString()
        : ''
  const patch = {}
  if (version) patch.availableVersion = version
  if (releaseName) patch.releaseName = releaseName
  if (releaseDate) patch.releaseDate = releaseDate
  if (Object.keys(patch).length > 0) {
    setUpdateRuntimePatch(patch, options)
  }
}

function toUpdateErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message
  return String(error || 'Unknown update error')
}

function ensureAutoUpdaterInitialized() {
  if (autoUpdaterInitialized) return updateRuntime.supported
  autoUpdaterInitialized = true

  if (!app.isPackaged) {
    setUpdateRuntimePatch({
      supported: false,
      stage: 'unsupported',
      error: 'Auto update requires packaged app.',
      checkedAt: Date.now(),
    })
    return false
  }

  const autoUpdater = resolveAutoUpdater()
  if (!autoUpdater) {
    setUpdateRuntimePatch({
      supported: false,
      stage: 'unsupported',
      error: 'electron-updater is not available.',
      checkedAt: Date.now(),
    })
    return false
  }

  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    if (AUTO_UPDATE_FEED_URL) {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: ensureTrailingSlash(AUTO_UPDATE_FEED_URL),
      })
    }
  } catch (error) {
    setUpdateRuntimePatch({
      supported: false,
      stage: 'unsupported',
      error: toUpdateErrorMessage(error),
      checkedAt: Date.now(),
    })
    return false
  }

  autoUpdater.on('checking-for-update', () => {
    setUpdateRuntimePatch({
      supported: true,
      stage: 'checking',
      error: '',
      checkedAt: Date.now(),
      downloadPercent: 0,
    })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdateRuntimePatch({
      supported: true,
      stage: 'available',
      error: '',
      checkedAt: Date.now(),
      downloadPercent: 0,
      availableVersion: typeof info?.version === 'string' ? info.version : '',
    })
    applyUpdateInfo(info)
  })

  autoUpdater.on('update-not-available', () => {
    setUpdateRuntimePatch({
      supported: true,
      stage: 'not-available',
      error: '',
      checkedAt: Date.now(),
      downloadPercent: 100,
      downloadedVersion: '',
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = clampFloat(Number(progress?.percent || 0), 0, 100, 0)
    setUpdateRuntimePatch({
      supported: true,
      stage: 'downloading',
      error: '',
      downloadPercent: Math.round(percent * 10) / 10,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const version = typeof info?.version === 'string' ? info.version : ''
    setUpdateRuntimePatch({
      supported: true,
      stage: 'downloaded',
      error: '',
      downloadPercent: 100,
      downloadedVersion: version || updateRuntime.availableVersion || '',
    })
    applyUpdateInfo(info)
  })

  autoUpdater.on('error', (error) => {
    setUpdateRuntimePatch({
      supported: true,
      stage: 'error',
      error: toUpdateErrorMessage(error),
      checkedAt: Date.now(),
    })
  })

  setUpdateRuntimePatch({
    supported: true,
    stage: 'idle',
    error: '',
  })
  return true
}

async function checkForAppUpdates(trigger = 'manual') {
  if (!ensureAutoUpdaterInitialized()) {
    return getUpdateRuntimeSnapshot()
  }
  if (updateCheckPromise) {
    return updateCheckPromise
  }

  const autoUpdater = resolveAutoUpdater()
  if (!autoUpdater) {
    return setUpdateRuntimePatch({
      stage: 'unsupported',
      error: 'electron-updater is not available.',
      checkedAt: Date.now(),
    })
  }

  logStartupPhase('updater:check', trigger)
  updateCheckPromise = autoUpdater
    .checkForUpdates()
    .then((result) => {
      applyUpdateInfo(result?.updateInfo)
      return getUpdateRuntimeSnapshot()
    })
    .catch((error) => {
      return setUpdateRuntimePatch({
        stage: 'error',
        error: toUpdateErrorMessage(error),
        checkedAt: Date.now(),
      })
    })
    .finally(() => {
      updateCheckPromise = null
    })

  return updateCheckPromise
}

function installDownloadedUpdateNow() {
  if (!ensureAutoUpdaterInitialized()) return false
  const autoUpdater = resolveAutoUpdater()
  if (!autoUpdater) return false
  if (updateRuntime.stage !== 'downloaded') return false

  setUpdateRuntimePatch({
    stage: 'installing',
    error: '',
  })

  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      setUpdateRuntimePatch({
        stage: 'error',
        error: toUpdateErrorMessage(error),
      })
    }
  }, 50)
  return true
}

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name]
  if (typeof raw !== 'string') return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false
  return fallback
}

function parseIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name]
  if (typeof raw !== 'string') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function clampProfilingNumber(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function sanitizeProfilingMessage(value) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, PROFILING_MAX_ERROR_LENGTH)
}

function createDefaultProfilingState() {
  return {
    enabled: PROFILING_DEFAULT_ENABLED,
    intervalMs: PROFILING_DEFAULT_INTERVAL_MS,
    durationMs: PROFILING_DEFAULT_DURATION_MS,
    isTracing: false,
    nextCaptureAt: null,
    lastCaptureAt: null,
    lastTracePath: '',
    lastError: '',
    totalTraces: 0,
  }
}

function getProfilingStateSnapshot() {
  return { ...profilingState }
}

function setProfilingError(message) {
  profilingState.lastError = sanitizeProfilingMessage(message)
}

async function ensureProfilingDir() {
  await fsp.mkdir(PROFILING_DIR, { recursive: true })
}

function clearProfilingScheduleTimer() {
  if (!profilingScheduleTimer) return
  clearTimeout(profilingScheduleTimer)
  profilingScheduleTimer = null
}

function clearProfilingStopTimer() {
  if (!profilingStopTimer) return
  clearTimeout(profilingStopTimer)
  profilingStopTimer = null
}

function buildTraceFilePath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(PROFILING_DIR, `trace-${stamp}-${process.pid}.json`)
}

async function cleanupOldTraceFiles() {
  try {
    const entries = await fsp.readdir(PROFILING_DIR, { withFileTypes: true })
    const traces = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.startsWith('trace-') || !entry.name.endsWith('.json')) continue
      const filePath = path.join(PROFILING_DIR, entry.name)
      const stat = await fsp.stat(filePath)
      traces.push({ filePath, modifiedAt: stat.mtimeMs })
    }

    traces.sort((left, right) => right.modifiedAt - left.modifiedAt)
    const stale = traces.slice(PROFILING_TRACE_MAX_FILES)
    await Promise.all(stale.map((item) => fsp.rm(item.filePath, { force: true })))
  } catch {
    // Ignore trace cleanup errors.
  }
}

async function rotateProfilingLogIfNeeded(filePath) {
  try {
    const stat = await fsp.stat(filePath)
    if (stat.size < PROFILING_LOG_ROTATE_BYTES) return
    const extension = path.extname(filePath)
    const stem = filePath.slice(0, extension.length > 0 ? -extension.length : undefined)
    const archivePath = `${stem}-${Date.now()}${extension || '.log'}`
    await fsp.rename(filePath, archivePath)
  } catch {
    // Ignore missing file and rotate failures.
  }
}

function enqueueProfilingLogWrite(filePath, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return profilingLogWritePromise
  const payload = entries.map((entry) => `${JSON.stringify(entry)}\n`).join('')
  if (!payload) return profilingLogWritePromise

  profilingLogWritePromise = profilingLogWritePromise
    .catch(() => undefined)
    .then(async () => {
      await ensureProfilingDir()
      await rotateProfilingLogIfNeeded(filePath)
      await fsp.appendFile(filePath, payload, 'utf8')
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown profiling write error'
      console.error('[profiling] write failed:', message)
      setProfilingError(`write failed: ${message}`)
      broadcastProfilingState()
    })

  return profilingLogWritePromise
}

function normalizeReactCommitBatch(raw) {
  if (!Array.isArray(raw)) return []
  const accepted = []
  const now = Date.now()
  const limit = Math.min(PROFILING_MAX_BATCH_ITEMS, raw.length)

  for (let index = 0; index < limit; index += 1) {
    const item = raw[index]
    if (!item || typeof item !== 'object') continue

    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 96) : ''
    const phaseRaw = typeof item.phase === 'string' ? item.phase : 'update'
    const phase = phaseRaw === 'mount' || phaseRaw === 'update' || phaseRaw === 'nested-update' ? phaseRaw : 'update'
    const route = typeof item.route === 'string' ? item.route.trim().slice(0, 160) : ''

    const actualDurationMs = Math.round(clampProfilingNumber(item.actualDurationMs, 0, 120000, 0) * 1000) / 1000
    const baseDurationMs = Math.round(clampProfilingNumber(item.baseDurationMs, 0, 120000, 0) * 1000) / 1000
    const startTimeMs = Math.round(clampProfilingNumber(item.startTimeMs, 0, 24 * 60 * 60 * 1000, 0) * 1000) / 1000
    const commitTimeMs = Math.round(clampProfilingNumber(item.commitTimeMs, 0, 24 * 60 * 60 * 1000, 0) * 1000) / 1000
    const capturedAtRaw = clampProfilingNumber(item.capturedAt, 0, Number.MAX_SAFE_INTEGER, now)
    const capturedAt = Math.floor(capturedAtRaw || now)

    accepted.push({
      type: 'react.commit',
      id: id || 'qt-root',
      phase,
      route,
      actualDurationMs,
      baseDurationMs,
      startTimeMs,
      commitTimeMs,
      capturedAt,
    })
  }

  return accepted
}

function normalizePerformanceEntryBatch(raw) {
  if (!Array.isArray(raw)) return []
  const accepted = []
  const now = Date.now()
  const limit = Math.min(PROFILING_MAX_BATCH_ITEMS, raw.length)

  for (let index = 0; index < limit; index += 1) {
    const item = raw[index]
    if (!item || typeof item !== 'object') continue

    const entryType = typeof item.entryType === 'string' ? item.entryType.trim().slice(0, 48) : ''
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 120) : ''
    if (!entryType || !name) continue

    const route = typeof item.route === 'string' ? item.route.trim().slice(0, 160) : ''
    const detail = typeof item.detail === 'string' ? item.detail.trim().slice(0, 240) : ''
    const startTimeMs = Math.round(clampProfilingNumber(item.startTimeMs, 0, 24 * 60 * 60 * 1000, 0) * 1000) / 1000
    const durationMs = Math.round(clampProfilingNumber(item.durationMs, 0, 24 * 60 * 60 * 1000, 0) * 1000) / 1000
    const capturedAtRaw = clampProfilingNumber(item.capturedAt, 0, Number.MAX_SAFE_INTEGER, now)
    const capturedAt = Math.floor(capturedAtRaw || now)

    accepted.push({
      type: 'renderer.performance',
      entryType,
      name,
      route,
      detail,
      startTimeMs,
      durationMs,
      capturedAt,
    })
  }

  return accepted
}

function reportReactProfilingBatch(raw) {
  const normalized = normalizeReactCommitBatch(raw)
  if (normalized.length === 0) return { ok: true, accepted: 0 }

  enqueueProfilingLogWrite(REACT_PROFILE_LOG_PATH, normalized)
  return { ok: true, accepted: normalized.length }
}

function reportPerformanceProfilingBatch(raw) {
  const normalized = normalizePerformanceEntryBatch(raw)
  if (normalized.length === 0) return { ok: true, accepted: 0 }

  enqueueProfilingLogWrite(RENDERER_PERF_LOG_PATH, normalized)
  return { ok: true, accepted: normalized.length }
}

function normalizeProfilingIntervalMs(value) {
  return Math.round(clampProfilingNumber(value, 60 * 1000, 45 * 60 * 1000, PROFILING_DEFAULT_INTERVAL_MS))
}

function normalizeProfilingDurationMs(value) {
  return Math.round(clampProfilingNumber(value, 1000, 60 * 1000, PROFILING_DEFAULT_DURATION_MS))
}

async function stopProfilingTraceCapture(reason = 'manual') {
  clearProfilingStopTimer()
  const activeTrace = profilingCurrentTrace
  if (!profilingState.isTracing || !activeTrace) {
    profilingState.isTracing = false
    profilingCurrentTrace = null
    if (profilingState.enabled && !isQuitting) {
      scheduleNextProfilingRun()
    } else {
      profilingState.nextCaptureAt = null
      broadcastProfilingState()
    }
    return false
  }

  try {
    const resultPath = await contentTracing.stopRecording(activeTrace.filePath)
    profilingState.lastCaptureAt = Date.now()
    profilingState.lastTracePath = typeof resultPath === 'string' && resultPath.trim() ? resultPath : activeTrace.filePath
    profilingState.totalTraces += 1
    profilingState.lastError = ''
    await cleanupOldTraceFiles()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown tracing stop error'
    setProfilingError(`trace stop failed (${reason}): ${message}`)
  } finally {
    profilingState.isTracing = false
    profilingCurrentTrace = null
    if (profilingState.enabled && !isQuitting) {
      scheduleNextProfilingRun()
    } else {
      profilingState.nextCaptureAt = null
      broadcastProfilingState()
    }
  }

  return true
}

async function startProfilingTraceCapture(trigger = 'interval') {
  if (!profilingState.enabled || profilingState.isTracing || isQuitting) return false

  clearProfilingScheduleTimer()
  profilingState.nextCaptureAt = null

  try {
    await ensureProfilingDir()
    const filePath = buildTraceFilePath()
    await contentTracing.startRecording({
      included_categories: PROFILING_TRACE_CATEGORIES,
      trace_options: 'record-until-full,enable-sampling',
    })

    profilingState.isTracing = true
    profilingState.lastError = ''
    profilingCurrentTrace = {
      filePath,
      trigger,
      startedAt: Date.now(),
    }
    clearProfilingStopTimer()
    profilingStopTimer = setTimeout(() => {
      void stopProfilingTraceCapture('timer')
    }, profilingState.durationMs)
    broadcastProfilingState()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown tracing start error'
    setProfilingError(`trace start failed (${trigger}): ${message}`)
    profilingState.isTracing = false
    profilingCurrentTrace = null
    if (profilingState.enabled && !isQuitting) {
      scheduleNextProfilingRun()
    } else {
      broadcastProfilingState()
    }
    return false
  }
}

function scheduleNextProfilingRun(delayMs = profilingState.intervalMs) {
  clearProfilingScheduleTimer()
  if (!profilingState.enabled || isQuitting) {
    profilingState.nextCaptureAt = null
    broadcastProfilingState()
    return
  }

  const safeDelay = Math.round(clampProfilingNumber(delayMs, 1000, 45 * 60 * 1000, profilingState.intervalMs))
  profilingState.nextCaptureAt = Date.now() + safeDelay
  profilingScheduleTimer = setTimeout(() => {
    profilingScheduleTimer = null
    profilingState.nextCaptureAt = null
    void runProfilingCaptureCycle()
  }, safeDelay)
  broadcastProfilingState()
}

async function runProfilingCaptureCycle() {
  if (!profilingState.enabled || isQuitting) {
    profilingState.nextCaptureAt = null
    broadcastProfilingState()
    return
  }

  const started = await startProfilingTraceCapture('interval')
  if (!started && profilingState.enabled && !isQuitting) {
    scheduleNextProfilingRun(Math.min(profilingState.intervalMs, 90 * 1000))
  }
}

function updateProfilingConfig(partial) {
  const payload = partial && typeof partial === 'object' ? partial : {}
  let changed = false

  if (typeof payload.enabled === 'boolean' && payload.enabled !== profilingState.enabled) {
    profilingState.enabled = payload.enabled
    changed = true
  }

  if (typeof payload.intervalMs === 'number') {
    const nextInterval = normalizeProfilingIntervalMs(payload.intervalMs)
    if (nextInterval !== profilingState.intervalMs) {
      profilingState.intervalMs = nextInterval
      changed = true
    }
  }

  if (typeof payload.durationMs === 'number') {
    const nextDuration = normalizeProfilingDurationMs(payload.durationMs)
    if (nextDuration !== profilingState.durationMs) {
      profilingState.durationMs = nextDuration
      changed = true
    }
  }

  if (!changed) return getProfilingStateSnapshot()

  if (!profilingState.enabled) {
    clearProfilingScheduleTimer()
    profilingState.nextCaptureAt = null
    if (profilingState.isTracing) {
      void stopProfilingTraceCapture('disabled')
    } else {
      broadcastProfilingState()
    }
    return getProfilingStateSnapshot()
  }

  if (!profilingState.isTracing) {
    scheduleNextProfilingRun(Math.min(profilingState.intervalMs, 2500))
  } else {
    broadcastProfilingState()
  }

  return getProfilingStateSnapshot()
}

function initializeProfilingScheduler() {
  profilingState = createDefaultProfilingState()
  profilingCurrentTrace = null
  clearProfilingScheduleTimer()
  clearProfilingStopTimer()
  if (!profilingState.enabled) {
    profilingState.nextCaptureAt = null
    broadcastProfilingState()
    return
  }
  scheduleNextProfilingRun(Math.min(profilingState.intervalMs, 3000))
}

async function shutdownProfilingRuntime() {
  clearProfilingScheduleTimer()
  if (profilingState.isTracing) {
    await stopProfilingTraceCapture('shutdown')
  }
  await profilingLogWritePromise.catch(() => undefined)
}

async function loadSettings() {
  try {
    const raw = await fsp.readFile(SETTINGS_PATH, 'utf8')
    const saved = JSON.parse(raw)
    currentSettings = normalizeSettings(saved)
    return currentSettings
  } catch {
    currentSettings = normalizeSettings(DEFAULT_SETTINGS)
    await saveSettings(currentSettings, { immediate: true })
    return currentSettings
  }
}

async function writeJsonAtomicFile(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const payload = JSON.stringify(data, null, 2)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(tempPath, payload, 'utf8')
  try {
    await fsp.rename(tempPath, filePath)
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function writeSettingsToDisk(settings) {
  await writeJsonAtomicFile(SETTINGS_PATH, settings)
}

function flushPendingSettingsWrite(options = {}) {
  const throwOnError = !!options.throwOnError
  if (settingsWriteTimer) {
    clearTimeout(settingsWriteTimer)
    settingsWriteTimer = null
  }

  const pending = pendingSettingsWrite
  pendingSettingsWrite = null
  if (!pending) {
    if (throwOnError && lastSettingsWriteError) {
      return Promise.reject(lastSettingsWriteError)
    }
    return settingsWritePromise
  }

  const writeOperation = settingsWritePromise
    .catch(() => undefined)
    .then(async () => {
      await writeSettingsToDisk(pending)
      lastSettingsWriteError = null
    })

  settingsWritePromise = settingsWritePromise
    .catch(() => undefined)
    .then(() => writeOperation)
    .catch((error) => {
      lastSettingsWriteError = error
      console.error('[settings] write failed:', error)
      const message = error instanceof Error ? error.message : 'Settings write failed'
      broadcastToWindows('settings:write-error', { message })
      return undefined
    })

  if (!throwOnError) return settingsWritePromise

  return writeOperation.catch((error) => {
    throw error
  })
}

function saveSettings(settings, options = {}) {
  const next = settings && typeof settings === 'object' ? settings : ensureSettings()
  pendingSettingsWrite = next

  if (options.immediate || options.awaitFlush) {
    return flushPendingSettingsWrite({ throwOnError: !!options.awaitFlush })
  }

  if (settingsWriteTimer) {
    clearTimeout(settingsWriteTimer)
  }
  settingsWriteTimer = setTimeout(() => {
    void flushPendingSettingsWrite().catch(() => undefined)
  }, SETTINGS_WRITE_DEBOUNCE_MS)

  return settingsWritePromise
}

function createDefaultTelemetry() {
  return {
    send: { ...DEFAULT_TELEMETRY.send },
    hotkey: { ...DEFAULT_TELEMETRY.hotkey },
    updatedAt: DEFAULT_TELEMETRY.updatedAt,
  }
}

async function rotateTelemetryFilesIfNeeded() {
  try {
    const stat = await fsp.stat(TELEMETRY_PATH)
    if (!stat.isFile() || stat.size < TELEMETRY_ROTATE_MAX_BYTES) return
  } catch {
    return
  }

  await fsp.rm(`${TELEMETRY_PATH}.${TELEMETRY_RETENTION_FILES}`, { force: true }).catch(() => undefined)
  for (let index = TELEMETRY_RETENTION_FILES - 1; index >= 1; index -= 1) {
    const source = `${TELEMETRY_PATH}.${index}`
    const target = `${TELEMETRY_PATH}.${index + 1}`
    await fsp.rename(source, target).catch(() => undefined)
  }
  await fsp.rename(TELEMETRY_PATH, `${TELEMETRY_PATH}.1`).catch(() => undefined)
}

function flushPendingTelemetryWrite(options = {}) {
  const throwOnError = !!options.throwOnError
  if (telemetryWriteTimer) {
    clearTimeout(telemetryWriteTimer)
    telemetryWriteTimer = null
  }

  const pending = pendingTelemetryWrite
  pendingTelemetryWrite = null
  if (!pending) return telemetryWritePromise

  const writeOperation = telemetryWritePromise
    .catch(() => undefined)
    .then(async () => {
      await rotateTelemetryFilesIfNeeded()
      await writeJsonAtomicFile(TELEMETRY_PATH, pending)
    })

  telemetryWritePromise = telemetryWritePromise
    .catch(() => undefined)
    .then(() => writeOperation)
    .catch((error) => {
      console.error('[telemetry] write failed:', error)
      return undefined
    })

  if (!throwOnError) return telemetryWritePromise
  return writeOperation
}

async function loadTelemetry() {
  try {
    const raw = await fsp.readFile(TELEMETRY_PATH, 'utf8')
    const saved = JSON.parse(raw)
    currentTelemetry = normalizeTelemetry(saved)
    return currentTelemetry
  } catch {
    currentTelemetry = createDefaultTelemetry()
    await saveTelemetry(currentTelemetry, { immediate: true })
    return currentTelemetry
  }
}

function saveTelemetry(telemetry, options = {}) {
  const normalized = normalizeTelemetry(telemetry)
  currentTelemetry = normalized
  pendingTelemetryWrite = normalized

  if (options.immediate || options.awaitFlush) {
    return flushPendingTelemetryWrite({ throwOnError: !!options.awaitFlush })
  }

  if (telemetryWriteTimer) {
    clearTimeout(telemetryWriteTimer)
  }
  telemetryWriteTimer = setTimeout(() => {
    telemetryWriteTimer = null
    void flushPendingTelemetryWrite().catch(() => undefined)
  }, TELEMETRY_WRITE_DEBOUNCE_MS)

  return telemetryWritePromise
}

function normalizeTelemetry(saved) {
  const input = saved && typeof saved === 'object' ? saved : {}
  const sendInput = input.send && typeof input.send === 'object' ? input.send : {}
  const hotkeyInput = input.hotkey && typeof input.hotkey === 'object' ? input.hotkey : {}

  const successCount = normalizeTelemetryCount(sendInput.successCount)
  const failureCount = normalizeTelemetryCount(sendInput.failureCount)
  const sampleCount = Math.max(normalizeTelemetryCount(sendInput.sampleCount), successCount + failureCount)

  const minLatencyMs = normalizeTelemetryNullableLatency(sendInput.minLatencyMs)
  const maxLatencyMs = normalizeTelemetryNullableLatency(sendInput.maxLatencyMs)
  const lastLatencyMs = normalizeTelemetryNullableLatency(sendInput.lastLatencyMs)
  const totalLatencyMs = normalizeTelemetryLatency(sendInput.totalLatencyMs, 0)
  const avgLatencyMs = sampleCount > 0 ? roundTelemetry(totalLatencyMs / sampleCount) : 0

  return {
    send: {
      successCount,
      failureCount,
      sampleCount,
      totalLatencyMs: roundTelemetry(totalLatencyMs),
      avgLatencyMs,
      minLatencyMs,
      maxLatencyMs,
      lastLatencyMs,
      lastSuccessAt: normalizeTelemetryTimestamp(sendInput.lastSuccessAt),
      lastFailureAt: normalizeTelemetryTimestamp(sendInput.lastFailureAt),
      lastError: sanitizeTelemetryMessage(sendInput.lastError),
      lastRequestId: sanitizeCorrelationId(sendInput.lastRequestId),
    },
    hotkey: {
      errorCount: normalizeTelemetryCount(hotkeyInput.errorCount),
      lastError: sanitizeTelemetryMessage(hotkeyInput.lastError),
      lastErrorAt: normalizeTelemetryTimestamp(hotkeyInput.lastErrorAt),
      lastErrorSource: normalizeHotkeyErrorSource(hotkeyInput.lastErrorSource),
      lastRequestId: sanitizeCorrelationId(hotkeyInput.lastRequestId),
    },
    updatedAt: normalizeTelemetryTimestamp(input.updatedAt) || 0,
  }
}

function normalizeTelemetryCount(value) {
  return Math.max(0, Math.floor(normalizeTelemetryNumber(value, 0)))
}

function normalizeTelemetryLatency(value, fallback) {
  const raw = normalizeTelemetryNumber(value, fallback)
  return Math.min(TELEMETRY_MAX_LATENCY_MS, Math.max(0, raw))
}

function normalizeTelemetryNullableLatency(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return roundTelemetry(normalizeTelemetryLatency(value, 0))
}

function normalizeTelemetryTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.floor(value)
}

function normalizeTelemetryNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeTelemetryMessage(value) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, TELEMETRY_MAX_ERROR_LENGTH)
}

function sanitizeCorrelationId(value) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, 96)
}

function nextCorrelationId(prefix) {
  correlationSeed = (correlationSeed + 1) % 1000000
  return `${prefix}-${Date.now().toString(36)}-${correlationSeed.toString(36)}`
}

function normalizeHotkeyErrorSource(value) {
  if (value === 'python-config' || value === 'input-events' || value === 'overlay-action') return value
  return 'unknown'
}

function roundTelemetry(value) {
  return Math.round(value * 100) / 100
}

function ensureTelemetry() {
  if (!currentTelemetry) {
    currentTelemetry = createDefaultTelemetry()
  }
  return currentTelemetry
}

function recordSendTelemetry(payload) {
  const telemetry = ensureTelemetry()
  const send = telemetry.send
  const success = !!(payload && payload.success === true)
  const latencyMs = roundTelemetry(normalizeTelemetryLatency(payload?.latencyMs, 0))
  const now = Date.now()
  const requestId = sanitizeCorrelationId(payload?.requestId || payload?.correlationId || nextCorrelationId('telemetry-send'))

  send.sampleCount = normalizeTelemetryCount(send.sampleCount) + 1
  send.totalLatencyMs = roundTelemetry(normalizeTelemetryLatency(send.totalLatencyMs + latencyMs, 0))
  send.avgLatencyMs = roundTelemetry(send.totalLatencyMs / Math.max(1, send.sampleCount))
  send.lastLatencyMs = latencyMs

  if (send.minLatencyMs === null) {
    send.minLatencyMs = latencyMs
  } else {
    send.minLatencyMs = roundTelemetry(Math.min(send.minLatencyMs, latencyMs))
  }

  if (send.maxLatencyMs === null) {
    send.maxLatencyMs = latencyMs
  } else {
    send.maxLatencyMs = roundTelemetry(Math.max(send.maxLatencyMs, latencyMs))
  }

  if (success) {
    send.successCount = normalizeTelemetryCount(send.successCount) + 1
    send.lastSuccessAt = now
  } else {
    send.failureCount = normalizeTelemetryCount(send.failureCount) + 1
    send.lastFailureAt = now
    const message = sanitizeTelemetryMessage(payload?.error)
    if (message) {
      send.lastError = message
    }
  }
  send.lastRequestId = requestId

  telemetry.updatedAt = now
  void saveTelemetry(telemetry)
  broadcastTelemetry()
  return telemetry
}

function recordHotkeyError(payload) {
  const telemetry = ensureTelemetry()
  const message = sanitizeTelemetryMessage(payload?.message)
  if (!message) {
    return telemetry
  }

  const now = Date.now()
  const requestId = sanitizeCorrelationId(payload?.requestId || payload?.correlationId || nextCorrelationId('telemetry-hotkey'))
  telemetry.hotkey.errorCount = normalizeTelemetryCount(telemetry.hotkey.errorCount) + 1
  telemetry.hotkey.lastError = message
  telemetry.hotkey.lastErrorAt = now
  telemetry.hotkey.lastErrorSource = normalizeHotkeyErrorSource(payload?.source)
  telemetry.hotkey.lastRequestId = requestId
  telemetry.updatedAt = now

  void saveTelemetry(telemetry)
  broadcastTelemetry()
  return telemetry
}

function normalizeSettings(saved) {
  const input = saved && typeof saved === 'object' ? saved : {}
  const merged = { ...DEFAULT_SETTINGS, ...input }
  delete merged.startupSplashCompleted

  const legacyMode = normalizeLegacyMode(input.mode)

  merged.overlayVisible =
    typeof input.overlayVisible === 'boolean'
      ? input.overlayVisible
      : typeof input.overlayEnabled === 'boolean'
        ? input.overlayEnabled
        : legacyMode === 'main'
          ? false
          : legacyMode === 'overlay-text' || legacyMode === 'overlay-position'
            ? true
            : DEFAULT_SETTINGS.overlayVisible
  merged.appEnabled = typeof input.appEnabled === 'boolean' ? input.appEnabled : DEFAULT_SETTINGS.appEnabled
  merged.overlayInteractive =
    typeof input.overlayInteractive === 'boolean' ? input.overlayInteractive : DEFAULT_SETTINGS.overlayInteractive
  merged.overlaySmartClickThrough =
    typeof input.overlaySmartClickThrough === 'boolean'
      ? input.overlaySmartClickThrough
      : DEFAULT_SETTINGS.overlaySmartClickThrough
  merged.overlayElementsVisible =
    typeof input.overlayElementsVisible === 'boolean' ? input.overlayElementsVisible : DEFAULT_SETTINGS.overlayElementsVisible
  merged.overlayShowIcon =
    typeof input.overlayShowIcon === 'boolean' ? input.overlayShowIcon : DEFAULT_SETTINGS.overlayShowIcon
  merged.overlayShowCounter =
    typeof input.overlayShowCounter === 'boolean' ? input.overlayShowCounter : DEFAULT_SETTINGS.overlayShowCounter
  merged.overlaySnapTolerancePx = clampFloat(
    input.overlaySnapTolerancePx,
    4,
    28,
    DEFAULT_SETTINGS.overlaySnapTolerancePx,
  )
  merged.overlayDragDelayMs = clampInt(input.overlayDragDelayMs, 0, 180, DEFAULT_SETTINGS.overlayDragDelayMs)
  merged.overlayDragFrictionMs = clampInt(input.overlayDragFrictionMs, 0, 24, DEFAULT_SETTINGS.overlayDragFrictionMs)
  merged.overlayPreciseDragFactor = clampFloat(
    input.overlayPreciseDragFactor,
    0.08,
    0.7,
    DEFAULT_SETTINGS.overlayPreciseDragFactor,
  )

  const requestedSendHotkey = firstString(input.sendHotkey, input.modeCycleHotkey, input.hotkey, input.modeToggleHotkey)
  merged.sendHotkey = normalizeHotkey(requestedSendHotkey, DEFAULT_SETTINGS.sendHotkey)
  merged.appToggleHotkey = normalizeHotkey(input.appToggleHotkey, DEFAULT_SETTINGS.appToggleHotkey)
  if (normalizeHotkeyToken(merged.appToggleHotkey) === '5') {
    merged.appToggleHotkey = DEFAULT_SETTINGS.appToggleHotkey
  }
  merged.overlayToggleHotkey = normalizeHotkey(input.overlayToggleHotkey, DEFAULT_SETTINGS.overlayToggleHotkey)
  merged.mainToggleHotkey = normalizeHotkey(input.mainToggleHotkey, DEFAULT_SETTINGS.mainToggleHotkey)
  merged.overlayEditHotkey = normalizeHotkey(input.overlayEditHotkey, DEFAULT_SETTINGS.overlayEditHotkey)
  merged.hotkeyOverrides = normalizeHotkeyOverrides(input.hotkeyOverrides)
  merged.uiMode = normalizeUiMode(input.uiMode, DEFAULT_SETTINGS.uiMode)
  merged.uiPalette = normalizeUiPalette(input.uiPalette, DEFAULT_SETTINGS.uiPalette)
  merged.uiLanguage = normalizeUiLanguage(input.uiLanguage, DEFAULT_SETTINGS.uiLanguage)

  const derivedHotkeyOverrides = deriveHotkeyOverridesFromSettings(merged)
  const hotkeyPatch = createHotkeyPatchFromOverrides(derivedHotkeyOverrides)
  merged.appToggleHotkey = hotkeyPatch.appToggleHotkey
  merged.sendHotkey = hotkeyPatch.sendHotkey
  merged.overlayToggleHotkey = hotkeyPatch.overlayToggleHotkey
  merged.mainToggleHotkey = hotkeyPatch.mainToggleHotkey
  merged.overlayEditHotkey = hotkeyPatch.overlayEditHotkey
  merged.hotkeyOverrides = hotkeyPatch.hotkeyOverrides

  merged.textAlign =
    input.textAlign === 'left' || input.textAlign === 'center' || input.textAlign === 'right'
      ? input.textAlign
      : DEFAULT_SETTINGS.textAlign

  if (!Array.isArray(input.items) || input.items.length === 0) {
    merged.items = DEFAULT_SETTINGS.items.map((item) => ({ ...item }))
  } else {
    merged.items = input.items
      .map((item) => ({
        text: typeof item?.text === 'string' ? item.text.trim() : '',
        note: typeof item?.note === 'string' ? item.note : '',
      }))
      .filter((item) => item.text.length > 0)

    if (merged.items.length === 0) {
      merged.items = DEFAULT_SETTINGS.items.map((item) => ({ ...item }))
    }
  }

  const maxIndex = Math.max(0, merged.items.length - 1)
  merged.selectedIndex = clampInt(input.selectedIndex, 0, maxIndex, DEFAULT_SETTINGS.selectedIndex)

  merged.overlayX = clampInt(input.overlayX, -20000, 20000, DEFAULT_SETTINGS.overlayX)
  merged.overlayY = clampInt(input.overlayY, -20000, 20000, DEFAULT_SETTINGS.overlayY)
  merged.overlayWidth = OVERLAY_FULLSCREEN_SIZE
  merged.overlayHeight = OVERLAY_FULLSCREEN_SIZE
  merged.windowX = clampInt(input.windowX, -20000, 20000, DEFAULT_SETTINGS.windowX)
  merged.windowY = clampInt(input.windowY, -20000, 20000, DEFAULT_SETTINGS.windowY)
  merged.windowWidth = clampInt(input.windowWidth, 560, 3600, DEFAULT_SETTINGS.windowWidth)
  merged.windowHeight = clampInt(input.windowHeight, 420, 3000, DEFAULT_SETTINGS.windowHeight)
  merged.opacity = clampFloat(input.opacity, 0.2, 1, DEFAULT_SETTINGS.opacity)
  merged.noteOpacity = clampFloat(input.noteOpacity, 0.2, 1, DEFAULT_SETTINGS.noteOpacity)
  merged.textColor = normalizeHexColor(input.textColor, DEFAULT_SETTINGS.textColor)
  merged.noteColor = normalizeHexColor(input.noteColor, DEFAULT_SETTINGS.noteColor)
  merged.fontSize = clampFloat(input.fontSize, 24, 120, DEFAULT_SETTINGS.fontSize)
  merged.noteSize = clampFloat(input.noteSize, 12, 72, DEFAULT_SETTINGS.noteSize)
  merged.textOffsetXPercent = clampFloat(input.textOffsetXPercent, -70, 70, DEFAULT_SETTINGS.textOffsetXPercent)
  merged.textOffsetYPercent = clampFloat(input.textOffsetYPercent, -45, 45, DEFAULT_SETTINGS.textOffsetYPercent)
  merged.noteOffsetXPercent = clampFloat(input.noteOffsetXPercent, -70, 70, DEFAULT_SETTINGS.noteOffsetXPercent)
  merged.noteOffsetYPercent = clampFloat(input.noteOffsetYPercent, -45, 45, DEFAULT_SETTINGS.noteOffsetYPercent)
  merged.iconOffsetXPercent = clampFloat(input.iconOffsetXPercent, -70, 70, DEFAULT_SETTINGS.iconOffsetXPercent)
  merged.iconOffsetYPercent = clampFloat(input.iconOffsetYPercent, -45, 45, DEFAULT_SETTINGS.iconOffsetYPercent)
  merged.counterOffsetXPercent = clampFloat(input.counterOffsetXPercent, -70, 70, DEFAULT_SETTINGS.counterOffsetXPercent)
  merged.counterOffsetYPercent = clampFloat(input.counterOffsetYPercent, -45, 45, DEFAULT_SETTINGS.counterOffsetYPercent)

  return merged
}

function normalizeLegacyMode(value) {
  if (value === 'main' || value === 'overlay-text' || value === 'overlay-position') return value
  return null
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

function normalizeHotkey(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function normalizeHotkeyOverrides(value) {
  if (!value || typeof value !== 'object') return {}
  const raw = value
  const next = {}

  for (const action of HOTKEY_ACTIONS) {
    const combo = normalizeHotkey(raw[action.id], '')
    if (!combo) continue
    if (isReservedHotkey(combo)) continue
    next[action.id] = combo
  }

  return next
}

function deriveHotkeyOverridesFromSettings(settings) {
  const overrides = normalizeHotkeyOverrides(settings.hotkeyOverrides)

  for (const action of HOTKEY_ACTIONS) {
    if (typeof overrides[action.id] === 'string') continue

    const current = normalizeHotkey(settings[action.settingKey], action.defaultCombo)
    if (!current) continue
    if (isSameHotkey(current, action.defaultCombo)) continue
    overrides[action.id] = current
  }

  return overrides
}

function createHotkeyPatchFromOverrides(overrides) {
  const normalized = normalizeHotkeyOverrides(overrides)
  const patch = {
    hotkeyOverrides: normalized,
    appToggleHotkey: getActionComboWithOverrides('app.toggle_enabled', normalized),
    overlayToggleHotkey: getActionComboWithOverrides('overlay.toggle_visibility', normalized),
    mainToggleHotkey: getActionComboWithOverrides('main.toggle_visibility', normalized),
    overlayEditHotkey: getActionComboWithOverrides('overlay.toggle_interaction', normalized),
    sendHotkey: getActionComboWithOverrides('text.send_current', normalized),
  }

  return enforceUniqueHotkeys(patch)
}

function getActionComboWithOverrides(actionId, overrides) {
  const action = HOTKEY_ACTIONS.find((item) => item.id === actionId)
  if (!action) return ''

  const overrideValue = normalizeHotkey(overrides[actionId], '')
  if (overrideValue && !isReservedHotkey(overrideValue)) {
    return overrideValue
  }

  return action.defaultCombo
}

function enforceUniqueHotkeys(patch) {
  const next = { ...patch, hotkeyOverrides: { ...(patch.hotkeyOverrides || {}) } }
  const seen = new Set()

  for (const action of HOTKEY_ACTIONS) {
    let combo = normalizeHotkey(next[action.settingKey], action.defaultCombo)
    let token = normalizeHotkeyToken(combo)

    if (!token || seen.has(token) || isReservedHotkey(combo)) {
      combo = action.defaultCombo
      token = normalizeHotkeyToken(combo)
      delete next.hotkeyOverrides[action.id]
    }

    next[action.settingKey] = combo
    if (token) seen.add(token)
  }

  return next
}

function isReservedHotkey(combo) {
  const token = normalizeHotkeyToken(combo)
  return token ? RESERVED_HOTKEYS.has(token) : false
}

function normalizeUiMode(value, fallback) {
  if (value === 'dark' || value === 'light') return value
  return fallback
}

function normalizeUiPalette(value, fallback) {
  if (value === 'icon' || value === 'jade' || value === 'crimson' || value === 'dark' || value === 'light') return value
  return fallback
}

function normalizeUiLanguage(value, fallback) {
  if (value === 'vi' || value === 'en') return value
  return fallback
}

function isSameHotkey(a, b) {
  return normalizeHotkeyToken(a) === normalizeHotkeyToken(b)
}

function normalizeHotkeyToken(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function clampInt(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return Math.min(max, Math.max(min, rounded))
}

function clampFloat(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback
}

function ensureSettings() {
  if (!currentSettings) {
    currentSettings = normalizeSettings(DEFAULT_SETTINGS)
  }
  return currentSettings
}

function buildRendererUrl(routePath) {
  const startURL = process.env.ELECTRON_START_URL || 'http://localhost:3000'
  const base = startURL.endsWith('/') ? startURL : `${startURL}/`
  return new URL(routePath, base).toString()
}

async function prewarmOverlayRouteOnStartup() {
  if (!app.isPackaged) return
  const overlayUrl = buildRendererUrl('/overlay')
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, STARTUP_OVERLAY_PREWARM_TIMEOUT_MS)

  try {
    logStartupPhase('overlay-prewarm', `begin ${overlayUrl}`)
    const response = await fetch(overlayUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`overlay prewarm failed (${response.status})`)
    }
    await response.text().catch(() => '')
    logStartupPhase('overlay-prewarm', `done ${Date.now() - startedAt}ms`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown')
    safeConsoleError('[startup] overlay prewarm skipped:', message)
  } finally {
    clearTimeout(timeoutId)
  }
}

function resolvePackagedRendererScriptPath() {
  const candidates = [
    path.join(process.resourcesPath, '.next-build', 'standalone-runtime', 'server.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', '.next-build', 'standalone-runtime', 'server.js'),
    path.join(app.getAppPath(), '.next-build', 'standalone-runtime', 'server.js'),
    path.join(process.resourcesPath, '.next', 'standalone-runtime', 'server.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', '.next', 'standalone-runtime', 'server.js'),
    path.join(app.getAppPath(), '.next', 'standalone-runtime', 'server.js'),
    path.join(process.resourcesPath, '.next', 'standalone-materialized', 'server.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', '.next', 'standalone-materialized', 'server.js'),
    path.join(app.getAppPath(), '.next', 'standalone-materialized', 'server.js'),
    path.join(process.resourcesPath, '.next', 'standalone', 'server.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', '.next', 'standalone', 'server.js'),
    path.join(app.getAppPath(), '.next', 'standalone', 'server.js'),
  ]

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // Ignore filesystem errors while resolving packaged server.
    }
  }

  return ''
}

function getPackagedRendererBaseUrl(port = packagedRendererPort) {
  return `http://${PACKAGED_RENDERER_HOST}:${port}`
}

async function isTcpPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    let settled = false

    const settle = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    server.once('error', () => {
      settle(false)
    })

    server.once('listening', () => {
      server.close(() => settle(true))
    })

    server.listen(port, host)
  })
}

async function findAvailablePackagedRendererPort(preferredPort) {
  const start = Math.max(1024, Math.floor(preferredPort || PACKAGED_RENDERER_PORT))
  for (let offset = 0; offset < PACKAGED_RENDERER_MAX_PORT_SCAN; offset += 1) {
    const candidate = start + offset
    if (candidate > 65535) break
    // eslint-disable-next-line no-await-in-loop
    const available = await isTcpPortAvailable(PACKAGED_RENDERER_HOST, candidate)
    if (available) return candidate
  }
  return null
}

async function waitForPackagedRendererServer(baseUrl, timeoutMs, childRef) {
  const deadline = Date.now() + timeoutMs
  const healthUrl = `${baseUrl}/main`
  let childExited = false

  if (childRef) {
    childRef.once('exit', () => {
      childExited = true
    })
  }

  while (Date.now() < deadline) {
    if (childExited) return false
    try {
      const response = await fetch(healthUrl, { method: 'GET', cache: 'no-store' })
      if (response.ok || (response.status >= 300 && response.status < 500)) return true
    } catch {
      // Retry until timeout.
    }
    await delayMs(280)
  }

  return false
}

async function stopPackagedRendererServer() {
  const child = packagedRendererProcess
  if (!child) return

  packagedRendererStopping = true

  await new Promise((resolve) => {
    let settled = false

    const settle = () => {
      if (settled) return
      settled = true
      resolve()
    }

    child.once('exit', settle)
    try {
      child.kill()
    } catch {
      settle()
      return
    }

    setTimeout(() => {
      if (settled) return
      try {
        child.kill('SIGKILL')
      } catch {
        // Ignore hard-stop failures.
      }
      settle()
    }, 1500)
  })

  packagedRendererProcess = null
  packagedRendererStopping = false
}

async function startPackagedRendererServerIfNeeded() {
  if (!app.isPackaged) return true

  const explicitStartUrl = typeof process.env.ELECTRON_START_URL === 'string' ? process.env.ELECTRON_START_URL.trim() : ''
  if (explicitStartUrl) return true

  if (packagedRendererProcess && !packagedRendererProcess.killed) {
    process.env.ELECTRON_START_URL = getPackagedRendererBaseUrl(packagedRendererPort)
    return true
  }

  const serverScriptPath = resolvePackagedRendererScriptPath()
  if (!serverScriptPath) {
    console.error('[renderer] standalone server.js not found in packaged app')
    return false
  }

  const selectedPort = await findAvailablePackagedRendererPort(packagedRendererPort)
  if (!selectedPort) {
    console.error('[renderer] no available localhost port found for packaged server')
    return false
  }

  packagedRendererPort = selectedPort
  const baseUrl = getPackagedRendererBaseUrl(packagedRendererPort)
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOSTNAME: PACKAGED_RENDERER_HOST,
    PORT: String(packagedRendererPort),
  }

  const child = spawn(process.execPath, [serverScriptPath], {
    cwd: path.dirname(serverScriptPath),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  packagedRendererProcess = child
  packagedRendererStopping = false

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const line = String(chunk || '').trim()
      if (line) console.error(`[renderer] ${line}`)
    })
  }

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const line = String(chunk || '').trim()
      if (line) console.info(`[renderer] ${line}`)
    })
  }

  child.on('exit', (code, signal) => {
    if (!packagedRendererStopping) {
      console.error(`[renderer] exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
    }
    packagedRendererProcess = null
  })

  const booted = await waitForPackagedRendererServer(baseUrl, PACKAGED_RENDERER_BOOT_TIMEOUT_MS, child)
  if (!booted) {
    console.error(`[renderer] failed to boot on ${baseUrl}`)
    await stopPackagedRendererServer()
    return false
  }

  process.env.ELECTRON_START_URL = baseUrl
  return true
}

function delayMs(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.floor(durationMs || 0)))
  })
}

function resolveStartupSplashImagePath() {
  const explicitCandidates = [
    path.resolve(__dirname, '..', 'public', STARTUP_SPLASH_IMAGE_FILENAME),
    path.resolve(process.cwd(), 'public', STARTUP_SPLASH_IMAGE_FILENAME),
    path.resolve(__dirname, '..', 'public', STARTUP_SPLASH_LEGACY_IMAGE_FILENAME),
    path.resolve(process.cwd(), 'public', STARTUP_SPLASH_LEGACY_IMAGE_FILENAME),
  ]

  for (const candidate of explicitCandidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // Ignore filesystem errors.
    }
  }

  const searchRoots = [
    path.join(process.cwd(), 'public'),
    path.join(__dirname, '..', 'public'),
    path.join(process.resourcesPath, 'public'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'public'),
  ]
  const fileNames = [
    STARTUP_SPLASH_IMAGE_FILENAME,
    STARTUP_SPLASH_LEGACY_IMAGE_FILENAME,
    STARTUP_SPLASH_FALLBACK_IMAGE_FILENAME,
    'icon.png',
  ]

  for (const fileName of fileNames) {
    for (const root of searchRoots) {
      const candidate = path.join(root, fileName)
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {
        // Ignore filesystem errors.
      }
    }
  }

  return ''
}

function getSplashImageMimeType(filePath) {
  const extension = path.extname(filePath || '').toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return ''
}

function buildSplashImageDataUrl(filePath) {
  if (typeof filePath !== 'string' || !filePath) return ''
  const mimeType = getSplashImageMimeType(filePath)
  if (!mimeType) return ''

  try {
    const payload = fs.readFileSync(filePath)
    if (!payload || payload.length === 0) return ''
    return `data:${mimeType};base64,${payload.toString('base64')}`
  } catch {
    return ''
  }
}

function resolveStartupSplashImageUrl() {
  const imagePath = resolveStartupSplashImagePath()
  if (imagePath) {
    const embedded = buildSplashImageDataUrl(imagePath)
    if (embedded) return embedded
    return pathToFileURL(imagePath).toString()
  }
  return buildRendererUrl(`/${STARTUP_SPLASH_IMAGE_FILENAME}`)
}

function shouldShowStartupSplashOnLaunch() {
  return !!resolveStartupSplashImagePath()
}

function getStartupSplashLanguage() {
  if (currentSettings?.uiLanguage === 'vi' || currentSettings?.uiLanguage === 'en') {
    return currentSettings.uiLanguage
  }
  return getStartupLanguage()
}

function getStartupSplashLabel(key) {
  const language = getStartupSplashLanguage()
  const dictionary = STARTUP_SPLASH_LABELS[language] || STARTUP_SPLASH_LABELS.en
  return dictionary[key] || STARTUP_SPLASH_LABELS.en[key] || ''
}

function clampStartupSplashValue(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function resolveStartupSplashLayoutMetrics(imagePath) {
  let ratio = STARTUP_SPLASH_FALLBACK_RATIO
  if (typeof imagePath === 'string' && imagePath) {
    try {
      const image = nativeImage.createFromPath(imagePath)
      if (image && !image.isEmpty()) {
        const size = image.getSize()
        if (size && size.width > 0 && size.height > 0) {
          ratio = size.width / size.height
        }
      }
    } catch {
      // Ignore malformed splash image files.
    }
  }

  const clampedRatio = clampStartupSplashValue(
    ratio,
    STARTUP_SPLASH_LOGO_MIN_RATIO,
    STARTUP_SPLASH_LOGO_MAX_RATIO,
    STARTUP_SPLASH_FALLBACK_RATIO,
  )
  const ellipseRatio = clampStartupSplashValue(
    clampedRatio * STARTUP_SPLASH_ELLIPSE_CROP_FACTOR,
    STARTUP_SPLASH_LOGO_MIN_RATIO * STARTUP_SPLASH_ELLIPSE_CROP_FACTOR,
    STARTUP_SPLASH_LOGO_MAX_RATIO * STARTUP_SPLASH_ELLIPSE_CROP_FACTOR,
    STARTUP_SPLASH_FALLBACK_RATIO * STARTUP_SPLASH_ELLIPSE_CROP_FACTOR,
  )
  const logoHeight = STARTUP_SPLASH_LOGO_BASE_HEIGHT
  const logoWidth = Math.round(logoHeight * ellipseRatio)
  const windowWidth = Math.round(
    clampStartupSplashValue(
      logoWidth + STARTUP_SPLASH_WINDOW_HORIZONTAL_PADDING,
      STARTUP_SPLASH_WINDOW_MIN_WIDTH,
      STARTUP_SPLASH_WINDOW_MAX_WIDTH,
      STARTUP_SPLASH_WINDOW_MIN_WIDTH,
    ),
  )
  const windowHeight = Math.round(
    clampStartupSplashValue(
      logoHeight + STARTUP_SPLASH_WINDOW_VERTICAL_PADDING,
      STARTUP_SPLASH_WINDOW_MIN_HEIGHT,
      STARTUP_SPLASH_WINDOW_MAX_HEIGHT,
      STARTUP_SPLASH_WINDOW_MIN_HEIGHT,
    ),
  )

  return {
    ratio: clampedRatio,
    ellipseRatio,
    logoHeight,
    maxLogoWidth: logoWidth,
    windowWidth,
    windowHeight,
  }
}

function buildStartupSplashMarkup(imageUrl, layoutMetrics = {}) {
  const safeUrl = JSON.stringify(imageUrl || '')
  const safeLang = getStartupSplashLanguage() === 'vi' ? 'vi' : 'en'
  const safeImageRatio = clampStartupSplashValue(
    Number(layoutMetrics.ratio),
    STARTUP_SPLASH_LOGO_MIN_RATIO,
    STARTUP_SPLASH_LOGO_MAX_RATIO,
    STARTUP_SPLASH_FALLBACK_RATIO,
  )
  const safeEllipseRatio = clampStartupSplashValue(
    Number(layoutMetrics.ellipseRatio),
    STARTUP_SPLASH_LOGO_MIN_RATIO * STARTUP_SPLASH_ELLIPSE_CROP_FACTOR,
    STARTUP_SPLASH_LOGO_MAX_RATIO * STARTUP_SPLASH_ELLIPSE_CROP_FACTOR,
    safeImageRatio * STARTUP_SPLASH_ELLIPSE_CROP_FACTOR,
  )
  const safeLogoHeight = Math.round(
    clampStartupSplashValue(
      Number(layoutMetrics.logoHeight),
      180,
      360,
      STARTUP_SPLASH_LOGO_BASE_HEIGHT,
    ),
  )
  const safeMaxLogoWidth = Math.round(
    clampStartupSplashValue(
      Number(layoutMetrics.maxLogoWidth),
      300,
      980,
      safeLogoHeight * safeEllipseRatio,
    ),
  )
  return `<!doctype html>
<html lang="${safeLang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600;700;800&family=Tektur:wght@400;500;600;700;800&family=Vujahday+Script&display=swap" rel="stylesheet" />
    <style>
      :root {
        color-scheme: dark;
        --qt-fade-ms: ${STARTUP_SPLASH_FADE_OUT_MS}ms;
        --qt-ellipse-ratio: ${safeEllipseRatio.toFixed(4)};
        --qt-logo-height: ${safeLogoHeight}px;
        --qt-logo-max-width: ${safeMaxLogoWidth}px;
        --qt-image-scale: ${STARTUP_SPLASH_IMAGE_SCALE.toFixed(4)};
        --qt-font-loading: 'Vujahday Script', 'Tektur', cursive;
        --qt-font-vi: 'Tektur', 'Exo 2', system-ui, sans-serif;
        --qt-font-fallback: 'Exo 2', 'Tektur', system-ui, sans-serif;
      }
      html:lang(vi) {
        --qt-font-ui: var(--qt-font-vi);
      }
      html:lang(en) {
        --qt-font-ui: var(--qt-font-fallback);
        --qt-font-loading: var(--qt-font-fallback);
      }
      html:not(:lang(vi)):not(:lang(en)) {
        --qt-font-ui: var(--qt-font-fallback);
        --qt-font-loading: var(--qt-font-fallback);
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      body {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        font-family: var(--qt-font-ui, var(--qt-font-fallback));
        user-select: none;
        -webkit-user-select: none;
      }
      body::before {
        content: '';
        position: fixed;
        inset: 0;
        pointer-events: none;
        background:
          radial-gradient(circle at 50% 42%, rgba(10, 18, 30, 0.18), rgba(2, 5, 9, 0.34)),
          radial-gradient(circle at 12% 14%, rgba(74, 176, 255, 0.1), transparent 42%),
          radial-gradient(circle at 88% 84%, rgba(255, 111, 188, 0.1), transparent 46%);
        backdrop-filter: blur(4px) saturate(122%);
        -webkit-backdrop-filter: blur(4px) saturate(122%);
      }
      .splash-root {
        position: relative;
        z-index: 1;
        width: min(98vw, calc(var(--qt-logo-max-width) * 1.08));
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 22px;
        transition:
          transform var(--qt-fade-ms) cubic-bezier(0.22, 1, 0.36, 1),
          opacity var(--qt-fade-ms) cubic-bezier(0.22, 1, 0.36, 1);
        animation: splash-enter 340ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
      }
      .logo-ellipse {
        width: min(98vw, calc(var(--qt-logo-max-width) * 1.08));
        aspect-ratio: var(--qt-ellipse-ratio);
        border-radius: 999px;
        overflow: visible;
        position: relative;
        background: transparent;
      }
      .logo-ellipse::before {
        content: '';
        position: absolute;
        inset: -11%;
        border-radius: inherit;
        pointer-events: none;
        background:
          radial-gradient(circle at 16% 22%, rgba(99, 220, 255, 0.28), transparent 45%),
          radial-gradient(circle at 84% 78%, rgba(255, 120, 193, 0.24), transparent 50%),
          radial-gradient(circle at 50% 52%, rgba(12, 26, 42, 0.28), transparent 72%);
        filter: blur(36px);
        opacity: 0.78;
      }
      .logo-ellipse::after {
        content: '';
        position: absolute;
        inset: -3.5%;
        border-radius: inherit;
        pointer-events: none;
        background: rgba(12, 18, 28, 0.14);
        backdrop-filter: blur(18px) saturate(128%);
        -webkit-backdrop-filter: blur(18px) saturate(128%);
        mask-image: radial-gradient(ellipse at center, black 56%, transparent 86%);
        -webkit-mask-image: radial-gradient(ellipse at center, black 56%, transparent 86%);
      }
      img {
        position: relative;
        z-index: 1;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scale(var(--qt-image-scale));
        transform-origin: center center;
        border-radius: inherit;
        mask-image: radial-gradient(ellipse at center, black 64%, transparent 94%);
        -webkit-mask-image: radial-gradient(ellipse at center, black 64%, transparent 94%);
        filter: drop-shadow(0 20px 54px rgba(0, 0, 0, 0.42));
        display: block;
        border: 1px solid rgba(8, 16, 28, 0.72);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.1) inset,
          0 14px 30px rgba(0, 0, 0, 0.24);
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-user-drag: none;
      }
      .progress-track {
        width: 100%;
        height: 8px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(6, 10, 18, 0.56);
        border: 1px solid rgba(205, 232, 255, 0.22);
        box-shadow:
          inset 0 1px rgba(255, 255, 255, 0.08),
          0 10px 22px rgba(0, 0, 0, 0.24);
      }
      .status-panel {
        width: min(76vw, calc(var(--qt-logo-max-width) * 0.72));
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 11px 12px;
        border-radius: 14px;
        border: 1px solid rgba(219, 239, 255, 0.26);
        background:
          linear-gradient(140deg, rgba(12, 20, 34, 0.84), rgba(12, 20, 34, 0.68)),
          radial-gradient(circle at 15% 0%, rgba(80, 186, 255, 0.18), transparent 44%);
        backdrop-filter: blur(14px) saturate(132%);
        -webkit-backdrop-filter: blur(14px) saturate(132%);
        box-shadow:
          0 16px 36px rgba(0, 0, 0, 0.35),
          inset 0 1px rgba(255, 255, 255, 0.14);
      }
      .status-row {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-family: var(--qt-font-ui, var(--qt-font-fallback));
        font-size: 12px;
        line-height: 1.35;
        letter-spacing: 0.02em;
      }
      .status-label-wrap {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        max-width: calc(100% - 52px);
      }
      .status-marker {
        color: rgba(127, 225, 255, 0.98);
        font-size: 12px;
        line-height: 1;
        text-shadow: 0 0 12px rgba(87, 226, 255, 0.56);
      }
      .status-label {
        color: rgba(244, 250, 255, 0.98);
        font-weight: 600;
        font-family: var(--qt-font-loading, var(--qt-font-fallback));
        font-size: 20px;
        letter-spacing: 0.01em;
        text-shadow: 0 0 16px rgba(87, 226, 255, 0.34);
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .status-percent {
        color: rgba(177, 236, 255, 0.98);
        font-weight: 700;
        font-family: var(--qt-font-ui, var(--qt-font-fallback));
        min-width: 42px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .progress-fill {
        width: 6%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #57e2ff 0%, #45bcff 42%, #ff69b4 100%);
        box-shadow: 0 0 20px rgba(69, 188, 255, 0.46);
        transition: width 220ms cubic-bezier(0.2, 0, 0, 1);
      }
      body.qt-fade-out .splash-root {
        opacity: 0;
        transform: translateY(8px) scale(0.99);
      }
      @media (max-width: 560px) {
        .splash-root {
          gap: 16px;
        }
        .status-panel {
          width: min(84vw, calc(var(--qt-logo-max-width) * 0.78));
          padding: 10px 11px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation: none !important;
          transition-duration: 1ms !important;
        }
      }
      @keyframes splash-enter {
        0% {
          opacity: 0;
          transform: translateY(10px) scale(0.985);
        }
        100% {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    </style>
  </head>
  <body>
    <div class="splash-root">
      <div class="logo-ellipse">
        <img id="qtSplashImage" alt="QuickText Splash" draggable="false" />
      </div>
      <div class="status-panel">
        <div class="status-row">
          <span class="status-label-wrap">
            <span class="status-marker" aria-hidden="true">✦</span>
            <span id="qtSplashLabel" class="status-label">Booting...</span>
          </span>
          <span id="qtSplashPercent" class="status-percent">6%</span>
        </div>
        <div class="progress-track"><div id="qtSplashFill" class="progress-fill"></div></div>
      </div>
    </div>
    <script>
      const source = ${safeUrl};
      const image = document.getElementById('qtSplashImage');
      const fill = document.getElementById('qtSplashFill');
      const label = document.getElementById('qtSplashLabel');
      const percent = document.getElementById('qtSplashPercent');
      const root = document.documentElement;
      const minRatio = ${STARTUP_SPLASH_LOGO_MIN_RATIO.toFixed(4)};
      const maxRatio = ${STARTUP_SPLASH_LOGO_MAX_RATIO.toFixed(4)};
      const cropFactor = ${STARTUP_SPLASH_ELLIPSE_CROP_FACTOR.toFixed(4)};

      if (source && image) {
        image.src = source;
      }

      if (image) {
        image.addEventListener('load', () => {
          if (!image.naturalWidth || !image.naturalHeight) return;
          const ratio = image.naturalWidth / image.naturalHeight;
          const clamped = Math.max(minRatio, Math.min(maxRatio, ratio));
          root.style.setProperty('--qt-ellipse-ratio', String(clamped * cropFactor));
        });
      }

      window.__qtSetSplashProgress = (nextProgress, nextLabel) => {
        const normalized = Math.max(0, Math.min(1, Number(nextProgress) || 0));
        const percentText = Math.round(normalized * 100) + '%';
        if (fill) fill.style.width = percentText;
        if (percent) percent.textContent = percentText;
        if (label && typeof nextLabel === 'string' && nextLabel.trim()) {
          label.textContent = nextLabel.trim();
        }
      };

      window.__qtFadeOutSplash = () => {
        document.body.classList.add('qt-fade-out');
      };
    </script>
  </body>
</html>`
}

async function showStartupSplashIfNeeded() {
  if (!shouldShowStartupSplashOnLaunch()) return false
  if (isQuitting) return

  startupSplashActive = true
  startupSplashStartedAt = Date.now()
  startupSplashProgress = 0

  try {
    const imagePath = resolveStartupSplashImagePath()
    const imageUrl = resolveStartupSplashImageUrl()
    const splashLayout = resolveStartupSplashLayoutMetrics(imagePath)
    const splashDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const splashBounds = splashDisplay?.bounds || {
      x: 0,
      y: 0,
      width: splashLayout.windowWidth,
      height: splashLayout.windowHeight,
    }

    const splashOptions = {
      title: APP_DISPLAY_NAME,
      x: splashBounds.x,
      y: splashBounds.y,
      width: Math.max(360, Math.floor(splashBounds.width)),
      height: Math.max(240, Math.floor(splashBounds.height)),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      icon: resolveAppIconPath(),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    }

    if (process.platform === 'darwin') {
      splashOptions.vibrancy = 'under-window'
      splashOptions.visualEffectState = 'active'
    }

    startupSplashWindow = new BrowserWindow(splashOptions)

    const markup = buildStartupSplashMarkup(imageUrl, splashLayout)
    await startupSplashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(markup)}`)

    if (!isQuitting && startupSplashWindow && !startupSplashWindow.isDestroyed()) {
      startupSplashWindow.show()
      await setStartupSplashStep(0.06, 'initializing')
    }
    return true
  } catch (error) {
    console.error('[startup-splash] failed:', error)
    if (startupSplashWindow && !startupSplashWindow.isDestroyed()) startupSplashWindow.close()
    startupSplashWindow = null
    startupSplashActive = false
    startupSplashStartedAt = 0
    startupSplashProgress = 0
    return false
  }
}

async function setStartupSplashProgress(progress, label = '') {
  if (!startupSplashWindow || startupSplashWindow.isDestroyed()) return
  const requested = Math.min(1, Math.max(0, Number(progress) || 0))
  const canAdvanceLabel = requested + 0.0001 >= startupSplashProgress
  const normalized = Math.max(startupSplashProgress, requested)
  startupSplashProgress = normalized
  const safeLabel = typeof label === 'string' ? label : ''
  const labelToRender = canAdvanceLabel ? safeLabel : ''
  const script = `window.__qtSetSplashProgress && window.__qtSetSplashProgress(${normalized.toFixed(4)}, ${JSON.stringify(labelToRender)});`
  try {
    await startupSplashWindow.webContents.executeJavaScript(script, true)
  } catch {
    // Ignore teardown/load races.
  }
}

async function setStartupSplashStep(progress, labelKey) {
  return setStartupSplashProgress(progress, getStartupSplashLabel(labelKey))
}

async function fadeOutStartupSplash() {
  if (!startupSplashWindow || startupSplashWindow.isDestroyed()) return
  try {
    await startupSplashWindow.webContents.executeJavaScript('window.__qtFadeOutSplash && window.__qtFadeOutSplash();', true)
  } catch {
    // Ignore teardown/load races.
  }
  await delayMs(STARTUP_SPLASH_FADE_OUT_MS)
}

async function waitForMainWindowStartupLoad() {
  if (!mainWindow || mainWindow.isDestroyed()) return

  await new Promise((resolve) => {
    let settled = false
    let timeoutId = null
    let onRendererReady = null
    let didFinishLoad = false
    let rendererReadyGraceTimer = null
    let compileHintTimer = null

    const settle = () => {
      if (settled) return
      settled = true
      if (onRendererReady) {
        ipcMain.removeListener('renderer:main-ready', onRendererReady)
        onRendererReady = null
      }
      if (rendererReadyGraceTimer) {
        clearTimeout(rendererReadyGraceTimer)
        rendererReadyGraceTimer = null
      }
      if (compileHintTimer) {
        clearTimeout(compileHintTimer)
        compileHintTimer = null
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      resolve()
    }

    const win = mainWindow
    if (!win || win.isDestroyed()) {
      settle()
      return
    }

    if (mainRendererReadySenderId === win.webContents.id) {
      logStartupPhase('main-window', 'renderer-ready (cached)')
      settle()
      return
    }

    void setStartupSplashStep(0.42, 'loadingInterface')
    logStartupPhase('main-window', 'loading /main')
    compileHintTimer = setTimeout(() => {
      if (settled || didFinishLoad) return
      logStartupPhase('main-window', 'compile-hint')
      void setStartupSplashStep(0.5, 'compilingMain')
    }, STARTUP_MAIN_COMPILE_HINT_DELAY_MS)

    onRendererReady = (event) => {
      if (!win || win.isDestroyed()) {
        settle()
        return
      }
      if (!event?.sender || event.sender.id !== win.webContents.id) return
      mainRendererReadySenderId = event.sender.id
      logStartupPhase('main-window', 'renderer-ready')
      void setStartupSplashStep(0.95, 'uiReady')
      settle()
    }
    ipcMain.on('renderer:main-ready', onRendererReady)

    win.webContents.once('did-start-loading', () => {
      logStartupPhase('main-window', 'did-start-loading')
      void setStartupSplashStep(0.42, 'loadingInterface')
    })
    win.webContents.once('dom-ready', () => {
      logStartupPhase('main-window', 'dom-ready')
      void setStartupSplashStep(0.58, 'preparingControls')
    })
    win.webContents.once('did-finish-load', () => {
      logStartupPhase('main-window', 'did-finish-load')
      didFinishLoad = true
      if (compileHintTimer) {
        clearTimeout(compileHintTimer)
        compileHintTimer = null
      }
      void setStartupSplashStep(0.88, 'waitingMainReady')
      rendererReadyGraceTimer = setTimeout(() => {
        if (settled) return
        logStartupPhase('main-window', 'renderer-ready fallback')
        settle()
      }, STARTUP_MAIN_READY_GRACE_MS)
    })
    win.webContents.once('did-fail-load', settle)
    win.once('closed', settle)

    timeoutId = setTimeout(() => {
      settle()
    }, STARTUP_SPLASH_LOAD_TIMEOUT_MS)
  })
}

async function hideStartupSplashAndRevealMain() {
  if (!startupSplashActive) return

  if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
  }

  await setStartupSplashProgress(1, getStartupSplashLabel('ready'))
  await fadeOutStartupSplash()

  if (startupSplashWindow && !startupSplashWindow.isDestroyed()) {
    startupSplashWindow.close()
  }
  startupSplashWindow = null
  startupSplashActive = false
  startupSplashStartedAt = 0
  startupSplashProgress = 0

  if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
    refreshTrayMenu({ immediate: true })
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`
}

function resolvePythonUrl(routePath) {
  const base = (process.env.PYTHON_API_BASE_URL ?? DEFAULT_PYTHON_API_BASE_URL).trim()
  try {
    return new URL(routePath, ensureTrailingSlash(base)).toString()
  } catch {
    return ''
  }
}

function isObjectPayload(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parsePythonDelayRange(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('`delay_range` must be [min, max]')
  }

  const min = value[0]
  const max = value[1]
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('`delay_range` values must be numbers')
  }
  if (min < 0 || max < 0 || min > max) {
    throw new Error('`delay_range` must satisfy 0 <= min <= max')
  }

  return [min, max]
}

function toPythonError(status, error, correlationId = '') {
  return {
    ok: false,
    status,
    error,
    correlationId: sanitizeCorrelationId(correlationId),
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function fetchPythonJson(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
    })

    let body = null
    try {
      body = await response.json()
    } catch {
      body = null
    }

    return { response, body }
  } finally {
    clearTimeout(timeoutId)
  }
}

function isRetryablePythonError(error) {
  if (error instanceof Error && error.name === 'AbortError') return true
  if (error instanceof TypeError) return true
  return false
}

async function fetchPythonJsonWithPolicy(url, options, policy, correlationId) {
  const retries = Math.max(0, Math.floor(policy?.retries ?? 0))
  const timeoutMs = Math.max(300, Math.floor(policy?.timeoutMs ?? 3000))
  const baseBackoffMs = Math.max(0, Math.floor(policy?.baseBackoffMs ?? 0))
  let attempt = 0

  while (attempt <= retries) {
    try {
      return await fetchPythonJson(url, options, timeoutMs)
    } catch (error) {
      const canRetry = isRetryablePythonError(error) && attempt < retries
      if (!canRetry) throw error

      const backoffMs = baseBackoffMs * (attempt + 1)
      console.warn(`[python][${correlationId}] retry ${attempt + 1}/${retries} in ${backoffMs}ms`)
      await sleep(backoffMs)
      attempt += 1
    }
  }

  throw new Error('Python fetch exhausted retries')
}

async function handlePythonSend(rawPayload) {
  const correlationId = nextCorrelationId('py-send')
  if (!isObjectPayload(rawPayload)) {
    return toPythonError(400, 'Payload must be a JSON object', correlationId)
  }

  const body = rawPayload
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return toPythonError(400, '`text` is required', correlationId)
  }

  let delayRange
  if (typeof body.delay_range !== 'undefined') {
    try {
      delayRange = parsePythonDelayRange(body.delay_range)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid `delay_range`'
      return toPythonError(400, message, correlationId)
    }
  }

  let pressEnter = false
  if (typeof body.press_enter !== 'undefined') {
    if (typeof body.press_enter !== 'boolean') {
      return toPythonError(400, '`press_enter` must be boolean', correlationId)
    }
    pressEnter = body.press_enter
  }

  const sendUrl = resolvePythonUrl('send')
  if (!sendUrl) {
    return toPythonError(500, 'Invalid PYTHON_API_BASE_URL', correlationId)
  }

  const payload = { text, press_enter: pressEnter }
  if (delayRange) payload.delay_range = delayRange

  try {
    const { response, body: responseBody } = await fetchPythonJsonWithPolicy(
      sendUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      PYTHON_POLICY.send,
      correlationId,
    )

    if (!response.ok) {
      const backendError =
        typeof responseBody?.error === 'string' ? responseBody.error : `Python service error (${response.status})`
      const status = response.status >= 500 ? 502 : response.status
      return toPythonError(status, backendError, correlationId)
    }

    return { ok: true, correlationId }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return toPythonError(504, 'Python service timeout', correlationId)
    }

    return toPythonError(
      503,
      'Python service unavailable. Ensure `npm run dev:python` is running and dependencies are installed.',
      correlationId,
    )
  }
}

async function handlePythonConfigure(rawPayload) {
  const correlationId = nextCorrelationId('py-config')
  if (!isObjectPayload(rawPayload)) {
    return toPythonError(400, 'Payload must be a JSON object', correlationId)
  }

  const body = rawPayload
  const payload = {}

  if (typeof body.text !== 'undefined') {
    if (typeof body.text !== 'string') return toPythonError(400, '`text` must be string', correlationId)
    payload.text = body.text
  }

  if (typeof body.hotkey !== 'undefined') {
    if (typeof body.hotkey !== 'string') return toPythonError(400, '`hotkey` must be string', correlationId)
    const hotkey = body.hotkey.trim()
    if (!hotkey) return toPythonError(400, '`hotkey` cannot be empty', correlationId)
    payload.hotkey = hotkey
  }

  if (typeof body.overlay_toggle_hotkey !== 'undefined') {
    if (typeof body.overlay_toggle_hotkey !== 'string') {
      return toPythonError(400, '`overlay_toggle_hotkey` must be string', correlationId)
    }
    const hotkey = body.overlay_toggle_hotkey.trim()
    if (!hotkey) return toPythonError(400, '`overlay_toggle_hotkey` cannot be empty', correlationId)
    payload.overlay_toggle_hotkey = hotkey
  }

  if (typeof body.main_toggle_hotkey !== 'undefined') {
    if (typeof body.main_toggle_hotkey !== 'string') return toPythonError(400, '`main_toggle_hotkey` must be string', correlationId)
    const hotkey = body.main_toggle_hotkey.trim()
    if (!hotkey) return toPythonError(400, '`main_toggle_hotkey` cannot be empty', correlationId)
    payload.main_toggle_hotkey = hotkey
  }

  if (typeof body.overlay_edit_hotkey !== 'undefined') {
    if (typeof body.overlay_edit_hotkey !== 'string') return toPythonError(400, '`overlay_edit_hotkey` must be string', correlationId)
    const hotkey = body.overlay_edit_hotkey.trim()
    if (!hotkey) return toPythonError(400, '`overlay_edit_hotkey` cannot be empty', correlationId)
    payload.overlay_edit_hotkey = hotkey
  }

  if (typeof body.app_toggle_hotkey !== 'undefined') {
    if (typeof body.app_toggle_hotkey !== 'string') return toPythonError(400, '`app_toggle_hotkey` must be string', correlationId)
    const hotkey = body.app_toggle_hotkey.trim()
    if (!hotkey) return toPythonError(400, '`app_toggle_hotkey` cannot be empty', correlationId)
    payload.app_toggle_hotkey = hotkey
  }

  if (typeof body.app_enabled !== 'undefined') {
    if (typeof body.app_enabled !== 'boolean') return toPythonError(400, '`app_enabled` must be boolean', correlationId)
    payload.app_enabled = body.app_enabled
  }

  if (typeof body.press_enter !== 'undefined') {
    if (typeof body.press_enter !== 'boolean') return toPythonError(400, '`press_enter` must be boolean', correlationId)
    payload.press_enter = body.press_enter
  }

  if (typeof body.delay_range !== 'undefined') {
    try {
      payload.delay_range = parsePythonDelayRange(body.delay_range)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid `delay_range`'
      return toPythonError(400, message, correlationId)
    }
  }

  if (Object.keys(payload).length === 0) {
    return { ok: true, skipped: true, correlationId }
  }

  const configureUrl = resolvePythonUrl('configure')
  if (!configureUrl) {
    return toPythonError(500, 'Invalid PYTHON_API_BASE_URL', correlationId)
  }

  try {
    const { response, body: responseBody } = await fetchPythonJsonWithPolicy(
      configureUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      PYTHON_POLICY.configure,
      correlationId,
    )

    if (!response.ok) {
      const backendError =
        typeof responseBody?.error === 'string' ? responseBody.error : `Python service error (${response.status})`
      const status = response.status >= 500 ? 502 : response.status
      return toPythonError(status, backendError, correlationId)
    }

    return { ok: true, config: responseBody, correlationId }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return toPythonError(504, 'Python configure timeout', correlationId)
    }

    return toPythonError(
      503,
      'Python service unavailable. Ensure `npm run dev:python` is running and dependencies are installed.',
      correlationId,
    )
  }
}

function parseInputAfter(rawAfter) {
  const afterCandidate =
    isObjectPayload(rawAfter) && Object.prototype.hasOwnProperty.call(rawAfter, 'after') ? rawAfter.after : rawAfter
  const parsed =
    typeof afterCandidate === 'number' && Number.isInteger(afterCandidate)
      ? afterCandidate
      : Number.parseInt(String(afterCandidate ?? ''), 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

async function handlePythonEvents(rawAfter) {
  const correlationId = nextCorrelationId('py-events')
  const after = parseInputAfter(rawAfter)
  if (after === null) {
    return { ok: false, error: '`after` must be a non-negative integer', correlationId }
  }

  const inputEventsUrl = resolvePythonUrl(`events?after=${after}`)
  if (!inputEventsUrl) {
    return {
      ok: true,
      events: [],
      last_id: after,
      degraded: true,
      error: 'Invalid PYTHON_API_BASE_URL',
      correlationId,
    }
  }

  try {
    const { response, body: responseBody } = await fetchPythonJsonWithPolicy(
      inputEventsUrl,
      {
        method: 'GET',
      },
      PYTHON_POLICY.events,
      correlationId,
    )

    if (!response.ok) {
      return {
        ok: true,
        events: [],
        last_id: after,
        degraded: true,
        error: `Python events error (${response.status})`,
        correlationId,
      }
    }

    if (!isObjectPayload(responseBody)) {
      return {
        ok: true,
        events: [],
        last_id: after,
        degraded: true,
        error: 'Invalid events response from Python service',
        correlationId,
      }
    }

    if (responseBody.ok !== true) {
      const message = typeof responseBody.error === 'string' ? responseBody.error : 'Python events unavailable'
      return {
        ok: true,
        events: [],
        last_id: typeof responseBody.last_id === 'number' ? responseBody.last_id : after,
        degraded: true,
        error: message,
        correlationId,
      }
    }

    return {
      ok: true,
      events: Array.isArray(responseBody.events) ? responseBody.events : [],
      last_id: typeof responseBody.last_id === 'number' ? responseBody.last_id : after,
      correlationId,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: true,
        events: [],
        last_id: after,
        degraded: true,
        error: 'Python events timeout',
        correlationId,
      }
    }

    return {
      ok: true,
      events: [],
      last_id: after,
      degraded: true,
      error: 'Python events unavailable',
      correlationId,
    }
  }
}

function getBoundedRect(x, y, width, height, minWidth, minHeight) {
  const point = { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 }
  const display = screen.getDisplayNearestPoint(point)
  const area = display.workArea

  const boundedWidth = Math.min(Math.max(width, minWidth), area.width)
  const boundedHeight = Math.min(Math.max(height, minHeight), area.height)
  const boundedX = Math.min(Math.max(x, area.x - boundedWidth + 80), area.x + area.width - 80)
  const boundedY = Math.min(Math.max(y, area.y - 20), area.y + area.height - 40)

  return { x: boundedX, y: boundedY, width: boundedWidth, height: boundedHeight }
}

function getMainBounds(settings) {
  return getBoundedRect(
    settings.windowX,
    settings.windowY,
    settings.windowWidth,
    settings.windowHeight,
    560,
    420,
  )
}

function getSettingsWindowBounds() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const mainBounds = mainWindow.getBounds()
    const display = screen.getDisplayMatching(mainBounds)
    const area = display.workArea

    const width = Math.min(
      Math.max(SETTINGS_WINDOW_DEFAULT.width, SETTINGS_WINDOW_DEFAULT.minWidth),
      Math.max(SETTINGS_WINDOW_DEFAULT.minWidth, area.width - SETTINGS_WINDOW_SAFE_MARGIN_PX * 2),
    )
    const height = Math.min(
      Math.max(mainBounds.height, SETTINGS_WINDOW_DEFAULT.minHeight),
      Math.max(SETTINGS_WINDOW_DEFAULT.minHeight, area.height - SETTINGS_WINDOW_SAFE_MARGIN_PX * 2),
    )

    let x = mainBounds.x + mainBounds.width + SETTINGS_WINDOW_GAP_PX
    if (x + width > area.x + area.width - SETTINGS_WINDOW_SAFE_MARGIN_PX) {
      x = mainBounds.x - width - SETTINGS_WINDOW_GAP_PX
    }

    const minX = area.x + SETTINGS_WINDOW_SAFE_MARGIN_PX
    const maxX = area.x + area.width - width - SETTINGS_WINDOW_SAFE_MARGIN_PX
    x = Math.min(maxX, Math.max(minX, x))

    let y = mainBounds.y + Math.round((mainBounds.height - height) / 2)
    const minY = area.y + SETTINGS_WINDOW_SAFE_MARGIN_PX
    const maxY = area.y + area.height - height - SETTINGS_WINDOW_SAFE_MARGIN_PX
    y = Math.min(maxY, Math.max(minY, y))

    return { x, y, width, height }
  }

  const area = screen.getPrimaryDisplay().workArea
  const x = area.x + Math.round((area.width - SETTINGS_WINDOW_DEFAULT.width) / 2)
  const y = area.y + Math.round((area.height - SETTINGS_WINDOW_DEFAULT.height) / 2)
  return getBoundedRect(
    x,
    y,
    SETTINGS_WINDOW_DEFAULT.width,
    SETTINGS_WINDOW_DEFAULT.height,
    SETTINGS_WINDOW_DEFAULT.minWidth,
    SETTINGS_WINDOW_DEFAULT.minHeight,
  )
}

function getOverlayBounds(settings) {
  const area = getDisplayWorkAreaForOverlay(settings)
  return {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
  }
}

function getDisplayWorkAreaForOverlay(settings) {
  const point = {
    x: Number.isFinite(settings?.overlayX) ? settings.overlayX : 0,
    y: Number.isFinite(settings?.overlayY) ? settings.overlayY : 0,
  }
  return screen.getDisplayNearestPoint(point).workArea
}

function refitOverlayToDisplayWorkArea() {
  if (!currentSettings) return
  const area = getDisplayWorkAreaForOverlay(currentSettings)
  currentSettings.overlayX = area.x
  currentSettings.overlayY = area.y
  currentSettings.overlayWidth = area.width
  currentSettings.overlayHeight = area.height
  applyOverlayWindowSettings(currentSettings)
  applyOverlayVisibility(currentSettings.overlayVisible)
  void saveSettings(currentSettings)
  broadcastSettings()
}

function scheduleOverlayRefit(reason = 'display-change') {
  if (overlayRefitTimer) clearTimeout(overlayRefitTimer)
  overlayRefitTimer = setTimeout(() => {
    overlayRefitTimer = null
    console.info(`[overlay] refit due to ${reason}`)
    refitOverlayToDisplayWorkArea()
  }, OVERLAY_REFIT_DEBOUNCE_MS)
}

function handleDisplayChanged() {
  scheduleOverlayRefit('display')
}

function registerScreenListeners() {
  if (screenListenersRegistered) return
  screen.on('display-added', handleDisplayChanged)
  screen.on('display-removed', handleDisplayChanged)
  screen.on('display-metrics-changed', handleDisplayChanged)
  screenListenersRegistered = true
}

function unregisterScreenListeners() {
  if (!screenListenersRegistered) return
  screen.off('display-added', handleDisplayChanged)
  screen.off('display-removed', handleDisplayChanged)
  screen.off('display-metrics-changed', handleDisplayChanged)
  screenListenersRegistered = false
}

function attachWindowHealthHandlers(windowRef, windowName) {
  if (!windowRef || windowRef.isDestroyed()) return

  let recoverTimer = null
  let recovering = false
  const scheduleRecover = (reason) => {
    if (isQuitting || recovering || windowRef.isDestroyed()) return
    recovering = true
    if (recoverTimer) clearTimeout(recoverTimer)
    recoverTimer = setTimeout(() => {
      recoverTimer = null
      if (windowRef.isDestroyed()) return
      try {
        windowRef.webContents.reloadIgnoringCache()
      } catch (error) {
        safeConsoleError(`[window:${windowName}] recover failed:`, error)
      } finally {
        recovering = false
      }
    }, 420)
    safeConsoleError(`[window:${windowName}] scheduling recovery after ${reason}`)
  }

  windowRef.on('unresponsive', () => {
    scheduleRecover('unresponsive')
  })

  windowRef.webContents.on('render-process-gone', (_event, details) => {
    const reason = details?.reason || 'unknown'
    scheduleRecover(`render-process-gone:${reason}`)
  })

  windowRef.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    scheduleRecover(`did-fail-load:${errorCode}:${errorDescription}:${validatedURL || ''}`)
  })

  windowRef.on('closed', () => {
    if (recoverTimer) {
      clearTimeout(recoverTimer)
      recoverTimer = null
    }
  })
}

function createMainWindow() {
  const settings = ensureSettings()
  const bounds = getMainBounds(settings)
  mainRendererReadySenderId = 0

  mainWindow = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 560,
    minHeight: 420,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    show: false,
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  mainBoundsSignature = toBoundsSignature(bounds)

  mainWindow.loadURL(buildRendererUrl('/main'))
  attachWindowHealthHandlers(mainWindow, 'main')

  mainWindow.once('ready-to-show', () => {
    if (!isQuitting && !startupSplashActive) {
      mainWindow.show()
      refreshTrayMenu()
    }
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    requestAppQuit()
  })

  const handleMainMoveOrResize = () => {
    schedulePersistMainBounds()
    synchronizeSettingsWindowWithMain()
  }

  const handleMainHidden = () => {
    if (hotkeyWindow && !hotkeyWindow.isDestroyed() && hotkeyWindow.isVisible()) {
      settingsWindowRestorePending = true
      hideSettingsWindow({ refocusMain: false })
    }
    refreshTrayMenu()
  }

  const handleMainShown = () => {
    if (settingsWindowRestorePending) {
      settingsWindowRestorePending = false
      showSettingsWindow({ focus: false })
    } else {
      synchronizeSettingsWindowWithMain()
    }
    refreshTrayMenu()
  }

  mainWindow.on('show', handleMainShown)
  mainWindow.on('hide', handleMainHidden)
  mainWindow.on('minimize', handleMainHidden)
  mainWindow.on('restore', handleMainShown)
  mainWindow.on('maximize', synchronizeSettingsWindowWithMain)
  mainWindow.on('unmaximize', synchronizeSettingsWindowWithMain)
  mainWindow.on('move', handleMainMoveOrResize)
  mainWindow.on('resize', handleMainMoveOrResize)

  mainWindow.on('closed', () => {
    if (mainBoundsPersistTimer) {
      clearTimeout(mainBoundsPersistTimer)
      mainBoundsPersistTimer = null
    }
    mainBoundsSignature = ''
    mainRendererReadySenderId = 0
    mainWindow = null
  })
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    logOverlayLifecycle('reuse', 'existing window')
    return overlayWindow
  }
  const settings = ensureSettings()
  const bounds = getOverlayBounds(settings)
  overlayLifecycleStats.createCount += 1
  logOverlayLifecycle('create', `${bounds.width}x${bounds.height} @ (${bounds.x},${bounds.y})`)
  overlayBoundsSignature = toBoundsSignature(bounds)

  overlayWindow = new BrowserWindow({
    title: `${APP_DISPLAY_NAME} Overlay`,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 280,
    minHeight: 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setSkipTaskbar(true)
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  applyOverlayInteraction(settings.overlayInteractive)
  overlayWindow.loadURL(buildRendererUrl('/overlay'))
  logOverlayLifecycle('loadURL', buildRendererUrl('/overlay'))
  attachWindowHealthHandlers(overlayWindow, 'overlay')

  overlayWindow.webContents.once('dom-ready', () => {
    logOverlayLifecycle('dom-ready')
  })

  overlayWindow.webContents.once('did-finish-load', () => {
    logOverlayLifecycle('did-finish-load')
  })

  overlayWindow.once('ready-to-show', () => {
    logOverlayLifecycle('ready-to-show')
    applyOverlayVisibility(ensureSettings().overlayVisible)
  })

  overlayWindow.on('show', () => {
    logOverlayLifecycle('show')
  })

  overlayWindow.on('hide', () => {
    logOverlayLifecycle('hide')
  })

  overlayWindow.on('closed', () => {
    overlayLifecycleStats.closeCount += 1
    logOverlayLifecycle('closed')
    overlayBoundsSignature = ''
    overlayWindow = null
  })

  return overlayWindow
}

function clearOverlayBootTimer() {
  if (!overlayBootTimer) return
  clearTimeout(overlayBootTimer)
  overlayBootTimer = null
}

function clearRuntimeStateSyncTimer() {
  if (!runtimeStateSyncTimer) return
  clearTimeout(runtimeStateSyncTimer)
  runtimeStateSyncTimer = null
}

function runRuntimeStateSync() {
  if (isQuitting) return
  logStartupPhase('runtime-sync', 'begin')
  registerScreenListeners()
  initializeProfilingScheduler()
  broadcastTelemetry()
  broadcastProfilingState()
  logStartupPhase('runtime-sync', 'done')
}

function scheduleRuntimeStateSync(delay = 0) {
  clearRuntimeStateSyncTimer()
  const safeDelay = Math.max(0, Math.floor(delay || 0))
  runtimeStateSyncTimer = setTimeout(() => {
    runtimeStateSyncTimer = null
    runRuntimeStateSync()
  }, safeDelay)
}

function shouldBootOverlayForSettings(settings) {
  if (!settings) return false
  return !!settings.appEnabled && !!settings.overlayVisible
}

function ensureOverlayWindowForCurrentSettings() {
  const settings = ensureSettings()
  if (!shouldBootOverlayForSettings(settings)) return null
  return createOverlayWindow()
}

function scheduleOverlayBoot(reason = 'startup', delay = OVERLAY_DEFER_BOOT_MS) {
  clearOverlayBootTimer()
  const safeDelay = Math.max(0, Math.floor(delay || 0))
  logOverlayLifecycle('schedule-boot', `${reason} +${safeDelay}ms`)
  overlayBootTimer = setTimeout(() => {
    overlayBootTimer = null
    if (isQuitting) return
    const settings = ensureSettings()
    if (!shouldBootOverlayForSettings(settings)) {
      logOverlayLifecycle('schedule-skip', reason)
      return
    }
    createOverlayWindow()
    applyOverlayWindowSettings(settings)
    applyOverlayVisibility(settings.overlayVisible)
    logOverlayLifecycle('schedule-booted', reason)
  }, safeDelay)
}

function clearSettingsWindowSyncTimer() {
  if (!settingsWindowSyncTimer) return
  clearTimeout(settingsWindowSyncTimer)
  settingsWindowSyncTimer = null
}

function repositionSettingsWindow() {
  if (!hotkeyWindow || hotkeyWindow.isDestroyed()) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = getSettingsWindowBounds()
  hotkeyWindow.setBounds(bounds, false)
}

function syncSettingsWindowBounds() {
  repositionSettingsWindow()
}

function scheduleSettingsWindowSync() {
  if (!hotkeyWindow || hotkeyWindow.isDestroyed()) return
  if (settingsWindowSyncTimer) return
  settingsWindowSyncTimer = setTimeout(() => {
    settingsWindowSyncTimer = null
    syncSettingsWindowBounds()
  }, SETTINGS_WINDOW_SYNC_DEBOUNCE_MS)
}

function createSettingsWindow() {
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) return hotkeyWindow

  const bounds = getSettingsWindowBounds()

  hotkeyWindow = new BrowserWindow({
    title: `${APP_DISPLAY_NAME} Settings`,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: SETTINGS_WINDOW_DEFAULT.minWidth,
    minHeight: SETTINGS_WINDOW_DEFAULT.minHeight,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    show: false,
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  hotkeyWindow.loadURL(buildRendererUrl('/settings'))
  attachWindowHealthHandlers(hotkeyWindow, 'settings')

  hotkeyWindow.once('ready-to-show', () => {
    if (!isQuitting && hotkeyWindow && !hotkeyWindow.isDestroyed()) {
      syncSettingsWindowBounds()
      hotkeyWindow.show()
      hotkeyWindow.focus()
    }
  })

  hotkeyWindow.on('closed', () => {
    clearSettingsWindowSyncTimer()
    settingsWindowRestorePending = false
    suppressSettingsBlurClose = false
    hotkeyWindow = null
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.focus()
    }
  })

  return hotkeyWindow
}

function applyMainWindowSettings(settings) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = getMainBounds(settings)
  const nextSignature = toBoundsSignature(bounds)
  if (nextSignature && nextSignature !== mainBoundsSignature) {
    mainWindow.setBounds(bounds, false)
    mainBoundsSignature = nextSignature
  }
  mainWindow.setBackgroundColor('#00000000')
}

function applySettingsWindowSettings(_settings) {
  if (!hotkeyWindow || hotkeyWindow.isDestroyed()) return
  hotkeyWindow.setBackgroundColor('#00000000')
  if (hotkeyWindow.isVisible()) {
    scheduleSettingsWindowSync()
  }
}

function toBoundsSignature(bounds) {
  if (!bounds) return ''
  const x = Number.isFinite(bounds.x) ? Math.floor(bounds.x) : 0
  const y = Number.isFinite(bounds.y) ? Math.floor(bounds.y) : 0
  const width = Number.isFinite(bounds.width) ? Math.floor(bounds.width) : 0
  const height = Number.isFinite(bounds.height) ? Math.floor(bounds.height) : 0
  return `${x}:${y}:${width}:${height}`
}

function applyOverlayWindowSettings(settings) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const bounds = getOverlayBounds(settings)
  const nextSignature = toBoundsSignature(bounds)
  if (nextSignature && nextSignature !== overlayBoundsSignature) {
    overlayWindow.setBounds(bounds, false)
    overlayBoundsSignature = nextSignature
  }
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setSkipTaskbar(true)
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  applyOverlayInteraction(settings.overlayInteractive)
}

function applyOverlayVisibility(visible) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (visible) {
    if (!overlayWindow.isVisible()) overlayWindow.showInactive()
  } else if (overlayWindow.isVisible()) {
    overlayWindow.hide()
  }
}

function maybeTearDownOverlayWindow(settings) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (settings?.overlayVisible) return
  if (settings?.overlayInteractive) return
  // Keep overlay renderer warm to avoid expensive re-create cycles on toggle.
  logOverlayLifecycle('retain-hidden', 'skip close')
}

function applySettingsToWindows(settings) {
  applyMainWindowSettings(settings)
  applySettingsWindowSettings(settings)
  applyOverlayWindowSettings(settings)
  applyOverlayVisibility(settings.overlayVisible)
}

function applyOverlayInteraction(interactive) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return

  const settings = ensureSettings()
  const isInteractive = !!interactive
  const smartClickThrough = !!settings.overlaySmartClickThrough

  if (isInteractive) {
    overlayMousePassThrough = false
  } else if (!smartClickThrough) {
    overlayMousePassThrough = true
  }

  const passThrough = isInteractive ? false : smartClickThrough ? overlayMousePassThrough : true
  overlayWindow.setIgnoreMouseEvents(passThrough, { forward: passThrough })
  if (typeof overlayWindow.setFocusable === 'function') {
    overlayWindow.setFocusable(false)
  }
}

function setOverlayMousePassThrough(passThrough) {
  const settings = ensureSettings()
  if (settings.overlayInteractive) {
    return false
  }
  if (!settings.overlaySmartClickThrough) {
    return true
  }

  overlayMousePassThrough = !!passThrough
  applyOverlayInteraction(settings.overlayInteractive)
  return overlayMousePassThrough
}

function schedulePersistMainBounds() {
  if (!mainWindow || !currentSettings) return
  if (mainBoundsPersistTimer) clearTimeout(mainBoundsPersistTimer)

  mainBoundsPersistTimer = setTimeout(() => {
    mainBoundsPersistTimer = null
    if (!mainWindow || !currentSettings) return

    const { x, y, width, height } = mainWindow.getBounds()
    const changed =
      currentSettings.windowX !== x ||
      currentSettings.windowY !== y ||
      currentSettings.windowWidth !== width ||
      currentSettings.windowHeight !== height

    if (!changed) return
    currentSettings.windowX = x
    currentSettings.windowY = y
    currentSettings.windowWidth = width
    currentSettings.windowHeight = height
    saveSettings(currentSettings)
    broadcastSettings()
  }, 120)
}

function ensureHotkeys(settings) {
  const nextSignature = `${settings.overlayToggleHotkey}|${settings.mainToggleHotkey}|${settings.overlayEditHotkey}|${settings.sendHotkey}`
  if (nextSignature === hotkeySignature) return
  hotkeySignature = nextSignature
}

function toggleOverlayVisibility() {
  const settings = ensureSettings()
  settings.overlayVisible = !settings.overlayVisible
  if (settings.overlayVisible) {
    ensureOverlayWindowForCurrentSettings()
  } else {
    clearOverlayBootTimer()
  }
  saveSettings(settings)
  applyOverlayWindowSettings(settings)
  applyOverlayVisibility(settings.overlayVisible)
  maybeTearDownOverlayWindow(settings)
  broadcastSettings()
  refreshTrayMenu()
  return settings
}

function toggleOverlayInteraction() {
  const settings = ensureSettings()
  settings.overlayInteractive = !settings.overlayInteractive
  if (settings.overlayInteractive) {
    ensureOverlayWindowForCurrentSettings()
  }
  if (!settings.overlayInteractive) {
    overlayMousePassThrough = true
  }
  saveSettings(settings)
  applyOverlayWindowSettings(settings)
  applyOverlayInteraction(settings.overlayInteractive)
  maybeTearDownOverlayWindow(settings)
  broadcastSettings()
  refreshTrayMenu()
  return settings
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.hide()
  refreshTrayMenu()
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  refreshTrayMenu()
}

function toggleMainWindowVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible()) {
    hideMainWindow()
  } else {
    showMainWindow()
  }
}

function showSettingsWindow(options = {}) {
  const focusWindow = options.focus !== false
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
  }
  const window = createSettingsWindow()
  if (!window || window.isDestroyed()) return
  settingsWindowRestorePending = false
  syncSettingsWindowBounds()
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) {
    if (!focusWindow && typeof window.showInactive === 'function') {
      window.showInactive()
    } else {
      window.show()
    }
  }
  if (focusWindow) {
    window.focus()
  }
}

function hideSettingsWindow(options = {}) {
  const refocusMain = options.refocusMain !== false
  if (!hotkeyWindow || hotkeyWindow.isDestroyed()) return
  clearSettingsWindowSyncTimer()
  if (hotkeyWindow.isVisible()) {
    suppressSettingsBlurClose = true
    hotkeyWindow.hide()
    setTimeout(() => {
      suppressSettingsBlurClose = false
    }, 60)
  }
  if (refocusMain && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.focus()
  }
}

function closeSettingsWindow(options = {}) {
  const refocusMain = options.refocusMain !== false
  settingsWindowRestorePending = false
  suppressSettingsBlurClose = false
  if (!hotkeyWindow || hotkeyWindow.isDestroyed()) return
  clearSettingsWindowSyncTimer()
  hotkeyWindow.close()
  if (refocusMain && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.focus()
  }
}

function showHotkeyWindow() {
  showSettingsWindow()
}

function closeHotkeyWindow() {
  closeSettingsWindow()
}

function createHotkeyWindow() {
  return createSettingsWindow()
}

function synchronizeSettingsWindowWithMain() {
  if (!hotkeyWindow || hotkeyWindow.isDestroyed()) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
    hideSettingsWindow({ refocusMain: false })
    return
  }
  scheduleSettingsWindowSync()
}

function showOverlaySettingsWindow() {
  showHotkeyWindow()
}

function closeOverlaySettingsWindow() {
  closeHotkeyWindow()
}

function broadcastToWindows(channel, payload) {
  const windows = [mainWindow, overlayWindow, hotkeyWindow]
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue
    win.webContents.send(channel, payload)
  }
}

function broadcastSettings() {
  if (!currentSettings) return
  broadcastToWindows('settings:updated', currentSettings)
}

function broadcastTelemetry() {
  if (!currentTelemetry) return
  broadcastToWindows('telemetry:updated', currentTelemetry)
}

function broadcastProfilingState() {
  if (!profilingState) return
  broadcastToWindows('profiling:updated', getProfilingStateSnapshot())
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'icon.png'),
    path.join(__dirname, '..', 'public', 'icon_full.png'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

function resolveMainWindowBackgroundColor(settings) {
  const palette =
    settings?.uiPalette === 'jade' ||
    settings?.uiPalette === 'crimson' ||
    settings?.uiPalette === 'dark' ||
    settings?.uiPalette === 'light'
      ? settings.uiPalette
      : 'icon'
  const mode = settings?.uiMode === 'light' ? 'light' : 'dark'

  const colorMap = {
    icon: { dark: '#0b0f1e', light: '#eef8ff' },
    jade: { dark: '#081612', light: '#f2fbf8' },
    crimson: { dark: '#1b0b12', light: '#fff3f5' },
    dark: { dark: '#0e0f12', light: '#1f232a' },
    light: { dark: '#2a2e36', light: '#f6f8fb' },
  }

  return colorMap[palette][mode]
}

function resolveTrayIcon() {
  const iconPath = resolveAppIconPath()
  if (!iconPath) return nativeImage.createEmpty()

  const candidates = [iconPath]
  for (const candidate of candidates) {
    try {
      const icon = nativeImage.createFromPath(candidate)
      if (!icon.isEmpty()) return icon
    } catch {
      // Ignore icon load errors and continue.
    }
  }

  return nativeImage.createEmpty()
}

function createTray() {
  if (tray) return
  tray = new Tray(resolveTrayIcon())
  tray.setToolTip('QuickText')
  tray.on('click', () => {
    toggleMainWindowVisibility()
  })
  refreshTrayMenu({ immediate: true })
}

function refreshTrayMenu(options = {}) {
  if (!tray) return
  const immediate = !!options.immediate
  if (!immediate) {
    if (trayMenuRefreshTimer) clearTimeout(trayMenuRefreshTimer)
    trayMenuRefreshTimer = setTimeout(() => {
      trayMenuRefreshTimer = null
      refreshTrayMenu({ immediate: true })
    }, TRAY_MENU_REFRESH_DEBOUNCE_MS)
    return
  }

  if (trayMenuRefreshTimer) {
    clearTimeout(trayMenuRefreshTimer)
    trayMenuRefreshTimer = null
  }

  const isMainVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
  const overlayVisible = !!currentSettings?.overlayVisible
  const overlayInteractive = !!currentSettings?.overlayInteractive
  const language = getUiLanguage(currentSettings)
  const labels = TRAY_LABELS[language]
  const signature = `${language}|${isMainVisible ? '1' : '0'}|${overlayVisible ? '1' : '0'}|${overlayInteractive ? '1' : '0'}`
  if (signature === trayMenuSignature) return
  trayMenuSignature = signature

  const menu = Menu.buildFromTemplate([
    {
      label: isMainVisible ? labels.hideManager : labels.showManager,
      click: () => toggleMainWindowVisibility(),
    },
    {
      label: labels.settings,
      click: () => showHotkeyWindow(),
    },
    { type: 'separator' },
    {
      label: overlayVisible ? labels.hideOverlay : labels.showOverlay,
      click: () => toggleOverlayVisibility(),
    },
    {
      label: overlayInteractive ? labels.overlayActive : labels.overlayPassive,
      click: () => toggleOverlayInteraction(),
    },
    { type: 'separator' },
    {
      label: labels.quit,
      click: () => requestAppQuit(),
    },
  ])

  tray.setContextMenu(menu)
}

function getUiLanguage(settings) {
  return settings?.uiLanguage === 'en' ? 'en' : 'vi'
}

function escapePowerShellLiteral(value) {
  return String(value || '').replace(/'/g, "''")
}

async function runPowerShell(command, options = {}) {
  const stdio = options.stdio || 'pipe'
  return new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio,
      windowsHide: true,
    })

    let stdout = ''
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk || '')
      })
    }

    child.on('error', () => {
      resolve({ status: -1, stdout: '' })
    })

    child.on('close', (code) => {
      resolve({ status: typeof code === 'number' ? code : -1, stdout })
    })
  })
}

async function isWindowsAdmin() {
  if (process.platform !== 'win32') return true

  const command =
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  const result = await runPowerShell(command)

  if (result.status !== 0) return false
  return String(result.stdout || '').trim().toLowerCase() === 'true'
}

async function relaunchAsAdmin() {
  if (process.platform !== 'win32') return false

  const escapedExec = escapePowerShellLiteral(process.execPath)
  const escapedArgs = process.argv
    .slice(1)
    .map((arg) => `'${escapePowerShellLiteral(arg)}'`)
    .join(', ')
  const command =
    escapedArgs.length > 0
      ? `Start-Process -FilePath '${escapedExec}' -Verb RunAs -ArgumentList @(${escapedArgs})`
      : `Start-Process -FilePath '${escapedExec}' -Verb RunAs`

  const result = await runPowerShell(command, { stdio: 'ignore' })

  return result.status === 0
}

function getStartupLanguage() {
  const locale = String(app.getLocale?.() || '').toLowerCase()
  return locale.startsWith('vi') ? 'vi' : 'en'
}

async function ensureAdminOrExit() {
  if (SKIP_ADMIN_CHECK) return true
  if (process.platform !== 'win32') return true
  if (await isWindowsAdmin()) return true

  const relaunched = await relaunchAsAdmin()
  if (!relaunched) {
    const language = getStartupLanguage()
    const messages = ADMIN_MESSAGES[language]
    dialog.showErrorBox(
      messages.title,
      messages.body,
    )
    console.error(messages.relaunchFailed)
  }

  requestAppQuit()
  return false
}

function requestAppQuit() {
  if (isQuitting) return
  isQuitting = true
  app.quit()
}

function destroyManagedWindow(windowRef) {
  if (!windowRef || windowRef.isDestroyed()) return
  try {
    windowRef.destroy()
  } catch {
    // Ignore teardown errors while quitting.
  }
}

function cleanupRuntime() {
  if (runtimeCleanedUp) return
  runtimeCleanedUp = true

  if (mainBoundsPersistTimer) {
    clearTimeout(mainBoundsPersistTimer)
    mainBoundsPersistTimer = null
  }

  if (settingsWriteTimer) {
    clearTimeout(settingsWriteTimer)
    settingsWriteTimer = null
  }

  if (telemetryWriteTimer) {
    clearTimeout(telemetryWriteTimer)
    telemetryWriteTimer = null
  }

  if (overlayRefitTimer) {
    clearTimeout(overlayRefitTimer)
    overlayRefitTimer = null
  }

  clearOverlayBootTimer()
  clearRuntimeStateSyncTimer()
  clearSettingsWindowSyncTimer()

  if (trayMenuRefreshTimer) {
    clearTimeout(trayMenuRefreshTimer)
    trayMenuRefreshTimer = null
  }

  unregisterScreenListeners()

  if (tray) {
    tray.destroy()
    tray = null
  }

  if (packagedRendererProcess && !packagedRendererProcess.killed) {
    packagedRendererStopping = true
    try {
      packagedRendererProcess.kill()
    } catch {
      // Ignore child process termination errors.
    }
    packagedRendererProcess = null
  }

  destroyManagedWindow(hotkeyWindow)
  destroyManagedWindow(startupSplashWindow)
  destroyManagedWindow(overlayWindow)
  destroyManagedWindow(mainWindow)

  hotkeyWindow = null
  startupSplashWindow = null
  overlayWindow = null
  mainWindow = null
  packagedRendererProcess = null
  currentTelemetry = null
  pendingTelemetryWrite = null
  telemetryWritePromise = Promise.resolve()
  pendingSettingsWrite = null
  settingsWritePromise = Promise.resolve()
  lastSettingsWriteError = null
  hotkeySignature = ''
  overlayMousePassThrough = true
  overlayBoundsSignature = ''
  trayMenuSignature = ''
  settingsWindowRestorePending = false
  suppressSettingsBlurClose = false
  startupSplashActive = false
  startupSplashStartedAt = 0
  startupSplashProgress = 0
  mainBoundsSignature = ''
  mainRendererReadySenderId = 0
  packagedRendererStopping = false
  packagedRendererPort = PACKAGED_RENDERER_PORT
  updateRuntime = createDefaultUpdateRuntime()
  updateCheckPromise = null
  autoUpdaterInitialized = false
  profilingState = createDefaultProfilingState()
  profilingCurrentTrace = null
  profilingLogWritePromise = Promise.resolve()

  ipcMain.removeHandler('get-window-kind')
  ipcMain.removeHandler('get-settings')
  ipcMain.removeHandler('save-settings')
  ipcMain.removeHandler('telemetry:get')
  ipcMain.removeHandler('telemetry:report-send')
  ipcMain.removeHandler('telemetry:report-hotkey-error')
  ipcMain.removeHandler('profiling:get-state')
  ipcMain.removeHandler('profiling:set-config')
  ipcMain.removeHandler('profiling:report-react-commits')
  ipcMain.removeHandler('profiling:report-performance-entries')
  ipcMain.removeHandler('python:send')
  ipcMain.removeHandler('python:configure')
  ipcMain.removeHandler('python:events')
  ipcMain.removeHandler('overlay:toggle-visibility')
  ipcMain.removeHandler('overlay:toggle-interaction')
  ipcMain.removeHandler('overlay:set-interaction')
  ipcMain.removeHandler('overlay:set-mouse-pass-through')
  ipcMain.removeHandler('update:get-state')
  ipcMain.removeHandler('update:check')
  ipcMain.removeHandler('update:install')

  ipcMain.removeAllListeners('main:hide')
  ipcMain.removeAllListeners('main:show')
  ipcMain.removeAllListeners('main:toggle')
  ipcMain.removeAllListeners('renderer:main-ready')
  ipcMain.removeAllListeners('settings:open')
  ipcMain.removeAllListeners('settings:hide')
  ipcMain.removeAllListeners('settings:close')
  ipcMain.removeAllListeners('hotkey:open')
  ipcMain.removeAllListeners('hotkey:close')
  ipcMain.removeAllListeners('overlay-settings:open')
  ipcMain.removeAllListeners('overlay-settings:close')
  ipcMain.removeAllListeners('app:quit')
}

if (!hasSingleInstanceLock) {
  app.quit()
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!app.isReady()) return
    logStartupPhase('second-instance', 'focus existing app')
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
    showMainWindow()
    applySettingsToWindows(ensureSettings())
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      scheduleOverlayBoot('second-instance', 160)
    }
    refreshTrayMenu({ immediate: true })
  })

  app.whenReady()
    .then(async () => {
      logStartupPhase('app.whenReady')
      if (!(await ensureAdminOrExit())) return
      if (ensureAutoUpdaterInitialized()) {
        setTimeout(() => {
          void checkForAppUpdates('startup')
        }, AUTO_UPDATE_STARTUP_DELAY_MS)
      }
      startupSplashActive = false
      const splashShown = await showStartupSplashIfNeeded()
      startupSplashActive = splashShown
      logStartupPhase('splash', splashShown ? 'shown' : 'skipped')

      if (splashShown) {
        await setStartupSplashStep(0.08, 'initializing')
      }

      const settingsLoadPromise = (async () => {
        if (splashShown) {
          await setStartupSplashStep(0.16, 'loadingSettings')
        }
        await loadSettings()
        logStartupPhase('settings', 'loaded')
      })()
      const telemetryWarmupPromise = settingsLoadPromise
        .then(async () => {
          if (splashShown && startupSplashProgress < 0.26) {
            await setStartupSplashStep(0.24, 'loadingTelemetry')
          }
          await loadTelemetry()
          logStartupPhase('telemetry', 'loaded')
          broadcastTelemetry()
        })
        .catch((error) => {
          safeConsoleError('[startup] telemetry warmup failed:', error)
        })

      if (splashShown) {
        await setStartupSplashStep(0.12, 'bootRenderer')
      }
      const rendererBootPromise = startPackagedRendererServerIfNeeded()
      let overlayPrewarmPromise = Promise.resolve()

      if (splashShown) {
        await setStartupSplashStep(0.3, 'loadingWindows')
      }

      const rendererBooted = await rendererBootPromise
      if (!rendererBooted) {
        dialog.showErrorBox(
          'QuickText startup failed',
          'Unable to start the packaged renderer server.',
        )
        requestAppQuit()
        return
      }
      logStartupPhase('renderer', 'ready')
      overlayPrewarmPromise = prewarmOverlayRouteOnStartup()

      await settingsLoadPromise
      if (splashShown) {
        await setStartupSplashStep(0.34, 'creatingMain')
      }
      createMainWindow()
      logStartupPhase('main-window', 'created')
      const mainLoadPromise = splashShown ? waitForMainWindowStartupLoad() : Promise.resolve()
      const runtimeInitPromise = (async () => {
        const settingsSnapshot = ensureSettings()
        if (splashShown) {
          await setStartupSplashStep(0.35, 'applyingSettings')
        }
        applySettingsToWindows(settingsSnapshot)
        if (splashShown) {
          await setStartupSplashStep(0.36, 'registeringHotkeys')
        }
        ensureHotkeys(settingsSnapshot)
        if (splashShown) {
          await setStartupSplashStep(0.37, 'creatingTray')
        }
        createTray()
        logStartupPhase('tray', 'created')
      })()

      await mainLoadPromise
      logStartupPhase('main-window', 'ready')
      if (splashShown) {
        await setStartupSplashStep(0.9, 'uiReady')
        await hideStartupSplashAndRevealMain()
      }

      await runtimeInitPromise
      await overlayPrewarmPromise
      const settingsSnapshot = ensureSettings()
      clearOverlayBootTimer()
      createOverlayWindow()
      applyOverlayWindowSettings(settingsSnapshot)
      applyOverlayVisibility(settingsSnapshot.overlayVisible)
      logStartupPhase('overlay', settingsSnapshot.overlayVisible ? 'visible' : 'hidden')
      scheduleRuntimeStateSync(splashShown ? 24 : 0)
      void telemetryWarmupPromise
    })
    .catch((error) => {
      safeConsoleError('[startup] failed:', error)
      requestAppQuit()
    })
}

app.on('activate', () => {
  if (!hasSingleInstanceLock) return
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  showMainWindow()
  applySettingsToWindows(ensureSettings())
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    scheduleOverlayBoot('activate', 160)
  }
  refreshTrayMenu({ immediate: true })
})

app.on('before-quit', (event) => {
  if (quittingAfterSettingsFlush) {
    isQuitting = true
    cleanupRuntime()
    return
  }

  event.preventDefault()
  isQuitting = true
  quittingAfterSettingsFlush = true

  void Promise.allSettled([
    flushPendingSettingsWrite({ throwOnError: true }),
    flushPendingTelemetryWrite({ throwOnError: true }),
    stopPackagedRendererServer(),
    shutdownProfilingRuntime(),
  ])
    .finally(() => {
      cleanupRuntime()
      app.quit()
    })
})

app.on('will-quit', () => {
  cleanupRuntime()
})

app.on('window-all-closed', () => {
  if (!isQuitting) {
    requestAppQuit()
  }
})

const IPC_SCHEMAS = {
  telemetrySend: z
    .object({
      success: z.boolean().optional(),
      latencyMs: z.number().finite().optional(),
      error: z.string().optional(),
      requestId: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .passthrough(),
  telemetryHotkey: z
    .object({
      source: z.string().optional(),
      message: z.string().optional(),
      requestId: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .passthrough(),
  profilingConfig: z
    .object({
      enabled: z.boolean().optional(),
      intervalMs: z.number().finite().optional(),
      durationMs: z.number().finite().optional(),
    })
    .passthrough(),
  profilingBatch: z.array(z.any()),
  pythonPayload: z.record(z.any()),
  pythonAfter: z.union([
    z.number().int().nonnegative(),
    z.string(),
    z
      .object({
        after: z.any(),
      })
      .passthrough(),
  ]),
  saveSettings: z.union([
    z.undefined(),
    z.null(),
    z.record(z.any()),
    z
      .object({
        patch: z.record(z.any()).optional(),
        awaitFlush: z.boolean().optional(),
        immediate: z.boolean().optional(),
      })
      .passthrough(),
  ]),
  booleanFlag: z.boolean(),
}

function resolveTrustedRendererOrigins() {
  const origins = new Set()
  const candidates = [process.env.ELECTRON_START_URL, 'http://localhost:3000', 'http://127.0.0.1:3000']

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    try {
      origins.add(new URL(candidate).origin)
    } catch {
      // Ignore malformed values.
    }
  }

  return origins
}

const TRUSTED_RENDERER_ORIGINS = resolveTrustedRendererOrigins()

function isTrustedRendererUrl(url) {
  if (typeof url !== 'string' || !url) return false
  if (url.startsWith('file://')) return true

  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return true
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (TRUSTED_RENDERER_ORIGINS.has(parsed.origin)) return true
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function assertTrustedIpcSender(event, channel) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.() || ''
  if (isTrustedRendererUrl(url)) return
  const error = new Error(`[ipc:${channel}] blocked sender: ${url || 'unknown'}`)
  error.code = 'ERR_IPC_ORIGIN'
  throw error
}

function parseIpcPayload(schema, rawValue, channel) {
  const result = schema.safeParse(rawValue)
  if (result.success) return result.data
  const issue = result.error?.issues?.[0]
  const details = issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid IPC payload'
  const error = new Error(`[ipc:${channel}] ${details}`)
  error.code = 'ERR_IPC_VALIDATION'
  throw error
}

function withIpcHandle(channel, schema, handler) {
  ipcMain.handle(channel, async (event, rawValue) => {
    assertTrustedIpcSender(event, channel)
    const parsed = schema ? parseIpcPayload(schema, rawValue, channel) : rawValue
    return handler(event, parsed)
  })
}

function withIpcListener(channel, schema, handler) {
  ipcMain.on(channel, (event, rawValue) => {
    try {
      assertTrustedIpcSender(event, channel)
      const parsed = schema ? parseIpcPayload(schema, rawValue, channel) : rawValue
      handler(event, parsed)
    } catch (error) {
      console.error(error)
    }
  })
}

function parseSaveSettingsPayload(rawInput) {
  const parsed = parseIpcPayload(IPC_SCHEMAS.saveSettings, rawInput ?? {}, 'save-settings')
  if (
    parsed &&
    typeof parsed === 'object' &&
    Object.prototype.hasOwnProperty.call(parsed, 'patch') &&
    parsed.patch &&
    typeof parsed.patch === 'object'
  ) {
    return {
      patch: parsed.patch,
      awaitFlush: !!parsed.awaitFlush,
      immediate: !!parsed.immediate,
    }
  }

  return {
    patch: parsed && typeof parsed === 'object' ? parsed : {},
    awaitFlush: false,
    immediate: false,
  }
}

function patchHasAnyKey(patch, keys) {
  if (!patch || typeof patch !== 'object') return false
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) return true
  }
  return false
}

function patchTouchesWindowState(patch) {
  return patchHasAnyKey(patch, [
    'appEnabled',
    'overlayVisible',
    'overlayInteractive',
    'overlaySmartClickThrough',
    'overlayX',
    'overlayY',
    'overlayWidth',
    'overlayHeight',
    'windowX',
    'windowY',
    'windowWidth',
    'windowHeight',
  ])
}

function patchTouchesTrayState(patch) {
  return patchHasAnyKey(patch, ['overlayVisible', 'overlayInteractive', 'uiLanguage'])
}

withIpcHandle('get-window-kind', null, (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (overlayWindow && owner && owner.id === overlayWindow.id) return 'overlay'
  if (hotkeyWindow && owner && owner.id === hotkeyWindow.id) return 'settings'
  return 'main'
})

withIpcHandle('get-settings', null, async () => ensureSettings())

withIpcHandle('telemetry:get', null, async () => ensureTelemetry())

withIpcHandle('telemetry:report-send', IPC_SCHEMAS.telemetrySend, async (_event, payload) => {
  return recordSendTelemetry(payload || {})
})

withIpcHandle('telemetry:report-hotkey-error', IPC_SCHEMAS.telemetryHotkey, async (_event, payload) => {
  return recordHotkeyError(payload || {})
})

withIpcHandle('profiling:get-state', null, async () => getProfilingStateSnapshot())

withIpcHandle('profiling:set-config', IPC_SCHEMAS.profilingConfig, async (_event, partial) => {
  return updateProfilingConfig(partial || {})
})

withIpcHandle('profiling:report-react-commits', IPC_SCHEMAS.profilingBatch, async (_event, payload) => {
  return reportReactProfilingBatch(payload)
})

withIpcHandle('profiling:report-performance-entries', IPC_SCHEMAS.profilingBatch, async (_event, payload) => {
  return reportPerformanceProfilingBatch(payload)
})

withIpcHandle('python:send', IPC_SCHEMAS.pythonPayload, async (_event, payload) => {
  return handlePythonSend(payload)
})

withIpcHandle('python:configure', IPC_SCHEMAS.pythonPayload, async (_event, payload) => {
  return handlePythonConfigure(payload)
})

withIpcHandle('python:events', IPC_SCHEMAS.pythonAfter, async (_event, after) => {
  return handlePythonEvents(after)
})

withIpcHandle('save-settings', IPC_SCHEMAS.saveSettings, async (_event, rawInput) => {
  const { patch, awaitFlush, immediate } = parseSaveSettingsPayload(rawInput)
  const patchPayload = patch && typeof patch === 'object' ? patch : {}
  const base = ensureSettings()
  currentSettings = normalizeSettings({ ...base, ...patchPayload })
  try {
    await saveSettings(currentSettings, {
      immediate: immediate || awaitFlush,
      awaitFlush,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Settings write failed'
    broadcastToWindows('settings:write-error', { message })
    throw new Error(message)
  }
  const touchesWindowState = patchTouchesWindowState(patchPayload)
  if (touchesWindowState) {
    applySettingsToWindows(currentSettings)
    if (shouldBootOverlayForSettings(currentSettings)) {
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        scheduleOverlayBoot('save-settings', 120)
      }
    } else {
      clearOverlayBootTimer()
      maybeTearDownOverlayWindow(currentSettings)
    }
  }
  ensureHotkeys(currentSettings)
  broadcastSettings()
  if (patchTouchesTrayState(patchPayload)) {
    refreshTrayMenu()
  }
  return currentSettings
})

withIpcHandle('overlay:toggle-visibility', null, async () => {
  const updated = toggleOverlayVisibility()
  return updated
})

withIpcHandle('overlay:toggle-interaction', null, async () => {
  const updated = toggleOverlayInteraction()
  return updated
})

withIpcHandle('overlay:set-interaction', IPC_SCHEMAS.booleanFlag, async (_event, interactive) => {
  const settings = ensureSettings()
  settings.overlayInteractive = !!interactive
  if (settings.overlayInteractive) {
    ensureOverlayWindowForCurrentSettings()
  }
  if (!settings.overlayInteractive) {
    overlayMousePassThrough = true
  }
  void saveSettings(settings)
  applyOverlayWindowSettings(settings)
  applyOverlayInteraction(settings.overlayInteractive)
  maybeTearDownOverlayWindow(settings)
  broadcastSettings()
  refreshTrayMenu()
  return settings
})

withIpcHandle('overlay:set-mouse-pass-through', IPC_SCHEMAS.booleanFlag, async (_event, passThrough) => {
  const next = setOverlayMousePassThrough(!!passThrough)
  return !!next
})

withIpcHandle('update:get-state', null, async () => {
  ensureAutoUpdaterInitialized()
  return getUpdateRuntimeSnapshot()
})

withIpcHandle('update:check', null, async () => {
  return checkForAppUpdates('manual')
})

withIpcHandle('update:install', null, async () => {
  const accepted = installDownloadedUpdateNow()
  return {
    ok: accepted,
    state: getUpdateRuntimeSnapshot(),
  }
})

withIpcListener('main:hide', null, () => {
  hideMainWindow()
})

withIpcListener('main:show', null, () => {
  showMainWindow()
})

withIpcListener('main:toggle', null, () => {
  toggleMainWindowVisibility()
})

withIpcListener('settings:open', null, () => {
  showHotkeyWindow()
})

withIpcListener('settings:hide', null, () => {
  hideSettingsWindow()
})

withIpcListener('settings:close', null, () => {
  closeHotkeyWindow()
})

withIpcListener('hotkey:open', null, () => {
  showHotkeyWindow()
})

withIpcListener('hotkey:close', null, () => {
  closeHotkeyWindow()
})

withIpcListener('overlay-settings:open', null, () => {
  showOverlaySettingsWindow()
})

withIpcListener('overlay-settings:close', null, () => {
  closeOverlaySettingsWindow()
})

withIpcListener('app:quit', null, () => {
  requestAppQuit()
})
