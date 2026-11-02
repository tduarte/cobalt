import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { group, navRow, page, prefsPage, setRows } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Privacy & Security: Screen Lock (cobalt-idle follows the
// keys), Location / Camera / Microphone (global switch: GNOME's keys, which
// the GNOME Lockdown portal enforces; per app: Flatpak's permission store),
// File History & Trash (gnome-settings-daemon's housekeeping plugin acts on
// the keys). Device Security, Thunderbolt and problem reporting are descoped.

const session = new Gio.Settings({ schemaId: "org.gnome.desktop.session" })
const screensaver = new Gio.Settings({ schemaId: "org.gnome.desktop.screensaver" })
const privacy = new Gio.Settings({ schemaId: "org.gnome.desktop.privacy" })
const location = new Gio.Settings({ schemaId: "org.gnome.system.location" })

function comboRow<T>(title: string, options: [T, string][], current: T, onChange: (v: T) => void) {
  const row = new Adw.ComboRow({ title, model: Gtk.StringList.new(options.map(([, l]) => l)) })
  row.selected = Math.max(0, options.findIndex(([v]) => v === current))
  row.connect("notify::selected", () => onChange(options[row.selected][0]))
  return row
}

// ---- Permission store (xdg-desktop-portal's per-app grants) ----

type Grants = Record<string, string[]>

function store(method: string, params: GLib.Variant, reply: string | null) {
  return Gio.DBus.session.call_sync(
    "org.freedesktop.impl.portal.PermissionStore",
    "/org/freedesktop/impl/portal/PermissionStore",
    "org.freedesktop.impl.portal.PermissionStore",
    method,
    params,
    reply ? new GLib.VariantType(reply) : null,
    Gio.DBusCallFlags.NONE,
    -1,
    null,
  )
}

function grants(table: string, id: string): Grants {
  try {
    const [perms] = store("Lookup", new GLib.Variant("(ss)", [table, id]), "(a{sas}v)").deepUnpack() as [Grants, unknown]
    return perms
  } catch {
    return {} // no app has asked yet
  }
}

function setGrant(table: string, id: string, app: string, value: string[]) {
  store("SetPermission", new GLib.Variant("(sbssas)", [table, true, id, app, value]), null)
}

function appName(appId: string) {
  const info = Gio.DesktopAppInfo.new(`${appId}.desktop`)
  return { name: info?.get_display_name() ?? appId, icon: info?.get_icon() ?? null }
}

// Location, Camera, Microphone: a switch, then the apps that asked
function devicePage(opts: {
  title: string
  description: string
  table: string
  id: string
  enabled: () => boolean
  setEnabled: (on: boolean) => void
  allowed: (perm: string[]) => boolean
  grant: (on: boolean) => string[]
}) {
  const top = group("", opts.description)
  const toggle = new Adw.SwitchRow({ title: opts.title, active: opts.enabled() })
  top.add(toggle)
  const apps = group("Apps", "")
  let rows: Gtk.Widget[] = []
  const render = () => {
    const perms = grants(opts.table, opts.id)
    const ids = Object.keys(perms).sort()
    rows = setRows(
      apps,
      ids.map((appId) => {
        const { name, icon } = appName(appId)
        const row = new Adw.SwitchRow({ title: GLib.markup_escape_text(name, -1), active: opts.allowed(perms[appId]) })
        if (icon) row.add_prefix(new Gtk.Image({ gicon: icon, pixelSize: 32 }))
        row.connect("notify::active", () => setGrant(opts.table, opts.id, appId, opts.grant(row.active)))
        return row
      }),
      rows,
    )
    apps.description = ids.length ? "" : "No sandboxed apps have asked for access yet"
    apps.sensitive = toggle.active
  }
  toggle.connect("notify::active", () => {
    opts.setEnabled(toggle.active)
    apps.sensitive = toggle.active
  })
  render()
  return page({ title: opts.title, content: prefsPage(top, apps) })
}

const locationPage = () =>
  devicePage({
    title: "Location",
    description: "Location services allow apps to know your location. Using Wi-Fi and mobile broadband increases accuracy.",
    table: "location",
    id: "location",
    enabled: () => location.get_boolean("enabled"),
    setEnabled: (on) => location.set_boolean("enabled", on),
    allowed: (perm) => perm[0] !== "NONE",
    grant: (on) => [on ? "EXACT" : "NONE", "0"],
  })

const cameraPage = () =>
  devicePage({
    title: "Camera",
    description: "Apps can use the camera to take photos and record video.",
    table: "devices",
    id: "camera",
    enabled: () => !privacy.get_boolean("disable-camera"),
    setEnabled: (on) => privacy.set_boolean("disable-camera", !on),
    allowed: (perm) => perm[0] === "yes",
    grant: (on) => [on ? "yes" : "no"],
  })

const microphonePage = () =>
  devicePage({
    title: "Microphone",
    description: "Apps can use the microphone to record sound and take part in calls.",
    table: "devices",
    id: "microphone",
    enabled: () => !privacy.get_boolean("disable-microphone"),
    setEnabled: (on) => privacy.set_boolean("disable-microphone", !on),
    allowed: (perm) => perm[0] === "yes",
    grant: (on) => [on ? "yes" : "no"],
  })

// ---- Screen Lock ----

const BLANK: [number, string][] = [
  [60, "1 minute"],
  [120, "2 minutes"],
  [180, "3 minutes"],
  [240, "4 minutes"],
  [300, "5 minutes"],
  [480, "8 minutes"],
  [600, "10 minutes"],
  [720, "12 minutes"],
  [900, "15 minutes"],
  [0, "Never"],
]

const LOCK_DELAY: [number, string][] = [
  [0, "Screen Turns Off"],
  [30, "30 seconds"],
  [60, "1 minute"],
  [120, "2 minutes"],
  [180, "3 minutes"],
  [300, "5 minutes"],
  [1800, "30 minutes"],
  [3600, "1 hour"],
]

function screenLockPage() {
  const g = group("", "Automatically lock the screen when the screen turns off, after a period of inactivity")
  g.add(comboRow("Blank Screen Delay", BLANK, session.get_uint("idle-delay"), (v) => session.set_uint("idle-delay", v)))
  const auto = new Adw.SwitchRow({ title: "Automatic Screen Lock" })
  screensaver.bind("lock-enabled", auto, "active", Gio.SettingsBindFlags.DEFAULT)
  const delay = comboRow("Automatic Screen Lock Delay", LOCK_DELAY, screensaver.get_uint("lock-delay"), (v) =>
    screensaver.set_uint("lock-delay", v),
  )
  auto.bind_property("active", delay, "sensitive", 2 /* SYNC_CREATE */)
  g.add(auto)
  g.add(delay)
  return page({ title: "Screen Lock", content: prefsPage(g) })
}

// ---- File History & Trash ----

const HISTORY: [number, string][] = [
  [1, "1 day"],
  [7, "7 days"],
  [30, "30 days"],
  [-1, "Forever"],
]
const AGE: [number, string][] = [1, 2, 3, 4, 5, 6, 7, 14, 30].map((d) => [d, d === 1 ? "1 day" : `${d} days`])

function confirm(parent: Gtk.Widget, heading: string, body: string, action: string, run: () => void) {
  const alert = new Adw.AlertDialog({ heading, body })
  alert.add_response("cancel", "_Cancel")
  alert.add_response("ok", action)
  alert.set_response_appearance("ok", Adw.ResponseAppearance.DESTRUCTIVE)
  alert.connect("response", (_, id: string) => id === "ok" && run())
  alert.present(parent)
}

function historyPage() {
  const history = group("File History", "File history keeps a record of files that you have used. This information is shared between apps.")
  const remember = new Adw.SwitchRow({ title: "File History" })
  privacy.bind("remember-recent-files", remember, "active", Gio.SettingsBindFlags.DEFAULT)
  const duration = comboRow("File History Duration", HISTORY, privacy.get_int("recent-files-max-age"), (v) =>
    privacy.set_int("recent-files-max-age", v),
  )
  remember.bind_property("active", duration, "sensitive", 2)
  const clear = new Adw.ButtonRow({ title: "Clear History…" })
  clear.connect("activated", () =>
    confirm(clear, "Clear File History?", "All recently used files will be forgotten.", "_Clear", () =>
      Gtk.RecentManager.get_default().purge_items(),
    ),
  )
  history.add(remember)
  history.add(duration)
  history.add(clear)

  const trash = group("Trash & Temporary Files", "Trash and temporary files can sometimes include personal or sensitive information.")
  const delTrash = new Adw.SwitchRow({ title: "Automatically Delete Trash Content" })
  privacy.bind("remove-old-trash-files", delTrash, "active", Gio.SettingsBindFlags.DEFAULT)
  const delTemp = new Adw.SwitchRow({ title: "Automatically Delete Temporary Files" })
  privacy.bind("remove-old-temp-files", delTemp, "active", Gio.SettingsBindFlags.DEFAULT)
  const period = comboRow("Automatically Delete Period", AGE, privacy.get_uint("old-files-age"), (v) =>
    privacy.set_uint("old-files-age", v),
  )
  const empty = new Adw.ButtonRow({ title: "Empty Trash…" })
  empty.add_css_class("destructive-action")
  empty.connect("activated", () =>
    confirm(empty, "Empty Trash?", "All items in the Trash will be permanently deleted.", "_Empty Trash", () =>
      Gio.Subprocess.new(["gio", "trash", "--empty"], Gio.SubprocessFlags.NONE),
    ),
  )
  for (const r of [delTrash, delTemp, period, empty]) trash.add(r)
  return page({ title: "File History & Trash", content: prefsPage(history, trash) })
}

// ---- The page ----

export default function PrivacyPage(ctx: PageContext) {
  const lock = group()
  const lockRow = navRow("Screen Lock", () => ctx.push(screenLockPage))
  lockRow.subtitle = "Automatic screen lock"
  lockRow.add_prefix(new Gtk.Image({ iconName: "org.gnome.Settings-screen-lock-symbolic" }))
  lock.add(lockRow)

  const devices = group()
  const items: [string, string, string, () => Adw.NavigationPage][] = [
    ["Location", "Control which apps can see your location", "org.gnome.Settings-location-access-symbolic", locationPage],
    ["Camera", "Control which apps can use your camera", "org.gnome.Settings-camera-access-symbolic", cameraPage],
    ["Microphone", "Control which apps can use your microphone", "org.gnome.Settings-microphone-access-symbolic", microphonePage],
  ]
  for (const [title, subtitle, icon, build] of items) {
    const row = navRow(title, () => ctx.push(build))
    row.subtitle = subtitle
    row.add_prefix(new Gtk.Image({ iconName: icon }))
    devices.add(row)
  }

  const files = group()
  const filesRow = navRow("File History & Trash", () => ctx.push(historyPage))
  filesRow.subtitle = "Recent files and automatic cleanup"
  filesRow.add_prefix(new Gtk.Image({ iconName: "org.gnome.Settings-trash-file-history-symbolic" }))
  files.add(filesRow)

  ctx.action("screen-lock", () => ctx.push(screenLockPage))
  ctx.action("location", () => ctx.push(locationPage))
  ctx.action("history", () => ctx.push(historyPage))
  return page({ title: "Privacy & Security", content: prefsPage(lock, devices, files) })
}
