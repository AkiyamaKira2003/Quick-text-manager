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
  "allstate.png" = "allstate.png"
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

    public static void SaveContainCrop(string input, string output, int x, int y, int width, int height, int targetWidth, int targetHeight, bool blackToAlpha, int threshold, int feather)
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
            graphics.DrawImage(image, ContainRect(width, height, targetWidth, targetHeight), new Rectangle(x, y, width, height), GraphicsUnit.Pixel);
            if (blackToAlpha)
            {
                ApplyBlackToAlpha(bitmap, threshold, feather);
            }
            bitmap.Save(output, ImageFormat.Png);
        }
    }

    public static void SaveAlignedContentCrop(string input, string output, int x, int y, int width, int height, int targetWidth, int targetHeight, int fitWidth, int fitHeight, int centerX, int centerY, bool blackToAlpha, int contentThreshold, int alphaThreshold, int feather)
    {
        using (var source = new Bitmap(input))
        using (var bitmap = new Bitmap(targetWidth, targetHeight, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            PrepareOutput(output);
            graphics.CompositingQuality = CompositingQuality.HighQuality;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = SmoothingMode.HighQuality;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.Clear(Color.Transparent);

            Rectangle panel = new Rectangle(x, y, width, height);
            Rectangle content = FindContentBounds(source, panel, contentThreshold);
            content.Inflate(18, 18);
            content.Intersect(panel);

            double scale = Math.Min(fitWidth / (double)content.Width, fitHeight / (double)content.Height);
            int outputWidth = Math.Max(1, (int)Math.Round(content.Width * scale));
            int outputHeight = Math.Max(1, (int)Math.Round(content.Height * scale));
            int left = centerX - outputWidth / 2;
            int top = centerY - outputHeight / 2;

            graphics.DrawImage(source, new Rectangle(left, top, outputWidth, outputHeight), content, GraphicsUnit.Pixel);
            if (blackToAlpha)
            {
                ApplyBlackToAlpha(bitmap, alphaThreshold, feather);
            }
            bitmap.Save(output, ImageFormat.Png);
        }
    }

    public static void TintExisting(string input, string output, int red, int green, int blue, double glowStrength, double metalStrength, double brightness)
    {
        using (var bitmap = new Bitmap(input))
        {
            PrepareOutput(output);
            for (int y = 0; y < bitmap.Height; y++)
            {
                for (int x = 0; x < bitmap.Width; x++)
                {
                    Color color = bitmap.GetPixel(x, y);
                    if (color.A == 0)
                    {
                        continue;
                    }

                    int max = Math.Max(color.R, Math.Max(color.G, color.B));
                    if (max <= 4)
                    {
                        continue;
                    }

                    int min = Math.Min(color.R, Math.Min(color.G, color.B));
                    double saturation = max <= 0 ? 0 : (max - min) / (double)max;
                    double luma = (0.2126 * color.R) + (0.7152 * color.G) + (0.0722 * color.B);
                    double bright = max / 255.0;
                    double tintAmount = Clamp01(metalStrength + (saturation * glowStrength) + (bright * glowStrength * 0.18));
                    double targetScale = Math.Min(1.35, (0.32 + (luma / 255.0)) * brightness);

                    int outR = ClampByte((color.R * (1 - tintAmount)) + (red * targetScale * tintAmount));
                    int outG = ClampByte((color.G * (1 - tintAmount)) + (green * targetScale * tintAmount));
                    int outB = ClampByte((color.B * (1 - tintAmount)) + (blue * targetScale * tintAmount));
                    bitmap.SetPixel(x, y, Color.FromArgb(color.A, outR, outG, outB));
                }
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

    private static Rectangle ContainRect(int sourceWidth, int sourceHeight, int targetWidth, int targetHeight)
    {
        double sourceRatio = sourceWidth / (double)sourceHeight;
        double targetRatio = targetWidth / (double)targetHeight;
        if (sourceRatio > targetRatio)
        {
            int width = targetWidth;
            int height = (int)Math.Round(targetWidth / sourceRatio);
            int top = (targetHeight - height) / 2;
            return new Rectangle(0, top, width, height);
        }

        int outputHeight = targetHeight;
        int outputWidth = (int)Math.Round(targetHeight * sourceRatio);
        int left = (targetWidth - outputWidth) / 2;
        return new Rectangle(left, 0, outputWidth, outputHeight);
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

    private static Rectangle FindContentBounds(Bitmap bitmap, Rectangle area, int threshold)
    {
        int minX = area.Right;
        int minY = area.Bottom;
        int maxX = area.Left - 1;
        int maxY = area.Top - 1;

        for (int y = area.Top; y < area.Bottom; y++)
        {
            for (int x = area.Left; x < area.Right; x++)
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
            return area;
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

    private static double Clamp01(double value)
    {
        if (value < 0) return 0;
        if (value > 1) return 1;
        return value;
    }

    private static int ClampByte(double value)
    {
        if (value < 0) return 0;
        if (value > 255) return 255;
        return (int)Math.Round(value);
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
$sourceAllstate = Join-Path $resolvedSourceDir "allstate.png"
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

# Registered Quick Text states from allstate.png. All states use the same
# source geometry and only change tint, so crossfades cannot drift.
$allstateSize = [KiraClientImageTools]::GetSize($sourceAllstate)
$allstatePanelWidth = [int][Math]::Floor($allstateSize.Width / 3)
$allstatePanelHeight = [int][Math]::Floor($allstateSize.Height / 2)
$registeredStateSourceX = 0
$registeredStateSourceY = 0
$registeredBrandBase = Join-Path $assetRoot "brand/_quicktext-registered-base.png"
$registeredHeroBase = Join-Path $assetRoot "states/_quicktext-registered-hero.png"
$registeredHeroAlphaBase = Join-Path $assetRoot "states/_quicktext-registered-hero-alpha.png"

[KiraClientImageTools]::SaveAlignedContentCrop($sourceAllstate, $registeredBrandBase, $registeredStateSourceX, $registeredStateSourceY, $allstatePanelWidth, $allstatePanelHeight, 1024, 1792, 820, 820, 512, 700, $false, 120, 0, 0)
[KiraClientImageTools]::SaveAlignedContentCrop($sourceAllstate, $registeredHeroBase, $registeredStateSourceX, $registeredStateSourceY, $allstatePanelWidth, $allstatePanelHeight, 1280, 720, 520, 520, 640, 360, $false, 120, 0, 0)
[KiraClientImageTools]::SaveAlignedContentCrop($sourceAllstate, $registeredHeroAlphaBase, $registeredStateSourceX, $registeredStateSourceY, $allstatePanelWidth, $allstatePanelHeight, 1024, 1536, 820, 820, 512, 760, $true, 120, 18, 36)

$quickTextStates = @(
  @{ File = "quicktext-missing.png"; Hero = "missing-hero.png"; HeroAlpha = "missing-hero-alpha.png"; Brand = ""; R = 70; G = 214; B = 255; Glow = 0.12; Metal = 0.03; Brightness = 0.84 },
  @{ File = "quicktext-installing.png"; Hero = "install-hero.png"; HeroAlpha = "install-hero-alpha.png"; Brand = "sidebar.png"; R = 40; G = 211; B = 255; Glow = 0.62; Metal = 0.08; Brightness = 1.08 },
  @{ File = "quicktext-installed.png"; Hero = "success-hero.png"; HeroAlpha = "success-hero-alpha.png"; Brand = ""; R = 80; G = 245; B = 74; Glow = 0.78; Metal = 0.1; Brightness = 1.1 },
  @{ File = "quicktext-update.png"; Hero = "update-hero.png"; HeroAlpha = "update-hero-alpha.png"; Brand = ""; R = 255; G = 190; B = 42; Glow = 0.72; Metal = 0.08; Brightness = 1.06 },
  @{ File = "quicktext-removing.png"; Hero = "uninstall-hero.png"; HeroAlpha = "uninstall-hero-alpha.png"; Brand = "uninstaller-sidebar.png"; R = 255; G = 106; B = 45; Glow = 0.76; Metal = 0.09; Brightness = 1.03 },
  @{ File = "quicktext-error.png"; Hero = "error-hero.png"; HeroAlpha = "error-hero-alpha.png"; Brand = ""; R = 255; G = 56; B = 72; Glow = 0.88; Metal = 0.1; Brightness = 1.02 }
)

foreach ($state in $quickTextStates) {
  $brandOutput = Join-Path $assetRoot ("brand/" + $state.File)
  $heroOutput = Join-Path $assetRoot ("states/" + $state.Hero)
  $heroAlphaOutput = Join-Path $assetRoot ("states/" + $state.HeroAlpha)

  [KiraClientImageTools]::TintExisting($registeredBrandBase, $brandOutput, $state.R, $state.G, $state.B, $state.Glow, $state.Metal, $state.Brightness)
  [KiraClientImageTools]::TintExisting($registeredHeroBase, $heroOutput, $state.R, $state.G, $state.B, $state.Glow, $state.Metal, $state.Brightness)
  [KiraClientImageTools]::TintExisting($registeredHeroAlphaBase, $heroAlphaOutput, $state.R, $state.G, $state.B, $state.Glow, $state.Metal, $state.Brightness)

  $destinations = @(
    (Join-Path $publicRoot ("brand/" + $state.File))
  )
  if (-not [string]::IsNullOrWhiteSpace($state.Brand)) {
    $destinations += Join-Path $brandAssets $state.Brand
  }
  Copy-Asset $brandOutput $destinations
  Copy-Asset $heroOutput @(
    (Join-Path $bootstrapperAssets $state.Hero)
  )
  Copy-Asset $heroAlphaOutput @(
    (Join-Path $bootstrapperAssets $state.HeroAlpha)
  )
}

Remove-Item -LiteralPath $registeredBrandBase, $registeredHeroBase, $registeredHeroAlphaBase -Force

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
