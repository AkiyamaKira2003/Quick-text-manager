import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createHotkeyPatchFromOverrides,
  deriveHotkeyOverridesFromSettings,
  findHotkeyConflict,
  formatComboForDisplay,
} from '../lib/hotkeys'

test('createHotkeyPatchFromOverrides keeps explicit null binding', () => {
  const patch = createHotkeyPatchFromOverrides({
    'text.send_current': null,
  })

  assert.equal(patch.sendHotkey, null)
  assert.equal(patch.hotkeyOverrides['text.send_current'], null)
})

test('deriveHotkeyOverridesFromSettings keeps null hotkey from settings', () => {
  const overrides = deriveHotkeyOverridesFromSettings({
    appToggleHotkey: 'Shift+5',
    overlayToggleHotkey: 'Ctrl+Shift+1',
    mainToggleHotkey: 'Delete',
    overlayEditHotkey: 'Tab',
    sendHotkey: null,
    hotkeyOverrides: {},
  })

  assert.equal(overrides['text.send_current'], null)
})

test('findHotkeyConflict ignores null combo candidate', () => {
  const conflict = findHotkeyConflict(
    {
      actionId: 'text.send_current',
      combo: null,
      context: 'global',
    },
    [
      {
        actionId: 'overlay.toggle_visibility',
        combo: 'Ctrl+Shift+1',
        context: 'global',
      },
    ],
  )

  assert.equal(conflict, null)
})

test('formatComboForDisplay renders null as None', () => {
  assert.equal(formatComboForDisplay(null), 'None')
  assert.equal(formatComboForDisplay(undefined), 'None')
})
