const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const pngToIco = require('png-to-ico')

const projectRoot = path.resolve(__dirname, '..')
const sourceIcon = path.join(projectRoot, 'public', 'icon.png')
const buildDir = path.join(projectRoot, 'build')
const installerBrandDir = path.join(projectRoot, 'installer', 'brand')
const installerArtCacheDir = path.join(buildDir, '.installer-art-cache')
const targetIcon = path.join(buildDir, 'icon.ico')
const installerIcon = path.join(buildDir, 'installer.ico')
const uninstallerIcon = path.join(buildDir, 'uninstaller.ico')
const installerHeaderIcon = path.join(buildDir, 'installerHeader.ico')
const installerHeader = path.join(buildDir, 'installerHeader.bmp')
const installerSidebar = path.join(buildDir, 'installerSidebar.bmp')
const uninstallerSidebar = path.join(buildDir, 'uninstallerSidebar.bmp')
const BRAND_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp']

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function lerp(left, right, t) {
  return left + (right - left) * t
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1
  const t = clampUnit((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mixColor(base, overlay, alpha) {
  const weight = clampUnit(alpha)
  return [
    lerp(base[0], overlay[0], weight),
    lerp(base[1], overlay[1], weight),
    lerp(base[2], overlay[2], weight),
  ]
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''")
}

function resolveBrandAsset(names) {
  if (!fs.existsSync(installerBrandDir)) return null

  for (const name of names) {
    for (const extension of BRAND_IMAGE_EXTENSIONS) {
      const candidate = path.join(installerBrandDir, `${name}${extension}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }

  return null
}

function convertBrandAssetToBmp(sourcePath, cacheName) {
  if (path.extname(sourcePath).toLowerCase() === '.bmp') {
    return sourcePath
  }

  fs.mkdirSync(installerArtCacheDir, { recursive: true })
  const outputPath = path.join(installerArtCacheDir, `${cacheName}.bmp`)
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$inputPath = '${escapePowerShellSingleQuoted(sourcePath)}'
$outputPath = '${escapePowerShellSingleQuoted(outputPath)}'
$image = [System.Drawing.Image]::FromFile($inputPath)
try {
  $bitmap = New-Object System.Drawing.Bitmap $image.Width, $image.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::FromArgb(8, 12, 24))
      $graphics.DrawImage($image, 0, 0, $image.Width, $image.Height)
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $image.Dispose()
}
`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim()
    const stdout = String(result.stdout || '').trim()
    throw new Error(stderr || stdout || `PowerShell image conversion failed with exit code ${result.status}`)
  }

  return outputPath
}

function readBmpImage(sourcePath) {
  const buffer = fs.readFileSync(sourcePath)
  if (buffer.length < 54 || buffer.readUInt16LE(0) !== 0x4d42) {
    throw new Error('not a BMP file')
  }

  const pixelOffset = buffer.readUInt32LE(10)
  const width = buffer.readInt32LE(18)
  const rawHeight = buffer.readInt32LE(22)
  const height = Math.abs(rawHeight)
  const topDown = rawHeight < 0
  const bitsPerPixel = buffer.readUInt16LE(28)
  const compression = buffer.readUInt32LE(30)

  if (width <= 0 || height <= 0) {
    throw new Error('invalid BMP dimensions')
  }
  if (compression !== 0) {
    throw new Error('compressed BMP files are not supported')
  }
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new Error(`unsupported BMP bit depth: ${bitsPerPixel}`)
  }

  const rowStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4
  const pixels = new Uint8ClampedArray(width * height * 3)

  for (let y = 0; y < height; y += 1) {
    const bmpY = topDown ? y : height - 1 - y
    const rowOffset = pixelOffset + bmpY * rowStride
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = rowOffset + x * (bitsPerPixel / 8)
      const targetOffset = (y * width + x) * 3
      const alpha = bitsPerPixel === 32 ? buffer[sourceOffset + 3] / 255 : 1
      pixels[targetOffset] = lerp(8, buffer[sourceOffset + 2], alpha)
      pixels[targetOffset + 1] = lerp(12, buffer[sourceOffset + 1], alpha)
      pixels[targetOffset + 2] = lerp(24, buffer[sourceOffset], alpha)
    }
  }

  return { width, height, pixels, sourcePath }
}

function loadBrandImage(slotName, names) {
  const sourcePath = resolveBrandAsset(names)
  if (!sourcePath) return null

  try {
    const bmpPath = convertBrandAssetToBmp(sourcePath, slotName)
    const image = readBmpImage(bmpPath)
    console.log(`[icon] using installer ${slotName} art: ${sourcePath}`)
    return image
  } catch (error) {
    console.warn(`[icon] skipped installer ${slotName} art (${sourcePath}): ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function loadInstallerBrandAssets() {
  const sidebar = loadBrandImage('sidebar', ['sidebar', 'hero', 'background'])
  return {
    sidebar,
    header: loadBrandImage('header', ['header', 'banner']),
    uninstallerSidebar: loadBrandImage('uninstaller-sidebar', ['uninstaller-sidebar', 'uninstall-sidebar', 'uninstall']) || sidebar,
  }
}

function getImagePixel(image, x, y) {
  const safeX = Math.max(0, Math.min(image.width - 1, x))
  const safeY = Math.max(0, Math.min(image.height - 1, y))
  const offset = (safeY * image.width + safeX) * 3
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]]
}

function sampleCoverImage(image, x, y, width, height, options = {}) {
  if (!image) return null

  const focusX = clampUnit(options.focusX ?? 0.5)
  const focusY = clampUnit(options.focusY ?? 0.5)
  const sourceAspect = image.width / image.height
  const targetAspect = width / height
  let cropWidth = image.width
  let cropHeight = image.height

  if (sourceAspect > targetAspect) {
    cropWidth = cropHeight * targetAspect
  } else {
    cropHeight = cropWidth / targetAspect
  }

  const cropX = (image.width - cropWidth) * focusX
  const cropY = (image.height - cropHeight) * focusY
  const sampleX = cropX + (x / Math.max(1, width - 1)) * Math.max(1, cropWidth - 1)
  const sampleY = cropY + (y / Math.max(1, height - 1)) * Math.max(1, cropHeight - 1)
  const left = Math.floor(sampleX)
  const top = Math.floor(sampleY)
  const right = Math.min(image.width - 1, left + 1)
  const bottom = Math.min(image.height - 1, top + 1)
  const tx = sampleX - left
  const ty = sampleY - top
  const topColor = mixColor(getImagePixel(image, left, top), getImagePixel(image, right, top), tx)
  const bottomColor = mixColor(getImagePixel(image, left, bottom), getImagePixel(image, right, bottom), tx)
  return mixColor(topColor, bottomColor, ty)
}

const FONT_5X7 = {
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
}

function textWidth(text, scale, tracking = 1) {
  let width = 0
  for (const raw of text) {
    if (raw === ' ') {
      width += 3 * scale + tracking * scale
      continue
    }
    width += 5 * scale + tracking * scale
  }
  return Math.max(0, width - tracking * scale)
}

function textMask(x, y, text, originX, originY, scale, tracking = 1) {
  let cursorX = originX
  for (const raw of text) {
    const char = raw.toUpperCase()
    if (char === ' ') {
      cursorX += (3 + tracking) * scale
      continue
    }

    const glyph = FONT_5X7[char]
    if (!glyph) {
      cursorX += (5 + tracking) * scale
      continue
    }

    const localX = Math.floor((x - cursorX) / scale)
    const localY = Math.floor((y - originY) / scale)
    if (localX >= 0 && localX < 5 && localY >= 0 && localY < 7 && glyph[localY][localX] === '1') {
      return true
    }

    cursorX += (5 + tracking) * scale
  }
  return false
}

function textGlowMask(x, y, text, originX, originY, scale, tracking = 1) {
  const radius = Math.max(1, Math.floor(scale * 1.25))
  let strength = 0
  for (let oy = -radius; oy <= radius; oy += 1) {
    for (let ox = -radius; ox <= radius; ox += 1) {
      if (ox === 0 && oy === 0) continue
      const distance = Math.sqrt(ox * ox + oy * oy)
      if (distance > radius) continue
      if (textMask(x + ox, y + oy, text, originX, originY, scale, tracking)) {
        strength = Math.max(strength, (radius - distance + 1) / (radius + 1))
      }
    }
  }
  return strength
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

function createSidebarPixelResolver(palette, brandAssets = {}) {
  const hasSidebarArt = Boolean(brandAssets.sidebar)

  return (x, y, width, height) => {
    const tX = x / (width - 1)
    const tY = y / (height - 1)

    const curvedMix = clampUnit(tY * 0.74 + tX * 0.22 + Math.sin((tY * 2.7 + tX * 1.8) * Math.PI) * 0.05)
    let color = [
      lerp(palette.bgTop[0], palette.bgBottom[0], curvedMix),
      lerp(palette.bgTop[1], palette.bgBottom[1], curvedMix),
      lerp(palette.bgTop[2], palette.bgBottom[2], curvedMix),
    ]

    const artColor = sampleCoverImage(brandAssets.sidebar, x, y, width, height, { focusX: 0.5, focusY: 0.5 })
    if (artColor) {
      const framedArea = smoothstep(0.01, 0.04, tX) * smoothstep(0.99, 0.96, tX) * smoothstep(0.01, 0.04, tY) * smoothstep(0.99, 0.96, tY)
      const posterTone = mixColor(artColor, palette.bgBottom, 0.08 + tY * 0.05)
      color = mixColor(color, posterTone, framedArea * 0.94)
    }

    const overlayStrength = hasSidebarArt ? 0.28 : 1
    const badgeStrength = hasSidebarArt ? 0.16 : 1
    const cyanBeam = Math.exp(-Math.pow((tX - (0.08 + tY * 0.36)) / 0.082, 2)) * 0.58 * overlayStrength
    const pinkBeam = Math.exp(-Math.pow((tX - (0.9 - tY * 0.52)) / 0.088, 2)) * 0.52 * overlayStrength
    const crossBeam = Math.exp(-Math.pow((tX - (0.54 + Math.sin(tY * 7.2) * 0.05)) / 0.11, 2)) * 0.15 * overlayStrength

    const nebulaTop = Math.exp(-((tX - 0.26) ** 2 * 16 + (tY - 0.11) ** 2 * 30)) * 0.24 * overlayStrength
    const nebulaMid = Math.exp(-((tX - 0.68) ** 2 * 13 + (tY - 0.56) ** 2 * 17)) * 0.18 * overlayStrength
    const nebulaBottom = Math.exp(-((tX - 0.4) ** 2 * 12 + (tY - 0.86) ** 2 * 20)) * 0.16 * overlayStrength

    const frameLeft = Math.exp(-Math.pow((tX - 0.012) / 0.016, 2)) * 0.38
    const frameRight = Math.exp(-Math.pow((tX - 0.988) / 0.016, 2)) * 0.32
    const frameTop = Math.exp(-Math.pow(tY / 0.03, 2)) * 0.36
    const frameBottom = Math.exp(-Math.pow((1 - tY) / 0.02, 2)) * 0.16

    const hx = (tX - 0.5) / 0.155
    const hy = (tY - 0.19) / 0.092
    const hexDistance = Math.max(Math.abs(hx) * 0.8660254 + Math.abs(hy) * 0.5, Math.abs(hy)) - 1
    const badgeFill = smoothstep(0.2, -0.04, hexDistance) * 0.38 * badgeStrength
    const badgeEdge = smoothstep(0.09, 0, Math.abs(hexDistance)) * 0.85 * badgeStrength
    const badgeCore = Math.exp(-((tX - 0.5) ** 2 * 190 + (tY - 0.19) ** 2 * 290)) * 0.96 * badgeStrength
    const badgeSpine = smoothstep(0.035, 0, Math.abs(tX - 0.5)) * smoothstep(0.29, 0.095, tY) * 0.42 * badgeStrength

    const scanWave = clampUnit((Math.sin(x * 0.15 + y * 0.12) + 1) * 0.5) * 0.06 * overlayStrength
    const pixelGrain = clampUnit((Math.sin(x * 1.87 + y * 2.31) + Math.sin(x * 0.73 + y * 1.19) + 2) / 4) * 0.05 * overlayStrength

    const lowerHUD = smoothstep(0.73, 0.88, tY) * smoothstep(0.16, 0.02, Math.abs(tX - 0.5)) * 0.24 * overlayStrength
    const hudLineA = Math.exp(-Math.pow((tY - 0.78) / 0.015, 2)) * smoothstep(0.2, 0.02, Math.abs(tX - 0.5)) * 0.24 * overlayStrength
    const hudLineB = Math.exp(-Math.pow((tY - 0.84) / 0.015, 2)) * smoothstep(0.23, 0.03, Math.abs(tX - 0.5)) * 0.21 * overlayStrength
    const titlePlate = hasSidebarArt ? 0 : smoothstep(0.42, 0.25, Math.abs(tX - 0.5)) * smoothstep(0.18, 0.03, Math.abs(tY - 0.42)) * 0.42

    color = mixColor(color, palette.cyan, cyanBeam + crossBeam)
    color = mixColor(color, palette.pink, pinkBeam)
    color = mixColor(color, palette.glow, nebulaTop + nebulaMid + nebulaBottom + frameTop + badgeCore + scanWave + hudLineA)
    color = mixColor(color, palette.edge, frameLeft + frameRight + frameBottom + badgeEdge + lowerHUD + hudLineB)
    color = mixColor(color, palette.bgTop, titlePlate)
    color = mixColor(color, palette.highlight, badgeFill + badgeSpine + pixelGrain)

    if (!hasSidebarArt) {
      const quickTextScale = 4
      const quickX = Math.floor((width - textWidth('QUICK', quickTextScale, 1)) / 2)
      const textX = Math.floor((width - textWidth('TEXT', quickTextScale, 1)) / 2)
      const quickY = 104
      const textY = 140
      const quickGlow = textGlowMask(x, y, 'QUICK', quickX, quickY, quickTextScale, 1)
      const textGlow = textGlowMask(x, y, 'TEXT', textX, textY, quickTextScale, 1)
      const wordmarkGlow = Math.max(quickGlow, textGlow)
      if (wordmarkGlow > 0) {
        color = mixColor(color, palette.cyan, wordmarkGlow * 0.55)
        color = mixColor(color, palette.glow, wordmarkGlow * 0.46)
      }
      if (textMask(x, y, 'QUICK', quickX, quickY, quickTextScale, 1)) {
        color = mixColor(color, palette.highlight, 1)
      }
      if (textMask(x, y, 'TEXT', textX, textY, quickTextScale, 1)) {
        color = mixColor(color, palette.pink, 0.88)
        color = mixColor(color, palette.highlight, 0.52)
      }
    }

    const vignetteX = (tX - 0.5) * 1.8
    const vignetteY = (tY - 0.52) * 1.45
    const vignette = clampUnit(1 - Math.sqrt(vignetteX * vignetteX + vignetteY * vignetteY) * 0.66)
    const contrast = hasSidebarArt ? 0.88 + vignette * 0.12 : 0.7 + vignette * 0.3
    color = [
      color[0] * contrast,
      color[1] * contrast,
      color[2] * contrast,
    ]

    return color
  }
}

function writeSidebarBmp(outputPath, palette, brandAssets = {}) {
  writeBmp(outputPath, 164, 314, createSidebarPixelResolver(palette, brandAssets))
}

function writeHeaderBmp(outputPath, palette, brandAssets = {}) {
  writeBmp(outputPath, 150, 57, (x, y, width, height) => {
    const tX = x / (width - 1)
    const tY = y / (height - 1)
    const mix = clampUnit(tX * 0.95 + tY * 0.18 + Math.sin((tX * 2.4 + tY * 5.6) * Math.PI) * 0.03)

    let color = [
      lerp(palette.bgTop[0], palette.bgBottom[0], mix),
      lerp(palette.bgTop[1], palette.bgBottom[1], mix),
      lerp(palette.bgTop[2], palette.bgBottom[2], mix),
    ]

    const artColor = sampleCoverImage(brandAssets.header || brandAssets.sidebar, x, y, width, height, { focusX: 0.5, focusY: 0.5 })
    if (artColor) {
      const posterTone = mixColor(artColor, palette.bgTop, 0.26)
      color = mixColor(color, posterTone, 0.7)
    }

    const topLine = Math.exp(-Math.pow(tY / 0.045, 2)) * 0.92
    const lowerLine = Math.exp(-Math.pow((1 - tY) / 0.07, 2)) * 0.34
    const cyanSweep = Math.exp(-Math.pow((tX - 0.24) / 0.16, 2)) * 0.42
    const pinkSweep = Math.exp(-Math.pow((tX - 0.82) / 0.17, 2)) * 0.4
    const centerPulse = Math.exp(-((tX - 0.55) ** 2 * 34 + (tY - 0.5) ** 2 * 58)) * 0.52
    const edgePulse = Math.exp(-Math.pow((tX - 0.985) / 0.022, 2)) * 0.38
    const centerLine = smoothstep(0.03, 0, Math.abs(tY - 0.5)) * smoothstep(0.62, 0.08, Math.abs(tX - 0.52)) * 0.24
    const grain = clampUnit((Math.sin(x * 1.41 + y * 1.73) + 1) * 0.5) * 0.04

    color = mixColor(color, palette.glow, topLine + centerPulse + centerLine)
    color = mixColor(color, palette.edge, lowerLine + edgePulse)
    color = mixColor(color, palette.pink, pinkSweep)
    color = mixColor(color, palette.cyan, cyanSweep + grain)

    const headerScale = 2
    const headerText = 'QUICK TEXT'
    const headerX = Math.floor((width - textWidth(headerText, headerScale, 1)) / 2)
    const headerY = 21
    const headerGlow = textGlowMask(x, y, headerText, headerX, headerY, headerScale, 1)
    if (headerGlow > 0) {
      color = mixColor(color, palette.cyan, headerGlow * 0.34)
      color = mixColor(color, palette.glow, headerGlow * 0.2)
    }
    if (textMask(x, y, headerText, headerX, headerY, headerScale, 1)) {
      color = mixColor(color, palette.highlight, 1)
    }

    return color
  })
}

async function main() {
  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`Missing source icon: ${sourceIcon}`)
  }

  fs.mkdirSync(buildDir, { recursive: true })
  const brandAssets = loadInstallerBrandAssets()
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
    edge: [91, 179, 227],
    highlight: [246, 250, 255],
  }, brandAssets)

  writeSidebarBmp(installerSidebar, {
    bgTop: [11, 15, 30],
    bgBottom: [19, 10, 23],
    cyan: [64, 217, 255],
    pink: [255, 77, 149],
    glow: [228, 244, 255],
    edge: [90, 183, 238],
    highlight: [243, 250, 255],
  }, { sidebar: brandAssets.sidebar })
  writeSidebarBmp(uninstallerSidebar, {
    bgTop: [28, 8, 25],
    bgBottom: [49, 11, 31],
    cyan: [103, 205, 255],
    pink: [255, 110, 166],
    glow: [252, 236, 244],
    edge: [211, 139, 205],
    highlight: [255, 245, 252],
  }, { sidebar: brandAssets.uninstallerSidebar })

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
