# AI Brain Codex Scripts

>This folder holds Codex data scripts moved from `scripts/`.

## 📖 Documentation

| File | Mục đích |
|------|-----------|
| **[KIRA-LC-QUICKTEXT-DOCUMENTATION.md](KIRA-LC-QUICKTEXT-DOCUMENTATION.md)** | **Tài liệu đầy đủ** — mô tả toàn bộ bộ phận code, architecture, data flow, và checklist thêm chức năng. Đọc 1 phát biết cần làm gì khi thêm feature. |
| **[QUICKSTART.md](QUICKSTART.md)** | **Hướng dẫn nhanh** — 5 việc thường làm, cách dev, cách build cho dev mới. |
| **[file-z.md](file-z.md)** | **Index** — AI Brain script commands, Codex sessions, key code locations. |

## Commands

- `node Tools/AIBrain/read-codex-chats.mjs --list`
- `node Tools/AIBrain/read-codex-chats.mjs --session <id>`
- `node Tools/AIBrain/read-codex-chats.mjs --session <id> --export ./codex-export`
- `node Tools/AIBrain/inspect-codex-session.mjs --session <id> --lines 40`
- `node Tools/AIBrain/codex-session-analyzer.mjs --session <id> --summary`
- `node Tools/AIBrain/codex-context-loader.mjs --session <id> --output docs/codex-context.md`

Legacy paths in `scripts/` are wrappers that forward to these files.

## Key Code Locations

- **Electron main**: `electron/main.js` (~7200 lines) — window management, Python lifecycle, IPC, hotkey
- **Python backend**: `python/tool.py` (~1300 lines) — keyboard input, Hangul→2beolsi conversion
- **Hotkey definitions**: `lib/hotkeys.ts` — all hotkey action definitions
- **Settings defaults**: `lib/defaults.ts` — all default settings + migration
- **TypeScript types**: `types/index.ts` — all interfaces
- **Text Manager**: `components/TextManager.tsx` — text item CRUD + virtual list
- **Image Lens**: `components/QuickText2ImageLensPanel.tsx` — Google Lens image search
- **WPF Installer**: `installer/bootstrapper/` — Kira LC setup UI (C# .NET 8)
