const DEFAULT_GOOGLE_ORIGIN = 'https://www.google.com'

function decodeLensHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
}

function sanitizeLensHtmlText(value) {
  const decoded = decodeLensHtmlEntities(String(value || ''))
  const withoutExecutable = decoded
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const noTags = withoutExecutable.replace(/<[^>]+>/g, ' ')
  const normalized = decodeLensHtmlEntities(noTags)
  return normalized.replace(/\s+/g, ' ').trim()
}

function extractScriptsFromHtml(html) {
  const scriptRegex = /<script[\s\S]*?<\/script>/gi
  const scripts = []
  let match
  while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push(match[0])
  }
  return scripts
}

function isLikelyCommandLine(value) {
  const line = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!line) return true
  const hardSignals = [
    'google.ia',
    'google.sge',
    'jscontroller',
    'jsaction',
    'data-ved',
    'data-hveid',
    'document.getelementbyid',
    'document.queryselector',
    'window.dispatchevent',
    'function(',
    'function ',
    'const ',
    'let ',
    'var ',
    '=>',
    'spdx-license-identifier',
    'closure library',
  ]
  if (hardSignals.some((signal) => line.includes(signal))) return true
  const punctuationCount = (line.match(/[{}()[\];=<>]/g) || []).length
  return punctuationCount >= 10
}

function lensDecodeJsonString(value) {
  try {
    return JSON.parse(`"${String(value || '').replace(/"/g, '\\"')}"`)
  } catch {
    return String(value || '')
  }
}

function lensDecodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(String(value || ''))
  } catch {
    return String(value || '')
  }
}

function normalizeLensResultUrl(rawHref, googleOrigin = DEFAULT_GOOGLE_ORIGIN) {
  const href = decodeLensHtmlEntities(rawHref)
  if (!href) return ''

  if (href.startsWith('/url?') || href.startsWith('/url&')) {
    try {
      const url = new URL(href, googleOrigin)
      const q = url.searchParams.get('q') || ''
      return lensDecodeURIComponentSafe(q)
    } catch {
      return ''
    }
  }

  if (href.startsWith('http://') || href.startsWith('https://')) return href

  if (href.startsWith('/')) {
    try {
      return new URL(href, googleOrigin).toString()
    } catch {
      return ''
    }
  }

  return ''
}

function isExternalLensResultUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    if (host === 'google.com' || host.endsWith('.google.com')) return false
    if (host === 'webcache.googleusercontent.com') return false
    if (host === 'lens.google.com') return false
    return true
  } catch {
    return false
  }
}

function collectLensResultsByPattern(html, pattern, results, seen, limit, minTitleLength, googleOrigin) {
  let match = null
  while ((match = pattern.exec(html)) !== null) {
    if (results.length >= limit) return
    const url = normalizeLensResultUrl(match[1] || '', googleOrigin)
    const title = sanitizeLensHtmlText(match[2] || '')
    if (!url || !title || title.length < minTitleLength) continue
    if (seen.has(url)) continue
    if (!isExternalLensResultUrl(url)) continue
    seen.add(url)
    results.push({ title, url })
  }
}

function extractLensResults(html, limit = 6, googleOrigin = DEFAULT_GOOGLE_ORIGIN) {
  const results = []
  const seen = new Set()
  const headingPattern = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi
  const anchorPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

  collectLensResultsByPattern(html, headingPattern, results, seen, limit, 6, googleOrigin)
  if (results.length < limit) {
    collectLensResultsByPattern(html, anchorPattern, results, seen, limit, 16, googleOrigin)
  }
  return results
}

function extractLensTextFromHtml(html) {
  const patterns = [/"ocr_text":"([^"]+)"/i, /"detected_text":"([^"]+)"/i, /"extracted_text":"([^"]+)"/i, /"best_guess":"([^"]+)"/i]

  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (!match?.[1]) continue
    const decoded = lensDecodeJsonString(match[1])
    const cleaned = sanitizeLensHtmlText(decoded)
    if (cleaned.length >= 2) return cleaned
  }

  return ''
}

function extractLensSearchUrlFromHtml(html) {
  const source = String(html || '')
  const directMatch = source.match(/https:\/\/www\.google\.com\/search\?[^"'<>\\\s]+/i)
  if (directMatch?.[0]) return directMatch[0]

  const normalized = source
    .replace(/\\\\\//g, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')

  const normalizedMatch = normalized.match(/https:\/\/www\.google\.com\/search\?[^"'<>\\\s]+/i)
  if (normalizedMatch?.[0]) {
    return normalizedMatch[0]
  }

  return ''
}

function resolveLensLocation(locationHeader, googleOrigin = DEFAULT_GOOGLE_ORIGIN) {
  const trimmed = String(locationHeader || '').trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed, googleOrigin).toString()
  } catch {
    return ''
  }
}

function extractLensOverviewSegment(html) {
  const source = String(html || '')
  if (!source) return ''
  const rawAnchors = [
    source.indexOf('jsname="V3qe9d"'),
    source.indexOf("jsname='V3qe9d'"),
    source.indexOf('class="bzXtMb M8OgIe dRpWwb"'),
    source.indexOf("class='bzXtMb M8OgIe dRpWwb'"),
    source.indexOf('id="Odp5De"'),
    source.indexOf("id='Odp5De'"),
    source.indexOf('id="m-x-content"'),
    source.indexOf("id='m-x-content'"),
    source.toLowerCase().indexOf('thông tin tổng quan do ai tạo'),
    source.toLowerCase().indexOf('ai overview'),
  ].filter((index) => index >= 0)

  if (rawAnchors.length === 0) return ''
  const anchors = rawAnchors.map((index) => {
    const tagStart = source.lastIndexOf('<', index)
    return tagStart >= 0 ? tagStart : index
  })
  const start = Math.min(...anchors)
  const endMarkers = [
    'id="folsrch-sources-',
    'id="folsrch-sqf-',
    'class="RDmXvc',
    'class="OS7YA',
    'jscontroller="iml0tb"',
  ]
  let end = source.length
  for (const marker of endMarkers) {
    const markerIndex = source.indexOf(marker, start + 1)
    if (markerIndex >= 0) end = Math.min(end, markerIndex)
  }
  return source.slice(start, Math.max(start, end))
}

function extractListItems(html) {
  const items = []
  const seen = new Set()
  const pattern = /<li[^>]*>([\s\S]*?)<\/li>/gi
  let match = null
  while ((match = pattern.exec(String(html || ''))) !== null) {
    const text = sanitizeLensHtmlText(match[1] || '')
    if (!text || text.length < 3) continue
    if (isLikelyCommandLine(text)) continue
    if (seen.has(text)) continue
    seen.add(text)
    items.push(text)
  }
  return items
}

function extractOverviewAndTranslationBullets(html) {
  const segment = extractLensOverviewSegment(html)
  const lower = segment.toLowerCase()
  const markerIndexes = [
    lower.indexOf('bản dịch'),
    lower.indexOf('translation'),
    lower.indexOf('translated'),
  ].filter((index) => index >= 0)
  const markerIndex = markerIndexes.length > 0 ? Math.min(...markerIndexes) : -1
  const overviewPart = markerIndex >= 0 ? segment.slice(0, markerIndex) : segment
  const translationPart = markerIndex >= 0 ? segment.slice(markerIndex) : ''

  const overviewBullets = extractListItems(overviewPart)
  const googleTranslationBullets = extractListItems(translationPart)
  return { overviewBullets, googleTranslationBullets }
}

function extractOverviewReadableText(html) {
  const segment = extractLensOverviewSegment(html)
  if (!segment) return ''

  const decoded = decodeLensHtmlEntities(segment)
  const textLike = decoded
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:li|p|div|h[1-6]|ul|ol|section|article)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')

  const blockedLineKeywords = [
    'ai có thể mắc sai sót',
    'hãy xác minh câu trả lời',
    'đường liên kết có liên quan',
    'related links',
    'gửi ý kiến phản hồi',
    'chia sẻ thêm ý kiến phản hồi',
    'báo cáo vấn đề',
    'chính sách quyền riêng tư',
    'cảm ơn bạn',
    'kéo hình ảnh vào đây',
    'tải tệp lên',
    'dán đường liên kết của hình ảnh',
    'thả ảnh vào vị trí bất kỳ',
    'đang tải lên',
  ]

  const lines = textLike
    .split(/\r?\n+/)
    .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
    .map((line) => line.replace(/^[•\-–\s]+/g, '').trim())
    .filter(Boolean)

  const uniqueLines = []
  const seen = new Set()
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (blockedLineKeywords.some((keyword) => lower.includes(keyword))) continue
    if (isLikelyCommandLine(line)) continue
    if (seen.has(line)) continue
    seen.add(line)
    uniqueLines.push(line)
  }

  return uniqueLines.join('\n').trim()
}

function extractOverviewTitle(html) {
  const segment = extractLensOverviewSegment(html)
  const headingPattern = /<(?:div|span)[^>]+role="heading"[^>]*>([\s\S]*?)<\/(?:div|span)>/gi
  const fallbackPattern = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi
  const blocked = [
    'thông tin tổng quan do ai tạo',
    'ai overview',
    'bản dịch',
    'translation',
    'related links',
    'đường liên kết có liên quan',
  ]

  const tryPatterns = [headingPattern, fallbackPattern]
  for (const pattern of tryPatterns) {
    let match = null
    while ((match = pattern.exec(segment)) !== null) {
      const text = sanitizeLensHtmlText(match[1] || '')
      if (!text || text.length < 8) continue
      const lower = text.toLowerCase()
      if (blocked.some((keyword) => lower.includes(keyword))) continue
      return text
    }
  }
  return ''
}

function detectLensChallenge(html) {
  const lower = String(html || '').toLowerCase()
  if (!lower) return false
  const signals = [
    'unusual traffic',
    'our systems have detected unusual traffic',
    'g-recaptcha',
    'captcha',
    'detected unusual',
    'please sign in',
    'hãy đăng nhập',
    'đăng nhập vào google',
    'consent.google.com',
  ]
  return signals.some((signal) => lower.includes(signal))
}

function detectLensUploadPrompt(html) {
  const lower = String(html || '').toLowerCase()
  if (!lower) return false
  const signals = [
    'tìm bằng hình ảnh qua google ống kính',
    'kéo hình ảnh vào đây',
    'tải tệp lên',
    'dán đường liên kết của hình ảnh',
    'thả ảnh vào vị trí bất kỳ',
    'đang tải lên',
    'paste image link',
    'drag an image here',
  ]
  return signals.some((signal) => lower.includes(signal))
}

function truncateLensText(value, maxLength = 280) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

function buildLensAiReply(input) {
  const language = input?.language === 'en' ? 'en' : 'vi'
  const extractedText = truncateLensText(input?.extractedText || '')
  const overviewTitle = truncateLensText(input?.overviewTitle || '', 140)
  const overviewBullet = Array.isArray(input?.overviewBullets) ? truncateLensText(input.overviewBullets[0] || '', 180) : ''
  const topResult = Array.isArray(input?.results) ? input.results[0] : null
  const topTitle = truncateLensText(topResult?.title || '', 120)
  const topUrl = truncateLensText(topResult?.url || '', 140)
  const summarySeed = overviewBullet || overviewTitle

  if (!extractedText && !topTitle && !summarySeed) return ''

  if (language === 'en') {
    const parts = []
    if (summarySeed) parts.push(`Overview: ${summarySeed}.`)
    if (extractedText) parts.push(`Detected text: ${extractedText}.`)
    if (topTitle) parts.push(`Top related result: ${topTitle}${topUrl ? ` (${topUrl})` : ''}.`)
    return parts.join(' ').trim()
  }

  const parts = []
  if (summarySeed) parts.push(`Tóm tắt: ${summarySeed}.`)
  if (extractedText) parts.push(`Nội dung nhận diện: ${extractedText}.`)
  if (topTitle) parts.push(`Kết quả liên quan cao nhất: ${topTitle}${topUrl ? ` (${topUrl})` : ''}.`)
  return parts.join(' ').trim()
}

function assessLensParseQuality(parsed) {
  const hasLinks = Array.isArray(parsed?.results) && parsed.results.length > 0
  const hasOcr = typeof parsed?.extractedText === 'string' && parsed.extractedText.trim().length > 0
  const hasOverview =
    (typeof parsed?.overviewTitle === 'string' && parsed.overviewTitle.trim().length > 0) ||
    (Array.isArray(parsed?.overviewBullets) && parsed.overviewBullets.length > 0)

  const missingBlocks = []
  if (!hasLinks) missingBlocks.push('links')
  if (!hasOcr) missingBlocks.push('ocr')
  if (!hasOverview) missingBlocks.push('ai')

  return {
    hasLinks,
    hasOcr,
    hasOverview,
    missingBlocks,
    isComplete: missingBlocks.length === 0,
  }
}

function parseLensHtmlStructured(html, options = {}) {
  const source = String(html || '')
  const language = options.language === 'en' ? 'en' : 'vi'
  const limit = Math.max(1, Math.min(10, Number.isFinite(options.limit) ? Math.floor(options.limit) : 6))
  const googleOrigin = typeof options.googleOrigin === 'string' && options.googleOrigin.trim() ? options.googleOrigin.trim() : DEFAULT_GOOGLE_ORIGIN

  const results = extractLensResults(source, limit, googleOrigin)
  const extractedText = extractLensTextFromHtml(source)
  const overviewTitle = extractOverviewTitle(source)
  const { overviewBullets, googleTranslationBullets } = extractOverviewAndTranslationBullets(source)
  const overviewReadableText = extractOverviewReadableText(source)
  const uploadPromptDetected = detectLensUploadPrompt(source)
  const shouldIgnorePromptOnlyContent =
    uploadPromptDetected &&
    results.length === 0 &&
    !extractedText &&
    googleTranslationBullets.length === 0 &&
    overviewBullets.length === 0
  const safeOverviewTitle = shouldIgnorePromptOnlyContent ? '' : overviewTitle
  const safeOverviewReadableText = shouldIgnorePromptOnlyContent ? '' : overviewReadableText
  const translatedReply = googleTranslationBullets.length > 0 ? googleTranslationBullets.join('\n') : ''
  const cleanContent =
    safeOverviewReadableText ||
    [safeOverviewTitle, ...overviewBullets].filter(Boolean).join('\n').trim()
  const aiReply = translatedReply || cleanContent
  const challengeDetected = detectLensChallenge(source)
  const commands = extractScriptsFromHtml(source)
  const htmlContent = sanitizeLensHtmlText(source)
  const quality = assessLensParseQuality({
    results,
    extractedText,
    overviewTitle: safeOverviewTitle,
    overviewBullets,
  })

  return {
    results,
    extractedText,
    aiReply,
    translatedReply,
    cleanContent,
    htmlContent,
    commands: commands.join('\n'),
    overviewTitle: safeOverviewTitle,
    overviewBullets,
    googleTranslationBullets,
    challengeDetected,
    diagnostics: {
      hasLinks: quality.hasLinks,
      hasOcr: quality.hasOcr,
      hasOverview: quality.hasOverview,
      missingBlocks: quality.missingBlocks,
      uploadPromptDetected,
    },
  }
}

function shouldTriggerLensFallback(parsed) {
  if (!parsed || typeof parsed !== 'object') return true
  if (parsed.challengeDetected) return true
  const missing = Array.isArray(parsed?.diagnostics?.missingBlocks) ? parsed.diagnostics.missingBlocks : []
  return missing.length > 0
}

module.exports = {
  buildLensAiReply,
  decodeLensHtmlEntities,
  detectLensChallenge,
  extractLensResults,
  extractLensSearchUrlFromHtml,
  extractLensTextFromHtml,
  parseLensHtmlStructured,
  resolveLensLocation,
  sanitizeLensHtmlText,
  shouldTriggerLensFallback,
  detectLensUploadPrompt,
}
