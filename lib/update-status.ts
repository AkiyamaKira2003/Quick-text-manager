import { t } from '@/lib/i18n'
import type { AppUpdateState, UiLanguage } from '@/types'

export function formatUpdateStatusLabel(language: UiLanguage, state: AppUpdateState | null) {
  if (!state) return t(language, 'settings.updateStatusIdle')
  if (!state.supported || state.stage === 'unsupported') return t(language, 'settings.updateStatusUnsupported')

  if (state.stage === 'checking') return t(language, 'settings.updateStatusChecking')
  if (state.stage === 'available') return t(language, 'settings.updateStatusAvailable')
  if (state.stage === 'downloading') {
    return t(language, 'settings.updateStatusDownloading', {
      percent: Math.round(state.downloadPercent),
    })
  }
  if (state.stage === 'downloaded') return t(language, 'settings.updateStatusDownloaded')
  if (state.stage === 'installing') return t(language, 'settings.updateStatusInstalling')
  if (state.stage === 'not-available') return t(language, 'settings.updateStatusNotAvailable')
  if (state.stage === 'error') return t(language, 'settings.updateStatusError')
  return t(language, 'settings.updateStatusIdle')
}

export function shouldShowInAppUpdateNotice(state: AppUpdateState | null) {
  if (!state || !state.supported) return false
  return state.stage !== 'idle' && state.stage !== 'not-available' && state.stage !== 'unsupported'
}

