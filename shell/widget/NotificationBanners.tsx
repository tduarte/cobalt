import app from "ags/gtk4/app"
import { Astal, Gtk } from "ags/gtk4"
import AstalHyprland from "gi://AstalHyprland"
import AstalNotifd from "gi://AstalNotifd"
import GLib from "gi://GLib"
import { For, createComputed, createState, onCleanup } from "ags"
import Notification from "./Notification"
import { policyFor } from "../lib/notifications"
import { openMenu } from "../lib/menus"

const BANNER_TIMEOUT_MS = 5000

// Like GNOME, no banners over a fullscreen window (a game, a video); the
// notification still goes to the date menu. Hyprland's fullscreen state:
// 0 none, 1 maximized, 2 fullscreen, 3 both.
function fullscreenFocused() {
  try {
    const w = JSON.parse(AstalHyprland.get_default().message("j/activewindow"))
    return (w?.fullscreen ?? 0) >= 2
  } catch {
    return false
  }
}

// GNOME-style banners: new notifications slide in at the top center of the
// focused monitor, then hide after a few seconds (they stay in the date menu
// until dismissed). Do Not Disturb and fullscreen windows hide banners
// except critical ones, and
// per-app settings (Settings > Notifications) can drop an app's notifications
// or just its banners.
export default function NotificationBanners() {
  const notifd = AstalNotifd.get_default()
  const [banners, setBanners] = createState(new Array<AstalNotifd.Notification>())

  const hide = (id: number) => setBanners((ns) => ns.filter((n) => n.id !== id))

  const notified = notifd.connect("notified", (_, id, replaced) => {
    const n = notifd.get_notification(id)
    if (!n) return
    const critical = n.urgency === AstalNotifd.Urgency.CRITICAL
    const policy = policyFor(n)
    if (!policy.show) {
      n.dismiss()
      return
    }
    if (!policy.banner && !critical) return
    if (notifd.dontDisturb && !critical) return
    if (fullscreenFocused() && !critical) return

    if (replaced && banners.get().some((b) => b.id === id)) {
      setBanners((ns) => ns.map((b) => (b.id === id ? n : b)))
    } else {
      setBanners((ns) => [n, ...ns].slice(0, 3))
    }

    if (!critical) {
      const timeout = n.expireTimeout > 0 ? n.expireTimeout : BANNER_TIMEOUT_MS
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
        hide(id)
        return GLib.SOURCE_REMOVE
      })
    }
  })
  const resolved = notifd.connect("resolved", (_, id) => hide(id))

  onCleanup(() => {
    notifd.disconnect(notified)
    notifd.disconnect(resolved)
  })

  return (
    <window
      $={(self) => onCleanup(() => self.destroy())}
      name="notification-banners"
      namespace="cobalt-notifications"
      class="notification-banners"
      application={app}
      layer={Astal.Layer.OVERLAY}
      anchor={Astal.WindowAnchor.TOP}
      // Like GNOME, no banners while the notification list is open
      visible={createComputed(() => banners().length > 0 && openMenu() !== "date-menu")}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <For each={banners}>
          {(n: AstalNotifd.Notification) => <Notification notification={n} />}
        </For>
      </box>
    </window>
  )
}
