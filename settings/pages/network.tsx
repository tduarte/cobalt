import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import Gtk from "gi://Gtk?version=4.0"
import NM from "gi://NM"
import { editConnection } from "../lib/connection-editor"
import { activeConnectionFor, client, connectionsOfType, formatSpeed, isActivated, newConnection } from "../lib/nm"
import { dialog, dialogBox, group, scrollingBox, iconButton, navRow, page, prefsPage, setRows, watch } from "../lib/ui"
import { importVpn, vpnTypes } from "../lib/vpn"
import type { PageContext } from "."

// GNOME Settings > Network: Wired (per device), VPN, and Proxy.

const VPN_TYPES = ["vpn", "wireguard"]

function addButton(tooltipText: string, onClicked: () => void) {
  const b = new Gtk.Button({ iconName: "list-add-symbolic", tooltipText, valign: Gtk.Align.CENTER })
  b.add_css_class("flat")
  b.connect("clicked", onClicked)
  return b
}

// Switch that follows a connection's state and (de)activates it
function connectionSwitch(conn: NM.RemoteConnection, device: NM.Device | null) {
  const sw = new Gtk.Switch({ valign: Gtk.Align.CENTER, active: isActivated(conn) })
  sw.connect("state-set", (_, on: boolean) => {
    const ac = activeConnectionFor(conn)
    if (on && !ac) client.activate_connection_async(conn, device, null, null).catch(console.error)
    else if (!on && ac) client.deactivate_connection_async(ac, null).catch(console.error)
    return false
  })
  return sw
}

// ---- Wired ----

function wiredStatus(device: NM.DeviceEthernet) {
  if (!device.get_carrier()) return "Cable unplugged"
  switch (device.get_state()) {
    case NM.DeviceState.ACTIVATED:
      return ["Connected", formatSpeed(device.get_speed())].filter(Boolean).join(" - ")
    case NM.DeviceState.PREPARE:
    case NM.DeviceState.CONFIG:
    case NM.DeviceState.IP_CONFIG:
    case NM.DeviceState.IP_CHECK:
      return "Connecting"
    default:
      return "Disconnected"
  }
}

function wiredRows(device: NM.DeviceEthernet, several: boolean) {
  // With several adapters, each row names its interface, like GNOME's sections
  const iface = several ? device.get_iface() ?? "" : ""
  const profiles = (device.get_available_connections() as NM.RemoteConnection[]).sort((a, b) =>
    (a.get_id() ?? "").localeCompare(b.get_id() ?? ""),
  )
  if (profiles.length <= 1) {
    // One profile: the row shows the device status, like GNOME
    const conn = profiles[0] ?? null
    const row = new Adw.ActionRow({ title: wiredStatus(device), subtitle: iface })
    if (conn) {
      row.add_suffix(connectionSwitch(conn, device))
      row.add_suffix(iconButton("emblem-system-symbolic", "Wired Settings", () => editConnection(row, conn, { device })))
    }
    return [row]
  }
  // Several profiles: one row each, the active one marked
  return profiles.map((conn) => {
    const status = isActivated(conn) ? wiredStatus(device) : ""
    const row = new Adw.ActionRow({ title: conn.get_id() ?? "", subtitle: [status, iface].filter(Boolean).join(" · ") })
    row.add_suffix(connectionSwitch(conn, device))
    row.add_suffix(iconButton("emblem-system-symbolic", "Wired Settings", () => editConnection(row, conn, { device })))
    return row
  })
}

// ---- VPN ----

function addVpn(parent: Gtk.Widget) {
  const list = new Adw.PreferencesGroup()
  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const dlg = dialog({ title: "Add VPN", content: dialogBox(list), width: 600, start: cancel })
  cancel.connect("clicked", () => dlg.close())

  for (const type of vpnTypes()) {
    const row = new Adw.ActionRow({ title: type.name, subtitle: type.description, activatable: true })
    row.connect("activated", () => {
      dlg.close()
      editConnection(parent, type.create(), { isNew: true })
    })
    list.add(row)
  }
  const importRow = new Adw.ActionRow({ title: "Import from file…", activatable: true })
  importRow.connect("activated", () => {
    const chooser = new Gtk.FileDialog({ title: "Select file to import" })
    chooser.open(parent.get_root() as Gtk.Window, null, (_, res) => {
      let file: Gio.File | null = null
      try {
        file = chooser.open_finish(res)
      } catch {
        return // cancelled
      }
      dlg.close()
      try {
        editConnection(parent, importVpn(file!), { isNew: true })
      } catch (err) {
        const alert = new Adw.AlertDialog({ heading: "Cannot Import VPN Connection", body: `${err}` })
        alert.add_response("ok", "_OK")
        alert.present(parent)
      }
    })
  })
  list.add(importRow)
  dlg.present(parent)
}

function vpnRows() {
  const vpns = client
    .get_connections()
    .filter((c) => VPN_TYPES.includes(c.get_connection_type() ?? ""))
    .sort((a, b) => (a.get_id() ?? "").localeCompare(b.get_id() ?? "")) as NM.RemoteConnection[]
  if (vpns.length === 0) {
    const row = new Adw.ActionRow({ title: "Not set up" })
    row.add_css_class("dim-label")
    return [row]
  }
  return vpns.map((conn) => {
    const row = new Adw.ActionRow({ title: conn.get_id() ?? "" })
    row.add_suffix(connectionSwitch(conn, null))
    row.add_suffix(iconButton("emblem-system-symbolic", "VPN Settings", () => editConnection(row, conn)))
    return row
  })
}

// ---- Proxy (GNOME's org.gnome.system.proxy; apps read it via the portal) ----

const proxy = new Gio.Settings({ schemaId: "org.gnome.system.proxy" })

function proxyLabel() {
  switch (proxy.get_string("mode")) {
    case "auto":
      return "Automatic"
    case "manual":
      return "Manual"
    default:
      return "Off"
  }
}

function proxyDialog(parent: Gtk.Widget, onChanged: () => void) {
  const modeGroup = new Adw.PreferencesGroup()
  const modes: [string, string][] = [
    ["none", "Disabled"],
    ["auto", "Automatic"],
    ["manual", "Manual"],
  ]
  const autoGroup = new Adw.PreferencesGroup()
  const url = new Adw.EntryRow({ title: "Configuration URL", text: proxy.get_string("autoconfig-url") })
  url.connect("changed", () => proxy.set_string("autoconfig-url", url.text))
  autoGroup.add(url)

  const manualGroup = new Adw.PreferencesGroup()
  for (const [key, label] of [
    ["http", "HTTP Proxy"],
    ["https", "HTTPS Proxy"],
    ["ftp", "FTP Proxy"],
    ["socks", "SOCKS Host"],
  ]) {
    const s = new Gio.Settings({ schemaId: `org.gnome.system.proxy.${key}` })
    const host = new Adw.EntryRow({ title: label, text: s.get_string("host") })
    host.connect("changed", () => s.set_string("host", host.text))
    const port = new Adw.SpinRow({
      title: "Port",
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 65535, stepIncrement: 1, value: s.get_int("port") }),
    })
    port.connect("notify::value", () => s.set_int("port", port.value))
    manualGroup.add(host)
    manualGroup.add(port)
  }
  const ignore = new Adw.EntryRow({
    title: "Ignore Hosts (separate with commas)",
    text: proxy.get_strv("ignore-hosts").join(", "),
  })
  ignore.connect("changed", () =>
    proxy.set_strv("ignore-hosts", ignore.text.split(",").map((h) => h.trim()).filter(Boolean)),
  )
  manualGroup.add(ignore)

  const sync = () => {
    const mode = proxy.get_string("mode")
    autoGroup.visible = mode === "auto"
    manualGroup.visible = mode === "manual"
  }
  let first: Gtk.CheckButton | null = null
  for (const [mode, label] of modes) {
    const check = new Gtk.CheckButton({ active: proxy.get_string("mode") === mode, valign: Gtk.Align.CENTER })
    if (first) check.set_group(first)
    else first = check
    const row = new Adw.ActionRow({ title: label, activatableWidget: check })
    row.add_prefix(check)
    check.connect("toggled", () => {
      if (!check.active) return
      proxy.set_string("mode", mode)
      sync()
      onChanged()
    })
    modeGroup.add(row)
  }
  sync()
  dialog({ title: "Proxy", content: scrollingBox(modeGroup, autoGroup, manualGroup), width: 520 }).present(parent)
}

// First gear button inside a widget tree (QA deep link to the wired editor)
function findGear(w: Gtk.Widget): Gtk.Button | null {
  if (w instanceof Gtk.Button && w.iconName === "emblem-system-symbolic") return w
  for (let c = w.get_first_child(); c; c = c.get_next_sibling()) {
    const found = findGear(c)
    if (found) return found
  }
  return null
}

// ---- The page ----

export default function NetworkPage(ctx: PageContext) {
  const wired = group("Wired")
  const vpn = group("VPN")
  const proxyGroup = group("Proxy")

  wired.headerSuffix = addButton("Add Wired Profile", () => {
    const device = client.get_devices().find((d) => d instanceof NM.DeviceEthernet) ?? null
    const conn = newConnection("802-3-ethernet", `Profile ${connectionsOfType("802-3-ethernet").length + 1}`)
    conn.add_setting(new NM.SettingWired())
    conn.add_setting(new NM.SettingIP4Config({ method: "auto" }))
    conn.add_setting(new NM.SettingIP6Config({ method: "auto" }))
    editConnection(wired, conn, { isNew: true, device })
  })
  vpn.headerSuffix = addButton("Add VPN", () => addVpn(vpn))

  const proxyRow = navRow("Proxy", () => proxyDialog(proxyRow, () => proxyRow.valueLabel!.label = proxyLabel()), proxyLabel())
  proxyRow.add_prefix(new Gtk.Image({ iconName: "org.gnome.Settings-network-proxy-symbolic" }))
  proxyGroup.add(proxyRow)

  let wiredList: Gtk.Widget[] = []
  let vpnList: Gtk.Widget[] = []
  const render = () => {
    const devices = client.get_devices().filter((d) => d instanceof NM.DeviceEthernet) as NM.DeviceEthernet[]
    wired.visible = devices.length > 0
    wiredList = setRows(wired, devices.flatMap((d) => wiredRows(d, devices.length > 1)), wiredList)
    vpnList = setRows(vpn, vpnRows(), vpnList)
  }
  render()

  // NM signals that change what the rows show
  for (const signal of ["connection-added", "connection-removed", "active-connection-added", "active-connection-removed", "device-added", "device-removed"])
    watch(client, signal, render)
  for (const device of client.get_devices()) {
    if (device instanceof NM.DeviceEthernet) {
      watch(device, "state-changed", render)
      watch(device, "notify::carrier", render)
    }
  }

  ctx.action("add-vpn", () => addVpn(vpn))
  // QA: open the editor for a new VPN of one type, e.g. `network new-vpn-openvpn`
  for (const type of vpnTypes()) {
    const id = type.name.toLowerCase().replace(/\s*\(.*\)/, "").replace(/[^a-z0-9]+/g, "-")
    ctx.action(`new-vpn-${id}`, () => editConnection(vpn, type.create(), { isNew: true }))
  }
  ctx.action("proxy", () => proxyRow.activate())
  ctx.action("wired", () => {
    findGear(wired)?.activate()
  })

  return page({ title: "Network", content: prefsPage(wired, vpn, proxyGroup) })
}
