param(
  [string]$SourcePath = "installer/brand/allin.png"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$resolvedSourcePath = if ([System.IO.Path]::IsPathRooted($SourcePath)) { $SourcePath } else { Join-Path $repoRoot $SourcePath }

if (-not (Test-Path -LiteralPath $resolvedSourcePath) -and $SourcePath -eq "installer/brand/allin.png") {
  $legacyRootSourcePath = Join-Path $repoRoot "allin.png"
  if (Test-Path -LiteralPath $legacyRootSourcePath) {
    $resolvedSourcePath = $legacyRootSourcePath
  }
}

if (-not (Test-Path -LiteralPath $resolvedSourcePath)) {
  throw "Missing all-in artwork source: $resolvedSourcePath"
}

Add-Type -AssemblyName System.Drawing

$bootstrapperAssets = Join-Path $repoRoot "installer/bootstrapper/Assets"
$brandAssets = Join-Path $repoRoot "installer/brand"
New-Item -ItemType Directory -Path $bootstrapperAssets, $brandAssets -Force | Out-Null

$slots = @(
  @{ Name = "kira-lc-logo.png"; X = 18; Y = 47; W = 466; H = 214 },
  @{ Name = "brand-banner.png"; X = 510; Y = 53; W = 568; H = 200 },
  @{ Name = "kira-lc-wordmark.png"; X = 1100; Y = 80; W = 420; H = 132 },
  @{ Name = "install-hero.png"; X = 21; Y = 320; W = 292; H = 331 },
  @{ Name = "quick-text-module-card.png"; X = 341; Y = 335; W = 546; H = 287 },
  @{ Name = "uninstall-hero.png"; X = 909; Y = 315; W = 288; H = 334 },
  @{ Name = "progress-core.png"; X = 1212; Y = 322; W = 308; H = 315 },
  @{ Name = "success-hero.png"; X = 28; Y = 705; W = 273; H = 298 },
  @{ Name = "error-hero.png"; X = 330; Y = 705; W = 281; H = 298 },
  @{ Name = "noise-overlay.png"; X = 638; Y = 711; W = 356; H = 291 },
  @{ Name = "frame-overlay.png"; X = 1022; Y = 711; W = 498; H = 285 }
)

function Save-Crop {
  param(
    [System.Drawing.Image]$Image,
    [hashtable]$Slot,
    [string]$OutputPath
  )

  $rectangle = New-Object System.Drawing.Rectangle $Slot.X, $Slot.Y, $Slot.W, $Slot.H
  $bitmap = New-Object System.Drawing.Bitmap $Slot.W, $Slot.H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.DrawImage($Image, 0, 0, $rectangle, [System.Drawing.GraphicsUnit]::Pixel)
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
}

$image = [System.Drawing.Image]::FromFile($resolvedSourcePath)
try {
  foreach ($slot in $slots) {
    $outputPath = Join-Path $bootstrapperAssets $slot.Name
    Save-Crop -Image $image -Slot $slot -OutputPath $outputPath
    Write-Host "[allin-art] wrote $outputPath"
  }
} finally {
  $image.Dispose()
}

Copy-Item -LiteralPath (Join-Path $bootstrapperAssets "install-hero.png") -Destination (Join-Path $brandAssets "sidebar.png") -Force
Copy-Item -LiteralPath (Join-Path $bootstrapperAssets "brand-banner.png") -Destination (Join-Path $brandAssets "header.png") -Force
Copy-Item -LiteralPath (Join-Path $bootstrapperAssets "uninstall-hero.png") -Destination (Join-Path $brandAssets "uninstaller-sidebar.png") -Force
Write-Host "[allin-art] synced NSIS fallback artwork"
