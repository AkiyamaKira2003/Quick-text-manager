import { NextResponse } from 'next/server'
import { enforceApiAccess } from '@/lib/api-access'

const DEFAULT_PYTHON_API_BASE_URL = 'http://127.0.0.1:5000'
const REQUEST_TIMEOUT_MS = 5000

type SendPayload = {
  text: string
  delay_range?: [number, number]
  press_enter?: boolean
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

  if (typeof rawBody !== 'object' || rawBody === null) {
    return toError(400, 'Payload must be a JSON object')
  }

  const body = rawBody as { text?: unknown; delay_range?: unknown; press_enter?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return toError(400, '`text` is required')
  }

  let delayRange: [number, number] | undefined
  try {
    delayRange = parseDelayRange(body.delay_range)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid `delay_range`'
    return toError(400, message)
  }

  let pressEnter = false
  if (typeof body.press_enter !== 'undefined') {
    if (typeof body.press_enter !== 'boolean') {
      return toError(400, '`press_enter` must be boolean')
    }
    pressEnter = body.press_enter
  }

  const baseUrl = (process.env.PYTHON_API_BASE_URL ?? DEFAULT_PYTHON_API_BASE_URL).trim()
  let sendUrl = ''

  try {
    sendUrl = new URL('send', ensureTrailingSlash(baseUrl)).toString()
  } catch {
    return toError(500, 'Invalid PYTHON_API_BASE_URL')
  }

  const payload: SendPayload = { text }
  if (delayRange) payload.delay_range = delayRange
  payload.press_enter = pressEnter

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    })

    let responseBody: unknown = null
    try {
      responseBody = await response.json()
    } catch {
      responseBody = null
    }

    if (!response.ok) {
      const backendError =
        typeof (responseBody as { error?: unknown } | null)?.error === 'string'
          ? ((responseBody as { error: string }).error)
          : `Python service error (${response.status})`
      const status = response.status >= 500 ? 502 : response.status
      return toError(status, backendError)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return toError(504, 'Python service timeout')
    }
    return toError(
      503,
      'Python service unavailable. Ensure `npm run dev:python` is running and dependencies are installed.',
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

function parseDelayRange(value: unknown): [number, number] | undefined {
  if (typeof value === 'undefined') return undefined
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('`delay_range` must be [min, max]')
  }

  const min = value[0]
  const max = value[1]
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('`delay_range` values must be numbers')
  }
  if (min < 0 || max < 0 || min > max) {
    throw new Error('`delay_range` must satisfy 0 <= min <= max')
  }

  return [min, max]
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

function toError(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status })
}
