const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onSendHotkey: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('trigger:send', handler)
    return () => ipcRenderer.removeListener('trigger:send', handler)
  },
  onSettingsUpdated: (cb) => {
    const handler = (_event, settings) => cb(settings)
    ipcRenderer.on('settings:updated', handler)
    return () => ipcRenderer.removeListener('settings:updated', handler)
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  pythonSend: (payload) => ipcRenderer.invoke('python:send', payload),
  pythonConfigure: (payload) => ipcRenderer.invoke('python:configure', payload),
  pythonGetInputEvents: (after) => ipcRenderer.invoke('python:events', after),
  reportSendTelemetry: (payload) => ipcRenderer.invoke('telemetry:report-send', payload),
  reportHotkeyError: (payload) => ipcRenderer.invoke('telemetry:report-hotkey-error', payload),
  toggleOverlayVisibility: () => ipcRenderer.invoke('overlay:toggle-visibility'),
  toggleOverlayInteraction: () => ipcRenderer.invoke('overlay:toggle-interaction'),
  toggleMainWindow: () => ipcRenderer.send('main:toggle'),
  setOverlayInteraction: (interactive) => ipcRenderer.invoke('overlay:set-interaction', interactive),
  setOverlayMousePassThrough: (passThrough) => ipcRenderer.invoke('overlay:set-mouse-pass-through', passThrough),
})
