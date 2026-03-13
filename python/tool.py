from __future__ import annotations

import random
import threading
import time
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    import keyboard as keyboard_lib
except Exception as exc:  # pragma: no cover - runtime environment dependent
    keyboard_lib = None
    KEYBOARD_IMPORT_ERROR = str(exc)
else:
    KEYBOARD_IMPORT_ERROR = ""

try:
    from pynput import mouse as mouse_lib
except Exception as exc:  # pragma: no cover - runtime environment dependent
    mouse_lib = None
    MOUSE_IMPORT_ERROR = str(exc)
else:
    MOUSE_IMPORT_ERROR = ""

app = Flask(__name__)
CORS(app)

events_lock = threading.Lock()
state_lock = threading.Lock()
hotkey_lock = threading.Lock()
conversion_cache_lock = threading.Lock()
events: list[dict[str, Any]] = []
event_id = 0
MAX_EVENTS = 400
conversion_cache: dict[str, tuple[str, bool]] = {}
DEFAULT_DELAY_RANGE: tuple[float, float] = (0.02, 0.05)
DEFAULT_SEND_HOTKEY = "4"
DEFAULT_OVERLAY_TOGGLE_HOTKEY = "ctrl+shift+1"
DEFAULT_MAIN_TOGGLE_HOTKEY = "delete"
DEFAULT_OVERLAY_EDIT_HOTKEY = "tab"
DEFAULT_APP_TOGGLE_HOTKEY = "shift+5"
DEFAULT_PRESS_ENTER = False
DEFAULT_HOTKEY_DEBOUNCE_MS = 90
DEFAULT_ACTION_HOTKEY_DEBOUNCE_MS = 280
APP_TOGGLE_ACTION_HOTKEY_DEBOUNCE_MS = 1200
IME_KEYSTROKE_DELAY_SECONDS = 0.02
CONVERSION_CACHE_MAX_ITEMS = 2000
HOTKEY_LATCH_RELEASE_TIMEOUT_SECONDS = 2.5
HOTKEY_LATCH_RELEASE_POLL_SECONDS = 0.015
HOTKEY_LATCH_RELEASE_SETTLE_SECONDS = 0.18
ACTION_OVERLAY_TOGGLE = "overlay.toggle_visibility"
ACTION_MAIN_TOGGLE = "main.toggle_visibility"
ACTION_OVERLAY_EDIT = "overlay.toggle_interaction"
ACTION_APP_TOGGLE = "app.toggle_enabled"
MODIFIER_ORDER = ("ctrl", "shift", "alt", "windows")
MODIFIER_TOKENS = set(MODIFIER_ORDER)
MODIFIER_ALIASES = {
    "ctrl": "ctrl",
    "control": "ctrl",
    "cmdorctrl": "ctrl",
    "shift": "shift",
    "alt": "alt",
    "option": "alt",
    "meta": "windows",
    "cmd": "windows",
    "command": "windows",
    "super": "windows",
    "win": "windows",
    "windows": "windows",
}
SPECIAL_KEY_ALIASES = {
    "escape": "esc",
    "return": "enter",
    "spacebar": "space",
    "del": "delete",
    "ins": "insert",
}
SHIFTED_SYMBOL_ALIASES = {
    "~": "`",
    "!": "1",
    "@": "2",
    "#": "3",
    "$": "4",
    "%": "5",
    "^": "6",
    "&": "7",
    "*": "8",
    "(": "9",
    ")": "0",
    "_": "-",
    "+": "=",
    "{": "[",
    "}": "]",
    "|": "\\",
    ":": ";",
    '"': "'",
    "<": ",",
    ">": ".",
    "?": "/",
}

HANGUL_BASE_CODEPOINT = 0xAC00
HANGUL_LAST_CODEPOINT = 0xD7A3
HANGUL_N_COUNT = 588
HANGUL_T_COUNT = 28
HANGUL_CHOSEONG = [
    "ㄱ",
    "ㄲ",
    "ㄴ",
    "ㄷ",
    "ㄸ",
    "ㄹ",
    "ㅁ",
    "ㅂ",
    "ㅃ",
    "ㅅ",
    "ㅆ",
    "ㅇ",
    "ㅈ",
    "ㅉ",
    "ㅊ",
    "ㅋ",
    "ㅌ",
    "ㅍ",
    "ㅎ",
]
HANGUL_JUNGSEONG = [
    "ㅏ",
    "ㅐ",
    "ㅑ",
    "ㅒ",
    "ㅓ",
    "ㅔ",
    "ㅕ",
    "ㅖ",
    "ㅗ",
    "ㅘ",
    "ㅙ",
    "ㅚ",
    "ㅛ",
    "ㅜ",
    "ㅝ",
    "ㅞ",
    "ㅟ",
    "ㅠ",
    "ㅡ",
    "ㅢ",
    "ㅣ",
]
HANGUL_JONGSEONG = [
    "",
    "ㄱ",
    "ㄲ",
    "ㄳ",
    "ㄴ",
    "ㄵ",
    "ㄶ",
    "ㄷ",
    "ㄹ",
    "ㄺ",
    "ㄻ",
    "ㄼ",
    "ㄽ",
    "ㄾ",
    "ㄿ",
    "ㅀ",
    "ㅁ",
    "ㅂ",
    "ㅄ",
    "ㅅ",
    "ㅆ",
    "ㅇ",
    "ㅈ",
    "ㅊ",
    "ㅋ",
    "ㅌ",
    "ㅍ",
    "ㅎ",
]
JAMO_TO_2BEOLSIK = {
    "ㄱ": "r",
    "ㄲ": "R",
    "ㄳ": "rt",
    "ㄴ": "s",
    "ㄵ": "sw",
    "ㄶ": "sg",
    "ㄷ": "e",
    "ㄸ": "E",
    "ㄹ": "f",
    "ㄺ": "fr",
    "ㄻ": "fa",
    "ㄼ": "fq",
    "ㄽ": "ft",
    "ㄾ": "fx",
    "ㄿ": "fv",
    "ㅀ": "fg",
    "ㅁ": "a",
    "ㅂ": "q",
    "ㅃ": "Q",
    "ㅄ": "qt",
    "ㅅ": "t",
    "ㅆ": "T",
    "ㅇ": "d",
    "ㅈ": "w",
    "ㅉ": "W",
    "ㅊ": "c",
    "ㅋ": "z",
    "ㅌ": "x",
    "ㅍ": "v",
    "ㅎ": "g",
    "ㅏ": "k",
    "ㅐ": "o",
    "ㅑ": "i",
    "ㅒ": "O",
    "ㅓ": "j",
    "ㅔ": "p",
    "ㅕ": "u",
    "ㅖ": "P",
    "ㅗ": "h",
    "ㅘ": "hk",
    "ㅙ": "ho",
    "ㅚ": "hl",
    "ㅛ": "y",
    "ㅜ": "n",
    "ㅝ": "nj",
    "ㅞ": "np",
    "ㅟ": "nl",
    "ㅠ": "b",
    "ㅡ": "m",
    "ㅢ": "ml",
    "ㅣ": "l",
}

send_config = {
    "text": "",
    "send_hotkey": DEFAULT_SEND_HOTKEY,
    "app_toggle_hotkey": DEFAULT_APP_TOGGLE_HOTKEY,
    "app_enabled": True,
    "overlay_toggle_hotkey": DEFAULT_OVERLAY_TOGGLE_HOTKEY,
    "main_toggle_hotkey": DEFAULT_MAIN_TOGGLE_HOTKEY,
    "overlay_edit_hotkey": DEFAULT_OVERLAY_EDIT_HOTKEY,
    "delay_range": DEFAULT_DELAY_RANGE,
    "press_enter": DEFAULT_PRESS_ENTER,
    "hotkey_debounce_ms": DEFAULT_HOTKEY_DEBOUNCE_MS,
}

hotkey_handlers: dict[str, Any] = {}
hotkey_tokens: dict[str, list[str]] = {}
hotkey_latches: dict[str, bool] = {}

runtime_state = {
    "typing_available": keyboard_lib is not None,
    "wheel_listener_available": mouse_lib is not None,
    "listener_running": False,
    "send_hotkey_registered": False,
    "app_toggle_registered": False,
    "overlay_toggle_registered": False,
    "main_toggle_registered": False,
    "overlay_edit_registered": False,
    "send_hotkey": DEFAULT_SEND_HOTKEY,
    "app_toggle_hotkey": DEFAULT_APP_TOGGLE_HOTKEY,
    "app_enabled": True,
    "overlay_toggle_hotkey": DEFAULT_OVERLAY_TOGGLE_HOTKEY,
    "main_toggle_hotkey": DEFAULT_MAIN_TOGGLE_HOTKEY,
    "overlay_edit_hotkey": DEFAULT_OVERLAY_EDIT_HOTKEY,
    "configured_text_length": 0,
    "press_enter": DEFAULT_PRESS_ENTER,
    "hotkey_debounce_ms": DEFAULT_HOTKEY_DEBOUNCE_MS,
    "last_hotkey_trigger_at": 0.0,
    "last_action_trigger_at": {
        ACTION_OVERLAY_TOGGLE: 0.0,
        ACTION_MAIN_TOGGLE: 0.0,
        ACTION_OVERLAY_EDIT: 0.0,
        ACTION_APP_TOGGLE: 0.0,
    },
    "last_error": "",
    "last_send_at": 0.0,
}

if KEYBOARD_IMPORT_ERROR:
    runtime_state["last_error"] = f"keyboard import failed: {KEYBOARD_IMPORT_ERROR}"
elif MOUSE_IMPORT_ERROR:
    runtime_state["last_error"] = f"pynput import failed: {MOUSE_IMPORT_ERROR}"


def set_last_error(message: str) -> None:
    with state_lock:
        runtime_state["last_error"] = message


def clear_last_error() -> None:
    with state_lock:
        runtime_state["last_error"] = ""


def parse_delay_range(raw: Any) -> tuple[float, float]:
    if raw is None:
        return DEFAULT_DELAY_RANGE
    if not isinstance(raw, list) or len(raw) != 2:
        raise ValueError("delay_range must be [min, max]")

    min_value = raw[0]
    max_value = raw[1]
    if not isinstance(min_value, (int, float)) or not isinstance(max_value, (int, float)):
        raise ValueError("delay_range values must be numbers")
    if min_value < 0 or max_value < 0 or min_value > max_value:
        raise ValueError("delay_range must satisfy 0 <= min <= max")

    return (float(min_value), float(max_value))


def normalize_hotkey_token(raw_token: str) -> str:
    token = str(raw_token).strip().lower()
    if not token:
        return ""

    mapped_modifier = MODIFIER_ALIASES.get(token)
    if mapped_modifier:
        return mapped_modifier

    shifted_alias = SHIFTED_SYMBOL_ALIASES.get(token)
    if shifted_alias is not None:
        token = shifted_alias

    if token.startswith("digit") and len(token) == 6 and token[-1].isdigit():
        token = token[-1]
    elif token.startswith("key") and len(token) == 4 and token[-1].isalpha():
        token = token[-1]

    mapped_special = SPECIAL_KEY_ALIASES.get(token)
    if mapped_special:
        return mapped_special
    return token


def normalize_hotkey_string(raw_hotkey: Any) -> str:
    if not isinstance(raw_hotkey, str):
        raise ValueError("hotkey must be string")

    parts = [normalize_hotkey_token(chunk) for chunk in raw_hotkey.split("+")]
    parts = [part for part in parts if part]
    if not parts:
        raise ValueError("hotkey cannot be empty")

    modifiers: set[str] = set()
    key = ""
    for part in parts:
        if part in MODIFIER_TOKENS:
            modifiers.add(part)
            continue
        if key:
            raise ValueError("hotkey must include at most one non-modifier key")
        key = part

    ordered_modifiers = [item for item in MODIFIER_ORDER if item in modifiers]
    if key:
        return "+".join([*ordered_modifiers, key])
    if ordered_modifiers:
        return "+".join(ordered_modifiers)
    raise ValueError("hotkey cannot be empty")


def parse_hotkey_tokens(hotkey: str) -> list[str]:
    parts = [normalize_hotkey_token(chunk) for chunk in str(hotkey).split("+")]
    tokens = [part for part in parts if part]
    if not tokens:
        return []

    ordered: list[str] = []
    for part in tokens:
        if part in MODIFIER_TOKENS:
            if part not in ordered:
                ordered.append(part)
            continue
        ordered.append(part)
    return ordered


def parse_hotkey(raw: Any, fallback: str) -> str:
    normalized_fallback = normalize_hotkey_string(fallback)
    if raw is None:
        return normalized_fallback
    return normalize_hotkey_string(raw)


def parse_press_enter(raw: Any, fallback: bool) -> bool:
    if raw is None:
        return fallback
    if isinstance(raw, bool):
        return raw
    raise ValueError("press_enter must be boolean")


def parse_boolean_flag(raw: Any, fallback: bool, field_name: str) -> bool:
    if raw is None:
        return fallback
    if isinstance(raw, bool):
        return raw
    raise ValueError(f"{field_name} must be boolean")


def parse_hotkey_debounce_ms(raw: Any, fallback: int) -> int:
    if raw is None:
        return fallback
    if not isinstance(raw, (int, float)):
        raise ValueError("hotkey_debounce_ms must be number")
    value = int(raw)
    if value < 20 or value > 1000:
        raise ValueError("hotkey_debounce_ms must be between 20 and 1000")
    return value


def try_acquire_hotkey_latch(binding_id: str) -> bool:
    with hotkey_lock:
        if bool(hotkey_latches.get(binding_id, False)):
            return False
        hotkey_latches[binding_id] = True
        return True


def release_hotkey_latch(binding_id: str) -> None:
    with hotkey_lock:
        if binding_id in hotkey_latches:
            hotkey_latches[binding_id] = False


def is_hotkey_binding_pressed(binding_id: str) -> bool:
    if keyboard_lib is None:
        return False

    with hotkey_lock:
        tokens = list(hotkey_tokens.get(binding_id, []))
    if not tokens:
        return False

    for token in tokens:
        try:
            if not keyboard_lib.is_pressed(token):
                return False
        except Exception:
            return False
    return True


def release_hotkey_latch_after_release(binding_id: str) -> None:
    deadline = time.monotonic() + HOTKEY_LATCH_RELEASE_TIMEOUT_SECONDS
    idle_since: float | None = None

    while time.monotonic() < deadline:
        if is_hotkey_binding_pressed(binding_id):
            idle_since = None
        else:
            if idle_since is None:
                idle_since = time.monotonic()
            elif time.monotonic() - idle_since >= HOTKEY_LATCH_RELEASE_SETTLE_SECONDS:
                break
        time.sleep(HOTKEY_LATCH_RELEASE_POLL_SECONDS)

    release_hotkey_latch(binding_id)


def run_hotkey_callback_with_latch(binding_id: str, callback: Any) -> None:
    if not try_acquire_hotkey_latch(binding_id):
        return

    try:
        callback()
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        set_last_error(f"hotkey callback failed ({binding_id}): {exc}")
    finally:
        try:
            threading.Thread(target=release_hotkey_latch_after_release, args=(binding_id,), daemon=True).start()
        except Exception:
            release_hotkey_latch(binding_id)


def convert_hangul_to_2beolsik(text: str) -> tuple[str, bool]:
    chunks: list[str] = []
    converted = False

    for char in text:
        codepoint = ord(char)
        if HANGUL_BASE_CODEPOINT <= codepoint <= HANGUL_LAST_CODEPOINT:
            syllable_index = codepoint - HANGUL_BASE_CODEPOINT
            choseong_index = syllable_index // HANGUL_N_COUNT
            jungseong_index = (syllable_index % HANGUL_N_COUNT) // HANGUL_T_COUNT
            jongseong_index = syllable_index % HANGUL_T_COUNT

            choseong = HANGUL_CHOSEONG[choseong_index]
            jungseong = HANGUL_JUNGSEONG[jungseong_index]
            chunks.append(JAMO_TO_2BEOLSIK[choseong])
            chunks.append(JAMO_TO_2BEOLSIK[jungseong])

            jongseong = HANGUL_JONGSEONG[jongseong_index]
            if jongseong:
                chunks.append(JAMO_TO_2BEOLSIK[jongseong])

            converted = True
            continue

        mapped = JAMO_TO_2BEOLSIK.get(char)
        if mapped:
            chunks.append(mapped)
            converted = True
            continue

        chunks.append(char)

    return "".join(chunks), converted


def resolve_2beolsik_sequence(text: str) -> tuple[str, bool]:
    with conversion_cache_lock:
        cached = conversion_cache.get(text)
        if cached is not None:
            return cached

    converted = convert_hangul_to_2beolsik(text)

    with conversion_cache_lock:
        existing = conversion_cache.get(text)
        if existing is not None:
            return existing

        if len(conversion_cache) >= CONVERSION_CACHE_MAX_ITEMS:
            oldest_key = next(iter(conversion_cache.keys()), None)
            if oldest_key is not None:
                conversion_cache.pop(oldest_key, None)
        conversion_cache[text] = converted
        return converted


def warmup_2beolsik_cache(text: str) -> None:
    if not text:
        return
    resolve_2beolsik_sequence(text)


def press_ime_token(token: str) -> None:
    if not token:
        return

    if token == " ":
        keyboard_lib.press_and_release("space")
        return
    if token == "\n":
        keyboard_lib.press_and_release("enter")
        return
    if token == "\t":
        keyboard_lib.press_and_release("tab")
        return

    if len(token) == 1 and "A" <= token <= "Z":
        keyboard_lib.press_and_release(f"shift+{token.lower()}")
        return

    try:
        keyboard_lib.press_and_release(token)
    except Exception:
        keyboard_lib.write(token)


def type_ime_keystrokes(sequence: str) -> None:
    for token in sequence:
        press_ime_token(token)
        time.sleep(IME_KEYSTROKE_DELAY_SECONDS)


def type_text(text: str, delay_range: tuple[float, float], press_enter: bool) -> None:
    if keyboard_lib is None:
        raise RuntimeError("keyboard module unavailable")

    jitter = random.uniform(delay_range[0], delay_range[1])
    sequence, has_hangul = resolve_2beolsik_sequence(text)
    if has_hangul:
        # Korean game chats often need IME-style key events, not direct unicode injection.
        type_ime_keystrokes(sequence)
    else:
        keyboard_lib.write(text)

    if press_enter:
        keyboard_lib.press_and_release("enter")
    time.sleep(jitter)


def safe_type_text(text: str, delay_range: tuple[float, float], press_enter: bool) -> None:
    try:
        type_text(text, delay_range, press_enter)
        clear_last_error()
        with state_lock:
            runtime_state["last_send_at"] = time.time()
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        set_last_error(f"send failed: {exc}")


def start_async_send(text: str, delay_range: tuple[float, float], press_enter: bool) -> bool:
    try:
        threading.Thread(target=safe_type_text, args=(text, delay_range, press_enter), daemon=True).start()
        return True
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        set_last_error(f"send thread failed: {exc}")
        return False


def get_send_snapshot() -> tuple[str, tuple[float, float], bool]:
    with state_lock:
        return (
            str(send_config["text"]).strip(),
            tuple(send_config["delay_range"]),
            bool(send_config["press_enter"]),
        )


def trigger_configured_send() -> None:
    with state_lock:
        if not bool(runtime_state.get("app_enabled", True)):
            return
        debounce_ms = int(send_config.get("hotkey_debounce_ms", DEFAULT_HOTKEY_DEBOUNCE_MS))
        last_trigger_at = float(runtime_state.get("last_hotkey_trigger_at", 0.0))
        now = time.monotonic()
        if now - last_trigger_at < debounce_ms / 1000:
            return
        runtime_state["last_hotkey_trigger_at"] = now

    text, delay_range, press_enter = get_send_snapshot()
    if not text:
        return
    start_async_send(text, delay_range, press_enter)


def register_hotkey_binding(
    binding_id: str,
    hotkey: str,
    callback: Any,
    suppress: bool = True,
    trigger_on_release: bool = False,
) -> tuple[bool, str]:
    if keyboard_lib is None:
        message = "keyboard module unavailable"
        if KEYBOARD_IMPORT_ERROR:
            message = f"{message}: {KEYBOARD_IMPORT_ERROR}"
        set_last_error(message)
        return False, message

    def wrapped_callback() -> None:
        run_hotkey_callback_with_latch(binding_id, callback)

    with hotkey_lock:
        previous = hotkey_handlers.get(binding_id)
        if previous is not None:
            try:
                keyboard_lib.remove_hotkey(previous)
            except Exception:
                pass
            hotkey_handlers.pop(binding_id, None)
            hotkey_tokens.pop(binding_id, None)
            hotkey_latches.pop(binding_id, None)

        try:
            handle = keyboard_lib.add_hotkey(
                hotkey,
                wrapped_callback,
                trigger_on_release=trigger_on_release,
                suppress=suppress,
            )
        except TypeError:
            try:
                handle = keyboard_lib.add_hotkey(hotkey, wrapped_callback, suppress=suppress)
            except TypeError:
                handle = keyboard_lib.add_hotkey(hotkey, wrapped_callback)
        except Exception as exc:  # pragma: no cover - runtime environment dependent
            hotkey_tokens.pop(binding_id, None)
            hotkey_latches.pop(binding_id, None)
            return False, str(exc)

        hotkey_handlers[binding_id] = handle
        hotkey_tokens[binding_id] = parse_hotkey_tokens(hotkey)
        hotkey_latches[binding_id] = False

    return True, ""


def unregister_hotkey_binding(binding_id: str) -> None:
    if keyboard_lib is None:
        return
    with hotkey_lock:
        previous = hotkey_handlers.pop(binding_id, None)
        hotkey_tokens.pop(binding_id, None)
        hotkey_latches.pop(binding_id, None)
        if previous is not None:
            try:
                keyboard_lib.remove_hotkey(previous)
            except Exception:
                pass


def register_send_hotkey(hotkey: str) -> tuple[bool, str]:
    ok, error = register_hotkey_binding("text.send_current", hotkey, trigger_configured_send)
    if not ok:
        message = f"send hotkey register failed: {error}"
        set_last_error(message)
        with state_lock:
            runtime_state["send_hotkey_registered"] = False
            runtime_state["send_hotkey"] = hotkey
        return False, message

    with state_lock:
        runtime_state["send_hotkey_registered"] = True
        runtime_state["send_hotkey"] = hotkey
    clear_last_error()
    return True, ""


def register_app_toggle_hotkey(hotkey: str) -> tuple[bool, str]:
    # App toggle runs on key release to avoid key-hold auto-repeat loops.
    ok, error = register_action_hotkey(ACTION_APP_TOGGLE, hotkey, suppress=False, trigger_on_release=True)
    if not ok:
        message = f"{ACTION_APP_TOGGLE} hotkey register failed: {error}"
        set_last_error(message)
        with state_lock:
            runtime_state["app_toggle_registered"] = False
            runtime_state["app_toggle_hotkey"] = hotkey
        return False, message

    with state_lock:
        runtime_state["app_toggle_registered"] = True
        runtime_state["app_toggle_hotkey"] = hotkey
    clear_last_error()
    return True, ""


def disable_non_toggle_runtime_hotkeys() -> None:
    unregister_hotkey_binding("text.send_current")
    unregister_hotkey_binding(ACTION_OVERLAY_TOGGLE)
    unregister_hotkey_binding(ACTION_MAIN_TOGGLE)
    unregister_hotkey_binding(ACTION_OVERLAY_EDIT)
    with state_lock:
        runtime_state["send_hotkey_registered"] = False
        runtime_state["overlay_toggle_registered"] = False
        runtime_state["main_toggle_registered"] = False
        runtime_state["overlay_edit_registered"] = False


def trigger_action_hotkey(action_id: str) -> None:
    if action_id == ACTION_APP_TOGGLE:
        with state_lock:
            last_map = runtime_state.get("last_action_trigger_at")
            if not isinstance(last_map, dict):
                last_map = {}
                runtime_state["last_action_trigger_at"] = last_map

            last_trigger = float(last_map.get(action_id, 0.0))
            now = time.monotonic()
            if now - last_trigger < APP_TOGGLE_ACTION_HOTKEY_DEBOUNCE_MS / 1000:
                return
            last_map[action_id] = now

            next_enabled = not bool(runtime_state.get("app_enabled", True))
            runtime_state["app_enabled"] = next_enabled
            send_config["app_enabled"] = next_enabled
            send_hotkey = str(send_config.get("send_hotkey", DEFAULT_SEND_HOTKEY))
            overlay_toggle_hotkey = str(send_config.get("overlay_toggle_hotkey", DEFAULT_OVERLAY_TOGGLE_HOTKEY))
            main_toggle_hotkey = str(send_config.get("main_toggle_hotkey", DEFAULT_MAIN_TOGGLE_HOTKEY))
            overlay_edit_hotkey = str(send_config.get("overlay_edit_hotkey", DEFAULT_OVERLAY_EDIT_HOTKEY))

        if next_enabled:
            ok, message = register_send_hotkey(send_hotkey)
            if not ok:
                set_last_error(message)
            ok, message = register_overlay_mode_hotkeys(
                overlay_toggle_hotkey,
                main_toggle_hotkey,
                overlay_edit_hotkey,
            )
            if not ok:
                set_last_error(message)
        else:
            disable_non_toggle_runtime_hotkeys()

        add_event("action", action=action_id)
        return

    with state_lock:
        if not bool(runtime_state.get("app_enabled", True)):
            return
        last_map = runtime_state.get("last_action_trigger_at")
        if not isinstance(last_map, dict):
            last_map = {}
            runtime_state["last_action_trigger_at"] = last_map

        last_trigger = float(last_map.get(action_id, 0.0))
        now = time.monotonic()
        if now - last_trigger < DEFAULT_ACTION_HOTKEY_DEBOUNCE_MS / 1000:
            return
        last_map[action_id] = now

    add_event("action", action=action_id)


def register_action_hotkey(
    action_id: str,
    hotkey: str,
    suppress: bool = True,
    trigger_on_release: bool = False,
) -> tuple[bool, str]:
    def callback() -> None:
        trigger_action_hotkey(action_id)

    ok, error = register_hotkey_binding(
        action_id,
        hotkey,
        callback,
        suppress=suppress,
        trigger_on_release=trigger_on_release,
    )
    if not ok:
        message = f"{action_id} hotkey register failed: {error}"
        set_last_error(message)
        return False, message
    return True, ""


def register_overlay_mode_hotkeys(
    overlay_toggle_hotkey: str,
    main_toggle_hotkey: str,
    overlay_edit_hotkey: str,
) -> tuple[bool, str]:
    registration_plan = [
        (ACTION_OVERLAY_TOGGLE, overlay_toggle_hotkey, "overlay_toggle_registered", "overlay_toggle_hotkey"),
        (ACTION_MAIN_TOGGLE, main_toggle_hotkey, "main_toggle_registered", "main_toggle_hotkey"),
        (ACTION_OVERLAY_EDIT, overlay_edit_hotkey, "overlay_edit_registered", "overlay_edit_hotkey"),
    ]

    for action_id, hotkey, registered_key, hotkey_key in registration_plan:
        ok, message = register_action_hotkey(action_id, hotkey)
        if not ok:
            with state_lock:
                runtime_state[registered_key] = False
                runtime_state[hotkey_key] = hotkey
            return False, message
        with state_lock:
            runtime_state[registered_key] = True
            runtime_state[hotkey_key] = hotkey

    clear_last_error()
    return True, ""


def add_event(event_type: str, delta: int = 0, action: str = "") -> None:
    global event_id
    with events_lock:
        event_id += 1
        payload: dict[str, Any] = {"id": event_id, "type": event_type}
        if event_type == "wheel":
            payload["delta"] = int(delta)
        elif event_type == "action":
            payload["action"] = action
        events.append(payload)
        if len(events) > MAX_EVENTS:
            del events[: len(events) - MAX_EVENTS]


def on_scroll(_x: int, _y: int, _dx: int, dy: int) -> None:
    if dy == 0 or keyboard_lib is None:
        return

    try:
        with state_lock:
            if not bool(runtime_state.get("app_enabled", True)):
                return
        if keyboard_lib.is_pressed("shift"):
            delta = -1 if dy > 0 else 1
            add_event("wheel", delta)
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        set_last_error(f"wheel listener error: {exc}")


def start_input_listener() -> None:
    if mouse_lib is None:
        set_last_error("wheel listener unavailable: pynput not loaded")
        return

    try:
        listener = mouse_lib.Listener(on_scroll=on_scroll)
        listener.daemon = True
        listener.start()
        with state_lock:
            runtime_state["listener_running"] = True
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        set_last_error(f"wheel listener start failed: {exc}")
        with state_lock:
            runtime_state["listener_running"] = False


@app.get("/health")
def health():
    with state_lock:
        status = dict(runtime_state)
    return jsonify({"ok": True, **status})


@app.post("/configure")
def configure():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "payload must be object"}), 400

    with state_lock:
        next_text = str(send_config["text"])
        next_hotkey = str(send_config["send_hotkey"])
        next_app_toggle_hotkey = str(send_config["app_toggle_hotkey"])
        next_app_enabled = bool(send_config["app_enabled"])
        next_overlay_toggle_hotkey = str(send_config["overlay_toggle_hotkey"])
        next_main_toggle_hotkey = str(send_config["main_toggle_hotkey"])
        next_overlay_edit_hotkey = str(send_config["overlay_edit_hotkey"])
        next_delay = tuple(send_config["delay_range"])
        next_press_enter = bool(send_config["press_enter"])
        next_hotkey_debounce_ms = int(send_config["hotkey_debounce_ms"])

    try:
        if "text" in data:
            next_text = str(data.get("text", ""))
        if "hotkey" in data:
            next_hotkey = parse_hotkey(data.get("hotkey"), next_hotkey)
        if "app_toggle_hotkey" in data:
            next_app_toggle_hotkey = parse_hotkey(data.get("app_toggle_hotkey"), next_app_toggle_hotkey)
        if "app_enabled" in data:
            next_app_enabled = parse_boolean_flag(data.get("app_enabled"), next_app_enabled, "app_enabled")
        if "overlay_toggle_hotkey" in data:
            next_overlay_toggle_hotkey = parse_hotkey(data.get("overlay_toggle_hotkey"), next_overlay_toggle_hotkey)
        if "main_toggle_hotkey" in data:
            next_main_toggle_hotkey = parse_hotkey(data.get("main_toggle_hotkey"), next_main_toggle_hotkey)
        if "overlay_edit_hotkey" in data:
            next_overlay_edit_hotkey = parse_hotkey(data.get("overlay_edit_hotkey"), next_overlay_edit_hotkey)
        if "delay_range" in data:
            next_delay = parse_delay_range(data.get("delay_range"))
        if "press_enter" in data:
            next_press_enter = parse_press_enter(data.get("press_enter"), next_press_enter)
        if "hotkey_debounce_ms" in data:
            next_hotkey_debounce_ms = parse_hotkey_debounce_ms(data.get("hotkey_debounce_ms"), next_hotkey_debounce_ms)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    warmup_2beolsik_cache(next_text)

    with state_lock:
        send_config["text"] = next_text
        send_config["send_hotkey"] = next_hotkey
        send_config["app_toggle_hotkey"] = next_app_toggle_hotkey
        send_config["app_enabled"] = next_app_enabled
        send_config["overlay_toggle_hotkey"] = next_overlay_toggle_hotkey
        send_config["main_toggle_hotkey"] = next_main_toggle_hotkey
        send_config["overlay_edit_hotkey"] = next_overlay_edit_hotkey
        send_config["delay_range"] = next_delay
        send_config["press_enter"] = next_press_enter
        send_config["hotkey_debounce_ms"] = next_hotkey_debounce_ms
        runtime_state["configured_text_length"] = len(next_text.strip())
        runtime_state["press_enter"] = next_press_enter
        runtime_state["hotkey_debounce_ms"] = next_hotkey_debounce_ms
        runtime_state["app_toggle_hotkey"] = next_app_toggle_hotkey
        runtime_state["app_enabled"] = next_app_enabled
        runtime_state["overlay_toggle_hotkey"] = next_overlay_toggle_hotkey
        runtime_state["main_toggle_hotkey"] = next_main_toggle_hotkey
        runtime_state["overlay_edit_hotkey"] = next_overlay_edit_hotkey

    with state_lock:
        app_enabled_now = bool(next_app_enabled)
        # Keep app-toggle binding stable across app_enabled flips to preserve latch state
        # and avoid repeated toggles while the key is still physically held.
        need_register_app_toggle = bool(
            "app_toggle_hotkey" in data
            or not runtime_state["app_toggle_registered"]
        )
        need_register_send = app_enabled_now and bool(
            "hotkey" in data
            or "app_enabled" in data
            or not runtime_state["send_hotkey_registered"]
        )
        need_register_overlay_actions = app_enabled_now and bool(
            "overlay_toggle_hotkey" in data
            or "main_toggle_hotkey" in data
            or "overlay_edit_hotkey" in data
            or "app_enabled" in data
            or not runtime_state["overlay_toggle_registered"]
            or not runtime_state["main_toggle_registered"]
            or not runtime_state["overlay_edit_registered"]
        )
        need_disable_non_toggle_hotkeys = (not app_enabled_now) and bool(
            "app_enabled" in data
            or runtime_state["send_hotkey_registered"]
            or runtime_state["overlay_toggle_registered"]
            or runtime_state["main_toggle_registered"]
            or runtime_state["overlay_edit_registered"]
        )

    if need_register_app_toggle:
        ok, message = register_app_toggle_hotkey(next_app_toggle_hotkey)
        if not ok:
            return jsonify({"ok": False, "error": message}), 500

    if need_disable_non_toggle_hotkeys:
        disable_non_toggle_runtime_hotkeys()

    if need_register_send:
        ok, message = register_send_hotkey(next_hotkey)
        if not ok:
            return jsonify({"ok": False, "error": message}), 500

    if need_register_overlay_actions:
        ok, message = register_overlay_mode_hotkeys(
            next_overlay_toggle_hotkey,
            next_main_toggle_hotkey,
            next_overlay_edit_hotkey,
        )
        if not ok:
            return jsonify({"ok": False, "error": message}), 500

    return jsonify(
        {
            "ok": True,
            "send_hotkey": next_hotkey,
            "app_toggle_hotkey": next_app_toggle_hotkey,
            "app_enabled": next_app_enabled,
            "overlay_toggle_hotkey": next_overlay_toggle_hotkey,
            "main_toggle_hotkey": next_main_toggle_hotkey,
            "overlay_edit_hotkey": next_overlay_edit_hotkey,
            "configured_text_length": len(next_text.strip()),
            "press_enter": next_press_enter,
            "hotkey_debounce_ms": next_hotkey_debounce_ms,
        }
    )


@app.post("/send")
def send():
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()

    if not text:
        return jsonify({"ok": False, "error": "text is empty"}), 400

    if keyboard_lib is None:
        message = "keyboard module unavailable"
        if KEYBOARD_IMPORT_ERROR:
            message = f"{message}: {KEYBOARD_IMPORT_ERROR}"
        set_last_error(message)
        return jsonify({"ok": False, "error": message}), 503

    try:
        delay_range = parse_delay_range(data.get("delay_range"))
        press_enter = parse_press_enter(data.get("press_enter"), DEFAULT_PRESS_ENTER)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    ok = start_async_send(text, delay_range, press_enter)
    if not ok:
        return jsonify({"ok": False, "error": "send thread failed"}), 500

    return jsonify({"ok": True})


@app.get("/events")
def get_events():
    after = request.args.get("after", "0")
    try:
        after_id = int(after)
    except ValueError:
        return jsonify({"ok": False, "error": "after must be integer"}), 400

    with events_lock:
        filtered = [event for event in events if event["id"] > after_id]
        last_id = event_id

    return jsonify({"ok": True, "events": filtered, "last_id": last_id})


if __name__ == "__main__":
    start_input_listener()
    register_app_toggle_hotkey(DEFAULT_APP_TOGGLE_HOTKEY)
    register_send_hotkey(DEFAULT_SEND_HOTKEY)
    register_overlay_mode_hotkeys(
        DEFAULT_OVERLAY_TOGGLE_HOTKEY,
        DEFAULT_MAIN_TOGGLE_HOTKEY,
        DEFAULT_OVERLAY_EDIT_HOTKEY,
    )
    app.run(host="127.0.0.1", port=5000, debug=False)
