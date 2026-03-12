const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const resolvedDistDirName = String(process.env.QT_NEXT_DIST_DIR || '.next').trim() || '.next'
const nextRoot = path.join(projectRoot, resolvedDistDirName)
const standaloneRoot = path.join(nextRoot, 'standalone')
const standaloneMaterializedRoot = path.join(nextRoot, 'standalone-runtime')
const publicSource = path.join(projectRoot, 'public')
const publicTarget = path.join(standaloneMaterializedRoot, 'public')
const runtimeNextTarget = path.join(standaloneMaterializedRoot, '.next')
const nextSkipNames = new Set(['cache', 'standalone', 'standalone-materialized', 'standalone-runtime', 'dev', 'diagnostics', 'types'])
const nextSkipFiles = new Set(['trace', 'trace-build', 'turbopack'])

function requirePathExists(targetPath, label) {
  if (fs.existsSync(targetPath)) return
  throw new Error(`Missing ${label}: ${targetPath}. Run "npm run build" first.`)
}

function copyDirectory(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true })
}

function copyIfMissing(sourcePath, targetPath) {
  if (fs.existsSync(targetPath)) return
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true })
}

function resetStandaloneMaterializedRoot() {
  fs.rmSync(standaloneMaterializedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 })
  fs.mkdirSync(standaloneMaterializedRoot, { recursive: true })
}

function materializeStandaloneServerRuntime() {
  fs.cpSync(standaloneRoot, standaloneMaterializedRoot, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (sourcePath) => {
      const rel = path.relative(standaloneRoot, sourcePath)
      if (!rel || rel === '.') return true
      if (rel === '.next' || rel.startsWith(`.next${path.sep}`)) return false
      if (rel === 'public' || rel.startsWith(`public${path.sep}`)) return false
      return true
    },
  })
}

function copyNextRuntime() {
  fs.mkdirSync(runtimeNextTarget, { recursive: true })
  const entries = fs.readdirSync(nextRoot, { withFileTypes: true })

  for (const entry of entries) {
    const name = entry.name
    if (nextSkipNames.has(name) || nextSkipFiles.has(name)) continue

    const sourcePath = path.join(nextRoot, name)
    const targetPath = path.join(runtimeNextTarget, name)
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: true })
  }
}

function promotePnpmVirtualStoreModules() {
  const nodeModulesRoot = path.join(standaloneMaterializedRoot, 'node_modules')
  const virtualStoreRoot = path.join(nodeModulesRoot, '.pnpm', 'node_modules')
  if (!fs.existsSync(virtualStoreRoot)) return

  const rootEntries = fs.readdirSync(virtualStoreRoot, { withFileTypes: true })
  for (const entry of rootEntries) {
    const sourcePath = path.join(virtualStoreRoot, entry.name)
    if (entry.isDirectory() && entry.name.startsWith('@')) {
      const scopedEntries = fs.readdirSync(sourcePath, { withFileTypes: true })
      for (const scopedEntry of scopedEntries) {
        if (!scopedEntry.isDirectory()) continue
        copyIfMissing(
          path.join(sourcePath, scopedEntry.name),
          path.join(nodeModulesRoot, entry.name, scopedEntry.name),
        )
      }
      continue
    }

    copyIfMissing(sourcePath, path.join(nodeModulesRoot, entry.name))
  }
}

function main() {
  requirePathExists(standaloneRoot, 'Next standalone output')
  requirePathExists(path.join(nextRoot, 'static'), 'Next static assets')
  requirePathExists(publicSource, 'public assets')

  resetStandaloneMaterializedRoot()
  materializeStandaloneServerRuntime()
  promotePnpmVirtualStoreModules()
  copyNextRuntime()
  copyDirectory(publicSource, publicTarget)

  console.log('[standalone] prepared .next/standalone-runtime with runtime .next and public assets')
}

main()
