import { test } from 'node:test'
import assert from 'node:assert/strict'

import { POST } from '@/app/api/quick-add-translate/route'

test('quick-add translate preserves uppercase tokens in translated output', async () => {
  const originalFetch = global.fetch
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        responseData: {
          translatedText: '안녕 QTKX0XQTK 그리고 qtkx1xqtk',
        },
      }),
      { status: 200 },
    )

  try {
    const request = new Request('http://localhost/api/quick-add-translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'xin chao NPC va KINGJONG',
        sourceLang: 'vi',
        targetLang: 'ko',
      }),
    })

    const response = await POST(request)
    assert.equal(response.status, 200)

    const payload = (await response.json()) as { ok: boolean; translatedText: string; usedFallback: boolean }
    assert.equal(payload.ok, true)
    assert.equal(payload.usedFallback, false)
    assert.equal(payload.translatedText, '안녕 NPC 그리고 KINGJONG')
  } finally {
    global.fetch = originalFetch
  }
})

test('quick-add translate restores token-like provider artifacts', async () => {
  const originalFetch = global.fetch
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        responseData: {
          translatedText: '안녕 QTK TOKEN 0 그리고 __QTK_TOKEN_1__',
        },
      }),
      { status: 200 },
    )

  try {
    const request = new Request('http://localhost/api/quick-add-translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'xin chao TT va NPC',
        sourceLang: 'vi',
        targetLang: 'ko',
      }),
    })

    const response = await POST(request)
    assert.equal(response.status, 200)

    const payload = (await response.json()) as { ok: boolean; translatedText: string }
    assert.equal(payload.ok, true)
    assert.equal(payload.translatedText, '안녕 TT 그리고 NPC')
  } finally {
    global.fetch = originalFetch
  }
})

test('quick-add translate falls back to auto source when primary source fails', async () => {
  const calls: string[] = []
  const originalFetch = global.fetch
  global.fetch = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (calls.length === 1) {
      return new Response('upstream down', { status: 502 })
    }
    return new Response(
      JSON.stringify({
        responseData: {
          translatedText: '안녕하세요',
        },
      }),
      { status: 200 },
    )
  }

  try {
    const request = new Request('http://localhost/api/quick-add-translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'xin chao',
        sourceLang: 'vi',
        targetLang: 'ko',
      }),
    })

    const response = await POST(request)
    assert.equal(response.status, 200)
    const payload = (await response.json()) as { ok: boolean; sourceLang: string; usedFallback: boolean }

    assert.equal(payload.ok, true)
    assert.equal(payload.usedFallback, true)
    assert.equal(payload.sourceLang, 'auto')
    assert.equal(calls.length, 2)
    assert.match(calls[0], /vi%7Cko|vi\|ko/)
    assert.match(calls[1], /auto%7Cko|auto\|ko/)
  } finally {
    global.fetch = originalFetch
  }
})
