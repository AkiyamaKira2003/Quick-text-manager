# QuickText Launcher Update Flow

## Goal

One-click flow:

1. User runs `QuickText.bat` (or compiled launcher `.exe`).
2. Launcher fetches `latest.json`.
3. Launcher compares local version vs remote version.
4. If outdated, launcher downloads zip, verifies SHA256, extracts, swaps runtime.
5. Launcher runs `QuickText.exe`.

## Files added

- `launcher/QuickText.ps1`: main launcher logic.
- `launcher/QuickText.bat`: thin wrapper for internal/test quick start.
- `launcher/latest.example.json`: manifest template.
- `launcher/launcher.config.example.json`: local launcher config template.
- `scripts/generate-launcher-manifest.mjs`: generates `latest.json` from release zip.
- `scripts/build-launcher-release.ps1`: builds zip + latest.json for release.
- `scripts/build-launcher-exe.ps1`: optional compile `QuickText.ps1` to launcher exe (via `ps2exe`).

## Manifest schema

`latest.json` must include:

- `version`: app version string.
- `url`: direct download URL to zip artifact.
- `sha256`: SHA256 checksum of zip.
- `entryExe`: executable name inside extracted package (`QuickText.exe`).

Example: [`launcher/latest.example.json`](/C:/Users/esket/Downloads/Tools/QuickText/launcher/latest.example.json)

## Release flow

1. Build app folder artifact:
   - `npm run dist:folder`
2. Build zip + manifest:
   - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-launcher-release.ps1 -BaseUrl "https://cdn.example.com/quicktext/"`
3. Upload:
   - `dist/QuickText-win-x64.zip`
   - `dist/latest.json`
4. Distribute launcher:
   - internal fast: `launcher/QuickText.bat`
   - final one-file UX: compile to exe with `scripts/build-launcher-exe.ps1`

## Launcher runtime data

Launcher stores runtime under:

- `%LOCALAPPDATA%\QuickTextLauncher\<channel>\runtime\current`

State file:

- `%LOCALAPPDATA%\QuickTextLauncher\<channel>\state.json`

## Channel + override settings

Environment variables supported:

- `QT_LAUNCHER_MANIFEST_URL`: override manifest URL.
- `QT_LAUNCHER_CHANNEL`: channel folder (`stable`, `beta`, etc.).
- `QT_PYTHON_BIN`: optional explicit Python binary for app runtime.

Script arguments:

- `-ManifestUrl`
- `-Channel`
- `-NoUpdate`
- `-ForceUpdate`
- `-SkipLaunch`

Local config:

- Copy `launcher/launcher.config.example.json` to `launcher/launcher.config.json`.
- Set `manifestUrl` to your real hosted `latest.json` URL.

## When to switch to integrated Electron updater

Use integrated updater when:

- installer/update pipeline is stable,
- you want native installer-level update UX,
- you have CI publish + signing process finalized.

For current ship-fast phase, external launcher remains easier to debug, rollback, and operate.
