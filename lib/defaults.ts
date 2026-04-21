import type { Settings, TextItem, UiLanguage, UiMode, UiPalette } from '@/types'
import {
  createHotkeyPatchFromOverrides,
  deriveHotkeyOverridesFromSettings,
  normalizeHotkeyOverrides,
} from '@/lib/hotkeys'

const OVERLAY_TOGGLE_HOTKEY = 'Shift+F7'
const MAIN_TOGGLE_HOTKEY = 'Shift+F8'
const OVERLAY_EDIT_HOTKEY = 'Shift+F6'
const APP_TOGGLE_HOTKEY = 'Shift+F9'
const SEND_HOTKEY = 'Shift+F5'
const LEGACY_OVERLAY_TOGGLE_HOTKEYS = ['Ctrl+Shift+1', 'Shift+F3']
const LEGACY_MAIN_TOGGLE_HOTKEYS = ['Delete', 'Shift+F4']
const LEGACY_OVERLAY_EDIT_HOTKEYS = ['Tab', 'Shift+F2']
const LEGACY_APP_TOGGLE_HOTKEYS = ['Shift+5', 'Shift+F5']
const LEGACY_SEND_HOTKEYS = ['4', 'Shift+F1']
const OVERLAY_FULLSCREEN_SIZE = 10000

const defaultItems: TextItem[] = [
  { text: '네 사람입니다', note: 'Vâng, tôi là người chơi thật' },
  { text: '매크로 아니에요', note: 'Không phải macro đâu' },
  { text: '직접 플레이 중입니다', note: 'Tôi đang chơi trực tiếp' },
  { text: '잠깐 사냥 중이었어요', note: 'Nãy giờ đang farm quái thôi' },
  { text: '확인 감사합니다', note: 'Cảm ơn đã kiểm tra' },
  { text: '네 지금 있습니다', note: 'Vâng tôi đang ở đây' },
  { text: '답변 늦어서 죄송합니다', note: 'Xin lỗi trả lời hơi chậm' },
  { text: '그냥 파밍 중이에요', note: 'Chỉ đang farm bình thường thôi' },
]
const defaultSettings: Settings = {
  appEnabled: true,
  blockAltF4WhenEnabled: false,
  appToggleHotkey: APP_TOGGLE_HOTKEY,
  sendHotkey: SEND_HOTKEY,
  overlayToggleHotkey: OVERLAY_TOGGLE_HOTKEY,
  mainToggleHotkey: MAIN_TOGGLE_HOTKEY,
  overlayEditHotkey: OVERLAY_EDIT_HOTKEY,
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
  iconOpacity: 0.95,
  counterOpacity: 1,
  textColor: '#ffffff',
  noteColor: '#ffffff',
  fontSize: 48,
  noteSize: 20,
  textAlign: 'center',
  textOffsetXPercent: 0,
  textOffsetYPercent: 0,
  noteOffsetXPercent: 0,
  noteOffsetYPercent: 16,
  items: defaultItems,
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

type LegacyMode = 'main' | 'overlay-text' | 'overlay-position'

type LegacyShape = Partial<Settings> & {
  hotkey?: unknown
  modeCycleHotkey?: unknown
  modeToggleHotkey?: unknown
  overlayToggleHotkey?: unknown
  overlayEnabled?: unknown
  overlayMode?: unknown
  mode?: unknown
  mainToggleHotkey?: unknown
  sendHotkey?: unknown
}

export function getDefaultSettings(): Settings {
  return {
    ...defaultSettings,
    items: defaultSettings.items.map((item) => ({ ...item })),
  }
}

export function normalizeSettings(value?: Partial<Settings> | null): Settings {
  const base = getDefaultSettings()
  if (!value) return base

  const raw = value as LegacyShape

  const mappedItems = Array.isArray(raw.items)
    ? raw.items
        .map((item) => ({
          text: typeof item?.text === 'string' ? item.text.trim() : '',
          note: typeof item?.note === 'string' ? item.note : '',
        }))
        .filter((item) => item.text.length > 0)
    : base.items

  const safeItems = mappedItems.length > 0 ? mappedItems : base.items
  const maxIndex = safeItems.length - 1
  const selectedIndex = clampInt(raw.selectedIndex, 0, maxIndex, base.selectedIndex)

  const legacyMode = normalizeLegacyMode(raw.mode)
  const overlayVisible = resolveOverlayVisible(raw, legacyMode, base.overlayVisible)
  const appEnabled = typeof raw.appEnabled === 'boolean' ? raw.appEnabled : base.appEnabled
  const blockAltF4WhenEnabled =
    typeof raw.blockAltF4WhenEnabled === 'boolean'
      ? raw.blockAltF4WhenEnabled
      : base.blockAltF4WhenEnabled
  const overlayInteractive = typeof raw.overlayInteractive === 'boolean' ? raw.overlayInteractive : base.overlayInteractive
  const overlaySmartClickThrough =
    typeof raw.overlaySmartClickThrough === 'boolean' ? raw.overlaySmartClickThrough : base.overlaySmartClickThrough
  const overlayElementsVisible =
    typeof raw.overlayElementsVisible === 'boolean' ? raw.overlayElementsVisible : base.overlayElementsVisible
  const overlayShowIcon = typeof raw.overlayShowIcon === 'boolean' ? raw.overlayShowIcon : base.overlayShowIcon
  const overlayShowCounter = typeof raw.overlayShowCounter === 'boolean' ? raw.overlayShowCounter : base.overlayShowCounter
  const overlayToolsShowTextManager =
    typeof raw.overlayToolsShowTextManager === 'boolean'
      ? raw.overlayToolsShowTextManager
      : base.overlayToolsShowTextManager
  const overlayToolsShowImageTranslate =
    typeof raw.overlayToolsShowImageTranslate === 'boolean'
      ? raw.overlayToolsShowImageTranslate
      : base.overlayToolsShowImageTranslate
  const overlayToolsPanelVisible =
    typeof raw.overlayToolsPanelVisible === 'boolean' ? raw.overlayToolsPanelVisible : base.overlayToolsPanelVisible
  const overlayToolsActiveTab = normalizeOverlayToolsTab(raw.overlayToolsActiveTab, base.overlayToolsActiveTab)
  const overlayPlayShowImageCard =
    typeof raw.overlayPlayShowImageCard === 'boolean' ? raw.overlayPlayShowImageCard : base.overlayPlayShowImageCard
  const hasVisibleOverlayTool = overlayToolsShowTextManager || overlayToolsShowImageTranslate

  let sendHotkey =
    raw.sendHotkey === null ? null : firstString(raw.sendHotkey, raw.modeCycleHotkey, raw.hotkey, raw.modeToggleHotkey)
  sendHotkey = normalizeHotkey(sendHotkey, base.sendHotkey)

  let overlayToggleHotkey = normalizeHotkey(raw.overlayToggleHotkey, base.overlayToggleHotkey)
  let mainToggleHotkey = normalizeHotkey(raw.mainToggleHotkey, base.mainToggleHotkey)
  let overlayEditHotkey = normalizeHotkey(raw.overlayEditHotkey, base.overlayEditHotkey)
  let appToggleHotkey = normalizeHotkey(raw.appToggleHotkey, base.appToggleHotkey)
  if (normalizeHotkeyToken(appToggleHotkey) === '5') {
    appToggleHotkey = base.appToggleHotkey
  }
  const normalizedHotkeyOverrides = normalizeHotkeyOverrides(raw.hotkeyOverrides)
  const hasExplicitHotkeyOverrides = Object.keys(normalizedHotkeyOverrides).length > 0

  if (!hasExplicitHotkeyOverrides) {
    sendHotkey = migrateLegacyDefaultHotkey(sendHotkey, LEGACY_SEND_HOTKEYS, base.sendHotkey)
    overlayToggleHotkey = migrateLegacyDefaultHotkey(
      overlayToggleHotkey,
      LEGACY_OVERLAY_TOGGLE_HOTKEYS,
      base.overlayToggleHotkey,
    )
    mainToggleHotkey = migrateLegacyDefaultHotkey(mainToggleHotkey, LEGACY_MAIN_TOGGLE_HOTKEYS, base.mainToggleHotkey)
    overlayEditHotkey = migrateLegacyDefaultHotkey(overlayEditHotkey, LEGACY_OVERLAY_EDIT_HOTKEYS, base.overlayEditHotkey)
    appToggleHotkey = migrateLegacyDefaultHotkey(appToggleHotkey, LEGACY_APP_TOGGLE_HOTKEYS, base.appToggleHotkey)
  }

  const derivedHotkeyOverrides = deriveHotkeyOverridesFromSettings({
    appToggleHotkey,
    overlayToggleHotkey,
    mainToggleHotkey,
    overlayEditHotkey,
    sendHotkey,
    hotkeyOverrides: normalizedHotkeyOverrides,
  })
  const hotkeyPatch = createHotkeyPatchFromOverrides(derivedHotkeyOverrides)

  const uiMode = normalizeUiMode(raw.uiMode, base.uiMode)
  const uiPalette = normalizeUiPalette(raw.uiPalette, base.uiPalette)
  const uiLanguage = normalizeUiLanguage(raw.uiLanguage, base.uiLanguage)

  const textAlign = normalizeTextAlign(raw.textAlign, base.textAlign)
  const opacity = clampFloat(raw.opacity, 0.2, 1, base.opacity)
  const noteOpacity = clampFloat(raw.noteOpacity, 0.2, 1, base.noteOpacity)
  const iconOpacity = clampFloat(raw.iconOpacity, 0.2, 1, base.iconOpacity)
  const counterOpacity = clampFloat(raw.counterOpacity, 0.2, 1, base.counterOpacity)
  const fontSize = clampFloat(raw.fontSize, 24, 120, base.fontSize)
  const noteSize = clampFloat(raw.noteSize, 12, 72, base.noteSize)
  const textColor = normalizeHexColor(raw.textColor, base.textColor)
  const noteColor = normalizeHexColor(raw.noteColor, base.noteColor)

  return {
    ...base,
    ...raw,
    appEnabled,
    blockAltF4WhenEnabled,
    appToggleHotkey: hotkeyPatch.appToggleHotkey,
    sendHotkey: hotkeyPatch.sendHotkey,
    overlayToggleHotkey: hotkeyPatch.overlayToggleHotkey,
    mainToggleHotkey: hotkeyPatch.mainToggleHotkey,
    overlayEditHotkey: hotkeyPatch.overlayEditHotkey,
    hotkeyOverrides: hotkeyPatch.hotkeyOverrides,
    uiMode,
    uiPalette,
    uiLanguage,
    overlayVisible,
    overlayInteractive,
    overlaySmartClickThrough,
    overlayElementsVisible,
    overlayShowIcon,
    overlayShowCounter,
    overlayToolsShowTextManager: hasVisibleOverlayTool ? overlayToolsShowTextManager : true,
    overlayToolsShowImageTranslate: hasVisibleOverlayTool ? overlayToolsShowImageTranslate : false,
    overlayToolsPanelVisible,
    overlayToolsActiveTab,
    overlayToolsPanelX: clampInt(raw.overlayToolsPanelX, -20000, 20000, base.overlayToolsPanelX),
    overlayToolsPanelY: clampInt(raw.overlayToolsPanelY, -20000, 20000, base.overlayToolsPanelY),
    overlayQuickAddX: clampInt(raw.overlayQuickAddX, -20000, 20000, base.overlayQuickAddX),
    overlayQuickAddY: clampInt(raw.overlayQuickAddY, -20000, 20000, base.overlayQuickAddY),
    overlayToolsImagePanelX: clampInt(raw.overlayToolsImagePanelX, -20000, 20000, base.overlayToolsImagePanelX),
    overlayToolsImagePanelY: clampInt(raw.overlayToolsImagePanelY, -20000, 20000, base.overlayToolsImagePanelY),
    overlayToolsTextPanelWidth: clampInt(raw.overlayToolsTextPanelWidth, 520, 1400, base.overlayToolsTextPanelWidth),
    overlayToolsTextPanelHeight: clampInt(raw.overlayToolsTextPanelHeight, 360, 1100, base.overlayToolsTextPanelHeight),
    overlayToolsImagePanelWidth: clampInt(raw.overlayToolsImagePanelWidth, 420, 1200, base.overlayToolsImagePanelWidth),
    overlayToolsImagePanelHeight: clampInt(raw.overlayToolsImagePanelHeight, 320, 1100, base.overlayToolsImagePanelHeight),
    overlayToolsOpacity: clampFloat(raw.overlayToolsOpacity, 0.35, 1, base.overlayToolsOpacity),
    overlayToolsTextPanelOpacity: clampFloat(raw.overlayToolsTextPanelOpacity, 0.2, 1, base.overlayToolsTextPanelOpacity),
    overlayToolsImagePanelOpacity: clampFloat(
      raw.overlayToolsImagePanelOpacity,
      0.2,
      1,
      base.overlayToolsImagePanelOpacity,
    ),
    overlayHudContextOpacity: clampFloat(raw.overlayHudContextOpacity, 0.2, 1, base.overlayHudContextOpacity),
    overlayPlayShowImageCard,
    overlayImageCardOffsetXPercent: clampFloat(
      raw.overlayImageCardOffsetXPercent,
      -70,
      70,
      base.overlayImageCardOffsetXPercent,
    ),
    overlayImageCardOffsetYPercent: clampFloat(
      raw.overlayImageCardOffsetYPercent,
      -45,
      45,
      base.overlayImageCardOffsetYPercent,
    ),
    overlayToolsAutoSearchOnPaste:
      typeof raw.overlayToolsAutoSearchOnPaste === 'boolean'
        ? raw.overlayToolsAutoSearchOnPaste
        : base.overlayToolsAutoSearchOnPaste,
    overlayToolsShowWebPreview:
      typeof raw.overlayToolsShowWebPreview === 'boolean' ? raw.overlayToolsShowWebPreview : base.overlayToolsShowWebPreview,
    overlayToolsWebPreviewHeight: clampInt(
      raw.overlayToolsWebPreviewHeight,
      200,
      680,
      base.overlayToolsWebPreviewHeight,
    ),
    overlayImageAutoClipboardEnabled:
      typeof raw.overlayImageAutoClipboardEnabled === 'boolean'
        ? raw.overlayImageAutoClipboardEnabled
        : base.overlayImageAutoClipboardEnabled,
    overlayImageAutoClipboardMaxConcurrent: clampInt(
      raw.overlayImageAutoClipboardMaxConcurrent,
      1,
      6,
      base.overlayImageAutoClipboardMaxConcurrent,
    ),
    overlayImageHistoryLimit: clampInt(raw.overlayImageHistoryLimit, 10, 200, base.overlayImageHistoryLimit),
    overlayImageHistoryTtlMinutes: clampInt(
      raw.overlayImageHistoryTtlMinutes,
      5,
      1440,
      base.overlayImageHistoryTtlMinutes,
    ),
    overlayImageCompactHistoryVisibleCount: clampInt(
      raw.overlayImageCompactHistoryVisibleCount,
      1,
      20,
      base.overlayImageCompactHistoryVisibleCount,
    ),
    overlayImageBlockUploadPreview:
      typeof raw.overlayImageBlockUploadPreview === 'boolean'
        ? raw.overlayImageBlockUploadPreview
        : base.overlayImageBlockUploadPreview,
    overlayImageBlockResults:
      typeof raw.overlayImageBlockResults === 'boolean'
        ? raw.overlayImageBlockResults
        : base.overlayImageBlockResults,
    overlayImageBlockWebPreview:
      typeof raw.overlayImageBlockWebPreview === 'boolean'
        ? raw.overlayImageBlockWebPreview
        : base.overlayImageBlockWebPreview,
    overlayImageBlockOcr:
      typeof raw.overlayImageBlockOcr === 'boolean'
        ? raw.overlayImageBlockOcr
        : base.overlayImageBlockOcr,
    overlayImageBlockAiReply:
      typeof raw.overlayImageBlockAiReply === 'boolean'
        ? raw.overlayImageBlockAiReply
        : base.overlayImageBlockAiReply,
    overlayImageBlockTranslatedReply:
      typeof raw.overlayImageBlockTranslatedReply === 'boolean'
        ? raw.overlayImageBlockTranslatedReply
        : base.overlayImageBlockTranslatedReply,
    overlayImageBlockOverview:
      typeof raw.overlayImageBlockOverview === 'boolean'
        ? raw.overlayImageBlockOverview
        : base.overlayImageBlockOverview,
    overlayImageBlockGoogleTranslation:
      typeof raw.overlayImageBlockGoogleTranslation === 'boolean'
        ? raw.overlayImageBlockGoogleTranslation
        : base.overlayImageBlockGoogleTranslation,
    overlayImageBlockLensUrl:
      typeof raw.overlayImageBlockLensUrl === 'boolean'
        ? raw.overlayImageBlockLensUrl
        : base.overlayImageBlockLensUrl,
    overlaySnapTolerancePx: clampFloat(raw.overlaySnapTolerancePx, 4, 28, base.overlaySnapTolerancePx),
    overlayDragDelayMs: clampInt(raw.overlayDragDelayMs, 0, 180, base.overlayDragDelayMs),
    overlayDragFrictionMs: clampInt(raw.overlayDragFrictionMs, 0, 24, base.overlayDragFrictionMs),
    overlayPreciseDragFactor: clampFloat(raw.overlayPreciseDragFactor, 0.08, 0.7, base.overlayPreciseDragFactor),
    iconOffsetXPercent: clampFloat(raw.iconOffsetXPercent, -70, 70, base.iconOffsetXPercent),
    iconOffsetYPercent: clampFloat(raw.iconOffsetYPercent, -45, 45, base.iconOffsetYPercent),
    counterOffsetXPercent: clampFloat(raw.counterOffsetXPercent, -70, 70, base.counterOffsetXPercent),
    counterOffsetYPercent: clampFloat(raw.counterOffsetYPercent, -45, 45, base.counterOffsetYPercent),
    textAlign,
    textOffsetXPercent: clampFloat(raw.textOffsetXPercent, -70, 70, base.textOffsetXPercent),
    textOffsetYPercent: clampFloat(raw.textOffsetYPercent, -45, 45, base.textOffsetYPercent),
    noteOffsetXPercent: clampFloat(raw.noteOffsetXPercent, -70, 70, base.noteOffsetXPercent),
    noteOffsetYPercent: clampFloat(raw.noteOffsetYPercent, -45, 45, base.noteOffsetYPercent),
    opacity,
    noteOpacity,
    iconOpacity,
    counterOpacity,
    textColor,
    noteColor,
    fontSize,
    noteSize,
    items: safeItems,
    selectedIndex,
    overlayX: clampInt(raw.overlayX, -20000, 20000, base.overlayX),
    overlayY: clampInt(raw.overlayY, -20000, 20000, base.overlayY),
    overlayWidth: OVERLAY_FULLSCREEN_SIZE,
    overlayHeight: OVERLAY_FULLSCREEN_SIZE,
    windowX: clampInt(raw.windowX, -20000, 20000, base.windowX),
    windowY: clampInt(raw.windowY, -20000, 20000, base.windowY),
    windowWidth: clampInt(raw.windowWidth, 560, 3600, base.windowWidth),
    windowHeight: clampInt(raw.windowHeight, 420, 3000, base.windowHeight),
  }
}

function resolveOverlayVisible(raw: LegacyShape, legacyMode: LegacyMode | null, fallback: boolean) {
  if (typeof raw.overlayVisible === 'boolean') return raw.overlayVisible
  if (typeof raw.overlayEnabled === 'boolean') return raw.overlayEnabled
  if (legacyMode === 'main') return false
  if (legacyMode === 'overlay-text' || legacyMode === 'overlay-position') return true
  return fallback
}

function normalizeLegacyMode(value: unknown): LegacyMode | null {
  if (value === 'main' || value === 'overlay-text' || value === 'overlay-position') return value
  return null
}

function normalizeTextAlign(value: unknown, fallback: Settings['textAlign']): Settings['textAlign'] {
  if (value === 'left' || value === 'center' || value === 'right') return value
  return fallback
}

function normalizeUiMode(value: unknown, fallback: UiMode): UiMode {
  if (value === 'dark' || value === 'light') return value
  return fallback
}

function normalizeUiPalette(value: unknown, fallback: UiPalette): UiPalette {
  if (value === 'icon' || value === 'jade' || value === 'crimson' || value === 'dark' || value === 'light') return value
  return fallback
}

function normalizeUiLanguage(value: unknown, fallback: UiLanguage): UiLanguage {
  if (value === 'vi' || value === 'en') return value
  return fallback
}

function normalizeOverlayToolsTab(value: unknown, fallback: Settings['overlayToolsActiveTab']): Settings['overlayToolsActiveTab'] {
  if (value === 'text' || value === 'image') return value
  return fallback
}

function normalizeHotkey(value: unknown, fallback: string | null) {
  if (value === null) return null
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : fallback
}

function normalizeHotkeyToken(value: string | null) {
  return String(value || '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function migrateLegacyDefaultHotkey(value: string | null, legacyDefaults: string[], nextDefault: string | null) {
  const token = normalizeHotkeyToken(value)
  const hasLegacyMatch = legacyDefaults.some((legacyDefault) => normalizeHotkeyToken(legacyDefault) === token)
  if (!hasLegacyMatch) return value
  return nextDefault
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function clampFloat(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeHexColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized
  return fallback
}
