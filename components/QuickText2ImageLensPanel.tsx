'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ScanSearch } from 'lucide-react'

export type LensResultItem = {
  title: string
  url: string
  snippet: string
}

export type LensParseStatus = 'idle' | 'loading' | 'ready' | 'blocked' | 'manual_required' | 'error'

export type LensParsedPayload = {
  status: LensParseStatus
  aiReply?: string
  translatedImageSrc?: string
  items: LensResultItem[]
  detectedBlocker?: string
  hint?: string
  sourceUrl?: string
}

type LensWebviewElement = HTMLElement & {
  focus: () => void
  reload: () => void
  sendInputEvent: (event: {
    type: string
    keyCode?: string
    modifiers?: string[]
  }) => void
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
}

type QuickText2ImageLensPanelProps = {
  active: boolean
  onStatusChange?: (status: LensParseStatus, hint?: string) => void
  onParsed?: (payload: LensParsedPayload) => void
  onClipboardImageDataUrl?: (dataUrl: string) => void
}

const BLOCK_PATTERNS = [/captcha/i, /unusual traffic/i, /verify you are human/i, /recaptcha/i, /challenge/i]
const LENS_HOME = 'https://lens.google.com/'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const NOISE_LINE_PATTERNS = [
  /hỗ trợ truy cập/i,
  /phản hồi về hỗ trợ truy cập/i,
  /bỏ qua để đến phần nội dung chính/i,
  /chọn vấn đề mà bạn muốn gửi ý kiến phản hồi/i,
  /báo cáo các gợi ý không phù hợp/i,
  /cài đặt nhanh/i,
  /đăng nhập/i,
  /xoá\b/i,
  /xem thêm/i,
  /nhấn\s*\/\s*để chuyển tới hộp tìm kiếm/i,
  /^\(function\s*\(/i,
  /document\.queryselector/i,
  /window\.dispatch/i,
  /jscontroller/i,
  /jsaction/i,
  /data-ved/i,
  /\.lJpQBb\{/i,
]

const sanitizeLensText = (value: string): string => {
  const rows = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const seen = new Set<string>()
  const cleaned: string[] = []

  for (const line of rows) {
    if (seen.has(line)) continue
    seen.add(line)

    const lower = line.toLowerCase()
    const punctuationCount = (line.match(/[{}()[\];=<>]/g) || []).length
    if (punctuationCount >= 10) continue
    if (NOISE_LINE_PATTERNS.some((pattern) => pattern.test(lower))) continue

    cleaned.push(line)
    if (cleaned.length >= 24) break
  }

  return cleaned.join('\n').trim()
}

const parseLensExtraction = (raw: unknown): LensParsedPayload => {
  const fallback: LensParsedPayload = {
    status: 'error',
    items: [],
    hint: 'Unable to parse Lens result payload.',
  }

  if (!raw || typeof raw !== 'object') return fallback

  const payload = raw as Record<string, unknown>
  const blockerText = String(payload.blockerText ?? payload.pageText ?? '')
  const hasBlock = BLOCK_PATTERNS.some((pattern) => pattern.test(blockerText))

  const items = Array.isArray(payload.items)
    ? payload.items
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const value = item as Record<string, unknown>
          const title = sanitizeLensText(String(value.title ?? ''))
          const snippet = sanitizeLensText(String(value.snippet ?? ''))
          return {
            title,
            url: String(value.url ?? ''),
            snippet,
          }
        })
        .filter((item): item is LensResultItem => !!item && !!(item.title || item.snippet || item.url))
    : []

  const statusValue = String(payload.status ?? 'ready')
  const safeAiReply = sanitizeLensText(typeof payload.aiReply === 'string' ? payload.aiReply : '')
  const translatedImageSrc = String(payload.translatedImageSrc ?? '').trim()
  const aiFromItems = sanitizeLensText(
    items
      .map((item) => [item.title, item.snippet].filter(Boolean).join('. ').trim())
      .filter(Boolean)
      .join('\n'),
  )
  const finalAiReply = safeAiReply || aiFromItems
  const hasUsableData = !!finalAiReply || items.length > 0
  const status: LensParseStatus = hasBlock
    ? 'manual_required'
    : !hasUsableData
      ? 'loading'
      : statusValue === 'loading' || statusValue === 'idle' || statusValue === 'blocked' || statusValue === 'error'
      ? (statusValue as LensParseStatus)
      : 'ready'

  return {
    status,
    aiReply: finalAiReply || undefined,
    translatedImageSrc: translatedImageSrc || undefined,
    items,
    detectedBlocker: hasBlock ? blockerText.slice(0, 300) : undefined,
    hint: hasBlock
      ? 'Google Lens needs manual interaction in mini tab. Complete verification/login, then press Parse again.'
      : typeof payload.hint === 'string'
        ? sanitizeLensText(payload.hint)
        : undefined,
    sourceUrl: typeof payload.sourceUrl === 'string' ? payload.sourceUrl : undefined,
  }
}

const createLensDomExtractionScript = (): string => `(() => {
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const unique = (lines) => {
    const seen = new Set();
    const output = [];
    for (const line of lines) {
      const text = normalize(line);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      output.push(text);
    }
    return output;
  };
  const clickNode = (node) => {
    if (!node) return false;
    try {
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    } catch {
      try {
        node.click();
        return true;
      } catch {
        return false;
      }
    }
  };
  const isVisible = (node) => {
    if (!node) return false;
    try {
      const style = window.getComputedStyle(node);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const blockedTokens = [
    'hỗ trợ truy cập',
    'phản hồi về hỗ trợ truy cập',
    'bỏ qua để đến phần nội dung chính',
    'chọn vấn đề mà bạn muốn gửi ý kiến phản hồi',
    'báo cáo các gợi ý không phù hợp',
    'cài đặt nhanh',
    'đăng nhập',
    'xem thêm',
    'nhấn / để chuyển tới hộp tìm kiếm',
    'ai có thể mắc sai sót',
    'hãy xác minh câu trả lời',
    'gửi ý kiến phản hồi',
    'chia sẻ thêm ý kiến phản hồi',
  ];
  const looksLikeCode = (line) => {
    const lower = normalize(line).toLowerCase();
    if (!lower) return true;
    if (lower.startsWith('(function(')) return true;
    if (lower.includes('document.queryselector')) return true;
    if (lower.includes('window.dispatch')) return true;
    if (lower.includes('jscontroller') || lower.includes('jsaction')) return true;
    if (lower.includes('data-ved') || lower.includes('.ljpqbb{')) return true;
    const punctuationCount = (lower.match(/[{}()[\\];=<>]/g) || []).length;
    return punctuationCount >= 10;
  };
  const overviewContainer = document.querySelector('div.h7Tj7e');
  const overviewContent =
    overviewContainer?.querySelector('div.D5ad8b') ||
    document.querySelector('div.h7Tj7e div.D5ad8b');
  const aiOverviewCandidates = unique(
    Array.from(document.querySelectorAll('div.h7Tj7e div.D5ad8b div.rPeykc'))
      .filter((node) => isVisible(node) || !overviewContainer)
      .map((node) => normalize(node?.innerText || node?.textContent || '')),
  ).filter((line) => {
    const lower = line.toLowerCase();
    if (!line || line.length < 4) return false;
    if (lower.includes('thông tin tổng quan do ai tạo')) return false;
    if (lower.includes('bản dịch') || lower.includes('translation')) return false;
    if (lower.includes('đường liên kết')) return false;
    if (looksLikeCode(line)) return false;
    return true;
  });
  const aiOverviewText = aiOverviewCandidates[0] || '';
  const cleanLines = (text) =>
    unique(String(text || '').split(/\\r?\\n+/))
      .map((line) => normalize(line).replace(/^[•\\-–\\s]+/g, '').trim())
      .filter(Boolean)
      .filter((line) => {
        const lower = line.toLowerCase();
        if (blockedTokens.some((token) => lower.includes(token))) return false;
        if (looksLikeCode(line)) return false;
        return true;
      })
      .slice(0, 40);

  const text = document.body?.innerText ?? '';
  const blockerText = text.slice(0, 6000);
  const lowerPage = blockerText.toLowerCase();
  const challengeTokens = ['captcha', 'unusual traffic', 'verify you are human', 'recaptcha', 'challenge'];
  const hasChallenge = challengeTokens.some((token) => lowerPage.includes(token));

  const root =
    overviewContent ||
    overviewContainer ||
    document.querySelector('div[jsname="V3qe9d"]') ||
    document.querySelector('.bzXtMb.M8OgIe.dRpWwb') ||
    document.querySelector('#Odp5De') ||
    document.querySelector('.Wm5I1e') ||
    document.querySelector('#m-x-content');

  if (!root) {
    const homeLike = location.pathname === '/' || location.pathname === '/webhp';
    return {
      status: hasChallenge ? 'manual_required' : 'loading',
      sourceUrl: location.href,
      aiReply: '',
      items: [],
      hint: homeLike ? 'Lens result is not ready yet. Paste image again or wait for result panel.' : undefined,
      blockerText,
      pageText: blockerText,
    };
  }

  const contentRoot =
    root.querySelector('.LT6XE [jsname="dvXlsc"]') ||
    root.querySelector('.LT6XE .f5cPye') ||
    root.querySelector('.LT6XE') ||
    root.querySelector('[jsname="HKDuG"]') ||
    root;

  const headings = Array.from(root.querySelectorAll('[role="heading"], h1, h2, h3, div[jsname="cUzNTd"], .rPeykc'))
    .map((node) => normalize(node.textContent))
    .filter(Boolean);
  const overviewTitle = headings.find((line) => !looksLikeCode(line) && line.length >= 8) || '';

  const rawTextLines = cleanLines(contentRoot?.innerText || root.innerText || '');
  const aiReply = rawTextLines.slice(0, 18).join('\\n').trim();

  const items = [];
  const itemSeen = new Set();
  const anchors = Array.from(root.querySelectorAll('a[href]'));
  for (const anchor of anchors) {
    if (items.length >= 8) break;
    const href = String(anchor.href || '').trim();
    if (!/^https?:\\/\\//i.test(href)) continue;
    if (/^https?:\\/\\/(www\\.)?google\\./i.test(href)) continue;
    if (itemSeen.has(href)) continue;
    itemSeen.add(href);

    const card = anchor.closest('article, div');
    const title = normalize(card?.querySelector('h3, h2, [role="heading"]')?.textContent || anchor.textContent || '');
    const snippet = cleanLines(card?.innerText || '').slice(0, 2).join(' ').trim();
    if (!title && !snippet) continue;
    items.push({ title, snippet, url: href });
  }

  const translatedImageNode =
    document.querySelector('div[jscontroller="WJaxDe"].Op3uPd img.yp9wMb') ||
    document.querySelector('div.Op3uPd img.yp9wMb');
  const translatedImageSrc = normalize(translatedImageNode?.getAttribute('src') || translatedImageNode?.src || '');
  const translateButton =
    document.querySelector('button[jsname="TtaS0d"][aria-label="Dịch hình ảnh"]') ||
    document.querySelector('button[jsname="TtaS0d"][aria-label*="Dịch"]') ||
    document.querySelector('button[jsname="TtaS0d"]');
  const translateState = (() => {
    try {
      if (!window.__qtLensTranslateState || typeof window.__qtLensTranslateState !== 'object') {
        window.__qtLensTranslateState = {
          pageHref: '',
          firstClickAt: 0,
          lastClickAt: 0,
          clickCount: 0,
        };
      }
      return window.__qtLensTranslateState;
    } catch {
      return { pageHref: '', firstClickAt: 0, lastClickAt: 0, clickCount: 0 };
    }
  })();
  const currentHref = normalize(location?.href || '');
  if (translateState.pageHref !== currentHref) {
    translateState.pageHref = currentHref;
    translateState.firstClickAt = 0;
    translateState.lastClickAt = 0;
    translateState.clickCount = 0;
  }
  if (translateButton && !translatedImageSrc) {
    if (!translateState.firstClickAt) translateState.firstClickAt = Date.now();
    const lastClickAt = Number(translateState.lastClickAt || 0);
    if (Date.now() - lastClickAt > 700) {
      const clicked = clickNode(translateButton);
      if (clicked) {
        translateState.lastClickAt = Date.now();
        translateState.clickCount = Number(translateState.clickCount || 0) + 1;
      }
    }
  }
  const finalReply =
    aiOverviewText || aiReply || cleanLines([overviewTitle, ...rawTextLines.slice(0, 6)].join('\\n')).join('\\n');
  const hasUsable = !!finalReply || items.length > 0;
  const status = hasChallenge ? 'manual_required' : hasUsable ? 'ready' : 'loading';

  return {
    status,
    sourceUrl: location.href,
    aiReply: finalReply,
    items,
    translatedImageSrc,
    hint: hasChallenge ? 'Google Lens needs manual interaction (challenge/captcha).' : undefined,
    blockerText,
    pageText: blockerText
  };
})()`

export default function QuickText2ImageLensPanel({
  active,
  onStatusChange,
  onParsed,
  onClipboardImageDataUrl,
}: QuickText2ImageLensPanelProps) {
  const webviewRef = useRef<LensWebviewElement | null>(null)
  const [status, setStatus] = useState<LensParseStatus>('idle')
  const [hint, setHint] = useState('Ready. Press Ctrl+V to paste image.')
  const [webviewReady, setWebviewReady] = useState(false)

  const setStatusWithNotify = useCallback(
    (value: LensParseStatus, nextHint?: string) => {
      setStatus(value)
      onStatusChange?.(value, nextHint)
      if (nextHint) setHint(nextHint)
    },
    [onStatusChange],
  )

  const parseWebviewDom = useCallback(async (): Promise<LensParsedPayload> => {
    const webview = webviewRef.current
    if (!webview) {
      return {
        status: 'error',
        items: [],
        hint: 'Lens webview is unavailable.',
      }
    }

    const raw = await webview.executeJavaScript<unknown>(createLensDomExtractionScript(), true)
    return parseLensExtraction(raw)
  }, [])

  const pasteToLens = useCallback(async () => {
    const webview = webviewRef.current
    if (!webview) throw new Error('Webview not mounted')

    webview.focus()
    await sleep(80)

    webview.sendInputEvent({ type: 'keyDown', keyCode: 'Control' })
    webview.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] })
    webview.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] })
    webview.sendInputEvent({ type: 'keyUp', keyCode: 'Control' })
  }, [])

  const runPipeline = useCallback(
    async (source: 'manual' | 'hotkey') => {
      if (!active) return

      try {
        const clipboardDataUrl = window.electronAPI?.readClipboardImageDataUrl?.() ?? ''
        if (clipboardDataUrl.startsWith('data:image/')) {
          onClipboardImageDataUrl?.(clipboardDataUrl)
        }

        setStatusWithNotify('loading', 'Pasting image into Google Lens...')
        await pasteToLens()

        let parsed: LensParsedPayload = {
          status: 'loading',
          items: [],
        }

        for (let attempt = 0; attempt < 14; attempt += 1) {
          await sleep(700)
          parsed = await parseWebviewDom()
          if (parsed.status === 'ready' || parsed.status === 'manual_required') break
        }

        if (parsed.status === 'manual_required') {
          const manualHint =
            parsed.hint ??
            'Lens requires manual interaction in mini tab (challenge/login). Complete it then press Parse now.'
          const payload = { ...parsed, hint: manualHint }
          setStatusWithNotify('manual_required', manualHint)
          onParsed?.(payload)
          return
        }

        setStatusWithNotify(parsed.status, parsed.hint ?? 'Lens results parsed.')
        onParsed?.(parsed)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Lens pipeline failed unexpectedly.'
        const payload: LensParsedPayload = {
          status: 'error',
          items: [],
          hint: message,
        }
        setStatusWithNotify('error', message)
        onParsed?.(payload)
      }

      if (source === 'hotkey') {
        setHint('Ctrl+V captured and sent to Lens tab.')
      }
    },
    [active, onClipboardImageDataUrl, onParsed, parseWebviewDom, pasteToLens, setStatusWithNotify],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v') return
      if (!active) return
      event.preventDefault()
      runPipeline('hotkey').catch((error) => {
        console.error('Ctrl+V Lens pipeline failed', error)
      })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [active, runPipeline])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const onDidFinishLoad = () => {
      setWebviewReady(true)
      setHint('Google Lens loaded. Press Ctrl+V to paste image.')
    }

    const onDidFailLoad = () => {
      setWebviewReady(false)
      setStatusWithNotify('error', 'Lens webview failed to load. Check internet and retry.')
    }

    webview.addEventListener('did-finish-load', onDidFinishLoad as EventListener)
    webview.addEventListener('did-fail-load', onDidFailLoad as EventListener)

    return () => {
      webview.removeEventListener('did-finish-load', onDidFinishLoad as EventListener)
      webview.removeEventListener('did-fail-load', onDidFailLoad as EventListener)
    }
  }, [setStatusWithNotify])

  const statusChip = useMemo<ReactNode>(() => {
    const state = status === 'ready' ? 'ok' : status === 'manual_required' || status === 'error' ? 'off' : undefined
    return (
      <span className="qt-status-chip" data-state={state}>
        {status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : null}
        {status === 'ready' ? <CheckCircle2 size={12} /> : null}
        {status === 'manual_required' || status === 'error' ? <AlertTriangle size={12} /> : null}
        {status}
      </span>
    )
  }, [status])

  return (
    <section className="qt-overlay-fade-in qt-overlay-surface space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--qt-muted)]">Image Lens Mini Tab</p>
          <p className="text-[11px] text-[var(--qt-muted)]">Direct Ctrl+V pipeline inside webview.</p>
        </div>
        {statusChip}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <button type="button" onClick={() => void runPipeline('manual')} className="qt-overlay-btn qt-overlay-btn-accent">
          <ScanSearch className="size-4" />
          Parse now
        </button>
        <button type="button" onClick={() => webviewRef.current?.reload()} className="qt-overlay-btn qt-overlay-btn-soft">
          <RefreshCw className="size-4" />
          Reload tab
        </button>
        <span className="text-[11px] text-[var(--qt-muted)]">{webviewReady ? 'Webview ready' : 'Webview loading...'}</span>
      </div>

      <div className="qt-overlay-alert qt-overlay-alert-info text-[11px]">{hint}</div>

      <div className="qt-overlay-preview-frame relative overflow-hidden" style={{ height: '320px' }}>
        <webview
          ref={(node) => {
            webviewRef.current = node as unknown as LensWebviewElement
          }}
          src={LENS_HOME}
          className="h-full w-full bg-white"
          allowpopups={false}
        />
      </div>

      <p className="text-[11px] text-[var(--qt-muted)]">
        If Google shows challenge/login/CSP block, continue manually in mini tab and press Parse now.
      </p>
    </section>
  )
}
