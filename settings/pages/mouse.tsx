import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import Gtk from "gi://Gtk?version=4.0"
import { applyInput, mouse, touchpad } from "../lib/input"
import { hyprJson } from "../lib/hypr"
import { group, page, prefsPage, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Mouse & Touchpad, on GNOME's peripherals keys; every
// change is turned into Hyprland's input config (lib/input.ts).

// Primary Button: Left / Right, as a linked toggle group
function primaryButtonRow() {
  const row = new Adw.ActionRow({
    title: "Primary Button",
    subtitle: "Order of physical buttons on mice and touchpads",
  })
  const toggles = new Adw.ToggleGroup({ valign: Gtk.Align.CENTER })
  toggles.add(new Adw.Toggle({ name: "left", label: "Left" }))
  toggles.add(new Adw.Toggle({ name: "right", label: "Right" }))
  toggles.activeName = mouse.get_boolean("left-handed") ? "right" : "left"
  toggles.connect("notify::active-name", () => mouse.set_boolean("left-handed", toggles.activeName === "right"))
  row.add_suffix(toggles)
  return row
}

function speedRow(settings: Gio.Settings) {
  const row = new Adw.ActionRow({ title: "Pointer Speed" })
  const scale = new Gtk.Scale({
    hexpand: true,
    valign: Gtk.Align.CENTER,
    drawValue: false,
    adjustment: new Gtk.Adjustment({ lower: -1, upper: 1, stepIncrement: 0.1 }),
    widthRequest: 260,
  })
  scale.add_mark(-1, Gtk.PositionType.BOTTOM, "Slow")
  scale.add_mark(1, Gtk.PositionType.BOTTOM, "Fast")
  settings.bind("speed", scale.adjustment, "value", Gio.SettingsBindFlags.DEFAULT)
  row.add_suffix(scale)
  return row
}

// Traditional / Natural, as GNOME's two radio choices
function scrollDirection(settings: Gio.Settings) {
  const g = group("Scroll Direction")
  const traditional = new Gtk.CheckButton({ valign: Gtk.Align.CENTER })
  const natural = new Gtk.CheckButton({ valign: Gtk.Align.CENTER, group: traditional })
  const tRow = new Adw.ActionRow({ title: "Traditional", subtitle: "Scrolling moves the view", activatableWidget: traditional })
  tRow.add_prefix(traditional)
  const nRow = new Adw.ActionRow({ title: "Natural", subtitle: "Scrolling moves the content", activatableWidget: natural })
  nRow.add_prefix(natural)
  const sync = () => {
    const on = settings.get_boolean("natural-scroll")
    natural.active = on
    traditional.active = !on
  }
  sync()
  natural.connect("toggled", () => settings.set_boolean("natural-scroll", natural.active))
  g.add(tRow)
  g.add(nRow)
  return g
}

function touchpadGroups() {
  const g = group("Touchpad")
  g.add(speedRow(touchpad))
  const tap = new Adw.SwitchRow({ title: "Tap to Click", subtitle: "Quickly touch the touchpad to click" })
  touchpad.bind("tap-to-click", tap, "active", Gio.SettingsBindFlags.DEFAULT)
  const typing = new Adw.SwitchRow({ title: "Disable While Typing" })
  touchpad.bind("disable-while-typing", typing, "active", Gio.SettingsBindFlags.DEFAULT)
  const secondary = new Adw.ComboRow({
    title: "Secondary Click",
    model: Gtk.StringList.new(["Two Finger Push", "Corner Push"]),
    selected: touchpad.get_string("click-method") === "areas" ? 1 : 0,
  })
  secondary.connect("notify::selected", () => touchpad.set_string("click-method", secondary.selected === 1 ? "areas" : "fingers"))
  const scrolling = new Adw.ComboRow({
    title: "Scrolling",
    model: Gtk.StringList.new(["Two Finger", "Edge"]),
    selected: touchpad.get_boolean("edge-scrolling-enabled") ? 1 : 0,
  })
  scrolling.connect("notify::selected", () => {
    touchpad.set_boolean("edge-scrolling-enabled", scrolling.selected === 1)
    touchpad.set_boolean("two-finger-scrolling-enabled", scrolling.selected === 0)
  })
  for (const r of [tap, typing, secondary, scrolling]) g.add(r)
  return [g, scrollDirection(touchpad)]
}

export default function MousePage(_ctx: PageContext) {
  const general = group("General")
  general.add(primaryButtonRow())

  const mouseGroup = group("Mouse")
  mouseGroup.add(speedRow(mouse))
  const accel = new Adw.SwitchRow({
    title: "Mouse Acceleration",
    subtitle: "Recommended for most users and applications",
    active: mouse.get_string("accel-profile") !== "flat",
  })
  accel.connect("notify::active", () => mouse.set_string("accel-profile", accel.active ? "default" : "flat"))
  mouseGroup.add(accel)

  const content = prefsPage(general, mouseGroup, scrollDirection(mouse))
  // Touchpad options only with a touchpad, like GNOME
  hyprJson<{ mice: { name: string }[] }>("devices")
    .then((d) => {
      if (d.mice.some((m) => /touchpad|trackpad/i.test(m.name))) for (const g of touchpadGroups()) content.add(g)
    })
    .catch(console.error)

  // Every key change goes to Hyprland
  watch(mouse, "changed", applyInput)
  watch(touchpad, "changed", applyInput)
  return page({ title: "Mouse & Touchpad", content })
}
