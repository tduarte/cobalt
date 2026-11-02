import Gio from "gi://Gio"
import GLib from "gi://GLib"
import AstalApps from "gi://AstalApps"
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

// Start an app in its own systemd scope, like GNOME, so it isn't part of the
// shell's service: restarting the shell never takes apps down with it
export function launchApp(app: AstalApps.Application) {
  const file = (app.app as Gio.DesktopAppInfo).get_filename()
  if (!file || !GLib.find_program_in_path("systemd-run")) {
    app.launch()
    return
  }
  const id = (app.entry || "app").replace(/\.desktop$/, "").replace(/[^A-Za-z0-9_.-]/g, "_")
  const unit = `app-cobalt-${id}-${GLib.random_int_range(0, 1 << 30)}.scope`
  execAsync([
    "systemd-run", "--user", "--scope", "--quiet", "--collect",
    "--slice=app-graphical.slice", `--unit=${unit}`, "gio", "launch", file,
  ]).catch((err) => {
    console.error(`launch ${app.entry}`, err)
    app.launch()
  })
}

// Open a page of the Settings app (in its own scope, like any app)
export function openSettings(page = "") {
  sh(`systemd-run --user --scope --quiet --collect --slice=app-graphical.slice cobalt-settings ${page}`)
}

// A systemd user unit the shell toggles (Night Light, Caffeine). Its state
// lives in systemd, so it survives shell restarts.
export const userUnit = {
  isActive: (unit: string) =>
    execAsync(["systemctl", "--user", "is-active", unit]).then(
      (out) => out.trim() === "active",
      () => false,
    ),
  start: (unit: string) => execAsync(["systemctl", "--user", "start", unit]),
  stop: (unit: string) => execAsync(["systemctl", "--user", "stop", unit]),
}

// Restart, Power Off and Log Out go through the end session dialog
// (widget/EndSession.tsx)
export const power = {
  lock: () => sh("loginctl lock-session"),
  suspend: () => sh("systemctl suspend"),
}

// GNOME's interface settings: the Settings app (M5) writes the same keys, and
// libadwaita apps follow them through the settings portal.
export const interfaceSettings = new Gio.Settings({
  schema_id: "org.gnome.desktop.interface",
})
