import { NextResponse } from 'next/server'

const DEFAULT_PYTHON_API_BASE_URL = 'http://127.0.0.1:5000'
const REQUEST_TIMEOUT_MS = 3000

export async function GET(request: Request) {
  const url = new URL(request.url)
  const afterParam = url.searchParams.get('after') ?? '0'
  const after = Number.parseInt(afterParam, 10)
  if (!Number.isInteger(after) || after < 0) {
    return NextResponse.json({ ok: false, error: '`after` must be a non-negative integer' }, { status: 400 })
  }

  const baseUrl = (process.env.PYTHON_API_BASE_URL ?? DEFAULT_PYTHON_API_BASE_URL).trim()
  let inputEventsUrl = ''

  try {
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    inputEventsUrl = new URL(`events?after=${after}`, normalized).toString()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid PYTHON_API_BASE_URL' }, { status: 500 })
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(inputEventsUrl, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({
        ok: true,
        events: [],
        last_id: after,
        degraded: true,
        error: `Python events error (${response.status})`,
      })
    }

    let payload: {
      ok?: unknown
      events?: unknown
      last_id?: unknown
      error?: unknown
    }
    try {
      payload = (await response.json()) as {
        ok?: unknown
        events?: unknown
        last_id?: unknown
        error?: unknown
      }
    } catch {
      return NextResponse.json({
        ok: true,
        events: [],
        last_id: after,
        degraded: true,
        error: 'Invalid events response from Python service',
      })
    }

    if (payload.ok !== true) {
      const message = typeof payload.error === 'string' ? payload.error : 'Python events unavailable'
      return NextResponse.json({
        ok: true,
        events: [],
        last_id: typeof payload.last_id === 'number' ? payload.last_id : after,
        degraded: true,
        error: message,
      })
    }

    return NextResponse.json({
      ok: true,
      events: Array.isArray(payload.events) ? payload.events : [],
      last_id: typeof payload.last_id === 'number' ? payload.last_id : after,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({
        ok: true,
        events: [],
        last_id: after,
        degraded: true,
        error: 'Python events timeout',
      })
    }
    return NextResponse.json({
      ok: true,
      events: [],
      last_id: after,
      degraded: true,
      error: 'Python events unavailable',
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
