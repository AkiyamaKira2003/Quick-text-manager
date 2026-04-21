#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const nativeDir = path.join(repoRoot, 'electron', 'native')
const repoRequire = createRequire(path.join(repoRoot, 'package.json'))

function run(command, args, options = {}) {
  const pretty = [command, ...args].join(' ')
  process.stdout.write(`[native-build] ${pretty}\n`)

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) throw result.error
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${pretty}`)
  }
}

function resolveWindowsSdkVersion() {
  if (process.platform !== 'win32') return ''
  const kitsRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\Lib'
  let entries = []
  try {
    entries = fs.readdirSync(kitsRoot, { withFileTypes: true })
  } catch {
    return ''
  }

  const versions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))

  return versions[0] || ''
}

function main() {
  const env = { ...process.env }
  const sdkVersion = resolveWindowsSdkVersion()
  if (sdkVersion) {
    const windowsKitsRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\'
    const sdkVersionWithSlash = `${sdkVersion}\\`
    env.WindowsSdkDir = windowsKitsRoot
    env.UniversalCRTSdkDir = windowsKitsRoot
    env.WindowsSDKVersion = sdkVersionWithSlash
    env.WindowsSDKLibVersion = sdkVersionWithSlash
    env.UCRTVersion = sdkVersionWithSlash
    env.WindowsTargetPlatformVersion = sdkVersion
    env.npm_config_msvs_windows_target_platform_version = sdkVersion
  }

  let localNodeGypCli = ''
  try {
    localNodeGypCli = repoRequire.resolve('node-gyp/bin/node-gyp.js')
  } catch {
    localNodeGypCli = ''
  }

  if (localNodeGypCli) {
    run('node', [localNodeGypCli, 'rebuild', '--directory', nativeDir], { env })
    return
  }

  const npmExecPath = typeof process.env.npm_execpath === 'string' ? process.env.npm_execpath : ''
  if (!npmExecPath) {
    throw new Error('Unable to locate npm exec path for node-gyp fallback.')
  }

  run('node', [npmExecPath, 'exec', '--yes', 'node-gyp', '--', 'rebuild', '--directory', nativeDir], { env })
}

try {
  main()
} catch (error) {
  process.stderr.write(`[native-build] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
