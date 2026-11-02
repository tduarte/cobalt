import AstalApps from "gi://AstalApps"
import AstalNotifd from "gi://AstalNotifd"
import Gio from "gi://Gio"

// GNOME's notification settings, honored like GNOME Shell does
// (Settings > Notifications writes them):
//   org.gnome.desktop.notifications show-banners   Do Not Disturb (inverted)
//   ... application-children                       apps that have notified
//   org.gnome.desktop.notifications.application    per app, at
//     /org/gnome/desktop/notifications/application/<canonical id>/

const SCHEMA = "org.gnome.desktop.notifications"
const APP_SCHEMA = "org.gnome.desktop.notifications.application"
const settings = new Gio.Settings({ schemaId: SCHEMA })
const apps = new AstalApps.Apps()
const perApp = new Map<string, Gio.Settings>()

// GNOME's canonical app id: desktop id without .desktop, lowercase, anything
// but [a-z0-9-] replaced by "-" (same as GNOME Settings and Shell)
export function canonicalAppId(desktopId: string) {
  return desktopId
    .replace(/\.desktop$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
}

// The sending app's desktop id, from the notification's hint or its name
function desktopIdOf(n: AstalNotifd.Notification) {
  if (n.desktopEntry) return n.desktopEntry.replace(/\.desktop$/, "")
  const name = n.appName?.toLowerCase()
  if (!name) return null
  const app = apps.get_list().find((a) => a.name.toLowerCase() === name || a.entry.toLowerCase().includes(name))
  return app ? app.entry.replace(/\.desktop$/, "") : null
}

function appSettings(desktopId: string) {
  const id = canonicalAppId(desktopId)
  let s = perApp.get(id)
  if (!s) {
    s = new Gio.Settings({ schemaId: APP_SCHEMA, path: `/org/gnome/desktop/notifications/application/${id}/` })
    if (!s.get_string("application-id")) s.set_string("application-id", `${desktopId}.desktop`)
    perApp.set(id, s)
    // List the app in Settings > Notifications, like GNOME Shell does
    const children = settings.get_strv("application-children")
    if (!children.includes(id)) settings.set_strv("application-children", [...children, id])
  }
  return s
}

export type NotificationPolicy = { show: boolean; banner: boolean }

// What to do with a new notification
export function policyFor(n: AstalNotifd.Notification): NotificationPolicy {
  const id = desktopIdOf(n)
  if (!id) return { show: true, banner: true }
  const s = appSettings(id)
  return { show: s.get_boolean("enable"), banner: s.get_boolean("show-banners") }
}

// Do Not Disturb lives in GNOME's show-banners key; keep notifd in step
export function syncDoNotDisturb() {
  const notifd = AstalNotifd.get_default()
  const fromKey = () => {
    const dnd = !settings.get_boolean("show-banners")
    if (notifd.dontDisturb !== dnd) notifd.set_dont_disturb(dnd)
  }
  settings.connect("changed::show-banners", fromKey)
  notifd.connect("notify::dont-disturb", () => {
    if (settings.get_boolean("show-banners") === notifd.dontDisturb) settings.set_boolean("show-banners", !notifd.dontDisturb)
  })
  fromKey()
}
