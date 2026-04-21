'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent } from 'react'
import Image from 'next/image'
import { Eye, EyeOff, FileText, Languages, Loader2, ScanSearch, Search, SlidersHorizontal, Sparkles, Trash2, Upload, X } from 'lucide-react'
import TextManager from '@/components/TextManager'
import SettingsContent from '@/components/SettingsContent'
import { useSettings } from '@/hooks/use-settings'
import { t } from '@/lib/i18n'

type ElectronRegionStyle = CSSProperties & { WebkitAppRegion: 'drag' | 'no-drag' }
type OverlayToolTab = 'text' | 'image' | 'settings'

const dragRegionStyle: ElectronRegionStyle = { WebkitAppRegion: 'drag' }
const noDragRegionStyle: ElectronRegionStyle = { WebkitAppRegion: 'no-drag' }

type TranslateResponse =
  | {
      ok: true
      translatedText: string
      sourceLang: string
      targetLang: string
    }
  | {
      ok: false
      error: string
    }

type GoogleSearchResponse =
  | {
      ok: true
      query: string
      results: Array<{
        title: string
        url: string
      }>
    }
  | {
      ok: false
      error: string
    }

type LensApiResponse =
  | {
      ok: true
      extractedText: string
      translatedReply: string
      htmlContent: string
      commands: string
    }
  | {
      ok: false
      error: string
    }

type LanguageOption = {
  value: string
  label: string
}

function normalizeToolTab(tab: string | null): OverlayToolTab {
  if (tab === 'settings') return 'settings'
  return tab === 'text' ? 'text' : 'image'
}

export default function OverlayImagePage() {
  const { settings, updateSettings } = useSettings()
  const [activeTab, setActiveTab] = useState<OverlayToolTab>('image')

  const language = settings?.uiLanguage ?? 'vi'
  const textToolVisible = settings?.overlayToolsShowTextManager ?? true
  const imageToolVisible = settings?.overlayToolsShowImageTranslate ?? true
  const overlayToolsOpacity = settings?.overlayToolsOpacity ?? 1
  const disableTextVisibilityToggle = textToolVisible && !imageToolVisible
  const disableImageVisibilityToggle = imageToolVisible && !textToolVisible
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [previewDataUrl, setPreviewDataUrl] = useState('')
  const [imageName, setImageName] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [translatedText, setTranslatedText] = useState('')
  const [lensResult, setLensResult] = useState<{
    extractedText: string
    translatedReply: string
    htmlContent: string
    commands: string
  } | null>(null)
  const [lensError, setLensError] = useState('')
  const [sourceLang, setSourceLang] = useState('auto')
  const [targetLang, setTargetLang] = useState('vi')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [isOcrRunning, setIsOcrRunning] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [isLensSearching, setIsLensSearching] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [searchError, setSearchError] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ title: string; url: string }>>([])
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tabFromQuery = normalizeToolTab(params.get('tab'))
    setActiveTab((current) => (current === tabFromQuery ? current : tabFromQuery))
  }, [])

  useEffect(() => {
    setActiveTab((current) => {
      if (current === 'text' && !textToolVisible) {
        return imageToolVisible ? 'image' : 'settings'
      }
      if (current === 'image' && !imageToolVisible) {
        return textToolVisible ? 'text' : 'settings'
      }
      return current
    })
  }, [imageToolVisible, textToolVisible])

  const closeWindow = useCallback(() => {
    if (window.electronAPI?.closeOverlayImageWindow) {
      window.electronAPI.closeOverlayImageWindow()
      return
    }
    window.close()
  }, [])

  const toggleToolVisibility = useCallback(
    async (tool: 'text' | 'image') => {
      const nextTextVisible = tool === 'text' ? !textToolVisible : textToolVisible
      const nextImageVisible = tool === 'image' ? !imageToolVisible : imageToolVisible
      if (!nextTextVisible && !nextImageVisible) return

      await updateSettings({
        overlayToolsShowTextManager: nextTextVisible,
        overlayToolsShowImageTranslate: nextImageVisible,
      })

      setActiveTab((current) => {
        if (current === 'text' && !nextTextVisible) return nextImageVisible ? 'image' : 'settings'
        if (current === 'image' && !nextImageVisible) return nextTextVisible ? 'text' : 'settings'
        return current
      })
    },
    [imageToolVisible, textToolVisible, updateSettings],
  )

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent'
    document.documentElement.style.backgroundColor = 'transparent'
    return () => {
      document.body.style.backgroundColor = ''
      document.documentElement.style.backgroundColor = ''
    }
  }, [])

  const languageOptions = useMemo<LanguageOption[]>(
    () => [
      { value: 'auto', label: t(language, 'overlayImage.langAuto') },
      { value: 'vi', label: t(language, 'overlayImage.langVi') },
      { value: 'en', label: t(language, 'overlayImage.langEn') },
      { value: 'ko', label: t(language, 'overlayImage.langKo') },
      { value: 'ja', label: t(language, 'overlayImage.langJa') },
    ],
    [language],
  )

  const resetResultState = useCallback(() => {
    setOcrText('')
    setTranslatedText('')
    setErrorMessage('')
    setSearchError('')
    setSearchResults([])
    setHasSearched(false)
    setOcrProgress(0)
  }, [])

  const applyImageDataUrl = useCallback(
    (dataUrl: string, name = '') => {
      const normalized = dataUrl.trim()
      if (!normalized.startsWith('data:image/')) {
        setErrorMessage(t(language, 'overlayImage.errorNoImage'))
        return false
      }
      setPreviewDataUrl(normalized)
      setImageName(name || t(language, 'overlayImage.clipboardImageName'))
      resetResultState()
      return true
    },
    [language, resetResultState],
  )

  const pasteImageFromClipboard = useCallback(() => {
    const dataUrl = window.electronAPI?.readClipboardImageDataUrl?.() ?? ''
    const ok = applyImageDataUrl(dataUrl)
    if (!ok) {
      setErrorMessage(t(language, 'overlayImage.errorNoClipboardImage'))
      return false
    }
    return true
  }, [applyImageDataUrl, language])

  const onPickImage = useCallback(
    (file: File | null) => {
      if (!file) return
      if (!file.type.startsWith('image/')) {
        setErrorMessage(t(language, 'overlayImage.errorNoImage'))
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const nextDataUrl = typeof reader.result === 'string' ? reader.result : ''
        const applied = applyImageDataUrl(nextDataUrl, file.name || '')
        if (!applied) return
      }
      reader.onerror = () => {
        setErrorMessage(t(language, 'overlayImage.errorNoImage'))
      }
      reader.readAsDataURL(file)
    },
    [applyImageDataUrl, language],
  )

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onPickImage(event.target.files?.[0] ?? null)
    },
    [onPickImage],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      onPickImage(event.dataTransfer.files?.[0] ?? null)
    },
    [onPickImage],
  )

  useEffect(() => {
    if (activeTab !== 'image' || !imageToolVisible) return

    const handlePaste = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData
      if (!clipboardData) return

      const imageFromItems =
        Array.from(clipboardData.items || []).find((item) => item.type.startsWith('image/'))?.getAsFile() ?? null
      const imageFromFiles =
        imageFromItems ?? Array.from(clipboardData.files || []).find((file) => file.type.startsWith('image/')) ?? null
      const target = event.target instanceof HTMLElement ? event.target : null
      const isEditableTarget = !!target && !!target.closest('textarea,input,[contenteditable="true"]')

      if (imageFromFiles) {
        event.preventDefault()
        onPickImage(imageFromFiles)
        return
      }

      if (isEditableTarget) return

      const pasted = pasteImageFromClipboard()
      if (pasted) event.preventDefault()
    }

    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('paste', handlePaste)
    }
  }, [activeTab, imageToolVisible, onPickImage, pasteImageFromClipboard])

  useEffect(() => {
    if (activeTab !== 'image' || !imageToolVisible) return

    const unsubscribe = (window.electronAPI as any)?.onPasteImage?.((dataUrl: string) => {
      applyImageDataUrl(dataUrl)
    })
    return unsubscribe
  }, [activeTab, imageToolVisible, applyImageDataUrl])

  const runOcr = useCallback(async () => {
    if (isOcrRunning) return
    if (!previewDataUrl) {
      setErrorMessage(t(language, 'overlayImage.errorNoImage'))
      return
    }

    setErrorMessage('')
    setOcrProgress(0)
    setIsOcrRunning(true)
    try {
      const { recognize } = await import('tesseract.js')
      const result = await recognize(previewDataUrl, 'eng+vie+kor+jpn', {
        logger(message: { status?: string; progress?: number }) {
          if (message?.status !== 'recognizing text') return
          if (typeof message.progress !== 'number' || !Number.isFinite(message.progress)) return
          setOcrProgress(Math.max(0, Math.min(100, Math.round(message.progress * 100))))
        },
      })
      const extracted = (result?.data?.text || '').trim()
      setOcrText(extracted)
      if (!extracted) {
        setErrorMessage(t(language, 'overlayImage.errorNoText'))
      } else {
        setTranslatedText('')
        setSearchError('')
        setSearchResults([])
        setHasSearched(false)
      }
    } catch {
      setErrorMessage(t(language, 'overlayImage.errorOcr'))
    } finally {
      setIsOcrRunning(false)
    }
  }, [isOcrRunning, language, previewDataUrl])

  const runTranslate = useCallback(async () => {
    if (isTranslating) return
    const text = ocrText.trim()
    if (!text) {
      setErrorMessage(t(language, 'overlayImage.errorNoText'))
      return
    }

    setErrorMessage('')
    setIsTranslating(true)
    try {
      const response = await fetch('/api/image-translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          sourceLang,
          targetLang,
        }),
      })
      const payload = (await response.json().catch(() => null)) as TranslateResponse | null
      if (!response.ok || !payload || !payload.ok) {
        const fallback = t(language, 'overlayImage.errorTranslate')
        const error =
          payload && 'error' in payload && typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : fallback
        throw new Error(error)
      }
      setTranslatedText(payload.translatedText.trim())
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : t(language, 'overlayImage.errorTranslate')
      setErrorMessage(message)
    } finally {
      setIsTranslating(false)
    }
  }, [isTranslating, language, ocrText, sourceLang, targetLang])

  const runGoogleSearch = useCallback(async () => {
    if (isSearching) return
    const query = translatedText.trim() || ocrText.trim()
    if (!query) {
      setSearchError(t(language, 'overlayImage.errorNoText'))
      return
    }

    setSearchError('')
    setIsSearching(true)
    try {
      const response = await fetch('/api/google-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          limit: 6,
        }),
      })

      const payload = (await response.json().catch(() => null)) as GoogleSearchResponse | null
      if (!response.ok || !payload || !payload.ok) {
        const fallback = t(language, 'overlayImage.errorSearch')
        const message =
          payload && 'error' in payload && typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : fallback
        throw new Error(message)
      }

      setSearchResults(Array.isArray(payload.results) ? payload.results : [])
      setHasSearched(true)
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : t(language, 'overlayImage.errorSearch')
      setSearchError(message)
      setSearchResults([])
      setHasSearched(true)
    } finally {
      setIsSearching(false)
    }
  }, [isSearching, language, ocrText, translatedText])

  const runLensSearch = useCallback(async () => {
    if (isLensSearching) return
    if (!previewDataUrl) {
      setLensError(t(language, 'overlayImage.errorNoImage'))
      return
    }

    setLensError('')
    setIsLensSearching(true)
    try {
      const bridge = window.electronAPI?.lensSearchImage
      if (typeof bridge !== 'function') {
        throw new Error(t(language, 'overlayImage.errorLens'))
      }
      const payload = (await bridge({ imageDataUrl: previewDataUrl }).catch(() => null)) as LensApiResponse | null
      if (!payload || (payload.ok === false)) {
        const fallback = t(language, 'overlayImage.errorLens')
        const message = payload && (payload as any).error ? (payload as any).error : fallback
        throw new Error(message)
      }

      setLensResult({
        extractedText: payload.extractedText || '',
        translatedReply: payload.translatedReply || '',
        htmlContent: payload.htmlContent || '',
        commands: payload.commands || '',
      })
      setOcrText(payload.extractedText || '')
      setTranslatedText(payload.translatedReply || '')
      setSearchResults([])
      setHasSearched(true)
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : t(language, 'overlayImage.errorLens')
      setLensError(message)
    } finally {
      setIsLensSearching(false)
    }
  }, [isLensSearching, language, previewDataUrl])

  const clearAll = useCallback(() => {
    setPreviewDataUrl('')
    setImageName('')
    setOcrText('')
    setTranslatedText('')
    setErrorMessage('')
    setOcrProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  if (!settings) return null

  return (
    <div className="h-dvh w-full overflow-hidden bg-transparent p-2 text-foreground">
      <main
        className="qt-shell qt-window-shell relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px]"
        style={{ opacity: overlayToolsOpacity }}
      >
        <div className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-[color-mix(in_oklab,var(--qt-primary)_18%,transparent)] blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-8 h-72 w-72 rounded-full bg-[color-mix(in_oklab,var(--qt-accent)_14%,transparent)] blur-3xl" />

        <header className="qt-overlay-header cursor-grab active:cursor-grabbing p-4" style={dragRegionStyle}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="qt-overlay-surface inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--qt-muted)]">
                <Sparkles className="size-3" />
                Overlay Tools
              </span>
              <h1 className="mt-1 text-lg font-semibold text-[var(--qt-fg)]">{t(language, 'overlayTools.windowTitle')}</h1>
              <p className="mt-1 text-sm text-[var(--qt-muted)]">{t(language, 'overlayTools.windowSubtitle')}</p>
            </div>
            <button
              onClick={closeWindow}
              className="qt-overlay-icon-btn qt-overlay-icon-btn-danger inline-flex h-9 min-w-9 px-3 text-xs font-semibold"
              style={noDragRegionStyle}
              title={t(language, 'settings.closeWindow')}
              aria-label={t(language, 'settings.closeWindow')}
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="qt-overlay-header px-4 py-2" style={noDragRegionStyle}>
          <div className="qt-overlay-surface inline-flex p-1">
            <button
              onClick={() => setActiveTab('settings')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                activeTab === 'settings'
                  ? 'qt-overlay-edit-btn-active'
                  : 'text-[var(--qt-muted)] hover:bg-[color-mix(in_oklab,var(--qt-surface-soft)_84%,transparent)] hover:text-[var(--qt-fg)]'
              }`}
            >
              <SlidersHorizontal className="size-4" />
              {t(language, 'overlayTools.tabSettings')}
            </button>
            {textToolVisible ? (
              <button
                onClick={() => setActiveTab('text')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                  activeTab === 'text'
                    ? 'qt-overlay-edit-btn-active'
                    : 'text-[var(--qt-muted)] hover:bg-[color-mix(in_oklab,var(--qt-surface-soft)_84%,transparent)] hover:text-[var(--qt-fg)]'
                }`}
              >
                <FileText className="size-4" />
                {t(language, 'overlayTools.tabText')}
              </button>
            ) : null}
            {imageToolVisible ? (
              <button
                onClick={() => setActiveTab('image')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                  activeTab === 'image'
                    ? 'qt-overlay-edit-btn-active'
                    : 'text-[var(--qt-muted)] hover:bg-[color-mix(in_oklab,var(--qt-surface-soft)_84%,transparent)] hover:text-[var(--qt-fg)]'
                }`}
              >
                <Languages className="size-4" />
                {t(language, 'overlayTools.tabImage')}
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--qt-muted)]">
              {t(language, 'overlayTools.moduleVisibility')}
            </p>
            <button
              onClick={() => void toggleToolVisibility('text')}
              disabled={disableTextVisibilityToggle}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                textToolVisible
                  ? 'qt-overlay-btn-accent'
                  : 'qt-overlay-btn-soft'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {textToolVisible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {t(language, 'overlayTools.tabText')}
              <span className="qt-overlay-range-value">{t(language, textToolVisible ? 'overlayTools.stateOn' : 'overlayTools.stateOff')}</span>
            </button>
            <button
              onClick={() => void toggleToolVisibility('image')}
              disabled={disableImageVisibilityToggle}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                imageToolVisible
                  ? 'qt-overlay-btn-accent'
                  : 'qt-overlay-btn-soft'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {imageToolVisible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {t(language, 'overlayTools.tabImage')}
              <span className="qt-overlay-range-value">{t(language, imageToolVisible ? 'overlayTools.stateOn' : 'overlayTools.stateOff')}</span>
            </button>
          </div>
        </div>

        <section className="min-h-0 flex-1 overflow-auto p-3 sm:p-4" style={noDragRegionStyle}>
          {activeTab === 'settings' ? (
            <SettingsContent settings={settings} updateSettings={updateSettings} />
          ) : activeTab === 'text' && textToolVisible ? (
            <TextManager settings={settings} updateSettings={updateSettings} variant="overlay" />
          ) : activeTab === 'image' && imageToolVisible ? (
            <section className="flex min-h-0 flex-1 flex-col gap-3">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInputChange} />

              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                className="qt-overlay-surface qt-overlay-surface-dashed p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[var(--qt-fg)]">{imageName || t(language, 'overlayImage.pickHint')}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="qt-overlay-btn qt-overlay-btn-brand"
                    >
                      <Upload className="size-4" />
                      {previewDataUrl ? t(language, 'overlayImage.replace') : t(language, 'overlayImage.upload')}
                    </button>
                    <button
                      onClick={pasteImageFromClipboard}
                      className="qt-overlay-btn qt-overlay-btn-accent"
                    >
                      {t(language, 'overlayImage.paste')}
                    </button>
                    <button
                      onClick={clearAll}
                      className="qt-overlay-btn qt-overlay-btn-soft"
                    >
                      <Trash2 className="size-4" />
                      {t(language, 'overlayImage.clear')}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-[var(--qt-muted)]">{t(language, 'overlayImage.pasteHint')}</p>

                {previewDataUrl ? (
                  <div className="qt-overlay-preview-frame relative mt-3 h-52">
                    <Image src={previewDataUrl} alt="Image preview" fill sizes="480px" className="object-contain" />
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="qt-overlay-surface p-2 text-xs text-[var(--qt-muted)]">
                  <span className="mb-1 block">{t(language, 'overlayImage.sourceLang')}</span>
                  <select
                    value={sourceLang}
                    onChange={(event) => setSourceLang(event.target.value)}
                    className="qt-overlay-textarea h-9 w-full px-2 text-sm"
                  >
                    {languageOptions.map((option) => (
                      <option key={`source-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="qt-overlay-surface p-2 text-xs text-[var(--qt-muted)]">
                  <span className="mb-1 block">{t(language, 'overlayImage.targetLang')}</span>
                  <select
                    value={targetLang}
                    onChange={(event) => setTargetLang(event.target.value)}
                    className="qt-overlay-textarea h-9 w-full px-2 text-sm"
                  >
                    {languageOptions
                      .filter((option) => option.value !== 'auto')
                      .map((option) => (
                        <option key={`target-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void runOcr()}
                  disabled={isOcrRunning}
                  className="qt-overlay-btn qt-overlay-btn-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isOcrRunning ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
                  {t(language, 'overlayImage.runOcr')}
                  {isOcrRunning ? ` ${ocrProgress}%` : ''}
                </button>
                <button
                  onClick={() => void runTranslate()}
                  disabled={isTranslating}
                  className="qt-overlay-btn qt-overlay-btn-brand disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isTranslating ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />}
                  {t(language, 'overlayImage.translate')}
                </button>
                <button
                  onClick={() => void runLensSearch()}
                  disabled={isLensSearching}
                  className="qt-overlay-btn qt-overlay-btn-info disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLensSearching ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {isLensSearching ? t(language, 'overlayImage.searching') : 'Lens AI'}
                </button>
                <button
                  onClick={() => void runGoogleSearch()}
                  disabled={isSearching}
                  className="qt-overlay-btn qt-overlay-btn-success disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSearching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  {isSearching ? t(language, 'overlayImage.searching') : t(language, 'overlayImage.searchGoogle')}
                </button>
              </div>

              {errorMessage ? (
                <p className="qt-overlay-alert qt-overlay-alert-error">{errorMessage}</p>
              ) : null}
              {lensError ? (
                <p className="qt-overlay-alert qt-overlay-alert-error">{lensError}</p>
              ) : null}
              {searchError ? (
                <p className="qt-overlay-alert qt-overlay-alert-error">{searchError}</p>
              ) : null}
              {lensResult ? (
                <section className="qt-overlay-surface p-3 mt-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">Lens AI Result</p>
                  <p className="text-xs font-semibold">Extracted:</p>
                  <p className="break-all text-sm">{lensResult.extractedText}</p>
                  <p className="text-xs font-semibold mt-2">Translated:</p>
                  <p className="break-all text-sm">{lensResult.translatedReply}</p>
                  <p className="text-xs font-semibold mt-2">Command snippets:</p>
                  <pre className="overflow-auto text-xs">{lensResult.commands}</pre>
                </section>
              ) : null}

              <section className="qt-overlay-surface p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">{t(language, 'overlayImage.searchResults')}</p>
                {searchResults.length > 0 ? (
                  <ul className="space-y-2">
                    {searchResults.map((result) => (
                      <li key={`${result.url}-${result.title}`} className="qt-overlay-surface px-3 py-2">
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-sm font-semibold text-[var(--qt-fg)] hover:underline"
                        >
                          {result.title}
                        </a>
                        <p className="mt-1 break-all text-[11px] text-[var(--qt-muted)]">{result.url}</p>
                      </li>
                    ))}
                  </ul>
                ) : hasSearched ? (
                  <p className="text-xs text-[var(--qt-muted)]">{t(language, 'overlayImage.searchNoResult')}</p>
                ) : null}
              </section>

              <div className="grid min-h-0 flex-1 gap-2 sm:grid-cols-2">
                <label className="qt-overlay-surface flex min-h-[160px] flex-col p-2 text-xs text-[var(--qt-muted)]">
                  <span className="mb-1 block">{t(language, 'overlayImage.ocrResult')}</span>
                  <textarea
                    value={ocrText}
                    onChange={(event) => setOcrText(event.target.value)}
                    placeholder={t(language, 'overlayImage.placeholderOcr')}
                    className="qt-overlay-textarea min-h-0 flex-1 resize-none px-2 py-2 text-sm"
                  />
                </label>
                <label className="qt-overlay-surface flex min-h-[160px] flex-col p-2 text-xs text-[var(--qt-muted)]">
                  <span className="mb-1 block">{t(language, 'overlayImage.translateResult')}</span>
                  <textarea
                    value={translatedText}
                    onChange={(event) => setTranslatedText(event.target.value)}
                    placeholder={t(language, 'overlayImage.placeholderTranslate')}
                    className="qt-overlay-textarea min-h-0 flex-1 resize-none px-2 py-2 text-sm"
                  />
                </label>
              </div>
            </section>
          ) : (
            <SettingsContent settings={settings} updateSettings={updateSettings} />
          )}
        </section>
      </main>
    </div>
  )
}
