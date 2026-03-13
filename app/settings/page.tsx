'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useSettings } from '@/hooks/use-settings'
import { t } from '@/lib/i18n'
import SettingsContent from '@/components/SettingsContent'
import { X } from 'lucide-react'

type ElectronRegionStyle = CSSProperties & { WebkitAppRegion: 'drag' | 'no-drag' }

const dragRegionStyle: ElectronRegionStyle = { WebkitAppRegion: 'drag' }
const noDragRegionStyle: ElectronRegionStyle = { WebkitAppRegion: 'no-drag' }
const SETTINGS_WINDOW_MOTION_MS = 240

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings()
  const [isVisible, setIsVisible] = useState(false)
  const closingRef = useRef(false)
  const closeTimerRef = useRef<number | null>(null)

  const closeWindowNow = useCallback(() => {
    if (window.electronAPI?.closeSettingsWindow) {
      window.electronAPI.closeSettingsWindow()
      return
    }
    if (window.electronAPI?.closeHotkeyWindow) {
      window.electronAPI.closeHotkeyWindow()
      return
    }
    if (window.electronAPI?.closeOverlaySettingsWindow) {
      window.electronAPI.closeOverlaySettingsWindow()
      return
    }
    window.close()
  }, [])

  const closeWindow = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setIsVisible(false)
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      closeWindowNow()
    }, SETTINGS_WINDOW_MOTION_MS)
  }, [closeWindowNow])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsVisible(true))
    return () => {
      window.cancelAnimationFrame(frame)
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeWindow()
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [closeWindow])

  if (!settings) return null
  const language = settings.uiLanguage

  return (
    <div
      className="h-dvh w-full overflow-hidden bg-transparent text-foreground"
    >
      <main className="qt-shell qt-window-shell h-full rounded-[28px]">
        <section
          className={`qt-settings-slide flex h-full flex-col ${
            isVisible ? 'qt-settings-slide-open' : 'qt-settings-slide-closed'
          }`}
        >
          <header className="border-b border-[var(--qt-border)]/65 bg-[color-mix(in_oklab,var(--qt-surface)_86%,transparent)] p-4" style={dragRegionStyle}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-[var(--qt-fg)]">{t(language, 'settings.windowTitle')}</h1>
                <p className="mt-1 text-sm text-[var(--qt-muted)]">{t(language, 'settings.windowSubtitle')}</p>
              </div>
              <button
                onClick={closeWindow}
                className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-red-500/60 bg-red-500/15 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/25"
                style={noDragRegionStyle}
                title={t(language, 'settings.closeWindow')}
                aria-label={t(language, 'settings.closeWindow')}
              >
                <span className="inline-flex items-center justify-center">
                  <X className="size-4" />
                </span>
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-auto p-3 sm:p-4" style={noDragRegionStyle}>
            <SettingsContent settings={settings} updateSettings={updateSettings} />
          </div>
        </section>
      </main>
    </div>
  )
}
