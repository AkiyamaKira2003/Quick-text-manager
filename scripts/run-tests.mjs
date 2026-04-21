import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const testsDir = path.resolve(process.cwd(), 'tests')

if (!existsSync(testsDir)) {
  console.error('Tests directory not found:', testsDir)
  process.exit(1)
}

const testFiles = readdirSync(testsDir)
  .filter((name) => /\.test\.(ts|js)$/.test(name))
  .map((name) => path.join(testsDir, name))
  .sort((a, b) => a.localeCompare(b))

if (testFiles.length === 0) {
  console.error('No test files found in tests/*.test.{ts,js}')
  process.exit(1)
}

const args = ['--import', 'tsx', '--test', ...testFiles]
const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

if (typeof result.status === 'number') {
  process.exit(result.status)
}

if (typeof result.signal === 'string') {
  process.kill(process.pid, result.signal)
}

process.exit(1)
