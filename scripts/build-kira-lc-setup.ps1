param(
  [string]$EnginePath = "",
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJsonPath = Join-Path $repoRoot "package.json"
$projectPath = Join-Path $repoRoot "installer/bootstrapper/QuickText.Setup.csproj"
$resourcesDir = Join-Path $repoRoot "installer/bootstrapper/Resources"
$publishDir = Join-Path $repoRoot "installer/bootstrapper/bin/Release/net8.0-windows/win-x64/publish"
$resolvedOutputDir = Join-Path $repoRoot $OutputDir

$package = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$version = [string]$package.version

if ([string]::IsNullOrWhiteSpace($EnginePath)) {
  $engine = Get-ChildItem -Path (Join-Path $repoRoot "dist/QuickText-Setup-*.exe") -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $engine) {
    throw "Missing QuickText setup engine. Build the NSIS installer first."
  }
  $EnginePath = $engine.FullName
}

if (-not (Test-Path -LiteralPath $EnginePath)) {
  throw "EnginePath does not exist: $EnginePath"
}

New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null
New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null
Copy-Item -LiteralPath $EnginePath -Destination (Join-Path $resourcesDir "QuickTextSetupEngine.exe") -Force

dotnet publish $projectPath `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:EnableCompressionInSingleFile=true `
  -p:Version=$version

$publishedExe = Join-Path $publishDir "KiraLC.Setup.exe"
if (-not (Test-Path -LiteralPath $publishedExe)) {
  throw "Missing published bootstrapper: $publishedExe"
}

$finalExe = Join-Path $resolvedOutputDir "KiraLC-Setup-$version.exe"
Copy-Item -LiteralPath $publishedExe -Destination $finalExe -Force
Write-Host "[kira-lc-setup] wrote $finalExe"
