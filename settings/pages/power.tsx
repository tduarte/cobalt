import Adw from "gi://Adw?version=1"
import AstalPowerProfiles from "gi://AstalPowerProfiles"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import UPowerGlib from "gi://UPowerGlib"
import { group, page, prefsPage, setRows, track, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Power: batteries of this computer and connected devices,
// power mode (power-profiles-daemon), power button, and power saving. The
// keys are GNOME's; cobalt-idle turns them into hypridle's config and
// cobalt-power-button handles the button.

const power = new Gio.Settings({ schemaId: "org.gnome.settings-daemon.plugins.power" })
const session = new Gio.Settings({ schemaId: "org.gnome.desktop.session" })

const BLANK_DELAYS = [1, 2, 3, 4, 5, 8, 10, 12, 15].map((m): [number, string] => [m * 60, `${m} minute${m > 1 ? "s" : ""}`])
const SUSPEND_DELAYS: [number, string][] = [
  [900, "15 minutes"],
  [1200, "20 minutes"],
  [1500, "25 minutes"],
  [1800, "30 minutes"],
  [2700, "45 minutes"],
  [3600, "1 hour"],
  [4800, "80 minutes"],
  [5400, "1 hour 30 minutes"],
  [6000, "100 minutes"],
  [7200, "2 hours"],
]

const PROFILES: [string, string, string][] = [
  ["performance", "Performance", "High performance and power usage"],
  ["balanced", "Balanced", "Standard performance and power usage"],
  ["power-saver", "Power Saver", "Reduced performance and power usage"],
]

function comboRow(title: string, options: [number, string][], current: number) {
  const row = new Adw.ComboRow({ title, model: Gtk.StringList.new(options.map(([, l]) => l)) })
  // Keep a custom value (set elsewhere) selectable
  let i = options.findIndex(([v]) => v === current)
  if (i < 0) {
    options.push([current, `${Math.round(current / 60)} minutes`])
    row.model = Gtk.StringList.new(options.map(([, l]) => l))
    i = options.length - 1
  }
  row.selected = i
  return Object.assign(row, { value: () => options[row.selected][0] })
}

// ---- Batteries ----

function levelRow(name: string, percent: number, detail: string) {
  const row = new Adw.ActionRow({ title: GLib.markup_escape_text(name, -1), subtitle: detail })
  const pct = new Gtk.Label({ label: `${Math.round(percent)} %` })
  pct.add_css_class("dim-label")
  const bar = new Gtk.LevelBar({ minValue: 0, maxValue: 100, value: percent, valign: Gtk.Align.CENTER, widthRequest: 200 })
  row.add_suffix(pct)
  row.add_suffix(bar)
  return row
}

function batteryDetail(d: UPowerGlib.Device) {
  switch (d.state) {
    case UPowerGlib.DeviceState.CHARGING:
      return "Charging"
    case UPowerGlib.DeviceState.FULLY_CHARGED:
      return "Fully charged"
    case UPowerGlib.DeviceState.DISCHARGING:
      return d.timeToEmpty > 0 ? `${Math.round(d.timeToEmpty / 60)} minutes left` : "Discharging"
    default:
      return ""
  }
}

function batteryGroups() {
  const batteryGroup = group("Battery")
  const devicesGroup = group("Connected Devices")
  let batteryRows: Gtk.Widget[] = []
  let deviceRows: Gtk.Widget[] = []
  let client: UPowerGlib.Client | null = null
  try {
    client = UPowerGlib.Client.new_full(null)
  } catch (err) {
    console.error("upower", err)
  }
  const render = () => {
    const devices = (client?.get_devices() ?? []).filter((d) => d.isPresent && d.kind !== UPowerGlib.DeviceKind.LINE_POWER)
    const own = devices.filter((d) => d.kind === UPowerGlib.DeviceKind.BATTERY && d.powerSupply)
    const peripherals = devices.filter((d) => !(d.kind === UPowerGlib.DeviceKind.BATTERY && d.powerSupply))
    batteryRows = setRows(
      batteryGroup,
      own.map((d) => levelRow(own.length > 1 ? d.model || "Battery" : "Battery", d.percentage, batteryDetail(d))),
      batteryRows,
    )
    deviceRows = setRows(
      devicesGroup,
      peripherals.map((d) => levelRow(d.model || d.vendor || "Device", d.percentage, "")),
      deviceRows,
    )
    batteryGroup.visible = own.length > 0
    devicesGroup.visible = peripherals.length > 0
  }
  if (client) {
    watch(client, "device-added", render)
    watch(client, "device-removed", render)
    for (const d of client.get_devices()) watch(d, "notify::percentage", render)
  }
  render()
  return [batteryGroup, devicesGroup]
}

// ---- Power Mode ----

function powerModeGroup() {
  const g = group("Power Mode")
  const ppd = AstalPowerProfiles.get_default()
  const available = new Set(ppd.get_profiles().map((p) => p.profile))
  if (available.size === 0) {
    g.visible = false
    return g
  }
  let first: Gtk.CheckButton | null = null
  const checks = new Map<string, Gtk.CheckButton>()
  for (const [id, title, subtitle] of PROFILES) {
    if (!available.has(id)) continue
    const check = new Gtk.CheckButton({ valign: Gtk.Align.CENTER })
    if (first) check.set_group(first)
    else first = check
    const row = new Adw.ActionRow({ title, subtitle, activatableWidget: check })
    row.add_prefix(check)
    check.connect("toggled", () => {
      if (check.active && ppd.activeProfile !== id) ppd.activeProfile = id
    })
    checks.set(id, check)
    g.add(row)
  }
  track(ppd, ["active-profile"], () => {
    const c = checks.get(ppd.activeProfile)
    if (c && !c.active) c.active = true
  })
  return g
}

// ---- General: power button ----

function canHibernate() {
  try {
    const result = Gio.DBus.system.call_sync(
      "org.freedesktop.login1",
      "/org/freedesktop/login1",
      "org.freedesktop.login1.Manager",
      "CanHibernate",
      null,
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
    )
    return (result.deepUnpack() as [string])[0] === "yes"
  } catch {
    return false
  }
}

function generalGroup() {
  const g = group("General")
  const actions: [string, string][] = [
    ["suspend", "Suspend"],
    ["interactive", "Power Off"],
    ...(canHibernate() ? ([["hibernate", "Hibernate"]] as [string, string][]) : []),
    ["nothing", "Nothing"],
  ]
  const row = new Adw.ComboRow({ title: "Power Button Behavior", model: Gtk.StringList.new(actions.map(([, l]) => l)) })
  const sync = () => (row.selected = Math.max(0, actions.findIndex(([v]) => v === power.get_string("power-button-action"))))
  sync()
  row.connect("notify::selected", () => power.set_string("power-button-action", actions[row.selected][0]))
  watch(power, "changed::power-button-action", sync)
  g.add(row)
  return g
}

// ---- Power Saving ----

function savingGroups() {
  const dimGroup = group("Power Saving")
  const dim = new Adw.SwitchRow({ title: "Dim Screen", subtitle: "Reduce screen brightness when the device is inactive" })
  power.bind("idle-dim", dim, "active", Gio.SettingsBindFlags.DEFAULT)
  dimGroup.add(dim)

  const blankGroup = group()
  const blank = new Adw.SwitchRow({
    title: "Automatic Screen Blank",
    subtitle: "Turn the screen off after a period of inactivity",
    active: session.get_uint("idle-delay") > 0,
  })
  const blankDelay = comboRow("Delay", BLANK_DELAYS, session.get_uint("idle-delay") || 300)
  const syncBlank = () => {
    blankDelay.sensitive = blank.active
    session.set_uint("idle-delay", blank.active ? blankDelay.value() : 0)
  }
  blank.connect("notify::active", syncBlank)
  blankDelay.connect("notify::selected", syncBlank)
  blankDelay.sensitive = blank.active
  blankGroup.add(blank)
  blankGroup.add(blankDelay)

  const suspendGroup = group()
  const suspend = new Adw.SwitchRow({
    title: "Automatic Suspend",
    active: power.get_string("sleep-inactive-ac-type") !== "nothing",
  })
  const suspendDelay = comboRow("Delay", SUSPEND_DELAYS, power.get_int("sleep-inactive-ac-timeout") || 900)
  const syncSuspend = () => {
    suspendDelay.sensitive = suspend.active
    power.set_string("sleep-inactive-ac-type", suspend.active ? "suspend" : "nothing")
    if (suspend.active) power.set_int("sleep-inactive-ac-timeout", suspendDelay.value())
  }
  suspend.connect("notify::active", syncSuspend)
  suspendDelay.connect("notify::selected", syncSuspend)
  suspendDelay.sensitive = suspend.active
  suspendGroup.add(suspend)
  suspendGroup.add(suspendDelay)
  return [dimGroup, blankGroup, suspendGroup]
}

export default function PowerPage(_ctx: PageContext) {
  return page({
    title: "Power",
    content: prefsPage(...batteryGroups(), powerModeGroup(), generalGroup(), ...savingGroups()),
  })
}
