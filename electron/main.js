const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, dialog, contentTracing, globalShortcut, session } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')
const { spawn, execSync } = require('child_process')
const { pathToFileURL } = require('url')
const { z } = require('zod')
const lensParserCore = require('../lib/lens-parser-core')
const fsp = fs.promises

let cachedAutoUpdater = undefined
let cachedAutoUpdaterError = ''
function resolveAutoUpdater() {
  if (cachedAutoUpdater !== undefined) return cachedAutoUpdater
  cachedAutoUpdaterError = ''
  try {
    const module = require('electron-updater')
    cachedAutoUpdater = module?.autoUpdater || null
  } catch (error) {
    cachedAutoUpdater = null
    cachedAutoUpdaterError = error instanceof Error ? error.message : String(error || 'Unknown updater load error')
  }
  return cachedAutoUpdater
}

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')
const TELEMETRY_PATH = path.join(app.getPath('userData'), 'telemetry.json')
const OVERLAY_IMAGE_HISTORY_PATH = path.join(app.getPath('userData'), 'overlay-image-history.v1.json')
const OVERLAY_IMAGE_SESSION_PATH = path.join(app.getPath('userData'), 'overlay-image-session.v1.json')
const PROFILING_DIR = path.join(app.getPath('userData'), 'profiling')
const REACT_PROFILE_LOG_PATH = path.join(PROFILING_DIR, 'react-commits.ndjson')
const RENDERER_PERF_LOG_PATH = path.join(PROFILING_DIR, 'renderer-performance.ndjson')
const STARTUP_SPLASH_IMAGE_FILENAME = 'logo.png'
const STARTUP_SPLASH_LEGACY_IMAGE_FILENAME = 'logo.jpg'
const STARTUP_SPLASH_FALLBACK_IMAGE_FILENAME = 'icon_full.png'
const APP_DISPLAY_NAME = 'Quick Text'
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
    firstLaunchNotice: 'Lần chạy đầu sẽ hơi lâu: Quick Text đang preload toàn bộ dữ liệu và giao diện...',
    initializing: 'Đang khởi động Quick Text...',
    bootRenderer: 'Đang khởi động renderer...',
    loadingSettings: 'Đang nạp cài đặt Quick Text...',
    loadingTelemetry: 'Đang khôi phục thống kê...',
    loadingWindows: 'Đang tạo cửa sổ...',
    creatingMain: 'Đang tạo cửa sổ chính...',
    loadingInterface: 'Đang tải giao diện...',
    compilingMain: 'Đang chuẩn bị giao diện...',
    compilingMainFirstLaunch: 'Lần chạy đầu: đang chuẩn bị giao diện lần đầu (các lần sau sẽ nhanh hơn)...',
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
    firstLaunchNotice: 'First launch may take longer: Quick Text is preloading all data and UI assets...',
    initializing: 'Booting Quick Text...',
    bootRenderer: 'Starting renderer...',
    loadingSettings: 'Loading settings...',
    loadingTelemetry: 'Restoring telemetry...',
    loadingWindows: 'Creating windows...',
    creatingMain: 'Creating main window...',
    loadingInterface: 'Loading interface...',
    compilingMain: 'Compiling interface...',
    compilingMainFirstLaunch: 'First launch: preparing the interface for the first time (next launches will be faster)...',
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
const DEFAULT_PYTHON_SERVICE_EXE_NAME = 'QuickTextPython.exe'
const INPUT_BACKEND_NATIVE = 'native'
const INPUT_BACKEND_PYTHON = 'python'
const INPUT_BACKEND_ENV = String(process.env.QT_INPUT_BACKEND || '').trim().toLowerCase()
const OVERLAY_TOGGLE_HOTKEY = 'Shift+F7'
const DEFAULT_OVERLAY_EDIT_HOTKEY = 'Shift+F6'
const DEFAULT_SEND_HOTKEY = 'Shift+F5'
const DEFAULT_MAIN_TOGGLE_HOTKEY = 'Shift+F8'
const DEFAULT_APP_TOGGLE_HOTKEY = 'Shift+F9'
const OVERLAY_FULLSCREEN_SIZE = 10000
const SETTINGS_WRITE_DEBOUNCE_MS = 160
const PYTHON_SEND_TIMEOUT_MS = 5000
const PYTHON_CONFIG_TIMEOUT_MS = 3000
const PYTHON_EVENTS_TIMEOUT_MS = 3000
const PYTHON_RETRY_BASE_DELAY_MS = 140
const PYTHON_HEALTHCHECK_TIMEOUT_MS = parseIntegerEnv('QT_PYTHON_HEALTH_TIMEOUT_MS', 1200, 300, 10000)
const PYTHON_HEALTH_CACHE_MS = parseIntegerEnv('QT_PYTHON_HEALTH_CACHE_MS', 900, 200, 5000)
const PYTHON_BOOT_TIMEOUT_MS = parseIntegerEnv('QT_PYTHON_BOOT_TIMEOUT_MS', 9000, 1500, 60000)
const PYTHON_BOOT_RETRY_COOLDOWN_MS = parseIntegerEnv('QT_PYTHON_BOOT_RETRY_COOLDOWN_MS', 5000, 1000, 60000)
const PYTHON_AUTO_START_ENABLED = parseBooleanEnv('QT_PYTHON_AUTO_START', true)
const TELEMETRY_MAX_ERROR_LENGTH = 320
const TELEMETRY_MAX_LATENCY_MS = 120000
const TELEMETRY_ROTATE_MAX_BYTES = 2 * 1024 * 1024
const TELEMETRY_RETENTION_FILES = 5
const TELEMETRY_WRITE_DEBOUNCE_MS = 220
const TRAY_MENU_REFRESH_DEBOUNCE_MS = 90
const OVERLAY_REFIT_DEBOUNCE_MS = 220
const OVERLAY_DEFER_BOOT_MS = 260
const OVERLAY_SMART_ZONE_POLL_MS = parseIntegerEnv('QT_OVERLAY_SMART_ZONE_POLL_MS', 30, 10, 120)
const OVERLAY_QUICK_ADD_HEIGHT = 56
const OVERLAY_QUICK_ADD_GUTTER = 8
const OVERLAY_QUICK_ADD_MIN_WIDTH = 280
const OVERLAY_QUICK_ADD_MAX_WIDTH = 520
const ELECTRON_HOTKEY_ACTION_DEBOUNCE_MS = 280
const ELECTRON_HOTKEY_TOGGLE_DEBOUNCE_MS = 900
const STARTUP_PHASE_LOG_ENABLED = parseBooleanEnv('QT_STARTUP_PHASE_LOG', false)
const OVERLAY_LIFECYCLE_LOG_ENABLED = parseBooleanEnv('QT_OVERLAY_LIFECYCLE_LOG', false)
const SKIP_ADMIN_CHECK = parseBooleanEnv('QT_SKIP_ADMIN_CHECK', false)
const ELECTRON_HOTKEY_FALLBACK_ENV = String(process.env.QT_ELECTRON_HOTKEY_FALLBACK || '').trim().toLowerCase()
const FORCE_ELECTRON_HOTKEY_FALLBACK = parseBooleanEnv('QT_ELECTRON_HOTKEY_FALLBACK', false)
const DISABLE_PACKAGED_ELECTRON_HOTKEY_FALLBACK = ['0', 'false', 'no', 'off'].includes(ELECTRON_HOTKEY_FALLBACK_ENV)
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
    enableApp: 'Bật App',
    disableApp: 'Tắt App',
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
    enableApp: 'Enable App',
    disableApp: 'Disable App',
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
    title: 'Quick Text cần quyền quản trị viên',
    body: 'Quick Text cần quyền quản trị để chạy overlay trên game. Vui lòng mở app bằng quyền quản trị viên.',
    relaunchFailed: '[admin] Không thể tự mở lại bằng quyền quản trị. Hãy chạy app bằng Run as administrator.',
  },
  en: {
    title: 'Quick Text requires Administrator',
    body: 'Quick Text needs Administrator permission to run overlay above games. Please run the app as Administrator.',
    relaunchFailed: '[admin] Unable to relaunch as Administrator. Run the app as Admin manually.',
  },
}
const PYTHON_POLICY = {
  send: { timeoutMs: PYTHON_SEND_TIMEOUT_MS, retries: 1, baseBackoffMs: PYTHON_RETRY_BASE_DELAY_MS },
  configure: { timeoutMs: PYTHON_CONFIG_TIMEOUT_MS, retries: 1, baseBackoffMs: PYTHON_RETRY_BASE_DELAY_MS },
  events: { timeoutMs: PYTHON_EVENTS_TIMEOUT_MS, retries: 0, baseBackoffMs: PYTHON_RETRY_BASE_DELAY_MS },
}
const GOOGLE_LENS_UPLOAD_BASE = 'https://lens.google.com/v3/upload'
const GOOGLE_ORIGIN = 'https://www.google.com'
const LENS_SEARCH_TIMEOUT_MS = 14000
const LENS_FALLBACK_SCRAPE_TIMEOUT_MS = 16000
const LENS_FALLBACK_SCRAPE_POLL_MS = 500
const LENS_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const LENS_DEFAULT_LIMIT = 6
const LENS_MAX_LIMIT = 10

const DEFAULT_SETTINGS = {
  appEnabled: true,
  blockAltF4WhenEnabled: false,
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
  overlayToolsShowTextManager: true,
  overlayToolsShowImageTranslate: true,
  overlayToolsPanelVisible: true,
  overlayToolsActiveTab: 'image',
  overlayToolsPanelX: 24,
  overlayToolsPanelY: 92,
  overlayQuickAddX: 40,
  overlayQuickAddY: 86,
  overlayToolsImagePanelX: 824,
  overlayToolsImagePanelY: 92,
  overlayToolsTextPanelWidth: 760,
  overlayToolsTextPanelHeight: 860,
  overlayToolsImagePanelWidth: 560,
  overlayToolsImagePanelHeight: 760,
  overlayToolsOpacity: 1,
  overlayToolsTextPanelOpacity: 1,
  overlayToolsImagePanelOpacity: 1,
  overlayHudContextOpacity: 0.95,
  overlayPlayShowImageCard: true,
  overlayImageCardOffsetXPercent: 24,
  overlayImageCardOffsetYPercent: 20,
  overlayToolsAutoSearchOnPaste: false,
  overlayToolsShowWebPreview: true,
  overlayToolsWebPreviewHeight: 320,
  overlayImageAutoClipboardEnabled: true,
  overlayImageAutoClipboardMaxConcurrent: 2,
  overlayImageHistoryLimit: 40,
  overlayImageHistoryTtlMinutes: 120,
  overlayImageCompactHistoryVisibleCount: 5,
  overlayImageBlockUploadPreview: true,
  overlayImageBlockResults: true,
  overlayImageBlockWebPreview: true,
  overlayImageBlockOcr: true,
  overlayImageBlockAiReply: true,
  overlayImageBlockTranslatedReply: true,
  overlayImageBlockOverview: true,
  overlayImageBlockGoogleTranslation: true,
  overlayImageBlockLensUrl: false,
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
const TRAY_MENU_WINDOW_WIDTH = 336
const TRAY_MENU_WINDOW_HEIGHT = 368
const TRAY_MENU_WINDOW_MARGIN = 8
const TRAY_MENU_REOPEN_SUPPRESS_MS = 220
const OVERLAY_IMAGE_WINDOW_WIDTH = 760
const OVERLAY_IMAGE_WINDOW_HEIGHT = 860
let mainWindow = null
let overlayWindow = null
let overlayImageWindow = null
let hotkeyWindow = null
let startupSplashWindow = null
let tray = null
let trayMenuWindow = null
let trayNativeFallbackMenu = null
let trayNativeFallbackEnabled = false
let trayMenuSuppressOpenUntil = 0
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
let electronHotkeyRegistrations = []
let electronHotkeyLastTriggeredAt = new Map()
let standaloneAppToggleHotkeyRegistration = ''
let altF4BlockShortcutRegistered = false
let overlayMousePassThrough = true
let overlayInteractiveZones = {
  quickAdd: null,
}
let overlaySmartZonePollTimer = null
let overlaySmartZoneInsideLast = false
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
let settingsWindowAutoShowOnReady = false
let startupSplashActive = false
let startupSplashStartedAt = 0
let startupSplashProgress = 0
let startupFirstLaunch = false
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
let managedPythonProcess = null
let managedPythonStopping = false
let managedPythonBootPromise = null
let managedPythonLastError = ''
let managedPythonRetryAfter = 0
let managedPythonHealthAt = 0
let managedPythonHealthOk = false
let managedPythonLaunchCommand = ''
let nativeInputCore = null
let inputBackendName = ''
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
    const reason = cachedAutoUpdaterError || 'electron-updater is not available.'
    setUpdateRuntimePatch({
      supported: false,
      stage: 'unsupported',
      error: reason,
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
    const reason = cachedAutoUpdaterError || 'electron-updater is not available.'
    return setUpdateRuntimePatch({
      stage: 'unsupported',
      error: reason,
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

async function loadOverlayImageHistory() {
  try {
    const raw = await fsp.readFile(OVERLAY_IMAGE_HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

async function saveOverlayImageHistory(entries) {
  const safeEntries = Array.isArray(entries) ? entries : []
  await writeJsonAtomicFile(OVERLAY_IMAGE_HISTORY_PATH, safeEntries)
  return { ok: true }
}

async function loadOverlayImageSession() {
  try {
    const raw = await fsp.readFile(OVERLAY_IMAGE_SESSION_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function saveOverlayImageSession(sessionPayload) {
  const safePayload = sessionPayload && typeof sessionPayload === 'object' ? sessionPayload : {}
  await writeJsonAtomicFile(OVERLAY_IMAGE_SESSION_PATH, safePayload)
  return { ok: true }
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
  if (value === 'python-config' || value === 'input-events' || value === 'overlay-action' || value === 'electron-hotkey') return value
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
  merged.blockAltF4WhenEnabled =
    typeof input.blockAltF4WhenEnabled === 'boolean'
      ? input.blockAltF4WhenEnabled
      : DEFAULT_SETTINGS.blockAltF4WhenEnabled
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
  merged.overlayToolsShowTextManager =
    typeof input.overlayToolsShowTextManager === 'boolean'
      ? input.overlayToolsShowTextManager
      : DEFAULT_SETTINGS.overlayToolsShowTextManager
  merged.overlayToolsShowImageTranslate =
    typeof input.overlayToolsShowImageTranslate === 'boolean'
      ? input.overlayToolsShowImageTranslate
      : DEFAULT_SETTINGS.overlayToolsShowImageTranslate
  merged.overlayToolsPanelVisible =
    typeof input.overlayToolsPanelVisible === 'boolean'
      ? input.overlayToolsPanelVisible
      : DEFAULT_SETTINGS.overlayToolsPanelVisible
  merged.overlayToolsActiveTab =
    input.overlayToolsActiveTab === 'text' || input.overlayToolsActiveTab === 'image'
      ? input.overlayToolsActiveTab
      : DEFAULT_SETTINGS.overlayToolsActiveTab
  merged.overlayToolsPanelX = clampInt(input.overlayToolsPanelX, -20000, 20000, DEFAULT_SETTINGS.overlayToolsPanelX)
  merged.overlayToolsPanelY = clampInt(input.overlayToolsPanelY, -20000, 20000, DEFAULT_SETTINGS.overlayToolsPanelY)
  merged.overlayQuickAddX = clampInt(input.overlayQuickAddX, -20000, 20000, DEFAULT_SETTINGS.overlayQuickAddX)
  merged.overlayQuickAddY = clampInt(input.overlayQuickAddY, -20000, 20000, DEFAULT_SETTINGS.overlayQuickAddY)
  merged.overlayToolsImagePanelX = clampInt(
    input.overlayToolsImagePanelX,
    -20000,
    20000,
    DEFAULT_SETTINGS.overlayToolsImagePanelX,
  )
  merged.overlayToolsImagePanelY = clampInt(
    input.overlayToolsImagePanelY,
    -20000,
    20000,
    DEFAULT_SETTINGS.overlayToolsImagePanelY,
  )
  merged.overlayToolsTextPanelWidth = clampInt(
    input.overlayToolsTextPanelWidth,
    520,
    1400,
    DEFAULT_SETTINGS.overlayToolsTextPanelWidth,
  )
  merged.overlayToolsTextPanelHeight = clampInt(
    input.overlayToolsTextPanelHeight,
    360,
    1100,
    DEFAULT_SETTINGS.overlayToolsTextPanelHeight,
  )
  merged.overlayToolsImagePanelWidth = clampInt(
    input.overlayToolsImagePanelWidth,
    420,
    1200,
    DEFAULT_SETTINGS.overlayToolsImagePanelWidth,
  )
  merged.overlayToolsImagePanelHeight = clampInt(
    input.overlayToolsImagePanelHeight,
    320,
    1100,
    DEFAULT_SETTINGS.overlayToolsImagePanelHeight,
  )
  if (!merged.overlayToolsShowTextManager && !merged.overlayToolsShowImageTranslate) {
    merged.overlayToolsShowTextManager = true
    merged.overlayToolsShowImageTranslate = false
  }
  merged.overlayToolsOpacity = clampFloat(input.overlayToolsOpacity, 0.35, 1, DEFAULT_SETTINGS.overlayToolsOpacity)
  merged.overlayToolsTextPanelOpacity = clampFloat(
    input.overlayToolsTextPanelOpacity,
    0.2,
    1,
    DEFAULT_SETTINGS.overlayToolsTextPanelOpacity,
  )
  merged.overlayToolsImagePanelOpacity = clampFloat(
    input.overlayToolsImagePanelOpacity,
    0.2,
    1,
    DEFAULT_SETTINGS.overlayToolsImagePanelOpacity,
  )
  merged.overlayHudContextOpacity = clampFloat(
    input.overlayHudContextOpacity,
    0.2,
    1,
    DEFAULT_SETTINGS.overlayHudContextOpacity,
  )
  merged.overlayPlayShowImageCard =
    typeof input.overlayPlayShowImageCard === 'boolean'
      ? input.overlayPlayShowImageCard
      : DEFAULT_SETTINGS.overlayPlayShowImageCard
  merged.overlayImageCardOffsetXPercent = clampFloat(
    input.overlayImageCardOffsetXPercent,
    -70,
    70,
    DEFAULT_SETTINGS.overlayImageCardOffsetXPercent,
  )
  merged.overlayImageCardOffsetYPercent = clampFloat(
    input.overlayImageCardOffsetYPercent,
    -45,
    45,
    DEFAULT_SETTINGS.overlayImageCardOffsetYPercent,
  )
  merged.overlayToolsAutoSearchOnPaste =
    typeof input.overlayToolsAutoSearchOnPaste === 'boolean'
      ? input.overlayToolsAutoSearchOnPaste
      : DEFAULT_SETTINGS.overlayToolsAutoSearchOnPaste
  merged.overlayToolsShowWebPreview =
    typeof input.overlayToolsShowWebPreview === 'boolean'
      ? input.overlayToolsShowWebPreview
      : DEFAULT_SETTINGS.overlayToolsShowWebPreview
  merged.overlayToolsWebPreviewHeight = clampInt(
    input.overlayToolsWebPreviewHeight,
    200,
    680,
    DEFAULT_SETTINGS.overlayToolsWebPreviewHeight,
  )
  merged.overlayImageAutoClipboardEnabled =
    typeof input.overlayImageAutoClipboardEnabled === 'boolean'
      ? input.overlayImageAutoClipboardEnabled
      : DEFAULT_SETTINGS.overlayImageAutoClipboardEnabled
  merged.overlayImageAutoClipboardMaxConcurrent = clampInt(
    input.overlayImageAutoClipboardMaxConcurrent,
    1,
    6,
    DEFAULT_SETTINGS.overlayImageAutoClipboardMaxConcurrent,
  )
  merged.overlayImageHistoryLimit = clampInt(
    input.overlayImageHistoryLimit,
    10,
    200,
    DEFAULT_SETTINGS.overlayImageHistoryLimit,
  )
  merged.overlayImageHistoryTtlMinutes = clampInt(
    input.overlayImageHistoryTtlMinutes,
    5,
    1440,
    DEFAULT_SETTINGS.overlayImageHistoryTtlMinutes,
  )
  merged.overlayImageCompactHistoryVisibleCount = clampInt(
    input.overlayImageCompactHistoryVisibleCount,
    1,
    20,
    DEFAULT_SETTINGS.overlayImageCompactHistoryVisibleCount,
  )
  merged.overlayImageBlockUploadPreview =
    typeof input.overlayImageBlockUploadPreview === 'boolean'
      ? input.overlayImageBlockUploadPreview
      : DEFAULT_SETTINGS.overlayImageBlockUploadPreview
  merged.overlayImageBlockResults =
    typeof input.overlayImageBlockResults === 'boolean'
      ? input.overlayImageBlockResults
      : DEFAULT_SETTINGS.overlayImageBlockResults
  merged.overlayImageBlockWebPreview =
    typeof input.overlayImageBlockWebPreview === 'boolean'
      ? input.overlayImageBlockWebPreview
      : DEFAULT_SETTINGS.overlayImageBlockWebPreview
  merged.overlayImageBlockOcr =
    typeof input.overlayImageBlockOcr === 'boolean'
      ? input.overlayImageBlockOcr
      : DEFAULT_SETTINGS.overlayImageBlockOcr
  merged.overlayImageBlockAiReply =
    typeof input.overlayImageBlockAiReply === 'boolean'
      ? input.overlayImageBlockAiReply
      : DEFAULT_SETTINGS.overlayImageBlockAiReply
  merged.overlayImageBlockTranslatedReply =
    typeof input.overlayImageBlockTranslatedReply === 'boolean'
      ? input.overlayImageBlockTranslatedReply
      : DEFAULT_SETTINGS.overlayImageBlockTranslatedReply
  merged.overlayImageBlockOverview =
    typeof input.overlayImageBlockOverview === 'boolean'
      ? input.overlayImageBlockOverview
      : DEFAULT_SETTINGS.overlayImageBlockOverview
  merged.overlayImageBlockGoogleTranslation =
    typeof input.overlayImageBlockGoogleTranslation === 'boolean'
      ? input.overlayImageBlockGoogleTranslation
      : DEFAULT_SETTINGS.overlayImageBlockGoogleTranslation
  merged.overlayImageBlockLensUrl =
    typeof input.overlayImageBlockLensUrl === 'boolean'
      ? input.overlayImageBlockLensUrl
      : DEFAULT_SETTINGS.overlayImageBlockLensUrl
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

  const requestedSendHotkey =
    input.sendHotkey === null ? null : firstString(input.sendHotkey, input.modeCycleHotkey, input.hotkey, input.modeToggleHotkey)
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
  if (value === null) return null
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function normalizeHotkeyOverrides(value) {
  if (!value || typeof value !== 'object') return {}
  const raw = value
  const next = {}

  for (const action of HOTKEY_ACTIONS) {
    if (Object.prototype.hasOwnProperty.call(raw, action.id) && raw[action.id] === null) {
      next[action.id] = null
      continue
    }
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
    if (Object.prototype.hasOwnProperty.call(overrides, action.id)) continue

    const current = normalizeHotkey(settings[action.settingKey], action.defaultCombo)
    if (current === null) {
      overrides[action.id] = null
      continue
    }
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
  if (!action) return null

  if (Object.prototype.hasOwnProperty.call(overrides, actionId) && overrides[actionId] === null) {
    return null
  }
  const overrideValue = normalizeHotkey(overrides[actionId], '')
  if (overrideValue && !isReservedHotkey(overrideValue)) {
    return overrideValue
  }

  return action.defaultCombo
}

function enforceUniqueHotkeys(patch) {
  const next = { ...patch, hotkeyOverrides: { ...(patch.hotkeyOverrides || {}) } }
  const seen = []

  for (const action of HOTKEY_ACTIONS) {
    if (
      (Object.prototype.hasOwnProperty.call(next.hotkeyOverrides, action.id) && next.hotkeyOverrides[action.id] === null) ||
      next[action.settingKey] === null
    ) {
      next[action.settingKey] = null
      next.hotkeyOverrides[action.id] = null
      continue
    }

    let combo = normalizeHotkey(next[action.settingKey], action.defaultCombo)
    let token = normalizeHotkeyToken(combo)
    let parsed = parseHotkeyComboParts(combo)
    const hasConflict = parsed ? seen.some((current) => hotkeysCanConflict(current, parsed)) : false

    if (!token || !parsed || hasConflict || isReservedHotkey(combo)) {
      combo = action.defaultCombo
      token = normalizeHotkeyToken(combo)
      parsed = parseHotkeyComboParts(combo)
      delete next.hotkeyOverrides[action.id]
    }

    next[action.settingKey] = combo
    if (token && parsed) seen.push(parsed)
  }

  return next
}

function resolvePreferredInputBackend() {
  if (INPUT_BACKEND_ENV === INPUT_BACKEND_NATIVE || INPUT_BACKEND_ENV === INPUT_BACKEND_PYTHON) {
    return INPUT_BACKEND_ENV
  }
  return INPUT_BACKEND_NATIVE
}

function resolveNativeInputCorePath() {
  const candidates = [
    path.resolve(__dirname, 'native', 'build', 'Release', 'quicktext_native.node'),
    path.resolve(__dirname, '..', 'electron', 'native', 'build', 'Release', 'quicktext_native.node'),
    path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'native', 'build', 'Release', 'quicktext_native.node'),
    path.resolve(process.resourcesPath || '', 'electron', 'native', 'build', 'Release', 'quicktext_native.node'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return ''
}

function tryLoadNativeInputCore() {
  if (nativeInputCore) return nativeInputCore

  const addonPath = resolveNativeInputCorePath()
  if (!addonPath) {
    throw new Error('Native input core binary is missing (quicktext_native.node).')
  }

  // eslint-disable-next-line global-require
  const loaded = require(addonPath)
  if (!loaded || typeof loaded.configure !== 'function' || typeof loaded.send !== 'function' || typeof loaded.events !== 'function') {
    throw new Error('Native input core is invalid.')
  }
  if (typeof loaded.init === 'function') {
    loaded.init()
  }
  nativeInputCore = loaded
  return nativeInputCore
}

function ensureInputBackendReady() {
  if (inputBackendName) return inputBackendName
  const preferred = resolvePreferredInputBackend()

  if (preferred === INPUT_BACKEND_NATIVE) {
    try {
      tryLoadNativeInputCore()
      inputBackendName = INPUT_BACKEND_NATIVE
      return inputBackendName
    } catch (error) {
      safeConsoleError('[input-backend] native unavailable:', error)
      const message = error instanceof Error ? error.message : 'Native input core failed to initialize.'
      if (INPUT_BACKEND_ENV === INPUT_BACKEND_NATIVE) {
        throw new Error(`${message} Build native core with "npm run build:native-core" or set QT_INPUT_BACKEND=python for fallback.`)
      }
      safeConsoleInfo('[input-backend] falling back to python backend.')
      inputBackendName = INPUT_BACKEND_PYTHON
      return inputBackendName
    }
  }

  inputBackendName = INPUT_BACKEND_PYTHON
  return inputBackendName
}

function isNativeInputBackendActive() {
  return ensureInputBackendReady() === INPUT_BACKEND_NATIVE
}

function toInputBridgeError(status, error, correlationId) {
  return {
    ok: false,
    status,
    error,
    correlationId,
  }
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

function parseHotkeyComboParts(combo) {
  const raw = String(combo || '').trim()
  if (!raw) return null
  const chunks = raw
    .split('+')
    .map((item) => normalizeHotkeyToken(item))
    .filter((item) => item.length > 0)

  if (!chunks.length) return null

  const modifiers = new Set()
  let key = null
  for (const chunk of chunks) {
    const token = toCanonicalModifierToken(chunk)
    if (token) {
      modifiers.add(token)
      continue
    }
    if (key) return null
    key = chunk
  }

  return { modifiers, key }
}

function toCanonicalModifierToken(token) {
  if (token === 'ctrl' || token === 'control' || token === 'cmdorctrl') return 'ctrl'
  if (token === 'shift') return 'shift'
  if (token === 'alt' || token === 'option') return 'alt'
  if (token === 'meta' || token === 'cmd' || token === 'command' || token === 'super' || token === 'win') return 'meta'
  return ''
}

function hotkeysCanConflict(a, b) {
  if (!a || !b) return false

  const sameKey = (a.key || '') === (b.key || '')
  const sameModifiers = modifiersSubsetOf(a.modifiers, b.modifiers) && modifiersSubsetOf(b.modifiers, a.modifiers)
  if (sameKey && sameModifiers) return true

  if (!a.key && !b.key) {
    return modifiersSubsetOf(a.modifiers, b.modifiers) || modifiersSubsetOf(b.modifiers, a.modifiers)
  }
  if (!a.key && b.key) {
    return modifiersSubsetOf(a.modifiers, b.modifiers)
  }
  if (a.key && !b.key) {
    return modifiersSubsetOf(b.modifiers, a.modifiers)
  }
  return false
}

function modifiersSubsetOf(left, right) {
  for (const item of left) {
    if (!right.has(item)) return false
  }
  return true
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

async function prewarmRendererRouteOnStartup(routePath, phaseLabel = 'route-prewarm') {
  if (!app.isPackaged) return
  const targetUrl = buildRendererUrl(routePath)
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, STARTUP_OVERLAY_PREWARM_TIMEOUT_MS)

  try {
    logStartupPhase(phaseLabel, `begin ${targetUrl}`)
    const response = await fetch(targetUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`${phaseLabel} failed (${response.status})`)
    }
    await response.text().catch(() => '')
    logStartupPhase(phaseLabel, `done ${Date.now() - startedAt}ms`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown')
    safeConsoleError(`[startup] ${phaseLabel} skipped:`, message)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function prewarmOverlayRouteOnStartup() {
  return prewarmRendererRouteOnStartup('/overlay', 'overlay-prewarm')
}

async function prewarmSettingsRouteOnStartup() {
  return prewarmRendererRouteOnStartup('/settings', 'settings-prewarm')
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

function detectStartupFirstLaunch() {
  try {
    return !fs.existsSync(SETTINGS_PATH)
  } catch {
    return false
  }
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
        opacity: 0;
        border: 1px solid rgba(8, 16, 28, 0);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.02) inset,
          0 14px 30px rgba(0, 0, 0, 0.2);
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-user-drag: none;
        animation: logo-fade-in 980ms cubic-bezier(0.22, 1, 0.36, 1) 140ms both;
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
      @keyframes logo-fade-in {
        0% {
          opacity: 0.06;
          filter: blur(1.8px) drop-shadow(0 16px 34px rgba(0, 0, 0, 0.18));
        }
        100% {
          opacity: 1;
          filter: blur(0) drop-shadow(0 20px 54px rgba(0, 0, 0, 0.42));
        }
      }
    </style>
  </head>
  <body>
    <div class="splash-root">
      <div class="logo-ellipse">
        <img id="qtSplashImage" alt="Quick Text Splash" draggable="false" />
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
      void setStartupSplashStep(0.66, startupFirstLaunch ? 'firstLaunchNotice' : 'preparingControls')
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

function markPythonHealth(ok) {
  const next = !!ok
  const changed = managedPythonHealthOk !== next
  managedPythonHealthAt = Date.now()
  managedPythonHealthOk = next
  if (changed && currentSettings) {
    ensureHotkeys(currentSettings)
  }
}

function getPythonBaseUrl() {
  return (process.env.PYTHON_API_BASE_URL ?? DEFAULT_PYTHON_API_BASE_URL).trim()
}

function isLocalPythonBaseUrl() {
  const base = getPythonBaseUrl()
  try {
    const parsed = new URL(base)
    const host = String(parsed.hostname || '').toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

function getPythonServiceUnavailableMessage() {
  const reason = managedPythonLastError.trim()
  if (!reason) {
    return 'Python service unavailable. Ensure bundled service executable exists or Python 3 can run `python/tool.py`.'
  }
  return `Python service unavailable. ${reason}`
}

async function pingPythonService(timeoutMs = PYTHON_HEALTHCHECK_TIMEOUT_MS) {
  const healthUrl = resolvePythonUrl('health')
  if (!healthUrl) {
    markPythonHealth(false)
    return false
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })
    const ok = response.ok
    markPythonHealth(ok)
    return ok
  } catch {
    markPythonHealth(false)
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

function resolvePythonToolScriptPath() {
  const candidates = [
    path.resolve(process.cwd(), 'python', 'tool.py'),
    path.resolve(__dirname, '..', 'python', 'tool.py'),
    path.resolve(process.resourcesPath || '', 'python', 'tool.py'),
    path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'python', 'tool.py'),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // Ignore broken candidate paths and continue.
    }
  }

  return ''
}

function resolveBundledPythonServiceExePath() {
  const explicitExe = String(process.env.QT_PYTHON_SERVICE_EXE || '').trim()
  const exeName = String(process.env.QT_PYTHON_SERVICE_EXE_NAME || DEFAULT_PYTHON_SERVICE_EXE_NAME).trim() || DEFAULT_PYTHON_SERVICE_EXE_NAME
  const candidates = []
  if (explicitExe) {
    candidates.push(path.resolve(explicitExe))
  }
  candidates.push(
    path.resolve(process.cwd(), 'build', 'python', exeName),
    path.resolve(process.cwd(), 'python', exeName),
    path.resolve(process.resourcesPath || '', 'python', exeName),
    path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'python', exeName),
  )

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // Ignore invalid candidate and continue searching.
    }
  }
  return ''
}

function getPythonLaunchPlans(scriptPath, bundledExePath = '') {
  const plans = []
  const scriptLaunchPlans = []
  if (scriptPath) {
    const explicitBinary = String(process.env.QT_PYTHON_BIN || '').trim()
    if (explicitBinary) {
      scriptLaunchPlans.push({
        command: explicitBinary,
        args: [scriptPath],
        label: explicitBinary,
        cwd: path.dirname(scriptPath),
      })
    }

    if (process.platform === 'win32') {
      scriptLaunchPlans.push(
        { command: 'py', args: ['-3', scriptPath], label: 'py -3', cwd: path.dirname(scriptPath) },
        { command: 'py', args: [scriptPath], label: 'py', cwd: path.dirname(scriptPath) },
        { command: 'python', args: [scriptPath], label: 'python', cwd: path.dirname(scriptPath) },
        { command: 'python3', args: [scriptPath], label: 'python3', cwd: path.dirname(scriptPath) },
      )
    } else {
      scriptLaunchPlans.push(
        { command: 'python3', args: [scriptPath], label: 'python3', cwd: path.dirname(scriptPath) },
        { command: 'python', args: [scriptPath], label: 'python', cwd: path.dirname(scriptPath) },
      )
    }
  }

  const bundledLaunchPlan = bundledExePath
    ? {
        command: bundledExePath,
        args: [],
        label: `bundled (${path.basename(bundledExePath)})`,
        cwd: path.dirname(bundledExePath),
      }
    : null

  const preferScriptInDev = !app.isPackaged
  if (preferScriptInDev) {
    plans.push(...scriptLaunchPlans)
    if (bundledLaunchPlan) plans.push(bundledLaunchPlan)
    return plans
  }

  if (bundledLaunchPlan) plans.push(bundledLaunchPlan)
  plans.push(...scriptLaunchPlans)
  return plans
}

async function waitForManagedPythonReady(child, spawnErrorRef) {
  const deadline = Date.now() + PYTHON_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (spawnErrorRef.error) return false
    if (child.exitCode !== null || child.killed) return false
    if (await pingPythonService()) return true
    await delayMs(280)
  }
  return false
}

function attachManagedPythonLogs(child, label) {
  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const line = String(chunk || '').trim()
      if (!line) return
      safeConsoleInfo(`[python:${label}] ${line}`)
    })
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const line = String(chunk || '').trim()
      if (!line) return
      safeConsoleError(`[python:${label}] ${line}`)
    })
  }
}

async function stopManagedPythonService() {
  const child = managedPythonProcess
  if (!child || child.killed) {
    managedPythonProcess = null
    markPythonHealth(false)
    killStrandedPythonServices()
    return
  }

  managedPythonStopping = true
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

  managedPythonProcess = null
  managedPythonStopping = false
  markPythonHealth(false)
  killStrandedPythonServices()
}

async function startManagedPythonService() {
  if (managedPythonProcess && !managedPythonProcess.killed) return true
  if (!isLocalPythonBaseUrl()) {
    managedPythonLastError = 'Auto-start is disabled for non-local PYTHON_API_BASE_URL.'
    return false
  }

  const bundledExePath = resolveBundledPythonServiceExePath()
  const scriptPath = resolvePythonToolScriptPath()
  if (!bundledExePath && !scriptPath) {
    managedPythonLastError = 'Cannot find bundled Python service executable or `python/tool.py` for auto-start.'
    return false
  }

  const launchPlans = getPythonLaunchPlans(scriptPath, bundledExePath)
  if (!launchPlans.length) {
    managedPythonLastError = 'No Python launcher candidates configured.'
    return false
  }

  for (const plan of launchPlans) {
    const spawnErrorRef = { error: null }
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd || process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    attachManagedPythonLogs(child, plan.label)
    child.once('error', (error) => {
      spawnErrorRef.error = error
    })
    child.on('exit', (code, signal) => {
      if (managedPythonProcess === child) {
        managedPythonProcess = null
        markPythonHealth(false)
      }
      if (!managedPythonStopping) {
        safeConsoleError(`[python] process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
      }
    })

    const booted = await waitForManagedPythonReady(child, spawnErrorRef)
    if (booted) {
      managedPythonProcess = child
      managedPythonLastError = ''
      managedPythonLaunchCommand = `${plan.command} ${plan.args.join(' ')}`
      markPythonHealth(true)
      safeConsoleInfo(`[python] service ready via ${managedPythonLaunchCommand}`)
      return true
    }

    managedPythonStopping = true
    try {
      child.kill()
    } catch {
      // Ignore shutdown failures for failed start attempts.
    }
    await delayMs(120)
    managedPythonStopping = false

    if (spawnErrorRef.error instanceof Error) {
      managedPythonLastError = `Failed with ${plan.label}: ${spawnErrorRef.error.message}`
    } else if (child.exitCode !== null) {
      managedPythonLastError = `Failed with ${plan.label}: exited with code ${child.exitCode}.`
    } else {
      managedPythonLastError = `Failed with ${plan.label}: startup timed out.`
    }
    safeConsoleError(`[python] ${managedPythonLastError}`)
  }

  markPythonHealth(false)
  return false
}

async function ensurePythonServiceAvailable() {
  if (managedPythonProcess && !managedPythonProcess.killed) return true

  const now = Date.now()
  if (now - managedPythonHealthAt < PYTHON_HEALTH_CACHE_MS) {
    if (managedPythonHealthOk) return true
    if (now < managedPythonRetryAfter) return false
  }

  const reachable = await pingPythonService()
  if (reachable) {
    managedPythonLastError = ''
    managedPythonLaunchCommand = ''
    return true
  }

  if (!PYTHON_AUTO_START_ENABLED) return false
  if (now < managedPythonRetryAfter) return false
  if (managedPythonBootPromise) return managedPythonBootPromise

  managedPythonBootPromise = startManagedPythonService()
    .then((ok) => {
      if (ok) {
        managedPythonRetryAfter = 0
        return true
      }
      managedPythonRetryAfter = Date.now() + PYTHON_BOOT_RETRY_COOLDOWN_MS
      return false
    })
    .finally(() => {
      managedPythonBootPromise = null
    })

  return managedPythonBootPromise
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
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) {
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

  const pythonReady = await ensurePythonServiceAvailable()
  if (!pythonReady) {
    return toPythonError(503, getPythonServiceUnavailableMessage(), correlationId)
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

    markPythonHealth(true)
    return { ok: true, correlationId }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return toPythonError(504, 'Python service timeout', correlationId)
    }

    markPythonHealth(false)

    return toPythonError(503, getPythonServiceUnavailableMessage(), correlationId)
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
    if (body.hotkey === null) {
      payload.hotkey = null
    } else {
      if (typeof body.hotkey !== 'string') return toPythonError(400, '`hotkey` must be string or null', correlationId)
      const hotkey = body.hotkey.trim()
      if (!hotkey) return toPythonError(400, '`hotkey` cannot be empty', correlationId)
      payload.hotkey = hotkey
    }
  }

  if (typeof body.overlay_toggle_hotkey !== 'undefined') {
    if (body.overlay_toggle_hotkey === null) {
      payload.overlay_toggle_hotkey = null
    } else {
      if (typeof body.overlay_toggle_hotkey !== 'string') {
        return toPythonError(400, '`overlay_toggle_hotkey` must be string or null', correlationId)
      }
      const hotkey = body.overlay_toggle_hotkey.trim()
      if (!hotkey) return toPythonError(400, '`overlay_toggle_hotkey` cannot be empty', correlationId)
      payload.overlay_toggle_hotkey = hotkey
    }
  }

  if (typeof body.main_toggle_hotkey !== 'undefined') {
    if (body.main_toggle_hotkey === null) {
      payload.main_toggle_hotkey = null
    } else {
      if (typeof body.main_toggle_hotkey !== 'string') return toPythonError(400, '`main_toggle_hotkey` must be string or null', correlationId)
      const hotkey = body.main_toggle_hotkey.trim()
      if (!hotkey) return toPythonError(400, '`main_toggle_hotkey` cannot be empty', correlationId)
      payload.main_toggle_hotkey = hotkey
    }
  }

  if (typeof body.overlay_edit_hotkey !== 'undefined') {
    if (body.overlay_edit_hotkey === null) {
      payload.overlay_edit_hotkey = null
    } else {
      if (typeof body.overlay_edit_hotkey !== 'string') return toPythonError(400, '`overlay_edit_hotkey` must be string or null', correlationId)
      const hotkey = body.overlay_edit_hotkey.trim()
      if (!hotkey) return toPythonError(400, '`overlay_edit_hotkey` cannot be empty', correlationId)
      payload.overlay_edit_hotkey = hotkey
    }
  }

  if (typeof body.app_toggle_hotkey !== 'undefined') {
    if (body.app_toggle_hotkey === null) {
      payload.app_toggle_hotkey = null
    } else {
      if (typeof body.app_toggle_hotkey !== 'string') return toPythonError(400, '`app_toggle_hotkey` must be string or null', correlationId)
      const hotkey = body.app_toggle_hotkey.trim()
      if (!hotkey) return toPythonError(400, '`app_toggle_hotkey` cannot be empty', correlationId)
      payload.app_toggle_hotkey = hotkey
    }
  }

  if (typeof body.app_enabled !== 'undefined') {
    if (typeof body.app_enabled !== 'boolean') return toPythonError(400, '`app_enabled` must be boolean', correlationId)
    payload.app_enabled = body.app_enabled
  }

  if (typeof body.block_alt_f4 !== 'undefined') {
    if (typeof body.block_alt_f4 !== 'boolean') return toPythonError(400, '`block_alt_f4` must be boolean', correlationId)
    payload.block_alt_f4 = body.block_alt_f4
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

  const pythonReady = await ensurePythonServiceAvailable()
  if (!pythonReady) {
    return toPythonError(503, getPythonServiceUnavailableMessage(), correlationId)
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

    markPythonHealth(true)
    return { ok: true, config: responseBody, correlationId }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return toPythonError(504, 'Python configure timeout', correlationId)
    }

    markPythonHealth(false)
    return toPythonError(503, getPythonServiceUnavailableMessage(), correlationId)
  }
}

function toLensSearchError(status, error, correlationId = '') {
  return {
    ok: false,
    status,
    error,
    correlationId: sanitizeCorrelationId(correlationId),
  }
}

function normalizeLensLanguage(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'en' || normalized === 'vi' || normalized === 'ko' || normalized === 'ja') return normalized
  return 'vi'
}

function normalizeLensLimit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return LENS_DEFAULT_LIMIT
  const rounded = Math.round(value)
  return Math.min(LENS_MAX_LIMIT, Math.max(1, rounded))
}

function parseDataUrlImage(input) {
  const dataUrl = typeof input === 'string' ? input.trim() : ''
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl)
  if (!match) return null
  const mimeType = String(match[1] || '').toLowerCase()
  const base64 = String(match[2] || '').trim()
  if (!mimeType || !base64) return null

  try {
    const buffer = Buffer.from(base64, 'base64')
    return { mimeType, buffer }
  } catch {
    return null
  }
}

function buildLensUploadFilename(mimeType) {
  if (mimeType.includes('png')) return 'image.png'
  if (mimeType.includes('webp')) return 'image.webp'
  if (mimeType.includes('gif')) return 'image.gif'
  if (mimeType.includes('bmp')) return 'image.bmp'
  return 'image.jpg'
}

async function buildGoogleSessionCookieHeader() {
  const sessionCandidates = []
  const defaultSession = session?.defaultSession
  if (defaultSession?.cookies) sessionCandidates.push(defaultSession)
  const googlePartitionSession = session?.fromPartition?.('persist:quicktext-google')
  if (googlePartitionSession?.cookies && googlePartitionSession !== defaultSession) {
    sessionCandidates.push(googlePartitionSession)
  }
  if (sessionCandidates.length === 0) return ''

  const merged = new Map()
  const urls = ['https://www.google.com', 'https://lens.google.com']

  for (const browserSession of sessionCandidates) {
    for (const url of urls) {
      let cookies = []
      try {
        cookies = await browserSession.cookies.get({ url })
      } catch {
        cookies = []
      }
      for (const cookie of cookies) {
        if (!cookie?.name || typeof cookie.value !== 'string') continue
        merged.set(cookie.name, cookie.value)
      }
    }
  }

  return Array.from(merged.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

async function uploadImageToGoogleLensWithSession(input) {
  const cookieHeader = await buildGoogleSessionCookieHeader()
  if (!cookieHeader) {
    throw new Error('Google session not found in app profile. Please sign in Google inside this app session.')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LENS_SEARCH_TIMEOUT_MS)
  const formData = new FormData()
  formData.append('encoded_image', new Blob([input.imageBuffer], { type: input.mimeType }), buildLensUploadFilename(input.mimeType))
  formData.append('processed_image_dimensions', '0,0')
  formData.append('image_url', '')
  formData.append('sbisrc', '')

  const url =
    `${GOOGLE_LENS_UPLOAD_BASE}?ep=gsbubb` +
    `&st=${Date.now()}` +
    `&authuser=0` +
    `&hl=${encodeURIComponent(input.language)}` +
    `&vpw=${input.viewportWidth}` +
    `&vph=${input.viewportHeight}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        cookie: cookieHeader,
        origin: GOOGLE_ORIGIN,
        referer: `${GOOGLE_ORIGIN}/`,
        'accept-language': `${input.language}-${input.language.toUpperCase()},${input.language};q=0.9,en-US;q=0.8`,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      },
    })

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Google Lens blocked this session (${response.status})`)
    }

    const location = lensParserCore.resolveLensLocation(response.headers.get('location'), GOOGLE_ORIGIN)
    if (location) return { lensUrl: location }

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Google Lens redirect missing Location (${response.status})`)
    }

    const html = await response.text()
    const htmlDerivedUrl = lensParserCore.extractLensSearchUrlFromHtml(html)
    if (!htmlDerivedUrl) {
      if (lensParserCore.detectLensChallenge(html)) {
        throw new Error('Google Lens sign-in/challenge page detected. Please verify account in web preview.')
      }
      throw new Error(`Google Lens upload failed (${response.status})`)
    }

    return { lensUrl: htmlDerivedUrl, htmlFromUpload: html }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Google Lens upload timeout')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchLensResultHtmlWithSession(lensUrl, language) {
  const cookieHeader = await buildGoogleSessionCookieHeader()
  if (!cookieHeader) {
    throw new Error('Google session not found in app profile. Please sign in Google inside this app session.')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LENS_SEARCH_TIMEOUT_MS)

  try {
    const response = await fetch(lensUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        cookie: cookieHeader,
        referer: `${GOOGLE_ORIGIN}/`,
        'accept-language': `${language}-${language.toUpperCase()},${language};q=0.9,en-US;q=0.8`,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      },
    })

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Google Lens blocked this session (${response.status})`)
    }
    if (!response.ok) {
      throw new Error(`Google Lens result fetch failed (${response.status})`)
    }
    return await response.text()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Google Lens result timeout')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function normalizeLensDiagnostics(input) {
  const source = input && typeof input === 'object' ? input : {}
  const missingBlocks = Array.isArray(source.missingBlocks) ? source.missingBlocks.filter((item) => typeof item === 'string') : []
  return {
    hasLinks: !!source.hasLinks,
    hasOcr: !!source.hasOcr,
    hasOverview: !!source.hasOverview,
    missingBlocks,
  }
}

function normalizeLensParsedPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const results = Array.isArray(source.results)
    ? source.results
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const title = typeof item.title === 'string' ? item.title.trim() : ''
          const url = typeof item.url === 'string' ? item.url.trim() : ''
          if (!title || !url) return null
          return { title, url }
        })
        .filter(Boolean)
    : []
  const overviewBullets = Array.isArray(source.overviewBullets)
    ? source.overviewBullets.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : []
  const googleTranslationBullets = Array.isArray(source.googleTranslationBullets)
    ? source.googleTranslationBullets.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : []
  return {
    results,
    extractedText: typeof source.extractedText === 'string' ? source.extractedText.trim() : '',
    aiReply: typeof source.aiReply === 'string' ? source.aiReply.trim() : '',
    translatedReply: typeof source.translatedReply === 'string' ? source.translatedReply.trim() : '',
    overviewTitle: typeof source.overviewTitle === 'string' ? source.overviewTitle.trim() : '',
    overviewBullets,
    googleTranslationBullets,
    challengeDetected: !!source.challengeDetected,
    diagnostics: normalizeLensDiagnostics(source.diagnostics),
  }
}

function mergeLensResults(limit, primary, secondary) {
  const cap = Math.max(1, Math.min(LENS_MAX_LIMIT, Number.isFinite(limit) ? Math.round(limit) : LENS_DEFAULT_LIMIT))
  const merged = []
  const seen = new Set()
  const push = (item) => {
    if (!item || typeof item !== 'object') return
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    if (!title || !url || seen.has(url) || merged.length >= cap) return
    seen.add(url)
    merged.push({ title, url })
  }

  for (const item of primary || []) push(item)
  for (const item of secondary || []) push(item)
  return merged
}

function mergeLensStringLists(primary, secondary) {
  const merged = []
  const seen = new Set()
  const append = (value) => {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    merged.push(normalized)
  }
  for (const item of primary || []) append(item)
  for (const item of secondary || []) append(item)
  return merged
}

function mergeLensParsedPayload(limit, primaryPayload, secondaryPayload, language) {
  const primary = normalizeLensParsedPayload(primaryPayload)
  const secondary = normalizeLensParsedPayload(secondaryPayload)
  const results = mergeLensResults(limit, primary.results, secondary.results)
  const overviewBullets = mergeLensStringLists(primary.overviewBullets, secondary.overviewBullets)
  const googleTranslationBullets = mergeLensStringLists(primary.googleTranslationBullets, secondary.googleTranslationBullets)
  const translatedReply =
    primary.translatedReply || secondary.translatedReply || (googleTranslationBullets.length > 0 ? googleTranslationBullets.join('\n') : '')
  const extractedText = primary.extractedText || secondary.extractedText
  const overviewTitle = primary.overviewTitle || secondary.overviewTitle
  const hasLinks = results.length > 0
  const hasOcr = !!extractedText
  const hasOverview = !!overviewTitle || overviewBullets.length > 0
  const missingBlocks = []
  if (!hasLinks) missingBlocks.push('links')
  if (!hasOcr) missingBlocks.push('ocr')
  if (!hasOverview) missingBlocks.push('ai')
  return {
    results,
    extractedText,
    overviewTitle,
    overviewBullets,
    googleTranslationBullets,
    translatedReply,
    aiReply:
      primary.aiReply ||
      secondary.aiReply ||
      lensParserCore.buildLensAiReply({
        language,
        extractedText,
        overviewTitle,
        overviewBullets,
        results,
      }),
    challengeDetected: primary.challengeDetected || secondary.challengeDetected,
    diagnostics: {
      hasLinks,
      hasOcr,
      hasOverview,
      missingBlocks,
    },
  }
}

async function loadLensResultInFallbackWindow(windowRef, lensUrl, language) {
  await new Promise((resolve, reject) => {
    let settled = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Lens fallback window load timeout'))
    }, LENS_FALLBACK_SCRAPE_TIMEOUT_MS)

    const clear = () => {
      clearTimeout(timeoutId)
      windowRef.webContents.removeListener('did-finish-load', handleDone)
      windowRef.webContents.removeListener('did-fail-load', handleFail)
    }

    const handleDone = () => {
      if (settled) return
      settled = true
      clear()
      resolve()
    }

    const handleFail = (_event, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame || settled) return
      settled = true
      clear()
      reject(new Error(`Lens fallback failed (${code}): ${description || validatedUrl || 'unknown'}`))
    }

    windowRef.webContents.once('did-finish-load', handleDone)
    windowRef.webContents.on('did-fail-load', handleFail)
    void windowRef.loadURL(lensUrl, {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      extraHeaders: `accept-language: ${language}-${language.toUpperCase()},${language};q=0.9,en-US;q=0.8\n`,
    })
  })
}

async function scrapeLensResultViaWebviewFallback(lensUrl, language, limit) {
  let fallbackWindow = null
  const startedAt = Date.now()
  let bestParsed = null
  try {
    fallbackWindow = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      width: 1000,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:quicktext-google',
      },
    })

    await loadLensResultInFallbackWindow(fallbackWindow, lensUrl, language)

    while (Date.now() - startedAt < LENS_FALLBACK_SCRAPE_TIMEOUT_MS) {
      const html = await fallbackWindow.webContents.executeJavaScript(
        'document.documentElement ? document.documentElement.outerHTML : ""',
        true,
      )
      const parsed = normalizeLensParsedPayload(
        lensParserCore.parseLensHtmlStructured(html, {
          language,
          limit,
          googleOrigin: GOOGLE_ORIGIN,
        }),
      )
      bestParsed = parsed
      const shouldFallback = lensParserCore.shouldTriggerLensFallback(parsed)
      if (!shouldFallback || parsed.challengeDetected) break
      await sleep(LENS_FALLBACK_SCRAPE_POLL_MS)
    }

    return {
      parsed: bestParsed || normalizeLensParsedPayload({}),
      durationMs: Date.now() - startedAt,
    }
  } finally {
    if (fallbackWindow && !fallbackWindow.isDestroyed()) {
      fallbackWindow.destroy()
    }
  }
}

async function handleLensSearchImage(rawPayload) {
  const correlationId = nextCorrelationId('lens-search')
  if (!isObjectPayload(rawPayload)) {
    return toLensSearchError(400, 'Payload must be a JSON object', correlationId)
  }

  const imageDataUrl = typeof rawPayload.imageDataUrl === 'string' ? rawPayload.imageDataUrl.trim() : ''
  if (!imageDataUrl) return toLensSearchError(400, '`imageDataUrl` is required', correlationId)

  const image = parseDataUrlImage(imageDataUrl)
  if (!image) return toLensSearchError(400, 'Invalid image data URL', correlationId)
  if (image.buffer.length <= 0) return toLensSearchError(400, 'Image payload is empty', correlationId)
  if (image.buffer.length > LENS_MAX_IMAGE_BYTES) {
    return toLensSearchError(400, `Image too large (max ${LENS_MAX_IMAGE_BYTES} bytes)`, correlationId)
  }

  const language = normalizeLensLanguage(rawPayload.hl)
  const viewportWidth = clampInt(rawPayload.vpw, 320, 8192, 1209)
  const viewportHeight = clampInt(rawPayload.vph, 240, 8192, 1229)
  const limit = normalizeLensLimit(rawPayload.limit)

  try {
    const upload = await uploadImageToGoogleLensWithSession({
      imageBuffer: image.buffer,
      mimeType: image.mimeType,
      language,
      viewportWidth,
      viewportHeight,
    })

    const html = upload.htmlFromUpload || (await fetchLensResultHtmlWithSession(upload.lensUrl, language))
    const parsedHttp = normalizeLensParsedPayload(
      lensParserCore.parseLensHtmlStructured(html, {
        language,
        limit,
        googleOrigin: GOOGLE_ORIGIN,
      }),
    )
    const fallbackReasons = []
    if (parsedHttp.challengeDetected) fallbackReasons.push('challenge')
    if (lensParserCore.shouldTriggerLensFallback(parsedHttp)) fallbackReasons.push('missing-blocks')

    let merged = parsedHttp
    let parserSource = 'http'
    let fallbackUsed = false
    let fallbackDiagnostics = null

    if (fallbackReasons.length > 0) {
      fallbackUsed = true
      try {
        const fallback = await scrapeLensResultViaWebviewFallback(upload.lensUrl, language, limit)
        const parsedFallback = normalizeLensParsedPayload(fallback.parsed)
        const primaryHasAny =
          parsedHttp.results.length > 0 ||
          !!parsedHttp.extractedText ||
          !!parsedHttp.overviewTitle ||
          parsedHttp.overviewBullets.length > 0
        const fallbackHasAny =
          parsedFallback.results.length > 0 ||
          !!parsedFallback.extractedText ||
          !!parsedFallback.overviewTitle ||
          parsedFallback.overviewBullets.length > 0

        if (fallbackHasAny && !primaryHasAny) parserSource = 'webview'
        else if (fallbackHasAny && primaryHasAny) parserSource = 'merged'

        merged = mergeLensParsedPayload(limit, parsedHttp, parsedFallback, language)
        fallbackDiagnostics = {
          durationMs: fallback.durationMs,
          diagnostics: parsedFallback.diagnostics,
          challengeDetected: parsedFallback.challengeDetected,
        }
      } catch (fallbackError) {
        fallbackDiagnostics = {
          error: fallbackError instanceof Error ? fallbackError.message : 'Lens fallback scrape failed',
        }
      }
    }

    if (!merged.results.length && !merged.extractedText && !merged.aiReply && !merged.overviewTitle && !merged.overviewBullets.length) {
      return toLensSearchError(502, 'Google Lens returned no parseable result', correlationId)
    }

    return {
      ok: true,
      lensUrl: upload.lensUrl,
      results: merged.results,
      extractedText: merged.extractedText || '',
      aiReply: merged.aiReply || '',
      translatedReply: merged.translatedReply || '',
      overviewTitle: merged.overviewTitle || '',
      overviewBullets: merged.overviewBullets,
      googleTranslationBullets: merged.googleTranslationBullets,
      parserSource,
      fallbackUsed,
      diagnostics: {
        fallbackReasons,
        http: parsedHttp.diagnostics,
        fallback: fallbackDiagnostics,
        merged: merged.diagnostics,
      },
      correlationId,
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim() ? error.message.trim() : 'Google Lens search failed'
    return toLensSearchError(502, message, correlationId)
  }
}

function getSelectedTextFromSettings(settings) {
  if (!settings || !Array.isArray(settings.items) || settings.items.length === 0) return ''
  const rawIndex = Number(settings.selectedIndex)
  const safeIndex = Number.isFinite(rawIndex) ? Math.max(0, Math.min(settings.items.length - 1, Math.floor(rawIndex))) : 0
  const selected = settings.items[safeIndex]
  if (!selected || typeof selected !== 'object') return ''
  return typeof selected.text === 'string' ? selected.text : ''
}

async function syncInputRuntimeForSettings(settings, reason = 'settings-sync') {
  if (!settings || typeof settings !== 'object') return

  const backend = resolveInputBackendForRuntime()
  if (backend === INPUT_BACKEND_PYTHON) {
    managedPythonRetryAfter = 0
    const ready = await ensurePythonServiceAvailable()
    if (!ready) {
      safeConsoleError(`[input-sync:${reason}] python backend unavailable`)
      return
    }
  }

  const useElectronHotkeyRuntime = shouldUseElectronHotkeyFallback()
  const payload = {
    text: getSelectedTextFromSettings(settings),
    hotkey: useElectronHotkeyRuntime ? null : settings.sendHotkey,
    // App toggle, and packaged hotkeys generally, are handled in Electron for reliability.
    app_toggle_hotkey: null,
    block_alt_f4: !!settings.blockAltF4WhenEnabled,
    app_enabled: !!settings.appEnabled,
    overlay_toggle_hotkey: useElectronHotkeyRuntime ? null : settings.overlayToggleHotkey,
    main_toggle_hotkey: useElectronHotkeyRuntime ? null : settings.mainToggleHotkey,
    overlay_edit_hotkey: useElectronHotkeyRuntime ? null : settings.overlayEditHotkey,
    press_enter: false,
  }
  const result = await handleInputConfigure(payload)
  if (!result || result.ok !== true) {
    const errorMessage = typeof result?.error === 'string' ? result.error : 'unknown configure error'
    safeConsoleError(`[input-sync:${reason}] configure failed: ${errorMessage}`)
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

function resolveInputBackendForRuntime() {
  return ensureInputBackendReady()
}

async function handleNativeSend(rawPayload) {
  const correlationId = nextCorrelationId('native-send')
  if (!isObjectPayload(rawPayload)) {
    return toInputBridgeError(400, 'Payload must be a JSON object', correlationId)
  }

  const body = rawPayload
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) {
    return toInputBridgeError(400, '`text` is required', correlationId)
  }

  let delayRange
  if (typeof body.delay_range !== 'undefined') {
    try {
      delayRange = parsePythonDelayRange(body.delay_range)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid `delay_range`'
      return toInputBridgeError(400, message, correlationId)
    }
  }

  let pressEnter = false
  if (typeof body.press_enter !== 'undefined') {
    if (typeof body.press_enter !== 'boolean') {
      return toInputBridgeError(400, '`press_enter` must be boolean', correlationId)
    }
    pressEnter = body.press_enter
  }

  try {
    ensureInputBackendReady()
    const core = tryLoadNativeInputCore()
    const payload = { text, press_enter: pressEnter }
    if (delayRange) payload.delay_range = delayRange
    core.send(payload)
    return { ok: true, correlationId }
  } catch (error) {
    return toInputBridgeError(503, error instanceof Error ? error.message : 'Native input send failed', correlationId)
  }
}

async function handleNativeConfigure(rawPayload) {
  const correlationId = nextCorrelationId('native-config')
  if (!isObjectPayload(rawPayload)) {
    return toInputBridgeError(400, 'Payload must be a JSON object', correlationId)
  }

  const body = rawPayload
  const payload = {}

  if (typeof body.text !== 'undefined') {
    if (typeof body.text !== 'string') return toInputBridgeError(400, '`text` must be string', correlationId)
    payload.text = body.text
  }

  const parseNullableHotkey = (fieldName) => {
    if (!Object.prototype.hasOwnProperty.call(body, fieldName)) return undefined
    const value = body[fieldName]
    if (value === null) return null
    if (typeof value !== 'string') {
      throw new Error(`\`${fieldName}\` must be string or null`)
    }
    const trimmed = value.trim()
    if (!trimmed) {
      throw new Error(`\`${fieldName}\` cannot be empty`)
    }
    return trimmed
  }

  try {
    const sendHotkey = parseNullableHotkey('hotkey')
    if (typeof sendHotkey !== 'undefined') payload.hotkey = sendHotkey
    const appToggle = parseNullableHotkey('app_toggle_hotkey')
    if (typeof appToggle !== 'undefined') payload.app_toggle_hotkey = appToggle
    const overlayToggle = parseNullableHotkey('overlay_toggle_hotkey')
    if (typeof overlayToggle !== 'undefined') payload.overlay_toggle_hotkey = overlayToggle
    const mainToggle = parseNullableHotkey('main_toggle_hotkey')
    if (typeof mainToggle !== 'undefined') payload.main_toggle_hotkey = mainToggle
    const overlayEdit = parseNullableHotkey('overlay_edit_hotkey')
    if (typeof overlayEdit !== 'undefined') payload.overlay_edit_hotkey = overlayEdit
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid hotkey payload'
    return toInputBridgeError(400, message, correlationId)
  }

  if (typeof body.app_enabled !== 'undefined') {
    if (typeof body.app_enabled !== 'boolean') return toInputBridgeError(400, '`app_enabled` must be boolean', correlationId)
    payload.app_enabled = body.app_enabled
  }

  if (typeof body.block_alt_f4 !== 'undefined') {
    if (typeof body.block_alt_f4 !== 'boolean') return toInputBridgeError(400, '`block_alt_f4` must be boolean', correlationId)
    payload.block_alt_f4 = body.block_alt_f4
  }

  if (typeof body.press_enter !== 'undefined') {
    if (typeof body.press_enter !== 'boolean') return toInputBridgeError(400, '`press_enter` must be boolean', correlationId)
    payload.press_enter = body.press_enter
  }

  if (typeof body.delay_range !== 'undefined') {
    try {
      payload.delay_range = parsePythonDelayRange(body.delay_range)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid `delay_range`'
      return toInputBridgeError(400, message, correlationId)
    }
  }

  if (Object.keys(payload).length === 0) {
    return { ok: true, skipped: true, correlationId }
  }

  try {
    ensureInputBackendReady()
    const core = tryLoadNativeInputCore()
    const config = core.configure(payload)
    return { ok: true, config, correlationId }
  } catch (error) {
    return toInputBridgeError(503, error instanceof Error ? error.message : 'Native input configure failed', correlationId)
  }
}

async function handleNativeEvents(rawAfter) {
  const correlationId = nextCorrelationId('native-events')
  const after = parseInputAfter(rawAfter)
  if (after === null) {
    return { ok: false, error: '`after` must be a non-negative integer', correlationId }
  }

  try {
    ensureInputBackendReady()
    const core = tryLoadNativeInputCore()
    const result = core.events(after)
    const events = Array.isArray(result?.events) ? result.events : []
    const lastId =
      typeof result?.last_id === 'number' && Number.isInteger(result.last_id) ? result.last_id : after
    return {
      ok: true,
      events,
      last_id: lastId,
      correlationId,
    }
  } catch (error) {
    return {
      ok: true,
      events: [],
      last_id: after,
      degraded: true,
      error: error instanceof Error ? error.message : 'Native input events unavailable',
      correlationId,
    }
  }
}

async function handleInputSend(rawPayload) {
  if (resolveInputBackendForRuntime() === INPUT_BACKEND_NATIVE) {
    return handleNativeSend(rawPayload)
  }
  return handlePythonSend(rawPayload)
}

async function handleInputConfigure(rawPayload) {
  if (resolveInputBackendForRuntime() === INPUT_BACKEND_NATIVE) {
    return handleNativeConfigure(rawPayload)
  }
  return handlePythonConfigure(rawPayload)
}

async function handleInputEvents(rawAfter) {
  if (resolveInputBackendForRuntime() === INPUT_BACKEND_NATIVE) {
    return handleNativeEvents(rawAfter)
  }
  return handlePythonEvents(rawAfter)
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

  const pythonReady = await ensurePythonServiceAvailable()
  if (!pythonReady) {
    return {
      ok: true,
      events: [],
      last_id: after,
      degraded: true,
      error: getPythonServiceUnavailableMessage(),
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

    markPythonHealth(true)
    return {
      ok: true,
      events: Array.isArray(responseBody.events) ? responseBody.events : [],
      last_id: typeof responseBody.last_id === 'number' ? responseBody.last_id : after,
      correlationId,
    }
  } catch (error) {
    markPythonHealth(false)
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

  windowRef.webContents.setWindowOpenHandler((details) => {
    safeConsoleError(`[window:${windowName}] blocked window.open: ${details?.url || 'unknown'}`)
    return { action: 'deny' }
  })

  windowRef.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) return
    event.preventDefault()
    safeConsoleError(`[window:${windowName}] blocked navigation: ${url || 'unknown'}`)
  })

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

  // Surface renderer-side exceptions to terminal so we can diagnose client crashes quickly.
  windowRef.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (typeof message !== 'string' || message.length === 0) return
    if (level < 3 && !/error|exception|failed|unhandled/i.test(message)) return
    safeConsoleError(`[window:${windowName}] renderer console(level=${level}) ${sourceId || '<unknown>'}:${line || 0} ${message}`)
  })

  windowRef.webContents.on('preload-error', (_event, preloadPath, error) => {
    safeConsoleError(`[window:${windowName}] preload error (${preloadPath || 'unknown'}):`, error)
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
    fullscreenable: false,
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

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input?.key || '').toLowerCase()
    const code = String(input?.code || '').toLowerCase()
    const ctrlOrMeta = !!input?.control || !!input?.meta
    const alt = !!input?.alt
    const shift = !!input?.shift

    const blocked =
      key === 'f11' ||
      key === 'f12' ||
      key === 'f5' ||
      key === 'browserback' ||
      key === 'browserforward' ||
      (alt && (key === 'arrowleft' || key === 'arrowright' || key === 'left' || key === 'right')) ||
      (ctrlOrMeta &&
        (key === 'r' ||
          key === 'w' ||
          key === 'q' ||
          key === 'l' ||
          key === 'p' ||
          key === 's' ||
          key === 'o' ||
          key === 'n' ||
          key === 't' ||
          key === 'u' ||
          key === '0' ||
          key === '=' ||
          key === '+' ||
          key === '-' ||
          code === 'equal' ||
          code === 'minus' ||
          (shift && (key === 'i' || key === 'j' || key === 'c'))))

    if (blocked) {
      event.preventDefault()
    }
  })

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
      webviewTag: true,
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
    syncOverlaySmartZoneMonitor()
  })

  overlayWindow.on('hide', () => {
    logOverlayLifecycle('hide')
    syncOverlaySmartZoneMonitor()
  })

  overlayWindow.on('closed', () => {
    overlayLifecycleStats.closeCount += 1
    logOverlayLifecycle('closed')
    overlayBoundsSignature = ''
    clearOverlaySmartZoneMonitor()
    overlayInteractiveZones = {
      quickAdd: null,
    }
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

function createSettingsWindow(options = {}) {
  const autoShow = options.autoShow !== false
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) {
    if (autoShow) {
      settingsWindowAutoShowOnReady = true
    }
    return hotkeyWindow
  }

  settingsWindowAutoShowOnReady = autoShow

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
    skipTaskbar: true,
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
      if (!settingsWindowAutoShowOnReady) return
      syncSettingsWindowBounds()
      hotkeyWindow.show()
      hotkeyWindow.focus()
    }
  })

  hotkeyWindow.on('closed', () => {
    clearSettingsWindowSyncTimer()
    settingsWindowRestorePending = false
    suppressSettingsBlurClose = false
    settingsWindowAutoShowOnReady = false
    hotkeyWindow = null
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.focus()
    }
  })

  return hotkeyWindow
}

async function prewarmSettingsWindowOnStartup(timeoutMs = STARTUP_OVERLAY_PREWARM_TIMEOUT_MS) {
  if (isQuitting) return
  const window = createSettingsWindow({ autoShow: false })
  if (!window || window.isDestroyed()) return
  const webContents = window.webContents
  if (!webContents || webContents.isDestroyed()) return
  if (!webContents.isLoadingMainFrame()) return

  logStartupPhase('settings-window-prewarm', 'begin')
  await new Promise((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const timeoutId = setTimeout(() => {
      settle()
    }, Math.max(1200, Math.floor(timeoutMs || 0)))

    webContents.once('did-finish-load', () => {
      clearTimeout(timeoutId)
      settle()
    })
    webContents.once('did-fail-load', () => {
      clearTimeout(timeoutId)
      settle()
    })
    window.once('closed', () => {
      clearTimeout(timeoutId)
      settle()
    })
  })
  logStartupPhase('settings-window-prewarm', 'done')
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
  hotkeyWindow.setSkipTaskbar(true)
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
  syncOverlaySmartZoneMonitor()
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

  const isInteractive = !!interactive

  if (isInteractive) {
    overlayMousePassThrough = false
  }

  const passThrough = isInteractive ? false : !!overlayMousePassThrough
  overlayWindow.setIgnoreMouseEvents(passThrough, { forward: passThrough })
  if (typeof overlayWindow.setSkipTaskbar === 'function') {
    overlayWindow.setSkipTaskbar(true)
  }
  const canTakeFocus = isInteractive || !passThrough
  if (typeof overlayWindow.setFocusable === 'function') {
    overlayWindow.setFocusable(canTakeFocus)
  }
  if (isInteractive) {
    try {
      if (!overlayWindow.isFocused()) {
        overlayWindow.focus()
      }
      overlayWindow.webContents.focus()
    } catch {
      // Ignore focus handoff errors to keep overlay runtime stable.
    }
  } else if (passThrough) {
    try {
      overlayWindow.blur()
    } catch {
      // Ignore blur failures on some Windows focus contexts.
    }
  }
  syncOverlaySmartZoneMonitor()
}

function setOverlayMousePassThrough(passThrough) {
  const settings = ensureSettings()
  if (settings.overlayInteractive) {
    overlayMousePassThrough = false
    applyOverlayInteraction(settings.overlayInteractive)
    return false
  }

  const nextPassThrough = !!passThrough
  if (overlayMousePassThrough === nextPassThrough) {
    return overlayMousePassThrough
  }
  overlayMousePassThrough = nextPassThrough
  applyOverlayInteraction(settings.overlayInteractive)
  return overlayMousePassThrough
}

function clearOverlaySmartZoneMonitor() {
  if (!overlaySmartZonePollTimer) return
  clearInterval(overlaySmartZonePollTimer)
  overlaySmartZonePollTimer = null
  overlaySmartZoneInsideLast = false
}

function normalizeOverlayInteractiveZones(input) {
  const source = input && typeof input === 'object' ? input : {}
  const normalizeRect = (value) => {
    if (!value || typeof value !== 'object') return null
    const x = Number(value.x)
    const y = Number(value.y)
    const width = Number(value.width)
    const height = Number(value.height)
    const enabled = value.enabled !== false
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null
    if (!enabled || width <= 2 || height <= 2) return null
    return {
      x,
      y,
      width,
      height,
    }
  }

  return {
    quickAdd: normalizeRect(source.quickAdd),
  }
}

function getQuickAddFallbackZone(settings) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null
  const bounds = overlayWindow.getBounds()
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) return null

  const width = Math.round(
    Math.min(OVERLAY_QUICK_ADD_MAX_WIDTH, Math.max(OVERLAY_QUICK_ADD_MIN_WIDTH, bounds.width - OVERLAY_QUICK_ADD_GUTTER * 2)),
  )
  const maxX = Math.max(OVERLAY_QUICK_ADD_GUTTER, bounds.width - width - OVERLAY_QUICK_ADD_GUTTER)
  const maxY = Math.max(OVERLAY_QUICK_ADD_GUTTER, bounds.height - OVERLAY_QUICK_ADD_HEIGHT - OVERLAY_QUICK_ADD_GUTTER)
  const rawX = Number.isFinite(settings?.overlayQuickAddX) ? settings.overlayQuickAddX : 40
  const rawY = Number.isFinite(settings?.overlayQuickAddY) ? settings.overlayQuickAddY : 86
  const x = Math.round(Math.min(maxX, Math.max(OVERLAY_QUICK_ADD_GUTTER, rawX)))
  const y = Math.round(Math.min(maxY, Math.max(OVERLAY_QUICK_ADD_GUTTER, rawY)))
  return {
    x,
    y,
    width,
    height: OVERLAY_QUICK_ADD_HEIGHT,
  }
}

function isCursorInsideOverlayInteractiveZones() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  if (!overlayWindow.isVisible()) return false
  const settings = ensureSettings()
  const quickAdd = overlayInteractiveZones.quickAdd || getQuickAddFallbackZone(settings)
  if (!quickAdd) return false

  const cursor = screen.getCursorScreenPoint()
  const overlayBounds = overlayWindow.getBounds()
  const localX = cursor.x - overlayBounds.x
  const localY = cursor.y - overlayBounds.y

  return (
    localX >= quickAdd.x &&
    localX <= quickAdd.x + quickAdd.width &&
    localY >= quickAdd.y &&
    localY <= quickAdd.y + quickAdd.height
  )
}

function evaluateOverlaySmartZonePassThrough() {
  const settings = ensureSettings()
  if (!settings.overlaySmartClickThrough && !overlayInteractiveZones.quickAdd) return
  if (settings.overlayInteractive) return
  if (!settings.appEnabled || !settings.overlayVisible) return
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return

  const inside = isCursorInsideOverlayInteractiveZones()
  if (inside === overlaySmartZoneInsideLast) return
  overlaySmartZoneInsideLast = inside
  setOverlayMousePassThrough(!inside)
}

function syncOverlaySmartZoneMonitor() {
  clearOverlaySmartZoneMonitor()
  const settings = ensureSettings()
  if (settings.overlayInteractive) return
  if (!settings.appEnabled || !settings.overlayVisible) return
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return
  if (!settings.overlaySmartClickThrough && !overlayInteractiveZones.quickAdd) return

  evaluateOverlaySmartZonePassThrough()
  overlaySmartZonePollTimer = setInterval(() => {
    evaluateOverlaySmartZonePassThrough()
  }, 80)
}

function setOverlayInteractiveZones(payload) {
  overlayInteractiveZones = normalizeOverlayInteractiveZones(payload)
  overlaySmartZoneInsideLast = false
  syncOverlaySmartZoneMonitor()
  evaluateOverlaySmartZonePassThrough()
  return true
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

function shouldUseElectronHotkeyFallback() {
  if (FORCE_ELECTRON_HOTKEY_FALLBACK) return true
  if (app.isPackaged && !DISABLE_PACKAGED_ELECTRON_HOTKEY_FALLBACK) return true
  // If python backend is selected but service is down, keep hotkeys alive via Electron fallback.
  const backend = inputBackendName || resolvePreferredInputBackend()
  return backend === INPUT_BACKEND_PYTHON && !managedPythonHealthOk
}

function unregisterElectronHotkeys() {
  if (!electronHotkeyRegistrations.length) {
    electronHotkeyLastTriggeredAt.clear()
    return
  }
  for (const combo of electronHotkeyRegistrations) {
    try {
      globalShortcut.unregister(combo)
    } catch {
      // Ignore shortcut teardown errors while re-registering.
    }
  }
  electronHotkeyRegistrations = []
  electronHotkeyLastTriggeredAt.clear()
}

function unregisterStandaloneAppToggleHotkey() {
  if (!standaloneAppToggleHotkeyRegistration) return
  try {
    globalShortcut.unregister(standaloneAppToggleHotkeyRegistration)
  } catch {
    // Ignore shortcut teardown errors while exiting/re-registering.
  }
  standaloneAppToggleHotkeyRegistration = ''
}

function unregisterAltF4BlockShortcut() {
  if (!altF4BlockShortcutRegistered) return
  try {
    globalShortcut.unregister('Alt+F4')
  } catch {
    // Ignore teardown errors while exiting/re-registering.
  }
  altF4BlockShortcutRegistered = false
}

function syncAltF4BlockShortcut(settings) {
  const shouldBlock = !!settings?.appEnabled && !!settings?.blockAltF4WhenEnabled
  if (!shouldBlock) {
    unregisterAltF4BlockShortcut()
    return
  }

  if (altF4BlockShortcutRegistered) return

  try {
    const ok = globalShortcut.register('Alt+F4', () => {})
    if (ok) {
      altF4BlockShortcutRegistered = true
      return
    }
    safeConsoleError('[hotkey:alt-f4] register failed')
  } catch (error) {
    safeConsoleError('[hotkey:alt-f4] register error', error)
  }
}

function syncStandaloneAppToggleHotkey(settings) {
  if (shouldUseElectronHotkeyFallback()) {
    unregisterStandaloneAppToggleHotkey()
    return
  }

  const combo = typeof settings?.appToggleHotkey === 'string' ? settings.appToggleHotkey.trim() : ''
  if (!combo) {
    unregisterStandaloneAppToggleHotkey()
    return
  }
  if (combo === standaloneAppToggleHotkeyRegistration) return

  unregisterStandaloneAppToggleHotkey()
  try {
    const ok = globalShortcut.register(combo, () => {
      handleElectronHotkeyAction('app.toggle_enabled')
    })
    if (ok) {
      standaloneAppToggleHotkeyRegistration = combo
      return
    }
    safeConsoleError(`[hotkey:app-toggle] register failed: ${combo}`)
  } catch (error) {
    safeConsoleError(`[hotkey:app-toggle] invalid shortcut: ${combo}`, error)
  }
}

function shouldSuppressElectronHotkeyAction(actionId) {
  const now = Date.now()
  const key = String(actionId || '').trim() || 'unknown'
  const debounceMs =
    key === 'app.toggle_enabled' ||
    key === 'overlay.toggle_visibility' ||
    key === 'main.toggle_visibility' ||
    key === 'overlay.toggle_interaction'
      ? ELECTRON_HOTKEY_TOGGLE_DEBOUNCE_MS
      : ELECTRON_HOTKEY_ACTION_DEBOUNCE_MS
  const lastAt = Number(electronHotkeyLastTriggeredAt.get(key) || 0)
  if (now - lastAt < debounceMs) {
    return true
  }
  electronHotkeyLastTriggeredAt.set(key, now)
  return false
}

function applyAppToggleHotkeyAction() {
  const settings = ensureSettings()
  const nextEnabled = !settings.appEnabled
  settings.appEnabled = nextEnabled
  settings.overlayInteractive = false
  settings.overlayVisible = nextEnabled

  if (!nextEnabled) {
    overlayMousePassThrough = true
  }

  void saveSettings(settings)

  if (nextEnabled) {
    ensureOverlayWindowForCurrentSettings()
  }

  applySettingsToWindows(settings)
  if (!nextEnabled) {
    clearOverlayBootTimer()
    applyOverlayVisibility(false)
    maybeTearDownOverlayWindow(settings)
  }
  ensureHotkeys(settings)
  void syncInputRuntimeForSettings(settings, 'app-toggle-hotkey')
  broadcastSettings()
  refreshTrayMenu()
}

async function triggerSendHotkeyAction() {
  const settings = ensureSettings()
  if (!settings.appEnabled) return
  const text = getSelectedTextFromSettings(settings)
  if (!text.trim()) return

  const startedAt = performance.now()
  const result = await handleInputSend({ text })
  const latencyMs = Math.max(0, performance.now() - startedAt)
  if (result?.ok === true) {
    recordSendTelemetry({
      success: true,
      latencyMs,
      correlationId: result.correlationId,
    })
    return
  }

  const message = typeof result?.error === 'string' && result.error.trim() ? result.error.trim() : 'Electron hotkey send failed'
  recordSendTelemetry({
    success: false,
    latencyMs,
    error: message,
    correlationId: result?.correlationId,
  })
  recordHotkeyError({
    source: 'electron-hotkey',
    message,
    correlationId: result?.correlationId,
  })
}

function handleElectronHotkeyAction(actionId) {
  if (shouldSuppressElectronHotkeyAction(actionId)) return
  try {
    if (actionId === 'app.toggle_enabled') {
      applyAppToggleHotkeyAction()
      return
    }
    const settings = ensureSettings()
    if (!settings.appEnabled) return
    if (actionId === 'overlay.toggle_visibility') {
      toggleOverlayVisibility()
      return
    }
    if (actionId === 'main.toggle_visibility') {
      toggleMainWindowVisibility()
      return
    }
    if (actionId === 'overlay.toggle_interaction') {
      toggleOverlayInteraction()
      return
    }
    if (actionId === 'text.send_current') {
      void triggerSendHotkeyAction()
    }
    if (actionId === 'overlay.paste_image') {
      try {
        const image = clipboard.readImage()
        if (image && !image.isEmpty()) {
          const dataUrl = image.toDataURL()
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('paste-image', dataUrl)
          }
        }
      } catch (error) {
        safeConsoleError('[hotkey:paste-image] failed:', error)
      }
    }
  } catch (error) {
    safeConsoleError('[hotkey:fallback] action failed:', actionId, error)
  }
}

function registerElectronHotkey(combo, actionId) {
  if (typeof combo !== 'string' || !combo.trim()) return
  try {
    const ok = globalShortcut.register(combo, () => {
      handleElectronHotkeyAction(actionId)
    })
    if (ok) {
      electronHotkeyRegistrations.push(combo)
      return
    }
    safeConsoleError(`[hotkey:fallback] register failed: ${actionId} => ${combo}`)
  } catch (error) {
    safeConsoleError(`[hotkey:fallback] invalid shortcut: ${actionId} => ${combo}`, error)
  }
}

function syncElectronHotkeys(settings) {
  if (!shouldUseElectronHotkeyFallback()) {
    unregisterElectronHotkeys()
    return
  }

  unregisterElectronHotkeys()

  const registrationPlan =
    settings.appEnabled === false
      ? [['app.toggle_enabled', settings.appToggleHotkey]]
      : [
          ['app.toggle_enabled', settings.appToggleHotkey],
          ['overlay.toggle_visibility', settings.overlayToggleHotkey],
          ['main.toggle_visibility', settings.mainToggleHotkey],
          ['overlay.toggle_interaction', settings.overlayEditHotkey],
          ['text.send_current', settings.sendHotkey],
        ]

  // Add paste image hotkey if overlay is visible and image tool is enabled
  if (settings.appEnabled && settings.overlayVisible && settings.overlayToolsShowImageTranslate) {
    registrationPlan.push(['overlay.paste_image', 'Ctrl+V'])
  }

  for (const [actionId, combo] of registrationPlan) {
    registerElectronHotkey(combo, actionId)
  }
}

function hotkeySignatureValue(value) {
  if (value === null) return 'none'
  if (typeof value !== 'string') return ''
  return value
}

function ensureHotkeys(settings) {
  syncAltF4BlockShortcut(settings)
  syncStandaloneAppToggleHotkey(settings)
  const fallbackState = shouldUseElectronHotkeyFallback() ? '1' : '0'
  const nextSignature = `${fallbackState}|${settings.appEnabled ? '1' : '0'}|${hotkeySignatureValue(settings.appToggleHotkey)}|${hotkeySignatureValue(settings.overlayToggleHotkey)}|${hotkeySignatureValue(settings.mainToggleHotkey)}|${hotkeySignatureValue(settings.overlayEditHotkey)}|${hotkeySignatureValue(settings.sendHotkey)}`
  if (nextSignature === hotkeySignature) {
    if (electronHotkeyRegistrations.length === 0 && shouldUseElectronHotkeyFallback()) {
      syncElectronHotkeys(settings)
    }
    return
  }
  hotkeySignature = nextSignature
  syncElectronHotkeys(settings)
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
    settings.overlayToolsPanelVisible = true
    settings.overlayToolsActiveTab = 'image'
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
  hideTrayMenuWindow()
  mainWindow.hide()
  refreshTrayMenu()
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  hideTrayMenuWindow()
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

function setWindowMode(mode) {
  const targetMode = mode === 'overlay' ? 'overlay' : 'manager'
  const settings = ensureSettings()

  if (targetMode === 'overlay') {
    settings.appEnabled = true
    settings.overlayVisible = true
    ensureOverlayWindowForCurrentSettings()
    applyOverlayWindowSettings(settings)
    applyOverlayVisibility(true)
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide()
    }
  } else {
    settings.overlayVisible = false
    clearOverlayBootTimer()
    applyOverlayWindowSettings(settings)
    applyOverlayVisibility(false)
    maybeTearDownOverlayWindow(settings)
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  }

  void saveSettings(settings)
  ensureHotkeys(settings)
  void syncInputRuntimeForSettings(settings, 'window-mode')
  broadcastSettings()
  refreshTrayMenu()
  return settings
}

function showSettingsWindow(options = {}) {
  const focusWindow = options.focus !== false
  hideTrayMenuWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
  }
  const window = createSettingsWindow({ autoShow: true })
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
  hideTrayMenuWindow()
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
  hideTrayMenuWindow()
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
  showOverlayImageWindow({ tab: 'settings' })
}

function closeOverlaySettingsWindow() {
  closeOverlayImageWindow()
}

function normalizeOverlayToolsTab(tab) {
  if (tab === 'settings') return 'settings'
  return tab === 'text' || tab === 'texts' ? 'text' : 'image'
}

function buildOverlayToolsUrl(tab) {
  const normalizedTab = normalizeOverlayToolsTab(tab)
  return buildRendererUrl(`/overlay-image?tab=${normalizedTab}`)
}

function getOverlayImageWindowBounds() {
  const referencePoint =
    mainWindow && !mainWindow.isDestroyed()
      ? {
          x: Math.round(mainWindow.getBounds().x + mainWindow.getBounds().width / 2),
          y: Math.round(mainWindow.getBounds().y + mainWindow.getBounds().height / 2),
        }
      : screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(referencePoint)
  const workArea = display?.workArea || { x: 0, y: 0, width: 1280, height: 720 }
  const width = Math.min(OVERLAY_IMAGE_WINDOW_WIDTH, Math.max(560, workArea.width - 16))
  const height = Math.min(OVERLAY_IMAGE_WINDOW_HEIGHT, Math.max(620, workArea.height - 16))
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = Math.round(workArea.y + (workArea.height - height) / 2)
  return { x, y, width, height }
}

function createOverlayImageWindow() {
  if (overlayImageWindow && !overlayImageWindow.isDestroyed()) return overlayImageWindow

  const bounds = getOverlayImageWindowBounds()
  overlayImageWindow = new BrowserWindow({
    title: `${APP_DISPLAY_NAME} Overlay Tools`,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 560,
    minHeight: 620,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    show: false,
    skipTaskbar: true,
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  overlayImageWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayImageWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayImageWindow.setSkipTaskbar(true)

  overlayImageWindow.loadURL(buildOverlayToolsUrl('image'))
  attachWindowHealthHandlers(overlayImageWindow, 'overlay-image')

  overlayImageWindow.once('ready-to-show', () => {
    if (!isQuitting && overlayImageWindow && !overlayImageWindow.isDestroyed()) {
      overlayImageWindow.show()
      overlayImageWindow.focus()
    }
  })

  overlayImageWindow.on('closed', () => {
    overlayImageWindow = null
  })

  return overlayImageWindow
}

function showOverlayImageWindow(options = {}) {
  const tab = normalizeOverlayToolsTab(options.tab)
  hideTrayMenuWindow()
  const window = createOverlayImageWindow()
  if (!window || window.isDestroyed()) return
  const targetUrl = buildOverlayToolsUrl(tab)
  const currentUrl = window.webContents?.getURL?.() || ''
  if (!currentUrl || !currentUrl.includes(`/overlay-image?tab=${tab}`)) {
    window.loadURL(targetUrl)
  }
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

function closeOverlayImageWindow(options = {}) {
  const refocusMain = options.refocusMain !== false
  hideTrayMenuWindow()
  if (!overlayImageWindow || overlayImageWindow.isDestroyed()) return
  overlayImageWindow.close()
  if (refocusMain && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.focus()
  }
}

function broadcastToWindows(channel, payload) {
  const windows = [mainWindow, overlayWindow, overlayImageWindow, hotkeyWindow, trayMenuWindow]
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
  tray.setToolTip(APP_DISPLAY_NAME)
  tray.on('click', () => {
    toggleTrayMenuWindow()
  })
  tray.on('right-click', () => {
    toggleTrayMenuWindow()
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

  const settings = ensureSettings()
  const isMainVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
  const appEnabled = !!settings.appEnabled
  const overlayVisible = !!currentSettings?.overlayVisible
  const overlayInteractive = !!currentSettings?.overlayInteractive
  const language = getUiLanguage(settings)
  const labels = TRAY_LABELS[language]
  const signature = `${language}|${isMainVisible ? '1' : '0'}|${appEnabled ? '1' : '0'}|${overlayVisible ? '1' : '0'}|${overlayInteractive ? '1' : '0'}|${settings.uiMode}|${settings.uiPalette}`
  if (signature === trayMenuSignature) return
  trayMenuSignature = signature

  trayNativeFallbackMenu = Menu.buildFromTemplate([
    {
      label: appEnabled ? labels.disableApp : labels.enableApp,
      click: () => applyAppToggleHotkeyAction(),
    },
    { type: 'separator' },
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

  tray.setContextMenu(trayNativeFallbackEnabled ? trayNativeFallbackMenu : null)
}

function clampToRange(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getTrayMenuWindowBounds() {
  const trayBounds = tray?.getBounds?.() || { x: 0, y: 0, width: TRAY_MENU_WINDOW_WIDTH, height: 0 }
  const anchorPoint = {
    x: Math.round((trayBounds.x || 0) + (trayBounds.width || 0) / 2),
    y: Math.round((trayBounds.y || 0) + (trayBounds.height || 0) / 2),
  }
  const display = screen.getDisplayNearestPoint(anchorPoint)
  const workArea = display?.workArea || { x: 0, y: 0, width: 800, height: 600 }
  const minX = workArea.x + TRAY_MENU_WINDOW_MARGIN
  const maxX = workArea.x + workArea.width - TRAY_MENU_WINDOW_WIDTH - TRAY_MENU_WINDOW_MARGIN
  const preferredX = anchorPoint.x - Math.round(TRAY_MENU_WINDOW_WIDTH / 2)
  const x = clampToRange(preferredX, minX, Math.max(minX, maxX))

  const belowY = (trayBounds.y || 0) + (trayBounds.height || 0) + TRAY_MENU_WINDOW_MARGIN
  const aboveY = (trayBounds.y || 0) - TRAY_MENU_WINDOW_HEIGHT - TRAY_MENU_WINDOW_MARGIN
  const minY = workArea.y + TRAY_MENU_WINDOW_MARGIN
  const maxY = workArea.y + workArea.height - TRAY_MENU_WINDOW_HEIGHT - TRAY_MENU_WINDOW_MARGIN
  const y = belowY <= maxY ? belowY : clampToRange(aboveY, minY, Math.max(minY, maxY))

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: TRAY_MENU_WINDOW_WIDTH,
    height: TRAY_MENU_WINDOW_HEIGHT,
  }
}

function createTrayMenuWindow() {
  if (trayMenuWindow && !trayMenuWindow.isDestroyed()) return trayMenuWindow

  trayMenuWindow = new BrowserWindow({
    title: `${APP_DISPLAY_NAME} Tray Menu`,
    width: TRAY_MENU_WINDOW_WIDTH,
    height: TRAY_MENU_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  trayMenuWindow.setAlwaysOnTop(true, 'pop-up-menu')
  trayMenuWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  trayMenuWindow.loadURL(buildRendererUrl('/tray-menu'))
  attachWindowHealthHandlers(trayMenuWindow, 'tray-menu')

  trayMenuWindow.on('blur', () => {
    if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return
    trayMenuSuppressOpenUntil = Date.now() + TRAY_MENU_REOPEN_SUPPRESS_MS
    trayMenuWindow.hide()
  })

  trayMenuWindow.on('closed', () => {
    trayMenuWindow = null
  })

  return trayMenuWindow
}

function showTrayNativeFallbackMenu() {
  if (!tray) return
  refreshTrayMenu({ immediate: true })
  if (trayNativeFallbackMenu) {
    tray.popUpContextMenu(trayNativeFallbackMenu)
  }
}

function showTrayMenuWindow() {
  if (!tray) return
  try {
    const window = createTrayMenuWindow()
    if (!window || window.isDestroyed()) {
      trayNativeFallbackEnabled = true
      showTrayNativeFallbackMenu()
      return
    }
    const bounds = getTrayMenuWindowBounds()
    window.setBounds(bounds, false)
    if (!window.isVisible()) {
      window.show()
    }
    window.focus()
    trayNativeFallbackEnabled = false
    tray.setContextMenu(null)
  } catch (error) {
    safeConsoleError('[tray] custom menu failed, fallback to native:', error)
    trayNativeFallbackEnabled = true
    showTrayNativeFallbackMenu()
  }
}

function hideTrayMenuWindow() {
  if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return
  trayMenuWindow.hide()
}

function toggleTrayMenuWindow() {
  if (trayNativeFallbackEnabled) {
    showTrayNativeFallbackMenu()
    return
  }
  if (trayMenuWindow && !trayMenuWindow.isDestroyed() && trayMenuWindow.isVisible()) {
    trayMenuSuppressOpenUntil = Date.now() + TRAY_MENU_REOPEN_SUPPRESS_MS
    hideTrayMenuWindow()
    return
  }
  if (Date.now() < trayMenuSuppressOpenUntil) return
  showTrayMenuWindow()
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

function killStrandedPythonServices() {
  if (process.platform !== 'win32') return

  const run = (command) => {
    try {
      execSync(command, { stdio: 'ignore', windowsHide: true })
    } catch {
      // best-effort kill
    }
  }

  run('taskkill /IM QuickTextPython.exe /F /T')
  run(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \\"python.exe\\" -and $_.CommandLine -match \\"python\\\\tool\\\\.py\\" } | ForEach-Object { $_.Terminate() }"',
  )
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
  killStrandedPythonServices()

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

  if (managedPythonProcess && !managedPythonProcess.killed) {
    managedPythonStopping = true
    try {
      managedPythonProcess.kill()
    } catch {
      // Ignore child process termination errors.
    }
    managedPythonProcess = null
  }

  destroyManagedWindow(hotkeyWindow)
  destroyManagedWindow(trayMenuWindow)
  destroyManagedWindow(startupSplashWindow)
  destroyManagedWindow(overlayImageWindow)
  destroyManagedWindow(overlayWindow)
  destroyManagedWindow(mainWindow)

  hotkeyWindow = null
  trayMenuWindow = null
  startupSplashWindow = null
  overlayImageWindow = null
  overlayWindow = null
  mainWindow = null
  packagedRendererProcess = null
  currentTelemetry = null
  pendingTelemetryWrite = null
  telemetryWritePromise = Promise.resolve()
  pendingSettingsWrite = null
  settingsWritePromise = Promise.resolve()
  lastSettingsWriteError = null
  unregisterElectronHotkeys()
  unregisterStandaloneAppToggleHotkey()
  unregisterAltF4BlockShortcut()
  clearOverlaySmartZoneMonitor()
  hotkeySignature = ''
  electronHotkeyRegistrations = []
  standaloneAppToggleHotkeyRegistration = ''
  overlayMousePassThrough = true
  overlayInteractiveZones = {
    quickAdd: null,
  }
  overlaySmartZoneInsideLast = false
  overlayBoundsSignature = ''
  trayMenuSignature = ''
  trayNativeFallbackMenu = null
  trayNativeFallbackEnabled = false
  trayMenuSuppressOpenUntil = 0
  settingsWindowRestorePending = false
  suppressSettingsBlurClose = false
  settingsWindowAutoShowOnReady = false
  startupSplashActive = false
  startupSplashStartedAt = 0
  startupSplashProgress = 0
  startupFirstLaunch = false
  mainBoundsSignature = ''
  mainRendererReadySenderId = 0
  packagedRendererStopping = false
  packagedRendererPort = PACKAGED_RENDERER_PORT
  managedPythonStopping = false
  managedPythonBootPromise = null
  managedPythonLastError = ''
  managedPythonRetryAfter = 0
  managedPythonHealthAt = 0
  managedPythonHealthOk = false
  managedPythonLaunchCommand = ''
  if (nativeInputCore && typeof nativeInputCore.shutdown === 'function') {
    try {
      nativeInputCore.shutdown()
    } catch {
      // Ignore native shutdown errors while exiting.
    }
  }
  nativeInputCore = null
  inputBackendName = ''
  updateRuntime = createDefaultUpdateRuntime()
  updateCheckPromise = null
  autoUpdaterInitialized = false
  cachedAutoUpdater = undefined
  cachedAutoUpdaterError = ''
  profilingState = createDefaultProfilingState()
  profilingCurrentTrace = null
  profilingLogWritePromise = Promise.resolve()

  ipcMain.removeHandler('get-window-kind')
  ipcMain.removeHandler('get-settings')
  ipcMain.removeHandler('overlay-image-session:get')
  ipcMain.removeHandler('overlay-image-session:save')
  ipcMain.removeHandler('overlay-image-history:get')
  ipcMain.removeHandler('overlay-image-history:save')
  ipcMain.removeHandler('window:set-mode')
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
  ipcMain.removeHandler('lens:search-image')
  ipcMain.removeHandler('overlay:toggle-visibility')
  ipcMain.removeHandler('overlay:toggle-interaction')
  ipcMain.removeHandler('overlay:set-interaction')
  ipcMain.removeHandler('overlay:set-mouse-pass-through')
  ipcMain.removeHandler('overlay:set-interactive-zones')
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
  ipcMain.removeAllListeners('overlay-image:open')
  ipcMain.removeAllListeners('overlay-image:close')
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
      try {
        ensureInputBackendReady()
      } catch (error) {
        dialog.showErrorBox(
          `${APP_DISPLAY_NAME} startup failed`,
          error instanceof Error ? error.message : 'Unable to initialize input backend.',
        )
        requestAppQuit()
        return
      }
      if (ensureAutoUpdaterInitialized()) {
        setTimeout(() => {
          void checkForAppUpdates('startup')
        }, AUTO_UPDATE_STARTUP_DELAY_MS)
      }
      startupFirstLaunch = detectStartupFirstLaunch()
      startupSplashActive = false
      const splashShown = await showStartupSplashIfNeeded()
      startupSplashActive = splashShown
      logStartupPhase('splash', splashShown ? 'shown' : 'skipped')

      if (splashShown) {
        if (startupFirstLaunch) {
          await setStartupSplashStep(0.07, 'firstLaunchNotice')
        }
        await setStartupSplashStep(0.08, 'initializing')
      }

      const settingsLoadPromise = (async () => {
        if (splashShown) {
          await setStartupSplashStep(0.16, startupFirstLaunch ? 'firstLaunchNotice' : 'loadingSettings')
        }
        await loadSettings()
        logStartupPhase('settings', 'loaded')
      })()
      const pythonWarmupPromise = settingsLoadPromise
        .then(async () => {
          await syncInputRuntimeForSettings(ensureSettings(), 'startup-warmup')
          return true
        })
        .catch((error) => {
          safeConsoleError('[python] warmup failed:', error)
          return false
        })
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
      let settingsRoutePrewarmPromise = Promise.resolve()

      if (splashShown) {
        await setStartupSplashStep(0.3, 'loadingWindows')
      }

      const rendererBooted = await rendererBootPromise
      if (!rendererBooted) {
        dialog.showErrorBox(
          `${APP_DISPLAY_NAME} startup failed`,
          'Unable to start the packaged renderer server.',
        )
        requestAppQuit()
        return
      }
      logStartupPhase('renderer', 'ready')
      overlayPrewarmPromise = prewarmOverlayRouteOnStartup()
      settingsRoutePrewarmPromise = prewarmSettingsRouteOnStartup()

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
      await runtimeInitPromise
      if (splashShown) {
        if (startupFirstLaunch) {
          await setStartupSplashStep(0.83, 'firstLaunchNotice')
        }
        await setStartupSplashStep(0.84, 'preparingControls')
      }
      await Promise.all([overlayPrewarmPromise, settingsRoutePrewarmPromise])
      if (splashShown) {
        await setStartupSplashStep(0.88, 'waitingMainReady')
      }
      await prewarmSettingsWindowOnStartup()
      const settingsSnapshot = ensureSettings()
      clearOverlayBootTimer()
      createOverlayWindow()
      applyOverlayWindowSettings(settingsSnapshot)
      applyOverlayVisibility(settingsSnapshot.overlayVisible)
      logStartupPhase('overlay', settingsSnapshot.overlayVisible ? 'visible' : 'hidden')
      if (splashShown) {
        await setStartupSplashStep(0.92, 'uiReady')
        await hideStartupSplashAndRevealMain()
      }
      scheduleRuntimeStateSync(splashShown ? 24 : 0)
      void telemetryWarmupPromise
      void pythonWarmupPromise
    })
    .catch((error) => {
      safeConsoleError('[startup] failed:', error)
      requestAppQuit()
    })
}

app.on('activate', () => {
  if (!hasSingleInstanceLock) return
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  const settings = ensureSettings()
  const keepMainHiddenForOverlayPlay = !!settings.appEnabled && !!settings.overlayVisible && !settings.overlayInteractive
  if (!keepMainHiddenForOverlayPlay) {
    showMainWindow()
  }
  applySettingsToWindows(settings)
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
    stopManagedPythonService(),
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
  lensSearchPayload: z.record(z.any()),
  overlayImageHistory: z.array(z.any()),
  overlayImageSession: z.record(z.any()),
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
  windowMode: z.enum(['manager', 'overlay']),
  booleanFlag: z.boolean(),
  overlayInteractiveZones: z
    .object({
      quickAdd: z
        .union([
          z
            .object({
              x: z.number().finite(),
              y: z.number().finite(),
              width: z.number().finite(),
              height: z.number().finite(),
              enabled: z.boolean().optional(),
            })
            .passthrough(),
          z.null(),
        ])
        .optional(),
    })
    .passthrough(),
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
    'overlayToolsPanelVisible',
    'overlayToolsShowTextManager',
    'overlayToolsShowImageTranslate',
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
  return patchHasAnyKey(patch, ['overlayVisible', 'overlayInteractive', 'uiLanguage', 'uiMode', 'uiPalette', 'appEnabled'])
}

function patchTouchesPythonRuntimeState(patch) {
  return patchHasAnyKey(patch, [
    'appEnabled',
    'blockAltF4WhenEnabled',
    'sendHotkey',
    'appToggleHotkey',
    'overlayToggleHotkey',
    'mainToggleHotkey',
    'overlayEditHotkey',
    'selectedIndex',
    'items',
  ])
}

withIpcHandle('get-window-kind', null, (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (overlayWindow && owner && owner.id === overlayWindow.id) return 'overlay'
  if (overlayImageWindow && owner && owner.id === overlayImageWindow.id) return 'overlay-image'
  if (hotkeyWindow && owner && owner.id === hotkeyWindow.id) return 'settings'
  if (trayMenuWindow && owner && owner.id === trayMenuWindow.id) return 'tray-menu'
  return 'main'
})

withIpcHandle('get-settings', null, async () => ensureSettings())
withIpcHandle('overlay-image-session:get', null, async () => loadOverlayImageSession())
withIpcHandle('overlay-image-session:save', IPC_SCHEMAS.overlayImageSession, async (_event, payload) => {
  return saveOverlayImageSession(payload)
})
withIpcHandle('overlay-image-history:get', null, async () => loadOverlayImageHistory())
withIpcHandle('overlay-image-history:save', IPC_SCHEMAS.overlayImageHistory, async (_event, entries) => {
  return saveOverlayImageHistory(entries)
})

withIpcHandle('window:set-mode', IPC_SCHEMAS.windowMode, async (_event, mode) => {
  return setWindowMode(mode)
})

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
  return handleInputSend(payload)
})

withIpcHandle('python:configure', IPC_SCHEMAS.pythonPayload, async (_event, payload) => {
  return handleInputConfigure(payload)
})

withIpcHandle('python:events', IPC_SCHEMAS.pythonAfter, async (_event, after) => {
  return handleInputEvents(after)
})

withIpcHandle('lens:search-image', IPC_SCHEMAS.lensSearchPayload, async (_event, payload) => {
  return handleLensSearchImage(payload)
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
  if (patchTouchesPythonRuntimeState(patchPayload)) {
    if (Object.prototype.hasOwnProperty.call(patchPayload, 'appEnabled')) {
      if (currentSettings.appEnabled) {
        await syncInputRuntimeForSettings(currentSettings, 'save-settings-app-enabled')
      } else {
        // App-off should feel instant; sync backend asynchronously after UI/state are applied.
        void syncInputRuntimeForSettings(currentSettings, 'save-settings-app-disabled')
      }
    } else {
      void syncInputRuntimeForSettings(currentSettings, 'save-settings')
    }
  }
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
    settings.overlayToolsPanelVisible = true
    settings.overlayToolsActiveTab = 'image'
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

withIpcHandle('overlay:set-interactive-zones', IPC_SCHEMAS.overlayInteractiveZones, async (event, zones) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  return setOverlayInteractiveZones(zones)
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

withIpcListener('overlay-image:open', null, (_event, payload) => {
  const rawTab =
    typeof payload === 'string'
      ? payload
      : payload && typeof payload === 'object' && typeof payload.tab === 'string'
        ? payload.tab
        : undefined
  const tab =
    typeof rawTab === 'string' && rawTab.trim()
      ? normalizeOverlayToolsTab(rawTab)
      : undefined
  showOverlayImageWindow(tab ? { tab } : undefined)
})

withIpcListener('overlay-image:close', null, () => {
  closeOverlayImageWindow()
})

withIpcListener('app:quit', null, () => {
  requestAppQuit()
})
