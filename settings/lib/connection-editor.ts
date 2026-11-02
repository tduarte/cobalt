import Adw from "gi://Adw?version=1"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import NM from "gi://NM"
import { activeConnectionFor, client, connectionSsid, formatSpeed, wifiPassword, wifiSecurityLabel } from "./nm"
import { vpnEditor } from "./vpn"

// GNOME Settings' connection dialog (gear button on Wi-Fi, Wired and VPN
// rows): Details, Identity, Security, IPv4, IPv6 tabs, Cancel / Apply.
// Changes go to a clone of the connection and are committed on Apply.

type Options = {
  // A new connection (Add VPN, "+" on Wired) instead of a saved one
  isNew?: boolean
  device?: NM.Device | null
  onDone?: () => void
}

const IPV4_METHODS: [string, string][] = [
  ["auto", "Automatic (DHCP)"],
  ["link-local", "Link-Local Only"],
  ["manual", "Manual"],
  ["disabled", "Disable"],
  ["shared", "Shared to other computers"],
]

const IPV6_METHODS: [string, string][] = [
  ["auto", "Automatic"],
  ["dhcp", "Automatic, DHCP only"],
  ["link-local", "Link-Local Only"],
  ["manual", "Manual"],
  ["disabled", "Disable"],
  ["shared", "Shared to other computers"],
]

function infoRow(title: string, value: string) {
  const row = new Adw.ActionRow({ title, subtitle: value, subtitleSelectable: true, visible: value !== "" })
  row.add_css_class("property")
  return row
}

function comboRow(title: string, options: [string, string][], current: string) {
  const row = new Adw.ComboRow({ title, model: Gtk.StringList.new(options.map(([, l]) => l)) })
  row.selected = Math.max(0, options.findIndex(([v]) => v === current))
  return Object.assign(row, { value: () => options[row.selected][0] })
}

// ---- Details: live state of an active connection, plus switches and Forget ----

function detailsPage(conn: NM.RemoteConnection, edit: NM.Connection, device: NM.Device | null, close: () => void) {
  const page = new Adw.PreferencesPage()
  const info = new Adw.PreferencesGroup()
  const ac = activeConnectionFor(conn)
  const dev = device ?? ac?.get_devices()?.[0] ?? null

  if (dev instanceof NM.DeviceWifi) {
    const ap = dev.get_active_access_point()
    if (ac && ap) {
      const s = ap.get_strength()
      info.add(infoRow("Signal Strength", s > 75 ? "Excellent" : s > 50 ? "Good" : s > 25 ? "OK" : "Weak"))
      info.add(infoRow("Link Speed", formatSpeed(dev.get_bitrate() / 1000)))
      const mhz = ap.get_frequency()
      info.add(infoRow("Frequency", mhz > 4900 ? `${(mhz / 1000).toFixed(1)} GHz` : "2.4 GHz"))
    }
    info.add(infoRow("Security", wifiSecurityLabel(conn)))
  } else if (dev instanceof NM.DeviceEthernet && ac) {
    info.add(infoRow("Link Speed", formatSpeed(dev.get_speed())))
  }

  const ip4 = ac?.get_ip4_config()
  const ip6 = ac?.get_ip6_config()
  const addrs4 = ip4?.get_addresses().map((a) => a.get_address()) ?? []
  const addrs6 = ip6?.get_addresses().map((a) => a.get_address()) ?? []
  if (addrs4.length) info.add(infoRow("IPv4 Address", addrs4.join(", ")))
  if (addrs6.length) info.add(infoRow("IPv6 Address", addrs6.join(", ")))
  if (dev?.get_hw_address() && !(dev instanceof NM.DeviceWireGuard)) info.add(infoRow("Hardware Address", dev.get_hw_address()!))
  const gateway = ip4?.get_gateway() || ip6?.get_gateway()
  if (gateway) info.add(infoRow("Default Route", gateway))
  const dns = [...(ip4?.get_nameservers() ?? []), ...(ip6?.get_nameservers() ?? [])]
  if (dns.length) info.add(infoRow("DNS", dns.join(", ")))
  if (!ac) {
    const ts = conn.get_setting_connection()?.get_timestamp() ?? 0
    info.add(infoRow("Last Used", ts ? GLib.DateTime.new_from_unix_local(ts).format("%x %X")! : "Never"))
  }
  page.add(info)

  const sc = edit.get_setting_connection()!
  const toggles = new Adw.PreferencesGroup()
  const auto = new Adw.SwitchRow({ title: "Connect Automatically", active: sc.get_autoconnect() })
  auto.connect("notify::active", () => sc.set_property("autoconnect", auto.active))
  const shared = new Adw.SwitchRow({
    title: "Make Available to Other Users",
    active: sc.get_num_permissions() === 0,
  })
  shared.connect("notify::active", () => {
    if (shared.active) while (sc.get_num_permissions() > 0) sc.remove_permission(0)
    else sc.add_permission("user", GLib.get_user_name(), null)
  })
  toggles.add(auto)
  toggles.add(shared)
  if (conn.get_connection_type() === "802-11-wireless") {
    const metered = new Adw.SwitchRow({
      title: "Metered Connection",
      subtitle: "Limit background data use",
      active: sc.get_metered() === NM.Metered.YES,
    })
    metered.connect("notify::active", () =>
      sc.set_property("metered", metered.active ? NM.Metered.YES : NM.Metered.UNKNOWN),
    )
    toggles.add(metered)
  }
  page.add(toggles)

  const forgetGroup = new Adw.PreferencesGroup()
  const isWifi = conn.get_connection_type() === "802-11-wireless"
  const forget = new Adw.ButtonRow({ title: isWifi ? "Forget Connection" : "Remove Connection Profile" })
  forget.add_css_class("destructive-action")
  forget.connect("activated", () => {
    conn.delete_async(null).catch(console.error)
    close()
  })
  forgetGroup.add(forget)
  page.add(forgetGroup)
  return page
}

// ---- Identity: name, SSID, MAC; the VPN plugin's own editor for VPNs ----

function identityPage(edit: NM.Connection, collectors: (() => void)[]) {
  const page = new Adw.PreferencesPage()
  const g = new Adw.PreferencesGroup()
  const sc = edit.get_setting_connection()!
  const name = new Adw.EntryRow({ title: "Name", text: sc.get_id() ?? "" })
  collectors.push(() => sc.set_property("id", name.text))
  g.add(name)

  const wifi = edit.get_setting_wireless()
  if (wifi) {
    const ssid = new Adw.EntryRow({ title: "SSID", text: connectionSsid(edit) })
    collectors.push(() => wifi.set_property("ssid", new GLib.Bytes(new TextEncoder().encode(ssid.text))))
    g.add(ssid)
  }
  const wired = edit.get_setting_wired()
  const mac = wired?.get_mac_address() ?? wifi?.get_mac_address()
  if (wired || wifi) {
    const macRow = new Adw.EntryRow({ title: "MAC Address (empty: any)", text: mac ?? "" })
    collectors.push(() => (wired ?? wifi)!.set_property("mac-address", macRow.text.trim() || null))
    g.add(macRow)
  }
  page.add(g)
  return page
}

// ---- Security (Wi-Fi): type and password ----

const WIFI_SECURITY: [string, string][] = [
  ["", "None"],
  ["wpa-psk", "WPA/WPA2 Personal"],
  ["sae", "WPA3 Personal"],
]

function securityPage(conn: NM.RemoteConnection | null, edit: NM.Connection, collectors: (() => void)[]) {
  const page = new Adw.PreferencesPage()
  const g = new Adw.PreferencesGroup()
  const current = edit.get_setting_wireless_security()?.get_key_mgmt() ?? ""
  if (current && !WIFI_SECURITY.some(([v]) => v === current)) {
    // Enterprise/WEP networks: shown, not editable here
    g.add(infoRow("Security", wifiSecurityLabel(edit)))
    page.add(g)
    return page
  }
  const type = comboRow("Security", WIFI_SECURITY, current)
  const password = new Adw.PasswordEntryRow({ title: "Password" })
  const sync = () => (password.visible = type.value() !== "")
  type.connect("notify::selected", sync)
  sync()
  if (conn) wifiPassword(conn).then((p) => p && (password.text = p))
  g.add(type)
  g.add(password)
  page.add(g)

  collectors.push(() => {
    const mgmt = type.value()
    if (!mgmt) {
      edit.remove_setting(NM.SettingWirelessSecurity.$gtype)
      return
    }
    let sec = edit.get_setting_wireless_security()
    if (!sec) {
      sec = new NM.SettingWirelessSecurity()
      edit.add_setting(sec)
    }
    sec.set_property("key-mgmt", mgmt)
    if (password.text) sec.set_property("psk", password.text)
  })
  return page
}

// ---- IPv4 / IPv6 ----

function ipPage(edit: NM.Connection, v6: boolean, collectors: (() => void)[]) {
  const page = new Adw.PreferencesPage()
  let ip = (v6 ? edit.get_setting_ip6_config() : edit.get_setting_ip4_config()) as NM.SettingIPConfig | null
  if (!ip) {
    ip = v6 ? new NM.SettingIP6Config({ method: "auto" }) : new NM.SettingIP4Config({ method: "auto" })
    edit.add_setting(ip)
  }
  const setting = ip

  const methodGroup = new Adw.PreferencesGroup()
  const method = comboRow(v6 ? "IPv6 Method" : "IPv4 Method", v6 ? IPV6_METHODS : IPV4_METHODS, setting.get_method() ?? "auto")
  methodGroup.add(method)
  page.add(methodGroup)

  const addrGroup = new Adw.PreferencesGroup({ title: "Addresses" })
  const first = setting.get_num_addresses() > 0 ? setting.get_address(0) : null
  const address = new Adw.EntryRow({ title: "Address", text: first?.get_address() ?? "" })
  const prefix = new Adw.EntryRow({
    title: v6 ? "Prefix" : "Netmask",
    text: first ? (v6 ? `${first.get_prefix()}` : prefixToNetmask(first.get_prefix())) : "",
  })
  const gateway = new Adw.EntryRow({ title: "Gateway", text: setting.get_gateway() ?? "" })
  addrGroup.add(address)
  addrGroup.add(prefix)
  addrGroup.add(gateway)
  page.add(addrGroup)

  const dnsGroup = new Adw.PreferencesGroup({ title: "DNS" })
  const autoDns = new Adw.SwitchRow({ title: "Automatic", active: !setting.get_ignore_auto_dns() })
  const dnsServers: string[] = []
  for (let i = 0; i < setting.get_num_dns(); i++) dnsServers.push(setting.get_dns(i)!)
  const dns = new Adw.EntryRow({ title: "Servers (separate with commas)", text: dnsServers.join(", ") })
  dnsGroup.add(autoDns)
  dnsGroup.add(dns)
  page.add(dnsGroup)

  const routeGroup = new Adw.PreferencesGroup({ title: "Routes" })
  const autoRoutes = new Adw.SwitchRow({ title: "Automatic", active: !setting.get_ignore_auto_routes() })
  const onlyLocal = new Adw.SwitchRow({
    title: "Use this connection only for resources on its network",
    active: setting.get_never_default(),
  })
  routeGroup.add(autoRoutes)
  routeGroup.add(onlyLocal)
  page.add(routeGroup)

  const sync = () => {
    const m = method.value()
    addrGroup.visible = m === "manual"
    dnsGroup.visible = routeGroup.visible = m !== "disabled" && m !== "link-local"
  }
  method.connect("notify::selected", sync)
  sync()

  collectors.push(() => {
    const m = method.value()
    setting.set_property("method", m)
    setting.clear_addresses()
    if (m === "manual" && address.text.trim()) {
      const p = v6 ? Number(prefix.text) || 64 : netmaskToPrefix(prefix.text.trim())
      setting.add_address(NM.IPAddress.new(v6 ? 10 : 2, address.text.trim(), p))
      setting.set_property("gateway", gateway.text.trim() || null)
    } else {
      setting.set_property("gateway", null)
    }
    setting.set_property("ignore-auto-dns", !autoDns.active)
    setting.clear_dns()
    for (const s of dns.text.split(",").map((x) => x.trim()).filter(Boolean)) setting.add_dns(s)
    setting.set_property("ignore-auto-routes", !autoRoutes.active)
    setting.set_property("never-default", onlyLocal.active)
  })
  return page
}

function prefixToNetmask(prefix: number) {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  return [24, 16, 8, 0].map((s) => (mask >>> s) & 255).join(".")
}

function netmaskToPrefix(text: string) {
  if (/^\d+$/.test(text)) return Number(text)
  const parts = text.split(".").map(Number)
  if (parts.length !== 4) return 24
  return parts.reduce((n, p) => n + (p.toString(2).match(/1/g)?.length ?? 0), 0)
}

// ---- The dialog ----

export function editConnection(parent: Gtk.Widget, conn: NM.Connection, opts: Options = {}) {
  const remote = opts.isNew ? null : (conn as NM.RemoteConnection)
  const edit = NM.SimpleConnection.new_clone(conn)
  const collectors: (() => void)[] = []
  // Plain text tabs like GNOME's editor (Adw.ViewSwitcher wants icons)
  const stack = new Gtk.Stack({ transitionType: Gtk.StackTransitionType.CROSSFADE, vhomogeneous: false })
  const type = conn.get_connection_type()
  let dlg: Adw.Dialog | null = null
  const close = () => dlg?.close()

  if (remote) stack.add_titled(detailsPage(remote, edit, opts.device ?? null, close), "details", "Details")

  const identity = identityPage(edit, collectors)
  if (type === "vpn" || type === "wireguard") {
    const vpn = vpnEditor(edit)
    if (vpn) {
      const g = new Adw.PreferencesGroup()
      g.add(vpn.widget)
      identity.add(g)
      collectors.push(() => vpn.collect(edit))
    }
  }
  stack.add_titled(identity, "identity", "Identity")
  if (type === "802-11-wireless") stack.add_titled(securityPage(remote, edit, collectors), "security", "Security")
  stack.add_titled(ipPage(edit, false, collectors), "ipv4", "IPv4")
  stack.add_titled(ipPage(edit, true, collectors), "ipv6", "IPv6")

  const switcher = new Gtk.StackSwitcher({ stack })
  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const apply = new Gtk.Button({ label: opts.isNew ? "_Add" : "_Apply", useUnderline: true })
  apply.add_css_class("suggested-action")

  const title = type === "802-11-wireless" ? connectionSsid(conn) : conn.get_id() ?? ""
  const header = new Adw.HeaderBar({
    titleWidget: new Adw.WindowTitle({ title }),
    showStartTitleButtons: false,
    showEndTitleButtons: false,
  })
  header.pack_start(cancel)
  header.pack_end(apply)
  // Tabs in their own bar under the title, so narrow windows still fit
  const tabs = new Gtk.Box({ halign: Gtk.Align.CENTER, marginBottom: 6 })
  tabs.append(switcher)
  const view = new Adw.ToolbarView({ content: stack })
  view.add_top_bar(header)
  view.add_top_bar(tabs)

  dlg = new Adw.Dialog({ title, child: view, contentWidth: 620, contentHeight: 620 })
  cancel.connect("clicked", close)
  apply.connect("clicked", () => {
    try {
      for (const c of collectors) c()
      edit.normalize()
    } catch (err) {
      const alert = new Adw.AlertDialog({ heading: "Invalid Settings", body: `${err}` })
      alert.add_response("ok", "_OK")
      alert.present(dlg)
      return
    }
    const done = remote
      ? (remote.replace_settings_from_connection(edit), remote.commit_changes_async(true, null))
      : client.add_connection_async(edit, true, null)
    done.then(() => opts.onDone?.()).catch(console.error)
    close()
  })
  dlg.present(parent)
  return dlg
}
