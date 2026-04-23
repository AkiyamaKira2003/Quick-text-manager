const fs = require('fs')
const path = require('path')
const pngToIco = require('png-to-ico')

const projectRoot = path.resolve(__dirname, '..')
const sourceIcon = path.join(projectRoot, 'public', 'icon.png')
const buildDir = path.join(projectRoot, 'build')
const targetIcon = path.join(buildDir, 'icon.ico')
const installerIcon = path.join(buildDir, 'installer.ico')
const uninstallerIcon = path.join(buildDir, 'uninstaller.ico')
const installerHeaderIcon = path.join(buildDir, 'installerHeader.ico')
const installerSidebar = path.join(buildDir, 'installerSidebar.bmp')
const uninstallerSidebar = path.join(buildDir, 'uninstallerSidebar.bmp')

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function lerp(left, right, t) {
  return left + (right - left) * t
}

function writeSidebarBmp(outputPath, palette) {
  const width = 164
  const height = 314
  const rowStride = (width * 3 + 3) & ~3
  const pixelDataSize = rowStride * height
  const fileSize = 54 + pixelDataSize
  const bmp = Buffer.alloc(fileSize)

  bmp.writeUInt16LE(0x4d42, 0)
  bmp.writeUInt32LE(fileSize, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(width, 18)
  bmp.writeInt32LE(height, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(0, 30)
  bmp.writeUInt32LE(pixelDataSize, 34)
  bmp.writeInt32LE(3780, 38)
  bmp.writeInt32LE(3780, 42)
  bmp.writeUInt32LE(0, 46)
  bmp.writeUInt32LE(0, 50)

  for (let y = 0; y < height; y += 1) {
    const rowOffset = 54 + (height - 1 - y) * rowStride
    const tY = y / (height - 1)
    const wave = Math.sin(tY * Math.PI * 2.2) * 0.08
    const bgMix = Math.max(0, Math.min(1, tY + wave))

    for (let x = 0; x < width; x += 1) {
      const tX = x / (width - 1)
      const diagonal = Math.max(0, 1 - Math.abs((tX - tY * 0.65 - 0.15) * 3.8))
      const accentStrength = diagonal * 0.34
      const glowStrength = Math.max(0, 1 - Math.abs((tX - 0.82) * 7)) * 0.11

      let red = lerp(palette.top[0], palette.bottom[0], bgMix)
      let green = lerp(palette.top[1], palette.bottom[1], bgMix)
      let blue = lerp(palette.top[2], palette.bottom[2], bgMix)

      red = lerp(red, palette.accent[0], accentStrength + glowStrength)
      green = lerp(green, palette.accent[1], accentStrength + glowStrength)
      blue = lerp(blue, palette.accent[2], accentStrength + glowStrength)

      const pixelOffset = rowOffset + x * 3
      bmp[pixelOffset] = clampColor(blue)
      bmp[pixelOffset + 1] = clampColor(green)
      bmp[pixelOffset + 2] = clampColor(red)
    }
  }

  fs.writeFileSync(outputPath, bmp)
}

async function main() {
  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`Missing source icon: ${sourceIcon}`)
  }

  fs.mkdirSync(buildDir, { recursive: true })
  const icoBuffer = await pngToIco(sourceIcon)
  fs.writeFileSync(targetIcon, icoBuffer)
  fs.writeFileSync(installerIcon, icoBuffer)
  fs.writeFileSync(uninstallerIcon, icoBuffer)
  fs.writeFileSync(installerHeaderIcon, icoBuffer)

  writeSidebarBmp(installerSidebar, {
    top: [12, 37, 77],
    bottom: [28, 115, 199],
    accent: [255, 200, 110],
  })
  writeSidebarBmp(uninstallerSidebar, {
    top: [62, 23, 66],
    bottom: [153, 64, 131],
    accent: [255, 150, 112],
  })

  console.log(`[icon] generated ${targetIcon}`)
  console.log(`[icon] generated ${installerIcon}`)
  console.log(`[icon] generated ${uninstallerIcon}`)
  console.log(`[icon] generated ${installerHeaderIcon}`)
  console.log(`[icon] generated ${installerSidebar}`)
  console.log(`[icon] generated ${uninstallerSidebar}`)
}

main().catch((error) => {
  console.error('[icon] failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
