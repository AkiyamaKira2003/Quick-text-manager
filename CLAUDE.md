<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Quick-text-manager** (5060 symbols, 8626 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Quick-text-manager/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Quick-text-manager/clusters` | All functional areas |
| `gitnexus://repo/Quick-text-manager/processes` | All execution flows |
| `gitnexus://repo/Quick-text-manager/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- kira-lc-docs:start -->
# Kira LC & QuickText — Codebase Documentation

> Read this BEFORE adding new features. One read and you'll know exactly what to do.

## 📖 Documentation Index

| File | Mục đích |
|------|-----------|
| **[Tools/AIBrain/KIRA-LC-QUICKTEXT-DOCUMENTATION.md](Tools/AIBrain/KIRA-LC-QUICKTEXT-DOCUMENTATION.md)** | **Tài liệu ĐẦY ĐỦ** — mô tả toàn bộ bộ phận code, kiến trúc, data flow, và checklist thêm chức năng |
| **[Tools/AIBrain/QUICKSTART.md](Tools/AIBrain/QUICKSTART.md)** | **Hướng dẫn NHANH** — 5 việc thường làm, cách dev, cách build |
| **[Tools/AIBrain/file-z.md](Tools/AIBrain/file-z.md)** | **Index** — AI Brain script commands, Codex sessions, key files |

## 🏗️ Architecture Overview

```
Kira LC (WPF .NET 8 bootstrapper)
  └─► QuickText.exe (Electron + Next.js)
        ├─► Main Window (TextManager + Settings)
        ├─► Overlay Window (always-on-top HUD)
        ├─► Python Backend (keyboard input + Hangul 2-beolsi)
        └─► System Tray + Auto-update
```

## 🔑 Key Files

| File | Dòng | Vai trò |
|------|------|---------|
| `electron/main.js` | ~7200 | Electron main: window management, Python lifecycle, IPC, hotkey |
| `python/tool.py` | ~1300 | Flask backend: keyboard input, Hangul→2beolsi, hotkey |
| `lib/hotkeys.ts` | ~540 | Tất cả hotkey action definitions |
| `lib/defaults.ts` | ~480 | Default settings + migration |
| `types/index.ts` | ~435 | Tất cả TypeScript interfaces |
| `components/TextManager.tsx` | ~840 | Text item CRUD + virtual list |
| `components/QuickText2ImageLensPanel.tsx` | ~560 | Google Lens image search |
| `hooks/use-settings.ts` | ~270 | Settings state management |
| `installer/bootstrapper/` | — | WPF Kira LC setup (C# .NET 8) |

## 🚀 5 Việc Thường Làm

### 1. Thêm hotkey action mới
- `lib/hotkeys.ts` → thêm vào `HOTKEY_ACTIONS`
- `python/tool.py` → thêm action constant + register
- `types/index.ts` → thêm vào `KnownHotkeyActionId`

### 2. Thêm settings mới
- `types/index.ts` → thêm field vào `Settings` interface
- `lib/defaults.ts` → thêm vào `defaultSettings` + `normalizeSettings()`
- `components/SettingsContent.tsx` → thêm UI control

### 3. Thêm API endpoint mới
- Tạo `app/api/my-feature/route.ts` với `enforceApiAccess()`
- Thêm IPC handler trong `electron/main.js`
- Expose qua `preload.js` → `window.electronAPI.myFeature()`

### 4. Thêm UI component
- Tạo trong `components/`
- Props: `settings`, `updateSettings` từ `useSettings()`

### 5. Thêm i18n key
- `lib/i18n.ts` → thêm vào `MessageKey` + `MESSAGES.vi/en`

Full details: [KIRA-LC-QUICKTEXT-DOCUMENTATION.md](Tools/AIBrain/KIRA-LC-QUICKTEXT-DOCUMENTATION.md)

<!-- kira-lc-docs:end -->
