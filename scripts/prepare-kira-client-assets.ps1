param(
  [string]$SourceDir = "assets/kira-client/source"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$resolvedSourceDir = if ([System.IO.Path]::IsPathRooted($SourceDir)) { $SourceDir } else { Join-Path $repoRoot $SourceDir }
$assetRoot = Join-Path $repoRoot "assets/kira-client"
$publicRoot = Join-Path $repoRoot "public/assets/kira-client"
$bootstrapperAssets = Join-Path $repoRoot "installer/bootstrapper/Assets"
$brandAssets = Join-Path $repoRoot "installer/brand"

$sourceMap = @{
  "quicktext-hero-source.png" = "MAIN UI.png"
  "sword-states-sheet.png" = "sidebar.png uninstaller-sidebar.png success-hero.png error-hero.png"
  "energy-core-sheet.png" = @(
    "progress-core.png (left) success-core.png (center) error-core.png (right)",
    "progress-core.png success-hero.png error-hero.png"
  )
  "hud-frame-header-sheet.png" = "frame-overlay.png header.png"
  "launch-button-source.png" = "lauchbutton.png"
  "noise-overlay-source.png" = "noise-overlay.png"
  "header-source.png" = "header.png"
}

New-Item -ItemType Directory -Path $resolvedSourceDir, $assetRoot, $publicRoot, $bootstrapperAssets, $brandAssets -Force | Out-Null

foreach ($entry in $sourceMap.GetEnumerator()) {
  $target = Join-Path $resolvedSourceDir $entry.Key
  $legacyNames = @($entry.Value)

  foreach ($legacyName in $legacyNames) {
    $legacy = Join-Path $repoRoot $legacyName
    if (-not (Test-Path -LiteralPath $legacy)) {
      continue
    }

    $shouldImport = -not (Test-Path -LiteralPath $target)
    if (-not $shouldImport) {
      $shouldImport = (Get-Item -LiteralPath $legacy).LastWriteTimeUtc -gt (Get-Item -LiteralPath $target).LastWriteTimeUtc
    }

    if ($shouldImport) {
      Copy-Item -LiteralPath $legacy -Destination $target -Force
      Write-Host "[kira-assets] imported $legacyName -> $target"
    }
    break
  }
}

foreach ($name in $sourceMap.Keys) {
  $path = Join-Path $resolvedSourceDir $name
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing Kira LC source asset: $path"
  }
}

Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class KiraClientImageTools
{
    public static Size GetSize(string input)
    {
        using (var image = Image.FromFile(input))
        {
            return image.Size;
        }
    }

    public static void SaveCover(string input, string output, int targetWidth, int targetHeight)
    {
        using (var image = Image.FromFile(input))
        using (var bitmap = new Bitmap(targetWidth, targetHeight, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            PrepareOutput(output);
            graphics.CompositingQuality = CompositingQuality.HighQuality;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = SmoothingMode.HighQuality;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.Clear(Color.Transparent);
            graphics.DrawImage(image, new Rectangle(0, 0, targetWidth, targetHeight), CoverRect(image.Width, image.Height, targetWidth, targetHeight), GraphicsUnit.Pixel);
            bitmap.Save(output, ImageFormat.Png);
        }
    }

    public static void SaveCrop(string input, string output, int x, int y, int width, int height, int targetWidth, int targetHeight, bool blackToAlpha, int threshold)
    {
        SaveCrop(input, output, x, y, width, height, targetWidth, targetHeight, blackToAlpha, threshold, 0);
    }

    public static void SaveCrop(string input, string output, int x, int y, int width, int height, int targetWidth, int targetHeight, bool blackToAlpha, int threshold, int feather)
    {
        using (var image = Image.FromFile(input))
        using (var bitmap = new Bitmap(targetWidth, targetHeight, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            PrepareOutput(output);
            graphics.CompositingQuality = CompositingQuality.HighQuality;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = SmoothingMode.HighQuality;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.Clear(Color.Transparent);
            graphics.DrawImage(image, new Rectangle(0, 0, targetWidth, targetHeight), new Rectangle(x, y, width, height), GraphicsUnit.Pixel);
            if (blackToAlpha)
            {
                ApplyBlackToAlpha(bitmap, threshold, feather);
            }
            bitmap.Save(output, ImageFormat.Png);
        }
    }

    public static void BlackToAlpha(string input, string output, int threshold, bool cropToContent, int padding, int targetWidth, int targetHeight)
    {
        BlackToAlpha(input, output, threshold, cropToContent, padding, targetWidth, targetHeight, 0);
    }

    public static void BlackToAlpha(string input, string output, int threshold, bool cropToContent, int padding, int targetWidth, int targetHeight, int feather)
    {
        using (var source = new Bitmap(input))
        {
            Rectangle crop = new Rectangle(0, 0, source.Width, source.Height);
            if (cropToContent)
            {
                crop = FindContentBounds(source, threshold);
                crop.Inflate(padding, padding);
                crop.Intersect(new Rectangle(0, 0, source.Width, source.Height));
            }

            int outputWidth = targetWidth > 0 ? targetWidth : crop.Width;
            int outputHeight = targetHeight > 0 ? targetHeight : crop.Height;
            using (var bitmap = new Bitmap(outputWidth, outputHeight, PixelFormat.Format32bppArgb))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                PrepareOutput(output);
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.SmoothingMode = SmoothingMode.HighQuality;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.Clear(Color.Transparent);
                graphics.DrawImage(source, new Rectangle(0, 0, outputWidth, outputHeight), crop, GraphicsUnit.Pixel);
                ApplyBlackToAlpha(bitmap, threshold, feather);
                bitmap.Save(output, ImageFormat.Png);
            }
        }
    }

    private static Rectangle CoverRect(int sourceWidth, int sourceHeight, int targetWidth, int targetHeight)
    {
        double sourceRatio = sourceWidth / (double)sourceHeight;
        double targetRatio = targetWidth / (double)targetHeight;
        if (sourceRatio > targetRatio)
        {
            int width = (int)Math.Round(sourceHeight * targetRatio);
            int left = (sourceWidth - width) / 2;
            return new Rectangle(left, 0, width, sourceHeight);
        }

        int height = (int)Math.Round(sourceWidth / targetRatio);
        int top = (sourceHeight - height) / 2;
        return new Rectangle(0, top, sourceWidth, height);
    }

    private static Rectangle FindContentBounds(Bitmap bitmap, int threshold)
    {
        int minX = bitmap.Width;
        int minY = bitmap.Height;
        int maxX = -1;
        int maxY = -1;

        for (int y = 0; y < bitmap.Height; y++)
        {
            for (int x = 0; x < bitmap.Width; x++)
            {
                Color color = bitmap.GetPixel(x, y);
                if (Math.Max(color.R, Math.Max(color.G, color.B)) <= threshold)
                {
                    continue;
                }

                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }

        if (maxX < minX || maxY < minY)
        {
            return new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        }

        return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
    }

    private static void ApplyBlackToAlpha(Bitmap bitmap, int threshold)
    {
        ApplyBlackToAlpha(bitmap, threshold, 0);
    }

    private static void ApplyBlackToAlpha(Bitmap bitmap, int threshold, int feather)
    {
        int featherRange = Math.Max(0, feather);
        for (int y = 0; y < bitmap.Height; y++)
        {
            for (int x = 0; x < bitmap.Width; x++)
            {
                Color color = bitmap.GetPixel(x, y);
                int brightness = Math.Max(color.R, Math.Max(color.G, color.B));
                if (brightness <= threshold)
                {
                    bitmap.SetPixel(x, y, Color.FromArgb(0, color.R, color.G, color.B));
                    continue;
                }

                if (featherRange > 0 && brightness < threshold + featherRange)
                {
                    double t = (brightness - threshold) / (double)featherRange;
                    int alpha = (int)Math.Round(color.A * Math.Max(0, Math.Min(1, t)));
                    bitmap.SetPixel(x, y, Color.FromArgb(alpha, color.R, color.G, color.B));
                }
            }
        }
    }

    private static void PrepareOutput(string output)
    {
        string directory = Path.GetDirectoryName(output);
        if (!String.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }
    }
}
"@

function Copy-Asset {
  param(
    [string]$Source,
    [string[]]$Destinations
  )

  foreach ($destination in $Destinations) {
    $directory = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destination -Force
    Write-Host "[kira-assets] wrote $destination"
  }
}

$sourceHero = Join-Path $resolvedSourceDir "quicktext-hero-source.png"
$sourceSword = Join-Path $resolvedSourceDir "sword-states-sheet.png"
$sourceCore = Join-Path $resolvedSourceDir "energy-core-sheet.png"
$sourceHud = Join-Path $resolvedSourceDir "hud-frame-header-sheet.png"
$sourceLaunch = Join-Path $resolvedSourceDir "launch-button-source.png"
$sourceNoise = Join-Path $resolvedSourceDir "noise-overlay-source.png"
$sourceHeader = Join-Path $resolvedSourceDir "header-source.png"

foreach ($dir in @("brand", "installer", "ui", "modules", "states")) {
  New-Item -ItemType Directory -Path (Join-Path $assetRoot $dir), (Join-Path $publicRoot $dir) -Force | Out-Null
}

# Main client background.
$quickTextHero = Join-Path $assetRoot "modules/quicktext-hero.png"
[KiraClientImageTools]::SaveCover($sourceHero, $quickTextHero, 1920, 1080)
Copy-Asset $quickTextHero @(
  (Join-Path $publicRoot "modules/quicktext-hero.png"),
  (Join-Path $bootstrapperAssets "quicktext-hero.png")
)

# Synchronized sword states, 2x2 grid:
# top-left install, top-right uninstall, bottom-left success, bottom-right error.
$swordSize = [KiraClientImageTools]::GetSize($sourceSword)
$swordPanelWidth = [int][Math]::Floor($swordSize.Width / 2)
$swordPanelHeight = [int][Math]::Floor($swordSize.Height / 2)
$swordStates = @(
  @{ File = "sword-pristine.png"; Installer = "install-hero.png"; Brand = "sidebar.png"; X = 0; Y = 0 },
  @{ File = "sword-damaged.png"; Installer = "uninstall-hero.png"; Brand = "uninstaller-sidebar.png"; X = 1; Y = 0 },
  @{ File = "sword-success.png"; Installer = "success-hero.png"; Brand = ""; X = 0; Y = 1 },
  @{ File = "sword-error.png"; Installer = "error-hero.png"; Brand = ""; X = 1; Y = 1 }
)

foreach ($state in $swordStates) {
  $brandOutput = Join-Path $assetRoot ("brand/" + $state.File)
  [KiraClientImageTools]::SaveCrop($sourceSword, $brandOutput, $state.X * $swordPanelWidth, $state.Y * $swordPanelHeight, $swordPanelWidth, $swordPanelHeight, 1024, 1024, $false, 0)

  $destinations = @(
    (Join-Path $publicRoot ("brand/" + $state.File)),
    (Join-Path $bootstrapperAssets $state.Installer)
  )
  if (-not [string]::IsNullOrWhiteSpace($state.Brand)) {
    $destinations += Join-Path $brandAssets $state.Brand
  }
  Copy-Asset $brandOutput $destinations
}

# Energy core top-row states.
$coreSize = [KiraClientImageTools]::GetSize($sourceCore)
$corePanelWidth = [int][Math]::Floor($coreSize.Width / 3)
$corePanelHeight = [int][Math]::Floor($coreSize.Height * 0.58)
$coreStates = @(
  @{ File = "progress-core.png"; X = 0 },
  @{ File = "success-core.png"; X = 1 },
  @{ File = "error-core.png"; X = 2 }
)

foreach ($state in $coreStates) {
  $rawCore = Join-Path $assetRoot ("states/raw-" + $state.File)
  $finalCore = Join-Path $assetRoot ("states/" + $state.File)
  [KiraClientImageTools]::SaveCrop($sourceCore, $rawCore, $state.X * $corePanelWidth, 0, $corePanelWidth, $corePanelHeight, 640, 640, $false, 0)
  [KiraClientImageTools]::BlackToAlpha($rawCore, $finalCore, 18, $true, 18, 512, 512, 42)
  Remove-Item -LiteralPath $rawCore -Force
  $destinations = @((Join-Path $publicRoot ("states/" + $state.File)))
  if ($state.File -eq "progress-core.png") {
    $destinations += Join-Path $bootstrapperAssets "progress-core.png"
  }
  if ($state.File -eq "success-core.png") {
    $destinations += Join-Path $bootstrapperAssets "success-core.png"
  }
  if ($state.File -eq "error-core.png") {
    $destinations += Join-Path $bootstrapperAssets "error-core.png"
  }
  Copy-Asset $finalCore $destinations
}

# Bottom-row scene states from the same core sheet. These preserve the wider artwork instead of discarding it.
$sceneTop = [int][Math]::Floor($coreSize.Height * 0.584)
$scenePanelHeight = $coreSize.Height - $sceneTop
$sceneStates = @(
  @{ File = "progress-scene.png"; X = 0 },
  @{ File = "success-scene.png"; X = 1 },
  @{ File = "error-scene.png"; X = 2 }
)

foreach ($state in $sceneStates) {
  $sceneOutput = Join-Path $assetRoot ("states/" + $state.File)
  [KiraClientImageTools]::SaveCrop($sourceCore, $sceneOutput, $state.X * $corePanelWidth, $sceneTop, $corePanelWidth, $scenePanelHeight, 900, 520, $false, 0)
  Copy-Asset $sceneOutput @(
    (Join-Path $publicRoot ("states/" + $state.File)),
    (Join-Path $bootstrapperAssets $state.File)
  )
}

# HUD frame sheet: top is frame overlay, bottom is header strip.
$hudSize = [KiraClientImageTools]::GetSize($sourceHud)
$frameHeight = [int][Math]::Floor($hudSize.Height * 0.755)
$headerHeight = $hudSize.Height - $frameHeight
$frameOutput = Join-Path $assetRoot "ui/frame-overlay.png"
$headerStripOutput = Join-Path $assetRoot "ui/header-strip.png"
[KiraClientImageTools]::SaveCrop($sourceHud, $frameOutput, 0, 0, $hudSize.Width, $frameHeight, 1920, 1080, $true, 22, 28)
[KiraClientImageTools]::SaveCrop($sourceHud, $headerStripOutput, 0, $frameHeight, $hudSize.Width, $headerHeight, 900, 300, $true, 22, 28)
Copy-Asset $frameOutput @(
  (Join-Path $publicRoot "ui/frame-overlay.png"),
  (Join-Path $bootstrapperAssets "frame-overlay.png")
)
Copy-Asset $headerStripOutput @(
  (Join-Path $publicRoot "ui/header-strip.png"),
  (Join-Path $bootstrapperAssets "header-strip.png")
)

# Header strip for NSIS fallback header art.
$headerOutput = Join-Path $assetRoot "installer/header.png"
[KiraClientImageTools]::SaveCover($sourceHeader, $headerOutput, 900, 300)
Copy-Asset $headerOutput @(
  (Join-Path $publicRoot "installer/header.png"),
  (Join-Path $bootstrapperAssets "header.png"),
  (Join-Path $brandAssets "header.png")
)

$headerGlowOutput = Join-Path $assetRoot "ui/header-glow.png"
[KiraClientImageTools]::BlackToAlpha($sourceHeader, $headerGlowOutput, 18, $false, 0, 900, 300, 52)
Copy-Asset $headerGlowOutput @(
  (Join-Path $publicRoot "ui/header-glow.png"),
  (Join-Path $bootstrapperAssets "header-glow.png")
)

# Launch button states, three panels across: normal, hover, active.
$launchSize = [KiraClientImageTools]::GetSize($sourceLaunch)
$launchPanelWidth = [int][Math]::Floor($launchSize.Width / 3)
$launchStates = @(
  @{ File = "launch-normal.png"; X = 0 },
  @{ File = "launch-hover.png"; X = 1 },
  @{ File = "launch-active.png"; X = 2 }
)

foreach ($state in $launchStates) {
  $rawLaunch = Join-Path $assetRoot ("ui/raw-" + $state.File)
  $finalLaunch = Join-Path $assetRoot ("ui/" + $state.File)
  [KiraClientImageTools]::SaveCrop($sourceLaunch, $rawLaunch, $state.X * $launchPanelWidth, 0, $launchPanelWidth, $launchSize.Height, 640, 320, $false, 0)
  [KiraClientImageTools]::BlackToAlpha($rawLaunch, $finalLaunch, 20, $true, 28, 400, 120, 36)
  Remove-Item -LiteralPath $rawLaunch -Force

  $destinations = @(
    (Join-Path $publicRoot ("ui/" + $state.File)),
    (Join-Path $bootstrapperAssets $state.File)
  )
  if ($state.File -eq "launch-normal.png") {
    $destinations += Join-Path $publicRoot "ui/launch-button-bg.png"
    $destinations += Join-Path $bootstrapperAssets "launch-button-bg.png"
  }
  Copy-Asset $finalLaunch $destinations
}

$noiseOutput = Join-Path $assetRoot "ui/noise-overlay.png"
[KiraClientImageTools]::SaveCover($sourceNoise, $noiseOutput, 1024, 1024)
Copy-Asset $noiseOutput @(
  (Join-Path $publicRoot "ui/noise-overlay.png"),
  (Join-Path $bootstrapperAssets "noise-overlay.png")
)

Write-Host "[kira-assets] complete"
