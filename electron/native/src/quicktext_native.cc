#include <napi.h>

#include <windows.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cwctype>
#include <deque>
#include <mutex>
#include <optional>
#include <random>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;

constexpr UINT WM_QT_REFRESH_HOTKEYS = WM_APP + 1;
constexpr UINT WM_QT_STOP_LOOP = WM_APP + 2;

constexpr int HOTKEY_ID_SEND = 1001;
constexpr int HOTKEY_ID_APP_TOGGLE = 1002;
constexpr int HOTKEY_ID_OVERLAY_TOGGLE = 1003;
constexpr int HOTKEY_ID_MAIN_TOGGLE = 1004;
constexpr int HOTKEY_ID_OVERLAY_EDIT = 1005;

constexpr int DEFAULT_SEND_DEBOUNCE_MS = 90;
constexpr int DEFAULT_ACTION_DEBOUNCE_MS = 280;
constexpr int DEFAULT_APP_TOGGLE_DEBOUNCE_MS = 1200;
constexpr int DEFAULT_CAPTURE_PROBE_DEBOUNCE_MS = 220;

struct InputEventRecord {
  int64_t id = 0;
  std::string type;
  int delta = 0;
  std::string action;
};

struct HotkeyBinding {
  UINT modifiers = 0;
  UINT vk = 0;
};

struct RuntimeConfig {
  std::string text;
  std::optional<std::string> sendHotkey;
  std::optional<std::string> appToggleHotkey;
  std::optional<std::string> overlayToggleHotkey;
  std::optional<std::string> mainToggleHotkey;
  std::optional<std::string> overlayEditHotkey;
  bool appEnabled = true;
  bool blockAltF4 = false;
  bool pressEnter = false;
  double delayMinSeconds = 0.02;
  double delayMaxSeconds = 0.05;
  int sendDebounceMs = DEFAULT_SEND_DEBOUNCE_MS;
};

struct RuntimeState {
  std::mutex configMutex;
  std::mutex eventsMutex;
  RuntimeConfig config;
  std::deque<InputEventRecord> events;
  int64_t lastEventId = 0;

  std::thread loopThread;
  std::atomic<bool> running{false};
  std::atomic<bool> initialized{false};
  DWORD loopThreadId = 0;
  HHOOK mouseHook = nullptr;
  HHOOK keyboardHook = nullptr;

  std::mutex actionMutex;
  Clock::time_point lastSendAt = Clock::now();
  Clock::time_point lastAppToggleAt = Clock::now();
  Clock::time_point lastOverlayToggleAt = Clock::now();
  Clock::time_point lastMainToggleAt = Clock::now();
  Clock::time_point lastOverlayEditAt = Clock::now();
  Clock::time_point lastCaptureProbeAt = Clock::now();

  std::mutex registrationMutex;
  std::unordered_map<int, std::optional<std::string>> registeredCombos;
};

RuntimeState g_state;

std::string ToLower(const std::string& input) {
  std::string result = input;
  std::transform(result.begin(), result.end(), result.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  return result;
}

std::string Trim(const std::string& input) {
  const auto begin = input.find_first_not_of(" \t\n\r");
  if (begin == std::string::npos) return "";
  const auto end = input.find_last_not_of(" \t\n\r");
  return input.substr(begin, end - begin + 1);
}

std::vector<std::string> SplitHotkey(const std::string& raw) {
  std::vector<std::string> parts;
  std::string token;
  for (char ch : raw) {
    if (ch == '+') {
      const auto trimmed = Trim(token);
      if (!trimmed.empty()) {
        parts.push_back(ToLower(trimmed));
      }
      token.clear();
      continue;
    }
    token.push_back(ch);
  }
  const auto last = Trim(token);
  if (!last.empty()) {
    parts.push_back(ToLower(last));
  }
  return parts;
}

std::optional<UINT> ParseVirtualKey(const std::string& token) {
  if (token.size() == 1) {
    const char ch = token[0];
    if (ch >= 'a' && ch <= 'z') return static_cast<UINT>(std::toupper(ch));
    if (ch >= '0' && ch <= '9') return static_cast<UINT>(ch);
    if (ch == '`') return VK_OEM_3;
    if (ch == '-') return VK_OEM_MINUS;
    if (ch == '=') return VK_OEM_PLUS;
    if (ch == '[') return VK_OEM_4;
    if (ch == ']') return VK_OEM_6;
    if (ch == '\\') return VK_OEM_5;
    if (ch == ';') return VK_OEM_1;
    if (ch == '\'') return VK_OEM_7;
    if (ch == ',') return VK_OEM_COMMA;
    if (ch == '.') return VK_OEM_PERIOD;
    if (ch == '/') return VK_OEM_2;
  }

  if (token.rfind("f", 0) == 0 && token.size() <= 3) {
    int value = 0;
    try {
      value = std::stoi(token.substr(1));
    } catch (...) {
      value = 0;
    }
    if (value >= 1 && value <= 24) {
      return static_cast<UINT>(VK_F1 + (value - 1));
    }
  }

  static const std::unordered_map<std::string, UINT> keyMap = {
      {"tab", VK_TAB},
      {"enter", VK_RETURN},
      {"return", VK_RETURN},
      {"space", VK_SPACE},
      {"spacebar", VK_SPACE},
      {"esc", VK_ESCAPE},
      {"escape", VK_ESCAPE},
      {"backspace", VK_BACK},
      {"delete", VK_DELETE},
      {"del", VK_DELETE},
      {"insert", VK_INSERT},
      {"ins", VK_INSERT},
      {"home", VK_HOME},
      {"end", VK_END},
      {"pageup", VK_PRIOR},
      {"pagedown", VK_NEXT},
      {"arrowup", VK_UP},
      {"up", VK_UP},
      {"arrowdown", VK_DOWN},
      {"down", VK_DOWN},
      {"arrowleft", VK_LEFT},
      {"left", VK_LEFT},
      {"arrowright", VK_RIGHT},
      {"right", VK_RIGHT},
  };

  const auto found = keyMap.find(token);
  if (found != keyMap.end()) return found->second;

  return std::nullopt;
}

std::optional<HotkeyBinding> ParseHotkeyBinding(const std::optional<std::string>& rawCombo) {
  if (!rawCombo.has_value()) {
    return std::nullopt;
  }

  const auto normalized = Trim(*rawCombo);
  if (normalized.empty()) {
    return std::nullopt;
  }

  UINT modifiers = MOD_NOREPEAT;
  std::optional<UINT> key;
  const auto parts = SplitHotkey(normalized);
  if (parts.empty()) {
    return std::nullopt;
  }

  for (const auto& part : parts) {
    if (part == "ctrl" || part == "control" || part == "cmdorctrl") {
      modifiers |= MOD_CONTROL;
      continue;
    }
    if (part == "shift") {
      modifiers |= MOD_SHIFT;
      continue;
    }
    if (part == "alt" || part == "option") {
      modifiers |= MOD_ALT;
      continue;
    }
    if (part == "meta" || part == "win" || part == "windows" || part == "super" || part == "cmd" || part == "command") {
      modifiers |= MOD_WIN;
      continue;
    }

    if (key.has_value()) {
      return std::nullopt;
    }
    key = ParseVirtualKey(part);
    if (!key.has_value()) {
      return std::nullopt;
    }
  }

  if (!key.has_value()) {
    return std::nullopt;
  }

  return HotkeyBinding{modifiers, *key};
}

void PushEvent(const InputEventRecord& eventRecord) {
  std::lock_guard<std::mutex> lock(g_state.eventsMutex);
  g_state.events.push_back(eventRecord);
  if (g_state.events.size() > 500) {
    g_state.events.pop_front();
  }
  g_state.lastEventId = std::max(g_state.lastEventId, eventRecord.id);
}

int64_t NextEventId() {
  std::lock_guard<std::mutex> lock(g_state.eventsMutex);
  g_state.lastEventId += 1;
  return g_state.lastEventId;
}

bool IsDebounced(Clock::time_point& checkpoint, int thresholdMs) {
  const auto now = Clock::now();
  const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - checkpoint).count();
  if (elapsed < thresholdMs) {
    return true;
  }
  checkpoint = now;
  return false;
}

void AppendAsciiToWide(std::wstring& target, const std::string& ascii) {
  for (char ch : ascii) {
    target.push_back(static_cast<wchar_t>(static_cast<unsigned char>(ch)));
  }
}

void SleepRandomDelay(double minSeconds, double maxSeconds) {
  const double safeMin = std::max(0.0, minSeconds);
  const double safeMax = std::max(safeMin, maxSeconds);
  if (safeMax <= 0.0) return;

  static thread_local std::mt19937 rng(std::random_device{}());
  std::uniform_real_distribution<double> dist(safeMin, safeMax);
  const auto delayMs = static_cast<DWORD>(std::lround(std::max(0.0, dist(rng) * 1000.0)));
  if (delayMs > 0) {
    Sleep(delayMs);
  }
}

void PushVirtualKeyEvent(std::vector<INPUT>& events, WORD vk, DWORD flags = 0) {
  INPUT input{};
  input.type = INPUT_KEYBOARD;
  input.ki.wVk = vk;
  input.ki.dwFlags = flags;
  events.push_back(input);
}

void SendVirtualKeyStroke(WORD vk, bool shift, bool ctrl, bool alt) {
  std::vector<INPUT> events;
  events.reserve(12);

  if (shift) PushVirtualKeyEvent(events, VK_SHIFT);
  if (ctrl) PushVirtualKeyEvent(events, VK_CONTROL);
  if (alt) PushVirtualKeyEvent(events, VK_MENU);

  PushVirtualKeyEvent(events, vk);
  PushVirtualKeyEvent(events, vk, KEYEVENTF_KEYUP);

  if (alt) PushVirtualKeyEvent(events, VK_MENU, KEYEVENTF_KEYUP);
  if (ctrl) PushVirtualKeyEvent(events, VK_CONTROL, KEYEVENTF_KEYUP);
  if (shift) PushVirtualKeyEvent(events, VK_SHIFT, KEYEVENTF_KEYUP);

  if (!events.empty()) {
    SendInput(static_cast<UINT>(events.size()), events.data(), sizeof(INPUT));
  }
}

void SendUnicodeToken(wchar_t token) {
  std::vector<INPUT> events;
  events.reserve(2);

  INPUT down{};
  down.type = INPUT_KEYBOARD;
  down.ki.wScan = static_cast<WORD>(token);
  down.ki.dwFlags = KEYEVENTF_UNICODE;
  events.push_back(down);

  INPUT up = down;
  up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
  events.push_back(up);

  SendInput(static_cast<UINT>(events.size()), events.data(), sizeof(INPUT));
}

bool TryMapPrintableTokenToVirtualKey(wchar_t token, WORD* vkOut, bool* shiftOut, bool* ctrlOut, bool* altOut) {
  if (!vkOut || !shiftOut || !ctrlOut || !altOut) return false;

  *vkOut = 0;
  *shiftOut = false;
  *ctrlOut = false;
  *altOut = false;

  if (token >= L'a' && token <= L'z') {
    *vkOut = static_cast<WORD>(::towupper(token));
    return true;
  }
  if (token >= L'A' && token <= L'Z') {
    *vkOut = static_cast<WORD>(token);
    *shiftOut = true;
    return true;
  }
  if (token >= L'0' && token <= L'9') {
    *vkOut = static_cast<WORD>(token);
    return true;
  }

  switch (token) {
    case L'`':
      *vkOut = VK_OEM_3;
      return true;
    case L'~':
      *vkOut = VK_OEM_3;
      *shiftOut = true;
      return true;
    case L'-':
      *vkOut = VK_OEM_MINUS;
      return true;
    case L'_':
      *vkOut = VK_OEM_MINUS;
      *shiftOut = true;
      return true;
    case L'=':
      *vkOut = VK_OEM_PLUS;
      return true;
    case L'+':
      *vkOut = VK_OEM_PLUS;
      *shiftOut = true;
      return true;
    case L'[':
      *vkOut = VK_OEM_4;
      return true;
    case L'{':
      *vkOut = VK_OEM_4;
      *shiftOut = true;
      return true;
    case L']':
      *vkOut = VK_OEM_6;
      return true;
    case L'}':
      *vkOut = VK_OEM_6;
      *shiftOut = true;
      return true;
    case L'\\':
      *vkOut = VK_OEM_5;
      return true;
    case L'|':
      *vkOut = VK_OEM_5;
      *shiftOut = true;
      return true;
    case L';':
      *vkOut = VK_OEM_1;
      return true;
    case L':':
      *vkOut = VK_OEM_1;
      *shiftOut = true;
      return true;
    case L'\'':
      *vkOut = VK_OEM_7;
      return true;
    case L'"':
      *vkOut = VK_OEM_7;
      *shiftOut = true;
      return true;
    case L',':
      *vkOut = VK_OEM_COMMA;
      return true;
    case L'<':
      *vkOut = VK_OEM_COMMA;
      *shiftOut = true;
      return true;
    case L'.':
      *vkOut = VK_OEM_PERIOD;
      return true;
    case L'>':
      *vkOut = VK_OEM_PERIOD;
      *shiftOut = true;
      return true;
    case L'/':
      *vkOut = VK_OEM_2;
      return true;
    case L'?':
      *vkOut = VK_OEM_2;
      *shiftOut = true;
      return true;
    case L'!':
      *vkOut = L'1';
      *shiftOut = true;
      return true;
    case L'@':
      *vkOut = L'2';
      *shiftOut = true;
      return true;
    case L'#':
      *vkOut = L'3';
      *shiftOut = true;
      return true;
    case L'$':
      *vkOut = L'4';
      *shiftOut = true;
      return true;
    case L'%':
      *vkOut = L'5';
      *shiftOut = true;
      return true;
    case L'^':
      *vkOut = L'6';
      *shiftOut = true;
      return true;
    case L'&':
      *vkOut = L'7';
      *shiftOut = true;
      return true;
    case L'*':
      *vkOut = L'8';
      *shiftOut = true;
      return true;
    case L'(':
      *vkOut = L'9';
      *shiftOut = true;
      return true;
    case L')':
      *vkOut = L'0';
      *shiftOut = true;
      return true;
    default:
      break;
  }

  return false;
}

void SendTokenAsKeyStroke(wchar_t token) {
  if (token == L'\r') return;
  if (token == L'\n') {
    SendVirtualKeyStroke(VK_RETURN, false, false, false);
    return;
  }
  if (token == L'\t') {
    SendVirtualKeyStroke(VK_TAB, false, false, false);
    return;
  }
  if (token == L' ') {
    SendVirtualKeyStroke(VK_SPACE, false, false, false);
    return;
  }

  WORD vk = 0;
  bool shift = false;
  bool ctrl = false;
  bool alt = false;
  if (TryMapPrintableTokenToVirtualKey(token, &vk, &shift, &ctrl, &alt)) {
    SendVirtualKeyStroke(vk, shift, ctrl, alt);
    return;
  }

  SendUnicodeToken(token);
}

std::wstring ConvertHangulTo2BeolsikSequence(const std::wstring& text, bool* hasHangulOut) {
  static constexpr int HANGUL_BASE_CODEPOINT = 0xAC00;
  static constexpr int HANGUL_LAST_CODEPOINT = 0xD7A3;
  static constexpr int HANGUL_N_COUNT = 588;
  static constexpr int HANGUL_T_COUNT = 28;

  static const std::array<std::string, 19> CHOSEONG_TO_2BEOL = {
      "r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"};

  static const std::array<std::string, 21> JUNGSEONG_TO_2BEOL = {
      "k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l"};

  static const std::array<std::string, 28> JONGSEONG_TO_2BEOL = {
      "", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g"};

  static const std::unordered_map<wchar_t, std::string> JAMO_TO_2BEOL = {
      {static_cast<wchar_t>(0x3131), "r"},  {static_cast<wchar_t>(0x3132), "R"},  {static_cast<wchar_t>(0x3133), "rt"},
      {static_cast<wchar_t>(0x3134), "s"},  {static_cast<wchar_t>(0x3135), "sw"}, {static_cast<wchar_t>(0x3136), "sg"},
      {static_cast<wchar_t>(0x3137), "e"},  {static_cast<wchar_t>(0x3138), "E"},  {static_cast<wchar_t>(0x3139), "f"},
      {static_cast<wchar_t>(0x313A), "fr"}, {static_cast<wchar_t>(0x313B), "fa"}, {static_cast<wchar_t>(0x313C), "fq"},
      {static_cast<wchar_t>(0x313D), "ft"}, {static_cast<wchar_t>(0x313E), "fx"}, {static_cast<wchar_t>(0x313F), "fv"},
      {static_cast<wchar_t>(0x3140), "fg"}, {static_cast<wchar_t>(0x3141), "a"},  {static_cast<wchar_t>(0x3142), "q"},
      {static_cast<wchar_t>(0x3143), "Q"},  {static_cast<wchar_t>(0x3144), "qt"}, {static_cast<wchar_t>(0x3145), "t"},
      {static_cast<wchar_t>(0x3146), "T"},  {static_cast<wchar_t>(0x3147), "d"},  {static_cast<wchar_t>(0x3148), "w"},
      {static_cast<wchar_t>(0x3149), "W"},  {static_cast<wchar_t>(0x314A), "c"},  {static_cast<wchar_t>(0x314B), "z"},
      {static_cast<wchar_t>(0x314C), "x"},  {static_cast<wchar_t>(0x314D), "v"},  {static_cast<wchar_t>(0x314E), "g"},
      {static_cast<wchar_t>(0x314F), "k"},  {static_cast<wchar_t>(0x3150), "o"},  {static_cast<wchar_t>(0x3151), "i"},
      {static_cast<wchar_t>(0x3152), "O"},  {static_cast<wchar_t>(0x3153), "j"},  {static_cast<wchar_t>(0x3154), "p"},
      {static_cast<wchar_t>(0x3155), "u"},  {static_cast<wchar_t>(0x3156), "P"},  {static_cast<wchar_t>(0x3157), "h"},
      {static_cast<wchar_t>(0x3158), "hk"}, {static_cast<wchar_t>(0x3159), "ho"}, {static_cast<wchar_t>(0x315A), "hl"},
      {static_cast<wchar_t>(0x315B), "y"},  {static_cast<wchar_t>(0x315C), "n"},  {static_cast<wchar_t>(0x315D), "nj"},
      {static_cast<wchar_t>(0x315E), "np"}, {static_cast<wchar_t>(0x315F), "nl"}, {static_cast<wchar_t>(0x3160), "b"},
      {static_cast<wchar_t>(0x3161), "m"},  {static_cast<wchar_t>(0x3162), "ml"}, {static_cast<wchar_t>(0x3163), "l"},
  };

  bool hasHangul = false;
  std::wstring sequence;
  sequence.reserve(text.size() * 2);

  for (wchar_t ch : text) {
    const int codepoint = static_cast<int>(ch);
    if (codepoint >= HANGUL_BASE_CODEPOINT && codepoint <= HANGUL_LAST_CODEPOINT) {
      const int syllableIndex = codepoint - HANGUL_BASE_CODEPOINT;
      const int choseongIndex = syllableIndex / HANGUL_N_COUNT;
      const int jungseongIndex = (syllableIndex % HANGUL_N_COUNT) / HANGUL_T_COUNT;
      const int jongseongIndex = syllableIndex % HANGUL_T_COUNT;

      AppendAsciiToWide(sequence, CHOSEONG_TO_2BEOL[static_cast<size_t>(choseongIndex)]);
      AppendAsciiToWide(sequence, JUNGSEONG_TO_2BEOL[static_cast<size_t>(jungseongIndex)]);
      if (jongseongIndex > 0) {
        AppendAsciiToWide(sequence, JONGSEONG_TO_2BEOL[static_cast<size_t>(jongseongIndex)]);
      }
      hasHangul = true;
      continue;
    }

    const auto mapped = JAMO_TO_2BEOL.find(ch);
    if (mapped != JAMO_TO_2BEOL.end()) {
      AppendAsciiToWide(sequence, mapped->second);
      hasHangul = true;
      continue;
    }

    sequence.push_back(ch);
  }

  if (hasHangulOut) {
    *hasHangulOut = hasHangul;
  }
  return sequence;
}

void SendImeCompatibleText(const std::wstring& text, bool pressEnter, double minDelaySeconds, double maxDelaySeconds) {
  bool hasHangul = false;
  const std::wstring sequence = ConvertHangulTo2BeolsikSequence(text, &hasHangul);

  const double sendDelayMin = std::max(0.0, minDelaySeconds);
  const double sendDelayMax = std::max(sendDelayMin, maxDelaySeconds);
  const double perKeyMin = hasHangul ? std::clamp(sendDelayMin * 0.2, 0.001, 0.010) : std::clamp(sendDelayMin * 0.1, 0.0, 0.006);
  const double perKeyMax = hasHangul ? std::clamp(sendDelayMax * 0.2, perKeyMin, 0.020) : std::clamp(sendDelayMax * 0.1, perKeyMin, 0.010);

  for (size_t index = 0; index < sequence.size(); index += 1) {
    SendTokenAsKeyStroke(sequence[index]);
    if (index + 1 < sequence.size()) {
      SleepRandomDelay(perKeyMin, perKeyMax);
    }
  }

  if (pressEnter) {
    SendVirtualKeyStroke(VK_RETURN, false, false, false);
  }

  SleepRandomDelay(sendDelayMin, sendDelayMax);
}

std::wstring Utf8ToWide(const std::string& input) {
  if (input.empty()) return L"";
  int needed = MultiByteToWideChar(CP_UTF8, 0, input.c_str(), static_cast<int>(input.size()), nullptr, 0);
  if (needed <= 0) return L"";

  std::wstring wide(static_cast<size_t>(needed), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, input.c_str(), static_cast<int>(input.size()), wide.data(), needed);
  return wide;
}

void TriggerSendFromConfig() {
  RuntimeConfig snapshot;
  {
    std::lock_guard<std::mutex> lock(g_state.configMutex);
    snapshot = g_state.config;
  }

  if (!snapshot.appEnabled) return;

  {
    std::lock_guard<std::mutex> lock(g_state.actionMutex);
    if (IsDebounced(g_state.lastSendAt, snapshot.sendDebounceMs)) return;
  }

  const auto text = Trim(snapshot.text);
  if (text.empty()) return;

  std::thread([text, snapshot]() {
    SendImeCompatibleText(Utf8ToWide(text), snapshot.pressEnter, snapshot.delayMinSeconds, snapshot.delayMaxSeconds);
  }).detach();
}

void TriggerActionEvent(const std::string& action, int debounceMs, Clock::time_point& checkpoint) {
  {
    std::lock_guard<std::mutex> lock(g_state.actionMutex);
    if (IsDebounced(checkpoint, debounceMs)) {
      return;
    }
  }

  const auto id = NextEventId();
  PushEvent(InputEventRecord{.id = id, .type = "action", .delta = 0, .action = action});
}

bool IsCtrlShiftSForCaptureProbe(const KBDLLHOOKSTRUCT* keyboardData) {
  if (keyboardData == nullptr) return false;
  if (keyboardData->vkCode != static_cast<DWORD>('S')) return false;
  const bool ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
  const bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
  return ctrlDown && shiftDown;
}

bool IsScreenshotProbeKey(const KBDLLHOOKSTRUCT* keyboardData, WPARAM wParam) {
  if (keyboardData == nullptr) return false;
  if (wParam != WM_KEYDOWN && wParam != WM_SYSKEYDOWN) return false;
  if (keyboardData->vkCode == VK_SNAPSHOT) return true;
  return IsCtrlShiftSForCaptureProbe(keyboardData);
}

void TriggerCaptureProbeFromKeyboard(const KBDLLHOOKSTRUCT* keyboardData, WPARAM wParam) {
  if (!IsScreenshotProbeKey(keyboardData, wParam)) return;

  RuntimeConfig snapshot;
  {
    std::lock_guard<std::mutex> lock(g_state.configMutex);
    snapshot = g_state.config;
  }
  if (!snapshot.appEnabled) return;

  TriggerActionEvent("overlay.capture_probe", DEFAULT_CAPTURE_PROBE_DEBOUNCE_MS, g_state.lastCaptureProbeAt);
}

void HandleHotkeyId(int hotkeyId) {
  RuntimeConfig snapshot;
  {
    std::lock_guard<std::mutex> lock(g_state.configMutex);
    snapshot = g_state.config;
  }

  if (hotkeyId == HOTKEY_ID_SEND) {
    TriggerSendFromConfig();
    return;
  }

  if (hotkeyId == HOTKEY_ID_APP_TOGGLE) {
    {
      std::lock_guard<std::mutex> lock(g_state.actionMutex);
      if (IsDebounced(g_state.lastAppToggleAt, DEFAULT_APP_TOGGLE_DEBOUNCE_MS)) {
        return;
      }
    }

    {
      std::lock_guard<std::mutex> lock(g_state.configMutex);
      g_state.config.appEnabled = !g_state.config.appEnabled;
      snapshot.appEnabled = g_state.config.appEnabled;
    }

    const auto id = NextEventId();
    PushEvent(InputEventRecord{.id = id, .type = "action", .delta = 0, .action = "app.toggle_enabled"});
    return;
  }

  if (!snapshot.appEnabled) return;

  if (hotkeyId == HOTKEY_ID_OVERLAY_TOGGLE) {
    TriggerActionEvent("overlay.toggle_visibility", DEFAULT_ACTION_DEBOUNCE_MS, g_state.lastOverlayToggleAt);
    return;
  }
  if (hotkeyId == HOTKEY_ID_MAIN_TOGGLE) {
    TriggerActionEvent("main.toggle_visibility", DEFAULT_ACTION_DEBOUNCE_MS, g_state.lastMainToggleAt);
    return;
  }
  if (hotkeyId == HOTKEY_ID_OVERLAY_EDIT) {
    TriggerActionEvent("overlay.toggle_interaction", DEFAULT_ACTION_DEBOUNCE_MS, g_state.lastOverlayEditAt);
    return;
  }
}

bool ShouldBlockAltF4(const KBDLLHOOKSTRUCT* keyboardData, WPARAM wParam) {
  if (keyboardData == nullptr) return false;
  if (keyboardData->vkCode != VK_F4) return false;

  if (wParam != WM_KEYDOWN && wParam != WM_SYSKEYDOWN) {
    return false;
  }

  RuntimeConfig snapshot;
  {
    std::lock_guard<std::mutex> lock(g_state.configMutex);
    snapshot = g_state.config;
  }

  if (!snapshot.appEnabled || !snapshot.blockAltF4) return false;

  const bool altDownByFlag = (keyboardData->flags & LLKHF_ALTDOWN) != 0;
  const bool altDownByState = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
  return altDownByFlag || altDownByState;
}

LRESULT CALLBACK KeyboardHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode == HC_ACTION) {
    const auto* keyboardData = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
    TriggerCaptureProbeFromKeyboard(keyboardData, wParam);
    if (ShouldBlockAltF4(keyboardData, wParam)) {
      return 1;
    }
  }
  return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

LRESULT CALLBACK MouseHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode == HC_ACTION && wParam == WM_MOUSEWHEEL) {
    const bool shiftPressed = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
    if (shiftPressed) {
      RuntimeConfig snapshot;
      {
        std::lock_guard<std::mutex> lock(g_state.configMutex);
        snapshot = g_state.config;
      }

      if (snapshot.appEnabled) {
        const auto* mouseData = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);
        const int wheel = GET_WHEEL_DELTA_WPARAM(mouseData->mouseData);
        const int delta = wheel > 0 ? -1 : 1;
        const auto id = NextEventId();
        PushEvent(InputEventRecord{.id = id, .type = "wheel", .delta = delta, .action = ""});
      }
    }
  }

  return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

void ApplyHotkeyRegistrationsOnLoopThread() {
  RuntimeConfig snapshot;
  {
    std::lock_guard<std::mutex> lock(g_state.configMutex);
    snapshot = g_state.config;
  }

  struct PlanItem {
    int id;
    std::optional<std::string> combo;
  };

  const std::vector<PlanItem> plan = {
      {HOTKEY_ID_SEND, snapshot.sendHotkey},
      {HOTKEY_ID_APP_TOGGLE, snapshot.appToggleHotkey},
      {HOTKEY_ID_OVERLAY_TOGGLE, snapshot.overlayToggleHotkey},
      {HOTKEY_ID_MAIN_TOGGLE, snapshot.mainToggleHotkey},
      {HOTKEY_ID_OVERLAY_EDIT, snapshot.overlayEditHotkey},
  };

  std::lock_guard<std::mutex> lock(g_state.registrationMutex);
  for (const auto& item : plan) {
    UnregisterHotKey(nullptr, item.id);
    g_state.registeredCombos[item.id] = std::nullopt;

    const auto parsed = ParseHotkeyBinding(item.combo);
    if (!parsed.has_value()) continue;

    if (RegisterHotKey(nullptr, item.id, parsed->modifiers, parsed->vk)) {
      g_state.registeredCombos[item.id] = item.combo;
    }
  }
}

void LoopThreadMain() {
  g_state.loopThreadId = GetCurrentThreadId();

  MSG msg;
  PeekMessage(&msg, nullptr, WM_USER, WM_USER, PM_NOREMOVE);

  g_state.keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardHookProc, nullptr, 0);
  g_state.mouseHook = SetWindowsHookExW(WH_MOUSE_LL, MouseHookProc, nullptr, 0);
  ApplyHotkeyRegistrationsOnLoopThread();

  while (GetMessage(&msg, nullptr, 0, 0) > 0) {
    if (msg.message == WM_HOTKEY) {
      HandleHotkeyId(static_cast<int>(msg.wParam));
      continue;
    }

    if (msg.message == WM_QT_REFRESH_HOTKEYS) {
      ApplyHotkeyRegistrationsOnLoopThread();
      continue;
    }

    if (msg.message == WM_QT_STOP_LOOP) {
      break;
    }

    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }

  for (int id : {HOTKEY_ID_SEND, HOTKEY_ID_APP_TOGGLE, HOTKEY_ID_OVERLAY_TOGGLE, HOTKEY_ID_MAIN_TOGGLE, HOTKEY_ID_OVERLAY_EDIT}) {
    UnregisterHotKey(nullptr, id);
  }

  if (g_state.mouseHook != nullptr) {
    UnhookWindowsHookEx(g_state.mouseHook);
    g_state.mouseHook = nullptr;
  }
  if (g_state.keyboardHook != nullptr) {
    UnhookWindowsHookEx(g_state.keyboardHook);
    g_state.keyboardHook = nullptr;
  }

  g_state.loopThreadId = 0;
}

void EnsureRuntimeInitialized() {
  if (g_state.initialized.load()) return;

  g_state.running.store(true);
  g_state.loopThread = std::thread([]() { LoopThreadMain(); });
  g_state.initialized.store(true);
}

void RequestHotkeyRefresh() {
  if (!g_state.initialized.load()) return;
  const DWORD threadId = g_state.loopThreadId;
  if (threadId == 0) return;
  PostThreadMessage(threadId, WM_QT_REFRESH_HOTKEYS, 0, 0);
}

void ShutdownRuntime() {
  if (!g_state.initialized.load()) return;

  const DWORD threadId = g_state.loopThreadId;
  if (threadId != 0) {
    PostThreadMessage(threadId, WM_QT_STOP_LOOP, 0, 0);
  }

  if (g_state.loopThread.joinable()) {
    g_state.loopThread.join();
  }

  g_state.running.store(false);
  g_state.initialized.store(false);
}

std::optional<std::string> ReadNullableString(const Napi::Object& object, const char* key) {
  if (!object.Has(key)) return std::nullopt;
  const Napi::Value value = object.Get(key);
  if (value.IsNull() || value.IsUndefined()) {
    return std::optional<std::string>{};
  }
  if (!value.IsString()) {
    throw Napi::Error::New(object.Env(), std::string("`") + key + "` must be string or null");
  }

  const std::string normalized = Trim(value.As<Napi::String>().Utf8Value());
  if (normalized.empty()) {
    return std::optional<std::string>{};
  }
  return normalized;
}

Napi::Value Init(const Napi::CallbackInfo& info) {
  EnsureRuntimeInitialized();
  return info.Env().Undefined();
}

Napi::Value Shutdown(const Napi::CallbackInfo& info) {
  ShutdownRuntime();
  return info.Env().Undefined();
}

Napi::Value Configure(const Napi::CallbackInfo& info) {
  EnsureRuntimeInitialized();

  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "configure payload must be object");
  }

  const Napi::Object payload = info[0].As<Napi::Object>();

  {
    std::lock_guard<std::mutex> lock(g_state.configMutex);

    if (payload.Has("text")) {
      if (!payload.Get("text").IsString()) {
        throw Napi::TypeError::New(env, "`text` must be string");
      }
      g_state.config.text = payload.Get("text").As<Napi::String>().Utf8Value();
    }

    if (payload.Has("hotkey")) {
      g_state.config.sendHotkey = ReadNullableString(payload, "hotkey");
    }
    if (payload.Has("app_toggle_hotkey")) {
      g_state.config.appToggleHotkey = ReadNullableString(payload, "app_toggle_hotkey");
    }
    if (payload.Has("overlay_toggle_hotkey")) {
      g_state.config.overlayToggleHotkey = ReadNullableString(payload, "overlay_toggle_hotkey");
    }
    if (payload.Has("main_toggle_hotkey")) {
      g_state.config.mainToggleHotkey = ReadNullableString(payload, "main_toggle_hotkey");
    }
    if (payload.Has("overlay_edit_hotkey")) {
      g_state.config.overlayEditHotkey = ReadNullableString(payload, "overlay_edit_hotkey");
    }

    if (payload.Has("app_enabled")) {
      if (!payload.Get("app_enabled").IsBoolean()) {
        throw Napi::TypeError::New(env, "`app_enabled` must be boolean");
      }
      g_state.config.appEnabled = payload.Get("app_enabled").As<Napi::Boolean>().Value();
    }

    if (payload.Has("block_alt_f4")) {
      if (!payload.Get("block_alt_f4").IsBoolean()) {
        throw Napi::TypeError::New(env, "`block_alt_f4` must be boolean");
      }
      g_state.config.blockAltF4 = payload.Get("block_alt_f4").As<Napi::Boolean>().Value();
    }

    if (payload.Has("press_enter")) {
      if (!payload.Get("press_enter").IsBoolean()) {
        throw Napi::TypeError::New(env, "`press_enter` must be boolean");
      }
      g_state.config.pressEnter = payload.Get("press_enter").As<Napi::Boolean>().Value();
    }

    if (payload.Has("delay_range")) {
      const Napi::Value delayValue = payload.Get("delay_range");
      if (!delayValue.IsArray()) {
        throw Napi::TypeError::New(env, "`delay_range` must be [min,max]");
      }
      const Napi::Array delayArray = delayValue.As<Napi::Array>();
      if (delayArray.Length() != 2 || !delayArray.Get((uint32_t)0).IsNumber() || !delayArray.Get((uint32_t)1).IsNumber()) {
        throw Napi::TypeError::New(env, "`delay_range` must be [min,max]");
      }
      const double minDelay = delayArray.Get((uint32_t)0).As<Napi::Number>().DoubleValue();
      const double maxDelay = delayArray.Get((uint32_t)1).As<Napi::Number>().DoubleValue();
      if (minDelay < 0 || maxDelay < 0 || minDelay > maxDelay) {
        throw Napi::TypeError::New(env, "`delay_range` must satisfy 0 <= min <= max");
      }
      g_state.config.delayMinSeconds = minDelay;
      g_state.config.delayMaxSeconds = maxDelay;
    }
  }

  RequestHotkeyRefresh();

  Napi::Object result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, true));
  return result;
}

Napi::Value Send(const Napi::CallbackInfo& info) {
  EnsureRuntimeInitialized();

  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "send payload must be object");
  }

  const Napi::Object payload = info[0].As<Napi::Object>();
  if (!payload.Has("text") || !payload.Get("text").IsString()) {
    throw Napi::TypeError::New(env, "`text` is required");
  }

  const std::string text = Trim(payload.Get("text").As<Napi::String>().Utf8Value());
  if (text.empty()) {
    throw Napi::TypeError::New(env, "`text` is required");
  }

  bool pressEnter = false;
  if (payload.Has("press_enter")) {
    if (!payload.Get("press_enter").IsBoolean()) {
      throw Napi::TypeError::New(env, "`press_enter` must be boolean");
    }
    pressEnter = payload.Get("press_enter").As<Napi::Boolean>().Value();
  }

  double minDelay = 0.02;
  double maxDelay = 0.05;
  if (payload.Has("delay_range")) {
    const Napi::Value delayValue = payload.Get("delay_range");
    if (!delayValue.IsArray()) {
      throw Napi::TypeError::New(env, "`delay_range` must be [min,max]");
    }
    const Napi::Array delayArray = delayValue.As<Napi::Array>();
    if (delayArray.Length() != 2 || !delayArray.Get((uint32_t)0).IsNumber() || !delayArray.Get((uint32_t)1).IsNumber()) {
      throw Napi::TypeError::New(env, "`delay_range` must be [min,max]");
    }
    minDelay = delayArray.Get((uint32_t)0).As<Napi::Number>().DoubleValue();
    maxDelay = delayArray.Get((uint32_t)1).As<Napi::Number>().DoubleValue();
    if (minDelay < 0 || maxDelay < 0 || minDelay > maxDelay) {
      throw Napi::TypeError::New(env, "`delay_range` must satisfy 0 <= min <= max");
    }
  }

  std::thread([text, pressEnter, minDelay, maxDelay]() {
    SendImeCompatibleText(Utf8ToWide(text), pressEnter, minDelay, maxDelay);
  }).detach();

  Napi::Object result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, true));
  return result;
}

Napi::Value Events(const Napi::CallbackInfo& info) {
  EnsureRuntimeInitialized();

  Napi::Env env = info.Env();
  int64_t after = 0;
  if (info.Length() >= 1) {
    if (info[0].IsNumber()) {
      after = static_cast<int64_t>(info[0].As<Napi::Number>().Int64Value());
    } else if (info[0].IsObject()) {
      const Napi::Object object = info[0].As<Napi::Object>();
      if (object.Has("after") && object.Get("after").IsNumber()) {
        after = static_cast<int64_t>(object.Get("after").As<Napi::Number>().Int64Value());
      }
    }
  }
  if (after < 0) after = 0;

  std::vector<InputEventRecord> snapshot;
  int64_t lastId = 0;
  {
    std::lock_guard<std::mutex> lock(g_state.eventsMutex);
    lastId = g_state.lastEventId;
    snapshot.reserve(g_state.events.size());
    for (const auto& item : g_state.events) {
      if (item.id <= after) continue;
      snapshot.push_back(item);
    }
  }

  Napi::Array events = Napi::Array::New(env, snapshot.size());
  for (size_t index = 0; index < snapshot.size(); index += 1) {
    const auto& item = snapshot[index];
    Napi::Object event = Napi::Object::New(env);
    event.Set("id", Napi::Number::New(env, static_cast<double>(item.id)));
    event.Set("type", Napi::String::New(env, item.type));
    if (item.type == "wheel") {
      event.Set("delta", Napi::Number::New(env, item.delta));
    }
    if (item.type == "action") {
      event.Set("action", Napi::String::New(env, item.action));
    }
    events.Set(index, event);
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("ok", Napi::Boolean::New(env, true));
  result.Set("events", events);
  result.Set("last_id", Napi::Number::New(env, static_cast<double>(lastId)));
  return result;
}

Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  exports.Set("init", Napi::Function::New(env, Init));
  exports.Set("shutdown", Napi::Function::New(env, Shutdown));
  exports.Set("configure", Napi::Function::New(env, Configure));
  exports.Set("send", Napi::Function::New(env, Send));
  exports.Set("events", Napi::Function::New(env, Events));
  return exports;
}

}  // namespace

NODE_API_MODULE(quicktext_native, InitModule)
