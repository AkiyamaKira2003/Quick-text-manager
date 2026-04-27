# Kira LC & QuickText — AI Brain Code Documentation

> **Mục đích**: Tài liệu này mô tả chính xác toàn bộ bộ phận code trong Kira LC / QuickText để người khác đọc một phát biết cần phải làm gì khi thêm chức năng mới.

---

## 1. Tổng Quan Kiến Trúc

```
┌─────────────────────────────────────────────────────────────┐
│                    Kira LC (Client/Launcher)                │
│  WPF Bootstrapper (.NET 8) — Custom installer UI           │
│  KiraLC.exe → launches QuickText.exe                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ starts
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                QuickText Desktop App                        │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │
│  │ Electron │  │  Next.js  │  │ Python Backend Service    │ │
│  │  main.js │──│  Renderer │──│  (Flask + keyboard lib)  │ │
│  │ (Node.js)│  │ (React)   │  │  tool.py :5000           │ │
│  └──────────┘  └──────────┘  └──────────────────────────┘ │
│       │               │                   │                  │
│  System Tray     Overlay Window    Keyboard Input           │
│  Auto-update     (Always-on-top)  (Hangul 2-beolsi)        │
└─────────────────────────────────────────────────────────────┘
```

### Các Công Nghệ Chính


| Lớp                | Công nghệ                            | File                                                           |
| ------------------ | ------------------------------------ | -------------------------------------------------------------- |
| Launcher/Installer | WPF (.NET 8)                         | `installer/bootstrapper/*.cs`, `installer/bootstrapper/*.xaml` |
| Desktop Runtime    | Electron 35+                         | `electron/main.js`, `electron/preload*.js`                     |
| Frontend           | Next.js 15 + React 19 + TypeScript   | `app/`, `components/`                                          |
| Backend Input      | Python 3 + Flask + keyboard + pynput | `python/tool.py`                                               |
| Styling            | CSS + CSS Variables + shadcn/ui      | `components/ui/`, `app/globals.css`                            |
| i18n               | Custom `lib/i18n.ts` (VI/EN)         | `lib/i18n.ts`                                                  |
| Profiling          | React Profiler + custom NDJSON       | `lib/aibrain-telemetry.mjs`                                    |
| Build              | electron-builder (NSIS installer)    | `package.json`                                                 |
| Intelligence       | GitNexus (codex graph)               | `.claude/skills/gitnexus/`                                     |


---

## 2. Electron Main Process — `electron/main.js` (7200+ dòng)

### 2.1 Vai trò

- **Điểm khởi đầu duy nhất** của app trên desktop
- Tạo và quản lý **tất cả BrowserWindow** (main, overlay, settings, hotkey, tray-menu)
- Quản lý **Python service** lifecycle (spawn, healthcheck, restart)
- Đăng ký **global shortcut** qua Electron `globalShortcut`
- Giao tiếp IPC với renderer qua `ipcMain`
- System tray, auto-update, telemetry

### 2.2 Các biến quan trọng

```javascript
// Settings paths
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')
const TELEMETRY_PATH = path.join(app.getPath('userData'), 'telemetry.json')
const OVERLAY_IMAGE_HISTORY_PATH = path.join(app.getPath('userData'), 'overlay-image-history.v1.json')

// Python backend config
const DEFAULT_PYTHON_API_BASE_URL = 'http://127.0.0.1:5000'
const DEFAULT_PYTHON_SERVICE_EXE_NAME = 'QuickTextPython.exe'

// Input backend: native = Electron globalShortcut, python = Flask service
const INPUT_BACKEND_ENV = String(process.env.QT_INPUT_BACKEND || '').trim().toLowerCase()
// INPUT_BACKEND_NATIVE = 'native', INPUT_BACKEND_PYTHON = 'python'

// Hotkey defaults (phải khớp với python/tool.py và lib/defaults.ts)
const OVERLAY_TOGGLE_HOTKEY = 'Shift+F7'
const DEFAULT_OVERLAY_EDIT_HOTKEY = 'Shift+F6'
const DEFAULT_SEND_HOTKEY = 'Shift+F5'
const DEFAULT_MAIN_TOGGLE_HOTKEY = 'Shift+F8'
const DEFAULT_APP_TOGGLE_HOTKEY = 'Shift+F9'

// Startup phases (localized labels)
const STARTUP_SPLASH_LABELS = { vi: {...}, en: {...} }
```

### 2.3 Các hàm quan trọng

#### Quản lý Window


| Hàm                          | Mô tả                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| `createMainWindow()`         | Tạo main BrowserWindow (920×680 default, có splash screen)             |
| `createOverlayWindow()`      | Tạo overlay window (10000×10000, alwaysOnTop, transparent, frameless)  |
| `createSettingsWindow()`     | Tạo settings BrowserWindow                                             |
| `createHotkeyWindow()`       | Tạo dedicated hotkey config window                                     |
| `showWindowByKind(kind)`     | Hiện window theo loại: main, overlay, settings, hotkeys, overlay-image |
| `hideAllWindows()`           | Ẩn tất cả window trước khi quit                                        |
| `toggleOverlayVisibility()`  | Bật/tắt overlay qua IPC từ renderer                                    |
| `toggleOverlayInteraction()` | Bật/tắt interaction mode (mouse pass-through)                          |
| `fitOverlayToScreen()`       | Resize overlay để fit trong màn hình (gọi sau khi overlay page ready)  |


#### Python Service Lifecycle


| Hàm                            | Mô tả                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| `spawnPythonService()`         | Spawn `QuickTextPython.exe` hoặc chạy `python tool.py`. Retry nếu fail. |
| `checkPythonHealth()`          | GET `/health` → parse `runtime_state`                                   |
| `pythonConfigure(payload)`     | POST `/configure` → sync hotkey/text config                             |
| `pythonSend(text)`             | POST `/send` → gửi text ngay (không qua hotkey)                         |
| `getPythonInputEvents(after)`  | GET `/events?after=N` → poll wheel/action events                        |
| `ensurePythonServiceRunning()` | Boot Python, retry với cooldown                                         |
| `stopPythonService()`          | Kill Python process                                                     |


#### IPC Handlers (từ renderer gọi lên)


| Channel                          | Handler                           | Mô tả                                       |
| -------------------------------- | --------------------------------- | ------------------------------------------- |
| `get-settings`                   | `handleGetSettings`               | Load settings.json → normalize → return     |
| `save-settings`                  | `handleSaveSettings`              | Merge patch → write debounced → sync Python |
| `python-send`                    | `handlePythonSend`                | Proxy đến Python `/send`                    |
| `python-configure`               | `handlePythonConfigure`           | Proxy đến Python `/configure`               |
| `python-events`                  | `handlePythonEvents`              | Proxy đến Python `/events`                  |
| `lens-search-image`              | `handleLensSearch`                | Gọi Google Lens API                         |
| `set-window-mode`                | `handleSetWindowMode`             | Switch main ↔ overlay mode                  |
| `open-settings-window`           | `showWindowByKind('settings')`    | Mở settings                                 |
| `toggle-overlay-visibility`      | `toggleOverlayVisibility()`       | Toggle overlay                              |
| `set-overlay-mouse-pass-through` | `setOverlayClickThrough(enabled)` | Set `ignoreMouseEvents`                     |


#### Startup Sequence (thứ tự)

```
1. resolveAutoUpdater()       ← load electron-updater
2. createSplashWindow()       ← show splash with progress
3. loadSettings()             ← read settings.json
4. spawnPythonService()       ← boot Python backend
5. createMainWindow()         ← create main BrowserWindow
6. waitForMainWindowReady()   ← IPC: wait for renderer "main-renderer-ready"
7. createOverlayWindow()      ← overlay is deferred 260ms after main ready
8. registerGlobalShortcuts()  ← Electron globalShortcut
9. setupTray()                ← system tray icon + menu
10. applySettingsToPython()   ← sync current settings → Python
11. splashFadeOut()           ← hide splash
12. checkForUpdates()         ← auto-update check (deferred 2800ms)
```

### 2.4 Khi thêm chức năng mới — Electron main

**Đường đi của một feature mới từ UI đến action:**

```
Renderer (React) 
  → electronAPI.xxx() [preload bridge]
    → ipcRenderer.invoke('channel-name', payload) 
      → ipcMain.handle('channel-name') [main.js]
        → Thực hiện logic (spawn process, write file, call Python API)
          → window.webContents.send('event-name', data) [gửi về renderer]
```

**Ví dụ: Thêm một IPC channel mới**

```javascript
// 1. Trong main.js, thêm handler:
ipcMain.handle('my-feature-do-something', async (event, payload) => {
  // payload là data từ renderer
  const result = await doSomething(payload);
  return result; // return về renderer
});

// 2. Trong preload.js, thêm bridge:
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing
  myFeatureDoSomething: (payload) => ipcRenderer.invoke('my-feature-do-something', payload),
});

// 3. Trong types/index.ts, thêm type:
myFeatureDoSomething: (payload: MyPayload) => Promise<MyResult>

// 4. Trong renderer, gọi:
await window.electronAPI?.myFeatureDoSomething({ key: 'value' });
```

---

## 3. Python Backend — `python/tool.py` (1300 dòng)

### 3.1 Vai trò

- **Nhận keyboard input** ở mức hệ điều hành (dùng `keyboard` + `pynput` library)
- **Gửi text** đến focused window (IME-style: chuyển Hangul → 2-beolsi keystrokes)
- **Hotkey management**: đăng ký global hotkey qua `keyboard.add_hotkey()`
- **Wheel listener**: bắt scroll event để chuyển text trong overlay

### 3.2 Architecture

```
Flask App (port 5000)
  ├── /health              GET  → runtime_state
  ├── /configure           POST → update hotkey/text config
  ├── /send                POST → send text immediately
  └── /events              GET  → poll wheel/action events

Keyboard Handler (keyboard library)
  ├── Shift+F5  → send current text
  ├── Shift+F6  → toggle overlay interaction
  ├── Shift+F7  → toggle overlay visibility
  ├── Shift+F8  → toggle main window
  └── Shift+F9  → toggle app enabled/disabled

Mouse Listener (pynput library)
  └── Scroll + Shift → emit wheel event (/events endpoint)
```

### 3.3 Các hằng số quan trọng

```python
DEFAULT_SEND_HOTKEY = "shift+f5"
DEFAULT_OVERLAY_TOGGLE_HOTKEY = "shift+f7"
DEFAULT_MAIN_TOGGLE_HOTKEY = "shift+f8"
DEFAULT_OVERLAY_EDIT_HOTKEY = "shift+f6"
DEFAULT_APP_TOGGLE_HOTKEY = "shift+f9"
DEFAULT_DELAY_RANGE = (0.18, 0.42)          # random delay between sends
DEFAULT_KEYSTROKE_DELAY_RANGE = (0.035, 0.09)  # delay between keystrokes
MIN_SEND_INTERVAL_SECONDS = 0.7            # throttle between sends
HOTKEY_DEBOUNCE_MS = 90                   # debounce hotkey trigger
ACTION_HOTKEY_DEBOUNCE_MS = 280           # debounce action hotkey
APP_TOGGLE_DEBOUNCE_MS = 1200             # app toggle debounce
MAX_EVENTS = 400                           # wheel/action event buffer size
CONVERSION_CACHE_MAX_ITEMS = 2000           # Hangul→2beolsi cache
```

### 3.4 Hangul → 2-Beolsi Converter

Đây là phần **quan trọng nhất** của Python backend. Game Hàn (Lineage Classic) không nhận Unicode Hangul trực tiếp — chúng dùng **2-beolsi (2벌식) input method**.

```python
# Mỗi âm tiết Hangul = Choseong + Jungseong + Jongseong
# ㄱ = r, ㄴ = s, ㄷ = e, ㄹ = f, ㅁ = a, ㅂ = q, ㅅ = t, ㅇ = d, ㅈ = w, ㅊ = c, ㅋ = z, ㅌ = x, ㅍ = v, ㅎ = g
# Vowel: ㅏ = k, ㅑ = i, ㅓ = j, ㅛ = y, ㅜ = n, ㅠ = b, ㅡ = m, ㅣ = l
# Ví dụ: "안녕하세요" → "dkssudkptkfm"

# Thuật toán:
# 1. Parse từng ký tự Hangul (Unicode range 0xAC00-0xD7A3)
# 2. Tách Choseong (lead) = index // 588
# 3. Tách Jungseong (vowel) = (index % 588) // 28
# 4. Tách Jongseong (tail) = index % 28
# 5. Map qua JAMO_TO_2BEOLSIK
# 6. Gửi từng keystroke riêng lẻ
```

### 3.5 Threading & State

```python
events_lock        # Lock cho event queue
state_lock         # Lock cho runtime_state
hotkey_lock        # Lock cho hotkey registration
conversion_cache_lock  # Lock cho Hangul conversion cache

runtime_state = {
    "typing_available": True,         # keyboard library loaded?
    "wheel_listener_available": True, # pynput loaded?
    "listener_running": False,        # pynput listener active?
    "send_hotkey_registered": False,
    "app_toggle_registered": False,
    "overlay_toggle_registered": False,
    "main_toggle_registered": False,
    "overlay_edit_registered": False,
    "block_alt_f4_registered": False,
    "app_enabled": True,             # Master switch
    "last_error": "",
    "last_send_at": 0.0,
}

send_config = {
    "text": "",
    "send_hotkey": DEFAULT_SEND_HOTKEY,
    "app_enabled": True,
    "delay_range": (0.18, 0.42),
    "keystroke_delay_range": (0.035, 0.09),
    "press_enter": False,
}
```

### 3.6 Khi thêm chức năng mới — Python backend

**Muốn thêm một hotkey mới?**

```python
# 1. Thêm action ID constant
ACTION_MY_FEATURE = "my.feature.action"

# 2. Thêm default trong defaults
DEFAULT_MY_FEATURE_HOTKEY = "ctrl+shift+m"

# 3. Thêm trong send_config (để lưu user config)
send_config["my_feature_hotkey"] = DEFAULT_MY_FEATURE_HOTKEY

# 4. Thêm trong runtime_state
runtime_state["my_feature_registered"] = False
runtime_state["my_feature_hotkey"] = DEFAULT_MY_FEATURE_HOTKEY

# 5. Tạo callback
def trigger_my_feature():
    add_event("action", action=ACTION_MY_FEATURE)

# 6. Đăng ký trong configure() hoặc cuối file
register_action_hotkey(ACTION_MY_FEATURE, DEFAULT_MY_FEATURE_HOTKEY)

# 7. Thêm endpoint mới hoặc mở rộng /events để renderer biết
#    Sửa add_event() để include new event type nếu cần
```

**Muốn gửi text ngay từ Python?**

```python
# Dùng start_async_send() — chạy trong thread riêng
start_async_send(
    text="Hello",
    delay_range=(0.18, 0.42),
    keystroke_delay_range=(0.035, 0.09),
    press_enter=False
)
```

---

## 4. Next.js Renderer — Pages & Routing

### 4.1 Route Structure

```
app/
├── page.tsx                        → Redirect (/)

├── main/
│   └── page.tsx                    → Main window: TextManager + sidebar + hotkey chips

├── settings/
│   └── page.tsx                    → Settings panel (dark/light/palette/language)

├── hotkeys/
│   └── page.tsx                    → Dedicated hotkey configuration window

├── overlay/
│   └── page.tsx                    → Overlay HUD + tools panel

├── overlay-texts/
│   └── page.tsx                    → Overlay text overlay (không dùng?)

├── overlay-image/
│   └── page.tsx                    → Overlay image search + Google Lens

├── overlay-settings/
│   └── page.tsx                    → Overlay settings panel

├── tray-menu/
│   └── page.tsx                    → Tray popup menu (minimal)

└── api/
    ├── send/route.ts               → POST /api/send → proxy to Python /send
    ├── input-events/route.ts       → GET /api/input-events → proxy to Python /events
    ├── python-config/route.ts      → POST /api/python-config → proxy to Python /configure
    ├── quick-add-translate/route.ts → POST → Google Translate API (mymemory)
    ├── google-search/route.ts      → GET → Google Search
    ├── google-lens-search/route.ts → POST → Google Lens
    └── image-translate/route.ts    → POST → Image translate via Lens
```

### 4.2 Cách chuyển đổi giữa các window

Electron tạo **BrowserWindow mới** cho mỗi route. `app/page.tsx` redirect tùy theo `windowKind`:

```javascript
// Trong app/layout.tsx hoặc app/page.tsx:
const kind = await window.electronAPI?.getWindowKind()
// kind = 'main' | 'overlay' | 'settings' | 'hotkeys' | 'overlay-image' | 'overlay-settings'
// Redirect đến route tương ứng
```

---

## 5. Components Chính

### 5.1 TextManager (`components/TextManager.tsx`)

**Vai trò**: Quản lý danh sách text items — CRUD, search, sort, virtualization.

**Props**:

```typescript
type Props = {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => Promise<void>
  variant?: 'main' | 'overlay'  // 2 giao diện khác nhau
}
```

**State nội bộ**:

- `queryInput` / `queryDebounced` — search với debounce 120ms
- `isMultiSelectMode` — multi-select để send nhiều text
- Virtual list state — chỉ render items trong viewport (optimization cho 80+ items)

**Các chức năng**:


| Action           | Mô tả                                                           |
| ---------------- | --------------------------------------------------------------- |
| Thêm item        | PromptDialog → `updateSettings({ items: [...items, newItem] })` |
| Sửa item         | PromptDialog → update trong items array                         |
| Xóa item         | `updateSettings({ items: items.filter(i => i !== item) })`      |
| Send text        | Gọi `pythonConfigure({ text })` → user bấm hotkey để send       |
| Send immediately | Gọi `pythonSend({ text })` → gửi ngay không cần hotkey          |
| Sort             | Theo text, note, hoặc Korean hint                               |
| Filter           | Chỉ hiện items có note, hoặc mới nhất                           |
| Duplicate        | Copy item với text được thêm " (copy)"                          |


### 5.2 Overlay Panel (`app/overlay/page.tsx`)

**Vai trò**: Overlay HUD hiển thị text đang được chọn + tools panel (TextManager + ImageLens).

**Key behaviors**:

- **Always-on-top** window (10000×10000, transparent)
- **Smart click-through**: click vào vùng trống → pass through sang game
- **Interactive zones**: vùng có tool panel thì nhận click
- **Wheel navigation**: scroll → chuyển text (qua Python wheel event)
- **Morph transition**: khi overlay resize/reposition → smooth CSS transition

### 5.3 QuickText2ImageLensPanel (`components/QuickText2ImageLensPanel.tsx`)

**Vai trò**: Google Lens image search từ clipboard hoặc paste.

**Parse strategies** (thứ tự ưu tiên):

1. **HTTP mode**: Direct fetch `lens.google.com` với search params → parse HTML response
2. **Webview mode**: Load URL trong hidden webview → execute JavaScript → extract data
3. **Merged mode**: Kết hợp cả 2

**Features**:

- Auto-search on clipboard paste (opt-in)
- AI reply generation (gọi API bên ngoài)
- Google Translation (mymemory.net)
- Image history (localStorage)
- Block patterns: captcha, traffic challenge detection

### 5.4 HotkeyManager (`components/HotkeyManager.tsx`)

**Vai trò**: UI cho phép user đăng ký custom hotkey cho mỗi action.

**Cách hoạt động**:

1. User click vào input → bắt `keydown` event
2. `comboFromKeyboardEvent(event)` → normalize thành string (`Ctrl+Shift+M`)
3. Kiểm tra conflict với reserved combos (Alt+F4, Ctrl+W, etc.)
4. Gọi `updateSettings({ sendHotkey: 'Ctrl+Shift+M' })`
5. Main process sync xuống Python qua `/configure`

### 5.5 SettingsContent (`components/SettingsContent.tsx`)

**Vai trò**: Settings page cho tất cả config.

**Sections**:

- UI: dark/light mode, color palette (icon/jade/crimson/dark/light), language
- Hotkeys: tất cả 5 action hotkeys
- Overlay: visibility, opacity, show icon/counter
- Tools: panel visibility, auto-search, image history limits
- Advanced: block Alt+F4, input backend selection
- Updates: check/update UI
- Telemetry: send stats

---

## 6. Shared Libraries

### 6.1 `lib/hotkeys.ts` — Hotkey Logic

**Tất cả hotkey action định nghĩa ở đây:**

```typescript
export const HOTKEY_ACTIONS: HotkeyActionDefinition[] = [
  { id: 'app.toggle_enabled',    category: 'core',    defaultCombo: 'Shift+F9', ... },
  { id: 'overlay.toggle_visibility', category: 'overlay', defaultCombo: 'Shift+F7', ... },
  { id: 'main.toggle_visibility',    category: 'core',    defaultCombo: 'Shift+F8', ... },
  { id: 'overlay.toggle_interaction', category: 'overlay', defaultCombo: 'Shift+F6', ... },
  { id: 'text.send_current',        category: 'text',    defaultCombo: 'Shift+F5', ... },
]
```

**Key functions**:

- `normalizeCombo(value)` — chuẩn hóa `"ctrl+shift+f5"` → `"Ctrl+Shift+F5"`
- `comboFromKeyboardEvent(event)` — extract combo từ KeyboardEvent
- `findHotkeyConflict(candidate, bindings)` — kiểm tra trùng hotkey
- `registerHotkeyAction(action)` — **THÊM HOTKEY MỚI** → đăng ký action mới vào danh sách
- `getEffectiveHotkeyBindings(settings)` — lấy tất cả binding hiệu quả

### 6.2 `lib/defaults.ts` — Settings & Defaults

**Default settings** cho toàn bộ app. Khi cần thêm một settings mới:

```typescript
// 1. Thêm vào Settings interface (types/index.ts)
export interface Settings {
  // ... existing ...
  myNewSetting: boolean
}

// 2. Thêm vào defaultSettings (defaults.ts)
const defaultSettings: Settings = {
  // ... existing ...
  myNewSetting: false,
}

// 3. Thêm vào normalizeSettings() nếu cần migration
const myNewSetting = typeof raw.myNewSetting === 'boolean' 
  ? raw.myNewSetting 
  : defaultSettings.myNewSetting
```

### 6.3 `lib/i18n.ts` — Internationalization

**Không dùng i18n library**. Tự build với JSON:

```typescript
const MESSAGES = {
  vi: { 'main.hotkeyOverlayToggleLabel': 'Bật/tắt Overlay', ... },
  en: { 'main.hotkeyOverlayToggleLabel': 'Toggle Overlay', ... },
}

export function t(key: MessageKey): string {
  const lang = currentLanguage // from settings
  return MESSAGES[lang]?.[key] ?? key
}
```

**Thêm key mới**: Thêm vào `MessageKey` type và cả 2 ngôn ngữ.

### 6.4 `lib/overlay-morph.ts` — Smooth Overlay Transitions

Tính transform matrix để overlay di chuyển mượt khi thay đổi kích thước/vị trí.

### 6.5 `hooks/use-settings.ts` — Settings State Management

- Load settings từ Electron qua IPC
- Cache trong localStorage (web fallback)
- Debounce save (140ms)
- Distinguish critical runtime patches (hotkey, appEnabled) → save immediately

### 6.6 `lib/aibrain-telemetry.mjs` — Profiling & Telemetry

Ghi log React commit timing, renderer performance, và gửi lên Electron main để lưu vào file NDJSON.

---

## 7. API Proxies (Next.js → Python)

```
Renderer                  Next.js API              Python Backend
   │                          │                        │
   │ pythonConfigure(payload) │                        │
   │ ───────────────────────► │ POST /configure        │
   │                          │ ─────────────────────► │
   │                          │                        │
   │                          │ ◄───────────────────── │
   │ ◄─────────────────────── │ { ok: true, ... }     │
   │ { ok: true }            │                        │
```

**File**: `app/api/python-config/route.ts`

---

## 8. Installer / Bootstrapper (`installer/bootstrapper/`)

### 8.1 KiraLC WPF Bootstrapper

**Technology**: WPF (.NET 8) — C# + XAML

**Files**:

- `App.xaml` / `App.xaml.cs` — Application entry, navigation
- `MainWindow.xaml` / `MainWindow.xaml.cs` — Installer wizard UI
- `InstallerEngine.cs` — Extracts embedded NSIS engine + runs silent install

**Installer flow**:

1. User chạy `KiraLC-Setup-x.x.x.exe`
2. WPF UI hiện wizard (license, install path, progress)
3. Khi user click Install → `InstallerEngine.RunSilentInstallAsync()`
4. Engine extract `QuickTextSetupEngine.exe` (embedded resource) vào temp
5. Engine chạy NSIS silent: `QuickTextSetupEngine.exe /S /D=<path>`
6. NSIS copy QuickText.exe + Python service + resources
7. Create Start Menu shortcut, desktop shortcut
8. Register uninstaller

### 8.2 NSIS Installer

**File**: `installer/installer.nsh` (NSIS script snippet, thường nhúng trong electron-builder config)

**Đóng gói**:

- `QuickText.exe` (Electron app)
- `QuickTextPython.exe` (compiled Python service hoặc portable Python)
- `resources/` (assets, preload scripts)
- `locales/` (i18n files)

### 8.3 Asset Pipeline

```
installer/brand/
├── README.md              ← Slot definitions
├── allin.png              ← Full composite image
├── header.png             ← Installer header (installer.nsh reference)
├── sidebar.png             ← Left sidebar (164x314, cropped from allin)
├── welcome.png            ← Welcome panel artwork
└── (project-specific assets)

scripts/prepare-win-icon.cjs  ← Generate icons from allin.png
```

---

## 9. Data Flow — Send Text

```
User chọn item trong TextManager
        │
        ▼
pythonConfigure({ text: "안녕하세요" })
        │
        ▼
Next.js API: POST /api/python-config
        │
        ▼
Electron main: ipcMain.handle('python-configure')
        │
        ▼
Python: POST http://127.0.0.1:5000/configure
        │
        ├── Lưu text vào send_config["text"]
        └── Cache Warmup: resolve_2beolsik_sequence("안녕하세요")
                            → "dkssudkptkfm"
        │
        ▼
User bấm Shift+F5 (hoặc Shift+F9 enable rồi F5)
        │
        ▼
Python: trigger_configured_send()
        │
        ├── get_send_snapshot() → text + delays
        ├── resolve_2beolsik_sequence(text) → "dkssudkptkfm"
        └── start_async_send() → Thread:
              │
              ├── type_ime_keystrokes("dkssudkptkfm")
              │     ├── keyboard.press("d") + release
              │     ├── sleep(random 0.035-0.09s)
              │     ├── keyboard.press("k") + release
              │     ├── ...tiếp tục cho từng ký tự
              │     └── Kết quả: "안녕하세요" hiện trong game chat box
              └── sleep(random 0.18-0.42s) → enter
```

---

## 10. Checklist — Thêm Chức Năng Mới

### A. Thêm một **hotkey action** mới

1. `**lib/hotkeys.ts`**: Thêm vào `HOTKEY_ACTIONS` array
2. `**python/tool.py`**: Thêm action constant, default hotkey, register handler
3. `**lib/defaults.ts**`: Thêm default vào `defaultSettings`
4. `**types/index.ts**`: Thêm vào `KnownHotkeyActionId`
5. `**app/main/page.tsx**`: Thêm HotkeyChip nếu cần hiện trong main UI
6. `**electron/main.js**`: Thêm IPC handler nếu cần

### B. Thêm một **settings** mới

1. `**types/index.ts`**: Thêm field vào `Settings` interface
2. `**lib/defaults.ts`**: Thêm vào `defaultSettings` và `normalizeSettings()`
3. `**components/SettingsContent.tsx**`: Thêm UI control cho setting đó
4. `**electron/main.js**`: Sync xuống Python trong `/configure` payload nếu cần
5. `**python/tool.py**`: Thêm vào `send_config`/`runtime_state` nếu backend cần biết

### C. Thêm một **API endpoint** mới

1. Tạo `app/api/my-feature/route.ts` với `enforceApiAccess(request)` check
2. Trong `electron/main.js`: Thêm `ipcMain.handle('my-feature', ...)`
3. Trong `preload.js`: Expose `electronAPI.myFeature()`
4. Trong `types/index.ts`: Thêm type cho request/response
5. Trong renderer: Gọi qua `window.electronAPI.myFeature()`

### D. Thêm một **component UI** mới

1. Tạo file trong `components/` (React + TypeScript)
2. Import trong page tương ứng (`app/main/page.tsx`, `app/overlay/page.tsx`, etc.)
3. Nhận props: `settings`, `updateSettings` (từ `useSettings()`)
4. Dùng shadcn/ui components từ `components/ui/` nếu có

### E. Thêm một **Python backend feature** mới

1. Thêm Flask route trong `python/tool.py`
2. Thêm state vào `runtime_state`/`send_config` nếu cần
3. Thêm hotkey registration nếu cần global shortcut
4. Test: `python tool.py` rồi `curl http://127.0.0.1:5000/health`
5. Đảm bảo compiled `.exe` được build lại: `scripts/build-python-service.mjs`

### F. Thêm **i18n key** mới

1. `**lib/i18n.ts`**: Thêm key vào `MessageKey` type
2. Thêm vào `MESSAGES.vi` và `MESSAGES.en`
3. Dùng: `t('my.new.key')` trong component

### G. Sửa **overlay behavior**

1. `**app/overlay/page.tsx`**: Logic chính của overlay
2. `**electron/main.js`**: `createOverlayWindow()`, `toggleOverlayVisibility()`, `setOverlayClickThrough()`
3. `**lib/overlay-morph.ts**`: Smooth transition logic

---

## 11. Build & Release Pipeline

```
npm run build:win-icon    ← Generate icons from allin.png
npm run dev               ← Development: Next.js + Electron dev
npm run dist:win          ← Production build: electron-builder
      │
      ├── electron-builder → dist/win-unpacked/QuickText.exe
      │                         + resources/app.asar
      │                         + python/QuickTextPython.exe
      │
      ├── NSIS installer → dist/KiraLC-Setup-x.x.x.exe
      │
      └── auto-update manifests → dist/latest.yml
```

**GitNexus impact analysis** trước khi sửa code:

```bash
npx gitnexus analyze
npx gitnexus impact --target <symbol-name> --direction upstream
```

---

## 12. Key Files Quick Reference


| File                                        | Dòng  | Mô tả                                                               |
| ------------------------------------------- | ----- | ------------------------------------------------------------------- |
| `electron/main.js`                          | ~7200 | Electron main process — TẤT CẢ window management + Python lifecycle |
| `python/tool.py`                            | ~1300 | Flask backend — keyboard input + Hangul 2-beolsi                    |
| `lib/hotkeys.ts`                            | ~540  | Tất cả hotkey action definitions + conflict detection               |
| `lib/defaults.ts`                           | ~480  | Default settings + migration logic                                  |
| `types/index.ts`                            | ~435  | Tất cả TypeScript interfaces                                        |
| `components/TextManager.tsx`                | ~840  | Text item CRUD + virtual list                                       |
| `app/main/page.tsx`                         | ~550  | Main window UI                                                      |
| `app/overlay/page.tsx`                      | ~500  | Overlay HUD + tools                                                 |
| `hooks/use-settings.ts`                     | ~270  | Settings state management                                           |
| `installer/bootstrapper/MainWindow.xaml.cs` | ~350  | WPF installer UI                                                    |
| `installer/bootstrapper/InstallerEngine.cs` | ~80   | Silent install runner                                               |


---

*Generated by AI Brain — QuickText Codebase Analysis*
*Last updated: 2026-04-27*