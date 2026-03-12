param(
  [string]$BaseUrl = '',
  [string]$ZipName = 'QuickText-win-x64.zip',
  [string]$Channel = 'stable',
  [string]$EntryExe = 'QuickText.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if (-not $BaseUrl) {
  if ($env:QT_RELEASE_BASE_URL) {
    $BaseUrl = [string]$env:QT_RELEASE_BASE_URL
  }
}

if (-not $BaseUrl) {
  throw 'Missing base URL. Pass -BaseUrl or set QT_RELEASE_BASE_URL.'
}

$distRoot = Join-Path $repoRoot 'dist'
$unpackedRoot = Join-Path $distRoot 'win-unpacked'
$zipPath = Join-Path $distRoot $ZipName
$manifestPath = Join-Path $distRoot 'latest.json'

if (-not (Test-Path -LiteralPath $unpackedRoot)) {
  throw 'Missing dist/win-unpacked. Run `npm run dist:folder` first.'
}

Write-Host "[release] Building zip: $zipPath"
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $unpackedRoot '*') -DestinationPath $zipPath -Force

$packageJsonPath = Join-Path $repoRoot 'package.json'
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
if (-not $version) {
  throw 'Cannot read version from package.json'
}

Write-Host "[release] Generating manifest: $manifestPath"
node scripts/generate-launcher-manifest.mjs `
  --zip $zipPath `
  --version $version `
  --base-url $BaseUrl `
  --out $manifestPath `
  --channel $Channel `
  --entry-exe $EntryExe

Write-Host '[release] Done'
Write-Host "  Zip: $zipPath"
Write-Host "  Manifest: $manifestPath"
