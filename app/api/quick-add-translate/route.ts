import { NextResponse } from 'next/server'
import { enforceApiAccess } from '@/lib/api-access'

const REQUEST_TIMEOUT_MS = 9000
const MAX_TEXT_LENGTH = 1200
const TRANSLATE_API_BASE = 'https://api.mymemory.translated.net/get'
const UPPERCASE_TOKEN_PATTERN = /\b[A-Z][A-Z0-9._-]{1,}\b/g
const TOKEN_PREFIX = 'QTKX'
const TOKEN_SUFFIX = 'XQTK'

type TranslateInput = {
  text: string
  sourceLang: string
  targetLang: string
}

type TranslateBody = {
  text?: unknown
  sourceLang?: unknown
  targetLang?: unknown
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

  const body = rawBody as TranslateBody
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return toError(400, '`text` is required')
  if (text.length > MAX_TEXT_LENGTH) {
    return toError(400, `Text too long (max ${MAX_TEXT_LENGTH} chars)`)
  }

  const sourceLang = normalizeLang(body.sourceLang, 'vi')
  const targetLang = normalizeLang(body.targetLang, 'ko')
  if (sourceLang === targetLang) {
    return NextResponse.json({
      ok: true,
      translatedText: text,
      sourceLang,
      targetLang,
      usedFallback: false,
    })
  }

  const protectedTokens = protectUppercaseTokens(text)
  const attempts: TranslateInput[] = [
    { text: protectedTokens.protectedText, sourceLang, targetLang },
    { text: protectedTokens.protectedText, sourceLang: 'auto', targetLang },
  ]

  let lastError: Error | null = null
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    try {
      const translated = await requestTranslate(attempt)
      const restored = restoreProtectedTokens(translated, protectedTokens.tokens)
      if (!restored.trim()) {
        throw new Error('Translate provider returned empty text')
      }
      return NextResponse.json({
        ok: true,
        translatedText: restored,
        sourceLang: attempt.sourceLang,
        targetLang: attempt.targetLang,
        usedFallback: index > 0,
      })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Translate provider failed')
    }
  }

  return toError(502, lastError?.message || 'Translate provider failed')
}

function protectUppercaseTokens(text: string) {
  const tokens: string[] = []
  const protectedText = text.replace(UPPERCASE_TOKEN_PATTERN, (match) => {
    const tokenIndex = tokens.push(match) - 1
    return `${TOKEN_PREFIX}${tokenIndex}${TOKEN_SUFFIX}`
  })
  return { protectedText, tokens }
}

function restoreProtectedTokens(text: string, tokens: string[]) {
  if (tokens.length === 0) return text
  const placeholderPattern = new RegExp(`${escapeRegex(TOKEN_PREFIX)}\\s*(\\d+)\\s*${escapeRegex(TOKEN_SUFFIX)}`, 'gi')
  const legacyPlaceholderPattern = /_*QTK\s*[_\s-]*(?:TOKEN|\uD1A0\uD070)\s*[_\s-]*(\d+)_*/gi
  return replaceIndexedPlaceholders(text, placeholderPattern, tokens).replace(legacyPlaceholderPattern, (raw, indexText) => {
    const tokenIndex = Number.parseInt(indexText, 10)
    if (!Number.isFinite(tokenIndex) || tokenIndex < 0 || tokenIndex >= tokens.length) return raw
    return tokens[tokenIndex]
  })
}

function replaceIndexedPlaceholders(text: string, pattern: RegExp, tokens: string[]) {
  return text.replace(pattern, (raw, indexText) => {
    const tokenIndex = Number.parseInt(indexText, 10)
    if (!Number.isFinite(tokenIndex) || tokenIndex < 0 || tokenIndex >= tokens.length) return raw
    return tokens[tokenIndex]
  })
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function requestTranslate(input: TranslateInput) {
  const pair = `${input.sourceLang}|${input.targetLang}`
  const url = `${TRANSLATE_API_BASE}?q=${encodeURIComponent(input.text)}&langpair=${encodeURIComponent(pair)}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Translate provider failed (${response.status})`)
    }

    const payload = (await response.json()) as {
      responseData?: { translatedText?: string }
    }
    const translatedText = payload?.responseData?.translatedText
    if (typeof translatedText !== 'string' || !translatedText.trim()) {
      throw new Error('Translate provider returned empty text')
    }
    return translatedText
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Translate provider timeout')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function normalizeLang(value: unknown, fallback: string) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!normalized) return fallback
  if (!/^[a-z]{2,8}$/i.test(normalized) && normalized !== 'auto') return fallback
  return normalized
}

function toError(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status })
}
