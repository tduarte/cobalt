import Adw from "gi://Adw?version=1"
import AstalNetwork from "gi://AstalNetwork"
import GLib from "gi://GLib"
import GObject from "gi://GObject"
import Gtk from "gi://Gtk?version=4.0"
import NM from "gi://NM"
import { editConnection } from "../lib/connection-editor"
import {
  client,
  connectionSsid,
  connectionsOfType,
  isActivated,
  network,
  qrTexture,
  wifiPassword,
  wifiQrText,
} from "../lib/nm"
import { dialog, dialogBox, every, group, iconButton, navRow, page, prefsPage, setRows, track, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Wi-Fi: switch, saved networks, hidden network, hotspot,
// and the visible networks (connect, share with QR, connection details).

const SCAN_MS = 15000

function savedConnectionFor(ssid: string) {
  return connectionsOfType("802-11-wireless").find((c) => connectionSsid(c) === ssid) ?? null
}

// GNOME's Wi-Fi icon with a small lock at its corner for secured networks.
// Fixed width, so names line up whether or not there's a lock.
function signalIcon(ap: AstalNetwork.AccessPoint) {
  const overlay = new Gtk.Overlay({
    child: new Gtk.Image({ iconName: ap.iconName, halign: Gtk.Align.START }),
    widthRequest: 22,
    valign: Gtk.Align.CENTER,
  })
  if (ap.requiresPassword) {
    const lock = new Gtk.Image({ iconName: "system-lock-screen-symbolic", pixelSize: 9 })
    lock.add_css_class("wifi-lock")
    lock.halign = Gtk.Align.END
    lock.valign = Gtk.Align.END
    overlay.add_overlay(lock)
  }
  return overlay
}

// "Share" dialog: QR code a phone can scan, network name and password
async function showQr(parent: Gtk.Widget, conn: NM.RemoteConnection) {
  const ssid = connectionSsid(conn)
  const password = await wifiPassword(conn)
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 18,
    marginTop: 12,
    marginBottom: 24,
    marginStart: 24,
    marginEnd: 24,
  })
  const picture = new Gtk.Picture({ widthRequest: 240, heightRequest: 240, halign: Gtk.Align.CENTER })
  picture.add_css_class("qr-code")
  qrTexture(wifiQrText(ssid, conn, password))
    .then((t) => picture.set_paintable(t))
    .catch((err) => console.error("qrencode", err))
  box.append(picture)
  const hint = new Gtk.Label({ label: "Scan with a phone to join the network", wrap: true })
  hint.add_css_class("dim-label")
  box.append(hint)
  const details = new Adw.PreferencesGroup()
  for (const [title, value] of [
    ["Network Name", ssid],
    ["Password", password ?? "None"],
  ]) {
    const row = new Adw.ActionRow({ title, subtitle: value, subtitleSelectable: true })
    row.add_css_class("property")
    details.add(row)
  }
  box.append(details)
  dialog({ title: "Share Network", content: box, width: 400 }).present(parent)
}

// Ask for the password of a secured network without a saved connection
function askPassword(parent: Gtk.Widget, ap: AstalNetwork.AccessPoint) {
  const alert = new Adw.AlertDialog({
    heading: "Authentication Required",
    body: `Passwords or encryption keys are required to access the Wi-Fi network “${ap.ssid}”.`,
  })
  const entry = new Adw.PasswordEntryRow({ title: "Password" })
  const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE })
  list.add_css_class("boxed-list")
  list.append(entry)
  alert.extraChild = list
  alert.add_response("cancel", "_Cancel")
  alert.add_response("connect", "C_onnect")
  alert.set_response_appearance("connect", Adw.ResponseAppearance.SUGGESTED)
  alert.defaultResponse = "connect"
  entry.connect("entry-activated", () => alert.response("connect"))
  alert.connect("response", (_, id: string) => {
    if (id === "connect") connect(parent, ap, entry.text)
  })
  alert.present(parent)
}

function connect(parent: Gtk.Widget, ap: AstalNetwork.AccessPoint, password: string | null = null) {
  ap.activate(password, (_, res) => {
    try {
      ap.activate_finish(res)
    } catch (err) {
      if (ap.requiresPassword && !savedConnectionFor(ap.ssid)) askPassword(parent, ap)
      else console.error(err)
    }
  })
}

// ---- Dialogs from the top group ----

function savedNetworks(parent: Gtk.Widget) {
  const g = new Adw.PreferencesGroup()
  const content = new Adw.PreferencesPage()
  content.add(g)
  let rows: Gtk.Widget[] = []
  const render = () => {
    const conns = connectionsOfType("802-11-wireless").sort((a, b) =>
      connectionSsid(a).localeCompare(connectionSsid(b)),
    )
    rows = setRows(
      g,
      conns.map((conn) => {
        const row = new Adw.ActionRow({
          title: GLib.markup_escape_text(connectionSsid(conn), -1),
          subtitle: isActivated(conn) ? "Connected" : "",
        })
        row.add_prefix(new Gtk.Image({ iconName: "network-wireless-signal-excellent-symbolic" }))
        row.add_suffix(iconButton("cobalt-qr-code-symbolic", "Share", () => showQr(row, conn)))
        row.add_suffix(iconButton("emblem-system-symbolic", "Connection Settings", () => editConnection(row, conn)))
        row.add_suffix(
          iconButton("user-trash-symbolic", "Forget", () => conn.delete_async(null).catch(console.error)),
        )
        return row
      }),
      rows,
    )
    if (conns.length === 0) g.description = "No saved networks"
  }
  const ids = [client.connect("connection-added", render), client.connect("connection-removed", render)]
  render()
  const dlg = dialog({ title: "Saved Wi-Fi Networks", content, width: 560, height: 560 })
  dlg.connect("closed", () => ids.forEach((id) => GObject.signal_handler_disconnect(client, id)))
  dlg.present(parent)
}

function hiddenNetwork(parent: Gtk.Widget, device: NM.DeviceWifi) {
  const g = new Adw.PreferencesGroup()
  const name = new Adw.EntryRow({ title: "Network Name" })
  const security = new Adw.ComboRow({
    title: "Security",
    model: Gtk.StringList.new(["None", "WPA/WPA2 Personal", "WPA3 Personal"]),
    selected: 1,
  })
  const password = new Adw.PasswordEntryRow({ title: "Password" })
  security.connect("notify::selected", () => (password.visible = security.selected !== 0))
  g.add(name)
  g.add(security)
  g.add(password)
  const content = dialogBox(g)

  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const ok = new Gtk.Button({ label: "C_onnect", useUnderline: true })
  ok.add_css_class("suggested-action")
  const dlg = dialog({ title: "Connect to Hidden Network", content, width: 480, start: cancel, end: ok })
  cancel.connect("clicked", () => dlg.close())
  ok.connect("clicked", () => {
    const ssid = name.text.trim()
    if (!ssid) return
    const conn = NM.SimpleConnection.new()
    conn.add_setting(new NM.SettingConnection({ id: ssid, uuid: NM.utils_uuid_generate(), type: "802-11-wireless" }))
    conn.add_setting(
      new NM.SettingWireless({ ssid: new GLib.Bytes(new TextEncoder().encode(ssid)), hidden: true }),
    )
    if (security.selected !== 0) {
      conn.add_setting(
        new NM.SettingWirelessSecurity({ keyMgmt: security.selected === 2 ? "sae" : "wpa-psk", psk: password.text }),
      )
    }
    client.add_and_activate_connection_async(conn, device, null, null).catch(console.error)
    dlg.close()
  })
  dlg.present(parent)
}

function hotspot(parent: Gtk.Widget, device: NM.DeviceWifi) {
  const g = new Adw.PreferencesGroup({
    description: "Turning on the hotspot disconnects this device from its Wi-Fi network.",
  })
  const name = new Adw.EntryRow({ title: "Network Name", text: GLib.get_host_name() })
  const password = new Adw.PasswordEntryRow({ title: "Password (8 characters or more)" })
  // A random 8-letter password, like GNOME
  password.text = Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[GLib.random_int_range(0, 31)]).join("")
  g.add(name)
  g.add(password)
  const content = dialogBox(g)

  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const ok = new Gtk.Button({ label: "_Turn On", useUnderline: true })
  ok.add_css_class("suggested-action")
  const dlg = dialog({ title: "Turn On Wi-Fi Hotspot?", content, width: 480, start: cancel, end: ok })
  cancel.connect("clicked", () => dlg.close())
  ok.connect("clicked", () => {
    if (password.text.length < 8) return
    const conn = NM.SimpleConnection.new()
    conn.add_setting(
      new NM.SettingConnection({ id: "Hotspot", uuid: NM.utils_uuid_generate(), type: "802-11-wireless", autoconnect: false }),
    )
    conn.add_setting(
      new NM.SettingWireless({ ssid: new GLib.Bytes(new TextEncoder().encode(name.text)), mode: "ap" }),
    )
    conn.add_setting(new NM.SettingWirelessSecurity({ keyMgmt: "wpa-psk", psk: password.text }))
    conn.add_setting(new NM.SettingIP4Config({ method: "shared" }))
    conn.add_setting(new NM.SettingIP6Config({ method: "ignore" }))
    client.add_and_activate_connection_async(conn, device, null, null).catch(console.error)
    dlg.close()
  })
  dlg.present(parent)
}

// ---- The page ----

export default function WifiPage(ctx: PageContext) {
  const wifi = network.wifi!
  const device = wifi.device as NM.DeviceWifi

  const toggle = new Adw.SwitchRow({ title: "Wi-Fi" })
  track(wifi, ["enabled"], () => (toggle.active = wifi.enabled))
  toggle.connect("notify::active", () => {
    if (toggle.active !== wifi.enabled) wifi.set_enabled(toggle.active)
  })

  const top = group()
  top.add(toggle)
  top.add(navRow("Saved Networks", () => savedNetworks(top)))
  top.add(navRow("Connect to Hidden Network…", () => hiddenNetwork(top, device)))
  top.add(navRow("Turn On Wi-Fi Hotspot…", () => hotspot(top, device)))

  const visible = group("Visible Networks")
  const spinner = new Adw.Spinner()
  visible.headerSuffix = spinner
  track(wifi, ["scanning"], () => (spinner.visible = wifi.scanning))

  let rows: Gtk.Widget[] = []
  const render = () => {
    visible.visible = wifi.enabled
    if (!wifi.enabled) return
    const active = wifi.activeAccessPoint?.ssid ?? null
    const best = new Map<string, AstalNetwork.AccessPoint>()
    for (const ap of wifi.get_access_points()) {
      if (!ap.ssid) continue
      const prev = best.get(ap.ssid)
      if (!prev || ap.strength > prev.strength) best.set(ap.ssid, ap)
    }
    const aps = [...best.values()].sort(
      (a, b) => Number(b.ssid === active) - Number(a.ssid === active) || b.strength - a.strength,
    )
    rows = setRows(
      visible,
      aps.map((ap) => {
        const isActive = ap.ssid === active
        const row = new Adw.ActionRow({
          title: GLib.markup_escape_text(ap.ssid, -1),
          subtitle: isActive ? "Connected" : "",
          activatable: !isActive,
        })
        row.add_prefix(signalIcon(ap))
        const saved = savedConnectionFor(ap.ssid)
        if (isActive && saved) {
          row.add_suffix(iconButton("cobalt-qr-code-symbolic", "Share", () => showQr(row, saved)))
          row.add_suffix(
            iconButton("emblem-system-symbolic", "Connection Settings", () =>
              editConnection(row, saved, { device }),
            ),
          )
        }
        row.connect("activated", () => connect(row, ap))
        return row
      }),
      rows,
    )
  }
  track(wifi, ["access-points", "active-access-point", "enabled"], render)

  const p = page({ title: "Wi-Fi", content: prefsPage(top, visible) })
  // From the Wi-Fi device itself (AstalNetwork's `internet` follows overall
  // connectivity, so it said Connected over Ethernet)
  const status = () => {
    const state = device.get_state()
    p.windowTitle.subtitle = !wifi.enabled
      ? "Off"
      : state === NM.DeviceState.ACTIVATED
        ? "Connected"
        : state > NM.DeviceState.DISCONNECTED && state < NM.DeviceState.ACTIVATED
          ? "Connecting"
          : "Disconnected"
  }
  watch(device, "state-changed", status)
  track(wifi, ["enabled"], status)

  ctx.action("saved", () => savedNetworks(top))
  ctx.action("hidden", () => hiddenNetwork(top, device))
  ctx.action("hotspot", () => hotspot(top, device))
  ctx.action("share", () => {
    const saved = wifi.activeAccessPoint && savedConnectionFor(wifi.activeAccessPoint.ssid)
    if (saved) showQr(top, saved)
  })

  // Keep the list fresh while the page is open, like GNOME
  const scan = () => wifi.enabled && wifi.scan()
  scan()
  every(SCAN_MS, scan)
  watch(client, "connection-added", render)
  watch(client, "connection-removed", render)
  return p
}
