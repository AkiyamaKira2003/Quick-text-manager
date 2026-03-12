import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const distDir = process.env.QT_NEXT_DIST_DIR || '.next'
const manifestPath = path.join(process.cwd(), distDir, 'server', 'app', 'main', 'page_client-reference-manifest.js')

if (!fs.existsSync(manifestPath)) {
  console.error(`[main-bundle] Missing manifest: ${manifestPath}`)
  process.exit(1)
}

const source = fs.readFileSync(manifestPath, 'utf8')
const sandbox = { globalThis: { __RSC_MANIFEST: {} } }
vm.runInNewContext(source, sandbox)

const pageManifest = sandbox.globalThis.__RSC_MANIFEST['/main/page']
if (!pageManifest || typeof pageManifest !== 'object') {
  console.error('[main-bundle] Invalid main client reference manifest.')
  process.exit(1)
}

const modules = pageManifest.clientModules || {}
const mainModuleKey = Object.keys(modules).find(
  (key) =>
    key.endsWith(`app${path.sep}main${path.sep}page.tsx`) ||
    key.endsWith('app\\main\\page.tsx') ||
    key.includes('/app/main/page.tsx'),
)
const layoutModuleKey = Object.keys(modules).find(
  (key) =>
    key.endsWith(`app${path.sep}layout.tsx`) ||
    key.endsWith('app\\layout.tsx') ||
    key.includes('/app/layout.tsx'),
)

const chunkTokens = new Set([...(modules[mainModuleKey]?.chunks || []), ...(modules[layoutModuleKey]?.chunks || [])])
const chunkFiles = [...chunkTokens]
  .filter((token) => typeof token === 'string')
  .map((token) => {
    if (token.startsWith('/_next/')) return token.slice('/_next/'.length)
    if (token.startsWith('/')) return token.slice(1)
    return token
  })
  .filter((token) => token.startsWith('static/'))

const rows = chunkFiles
  .map((file) => {
    const absoluteFilePath = path.join(process.cwd(), distDir, file.replaceAll('/', path.sep))
    const sizeBytes = fs.existsSync(absoluteFilePath) ? fs.statSync(absoluteFilePath).size : 0
    return { file, sizeBytes }
  })
  .sort((left, right) => right.sizeBytes - left.sizeBytes)

const totalBytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0)

console.log(`[main-bundle] distDir=${distDir}`)
console.log(`[main-bundle] chunks=${rows.length} totalBytes=${totalBytes}`)
for (const row of rows) {
  console.log(`${String(row.sizeBytes).padStart(8, ' ')}  ${row.file}`)
}
