# Kira LC premium setup artwork

`Kira LC` is the installer/launcher shell. `Quick Text` is the module installed by that shell.

The canonical source image is `allin.png` at the repository root. Run:

```powershell
npm run assets:installer:allin
```

This splits the labeled regions in `allin.png` into the files below and syncs the NSIS fallback artwork in `installer/brand`.

Current required slots:

- `Assets/kira-lc-logo.png`: Kira LC launcher logo/masthead. Recommended `1600x900` or square art that still reads when cropped wide.
- `Assets/install-hero.png`: main blue/cyan poster for the Quick Text install screen. Recommended `1800x2400` or taller portrait.
- `Assets/brand-banner.png`: Quick Text module banner/logo. Recommended `1600x420`.
- `Assets/uninstall-hero.png`: red uninstall/remove poster. Recommended `1800x2400` or taller portrait.
- `Assets/kira-lc-wordmark.png`: transparent Kira LC wordmark, `1800x420`.
- `Assets/quick-text-module-card.png`: horizontal module card, `1600x900`.
- `Assets/progress-core.png`: glowing install reactor/progress orb, transparent PNG, `1024x1024`.
- `Assets/success-hero.png`: completion art, `1800x2400`.
- `Assets/error-hero.png`: failure/repair art, `1800x2400`.
- `Assets/noise-overlay.png`: subtle transparent grain layer, `1920x1080`.
- `Assets/frame-overlay.png`: transparent sci-fi frame/HUD overlay, `1920x1080`.

Art direction:

- Kira LC should feel like the premium launcher brand.
- Quick Text should read like the installed module/app inside Kira LC.
- Avoid tiny text inside images. UI text is rendered by WPF so it stays sharp.
- Keep the subject centered. The setup window crops hero images to fit.
