import { NextResponse } from 'next/server'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1'])

const REMOTE_API_HINT =
  'Remote API access is blocked by default. Set QT_ALLOW_REMOTE_API=true or configure QT_API_KEY.'

export function enforceApiAccess(request: Request) {
  if (isRemoteAccessExplicitlyAllowed()) return null

  const configuredApiKey = String(process.env.QT_API_KEY || '').trim()
  if (configuredApiKey) {
    const providedApiKey = extractApiKey(request.headers)
    if (providedApiKey && providedApiKey === configuredApiKey) return null
    return NextResponse.json(
      {
        ok: false,
        error: 'Unauthorized API key',
      },
      { status: 401 },
    )
  }

  const requestHost = safeGetHostFromUrl(request.url)
  const originHost = safeGetHostFromUrl(request.headers.get('origin') || '')
  const refererHost = safeGetHostFromUrl(request.headers.get('referer') || '')
  const forwardedHost = firstToken(request.headers.get('x-forwarded-host'))
  const forwardedFor = firstToken(request.headers.get('x-forwarded-for'))
  const realIp = firstToken(request.headers.get('x-real-ip'))

  const hasLoopbackHost =
    isLoopbackHost(requestHost) ||
    isLoopbackHost(originHost) ||
    isLoopbackHost(refererHost) ||
    isLoopbackHost(stripPort(forwardedHost))

  const hasRemoteForwardingSignal =
    (forwardedFor && !isLoopbackHost(stripPort(forwardedFor))) ||
    (realIp && !isLoopbackHost(stripPort(realIp)))

  if (hasLoopbackHost && !hasRemoteForwardingSignal) return null

  return NextResponse.json(
    {
      ok: false,
      error: REMOTE_API_HINT,
    },
    { status: 403 },
  )
}

function isRemoteAccessExplicitlyAllowed() {
  const raw = String(process.env.QT_ALLOW_REMOTE_API || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function extractApiKey(headers: Headers) {
  const directHeader = String(headers.get('x-quicktext-key') || '').trim()
  if (directHeader) return directHeader

  const authorization = String(headers.get('authorization') || '').trim()
  if (!authorization) return ''
  const bearerPrefix = 'bearer '
  if (authorization.toLowerCase().startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length).trim()
  }
  return ''
}

function safeGetHostFromUrl(value: string) {
  if (!value) return ''
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function stripPort(value: string) {
  const normalized = value.trim().replace(/^\[|\]$/g, '').toLowerCase()
  if (!normalized) return ''
  const lastColon = normalized.lastIndexOf(':')
  if (lastColon > 0 && normalized.indexOf(':') === lastColon) {
    const maybePort = normalized.slice(lastColon + 1)
    if (/^\d+$/.test(maybePort)) {
      return normalized.slice(0, lastColon)
    }
  }
  return normalized
}

function firstToken(value: string | null) {
  if (!value) return ''
  const token = value.split(',')[0]
  return token ? token.trim() : ''
}

function isLoopbackHost(value: string) {
  const normalized = stripPort(value)
  if (!normalized) return false
  if (LOCAL_HOSTS.has(normalized)) return true
  return normalized.startsWith('127.')
}
