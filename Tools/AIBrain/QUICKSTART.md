# QuickText — Developer Quick-Start Guide

> **Ai đọc file này**: Dev muốn contribute hoặc thêm feature vào QuickText.
> **Điều kiện**: Biết TypeScript, React, Node.js, Python cơ bản.

---

## 1 Phút Hiểu Toàn Bộ

QuickText = **Electron shell** + **Next.js UI** + **Python backend**.

```
Bạn chơi game Hàn (Lineage Classic)
        │
        ▼
Mở QuickText → bấm Shift+F5 → gửi text tiếng Hàn vào chat game
        │
        ├── Electron main (electron/main.js) quản lý window + hotkey
        ├── Next.js UI (app/) cho settings, text list
        └── Python backend (python/tool.py) chuyển Hangul → 2-beolsi keystroke
```

**Công nghệ**: Electron 35, Next.js 15, React 19, Python 3, TypeScript, WPF (.NET 8 cho installer)

---

## Cách Chạy Dev

```bash
# Terminal 1: Start Electron + Next.js
npm run dev

# Terminal 2 (nếu dùng Python backend thay vì native):
python python/tool.py
```

---

## Cấu Trúc File Quan Trọng

```
electron/main.js          ← Electron main process (7200 dòng)
                            Tạo window, quản lý Python, IPC, hotkey

python/tool.py           ← Python Flask backend (1300 dòng)
                            Keyboard input, Hangul→2beolsi, hotkey

app/main/page.tsx        ← Main window UI
app/overlay/page.tsx     ← Overlay HUD (always-on-top)

components/
  TextManager.tsx        ← Danh sách text items (CRUD, search, virtual list)
  QuickText2ImageLensPanel.tsx ← Google Lens image search
  SettingsContent.tsx    ← Settings page

lib/
  hotkeys.ts             ← Hotkey action definitions (ThÊM HOTKEY MỚI Ở ĐÂY)
  defaults.ts            ← Default settings (ThÊM SETTINGS MỚI Ở ĐÂY)
  i18n.ts                ← VI/EN translations

types/index.ts           ← Tất cả TypeScript interfaces

hooks/use-settings.ts    ← Settings state management

installer/bootstrapper/  ← WPF Kira LC installer (C#)
```

---

## 5 Việc Thường Làm

### 1. Thêm một hotkey action mới

```typescript
// lib/hotkeys.ts — thêm vào HOTKEY_ACTIONS:
{
  id: 'my.new.action',
  category: 'core',       // 'core' | 'overlay' | 'text'
  context: 'global',     // 'global' | 'screen' | 'modal' | 'editor'
  defaultCombo: 'Ctrl+M',
  settingKey: 'myNewActionHotkey',
  labelKey: 'hk.actionMyNew',
  descriptionKey: 'hk.descMyNew',
  priority: 60,
}
```

Sau đó thêm vào:
- `types/index.ts` → `KnownHotkeyActionId`
- `lib/defaults.ts` → `defaultSettings.myNewActionHotkey`
- `python/tool.py` → action constant + register handler

### 2. Thêm một settings mới

```typescript
// types/index.ts → Settings interface:
myNewSetting: boolean

// lib/defaults.ts:
myNewSetting: false,

// Trong normalizeSettings():
myNewSetting: typeof raw.myNewSetting === 'boolean' ? raw.myNewSetting : false,
```

### 3. Thêm API endpoint mới

```typescript
// app/api/my-feature/route.ts
import { NextResponse } from 'next/server'
import { enforceApiAccess } from '@/lib/api-access'

export async function POST(request: Request) {
  const accessError = enforceApiAccess(request)
  if (accessError) return accessError
  // ... logic
  return NextResponse.json({ ok: true, data: result })
}
```

Sau đó thêm IPC handler trong `electron/main.js`.

### 4. Thêm UI component mới

```tsx
// components/MyNewComponent.tsx
'use client'
import { useSettings } from '@/hooks/use-settings'
import { t } from '@/lib/i18n'

export default function MyNewComponent() {
  const { settings, updateSettings } = useSettings()
  return <div>...</div>
}
```

### 5. Thêm i18n key

```typescript
// lib/i18n.ts — thêm vào MessageKey type + MESSAGES:
MESSAGES.vi['my.key'] = 'Nội dung tiếng Việt'
MESSAGES.en['my.key'] = 'English content'

// Dùng trong component:
{t('my.key')}
```

---

## Data Flow — Send Text

```
User chọn item → pythonConfigure({ text }) → /configure → Python lưu
User bấm Shift+F5 → trigger_configured_send() → start_async_send()
    → resolve_2beolsik_sequence("안녕하세요") → "dkssudkptkfm"
    → type_ime_keystrokes("dkssudkptkfm")
        → keyboard.press("d"), release, sleep, press("k"), ...
        → Kết quả: "안녕하세요" hiện trong game chat
```

---

## Kiểm Tra GitNexus Trước Khi Sửa

```bash
npx gitnexus analyze                    # Cập nhật index
npx gitnexus impact --target addItem    # Xem ảnh hưởng
npx gitnexus query "how send text"      # Tìm execution flow
```

---

## Build Installer

```bash
npm run dist:win         # Build everything → KiraLC-Setup-x.x.x.exe
```

Output:
- `dist/KiraLC-Setup-x.x.x.exe` — NSIS installer
- `dist/win-unpacked/` — Portable version

---

## Đọc Thêm

- `Tools/AIBrain/KIRA-LC-QUICKTEXT-DOCUMENTATION.md` — Tài liệu đầy đủ (phù hợp cho người muốn hiểu sâu)
- `Tools/AIBrain/README.md` — Cách dùng AI Brain scripts
- `.claude/skills/gitnexus/` — GitNexus tools để trace code
