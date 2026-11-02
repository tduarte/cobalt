import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { dialog, dialogBox, group, page, prefsPage, setRows, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Notifications: Do Not Disturb and per-app switches, on
// GNOME's keys; the shell honors them (shell/lib/notifications.ts). No lock
// screen options: hyprlock doesn't show notifications.

const settings = new Gio.Settings({ schemaId: "org.gnome.desktop.notifications" })
const APP_SCHEMA = "org.gnome.desktop.notifications.application"

// Same canonical id as GNOME Settings/Shell (and our shell)
function canonicalAppId(desktopId: string) {
  return desktopId
    .replace(/\.desktop$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
}

function appSettings(id: string) {
  return new Gio.Settings({ schemaId: APP_SCHEMA, path: `/org/gnome/desktop/notifications/application/${id}/` })
}

type AppEntry = { id: string; info: Gio.DesktopAppInfo }

// Apps that declare they notify, plus apps that have notified (the shell
// adds those to application-children), like GNOME
function notifyingApps(): AppEntry[] {
  const byId = new Map<string, AppEntry>()
  for (const info of Gio.AppInfo.get_all() as Gio.DesktopAppInfo[]) {
    if (!info.should_show() || !info.get_id()) continue
    if (info.get_boolean("X-GNOME-UsesNotifications")) byId.set(canonicalAppId(info.get_id()!), { id: canonicalAppId(info.get_id()!), info })
  }
  for (const child of settings.get_strv("application-children")) {
    if (byId.has(child)) continue
    const desktop = appSettings(child).get_string("application-id")
    const info = desktop ? Gio.DesktopAppInfo.new(desktop) : null
    if (info) byId.set(child, { id: child, info })
  }
  return [...byId.values()].sort((a, b) => a.info.get_display_name().localeCompare(b.info.get_display_name()))
}

function appDialog(parent: Gtk.Widget, entry: AppEntry, onClosed: () => void) {
  const s = appSettings(entry.id)
  if (!s.get_string("application-id")) s.set_string("application-id", entry.info.get_id()!)
  const g = new Adw.PreferencesGroup()
  const rows: [string, string][] = [
    ["enable", "Notifications"],
    ["enable-sound-alerts", "Sound Alerts"],
    ["show-banners", "Notification Popups"],
  ]
  const switches = rows.map(([key, title]) => {
    const row = new Adw.SwitchRow({ title })
    s.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT)
    g.add(row)
    return row
  })
  // The rest only matter when notifications are on
  const sync = () => switches.slice(1).forEach((r) => (r.sensitive = switches[0].active))
  switches[0].connect("notify::active", sync)
  sync()
  const dlg = dialog({ title: entry.info.get_display_name(), content: dialogBox(g), width: 440 })
  dlg.connect("closed", onClosed)
  dlg.present(parent)
}

export default function NotificationsPage(_ctx: PageContext) {
  const top = group()
  const dnd = new Adw.SwitchRow({ title: "Do Not Disturb" })
  // Do Not Disturb = banners off
  settings.bind("show-banners", dnd, "active", Gio.SettingsBindFlags.INVERT_BOOLEAN)
  top.add(dnd)

  const appsGroup = group("Apps")
  let rows: Gtk.Widget[] = []
  const render = () => {
    const apps = notifyingApps()
    rows = setRows(
      appsGroup,
      apps.map((entry) => {
        const row = new Adw.ActionRow({ title: GLib.markup_escape_text(entry.info.get_display_name(), -1), activatable: true })
        const icon = new Gtk.Image({ gicon: entry.info.get_icon(), pixelSize: 32 })
        icon.add_css_class("lowres-icon")
        row.add_prefix(icon)
        const state = new Gtk.Label({ label: appSettings(entry.id).get_boolean("enable") ? "On" : "Off" })
        state.add_css_class("dim-label")
        row.add_suffix(state)
        row.add_suffix(new Gtk.Image({ iconName: "go-next-symbolic" }))
        row.connect("activated", () => appDialog(row, entry, render))
        return row
      }),
      rows,
    )
    appsGroup.description = apps.length ? "" : "No apps have sent notifications yet"
  }
  watch(settings, "changed::application-children", render)
  render()

  return page({ title: "Notifications", content: prefsPage(top, appsGroup) })
}
