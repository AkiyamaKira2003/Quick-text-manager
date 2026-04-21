'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getDefaultSettings, normalizeSettings } from '@/lib/defaults'
import type { Settings } from '@/types'

const WEB_SETTINGS_STORAGE_KEY = 'quicktext.settings.v3'
const SETTINGS_SAVE_DEBOUNCE_MS = 140
const SETTINGS_IPC_LOAD_TIMEOUT_MS = 2500
const MODE_LIST = ['dark', 'light'] as const
const PALETTE_LIST = ['icon', 'jade', 'crimson', 'dark', 'light'] as const

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const settingsRef = useRef<Settings | null>(null)
  const pendingPatchRef = useRef<Partial<Settings>>({})
  const saveTimerRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const flushPendingSettings = useCallback(async () => {
    if (saveInFlightRef.current) return

    const patch = pendingPatchRef.current
    if (Object.keys(patch).length === 0) return
    pendingPatchRef.current = {}

    if (window.electronAPI?.saveSettings) {
      saveInFlightRef.current = true
      try {
        const savePayload = isCriticalRuntimePatch(patch)
          ? {
              patch,
              immediate: true,
              awaitFlush: true,
            }
          : patch
        const updated = safeNormalizeSettings(await window.electronAPI.saveSettings(savePayload), settingsRef.current)
        settingsRef.current = updated
        setSettings(updated)
      } catch (error) {
        console.error('[settings] save-settings failed, fallback to local cache:', error)
        const fallback = settingsRef.current
        if (fallback) saveWebSettings(fallback)
      } finally {
        saveInFlightRef.current = false
      }

      if (Object.keys(pendingPatchRef.current).length > 0) {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current)
        }
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null
          void flushPendingSettings()
        }, SETTINGS_SAVE_DEBOUNCE_MS)
      }
      return
    }

    const fallback = settingsRef.current
    if (fallback) saveWebSettings(fallback)
  }, [])

  const scheduleSettingsFlush = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushPendingSettings()
    }, SETTINGS_SAVE_DEBOUNCE_MS)
  }, [flushPendingSettings])

  const updateSettings = useCallback(
    async (partial: Partial<Settings>) => {
      const current = settingsRef.current
      if (!current) return
      if (!hasPatchChanges(current, partial)) return

      const next = safeNormalizeSettings({ ...current, ...partial }, current)
      settingsRef.current = next
      setSettings(next)

      pendingPatchRef.current = { ...pendingPatchRef.current, ...partial }
      if (isCriticalRuntimePatch(partial)) {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        await flushPendingSettings()
        return
      }
      scheduleSettingsFlush()
    },
    [flushPendingSettings, scheduleSettingsFlush],
  )

  useEffect(() => {
    let mounted = true

    const init = async () => {
      const webFallback = loadWebSettings() ?? getDefaultSettings()

      if (window.electronAPI?.getSettings) {
        try {
          const loaded = await withTimeout(window.electronAPI.getSettings(), SETTINGS_IPC_LOAD_TIMEOUT_MS, 'getSettings timeout')
          const normalized = safeNormalizeSettings(loaded, webFallback)
          if (!mounted) return
          settingsRef.current = normalized
          setSettings(normalized)
          return
        } catch {
          // Fall through to web fallback.
        }
      }

      if (!mounted) return
      settingsRef.current = webFallback
      setSettings(webFallback)
    }

    void init()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onSettingsUpdated) return
    return window.electronAPI.onSettingsUpdated((next) => {
      const normalized = safeNormalizeSettings(next, settingsRef.current)
      settingsRef.current = normalized
      setSettings(normalized)
    })
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      void flushPendingSettings()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [flushPendingSettings])

  useEffect(() => {
    if (!settings) return
    applyUiTheme(settings)
  }, [settings])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      void flushPendingSettings()
    }
  }, [flushPendingSettings])

  return { settings, settingsRef, updateSettings }
}

function loadWebSettings(): Settings | null {
  try {
    const raw = window.localStorage.getItem(WEB_SETTINGS_STORAGE_KEY)
    if (!raw) return null
    return safeNormalizeSettings(JSON.parse(raw) as Partial<Settings>)
  } catch {
    return null
  }
}

function saveWebSettings(settings: Settings) {
  try {
    window.localStorage.setItem(WEB_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Ignore storage errors.
  }
}

function applyUiTheme(settings: Settings) {
  const root = document.documentElement
  const mode = MODE_LIST.includes(settings.uiMode) ? settings.uiMode : 'dark'
  const palette = PALETTE_LIST.includes(settings.uiPalette) ? settings.uiPalette : 'icon'
  const language = settings.uiLanguage === 'en' ? 'en' : 'vi'

  root.dataset.uiMode = mode
  root.dataset.uiPalette = palette
  root.lang = language
  root.classList.toggle('dark', mode === 'dark')
}

function hasPatchChanges(current: Settings, partial: Partial<Settings>) {
  const keys = Object.keys(partial) as Array<keyof Settings>
  for (const key of keys) {
    if (!isSameValue(current[key], partial[key])) return true
  }
  return false
}

function isSameValue(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (!a || !b) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!isSameValue(a[index], b[index])) return false
    }
    return true
  }
  if (typeof a === 'object') {
    if (!isPlainObject(a) || !isPlainObject(b)) return false
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false
      if (!isSameValue(left[key], right[key])) return false
    }
    return true
  }
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message))
    }, Math.max(300, Math.floor(timeoutMs)))

    promise
      .then((value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      })
  })
}

function isCriticalRuntimePatch(partial: Partial<Settings>) {
  return Object.prototype.hasOwnProperty.call(partial, 'appEnabled')
}

function safeNormalizeSettings(value: Partial<Settings> | Settings | null | undefined, fallback?: Settings | null) {
  try {
    return normalizeSettings(value ?? undefined)
  } catch (error) {
    console.error('[settings] normalize failed, fallback to safe defaults:', error)
    return fallback ?? getDefaultSettings()
  }
}
