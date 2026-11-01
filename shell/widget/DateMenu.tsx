import AstalNotifd from "gi://AstalNotifd"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { For, createBinding, createState } from "ags"
import { createPoll } from "ags/time"
import { openMenu, toggleMenu } from "../lib/menus"
import { interfaceSettings } from "../lib/system"
import Calendar from "./Calendar"
import MediaPlayers from "./MediaPlayers"
import Notification from "./Notification"
import PanelMenu from "./PanelMenu"

const now = createPoll<GLib.DateTime | null>(null, 1000, () => GLib.DateTime.new_now_local())

// GNOME's clock format setting ("24h" / "12h"), so the Settings app can change it
function clockFormat() {
  return interfaceSettings.get_string("clock-format") === "12h"
    ? "%b %-d  %-I:%M %p"
    : "%b %-d  %H:%M"
}

// Center of the top bar: the clock (a moon shows Do Not Disturb is on)
export function DateMenuButton() {
  const [format, setFormat] = createState(clockFormat())
  interfaceSettings.connect("changed::clock-format", () => setFormat(clockFormat()))
  const dnd = createBinding(AstalNotifd.get_default(), "dontDisturb")

  return (
    <button
      class={openMenu((m) => (m === "date-menu" ? "panel-button clock active" : "panel-button clock"))}
      onClicked={() => toggleMenu("date-menu")}
    >
      <box spacing={6}>
        <label label={now((dt) => (dt ? dt.format(format.get())! : ""))} />
        <image class="dnd-indicator" iconName="notifications-disabled-symbolic" visible={dnd} />
      </box>
    </button>
  )
}

// GNOME's date menu: media players and notifications on the left, the date
// and calendar on the right. Do Not Disturb lives in quick settings (GNOME 48).
export default function DateMenu() {
  const notifd = AstalNotifd.get_default()
  const notifications = createBinding(notifd, "notifications")

  return (
    <PanelMenu name="date-menu" align="center" width={780}>
      <box spacing={16}>
        <box class="date-menu-left" orientation={Gtk.Orientation.VERTICAL} spacing={10} widthRequest={400}>
          <MediaPlayers />
          <box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            visible={notifications((ns) => ns.length > 0)}
          >
            <For each={notifications((ns) => [...ns].sort((a, b) => b.time - a.time))}>
              {(n: AstalNotifd.Notification) => <Notification notification={n} />}
            </For>
          </box>
          <box
            class="no-notifications"
            orientation={Gtk.Orientation.VERTICAL}
            valign={Gtk.Align.CENTER}
            vexpand
            spacing={8}
            visible={notifications((ns) => ns.length === 0)}
          >
            <image iconName="preferences-system-notifications-symbolic" pixelSize={64} />
            <label label="No Notifications" />
          </box>
          <box vexpand />
          <button
            class="pill"
            halign={Gtk.Align.START}
            sensitive={notifications((ns) => ns.length > 0)}
            onClicked={() => notifd.notifications.forEach((n) => n.dismiss())}
          >
            <label label="Clear" />
          </button>
        </box>
        <Gtk.Separator orientation={Gtk.Orientation.VERTICAL} />
        <box class="date-menu-right" orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
          <label class="date-heading" xalign={0} label={now((dt) => (dt ? dt.format("%A")! : ""))} />
          <label class="date-big" xalign={0} label={now((dt) => (dt ? dt.format("%B %-d %Y")! : ""))} />
          <Calendar now={now} />
        </box>
      </box>
    </PanelMenu>
  )
}
