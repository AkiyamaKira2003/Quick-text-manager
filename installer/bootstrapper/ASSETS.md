# Kira LC premium setup artwork

`Kira LC` is the installer/launcher shell. `Quick Text` is the module installed by that shell.

The current production source pack lives in `assets/kira-client/source`. Run:

```powershell
npm run assets:kira-client
```

This imports the root source images once, splits synchronized sheets, removes pure black backgrounds where needed, and syncs outputs to:

- `assets/kira-client/...`: canonical processed pack.
- `public/assets/kira-client/...`: web/client-ready mirror.
- `installer/bootstrapper/Assets/...`: WPF Kira LC setup/client assets.
- `installer/brand/...`: NSIS fallback artwork.

The legacy all-in source image is still supported. Run:

```powershell
npm run assets:installer:allin
```

This splits the labeled regions in `installer/brand/allin.png` into the older installer slots and syncs the NSIS fallback artwork in `installer/brand`.

Current required slots:

- `Assets/kira-lc-logo.png`: Kira LC launcher logo/masthead. Recommended `1600x900` or square art that still reads when cropped wide.
- `Assets/install-hero.png`: main blue/cyan poster for the Quick Text install screen. Recommended `1800x2400` or taller portrait.
- `Assets/brand-banner.png`: Quick Text module banner/logo. Recommended `1600x420`.
- `Assets/uninstall-hero.png`: red uninstall/remove poster. Recommended `1800x2400` or taller portrait.
- `Assets/kira-lc-wordmark.png`: transparent Kira LC wordmark, `1800x420`.
- `Assets/quick-text-module-card.png`: horizontal module card, `1600x900`.
- `Assets/progress-core.png`: glowing install reactor/progress orb, transparent PNG, `1024x1024`.
- `Assets/success-core.png`: completion reactor/orb, transparent PNG.
- `Assets/error-core.png`: error reactor/orb, transparent PNG.
- `Assets/progress-scene.png`: wide progress scene from the lower row of the core sheet.
- `Assets/success-scene.png`: wide success scene from the lower row of the core sheet.
- `Assets/error-scene.png`: wide error scene from the lower row of the core sheet.
- `Assets/success-hero.png`: completion art, `1800x2400`.
- `Assets/error-hero.png`: failure/repair art, `1800x2400`.
- `Assets/noise-overlay.png`: subtle transparent grain layer, `1920x1080`.
- `Assets/frame-overlay.png`: transparent sci-fi frame/HUD overlay, `1920x1080`.
- `Assets/header-strip.png`: transparent horizontal HUD strip.
- `Assets/header.png`: red cinematic header strip used in the Kira LC client and NSIS header fallback.
- `Assets/header-glow.png`: transparent red header glow for overlay use.
- `Assets/launch-button-bg.png`: transparent gold LAUNCH button base.
- `Assets/quicktext-hero.png`: full Kira LC client background, `1920x1080`.

Art direction:

- Kira LC should feel like the premium launcher brand.
- Quick Text should read like the installed module/app inside Kira LC.
- Avoid tiny text inside images. UI text is rendered by WPF so it stays sharp.
- Keep the subject centered. The setup window crops hero images to fit.
- Generate synchronized states as sheets so install, success, and error assets share silhouette and lighting.
- Prefer black-to-alpha processing for HUD/core/button assets instead of manual background removal.
- The asset script uses soft alpha feathering for black-background images. Do not force-transparent sword/hero/noise images unless their source is isolated on pure black; those are intentionally kept as full artwork to avoid dirty edges.
