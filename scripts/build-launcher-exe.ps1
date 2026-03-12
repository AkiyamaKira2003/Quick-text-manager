param(
  [string]$InputPath = 'launcher/QuickText.ps1',
  [string]$OutputPath = 'launcher/QuickTextLauncher.exe',
  [string]$IconPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$resolvedInput = Join-Path $repoRoot $InputPath
$resolvedOutput = Join-Path $repoRoot $OutputPath

if (-not (Test-Path -LiteralPath $resolvedInput)) {
  throw "Input script not found: $resolvedInput"
}

$compiler = Get-Command -Name Invoke-ps2exe -ErrorAction SilentlyContinue
if (-not $compiler) {
  $compiler = Get-Command -Name Invoke-PS2EXE -ErrorAction SilentlyContinue
}

if (-not $compiler) {
  throw 'ps2exe is not installed. Run: Install-Module ps2exe -Scope CurrentUser'
}

$invokeArgs = @{
  inputFile = $resolvedInput
  outputFile = $resolvedOutput
  noConsole = $true
}

if ($IconPath) {
  $resolvedIcon = Join-Path $repoRoot $IconPath
  if (Test-Path -LiteralPath $resolvedIcon) {
    $invokeArgs.iconFile = $resolvedIcon
  }
}

& $compiler.Name @invokeArgs

Write-Host "Launcher EXE generated: $resolvedOutput"
