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
const installerHeader = path.join(buildDir, 'installerHeader.bmp')
const installerSidebar = path.join(buildDir, 'installerSidebar.bmp')
const uninstallerSidebar = path.join(buildDir, 'uninstallerSidebar.bmp')

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function lerp(left, right, t) {
  return left + (right - left) * t
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value))
}

function mixColor(base, overlay, alpha) {
  return [
    lerp(base[0], overlay[0], alpha),
    lerp(base[1], overlay[1], alpha),
    lerp(base[2], overlay[2], alpha),
  ]
}

function writeBmp(outputPath, width, height, resolvePixel) {
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
    for (let x = 0; x < width; x += 1) {
      const rgb = resolvePixel(x, y, width, height)
      const pixelOffset = rowOffset + x * 3
      bmp[pixelOffset] = clampColor(rgb[2])
      bmp[pixelOffset + 1] = clampColor(rgb[1])
      bmp[pixelOffset + 2] = clampColor(rgb[0])
    }
  }

  fs.writeFileSync(outputPath, bmp)
}

function createSidebarPixelResolver(palette) {
  return (x, y, width, height) => {
    const tX = x / (width - 1)
    const tY = y / (height - 1)
    const curvedMix = clampUnit(tY * 0.82 + tX * 0.18 + Math.sin((tY * 3.2 + tX * 1.9) * Math.PI) * 0.035)
    let color = [
      lerp(palette.bgTop[0], palette.bgBottom[0], curvedMix),
      lerp(palette.bgTop[1], palette.bgBottom[1], curvedMix),
      lerp(palette.bgTop[2], palette.bgBottom[2], curvedMix),
    ]

    const cyanBand = Math.exp(-Math.pow((tX - (0.12 + tY * 0.32)) / 0.12, 2)) * 0.4
    const pinkBand = Math.exp(-Math.pow((tX - (0.9 - tY * 0.56)) / 0.1, 2)) * 0.34
    const orbX = tX - 0.8
    const orbY = tY - 0.22
    const orb = Math.exp(-Math.sqrt(orbX * orbX + orbY * orbY) * 8.5) * 0.28
    const grid = clampUnit((Math.sin(x * 0.18 + y * 0.08) + 1) * 0.5) * 0.05

    color = mixColor(color, palette.cyan, cyanBand)
    color = mixColor(color, palette.pink, pinkBand)
    color = mixColor(color, palette.glow, orb + grid)

    const vignetteX = (tX - 0.5) * 1.8
    const vignetteY = (tY - 0.5) * 1.2
    const vignette = clampUnit(1 - Math.sqrt(vignetteX * vignetteX + vignetteY * vignetteY) * 0.55)
    color = [
      color[0] * (0.78 + vignette * 0.22),
      color[1] * (0.78 + vignette * 0.22),
      color[2] * (0.78 + vignette * 0.22),
    ]

    return color
  }
}

function writeSidebarBmp(outputPath, palette) {
  writeBmp(outputPath, 164, 314, createSidebarPixelResolver(palette))
}

function writeHeaderBmp(outputPath, palette) {
  writeBmp(outputPath, 150, 57, (x, y, width, height) => {
    const tX = x / (width - 1)
    const tY = y / (height - 1)
    const mix = clampUnit(tX * 0.92 + tY * 0.16)

    let color = [
      lerp(palette.bgTop[0], palette.bgBottom[0], mix),
      lerp(palette.bgTop[1], palette.bgBottom[1], mix),
      lerp(palette.bgTop[2], palette.bgBottom[2], mix),
    ]

    const topLine = Math.exp(-Math.pow(tY / 0.06, 2)) * 0.7
    const pinkSweep = Math.exp(-Math.pow((tX - 0.82) / 0.18, 2)) * 0.22
    const cyanSweep = Math.exp(-Math.pow((tX - 0.28) / 0.2, 2)) * 0.2

    color = mixColor(color, palette.glow, topLine)
    color = mixColor(color, palette.pink, pinkSweep)
    color = mixColor(color, palette.cyan, cyanSweep)

    return color
  })
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
  writeHeaderBmp(installerHeader, {
    bgTop: [11, 15, 30],
    bgBottom: [19, 10, 23],
    cyan: [64, 217, 255],
    pink: [255, 77, 149],
    glow: [228, 244, 255],
  })

  writeSidebarBmp(installerSidebar, {
    bgTop: [11, 15, 30],
    bgBottom: [19, 10, 23],
    cyan: [64, 217, 255],
    pink: [255, 77, 149],
    glow: [228, 244, 255],
  })
  writeSidebarBmp(uninstallerSidebar, {
    bgTop: [28, 8, 25],
    bgBottom: [49, 11, 31],
    cyan: [103, 205, 255],
    pink: [255, 110, 166],
    glow: [252, 236, 244],
  })

  console.log(`[icon] generated ${targetIcon}`)
  console.log(`[icon] generated ${installerIcon}`)
  console.log(`[icon] generated ${uninstallerIcon}`)
  console.log(`[icon] generated ${installerHeaderIcon}`)
  console.log(`[icon] generated ${installerHeader}`)
  console.log(`[icon] generated ${installerSidebar}`)
  console.log(`[icon] generated ${uninstallerSidebar}`)
}

main().catch((error) => {
  console.error('[icon] failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
