import { NextResponse } from 'next/server'
import { enforceApiAccess } from '@/lib/api-access'

const REQUEST_TIMEOUT_MS = 9000
const MAX_TEXT_LENGTH = 6000
const MAX_CHUNK_LENGTH = 420
const TRANSLATE_API_BASE = 'https://api.mymemory.translated.net/get'

type TranslateInput = {
  text: string
  sourceLang: string
  targetLang: string
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

  const body = rawBody as { text?: unknown; sourceLang?: unknown; targetLang?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return toError(400, '`text` is required')
  if (text.length > MAX_TEXT_LENGTH) {
    return toError(400, `Text too long (max ${MAX_TEXT_LENGTH} chars)`)
  }

  const sourceLang = normalizeLang(body.sourceLang, 'auto')
  const targetLang = normalizeLang(body.targetLang, 'vi')
  if (targetLang === sourceLang && sourceLang !== 'auto') {
    return NextResponse.json({
      ok: true,
      translatedText: text,
      sourceLang,
      targetLang,
    })
  }

  const chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH)
  const translatedChunks: string[] = []

  for (const chunk of chunks) {
    const translated = await translateChunk({
      text: chunk,
      sourceLang,
      targetLang,
    })
    translatedChunks.push(translated)
  }

  return NextResponse.json({
    ok: true,
    translatedText: translatedChunks.join(''),
    sourceLang,
    targetLang,
  })
}

async function translateChunk(input: TranslateInput) {
  const preferredSource = input.sourceLang === 'auto' ? 'auto' : input.sourceLang
  const fallbackSource = preferredSource === 'auto' ? 'en' : preferredSource
  const trySources = preferredSource === fallbackSource ? [preferredSource] : [preferredSource, fallbackSource]

  let lastError: Error | null = null
  for (const source of trySources) {
    try {
      return await requestTranslateChunk({
        text: input.text,
        sourceLang: source,
        targetLang: input.targetLang,
      })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Translate provider failed')
    }
  }

  if (lastError) throw lastError
  throw new Error('Translate provider failed')
}

async function requestTranslateChunk(input: TranslateInput) {
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

function splitIntoChunks(text: string, maxLength: number) {
  if (text.length <= maxLength) return [text]
  const lines = text.split(/(\r?\n)/)
  const chunks: string[] = []
  let current = ''

  for (const part of lines) {
    if (!part) continue
    if (part.length > maxLength) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let index = 0; index < part.length; index += maxLength) {
        chunks.push(part.slice(index, index + maxLength))
      }
      continue
    }

    if ((current + part).length > maxLength) {
      if (current) chunks.push(current)
      current = part
      continue
    }

    current += part
  }

  if (current) chunks.push(current)
  return chunks.length > 0 ? chunks : [text]
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
