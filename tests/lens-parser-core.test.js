const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const lensParserCore = require('../lib/lens-parser-core')

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
}

test('parseLensHtmlStructured extracts AI overview + translation + OCR + links', () => {
  const html = readFixture('lens-ai-overview.html')
  const parsed = lensParserCore.parseLensHtmlStructured(html, {
    language: 'vi',
    limit: 6,
    googleOrigin: 'https://www.google.com',
  })

  assert.ok(parsed.overviewTitle.includes('Earth Jail'))
  assert.ok(parsed.overviewBullets.length >= 3)
  assert.ok(parsed.googleTranslationBullets.length >= 3)
  assert.equal(parsed.results.length, 1)
  assert.equal(parsed.results[0].url, 'https://lineage.example/earth-jail')
  assert.ok(parsed.extractedText.length > 0)
  assert.equal(parsed.challengeDetected, false)
  assert.equal(parsed.diagnostics.hasLinks, true)
  assert.equal(parsed.diagnostics.hasOverview, true)
  assert.equal(parsed.aiReply, parsed.translatedReply)
})

test('extractLensSearchUrlFromHtml supports escaped redirect URLs', () => {
  const html = readFixture('lens-redirect.html')
  const url = lensParserCore.extractLensSearchUrlFromHtml(html)
  assert.ok(url.startsWith('https://www.google.com/search?vsrid=CMObyf7T-pqkqQEQ'))
  assert.ok(url.includes('lns_mode=un'))
})

test('redirect-only HTML reports missing blocks and triggers fallback', () => {
  const html = readFixture('lens-redirect.html')
  const parsed = lensParserCore.parseLensHtmlStructured(html, {
    language: 'vi',
    limit: 6,
  })
  assert.equal(parsed.results.length, 0)
  assert.equal(parsed.extractedText, '')
  assert.equal(parsed.overviewBullets.length, 0)
  assert.ok(Array.isArray(parsed.diagnostics.missingBlocks))
  assert.ok(parsed.diagnostics.missingBlocks.includes('links'))
  assert.ok(parsed.diagnostics.missingBlocks.includes('ocr'))
  assert.ok(parsed.diagnostics.missingBlocks.includes('ai'))
  assert.equal(lensParserCore.shouldTriggerLensFallback(parsed), true)
})

test('challenge HTML is detected and fallback trigger returns true', () => {
  const html = readFixture('lens-challenge.html')
  const parsed = lensParserCore.parseLensHtmlStructured(html, {
    language: 'en',
    limit: 4,
  })
  assert.equal(parsed.challengeDetected, true)
  assert.equal(lensParserCore.shouldTriggerLensFallback(parsed), true)
})

test('aiReply strips script/style noise and keeps clean translation-first content', () => {
  const html = `
    <div class="bzXtMb M8OgIe dRpWwb">
      <div jsname="V3qe9d">
        <style>.x{color:red}</style>
        <div role="heading">Thông tin tổng quan do AI tạo</div>
        <div role="heading">Mô tả ảnh</div>
        <ul>
          <li>Đây là mô tả chính.</li>
        </ul>
        &lt;script&gt;var hacked = true;function leak(){return 1;}&lt;/script&gt;
        <div role="heading"><strong>Bản dịch</strong></div>
        <ul>
          <li>Người gửi: Chest:</li>
          <li>Tin nhắn: Cứ nghỉ ngơi như vậy đi ạ.</li>
        </ul>
      </div>
    </div>
  `
  const parsed = lensParserCore.parseLensHtmlStructured(html, {
    language: 'vi',
    limit: 4,
  })

  assert.equal(parsed.aiReply, parsed.translatedReply)
  assert.ok(parsed.aiReply.includes('Người gửi'))
  assert.ok(parsed.aiReply.includes('Tin nhắn'))
  assert.ok(!parsed.aiReply.toLowerCase().includes('function leak'))
  assert.ok(!parsed.aiReply.toLowerCase().includes('var hacked'))
  assert.ok(!parsed.aiReply.toLowerCase().includes('color:red'))
})

test('fallback to clean overview content when translation block is missing', () => {
  const html = `
    <div class="bzXtMb M8OgIe dRpWwb">
      <div jsname="V3qe9d">
        <div role="heading">Tóm tắt nội dung</div>
        <ul>
          <li>Ảnh chụp đoạn chat trong game.</li>
          <li>Nội dung khuyên nhân vật nghỉ ngơi.</li>
        </ul>
      </div>
    </div>
  `
  const parsed = lensParserCore.parseLensHtmlStructured(html, {
    language: 'vi',
    limit: 4,
  })

  assert.equal(parsed.translatedReply, '')
  assert.ok(parsed.aiReply.includes('Ảnh chụp đoạn chat trong game'))
  assert.ok(parsed.aiReply.includes('Nội dung khuyên nhân vật nghỉ ngơi'))
})

test('upload prompt does not produce fake aiReply content', () => {
  const html = `
    <div class="NzSfif">
      <h1>Tìm bằng hình ảnh qua Google Ống kính</h1>
      <div>Kéo hình ảnh vào đây hoặc tải tệp lên</div>
      <div>Dán đường liên kết của hình ảnh</div>
    </div>
  `
  const parsed = lensParserCore.parseLensHtmlStructured(html, {
    language: 'vi',
    limit: 4,
  })

  assert.equal(parsed.aiReply, '')
  assert.equal(parsed.translatedReply, '')
  assert.equal(parsed.diagnostics.uploadPromptDetected, true)
})

test('command-like lines are filtered from clean content and translation', () => {
  const html = `
    <div class="bzXtMb M8OgIe dRpWwb">
      <div jsname="V3qe9d">
        <div role="heading">Mô tả ảnh</div>
        <ul>
          <li>Ảnh có đoạn chat giữa hai nhân vật.</li>
          <li>const debug = true; google.ia.q(p);</li>
        </ul>
        <div role="heading"><strong>Bản dịch</strong></div>
        <ul>
          <li>var hacked = true; function leak(){return 1;}</li>
          <li>Người gửi: Chest:</li>
          <li>Tin nhắn: Cứ nghỉ ngơi như vậy đi ạ.</li>
        </ul>
      </div>
    </div>
  `
  const parsed = lensParserCore.parseLensHtmlStructured(html, {
    language: 'vi',
    limit: 4,
  })

  assert.ok(parsed.aiReply.includes('Người gửi: Chest:'))
  assert.ok(parsed.aiReply.includes('Tin nhắn: Cứ nghỉ ngơi như vậy đi ạ.'))
  assert.ok(!parsed.aiReply.toLowerCase().includes('const debug'))
  assert.ok(!parsed.aiReply.toLowerCase().includes('google.ia'))
  assert.ok(!parsed.aiReply.toLowerCase().includes('var hacked'))
})
