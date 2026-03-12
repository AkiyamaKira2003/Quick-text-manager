import type { HotkeyActionId, HotkeyCategory, HotkeyContext, HotkeyOverrides, Settings } from '@/types'

type HotkeySettingKey = 'appToggleHotkey' | 'overlayToggleHotkey' | 'mainToggleHotkey' | 'overlayEditHotkey' | 'sendHotkey'

export type HotkeyActionDefinition = {
  id: HotkeyActionId
  category: HotkeyCategory
  context: HotkeyContext
  defaultCombo: string
  settingKey: HotkeySettingKey
  labelKey: string
  descriptionKey: string
  allowInInput?: boolean
  priority?: number
}

export type EffectiveHotkeyBinding = {
  action: HotkeyActionDefinition
  combo: string
  context: HotkeyContext
  source: 'default' | 'setting' | 'override'
}

const MODIFIER_ORDER = ['Ctrl', 'Shift', 'Alt', 'Meta'] as const
const MODIFIER_SET = new Set<string>(MODIFIER_ORDER)
const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])
const CODE_TO_KEY_TOKEN: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Tab: 'Tab',
  Enter: 'Enter',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Escape: 'Esc',
}
const SHIFTED_KEY_ALIASES: Record<string, string> = {
  '~': '`',
  '!': '1',
  '@': '2',
  '#': '3',
  '$': '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  '_': '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
}

export const HOTKEY_ACTIONS: HotkeyActionDefinition[] = [
  {
    id: 'app.toggle_enabled',
    category: 'core',
    context: 'global',
    defaultCombo: 'Shift+5',
    settingKey: 'appToggleHotkey',
    labelKey: 'hk.actionAppToggle',
    descriptionKey: 'hk.descAppToggle',
    priority: 110,
  },
  {
    id: 'overlay.toggle_visibility',
    category: 'overlay',
    context: 'global',
    defaultCombo: 'Ctrl+Shift+1',
    settingKey: 'overlayToggleHotkey',
    labelKey: 'hk.actionOverlayToggle',
    descriptionKey: 'hk.descOverlayToggle',
    priority: 100,
  },
  {
    id: 'main.toggle_visibility',
    category: 'core',
    context: 'global',
    defaultCombo: 'Delete',
    settingKey: 'mainToggleHotkey',
    labelKey: 'hk.actionMainToggle',
    descriptionKey: 'hk.descMainToggle',
    priority: 90,
  },
  {
    id: 'overlay.toggle_interaction',
    category: 'overlay',
    context: 'global',
    defaultCombo: 'Tab',
    settingKey: 'overlayEditHotkey',
    labelKey: 'hk.actionOverlayEdit',
    descriptionKey: 'hk.descOverlayEdit',
    priority: 80,
  },
  {
    id: 'text.send_current',
    category: 'text',
    context: 'global',
    defaultCombo: '4',
    settingKey: 'sendHotkey',
    labelKey: 'hk.actionSendCurrent',
    descriptionKey: 'hk.descSendCurrent',
    priority: 70,
  },
]

const ACTION_BY_ID = new Map<HotkeyActionId, HotkeyActionDefinition>(HOTKEY_ACTIONS.map((action) => [action.id, action]))
const ACTION_DEFAULT_COMBO = new Map<HotkeyActionId, string>(
  HOTKEY_ACTIONS.map((action) => [action.id, normalizeCombo(action.defaultCombo) ?? action.defaultCombo]),
)

const RESERVED_COMBOS = new Set(
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
  ]
    .map((value) => normalizeCombo(value))
    .filter((value): value is string => !!value),
)

type BindingLike = {
  actionId: HotkeyActionId
  combo: string
  context: HotkeyContext
}

export function getHotkeyActionById(actionId: HotkeyActionId) {
  return ACTION_BY_ID.get(actionId) ?? null
}

export function registerHotkeyAction(action: HotkeyActionDefinition) {
  if (ACTION_BY_ID.has(action.id)) return false

  HOTKEY_ACTIONS.push(action)
  ACTION_BY_ID.set(action.id, action)
  ACTION_DEFAULT_COMBO.set(action.id, normalizeCombo(action.defaultCombo) ?? action.defaultCombo)
  return true
}

export function normalizeCombo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parts = value
    .split('+')
    .map((part) => normalizeKeyToken(part.trim()))
    .filter((part): part is string => !!part)
  if (parts.length === 0) return null

  const modifiers = new Set<string>()
  let key = ''
  for (const part of parts) {
    if (MODIFIER_SET.has(part)) {
      modifiers.add(part)
      continue
    }
    if (key) return null
    key = part
  }

  const orderedModifiers = MODIFIER_ORDER.filter((item) => modifiers.has(item))
  if (!key) {
    return orderedModifiers.length > 0 ? orderedModifiers.join('+') : null
  }
  return orderedModifiers.length > 0 ? `${orderedModifiers.join('+')}+${key}` : key
}

export function comboFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (event.isComposing) return null

  const key = getHotkeyTokenFromEvent(event)
  if (!key || MODIFIER_SET.has(key)) return null

  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.altKey) modifiers.push('Alt')
  if (event.metaKey) modifiers.push('Meta')

  const combo = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key
  return normalizeCombo(combo)
}

export function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) return false
  const tagName = element.tagName?.toUpperCase()
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true
  return !!element.isContentEditable || !!element.closest?.('[contenteditable="true"]')
}

export function formatComboForDisplay(combo: string) {
  const normalized = normalizeCombo(combo)
  return normalized ?? combo
}

export function toElectronAccelerator(combo: string) {
  const normalized = normalizeCombo(combo)
  if (!normalized) return null

  const parts = normalized.split('+')
  const translated = parts.map((part) => {
    if (part === 'Ctrl') return 'Control'
    if (part === 'Meta') return process.platform === 'darwin' ? 'Command' : 'Super'
    if (part === 'Esc') return 'Escape'
    if (part === 'Space') return 'Space'
    return part.length === 1 ? part.toUpperCase() : part
  })

  return translated.join('+')
}

export function normalizeHotkeyOverrides(value: unknown): HotkeyOverrides {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const next: HotkeyOverrides = {}

  for (const action of HOTKEY_ACTIONS) {
    const combo = normalizeCombo(raw[action.id])
    if (!combo) continue
    if (isReservedCombo(combo)) continue
    next[action.id] = combo
  }

  return next
}

export function deriveHotkeyOverridesFromSettings(settings: Pick<Settings, HotkeySettingKey | 'hotkeyOverrides'>): HotkeyOverrides {
  const overrides = normalizeHotkeyOverrides(settings.hotkeyOverrides)

  for (const action of HOTKEY_ACTIONS) {
    if (typeof overrides[action.id] === 'string') continue

    const value = normalizeCombo(settings[action.settingKey])
    const fallback = ACTION_DEFAULT_COMBO.get(action.id) ?? action.defaultCombo
    if (!value || value === fallback) continue
    overrides[action.id] = value
  }

  return overrides
}

export function createHotkeyPatchFromOverrides(overrides: HotkeyOverrides): Pick<
  Settings,
  'hotkeyOverrides' | 'appToggleHotkey' | 'overlayToggleHotkey' | 'mainToggleHotkey' | 'overlayEditHotkey' | 'sendHotkey'
> {
  const normalized = normalizeHotkeyOverrides(overrides)
  const patch: Pick<
    Settings,
    'hotkeyOverrides' | 'appToggleHotkey' | 'overlayToggleHotkey' | 'mainToggleHotkey' | 'overlayEditHotkey' | 'sendHotkey'
  > = {
    hotkeyOverrides: normalized,
    appToggleHotkey: getActionComboWithOverrides('app.toggle_enabled', normalized),
    overlayToggleHotkey: getActionComboWithOverrides('overlay.toggle_visibility', normalized),
    mainToggleHotkey: getActionComboWithOverrides('main.toggle_visibility', normalized),
    overlayEditHotkey: getActionComboWithOverrides('overlay.toggle_interaction', normalized),
    sendHotkey: getActionComboWithOverrides('text.send_current', normalized),
  }

  return enforceUniqueCombos(patch)
}

export function getEffectiveHotkeyBindings(
  settings: Pick<Settings, HotkeySettingKey | 'hotkeyOverrides'>,
): EffectiveHotkeyBinding[] {
  const overrides = deriveHotkeyOverridesFromSettings(settings)

  return HOTKEY_ACTIONS.map((action) => {
    const overrideCombo = normalizeCombo(overrides[action.id])
    if (overrideCombo) {
      return { action, combo: overrideCombo, context: action.context, source: 'override' }
    }

    const settingCombo = normalizeCombo(settings[action.settingKey])
    if (settingCombo) {
      const fallback = ACTION_DEFAULT_COMBO.get(action.id) ?? action.defaultCombo
      const source = settingCombo === fallback ? 'default' : 'setting'
      return { action, combo: settingCombo, context: action.context, source }
    }

    const fallback = ACTION_DEFAULT_COMBO.get(action.id) ?? action.defaultCombo
    return { action, combo: fallback, context: action.context, source: 'default' }
  })
}

export function findHotkeyConflict(
  candidate: BindingLike,
  bindings: ReadonlyArray<BindingLike>,
  excludeActionId?: HotkeyActionId,
) {
  const parsedCandidate = parseNormalizedCombo(candidate.combo)
  if (!parsedCandidate) return null

  for (const current of bindings) {
    if (excludeActionId && current.actionId === excludeActionId) continue
    const parsedCurrent = parseNormalizedCombo(current.combo)
    if (!parsedCurrent) continue
    if (!hotkeysCanConflict(parsedCandidate, parsedCurrent)) continue
    if (!contextsOverlap(candidate.context, current.context)) continue
    return current
  }

  return null
}

export function contextsOverlap(a: HotkeyContext, b: HotkeyContext) {
  if (a === b) return true
  if (a === 'global' || b === 'global') return true
  if (a === 'screen' && (b === 'modal' || b === 'editor')) return true
  if (b === 'screen' && (a === 'modal' || a === 'editor')) return true
  return false
}

export function isReservedCombo(combo: string) {
  const normalized = normalizeCombo(combo)
  return normalized ? RESERVED_COMBOS.has(normalized) : false
}

export function isHotkeyActionActive(
  settings: Pick<Settings, 'appEnabled' | 'overlayVisible' | 'overlayInteractive'>,
  actionId: HotkeyActionId,
) {
  if (actionId === 'app.toggle_enabled') return settings.appEnabled
  if (actionId === 'overlay.toggle_visibility') return settings.appEnabled && settings.overlayVisible
  if (actionId === 'overlay.toggle_interaction') return settings.appEnabled && settings.overlayInteractive
  return settings.appEnabled
}

function getActionComboWithOverrides(actionId: HotkeyActionId, overrides: HotkeyOverrides) {
  const override = normalizeCombo(overrides[actionId])
  if (override) return override
  return ACTION_DEFAULT_COMBO.get(actionId) ?? ''
}

type ParsedCombo = {
  normalized: string
  key: string | null
  modifiers: Set<string>
}

function parseNormalizedCombo(value: string): ParsedCombo | null {
  const normalized = normalizeCombo(value)
  if (!normalized) return null

  const parts = normalized.split('+').filter((part) => part.length > 0)
  if (parts.length === 0) return null

  const modifiers = new Set<string>()
  let key: string | null = null
  for (const part of parts) {
    if (MODIFIER_SET.has(part)) {
      modifiers.add(part)
      continue
    }
    if (key) return null
    key = part
  }

  return { normalized, key, modifiers }
}

function hotkeysCanConflict(a: ParsedCombo, b: ParsedCombo) {
  if (a.normalized === b.normalized) return true

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

function modifiersSubsetOf(left: Set<string>, right: Set<string>) {
  for (const item of left) {
    if (!right.has(item)) return false
  }
  return true
}

function enforceUniqueCombos<T extends Pick<Settings, HotkeySettingKey | 'hotkeyOverrides'>>(input: T): T {
  const result = { ...input }
  const seen: ParsedCombo[] = []

  for (const action of HOTKEY_ACTIONS) {
    const currentValue = normalizeCombo(result[action.settingKey])
    const fallback = ACTION_DEFAULT_COMBO.get(action.id) ?? action.defaultCombo
    const normalizedFallback = normalizeCombo(fallback) ?? fallback
    const candidate = currentValue ?? normalizedFallback
    if (!candidate) continue

    const parsedCandidate = parseNormalizedCombo(candidate)
    const candidateConflicts = parsedCandidate ? seen.some((item) => hotkeysCanConflict(item, parsedCandidate)) : false

    if (candidateConflicts || isReservedCombo(candidate)) {
      result[action.settingKey] = normalizedFallback
      delete result.hotkeyOverrides[action.id]
      const parsedFallback = parseNormalizedCombo(normalizedFallback)
      if (parsedFallback) {
        seen.push(parsedFallback)
      }
      continue
    }

    if (parsedCandidate) {
      seen.push(parsedCandidate)
    }
    result[action.settingKey] = candidate
  }

  return result
}

function getHotkeyTokenFromEvent(event: KeyboardEvent) {
  const code = typeof event.code === 'string' ? event.code : ''
  if (MODIFIER_CODES.has(code)) return null

  if (/^digit\d$/i.test(code)) return code.slice(-1)
  if (/^key[a-z]$/i.test(code)) return code.slice(-1).toUpperCase()
  if (/^f\d{1,2}$/i.test(code)) return code.toUpperCase()
  if (CODE_TO_KEY_TOKEN[code]) return CODE_TO_KEY_TOKEN[code]

  return normalizeKeyToken(event.key)
}

function normalizeKeyToken(input: string) {
  if (!input) return null

  const lower = input.toLowerCase()
  if (lower === 'ctrl' || lower === 'control' || lower === 'cmdorctrl') return 'Ctrl'
  if (lower === 'shift') return 'Shift'
  if (lower === 'alt' || lower === 'option') return 'Alt'
  if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'super' || lower === 'win') return 'Meta'

  if (lower === 'escape' || lower === 'esc') return 'Esc'
  if (lower === 'tab') return 'Tab'
  if (lower === 'enter' || lower === 'return') return 'Enter'
  if (lower === 'space' || lower === 'spacebar') return 'Space'
  if (lower === 'backspace') return 'Backspace'
  if (lower === 'delete' || lower === 'del') return 'Delete'
  if (lower === 'insert' || lower === 'ins') return 'Insert'
  if (lower === 'home') return 'Home'
  if (lower === 'end') return 'End'
  if (lower === 'pageup') return 'PageUp'
  if (lower === 'pagedown') return 'PageDown'
  if (lower === 'arrowup' || lower === 'up') return 'ArrowUp'
  if (lower === 'arrowdown' || lower === 'down') return 'ArrowDown'
  if (lower === 'arrowleft' || lower === 'left') return 'ArrowLeft'
  if (lower === 'arrowright' || lower === 'right') return 'ArrowRight'
  if (lower === 'backquote') return '`'

  const shiftedAlias = SHIFTED_KEY_ALIASES[input]
  if (shiftedAlias) return shiftedAlias.toUpperCase()

  if (/^f\d{1,2}$/i.test(input)) return input.toUpperCase()
  if (input.length === 1) return input.toUpperCase()

  if (/^digit\d$/i.test(input)) return input.slice(-1)
  if (/^key[a-z]$/i.test(input)) return input.slice(-1).toUpperCase()

  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase()
}
