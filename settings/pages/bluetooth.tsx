import Adw from "gi://Adw?version=1"
import AstalBluetooth from "gi://AstalBluetooth"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { onCleanup } from "ags"
import { group, page, setRows, track, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Bluetooth: power switch in the header, the adapter is
// discoverable while the page is open, devices to pair/connect, and a BlueZ
// agent for PIN/passkey prompts while pairing.

const bt = AstalBluetooth.get_default()

// ---- Pairing agent (org.bluez.Agent1) ----

const AGENT_PATH = "/io/github/tduarte/cobalt/settings/agent"
const AGENT_XML = `
<node>
  <interface name="org.bluez.Agent1">
    <method name="Release"/>
    <method name="RequestPinCode"><arg type="o" direction="in"/><arg type="s" direction="out"/></method>
    <method name="DisplayPinCode"><arg type="o" direction="in"/><arg type="s" direction="in"/></method>
    <method name="RequestPasskey"><arg type="o" direction="in"/><arg type="u" direction="out"/></method>
    <method name="DisplayPasskey"><arg type="o" direction="in"/><arg type="u" direction="in"/><arg type="q" direction="in"/></method>
    <method name="RequestConfirmation"><arg type="o" direction="in"/><arg type="u" direction="in"/></method>
    <method name="RequestAuthorization"><arg type="o" direction="in"/></method>
    <method name="AuthorizeService"><arg type="o" direction="in"/><arg type="s" direction="in"/></method>
    <method name="Cancel"/>
  </interface>
</node>`

function deviceName(path: string) {
  return bt.devices.find((d) => d.objectPath === path)?.alias ?? "the device"
}

function startAgent(parent: Gtk.Widget) {
  let open: Adw.AlertDialog | null = null
  const reject = (inv: Gio.DBusMethodInvocation) =>
    inv.return_dbus_error("org.bluez.Error.Rejected", "Rejected by user")

  // Ask the user; `fields` adds an entry for PIN/passkey input
  const ask = (heading: string, body: string, ok: string, entry: boolean, done: (text: string | null) => void) => {
    open?.close()
    const alert = new Adw.AlertDialog({ heading, body })
    const input = new Adw.EntryRow({ title: "PIN" })
    if (entry) {
      const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE })
      list.add_css_class("boxed-list")
      list.append(input)
      alert.extraChild = list
    }
    alert.add_response("cancel", "_Cancel")
    alert.add_response("ok", ok)
    alert.set_response_appearance("ok", Adw.ResponseAppearance.SUGGESTED)
    alert.connect("response", (_, id: string) => {
      open = null
      done(id === "ok" ? (entry ? input.text : "") : null)
    })
    open = alert
    alert.present(parent)
  }

  const agent = Gio.DBusExportedObject.wrapJSObject(AGENT_XML, {
    Release() {},
    Cancel() {
      open?.close()
    },
    RequestPinCodeAsync([device]: [string], inv: Gio.DBusMethodInvocation) {
      ask("Enter PIN", `Type the PIN shown on ${deviceName(device)}.`, "_Pair", true, (pin) =>
        pin ? inv.return_value(new GLib.Variant("(s)", [pin])) : reject(inv),
      )
    },
    RequestPasskeyAsync([device]: [string], inv: Gio.DBusMethodInvocation) {
      ask("Enter Passkey", `Type the passkey shown on ${deviceName(device)}.`, "_Pair", true, (key) =>
        key ? inv.return_value(new GLib.Variant("(u)", [Number(key)])) : reject(inv),
      )
    },
    DisplayPinCode([device, pin]: [string, string]) {
      ask("Pairing", `Type ${pin} on ${deviceName(device)}, then press Enter on it.`, "_OK", false, () => {})
    },
    DisplayPasskey([device, key]: [string, number]) {
      ask("Pairing", `Type ${String(key).padStart(6, "0")} on ${deviceName(device)}.`, "_OK", false, () => {})
    },
    RequestConfirmationAsync([device, key]: [string, number], inv: Gio.DBusMethodInvocation) {
      ask(
        "Confirm Bluetooth PIN",
        `Confirm that the PIN ${String(key).padStart(6, "0")} matches the one shown on ${deviceName(device)}.`,
        "_Confirm",
        false,
        (ok) => (ok !== null ? inv.return_value(null) : reject(inv)),
      )
    },
    RequestAuthorizationAsync([device]: [string], inv: Gio.DBusMethodInvocation) {
      ask("Pair Device?", `Allow ${deviceName(device)} to pair with this computer?`, "_Allow", false, (ok) =>
        ok !== null ? inv.return_value(null) : reject(inv),
      )
    },
    AuthorizeService() {},
  })

  const system = Gio.DBus.system
  agent.export(system, AGENT_PATH)
  const call = (method: string, params: GLib.Variant) =>
    system.call_sync("org.bluez", "/org/bluez", "org.bluez.AgentManager1", method, params, null, Gio.DBusCallFlags.NONE, -1, null)
  try {
    call("RegisterAgent", new GLib.Variant("(os)", [AGENT_PATH, "KeyboardDisplay"]))
    call("RequestDefaultAgent", new GLib.Variant("(o)", [AGENT_PATH]))
  } catch (err) {
    console.error("bluetooth agent", err)
  }
  onCleanup(() => {
    try {
      call("UnregisterAgent", new GLib.Variant("(o)", [AGENT_PATH]))
    } catch {
      // bluetoothd went away
    }
    agent.unexport()
  })
}

// ---- Device dialog ----

function deviceStatus(d: AstalBluetooth.Device) {
  if (d.connecting) return "Connecting…"
  if (d.connected) return "Connected"
  return d.paired ? "Disconnected" : "Not Set Up"
}

function deviceDialog(parent: Gtk.Widget, device: AstalBluetooth.Device) {
  const g = new Adw.PreferencesGroup()
  const connection = new Adw.SwitchRow({ title: "Connection", active: device.connected })
  connection.connect("notify::active", () => {
    if (connection.active === device.connected) return
    if (connection.active) device.connect_device(null)
    else device.disconnect_device(null)
  })
  const info = (title: string, value: string) => {
    const row = new Adw.ActionRow({ title, subtitle: value, subtitleSelectable: true })
    row.add_css_class("property")
    return row
  }
  g.add(connection)
  g.add(info("Paired", device.paired ? "Yes" : "No"))
  g.add(info("Type", device.icon?.replace(/-/g, " ") || "Unknown"))
  g.add(info("Address", device.address))
  if (device.batteryPercentage >= 0) g.add(info("Battery", `${Math.round(device.batteryPercentage * 100)} %`))

  const forgetGroup = new Adw.PreferencesGroup()
  const forget = new Adw.ButtonRow({ title: "Forget Device" })
  forget.add_css_class("destructive-action")
  forgetGroup.add(forget)

  const content = new Adw.PreferencesPage()
  content.add(g)
  content.add(forgetGroup)
  const header = new Adw.HeaderBar()
  const view = new Adw.ToolbarView({ content })
  view.add_top_bar(header)
  const dlg = new Adw.Dialog({ title: device.alias, child: view, contentWidth: 480 })
  forget.connect("activated", () => {
    bt.adapter?.remove_device(device)
    dlg.close()
  })
  dlg.present(parent)
}

// ---- The page ----

export default function BluetoothPage(_ctx: PageContext) {
  const adapter = bt.adapter
  if (!adapter) {
    return page({
      title: "Bluetooth",
      content: new Adw.StatusPage({
        iconName: "bluetooth-disabled-symbolic",
        title: "No Bluetooth Found",
        description: "Plug in a dongle to use Bluetooth",
      }),
    })
  }

  const power = new Gtk.Switch({ valign: Gtk.Align.CENTER, tooltipText: "Bluetooth" })
  track(adapter, ["powered"], () => (power.active = adapter.powered))
  power.connect("state-set", (_, on: boolean) => {
    adapter.powered = on
    return false
  })

  const off = new Adw.StatusPage({
    iconName: "bluetooth-disabled-symbolic",
    title: "Bluetooth Turned Off",
    description: "Turn on to connect devices",
  })

  const intro = new Gtk.Label({ wrap: true, xalign: 0, useMarkup: true })
  intro.add_css_class("dim-label")
  track(adapter, ["alias"], () => (intro.label = `Visible as “${GLib.markup_escape_text(adapter.alias, -1)}”.`))
  const introGroup = group()
  introGroup.add(intro)

  const devices = group("Devices")
  const spinner = new Adw.Spinner()
  devices.headerSuffix = spinner
  track(adapter, ["discovering"], () => (spinner.visible = adapter.discovering))

  let rows: Gtk.Widget[] = []
  const render = () => {
    const list = bt.devices
      .filter((d) => d.alias && d.adapter === adapter.objectPath)
      .sort((a, b) => Number(b.paired) - Number(a.paired) || a.alias.localeCompare(b.alias))
    rows = setRows(
      devices,
      list.map((d) => {
        const row = new Adw.ActionRow({ title: GLib.markup_escape_text(d.alias, -1), activatable: true })
        const status = new Gtk.Label({ label: deviceStatus(d) })
        status.add_css_class("dim-label")
        row.add_suffix(status)
        for (const prop of ["connected", "paired", "connecting"]) watch(d, `notify::${prop}`, () => (status.label = deviceStatus(d)))
        row.connect("activated", () => {
          if (d.paired) deviceDialog(row, d)
          else {
            // Pair, trust and connect; the agent handles any PIN prompt
            status.label = "Pairing…"
            d.pair()
            d.trusted = true
            d.connect_device(null)
          }
        })
        return row
      }),
      rows,
    )
  }
  watch(bt, "notify::devices", render)
  render()

  const prefs = new Adw.PreferencesPage()
  prefs.add(introGroup)
  prefs.add(devices)
  const stack = new Gtk.Stack()
  stack.add_named(prefs, "on")
  stack.add_named(off, "off")

  // While the page is open: discoverable, scanning, and our pairing agent
  track(adapter, ["powered"], () => {
    stack.visibleChildName = adapter.powered ? "on" : "off"
    if (adapter.powered) {
      adapter.discoverable = true
      if (!adapter.discovering) adapter.start_discovery()
    }
  })
  onCleanup(() => {
    if (adapter.discovering) adapter.stop_discovery()
    adapter.discoverable = false
  })

  const p = page({ title: "Bluetooth", content: stack, headerEnd: power })
  startAgent(p)
  return p
}
