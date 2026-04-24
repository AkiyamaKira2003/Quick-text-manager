# Quick Text installer artwork slots

Drop custom artwork in this folder before running `npm run build:win-icon`, `npm run dist:folder`, or `npm run dist:win`.

For the full Kira LC production pack, place/update source sheets in `assets/kira-client/source` and run:

```powershell
npm run assets:kira-client
```

That script generates the clean installer artwork here and keeps the WPF bootstrapper assets in sync.

If you are using the labeled all-in-one source image, place it here as `installer/brand/allin.png` and run:

```powershell
npm run assets:installer:allin
```

That command cuts the labeled regions into the Kira LC bootstrapper assets and refreshes this folder's NSIS fallback images.

Supported files:

- `sidebar.png`, `sidebar.jpg`, `sidebar.jpeg`, or `sidebar.bmp`: main left installer poster art.
- `header.png`, `header.jpg`, `header.jpeg`, or `header.bmp`: top header art.
- `uninstaller-sidebar.png`, `uninstaller-sidebar.jpg`, `uninstaller-sidebar.jpeg`, or `uninstaller-sidebar.bmp`: optional uninstaller poster art.

Sizing:

- Source images can be larger than the installer slots.
- The build script center-crops the sidebar into `164x314`.
- The build script center-crops the header into `150x57`.
- Keep key characters or logos near the center so they survive the crop.

Design notes:

- The script overlays the Quick Text wordmark, neon frame, glow, and HUD lines after fitting your image.
- Use high-contrast artwork without tiny text. Small text will not survive the NSIS bitmap size.
- If this folder has no images, the build falls back to the generated neon Quick Text artwork.
- For state images, use synchronized sheets and let `npm run assets:kira-client` split them. This keeps install/uninstall/success/error transitions consistent.
