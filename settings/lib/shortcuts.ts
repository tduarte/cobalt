import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib"
import { evalLua, saveLua, SETTINGS_DIR } from "./hypr"

// Keyboard shortcuts: Hyprland's bind registry (written by hyprland.lua to
// $XDG_RUNTIME_DIR/cobalt/binds.json) plus the user's changes, kept in
// settings/binds.json and turned into settings/binds.lua, which hyprland.lua
// reads before binding. Changes apply live through cobalt.rebind().

export type Shortcut = {
  id: string
  category: string
  name: string
  default: string
  // Current keys in Hyprland's syntax ("SUPER + SHIFT + E"), null = disabled
  keys: string | null
}

export type Custom = { name: string; command: string; keys: string }

type State = { overrides: Record<string, string | false>; custom: Custom[] }

const STATE_FILE = GLib.build_filenamev([SETTINGS_DIR, "binds.json"])
const decoder = new TextDecoder()

function readJson<T>(path: string, fallback: T): T {
  try {
    const [, data] = GLib.file_get_contents(path)
    return JSON.parse(decoder.decode(data)) as T
  } catch {
    return fallback
  }
}

export function loadState(): State {
  return readJson<State>(STATE_FILE, { overrides: {}, custom: [] })
}

function luaString(s: string) {
  return JSON.stringify(s)
}

function saveState(state: State) {
  GLib.mkdir_with_parents(SETTINGS_DIR, 0o755)
  GLib.file_set_contents(STATE_FILE, JSON.stringify(state, null, 2))
  const entries = Object.entries(state.overrides).map(
    ([id, keys]) => `  [${luaString(id)}] = ${keys === false ? "false" : luaString(keys)},`,
  )
  const custom = state.custom.map(
    (c) => `    { name = ${luaString(c.name)}, command = ${luaString(c.command)}, keys = ${luaString(c.keys)} },`,
  )
  saveLua("binds", "Keyboard shortcuts", `return {\n${entries.join("\n")}\n  custom = {\n${custom.join("\n")}\n  },\n}`)
}

export function shortcuts(): Shortcut[] {
  const path = GLib.build_filenamev([GLib.get_user_runtime_dir(), "cobalt", "binds.json"])
  const rows = readJson<{ id: string; desc: string; name: string; default: string; keys: string | null }[]>(path, [])
  return rows.map((r) => {
    const [category, label] = r.desc.includes(": ") ? (r.desc.split(/: (.*)/s) as [string, string]) : ["Other", r.desc]
    return { id: r.id, category, name: r.name || label, default: r.default, keys: r.keys }
  })
}

// Change one shortcut (null = disable), live and for next login
export function setShortcut(s: Shortcut, keys: string | null) {
  const state = loadState()
  if (keys === s.default) delete state.overrides[s.id]
  else state.overrides[s.id] = keys ?? false
  saveState(state)
  s.keys = keys
  return evalLua(`cobalt.rebind(${luaString(s.id)}, ${keys ? luaString(keys) : "false"})`)
}

export function setCustom(custom: Custom[]) {
  const state = loadState()
  state.custom = custom
  saveState(state)
  const list = custom
    .map((c) => `{ name = ${luaString(c.name)}, command = ${luaString(c.command)}, keys = ${luaString(c.keys)} }`)
    .join(", ")
  return evalLua(`cobalt.set_custom({ ${list} })`)
}

// Everything back to the defaults
export async function resetAll(all: Shortcut[]) {
  const state = loadState()
  const changed = all.filter((s) => s.keys !== s.default)
  state.overrides = {}
  saveState(state)
  for (const s of changed) {
    s.keys = s.default
    await evalLua(`cobalt.rebind(${luaString(s.id)}, ${luaString(s.default)})`)
  }
}

// ---- Key names ----

const MOD_LABELS: Record<string, string> = { SUPER: "Super", SHIFT: "Shift", CTRL: "Ctrl", CONTROL: "Ctrl", ALT: "Alt" }
const KEY_LABELS: Record<string, string> = {
  SUPER_L: "Super",
  Return: "Enter",
  space: "Space",
  slash: "/",
  grave: "`",
  Page_Up: "Page Up",
  Page_Down: "Page Down",
  Print: "Print",
}

// "SUPER + SHIFT + E" → "Super+Shift+E", like GNOME shows them
export function keysLabel(keys: string | null) {
  if (!keys) return "Disabled"
  const parts = keys.split("+").map((p) => p.trim())
  const out = parts.map((p, i) => (i < parts.length - 1 ? MOD_LABELS[p.toUpperCase()] ?? p : KEY_LABELS[p] ?? (p.length === 1 ? p.toUpperCase() : p)))
  // "SUPER + SUPER_L" is just Super
  return [...new Set(out)].join("+")
}

// A key press from the "Set Shortcut" dialog → Hyprland's syntax, or null
// for a lone modifier. Uses the unshifted key (Shift+1 is "1", not "!").
export function keysFromEvent(keycode: number, state: Gdk.ModifierType): string | null {
  const display = Gdk.Display.get_default()!
  const [ok, keyval] = display.translate_key(keycode, 0, 0)
  if (!ok) return null
  let name = Gdk.keyval_name(keyval)
  if (!name || /^(Shift|Control|Alt|Super|Meta|Hyper|ISO_Level3)_/.test(name) || name === "Caps_Lock") return null
  if (name.length === 1) name = name.toUpperCase()
  const mods: string[] = []
  if (state & Gdk.ModifierType.SUPER_MASK) mods.push("SUPER")
  if (state & Gdk.ModifierType.CONTROL_MASK) mods.push("CTRL")
  if (state & Gdk.ModifierType.ALT_MASK) mods.push("ALT")
  if (state & Gdk.ModifierType.SHIFT_MASK) mods.push("SHIFT")
  return [...mods, name].join(" + ")
}

// Same keys regardless of modifier order or case
export function sameKeys(a: string | null, b: string | null) {
  const norm = (k: string) =>
    k
      .split("+")
      .map((p) => p.trim().toUpperCase().replace(/^CONTROL$/, "CTRL"))
      .sort()
      .join("+")
  return !!a && !!b && norm(a) === norm(b)
}
