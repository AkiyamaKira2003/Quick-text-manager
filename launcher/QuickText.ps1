param(
  [string]$ManifestUrl = '',
  [string]$Channel = '',
  [switch]$NoUpdate,
  [switch]$ForceUpdate,
  [switch]$SkipLaunch,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$AppArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $Channel) {
  $Channel = if ($env:QT_LAUNCHER_CHANNEL) { [string]$env:QT_LAUNCHER_CHANNEL } else { 'stable' }
}

$script:LauncherName = 'QuickTextLauncher'
$script:DefaultManifestUrl = 'https://example.com/quicktext/latest.json'
$script:DefaultEntryExe = 'QuickText.exe'

function Write-LauncherLog {
  param(
    [string]$Message,
    [string]$Level = 'INFO'
  )
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Write-Host "[$ts][$Level] $Message"
}

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    [void](New-Item -ItemType Directory -Path $Path -Force)
  }
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-JsonFile {
  param(
    [string]$Path,
    [object]$Value
  )
  $json = $Value | ConvertTo-Json -Depth 16
  Set-Content -LiteralPath $Path -Value $json -Encoding UTF8
}

function Compare-Version {
  param(
    [string]$Left,
    [string]$Right
  )
  $leftText = if ($Left) { $Left.Trim() } else { '0.0.0' }
  $rightText = if ($Right) { $Right.Trim() } else { '0.0.0' }

  try {
    $leftVersion = [version]$leftText
    $rightVersion = [version]$rightText
    return $leftVersion.CompareTo($rightVersion)
  } catch {
    return [string]::Compare($leftText, $rightText, $true)
  }
}

function Enter-LockFile {
  param([string]$Path)
  try {
    return [System.IO.File]::Open($Path, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch {
    throw 'Another launcher instance is running.'
  }
}

function Exit-LockFile {
  param($Handle)
  if ($null -ne $Handle) {
    $Handle.Dispose()
  }
}

function Get-FileSha256 {
  param([string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Resolve-AppRoot {
  param(
    [string]$BasePath,
    [string]$EntryExe
  )
  $direct = Join-Path $BasePath $EntryExe
  if (Test-Path -LiteralPath $direct) {
    return $BasePath
  }

  $match = Get-ChildItem -LiteralPath $BasePath -Recurse -File -Filter $EntryExe | Select-Object -First 1
  if ($null -eq $match) { return '' }
  return $match.DirectoryName
}

function Resolve-AppExePath {
  param(
    [string]$CurrentPath,
    [string]$EntryExe
  )
  if (-not (Test-Path -LiteralPath $CurrentPath)) { return '' }
  $root = Resolve-AppRoot -BasePath $CurrentPath -EntryExe $EntryExe
  if (-not $root) { return '' }
  return (Join-Path $root $EntryExe)
}

function Download-File {
  param(
    [string]$Url,
    [string]$DestinationPath
  )
  Invoke-WebRequest -Uri $Url -OutFile $DestinationPath -UseBasicParsing -TimeoutSec 300
}

function Get-Manifest {
  param([string]$Url)
  return Invoke-RestMethod -Uri $Url -UseBasicParsing -TimeoutSec 12
}

function Validate-Manifest {
  param([object]$Manifest)
  if ($null -eq $Manifest) {
    throw 'Manifest payload is empty.'
  }
  if (-not $Manifest.version) {
    throw 'Manifest missing `version`.'
  }
  if (-not $Manifest.url) {
    throw 'Manifest missing `url`.'
  }
  if (-not $Manifest.sha256) {
    throw 'Manifest missing `sha256`.'
  }
}

function Remove-PathSafe {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Resolve-ManifestUrl {
  param(
    [string]$ExplicitManifestUrl,
    [string]$ConfigPath
  )
  if ($ExplicitManifestUrl) { return $ExplicitManifestUrl.Trim() }
  if ($env:QT_LAUNCHER_MANIFEST_URL) { return [string]$env:QT_LAUNCHER_MANIFEST_URL }

  $config = Read-JsonFile -Path $ConfigPath
  if ($null -ne $config -and $config.manifestUrl) {
    return [string]$config.manifestUrl
  }
  return $script:DefaultManifestUrl
}

function Is-NetworkAvailable {
  try {
    return [System.Net.NetworkInformation.NetworkInterface]::GetIsNetworkAvailable()
  } catch {
    return $true
  }
}

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $launcherDir 'launcher.config.json'
$resolvedManifestUrl = Resolve-ManifestUrl -ExplicitManifestUrl $ManifestUrl -ConfigPath $configPath
$usingDefaultManifest = ($resolvedManifestUrl -eq $script:DefaultManifestUrl)

if ($usingDefaultManifest) {
  Write-LauncherLog -Level 'WARN' -Message "Using default placeholder manifest URL: $resolvedManifestUrl"
  Write-LauncherLog -Level 'WARN' -Message "Create launcher.config.json from launcher.config.example.json and set `manifestUrl`."
}

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$channelRoot = Join-Path (Join-Path $localAppData $script:LauncherName) $Channel
$runtimeRoot = Join-Path $channelRoot 'runtime'
$currentRoot = Join-Path $runtimeRoot 'current'
$downloadRoot = Join-Path $runtimeRoot 'downloads'
$tmpRoot = Join-Path $runtimeRoot 'tmp'
$statePath = Join-Path $channelRoot 'state.json'
$lockPath = Join-Path $channelRoot '.launcher.lock'

Ensure-Directory -Path $channelRoot
Ensure-Directory -Path $runtimeRoot
Ensure-Directory -Path $downloadRoot
Ensure-Directory -Path $tmpRoot

$lockHandle = $null
try {
  $lockHandle = Enter-LockFile -Path $lockPath

  $state = Read-JsonFile -Path $statePath
  $localVersion = if ($null -ne $state -and $state.version) { [string]$state.version } else { '0.0.0' }
  $entryExe = if ($null -ne $state -and $state.entryExe) { [string]$state.entryExe } else { $script:DefaultEntryExe }
  $localExePath = Resolve-AppExePath -CurrentPath $currentRoot -EntryExe $entryExe

  if ($NoUpdate) {
    if (-not $localExePath) {
      throw 'No local app found and update check disabled (`-NoUpdate`).'
    }
    Write-LauncherLog -Message "Update disabled. Launching local version $localVersion."
    if (-not $SkipLaunch) {
      if ($AppArgs -and $AppArgs.Count -gt 0) {
        Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) -ArgumentList $AppArgs | Out-Null
      } else {
        Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) | Out-Null
      }
    }
    exit 0
  }

  $manifest = $null
  $networkAvailable = Is-NetworkAvailable
  if (-not $networkAvailable) {
    Write-LauncherLog -Level 'WARN' -Message 'Network unavailable. Falling back to local runtime if present.'
  } else {
    try {
      $manifest = Get-Manifest -Url $resolvedManifestUrl
      Validate-Manifest -Manifest $manifest
    } catch {
      Write-LauncherLog -Level 'WARN' -Message "Cannot fetch manifest: $($_.Exception.Message)"
    }
  }

  if ($null -eq $manifest) {
    if (-not $localExePath) {
      if ($usingDefaultManifest) {
        throw "Manifest URL is still placeholder ($resolvedManifestUrl). Configure launcher.config.json with your real latest.json URL."
      }
      throw "Cannot reach update server ($resolvedManifestUrl) and no local runtime available."
    }
    Write-LauncherLog -Level 'WARN' -Message 'Starting local runtime because manifest is unavailable.'
    if (-not $SkipLaunch) {
      if ($AppArgs -and $AppArgs.Count -gt 0) {
        Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) -ArgumentList $AppArgs | Out-Null
      } else {
        Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) | Out-Null
      }
    }
    exit 0
  }

  $remoteVersion = [string]$manifest.version
  $remoteEntryExe = if ($manifest.entryExe) { [string]$manifest.entryExe } else { $entryExe }
  $needsUpdate = $ForceUpdate -or (-not $localExePath) -or ((Compare-Version -Left $localVersion -Right $remoteVersion) -lt 0)

  if (-not $needsUpdate) {
    Write-LauncherLog -Message "Local version $localVersion is up to date."
    if (-not $SkipLaunch) {
      if ($AppArgs -and $AppArgs.Count -gt 0) {
        Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) -ArgumentList $AppArgs | Out-Null
      } else {
        Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) | Out-Null
      }
    }
    exit 0
  }

  $running = @(Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($remoteEntryExe)) -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    if ($localExePath) {
      Write-LauncherLog -Level 'WARN' -Message 'QuickText is running. Close it to apply update. Launching current version.'
      if (-not $SkipLaunch) {
        if ($AppArgs -and $AppArgs.Count -gt 0) {
          Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) -ArgumentList $AppArgs | Out-Null
        } else {
          Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) | Out-Null
        }
      }
      exit 0
    }
    throw 'QuickText is currently running. Close it and run launcher again.'
  }

  $artifactUrl = [string]$manifest.url
  $artifactHash = ([string]$manifest.sha256).ToLowerInvariant()
  $artifactFileName = [System.IO.Path]::GetFileName(([Uri]$artifactUrl).LocalPath)
  if (-not $artifactFileName) {
    $artifactFileName = "QuickText-$remoteVersion.zip"
  }

  $downloadPath = Join-Path $downloadRoot $artifactFileName
  Write-LauncherLog -Message "Downloading update $remoteVersion..."
  Download-File -Url $artifactUrl -DestinationPath $downloadPath

  $actualHash = Get-FileSha256 -Path $downloadPath
  if ($actualHash -ne $artifactHash) {
    throw "Checksum mismatch. expected=$artifactHash actual=$actualHash"
  }
  Write-LauncherLog -Message 'Checksum verified.'

  $stageRoot = Join-Path $tmpRoot ("stage-" + $remoteVersion + "-" + [Guid]::NewGuid().ToString('N'))
  Ensure-Directory -Path $stageRoot
  Expand-Archive -LiteralPath $downloadPath -DestinationPath $stageRoot -Force

  $resolvedAppRoot = Resolve-AppRoot -BasePath $stageRoot -EntryExe $remoteEntryExe
  if (-not $resolvedAppRoot) {
    throw "Update package does not contain $remoteEntryExe"
  }

  $nextRoot = Join-Path $runtimeRoot 'current.next'
  $prevRoot = Join-Path $runtimeRoot 'current.prev'
  Remove-PathSafe -Path $nextRoot
  Remove-PathSafe -Path $prevRoot
  Move-Item -LiteralPath $resolvedAppRoot -Destination $nextRoot

  try {
    if (Test-Path -LiteralPath $currentRoot) {
      Move-Item -LiteralPath $currentRoot -Destination $prevRoot
    }
    Move-Item -LiteralPath $nextRoot -Destination $currentRoot
    Remove-PathSafe -Path $prevRoot
  } catch {
    if (-not (Test-Path -LiteralPath $currentRoot) -and (Test-Path -LiteralPath $prevRoot)) {
      Move-Item -LiteralPath $prevRoot -Destination $currentRoot
    }
    throw
  } finally {
    Remove-PathSafe -Path $nextRoot
    Remove-PathSafe -Path $stageRoot
  }

  $nextState = [ordered]@{
    app = if ($manifest.app) { [string]$manifest.app } else { 'QuickText' }
    channel = $Channel
    version = $remoteVersion
    entryExe = $remoteEntryExe
    manifestUrl = $resolvedManifestUrl
    artifactUrl = $artifactUrl
    sha256 = $artifactHash
    updatedAt = (Get-Date).ToString('o')
  }
  Write-JsonFile -Path $statePath -Value $nextState

  $localExePath = Resolve-AppExePath -CurrentPath $currentRoot -EntryExe $remoteEntryExe
  if (-not $localExePath) {
    throw "Updated runtime missing $remoteEntryExe"
  }

  Write-LauncherLog -Message "Update complete. Running version $remoteVersion."
  if (-not $SkipLaunch) {
    if ($AppArgs -and $AppArgs.Count -gt 0) {
      Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) -ArgumentList $AppArgs | Out-Null
    } else {
      Start-Process -FilePath $localExePath -WorkingDirectory (Split-Path -Parent $localExePath) | Out-Null
    }
  }
  exit 0
} catch {
  Write-LauncherLog -Level 'ERROR' -Message $_.Exception.Message
  exit 1
} finally {
  Exit-LockFile -Handle $lockHandle
}
