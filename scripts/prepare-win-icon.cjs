const fs = require('fs')
const path = require('path')
const pngToIco = require('png-to-ico')

const projectRoot = path.resolve(__dirname, '..')
const sourceIcon = path.join(projectRoot, 'public', 'icon.png')
const buildDir = path.join(projectRoot, 'build')
const targetIcon = path.join(buildDir, 'icon.ico')

async function main() {
  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`Missing source icon: ${sourceIcon}`)
  }

  fs.mkdirSync(buildDir, { recursive: true })
  const icoBuffer = await pngToIco(sourceIcon)
  fs.writeFileSync(targetIcon, icoBuffer)
  console.log(`[icon] generated ${targetIcon}`)
}

main().catch((error) => {
  console.error('[icon] failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
