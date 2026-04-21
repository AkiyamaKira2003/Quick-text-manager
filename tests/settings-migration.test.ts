import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSettings } from '../lib/defaults'

test('normalizeSettings upgrades legacy hotkeys to current defaults', () => {
  const normalized = normalizeSettings({
    sendHotkey: '4',
    appToggleHotkey: 'Shift+5',
    overlayToggleHotkey: 'Ctrl+Shift+1',
    mainToggleHotkey: 'Delete',
    overlayEditHotkey: 'Tab',
    hotkeyOverrides: {},
  })

  assert.equal(normalized.sendHotkey, 'Shift+F5')
  assert.equal(normalized.appToggleHotkey, 'Shift+F9')
  assert.equal(normalized.overlayToggleHotkey, 'Shift+F7')
  assert.equal(normalized.mainToggleHotkey, 'Shift+F8')
  assert.equal(normalized.overlayEditHotkey, 'Shift+F6')
})

test('normalizeSettings keeps nullable hotkeys and explicit None overrides', () => {
  const normalized = normalizeSettings({
    sendHotkey: null,
    hotkeyOverrides: {
      'text.send_current': null,
    },
  })

  assert.equal(normalized.sendHotkey, null)
  assert.equal(normalized.hotkeyOverrides['text.send_current'], null)
})

test('normalizeSettings applies defaults for new image card fields', () => {
  const normalized = normalizeSettings({})

  assert.equal(normalized.overlayPlayShowImageCard, true)
  assert.equal(normalized.overlayImageCardOffsetXPercent, 24)
  assert.equal(normalized.overlayImageCardOffsetYPercent, 20)
  assert.equal(normalized.overlayImageAutoClipboardEnabled, true)
  assert.equal(normalized.overlayImageAutoClipboardMaxConcurrent, 2)
  assert.equal(normalized.overlayImageHistoryLimit, 40)
})

test('normalizeSettings clamps image card offset range', () => {
  const normalized = normalizeSettings({
    overlayImageCardOffsetXPercent: 999,
    overlayImageCardOffsetYPercent: -999,
    overlayPlayShowImageCard: false,
  })

  assert.equal(normalized.overlayPlayShowImageCard, false)
  assert.equal(normalized.overlayImageCardOffsetXPercent, 70)
  assert.equal(normalized.overlayImageCardOffsetYPercent, -45)
})

test('normalizeSettings clamps new clipboard automation limits', () => {
  const normalized = normalizeSettings({
    overlayImageAutoClipboardMaxConcurrent: 999,
    overlayImageHistoryLimit: -123,
  })

  assert.equal(normalized.overlayImageAutoClipboardMaxConcurrent, 6)
  assert.equal(normalized.overlayImageHistoryLimit, 10)
})

test('normalizeSettings keeps Alt+F4 guard setting with safe default', () => {
  assert.equal(normalizeSettings({}).blockAltF4WhenEnabled, false)
  assert.equal(normalizeSettings({ blockAltF4WhenEnabled: true }).blockAltF4WhenEnabled, true)
})

test('normalizeSettings keeps detached quick add position defaults and clamps values', () => {
  const defaulted = normalizeSettings({})
  assert.equal(defaulted.overlayQuickAddX, 40)
  assert.equal(defaulted.overlayQuickAddY, 86)

  const clamped = normalizeSettings({
    overlayQuickAddX: 999999,
    overlayQuickAddY: -999999,
  })
  assert.equal(clamped.overlayQuickAddX, 20000)
  assert.equal(clamped.overlayQuickAddY, -20000)
})
