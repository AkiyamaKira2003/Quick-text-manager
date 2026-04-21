import { NextResponse } from 'next/server'
import { enforceApiAccess } from '@/lib/api-access'
const lensParserCore = require('../../../lib/lens-parser-core') as typeof import('../../../lib/lens-parser-core')
const vision = require('@google-cloud/vision')
const { Translate } = require('@google-cloud/translate').v2

export const runtime = 'nodejs'

const GOOGLE_LENS_UPLOAD_BASE = 'https://lens.google.com/v3/upload'
const GOOGLE_ORIGIN = 'https://www.google.com'
const REQUEST_TIMEOUT_MS = 12000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_LIMIT = 6
const MAX_LIMIT = 10

const visionClient = new vision.ImageAnnotatorClient()
const translateClient = new Translate()

type LensSearchResult = {
  title: string
  url: string
}

type LensUploadResponse = {
  lensUrl: string
  htmlFromUpload?: string
}

export async function POST(request: Request) {
  const accessError = enforceApiAccess(request)
  if (accessError) return accessError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return toError(400, 'Invalid JSON payload')
  }

  if (!rawBody || typeof rawBody !== 'object') {
    return toError(400, 'Payload must be a JSON object')
  }

  const body = rawBody as {
    imageDataUrl?: unknown
    hl?: unknown
    vpw?: unknown
    vph?: unknown
    limit?: unknown
    mode?: unknown
  }

  const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl.trim() : ''
  if (!imageDataUrl) return toError(400, '`imageDataUrl` is required')

  const image = parseDataUrlImage(imageDataUrl)
  if (!image) return toError(400, 'Invalid image data URL')
  if (image.buffer.length <= 0) return toError(400, 'Image payload is empty')
  if (image.buffer.length > MAX_IMAGE_BYTES) return toError(400, `Image too large (max ${MAX_IMAGE_BYTES} bytes)`)

  const hl = normalizeLanguage(body.hl)
  const vpw = clampInt(body.vpw, 320, 8192, 1209)
  const vph = clampInt(body.vph, 240, 8192, 1229)
  const limit = normalizeLimit(body.limit)
  const mode = typeof body.mode === 'string' && body.mode === 'translation' ? 'translation' : 'full'

  try {
    // Use Google Vision API for OCR
    const [result] = await visionClient.textDetection({
      image: { content: image.buffer },
    })
    const extractedText = result.textAnnotations?.[0]?.description || ''

    // Translate the extracted text
    let translatedReply = ''
    if (extractedText) {
      const [translation] = await translateClient.translate(extractedText, hl === 'en' ? 'en' : 'vi')
      translatedReply = translation
    }

    // Since no HTML, set empty
    const htmlContent = ''
    const commands = ''

    if (!extractedText) {
      return toError(502, 'No text detected in image')
    }

    if (mode === 'translation') {
      return NextResponse.json({
        ok: true,
        translatedReply,
      })
    }

    return NextResponse.json({
      ok: true,
      extractedText,
      translatedReply,
      htmlContent,
      commands,
      parserSource: 'vision',
      fallbackUsed: false,
      diagnostics: {
        vision: { textDetected: !!extractedText },
      },
    })
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim() ? error.message.trim() : 'Google Lens search failed'
    return toError(502, message)
  }
}

async function uploadToGoogleLens(input: {
  imageBuffer: Buffer
  mimeType: string
  language: string
  viewportWidth: number
  viewportHeight: number
}): Promise<LensUploadResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const formData = new FormData()
  formData.append('encoded_image', new Blob([input.imageBuffer], { type: input.mimeType }), buildUploadFilename(input.mimeType))
  formData.append('processed_image_dimensions', '0,0')
  formData.append('image_url', '')
  formData.append('sbisrc', '')

  const url =
    `${GOOGLE_LENS_UPLOAD_BASE}?ep=gsbubb` +
    `&st=${Date.now()}` +
    `&authuser=0` +
    `&hl=${encodeURIComponent(input.language)}` +
    `&vpw=${input.viewportWidth}` +
    `&vph=${input.viewportHeight}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'accept-language': `${input.language}-${input.language.toUpperCase()},${input.language};q=0.9,en-US;q=0.8`,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      },
    })

    const locationHeader = response.headers.get('location') || ''
    const locationUrl = lensParserCore.resolveLensLocation(locationHeader, GOOGLE_ORIGIN)
    if (locationUrl) {
      return { lensUrl: locationUrl }
    }

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Google Lens redirect missing Location (${response.status})`)
    }

    const html = await response.text()
    const htmlDerivedUrl = lensParserCore.extractLensSearchUrlFromHtml(html)
    if (!htmlDerivedUrl) {
      if (lensParserCore.detectLensChallenge(html)) {
        throw new Error('Google Lens sign-in/challenge page detected')
      }
      throw new Error(`Google Lens upload failed (${response.status})`)
    }

    return {
      lensUrl: htmlDerivedUrl,
      htmlFromUpload: html,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Google Lens upload timeout')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchLensResultHtml(lensUrl: string, language: string) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(lensUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'accept-language': `${language}-${language.toUpperCase()},${language};q=0.9,en-US;q=0.8`,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`Google Lens result fetch failed (${response.status})`)
    }

    return await response.text()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Google Lens result timeout')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function extractGoogleResults(html: string, limit: number) {
  return lensParserCore.extractLensResults(html, limit, GOOGLE_ORIGIN) as LensSearchResult[]
}

function collectByPattern(
  html: string,
  pattern: RegExp,
  results: LensSearchResult[],
  seen: Set<string>,
  limit: number,
  minTitleLength: number,
) {
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    if (results.length >= limit) return

    const url = normalizeResultUrl(match[1] || '')
    const title = sanitizeHtmlText(match[2] || '')
    if (!url || !title || title.length < minTitleLength) continue
    if (seen.has(url)) continue
    if (!isExternalHttpUrl(url)) continue

    seen.add(url)
    results.push({ title, url })
  }
}

function extractLensText(html: string) {
  return lensParserCore.extractLensTextFromHtml(html)
}

function buildLensAiReply(input: { language: string; extractedText: string; results: LensSearchResult[] }) {
  return lensParserCore.buildLensAiReply(input)
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

function parseDataUrlImage(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl)
  if (!match) return null
  const mimeType = String(match[1] || '').toLowerCase()
  const base64 = String(match[2] || '').trim()
  if (!mimeType || !base64) return null

  try {
    const buffer = Buffer.from(base64, 'base64')
    return { mimeType, buffer }
  } catch {
    return null
  }
}

function normalizeResultUrl(rawHref: string) {
  const href = decodeHtmlEntities(rawHref)
  if (!href) return ''

  if (href.startsWith('/url?') || href.startsWith('/url&')) {
    try {
      const url = new URL(href, GOOGLE_ORIGIN)
      const q = url.searchParams.get('q') || ''
      return decodeURIComponentSafe(q)
    } catch {
      return ''
    }
  }

  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href
  }

  if (href.startsWith('/')) {
    try {
      return new URL(href, GOOGLE_ORIGIN).toString()
    } catch {
      return ''
    }
  }

  return ''
}

function isExternalHttpUrl(url: string) {
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

function sanitizeHtmlText(value: string) {
  const noTags = value.replace(/<[^>]+>/g, ' ')
  const decoded = decodeHtmlEntities(noTags)
  return decoded.replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string
  } catch {
    return value
  }
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveLensLocation(locationHeader: string) {
  const trimmed = locationHeader.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed, GOOGLE_ORIGIN)
    return url.toString()
  } catch {
    return ''
  }
}

function extractLensSearchUrlFromHtml(html: string) {
  const directMatch = html.match(/https:\/\/www\.google\.com\/search\?[^"'<>\\\s]+/i)
  if (directMatch?.[0]) return directMatch[0]

  const escapedMatch = html.match(/https:\\\/\\\/www\.google\.com\\\/search\?[^"'<>\\\s]+/i)
  if (escapedMatch?.[0]) {
    return escapedMatch[0].replace(/\\\//g, '/')
  }

  return ''
}

function buildUploadFilename(mimeType: string) {
  if (mimeType.includes('png')) return 'image.png'
  if (mimeType.includes('webp')) return 'image.webp'
  if (mimeType.includes('gif')) return 'image.gif'
  if (mimeType.includes('bmp')) return 'image.bmp'
  return 'image.jpg'
}

function normalizeLanguage(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'en' || normalized === 'ko' || normalized === 'ja') return normalized
  return 'vi'
}

function normalizeLimit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const rounded = Math.round(value)
  return Math.min(MAX_LIMIT, Math.max(1, rounded))
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return Math.min(max, Math.max(min, rounded))
}

function toError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}
