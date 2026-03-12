import { NextResponse } from 'next/server'

const DEFAULT_PYTHON_API_BASE_URL = 'http://127.0.0.1:5000'
const REQUEST_TIMEOUT_MS = 3000

type ConfigurePayload = {
  text?: string
  hotkey?: string
  overlay_toggle_hotkey?: string
  main_toggle_hotkey?: string
  overlay_edit_hotkey?: string
  app_toggle_hotkey?: string
  app_enabled?: boolean
  delay_range?: [number, number]
  press_enter?: boolean
}

export async function POST(request: Request) {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return toError(400, 'Invalid JSON payload')
  }

  if (typeof rawBody !== 'object' || rawBody === null) {
    return toError(400, 'Payload must be a JSON object')
  }

  const body = rawBody as {
    text?: unknown
    hotkey?: unknown
    overlay_toggle_hotkey?: unknown
    main_toggle_hotkey?: unknown
    overlay_edit_hotkey?: unknown
    app_toggle_hotkey?: unknown
    app_enabled?: unknown
    delay_range?: unknown
    press_enter?: unknown
  }

  const payload: ConfigurePayload = {}

  if (typeof body.text !== 'undefined') {
    if (typeof body.text !== 'string') return toError(400, '`text` must be string')
    payload.text = body.text
  }

  if (typeof body.hotkey !== 'undefined') {
    if (typeof body.hotkey !== 'string') return toError(400, '`hotkey` must be string')
    const hotkey = body.hotkey.trim()
    if (!hotkey) return toError(400, '`hotkey` cannot be empty')
    payload.hotkey = hotkey
  }

  if (typeof body.overlay_toggle_hotkey !== 'undefined') {
    if (typeof body.overlay_toggle_hotkey !== 'string') return toError(400, '`overlay_toggle_hotkey` must be string')
    const hotkey = body.overlay_toggle_hotkey.trim()
    if (!hotkey) return toError(400, '`overlay_toggle_hotkey` cannot be empty')
    payload.overlay_toggle_hotkey = hotkey
  }

  if (typeof body.main_toggle_hotkey !== 'undefined') {
    if (typeof body.main_toggle_hotkey !== 'string') return toError(400, '`main_toggle_hotkey` must be string')
    const hotkey = body.main_toggle_hotkey.trim()
    if (!hotkey) return toError(400, '`main_toggle_hotkey` cannot be empty')
    payload.main_toggle_hotkey = hotkey
  }

  if (typeof body.overlay_edit_hotkey !== 'undefined') {
    if (typeof body.overlay_edit_hotkey !== 'string') return toError(400, '`overlay_edit_hotkey` must be string')
    const hotkey = body.overlay_edit_hotkey.trim()
    if (!hotkey) return toError(400, '`overlay_edit_hotkey` cannot be empty')
    payload.overlay_edit_hotkey = hotkey
  }

  if (typeof body.app_toggle_hotkey !== 'undefined') {
    if (typeof body.app_toggle_hotkey !== 'string') return toError(400, '`app_toggle_hotkey` must be string')
    const hotkey = body.app_toggle_hotkey.trim()
    if (!hotkey) return toError(400, '`app_toggle_hotkey` cannot be empty')
    payload.app_toggle_hotkey = hotkey
  }

  if (typeof body.app_enabled !== 'undefined') {
    if (typeof body.app_enabled !== 'boolean') return toError(400, '`app_enabled` must be boolean')
    payload.app_enabled = body.app_enabled
  }

  if (typeof body.press_enter !== 'undefined') {
    if (typeof body.press_enter !== 'boolean') return toError(400, '`press_enter` must be boolean')
    payload.press_enter = body.press_enter
  }

  if (typeof body.delay_range !== 'undefined') {
    let delayRange: [number, number]
    try {
      delayRange = parseDelayRange(body.delay_range)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid `delay_range`'
      return toError(400, message)
    }
    payload.delay_range = delayRange
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const baseUrl = (process.env.PYTHON_API_BASE_URL ?? DEFAULT_PYTHON_API_BASE_URL).trim()
  let configureUrl = ''

  try {
    configureUrl = new URL('configure', ensureTrailingSlash(baseUrl)).toString()
  } catch {
    return toError(500, 'Invalid PYTHON_API_BASE_URL')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(configureUrl, {
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

    return NextResponse.json({ ok: true, config: responseBody })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return toError(504, 'Python configure timeout')
    }
    return toError(
      503,
      'Python service unavailable. Ensure `npm run dev:python` is running and dependencies are installed.',
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

function parseDelayRange(value: unknown): [number, number] {
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
