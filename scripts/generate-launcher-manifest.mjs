#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      result[key] = 'true'
      continue
    }
    result[key] = next
    index += 1
  }
  return result
}

function ensure(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function toUrl(baseUrl, fileName) {
  const normalizedBase = String(baseUrl || '').trim()
  ensure(normalizedBase, 'Missing --base-url')
  return new URL(fileName, normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`).toString()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const zipPath = path.resolve(args.zip || '')
  ensure(zipPath, 'Missing --zip')
  ensure(fs.existsSync(zipPath), `Zip not found: ${zipPath}`)

  const version = String(args.version || '').trim()
  ensure(version, 'Missing --version')

  const channel = String(args.channel || 'stable').trim() || 'stable'
  const app = String(args.app || 'QuickText').trim() || 'QuickText'
  const entryExe = String(args['entry-exe'] || 'QuickText.exe').trim() || 'QuickText.exe'
  const outPath = path.resolve(args.out || path.join(path.dirname(zipPath), 'latest.json'))
  const fileName = path.basename(zipPath)

  const stat = fs.statSync(zipPath)
  const hash = await sha256File(zipPath)
  const downloadUrl = toUrl(args['base-url'], fileName)

  const manifest = {
    app,
    channel,
    version,
    url: downloadUrl,
    sha256: hash,
    size: stat.size,
    entryExe,
    publishedAt: new Date().toISOString(),
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  process.stdout.write(`Manifest written: ${outPath}\n`)
  process.stdout.write(`Artifact URL: ${downloadUrl}\n`)
  process.stdout.write(`SHA256: ${hash}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
