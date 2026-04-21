'use client'

import { useCallback, type ReactNode } from 'react'
import { useSettings } from '@/hooks/use-settings'
import { t } from '@/lib/i18n'
import {
  Eye,
  EyeOff,
  GripHorizontal,
  Layers3,
  Power,
  Settings2,
  SlidersHorizontal,
  Square,
  SquareDashed,
  X,
} from 'lucide-react'

type Tone = 'default' | 'danger' | 'success' | 'accent'

export default function TrayMenuPage() {
  const { settings, updateSettings } = useSettings()

  const closeMenu = useCallback(() => {
    window.close()
  }, [])

  const withClose = useCallback(
    (action: () => unknown | Promise<unknown>) => {
      void Promise.resolve(action()).finally(() => {
        closeMenu()
      })
    },
    [closeMenu],
  )

  if (!settings) {
    return (
      <main className="h-screen w-full bg-transparent p-2">
        <section className="qt-window-shell h-full rounded-2xl border border-[var(--qt-border)] bg-[var(--qt-surface)] p-3 text-xs text-[var(--qt-muted)]">
          Loading tray menu...
        </section>
      </main>
    )
  }

  const language = settings.uiLanguage
  const isAppOn = !!settings.appEnabled
  const isOverlayOn = !!settings.overlayVisible
  const isOverlayInteractive = !!settings.overlayInteractive

  const toggleApp = () => {
    if (isAppOn) {
      return updateSettings({
        appEnabled: false,
        overlayVisible: false,
        overlayInteractive: false,
      })
    }

    return updateSettings({
      appEnabled: true,
      overlayVisible: true,
      overlayInteractive: false,
    })
  }

  return (
    <main
      data-tray-menu="true"
      className="h-dvh w-full overflow-hidden bg-transparent p-1.5 text-[var(--qt-fg)]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <section className="qt-window-shell flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--qt-border)] bg-[color-mix(in_oklab,var(--qt-surface)_88%,transparent)] p-2">
        <header className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-[var(--qt-border)] bg-[color-mix(in_oklab,var(--qt-surface-soft)_84%,transparent)] px-3 py-2">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-[var(--qt-muted)]">
              <GripHorizontal className="size-3.5" />
              Quick Text
            </p>
            <h1 className="mt-0.5 truncate text-sm font-semibold text-[var(--qt-fg)]">Tray Control</h1>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <StatusPill
                tone={isAppOn ? 'success' : 'danger'}
                label={`${language === 'en' ? 'App' : 'Ứng dụng'} · ${t(language, isAppOn ? 'main.statusOn' : 'main.statusOff')}`}
              />
              <StatusPill
                tone={isOverlayOn ? 'accent' : 'default'}
                label={`${language === 'en' ? 'Overlay' : 'Lớp phủ'} · ${t(language, isOverlayOn ? 'main.statusOn' : 'main.statusOff')}`}
              />
            </div>
          </div>
          <button
            onClick={closeMenu}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--qt-border)] bg-[var(--qt-surface)] text-[var(--qt-muted)] hover:border-[var(--qt-primary)] hover:text-[var(--qt-fg)]"
            aria-label={t(language, 'settings.closeWindow')}
            title={t(language, 'settings.closeWindow')}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            <TrayActionCard
              icon={<Power className="size-4" />}
              title={isAppOn ? (language === 'en' ? 'Disable App' : 'Tắt App') : language === 'en' ? 'Enable App' : 'Bật App'}
              subtitle={isAppOn ? t(language, 'main.statusOn') : t(language, 'main.statusOff')}
              tone={isAppOn ? 'danger' : 'success'}
              onClick={() => withClose(toggleApp)}
            />

            <TrayActionCard
              icon={<Square className="size-4" />}
              title={language === 'en' ? 'Main Window' : 'Cửa sổ chính'}
              subtitle={language === 'en' ? 'Show / hide' : 'Hiện / ẩn'}
              onClick={() => withClose(() => window.electronAPI?.toggleMainWindow?.())}
            />

            <TrayActionCard
              icon={isOverlayOn ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              title={t(language, 'settings.overlayMaster')}
              subtitle={isOverlayOn ? t(language, 'main.statusOn') : t(language, 'main.statusOff')}
              tone={isOverlayOn ? 'accent' : 'default'}
              onClick={() => withClose(() => window.electronAPI?.toggleOverlayVisibility?.())}
            />

            <TrayActionCard
              icon={<SquareDashed className="size-4" />}
              title={t(language, 'main.hotkeyOverlayEditLabel')}
              subtitle={isOverlayInteractive ? t(language, 'main.overlayInteractionActive') : t(language, 'main.overlayInteractionPassive')}
              tone={isOverlayInteractive ? 'accent' : 'default'}
              onClick={() => withClose(() => window.electronAPI?.toggleOverlayInteraction?.())}
            />

            <TrayActionCard
              icon={<Settings2 className="size-4" />}
              title={t(language, 'settings.windowTitle')}
              subtitle={language === 'en' ? 'Open settings' : 'Mở cài đặt'}
              onClick={() => withClose(() => window.electronAPI?.openSettingsWindow?.())}
            />

            <TrayActionCard
              icon={<Layers3 className="size-4" />}
              title={language === 'en' ? 'Overlay Tools' : 'Overlay Tools'}
              subtitle={language === 'en' ? 'Text / Image' : 'Text / Ảnh'}
              onClick={() => withClose(() => window.electronAPI?.openOverlayImageWindow?.('image'))}
            />

            <TrayActionCard
              icon={<SlidersHorizontal className="size-4" />}
              title={t(language, 'settings.mode')}
              subtitle={`${settings.uiMode.toUpperCase()} · ${settings.uiPalette}`}
              onClick={closeMenu}
            />

            <TrayActionCard
              icon={<X className="size-4" />}
              title={language === 'en' ? 'Quit' : 'Thoát'}
              subtitle="Quick Text"
              tone="danger"
              onClick={() => withClose(() => window.electronAPI?.quitApp?.())}
            />
          </div>
        </div>
      </section>
    </main>
  )
}

type StatusPillProps = {
  label: string
  tone?: Tone
}

function StatusPill({ label, tone = 'default' }: StatusPillProps) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-500/45 bg-red-500/12 text-red-100'
      : tone === 'success'
        ? 'border-emerald-500/45 bg-emerald-500/12 text-emerald-100'
        : tone === 'accent'
          ? 'border-[var(--qt-primary)]/55 bg-[color-mix(in_oklab,var(--qt-primary)_20%,transparent)] text-[var(--qt-fg)]'
          : 'border-[var(--qt-border)] bg-[var(--qt-surface)] text-[var(--qt-muted)]'

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${toneClass}`}>
      {label}
    </span>
  )
}

type TrayActionCardProps = {
  icon: ReactNode
  title: string
  subtitle: string
  tone?: Tone
  onClick: () => void
}

function TrayActionCard({ icon, title, subtitle, tone = 'default', onClick }: TrayActionCardProps) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-500/45 hover:border-red-400/75 hover:bg-red-500/14'
      : tone === 'success'
        ? 'border-emerald-500/45 hover:border-emerald-400/75 hover:bg-emerald-500/14'
        : tone === 'accent'
          ? 'border-[var(--qt-primary)]/55 hover:border-[var(--qt-primary)]/85 hover:bg-[color-mix(in_oklab,var(--qt-primary)_18%,transparent)]'
          : 'border-[var(--qt-border)] hover:border-[var(--qt-primary)]/72 hover:bg-[var(--qt-surface-soft)]'

  return (
    <button
      onClick={onClick}
      className={`group flex min-h-[62px] w-full items-center gap-2 rounded-xl border bg-[var(--qt-surface)] px-2.5 py-2 text-left ${toneClass}`}
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--qt-border)] bg-[var(--qt-surface-soft)] text-[var(--qt-muted)] group-hover:text-[var(--qt-fg)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-[var(--qt-fg)]">{title}</span>
        <span className="block truncate text-[11px] text-[var(--qt-muted)]">{subtitle}</span>
      </span>
    </button>
  )
}
