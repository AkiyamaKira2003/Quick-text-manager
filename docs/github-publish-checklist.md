# GitHub Public Publish Checklist

## 1. Push source code

```powershell
git add .
git commit -m "chore: prepare public release with launcher update flow"
git push origin main
```

## 2. Set repository to public

GitHub web:

1. Open repository `Settings`
2. Go to `General` -> `Danger Zone`
3. Click `Change repository visibility`
4. Choose `Public`

## 3. Create first release tag

```powershell
git tag v0.1.0
git push origin v0.1.0
```

This triggers workflow:

- `.github/workflows/release-win.yml`

## 4. Configure launcher manifest URL

Default launcher already uses:

- `https://github.com/AkiyamaKira2003/Quick-text-manager/releases/latest/download/latest.json`

Optional override:

- `launcher/launcher.config.json`

```json
{
  "manifestUrl": "https://raw.githubusercontent.com/AkiyamaKira2003/Quick-text-manager/main/latest.json"
}
```

If you prefer branch-based manifest, host `latest.json` at:

- `https://raw.githubusercontent.com/AkiyamaKira2003/Quick-text-manager/main/latest.json`
