# QuickText Auto Update

## Current implementation

- Updater runtime uses `electron-updater` in `electron/main.js`.
- Updater is initialized only when `app.isPackaged === true`.
- Renderer can:
  - read update state (`update:get-state`)
  - trigger check (`update:check`)
  - install downloaded update (`update:install`)
- Settings window contains a live update panel with:
  - status
  - download progress
  - `Check for updates`
  - `Install and restart`

## Feed source

Two supported modes:

1. `QT_UPDATE_FEED_URL` (or `ELECTRON_UPDATE_URL`) at runtime
   - App sets a generic provider feed URL dynamically.
2. Electron Builder publish metadata (recommended for release pipeline)
   - Use `latest.yml` + artifacts published by CI/release.

## Notes

- Auto-update in dev mode is intentionally disabled.
- If `electron-updater` is missing, UI will show unsupported/update error state instead of crashing.
- Download is automatic after update is found; install is user-triggered from Settings.
