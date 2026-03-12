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
  onTelemetryUpdated: (cb) => {
    const handler = (_event, telemetry) => cb(telemetry)
    ipcRenderer.on('telemetry:updated', handler)
    return () => ipcRenderer.removeListener('telemetry:updated', handler)
  },
  onProfilingUpdated: (cb) => {
    const handler = (_event, state) => cb(state)
    ipcRenderer.on('profiling:updated', handler)
    return () => ipcRenderer.removeListener('profiling:updated', handler)
  },
  onUpdateState: (cb) => {
    const handler = (_event, state) => cb(state)
    ipcRenderer.on('update:state', handler)
    return () => ipcRenderer.removeListener('update:state', handler)
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getTelemetry: () => ipcRenderer.invoke('telemetry:get'),
  getProfilingState: () => ipcRenderer.invoke('profiling:get-state'),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdateNow: () => ipcRenderer.invoke('update:install'),
  setProfilingConfig: (partial) => ipcRenderer.invoke('profiling:set-config', partial),
  reportReactProfileCommits: (payload) => ipcRenderer.invoke('profiling:report-react-commits', payload),
  reportPerformanceEntries: (payload) => ipcRenderer.invoke('profiling:report-performance-entries', payload),
  pythonSend: (payload) => ipcRenderer.invoke('python:send', payload),
  pythonConfigure: (payload) => ipcRenderer.invoke('python:configure', payload),
  pythonGetInputEvents: (after) => ipcRenderer.invoke('python:events', after),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  reportSendTelemetry: (payload) => ipcRenderer.invoke('telemetry:report-send', payload),
  reportHotkeyError: (payload) => ipcRenderer.invoke('telemetry:report-hotkey-error', payload),
  getWindowKind: () => ipcRenderer.invoke('get-window-kind'),
  notifyMainRendererReady: () => ipcRenderer.send('renderer:main-ready'),
  hideMainWindow: () => ipcRenderer.send('main:hide'),
  showMainWindow: () => ipcRenderer.send('main:show'),
  toggleMainWindow: () => ipcRenderer.send('main:toggle'),
  openSettingsWindow: () => ipcRenderer.send('settings:open'),
  hideSettingsWindow: () => ipcRenderer.send('settings:hide'),
  closeSettingsWindow: () => ipcRenderer.send('settings:close'),
  openHotkeyWindow: () => ipcRenderer.send('hotkey:open'),
  closeHotkeyWindow: () => ipcRenderer.send('hotkey:close'),
  openOverlaySettingsWindow: () => ipcRenderer.send('overlay-settings:open'),
  closeOverlaySettingsWindow: () => ipcRenderer.send('overlay-settings:close'),
  toggleOverlayVisibility: () => ipcRenderer.invoke('overlay:toggle-visibility'),
  toggleOverlayInteraction: () => ipcRenderer.invoke('overlay:toggle-interaction'),
  setOverlayInteraction: (interactive) => ipcRenderer.invoke('overlay:set-interaction', interactive),
  setOverlayMousePassThrough: (passThrough) => ipcRenderer.invoke('overlay:set-mouse-pass-through', passThrough),
  quitApp: () => ipcRenderer.send('app:quit'),
})
