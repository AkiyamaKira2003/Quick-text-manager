'use client'

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { formatUpdateStatusLabel } from '@/lib/update-status'
import QuickHotkeyPanel from '@/components/QuickHotkeyPanel'
import type { AppUpdateState, Settings } from '@/types'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Eye,
  EyeOff,
  FileText,
  Image,
  ImageIcon,
  Languages,
  Layers,
  MousePointerClick,
  ShieldBan,
  SlidersHorizontal,
} from 'lucide-react'

type SettingsContentProps = {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => Promise<void>
  className?: string
}

type StyleDraft = {
  opacity: number
  overlayToolsOpacity: number
  overlayToolsTextPanelOpacity: number
  overlayToolsImagePanelOpacity: number
  overlayHudContextOpacity: number
  textColor: string
  fontSize: number
}

const STYLE_SAVE_DEBOUNCE_MS = 140

const ALIGN_OPTIONS = [
  { value: 'left', icon: AlignLeft },
  { value: 'center', icon: AlignCenter },
  { value: 'right', icon: AlignRight },
] as const

const LANGUAGE_OPTIONS = [
  { value: 'vi', labelKey: 'settings.languageVi' },
  { value: 'en', labelKey: 'settings.languageEn' },
] as const

const MODE_OPTIONS = [
  { value: 'dark', labelKey: 'main.modeDark' },
  { value: 'light', labelKey: 'main.modeLight' },
] as const

const PALETTE_OPTIONS = [
  { value: 'icon', labelKey: 'main.paletteIcon' },
  { value: 'jade', labelKey: 'main.paletteJade' },
  { value: 'crimson', labelKey: 'main.paletteCrimson' },
  { value: 'dark', labelKey: 'main.paletteDark' },
  { value: 'light', labelKey: 'main.paletteLight' },
] as const

export default function SettingsContent({ settings, updateSettings, className = '' }: SettingsContentProps) {
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [styleDraft, setStyleDraft] = useState<StyleDraft>({
    opacity: settings.opacity,
    overlayToolsOpacity: settings.overlayToolsOpacity,
    overlayToolsTextPanelOpacity: settings.overlayToolsTextPanelOpacity,
    overlayToolsImagePanelOpacity: settings.overlayToolsImagePanelOpacity,
    overlayHudContextOpacity: settings.overlayHudContextOpacity,
    textColor: settings.textColor,
    fontSize: settings.fontSize,
  })

  const saveTimerRef = useRef<number | null>(null)
  const pendingPatchRef = useRef<Partial<Settings>>({})

  useEffect(() => {
    setStyleDraft({
      opacity: settings.opacity,
      overlayToolsOpacity: settings.overlayToolsOpacity,
      overlayToolsTextPanelOpacity: settings.overlayToolsTextPanelOpacity,
      overlayToolsImagePanelOpacity: settings.overlayToolsImagePanelOpacity,
      overlayHudContextOpacity: settings.overlayHudContextOpacity,
      textColor: settings.textColor,
      fontSize: settings.fontSize,
    })
  }, [
    settings.fontSize,
    settings.opacity,
    settings.overlayHudContextOpacity,
    settings.overlayToolsImagePanelOpacity,
    settings.overlayToolsTextPanelOpacity,
    settings.overlayToolsOpacity,
    settings.textColor,
  ])

  const flushPendingPatch = useCallback(() => {
    const patch = pendingPatchRef.current
    pendingPatchRef.current = {}
    if (Object.keys(patch).length === 0) return
    void updateSettings(patch)
  }, [updateSettings])

  const queuePatch = useCallback(
    (patch: Partial<Settings>) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...patch }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        flushPendingPatch()
      }, STYLE_SAVE_DEBOUNCE_MS)
    },
    [flushPendingPatch],
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      flushPendingPatch()
    }
  }, [flushPendingPatch])

  const language = settings.uiLanguage
  const disableTextModuleToggle = settings.overlayToolsShowTextManager && !settings.overlayToolsShowImageTranslate
  const disableImageModuleToggle = settings.overlayToolsShowImageTranslate && !settings.overlayToolsShowTextManager
  const withState = (label: string, enabled: boolean) =>
    `${label} · ${enabled ? t(language, 'main.enabled') : t(language, 'main.disabled')}`

  useEffect(() => {
    let mounted = true
    if (!window.electronAPI?.getUpdateState) return () => undefined

    void window.electronAPI
      .getUpdateState()
      .then((state) => {
        if (!mounted) return
        setUpdateState(state)
      })
      .catch(() => undefined)

    if (!window.electronAPI?.onUpdateState) {
      return () => {
        mounted = false
      }
    }

    const unsubscribe = window.electronAPI.onUpdateState((state) => {
      if (!mounted) return
      setUpdateState(state)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const checkForUpdates = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdates) return
    setIsCheckingUpdate(true)
    try {
      const state = await window.electronAPI.checkForUpdates()
      setUpdateState(state)
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [])

  const installUpdateNow = useCallback(async () => {
    if (!window.electronAPI?.installUpdateNow) return
    setIsInstallingUpdate(true)
    try {
      const result = await window.electronAPI.installUpdateNow()
      if (result?.state) {
        setUpdateState(result.state)
      }
      if (!result?.ok) {
        setIsInstallingUpdate(false)
      }
    } catch {
      setIsInstallingUpdate(false)
    }
  }, [])

  const hasElectronBridge = typeof window !== 'undefined' && !!window.electronAPI
  const updateStatusLabel = hasElectronBridge
    ? formatUpdateStatusLabel(language, updateState)
    : t(language, 'settings.updateStatusUnsupported')
  const canUseUpdateCheck = hasElectronBridge && typeof window.electronAPI?.checkForUpdates === 'function'
  const canInstallUpdate = !!updateState && updateState.stage === 'downloaded' && !isInstallingUpdate
  const disableCheckButton =
    isCheckingUpdate ||
    isInstallingUpdate ||
    !canUseUpdateCheck ||
    updateState?.stage === 'checking' ||
    updateState?.stage === 'downloading' ||
    updateState?.stage === 'installing'

  return (
    <div className={`space-y-4 ${className}`}>
      <section className="rounded-3xl border-2 border-[var(--qt-border)] bg-[var(--qt-surface)] p-4 qt-elev-medium">
        <p className="text-xs uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'settings.appearance')}</p>
        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3">
          <label className="block rounded-xl border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-2 text-xs text-[var(--qt-muted)]">
            <span>{t(language, 'settings.language')}</span>
            <select
              value={settings.uiLanguage}
              onChange={(event) => void updateSettings({ uiLanguage: event.target.value as Settings['uiLanguage'] })}
              className="mt-1 h-9 w-full rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface)] px-2 text-sm text-[var(--qt-fg)] outline-none focus:border-[var(--qt-primary)]"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(language, option.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="block rounded-xl border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-2 text-xs text-[var(--qt-muted)]">
            <span>{t(language, 'settings.mode')}</span>
            <select
              value={settings.uiMode}
              onChange={(event) => void updateSettings({ uiMode: event.target.value as Settings['uiMode'] })}
              className="mt-1 h-9 w-full rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface)] px-2 text-sm text-[var(--qt-fg)] outline-none focus:border-[var(--qt-primary)]"
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(language, option.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="block rounded-xl border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-2 text-xs text-[var(--qt-muted)]">
            <span>{t(language, 'settings.palette')}</span>
            <select
              value={settings.uiPalette}
              onChange={(event) => void updateSettings({ uiPalette: event.target.value as Settings['uiPalette'] })}
              className="mt-1 h-9 w-full rounded-md border border-[var(--qt-border)] bg-[var(--qt-surface)] px-2 text-sm text-[var(--qt-fg)] outline-none focus:border-[var(--qt-primary)]"
            >
              {PALETTE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(language, option.labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-3xl border-2 border-[var(--qt-border)] bg-[var(--qt-surface)] p-4 qt-elev-medium">
        <p className="text-xs uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'settings.updateTitle')}</p>
        <div className="mt-2 rounded-xl border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-3">
          <p className="text-xs text-[var(--qt-muted)]">
            {t(language, 'settings.updateCurrentVersion', {
              version: updateState?.currentVersion ? `v${updateState.currentVersion}` : '-',
            })}
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--qt-fg)]">{updateStatusLabel}</p>
          {updateState?.availableVersion ? (
            <p className="mt-1 text-xs text-[var(--qt-muted)]">
              {t(language, 'settings.updateAvailableVersion', { version: updateState.availableVersion })}
            </p>
          ) : null}
          {updateState?.downloadPercent && updateState.downloadPercent > 0 && updateState.downloadPercent < 100 ? (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/20">
              <div
                className="h-full rounded-full bg-[var(--qt-primary)] transition-[width] duration-180 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ width: `${Math.max(0, Math.min(100, updateState.downloadPercent))}%` }}
              />
            </div>
          ) : null}
          {updateState?.error ? (
            <p className="mt-2 text-xs text-red-300">{t(language, 'settings.updateError', { message: updateState.error })}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void checkForUpdates()}
              disabled={disableCheckButton}
              className="rounded-lg border border-[var(--qt-primary)] bg-[var(--qt-primary)]/20 px-3 py-1.5 text-xs font-semibold text-[var(--qt-fg)] disabled:opacity-50"
            >
              {isCheckingUpdate || updateState?.stage === 'checking'
                ? t(language, 'settings.updateChecking')
                : t(language, 'settings.updateCheck')}
            </button>
            <button
              onClick={() => void installUpdateNow()}
              disabled={!canInstallUpdate}
              className="rounded-lg border border-emerald-400/60 bg-emerald-400/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-50"
            >
              {isInstallingUpdate ? t(language, 'settings.updateInstalling') : t(language, 'settings.updateInstall')}
            </button>
          </div>
        </div>
      </section>

      <QuickHotkeyPanel settings={settings} updateSettings={updateSettings} />

      <section className="rounded-3xl border-2 border-[var(--qt-border)] bg-[var(--qt-surface)] p-4 qt-elev-medium">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'settings.overlay')}</p>
            <IconHoverButton
              onClick={() => void updateSettings({ overlayVisible: !settings.overlayVisible })}
              icon={settings.overlayVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              label={withState(t(language, 'settings.overlayMaster'), settings.overlayVisible)}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-semibold ${
                settings.overlayVisible
                  ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                  : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
              }`}
            />
            <IconHoverButton
              onClick={() => void updateSettings({ overlayElementsVisible: !settings.overlayElementsVisible })}
              icon={<Layers className="size-4" />}
              label={withState(t(language, 'settings.overlayElementsMaster'), settings.overlayElementsVisible)}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-semibold ${
                settings.overlayElementsVisible
                  ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                  : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
              }`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'settings.elements')}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <IconHoverButton
                onClick={() => void updateSettings({ overlayShowIcon: !settings.overlayShowIcon })}
                icon={<Image className="size-4" />}
                label={withState(t(language, 'main.overlayShowIcon'), settings.overlayShowIcon)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                  settings.overlayShowIcon
                    ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                    : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
                }`}
              />
              <IconHoverButton
                onClick={() =>
                  void updateSettings({
                    overlayToolsShowTextManager: !settings.overlayToolsShowTextManager,
                    overlayToolsShowImageTranslate:
                      !settings.overlayToolsShowTextManager && !settings.overlayToolsShowImageTranslate
                        ? true
                        : settings.overlayToolsShowImageTranslate,
                  })
                }
                disabled={disableTextModuleToggle}
                icon={<FileText className="size-4" />}
                label={withState(t(language, 'overlayTools.tabText'), settings.overlayToolsShowTextManager)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                  settings.overlayToolsShowTextManager
                    ? 'border-cyan-300/70 bg-cyan-500/20 text-cyan-100'
                    : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
                }`}
              />
              <IconHoverButton
                onClick={() =>
                  void updateSettings({
                    overlayToolsShowImageTranslate: !settings.overlayToolsShowImageTranslate,
                    overlayToolsShowTextManager:
                      !settings.overlayToolsShowImageTranslate && !settings.overlayToolsShowTextManager
                        ? true
                        : settings.overlayToolsShowTextManager,
                  })
                }
                disabled={disableImageModuleToggle}
                icon={<Languages className="size-4" />}
                label={withState(t(language, 'overlayTools.tabImage'), settings.overlayToolsShowImageTranslate)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                  settings.overlayToolsShowImageTranslate
                    ? 'border-cyan-300/70 bg-cyan-500/20 text-cyan-100'
                    : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
                }`}
              />
              <IconHoverButton
                onClick={() => void updateSettings({ overlayToolsPanelVisible: !settings.overlayToolsPanelVisible })}
                icon={<SlidersHorizontal className="size-4" />}
                label={withState(t(language, 'settings.overlayToolsPanel'), settings.overlayToolsPanelVisible)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                  settings.overlayToolsPanelVisible
                    ? 'border-cyan-300/70 bg-cyan-500/20 text-cyan-100'
                    : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
                }`}
              />
              <IconHoverButton
                onClick={() => void updateSettings({ overlayPlayShowImageCard: !settings.overlayPlayShowImageCard })}
                icon={<ImageIcon className="size-4" />}
                label={withState(t(language, 'settings.overlayPlayShowImageCard'), settings.overlayPlayShowImageCard)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                  settings.overlayPlayShowImageCard
                    ? 'border-cyan-300/70 bg-cyan-500/20 text-cyan-100'
                    : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
                }`}
              />
            </div>
            <p className="text-[11px] text-[var(--qt-muted)]">{t(language, 'settings.overlayToolsHint')}</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'settings.interaction')}</p>
          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
            <IconHoverButton
              onClick={() => void updateSettings({ overlaySmartClickThrough: !settings.overlaySmartClickThrough })}
              icon={<MousePointerClick className="size-4" />}
              label={withState(t(language, 'settings.smartClickThrough'), settings.overlaySmartClickThrough)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                settings.overlaySmartClickThrough
                  ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                  : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
              }`}
            />

            <IconHoverButton
              onClick={() =>
                void updateSettings({
                  blockAltF4WhenEnabled: !settings.blockAltF4WhenEnabled,
                })
              }
              icon={<ShieldBan className="size-4" />}
              label={withState(t(language, 'settings.blockAltF4WhenEnabled'), settings.blockAltF4WhenEnabled)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                settings.blockAltF4WhenEnabled
                  ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                  : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
              }`}
            />

            <OverlaySlider
              label={t(language, 'settings.snapTolerance', { value: Math.round(settings.overlaySnapTolerancePx) })}
              value={settings.overlaySnapTolerancePx}
              min={4}
              max={28}
              step={1}
              onChange={(value) => void updateSettings({ overlaySnapTolerancePx: value })}
            />

            <OverlaySlider
              label={t(language, 'settings.dragDelay', { value: Math.round(settings.overlayDragDelayMs) })}
              value={settings.overlayDragDelayMs}
              min={0}
              max={180}
              step={5}
              onChange={(value) => void updateSettings({ overlayDragDelayMs: value })}
            />

            <OverlaySlider
              label={t(language, 'settings.dragFriction', { value: Math.round(settings.overlayDragFrictionMs) })}
              value={settings.overlayDragFrictionMs}
              min={0}
              max={24}
              step={1}
              onChange={(value) => void updateSettings({ overlayDragFrictionMs: value })}
            />

            <OverlaySlider
              label={t(language, 'settings.preciseDrag', { value: Math.round(settings.overlayPreciseDragFactor * 100) })}
              value={settings.overlayPreciseDragFactor}
              min={0.08}
              max={0.7}
              step={0.01}
              onChange={(value) => void updateSettings({ overlayPreciseDragFactor: value })}
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'settings.style')}</p>
          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-6">
            <OverlaySlider
              label={t(language, 'overlay.opacity')}
              value={styleDraft.opacity}
              min={0.2}
              max={1}
              step={0.05}
              onChange={(value) => {
                setStyleDraft((current) => ({ ...current, opacity: value }))
                queuePatch({ opacity: value })
              }}
            />
            <OverlaySlider
              label={t(language, 'settings.overlayToolsOpacity', { value: Math.round(styleDraft.overlayToolsOpacity * 100) })}
              value={styleDraft.overlayToolsOpacity}
              min={0.2}
              max={1}
              step={0.05}
              onChange={(value) => {
                setStyleDraft((current) => ({ ...current, overlayToolsOpacity: value }))
                queuePatch({ overlayToolsOpacity: value })
              }}
            />
            <OverlaySlider
              label={t(language, 'overlay.wordSize')}
              value={styleDraft.fontSize}
              min={24}
              max={120}
              step={1}
              onChange={(value) => {
                setStyleDraft((current) => ({ ...current, fontSize: value }))
                queuePatch({ fontSize: value })
              }}
            />
            <OverlaySlider
              label={t(language, 'settings.overlayToolsTextOpacity', { value: Math.round(styleDraft.overlayToolsTextPanelOpacity * 100) })}
              value={styleDraft.overlayToolsTextPanelOpacity}
              min={0.2}
              max={1}
              step={0.05}
              onChange={(value) => {
                setStyleDraft((current) => ({ ...current, overlayToolsTextPanelOpacity: value }))
                queuePatch({ overlayToolsTextPanelOpacity: value })
              }}
            />
            <OverlaySlider
              label={t(language, 'settings.overlayToolsImageOpacity', { value: Math.round(styleDraft.overlayToolsImagePanelOpacity * 100) })}
              value={styleDraft.overlayToolsImagePanelOpacity}
              min={0.2}
              max={1}
              step={0.05}
              onChange={(value) => {
                setStyleDraft((current) => ({ ...current, overlayToolsImagePanelOpacity: value }))
                queuePatch({ overlayToolsImagePanelOpacity: value })
              }}
            />
            <OverlaySlider
              label={t(language, 'settings.overlayHudContextOpacity', { value: Math.round(styleDraft.overlayHudContextOpacity * 100) })}
              value={styleDraft.overlayHudContextOpacity}
              min={0.2}
              max={1}
              step={0.05}
              onChange={(value) => {
                setStyleDraft((current) => ({ ...current, overlayHudContextOpacity: value }))
                queuePatch({ overlayHudContextOpacity: value })
              }}
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-1">
            <label className="block rounded-xl border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-2 text-xs text-[var(--qt-muted)]">
              <span>
                {t(language, 'overlay.elementText')} {t(language, 'overlay.color')}
              </span>
              <input
                type="color"
                value={styleDraft.textColor}
                onChange={(event) => {
                  const parsed = normalizeColorInput(event.target.value)
                  if (!parsed) return
                  setStyleDraft((current) => ({ ...current, textColor: parsed }))
                  queuePatch({ textColor: parsed })
                }}
                className="mt-1 h-8 w-full cursor-pointer rounded border border-[var(--qt-border)] bg-[var(--qt-surface)] p-0.5"
              />
            </label>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'settings.align')}</p>
          <div className="grid grid-cols-3 gap-1">
            {ALIGN_OPTIONS.map(({ value: align, icon: AlignIcon }) => (
              <IconHoverButton
                key={align}
                onClick={() => void updateSettings({ textAlign: align })}
                icon={<AlignIcon className="size-4" />}
                label={align}
                className={`rounded-xl border py-1 text-[11px] font-semibold uppercase tracking-wide ${
                  settings.textAlign === align
                    ? 'border-[var(--qt-primary)] bg-[var(--qt-primary)] text-[var(--qt-on-primary)]'
                    : 'border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-fg)]'
                }`}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

type OverlaySliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function OverlaySlider({ label, value, min, max, step, onChange }: OverlaySliderProps) {
  return (
    <label className="block rounded-xl border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] p-2 text-xs text-[var(--qt-muted)]">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
        className="mt-1 w-full accent-[var(--qt-primary)]"
      />
    </label>
  )
}

type IconHoverButtonProps = {
  label: string
  icon: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

function IconHoverButton({ label, icon, className, title, 'aria-label': ariaLabel, ...props }: IconHoverButtonProps) {
  return (
    <button
      {...props}
      title={title ?? label}
      aria-label={ariaLabel ?? label}
      className={`group inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold ${className ?? ''}`}
    >
      <span className="inline-flex items-center justify-center group-hover:hidden">{icon}</span>
      <span className="hidden group-hover:inline">{label}</span>
    </button>
  )
}

function normalizeColorInput(value: string) {
  const normalized = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized
  return ''
}
