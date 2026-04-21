import { NextResponse } from 'next/server'
import { enforceApiAccess } from '@/lib/api-access'

const GOOGLE_SEARCH_BASE = 'https://www.google.com/search'
const REQUEST_TIMEOUT_MS = 9000
const MAX_QUERY_LENGTH = 512
const DEFAULT_LIMIT = 6
const MAX_LIMIT = 10

type SearchResult = {
  title: string
  url: string
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

  const body = rawBody as { query?: unknown; limit?: unknown }
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) return toError(400, '`query` is required')
  if (query.length > MAX_QUERY_LENGTH) {
    return toError(400, `Query too long (max ${MAX_QUERY_LENGTH} chars)`)
  }

  const limit = normalizeLimit(body.limit)

  try {
    const html = await fetchGoogleSearchHtml(query, limit)
    const results = extractGoogleResults(html, limit)
    return NextResponse.json({
      ok: true,
      query,
      results,
    })
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message.trim() : 'Google search failed'
    return toError(502, message)
  }
}

async function fetchGoogleSearchHtml(query: string, limit: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const url = `${GOOGLE_SEARCH_BASE}?hl=vi&gl=vn&gbv=1&num=${limit}&q=${encodeURIComponent(query)}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'accept-language': 'vi-VN,vi;q=0.95,en-US;q=0.8',
      },
    })

    if (!response.ok) {
      throw new Error(`Google search failed (${response.status})`)
    }

    return await response.text()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Google search timeout')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function extractGoogleResults(html: string, limit: number) {
  const results: SearchResult[] = []
  const seen = new Set<string>()
  const byHeadingPattern = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi
  const byAnchorPattern = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

  collectByPattern(html, byHeadingPattern, results, seen, limit, 6)
  if (results.length < limit) {
    collectByPattern(html, byAnchorPattern, results, seen, limit, 16)
  }

  return results
}

function collectByPattern(
  html: string,
  pattern: RegExp,
  results: SearchResult[],
  seen: Set<string>,
  limit: number,
  minTitleLength: number,
) {
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    if (results.length >= limit) return

    const url = normalizeGoogleResultUrl(match[1] || '')
    const title = sanitizeHtmlText(match[2] || '')
    if (!url || !title || title.length < minTitleLength) continue
    if (seen.has(url)) continue
    if (!isExternalHttpUrl(url)) continue

    seen.add(url)
    results.push({ title, url })
  }
}

function normalizeGoogleResultUrl(raw: string) {
  const decoded = decodeURIComponentSafe(raw)
  if (!decoded) return ''
  if (decoded.startsWith('/')) return ''
  return decoded
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

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isExternalHttpUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    if (host === 'google.com' || host.endsWith('.google.com')) return false
    if (host === 'webcache.googleusercontent.com') return false
    return true
  } catch {
    return false
  }
}

function normalizeLimit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const normalized = Math.round(value)
  return Math.min(MAX_LIMIT, Math.max(1, normalized))
}

function toError(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status })
}
