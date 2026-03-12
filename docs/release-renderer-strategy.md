# Renderer Release Strategy

## Decision

- Do **not** ship with `next dev`.
- Keep production renderer in Node runtime mode (`output: 'standalone'`).
- Do **not** switch to `output: 'export'` at this time.

## Why not `output: 'export'` now

Current project still includes App Router route handlers under `app/api/*`:

- `app/api/send/route.ts`
- `app/api/python-config/route.ts`
- `app/api/input-events/route.ts`

These are part of the current fallback bridge flow and are not aligned with pure static export packaging.

## Runtime split

- Dev: Electron targets local Next dev server.
- Packaged: `app.isPackaged` path boots standalone Next server bundle and never uses dev server.

## Required release path

1. `next build`
2. materialize standalone runtime (`scripts/prepare-standalone.cjs`)
3. package via `electron-builder` (`dist:folder` or `dist:win`)
4. measure startup on packaged binary, not dev logs

## Notes

- If we later remove `app/api/*` and any server-only flow, we can re-evaluate static export.
- Until then, standalone runtime is the safest production choice.
