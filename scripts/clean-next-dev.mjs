import fs from 'node:fs/promises'
import path from 'node:path'

const distDir = resolveDevDistDir()
const target = path.join(process.cwd(), distDir, 'dev')
const maxAttempts = 6
const baseDelayMs = 180

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 0 })
    if (attempt > 1) {
      console.log(`[dev] Cleaned ${distDir}/dev on attempt ${attempt}.`)
    } else {
      console.log(`[dev] Cleaned ${distDir}/dev.`)
    }
    process.exit(0)
  } catch (error) {
    const code = getErrorCode(error)
    const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY'
    if (!retryable || attempt === maxAttempts) {
      console.warn(`[dev] Could not fully clean ${distDir}/dev (${code ?? 'unknown'}). Continuing.`)
      process.exit(0)
    }

    await sleep(baseDelayMs * attempt)
  }
}

function getErrorCode(error) {
  return typeof error === 'object' && error && 'code' in error ? error.code : undefined
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveDevDistDir() {
  const value = typeof process.env.QT_NEXT_DIST_DIR === 'string' ? process.env.QT_NEXT_DIST_DIR.trim() : ''
  return value || '.next-dev'
}
