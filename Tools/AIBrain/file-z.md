# File Z — AI Brain Index

Placeholder file requested by user.
Use this as a marker/config slot for future AIBrain custom logic.

## AI Brain Documentation

| File | Mục đích |
|------|-----------|
| `KIRA-LC-QUICKTEXT-DOCUMENTATION.md` | Tài liệu đầy đủ, chi tiết. Đọc 1 phát hiểu toàn bộ codebase Kira LC + QuickText. |
| `QUICKSTART.md` | Hướng dẫn nhanh cho dev mới. 5 việc thường làm + cách chạy dev. |

## AI Brain Scripts

```bash
node Tools/AIBrain/read-codex-chats.mjs --list                    # Liệt kê sessions
node Tools/AIBrain/read-codex-chats.mjs --session <id>            # Đọc 1 session
node Tools/AIBrain/read-codex-chats.mjs --session <id> --export ./out  # Export session
node Tools/AIBrain/inspect-codex-session.mjs --session <id> --lines 40  # Inspect
node Tools/AIBrain/codex-session-analyzer.mjs --session <id> --summary  # Analyze
node Tools/AIBrain/codex-context-loader.mjs --session <id> --output docs/out.md  # Build context
```

## Codex Sessions Index (selected)

| Session | Tên | Mô tả |
|---------|-----|--------|
| 019db80f | Kiểm tra QuickText và đẩy v2.0.0 | Main development session — QuickText v2 |
| 019dcd9f | Reverse engineer Cursor cracker | — |
| 019dc7ed | Chuyển script Codex sang AI Brain | Chuyển tools sang AI Brain |
| 019d63ce | Xây dựng QuickText Pro | — |
| 019d1f5e | Refactor giao diện app và bảo vệ mã | — |
| 019ce2c8 | Fix hiển thị icon và tên app desktop | — |
| 019cdc88 | Cập nhật theme màu chủ đạo | — |

## Key Code Locations

- **Electron main**: `electron/main.js` (7200+ dòng)
- **Python backend**: `python/tool.py` (1300+ dòng)
- **Hotkey definitions**: `lib/hotkeys.ts`
- **Settings defaults**: `lib/defaults.ts`
- **TypeScript types**: `types/index.ts`
- **Text Manager**: `components/TextManager.tsx`
- **Image Lens**: `components/QuickText2ImageLensPanel.tsx`
- **WPF Installer**: `installer/bootstrapper/`
