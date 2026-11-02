import Gio from "gi://Gio"
import GLib from "gi://GLib"

// Hyprland settings the Settings app owns: applied live with `hyprctl eval`
// and saved to ~/.config/cobalt/settings/<name>.lua, which hyprland.lua loads
// on start (before ~/.config/cobalt/hyprland.lua, so personal overrides win).

Gio._promisify(Gio.Subprocess.prototype, "communicate_utf8_async", "communicate_utf8_finish")

export const SETTINGS_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), "cobalt", "settings"])

export async function hyprctl(...args: string[]): Promise<string> {
  const proc = Gio.Subprocess.new(["hyprctl", ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE)
  const [out] = (await proc.communicate_utf8_async(null, null)) as unknown as [string, string]
  return out ?? ""
}

export async function hyprJson<T>(...args: string[]): Promise<T> {
  return JSON.parse(await hyprctl("-j", ...args)) as T
}

// Run Lua in the running Hyprland
export function evalLua(lua: string) {
  return hyprctl("eval", lua)
}

export function saveLua(name: string, header: string, lua: string) {
  GLib.mkdir_with_parents(SETTINGS_DIR, 0o755)
  const text = `-- ${header}\n-- Written by the Settings app; changes here are overwritten.\n\n${lua}\n`
  GLib.file_set_contents(GLib.build_filenamev([SETTINGS_DIR, `${name}.lua`]), text)
}

// Lua literal for a JS value (strings, numbers, booleans, flat tables)
export function lua(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k} = ${lua(v)}`)
    return `{ ${parts.join(", ")} }`
  }
  return "nil"
}
