#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const pythonToolPath = path.join(repoRoot, 'python', 'tool.py')
const requirementsPath = path.join(repoRoot, 'python', 'requirements.txt')
const outputDir = path.join(repoRoot, 'build', 'python')
const workDir = path.join(repoRoot, 'build', '.pyinstaller-work')
const specDir = path.join(repoRoot, 'build', '.pyinstaller-spec')
const outputExePath = path.join(outputDir, 'QuickTextPython.exe')

function run(command, args, options = {}) {
  const pretty = [command, ...args].join(' ')
  process.stdout.write(`[python-build] ${pretty}\n`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${pretty}`)
  }
}

function commandExists(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, {
      cwd: repoRoot,
      stdio: 'ignore',
      shell: false,
    })
    return result.status === 0
  } catch {
    return false
  }
}

function resolvePythonBaseCommand() {
  const preferredCommand = String(process.env.QT_PYTHON_COMMAND || '').trim()
  if (preferredCommand) {
    const preferredParts = preferredCommand.split(/\s+/).filter(Boolean)
    const [command, ...baseArgs] = preferredParts
    if (command && commandExists(command, [...baseArgs, '--version'])) {
      return preferredParts
    }
    throw new Error(`QT_PYTHON_COMMAND is set but not usable: ${preferredCommand}`)
  }

  const candidates = process.env.CI
    ? [
        ['python'],
        ['py', '-3'],
        ['python3'],
      ]
    : [
        ['py', '-3'],
        ['python'],
        ['python3'],
      ]

  for (const candidate of candidates) {
    const [command, ...baseArgs] = candidate
    if (commandExists(command, [...baseArgs, '--version'])) {
      return candidate
    }
  }

  return null
}

function runPython(baseCommand, args) {
  const [command, ...baseArgs] = baseCommand
  run(command, [...baseArgs, ...args])
}

function ensureCleanDir(target) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
}

function main() {
  if (!fs.existsSync(pythonToolPath)) {
    throw new Error(`Missing python entry: ${pythonToolPath}`)
  }

  const baseCommand = resolvePythonBaseCommand()
  if (!baseCommand) {
    throw new Error('Cannot find Python launcher (`py -3`, `python`, or `python3`).')
  }

  ensureCleanDir(outputDir)
  ensureCleanDir(workDir)
  ensureCleanDir(specDir)

  const skipInstall = process.env.QT_SKIP_PYTHON_BUNDLE_INSTALL === '1'
  if (!skipInstall) {
    runPython(baseCommand, ['-m', 'pip', 'install', '--upgrade', 'pip'])
    runPython(baseCommand, ['-m', 'pip', 'install', '-r', requirementsPath, 'pyinstaller'])
  }

  runPython(baseCommand, [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onefile',
    '--name',
    'QuickTextPython',
    '--distpath',
    outputDir,
    '--workpath',
    workDir,
    '--specpath',
    specDir,
    '--hidden-import',
    'keyboard',
    '--hidden-import',
    'pynput',
    pythonToolPath,
  ])

  if (!fs.existsSync(outputExePath)) {
    throw new Error(`Build completed but executable not found: ${outputExePath}`)
  }

  process.stdout.write(`[python-build] ready: ${outputExePath}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`[python-build] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
