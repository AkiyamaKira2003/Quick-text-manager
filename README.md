# QuickText

QuickText is a desktop overlay + text manager for fast in-game chat macros.

## Highlights

- Electron + Next.js desktop app
- Overlay mode with direct edit controls
- Global hotkeys for send/toggle actions
- Python bridge for low-level input automation
- External launcher flow for 1-click update + run

## Tech Stack

- Electron
- Next.js (App Router)
- React + TypeScript
- Python (Flask + keyboard/mouse hooks)

## Local Development

Prerequisites:

- Node.js 20+
- Python 3.10+ (`py` on Windows)

Install:

```powershell
npm install
```

Run dev:

```powershell
npm run dev
```

## Build Production

Build installer (`dist:win`):

```powershell
npm run dist:win
```

Build unpacked folder (`dist:folder`):

```powershell
npm run dist:folder
```

## 1-Click Launcher Update Flow

Launcher files:

- `launcher/QuickText.bat`
- `launcher/QuickText.ps1`

Flow:

1. Read online `latest.json`
2. Compare local version
3. Download zip if outdated
4. Verify SHA256
5. Extract and swap runtime
6. Run `QuickText.exe`

Setup:

1. Copy `launcher/launcher.config.example.json` to `launcher/launcher.config.json`
2. Set `manifestUrl` to your hosted `latest.json`
3. Run `launcher\QuickText.bat`

Details: [Launcher Update Flow](docs/launcher-update-flow.md)

## Release Assets + Manifest

Generate `latest.json` from a zip:

```powershell
npm run release:launcher:manifest -- --zip "dist/QuickText-win-x64.zip" --version 0.1.0 --base-url "https://cdn.example.com/quicktext/" --out "dist/latest.json"
```

Build zip + manifest in one step:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-launcher-release.ps1 -BaseUrl "https://cdn.example.com/quicktext/"
```

Optional: compile launcher `.ps1` to `.exe`:

```powershell
npm run release:launcher:exe
```

## Public GitHub Release (Recommended)

- Push tag (example `v0.1.0`)
- GitHub Actions workflow builds zip + `latest.json`
- Workflow publishes assets to the GitHub Release page

Workflow file: [.github/workflows/release-win.yml](.github/workflows/release-win.yml)

Public publish checklist: [docs/github-publish-checklist.md](docs/github-publish-checklist.md)

## License

This project is licensed under the MIT License.

See [LICENSE](LICENSE) and [COPYRIGHT.md](COPYRIGHT.md).
