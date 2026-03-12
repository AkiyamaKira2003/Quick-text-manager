'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { useSettings } from '@/hooks/use-settings'
import { formatComboForDisplay, getEffectiveHotkeyBindings } from '@/lib/hotkeys'
import { t, type MessageKey } from '@/lib/i18n'
import type { HotkeyActionId, ProfilingRuntimeState, TelemetrySnapshot } from '@/types'
import { Minus, Power, Settings2, X } from 'lucide-react'
import ProfilingShell from '@/components/ProfilingShell'

type ElectronRegionStyle = CSSProperties & { WebkitAppRegion: 'drag' | 'no-drag' }

type HotkeyChip = {
  actionId: HotkeyActionId
  labelKey: MessageKey
}

const HOTKEY_CHIPS: HotkeyChip[] = [
  { actionId: 'overlay.toggle_visibility', labelKey: 'main.hotkeyOverlayToggleLabel' },
  { actionId: 'app.toggle_enabled', labelKey: 'main.hotkeyAppToggleLabel' },
  { actionId: 'overlay.toggle_interaction', labelKey: 'main.hotkeyOverlayEditLabel' },
  { actionId: 'text.send_current', labelKey: 'main.hotkeySendLabel' },
  { actionId: 'main.toggle_visibility', labelKey: 'main.hotkeyMainToggleLabel' },
]

const dragRegionStyle: ElectronRegionStyle = { WebkitAppRegion: 'drag' }
const noDragRegionStyle: ElectronRegionStyle = { WebkitAppRegion: 'no-drag' }
const TextManager = dynamic(() => import('@/components/TextManager'), {
  loading: () => (
    <section className="rounded-3xl border border-[var(--qt-border)] bg-[color-mix(in_oklab,var(--qt-surface)_72%,transparent)] p-4 text-sm text-[var(--qt-muted)]">
      Loading text manager...
    </section>
  ),
})

export default function MainPage() {
  const { settings, updateSettings } = useSettings()
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null)
  const [profiling, setProfiling] = useState<ProfilingRuntimeState | null>(null)
  const hasNotifiedMainReadyRef = useRef(false)

  const closeApp = useCallback(() => {
    if (window.electronAPI?.quitApp) {
      window.electronAPI.quitApp()
      return
    }
    window.close()
  }, [])

  const toggleLanguage = useCallback(() => {
    if (!settings) return
    const nextLanguage = settings.uiLanguage === 'vi' ? 'en' : 'vi'
    void updateSettings({ uiLanguage: nextLanguage })
  }, [settings, updateSettings])

  const openSettings = useCallback(() => {
    if (window.electronAPI?.openSettingsWindow) {
      window.electronAPI.openSettingsWindow()
      return
    }
    window.location.href = '/settings'
  }, [])

  useEffect(() => {
    let mounted = true

    if (window.electronAPI?.getTelemetry) {
      void window.electronAPI
        .getTelemetry()
        .then((snapshot) => {
          if (!mounted) return
          setTelemetry(snapshot)
        })
        .catch(() => {
          // Keep main UI functional without telemetry bridge.
        })
    }

    if (!window.electronAPI?.onTelemetryUpdated) {
      return () => {
        mounted = false
      }
    }

    const unsubscribe = window.electronAPI.onTelemetryUpdated((snapshot) => {
      if (!mounted) return
      setTelemetry(snapshot)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let mounted = true

    if (window.electronAPI?.getProfilingState) {
      void window.electronAPI
        .getProfilingState()
        .then((state) => {
          if (!mounted) return
          setProfiling(state)
        })
        .catch(() => undefined)
    }

    if (!window.electronAPI?.onProfilingUpdated) {
      return () => {
        mounted = false
      }
    }

    const unsubscribe = window.electronAPI.onProfilingUpdated((state) => {
      if (!mounted) return
      setProfiling(state)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent'
    document.documentElement.style.backgroundColor = 'transparent'
    return () => {
      document.body.style.backgroundColor = ''
      document.documentElement.style.backgroundColor = ''
    }
  }, [])

  useEffect(() => {
    if (!settings) return
    if (hasNotifiedMainReadyRef.current) return
    hasNotifiedMainReadyRef.current = true
    window.electronAPI?.notifyMainRendererReady?.()
  }, [settings])

  const language = settings?.uiLanguage ?? 'vi'
  const effectiveBindings = useMemo(() => (settings ? getEffectiveHotkeyBindings(settings) : []), [settings])
  const comboByActionId = useMemo(
    () => new Map(effectiveBindings.map((item) => [item.action.id, formatComboForDisplay(item.combo)])),
    [effectiveBindings],
  )
  const appToggleCombo = comboByActionId.get('app.toggle_enabled') ?? formatComboForDisplay(settings?.appToggleHotkey ?? 'Shift+5')
  const sendSuccessCount = telemetry?.send.successCount ?? 0
  const sendFailureCount = telemetry?.send.failureCount ?? 0
  const hotkeyErrorCount = telemetry?.hotkey.errorCount ?? 0
  const latencySummary =
    telemetry?.send.lastLatencyMs === null || typeof telemetry?.send.lastLatencyMs === 'undefined'
      ? '-'
      : `${Math.round(telemetry.send.lastLatencyMs)}ms/${Math.round(telemetry.send.avgLatencyMs)}ms`
  const hotkeyErrorTitle = telemetry?.hotkey.lastError
    ? `${telemetry.hotkey.lastErrorSource}: ${telemetry.hotkey.lastError}`
    : t(language, 'main.none')
  const profilingTitle = profiling?.lastError || profiling?.lastTracePath || t(language, 'main.none')
  const profilingSummary = profiling ? `${Math.round(profiling.durationMs / 1000)}s/${Math.round(profiling.intervalMs / 1000)}s` : '-'
  const profilingStatus = profiling?.enabled ? t(language, 'main.statusOn') : t(language, 'main.statusOff')
  const appToggleLabel = settings?.appEnabled
    ? t(language, 'main.toggleAppOff', { hotkey: appToggleCombo })
    : t(language, 'main.toggleAppOn', { hotkey: appToggleCombo })

  if (!settings) {
    return (
      <ProfilingShell>
        <div className="h-dvh w-full overflow-hidden bg-transparent p-2 text-foreground">
          <main className="qt-shell qt-window-shell relative flex h-full min-h-0 w-full flex-col gap-3 rounded-[22px] p-3 sm:p-4">
            <section className="rounded-3xl border border-[var(--qt-border)] bg-[color-mix(in_oklab,var(--qt-surface)_82%,transparent)] p-5 text-sm text-[var(--qt-muted)]">
              Đang nạp cài đặt QuickText... Nếu là lần chạy đầu, app có thể cần thêm vài giây để chuẩn bị dữ liệu.
            </section>
          </main>
        </div>
      </ProfilingShell>
    )
  }

  return (
    <ProfilingShell>
      <div className="h-dvh w-full overflow-hidden bg-transparent p-2 text-foreground">
        <main className="qt-shell qt-window-shell relative flex h-full min-h-0 w-full flex-col gap-3 rounded-[22px] p-3 sm:p-4">
          <header className="relative rounded-3xl qt-panel qt-elev-medium p-4" style={dragRegionStyle}>
            <div className="qt-stagger-sm absolute right-4 top-4 z-20 flex items-center gap-1.5" style={noDragRegionStyle}>
              <button
                onClick={() =>
                  void updateSettings(
                    settings.appEnabled
                      ? {
                          appEnabled: false,
                          overlayVisible: false,
                          overlayInteractive: false,
                        }
                      : {
                          appEnabled: true,
                          overlayVisible: true,
                          overlayInteractive: false,
                        },
                  )
                }
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                  settings.appEnabled
                    ? 'border-emerald-400/60 bg-emerald-400/18 text-emerald-100 hover:bg-emerald-400/28'
                    : 'border-red-500/65 bg-red-500/18 text-red-200 hover:bg-red-500/28'
                }`}
                title={appToggleLabel}
                aria-label={appToggleLabel}
              >
                <Power className="size-4" />
              </button>
              <button
                onClick={() => void toggleLanguage()}
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] px-2 text-[10px] font-semibold text-[var(--qt-fg)] hover:border-[var(--qt-primary)]"
                title={settings.uiLanguage === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
                aria-label={settings.uiLanguage === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
              >
                {settings.uiLanguage === 'vi' ? 'VI' : 'EN'}
              </button>
              <button
                onClick={openSettings}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)] hover:border-[var(--qt-primary)]"
                title={t(language, 'main.openSettings')}
                aria-label={t(language, 'main.openSettings')}
              >
                <Settings2 className="size-4" />
              </button>
              <button
                onClick={() => window.electronAPI?.hideMainWindow?.()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)] hover:border-[var(--qt-primary)]"
                title={t(language, 'main.hideManager')}
                aria-label={t(language, 'main.hideManager')}
              >
                <Minus className="size-4" />
              </button>
              <button
                onClick={closeApp}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/60 bg-red-500/15 text-red-200 hover:bg-red-500/25"
                title="Close App"
                aria-label="Close App"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl qt-panel-soft">
                  <Image src="/icon.png" alt="QuickText icon" fill sizes="56px" className="object-cover" priority />
                </div>
                <div className="min-w-0">
                  <div className="relative inline-flex max-w-full flex-col group/title">
                    <h1 className="truncate text-xl font-bold tracking-wide text-[var(--qt-fg)]">{t(language, 'main.title')}</h1>
                    <p className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-max max-w-[min(40rem,80vw)] rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface)] px-2.5 py-1 text-xs text-[var(--qt-muted)] opacity-0 qt-elev-soft qt-motion qt-motion-fast translate-y-1 group-hover/title:translate-y-0 group-hover/title:opacity-100">
                      {t(language, 'main.compactIntro')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2" style={noDragRegionStyle}>
                <div className="qt-stagger-sm flex max-w-full flex-wrap items-center justify-end gap-1 text-[10px] font-semibold">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${
                      settings.overlayVisible
                        ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)]/20 text-[var(--qt-fg)]'
                        : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-muted)]'
                    }`}
                  >
                    {t(language, 'main.overlayStatePrefix')} {settings.overlayVisible ? t(language, 'main.statusOn') : t(language, 'main.statusOff')}
                  </span>
                  {HOTKEY_CHIPS.map((chip) => (
                    <span
                      key={chip.actionId}
                      className="max-w-[42ch] truncate rounded-full border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] px-2 py-0.5 text-[var(--qt-muted)]"
                      title={`${t(language, chip.labelKey)}: ${comboByActionId.get(chip.actionId) ?? '-'}`}
                    >
                      {t(language, chip.labelKey)}: {comboByActionId.get(chip.actionId) ?? '-'}
                    </span>
                  ))}
                  <span className="rounded-full border border-emerald-400/50 bg-emerald-400/15 px-2 py-0.5 text-emerald-100">
                    {t(language, 'main.telemetrySendSuccess')}: {sendSuccessCount}
                  </span>
                  <span className="rounded-full border border-rose-400/50 bg-rose-400/15 px-2 py-0.5 text-rose-100">
                    {t(language, 'main.telemetrySendFailure')}: {sendFailureCount}
                  </span>
                  <span className="max-w-[32ch] truncate rounded-full border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] px-2 py-0.5 text-[var(--qt-muted)]">
                    {t(language, 'main.telemetryLatency', { value: latencySummary })}
                  </span>
                  <span
                    className="max-w-[32ch] truncate rounded-full border border-amber-400/50 bg-amber-400/15 px-2 py-0.5 text-amber-100"
                    title={hotkeyErrorTitle}
                  >
                    {t(language, 'main.telemetryHotkeyErrors')}: {hotkeyErrorCount}
                  </span>
                  <span
                    className="max-w-[36ch] truncate rounded-full border border-cyan-400/50 bg-cyan-400/15 px-2 py-0.5 text-cyan-100"
                    title={profilingTitle}
                  >
                    {t(language, 'main.profilingStatusLabel')}: {profilingStatus} ({profilingSummary})
                  </span>
                </div>

              </div>
            </div>
          </header>

          <TextManager settings={settings} updateSettings={updateSettings} />
        </main>
      </div>
    </ProfilingShell>
  )
}
