import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import Gtk from "gi://Gtk?version=4.0"
import { evalLua, saveLua } from "../lib/hypr"
import { group, page, prefsPage } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Multitasking: the Hot Edge (GNOME's hot corner key; the
// shell's bottom edge follows it) and dynamic vs. a fixed number of
// workspaces (GNOME's mutter keys; fixed = Hyprland persistent workspaces).

const iface = new Gio.Settings({ schemaId: "org.gnome.desktop.interface" })
const mutter = new Gio.Settings({ schemaId: "org.gnome.mutter" })
const wm = new Gio.Settings({ schemaId: "org.gnome.desktop.wm.preferences" })

const MAX_WORKSPACES = 10

// Persistent workspaces 1..n (or none), live and for the next login
function applyWorkspaces(fixed: boolean, n: number) {
  const rules = (on: boolean, upTo: number) =>
    Array.from({ length: upTo }, (_, i) => `hl.workspace_rule({ workspace = "${i + 1}", persistent = ${on} })`).join("\n")
  evalLua(`${rules(false, MAX_WORKSPACES)}\n${fixed ? rules(true, n) : ""}`).catch(console.error)
  saveLua("workspaces", "Multitasking > Workspaces", fixed ? rules(true, n) : "-- Dynamic workspaces")
}

export default function MultitaskingPage(_ctx: PageContext) {
  const general = group("General")
  const hotEdge = new Adw.SwitchRow({
    title: "Hot Edge",
    subtitle: "Push the pointer against the bottom of the screen to open the launcher",
  })
  iface.bind("enable-hot-corners", hotEdge, "active", Gio.SettingsBindFlags.DEFAULT)
  general.add(hotEdge)

  const workspaces = group("Workspaces")
  const dynamicCheck = new Gtk.CheckButton({ valign: Gtk.Align.CENTER })
  const fixedCheck = new Gtk.CheckButton({ valign: Gtk.Align.CENTER, group: dynamicCheck })
  const dynamicRow = new Adw.ActionRow({
    title: "Dynamic Workspaces",
    subtitle: "Automatically removes empty workspaces",
    activatableWidget: dynamicCheck,
  })
  dynamicRow.add_prefix(dynamicCheck)
  const fixedRow = new Adw.ActionRow({
    title: "Fixed Number of Workspaces",
    subtitle: "Specify a number of permanent workspaces",
    activatableWidget: fixedCheck,
  })
  fixedRow.add_prefix(fixedCheck)
  const count = new Adw.SpinRow({
    title: "Number of Workspaces",
    adjustment: new Gtk.Adjustment({ lower: 1, upper: MAX_WORKSPACES, stepIncrement: 1, value: wm.get_int("num-workspaces") }),
  })

  const dynamic = mutter.get_boolean("dynamic-workspaces")
  dynamicCheck.active = dynamic
  fixedCheck.active = !dynamic
  count.sensitive = !dynamic

  const changed = () => {
    const fixed = fixedCheck.active
    count.sensitive = fixed
    mutter.set_boolean("dynamic-workspaces", !fixed)
    wm.set_int("num-workspaces", count.value)
    applyWorkspaces(fixed, count.value)
  }
  fixedCheck.connect("toggled", changed)
  count.connect("notify::value", () => fixedCheck.active && changed())

  workspaces.add(dynamicRow)
  workspaces.add(fixedRow)
  workspaces.add(count)
  return page({ title: "Multitasking", content: prefsPage(general, workspaces) })
}
