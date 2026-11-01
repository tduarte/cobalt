import Gio from "gi://Gio"
import AstalHyprland from "gi://AstalHyprland"
import { execAsync } from "ags/process"

// Hyprland 0.55+ dispatches Lua expressions (hl.dsp.*), so send them as raw
// IPC messages instead of AstalHyprland's legacy `dispatch(name, args)`.
export function hyprDispatch(lua: string) {
  AstalHyprland.get_default().message_async(`dispatch ${lua}`, null)
}

export function focusWorkspace(id: number) {
  hyprDispatch(`hl.dsp.focus({ workspace = ${id} })`)
}

// Run a shell command line (pipes, ||) without blocking the shell
export function sh(cmd: string) {
  execAsync(["sh", "-c", cmd]).catch((err) => console.error(cmd, err))
}

export const power = {
  lock: () => sh("loginctl lock-session"),
  suspend: () => sh("systemctl suspend"),
  restart: () => sh("systemctl reboot"),
  powerOff: () => sh("systemctl poweroff"),
  logOut: () => hyprDispatch("hl.dsp.exit()"),
}

// GNOME's interface settings: the Settings app (M5) writes the same keys, and
// libadwaita apps follow them through the settings portal.
export const interfaceSettings = new Gio.Settings({
  schema_id: "org.gnome.desktop.interface",
})
