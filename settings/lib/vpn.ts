import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import Gtk from "gi://Gtk?version=4.0"
import NM from "gi://NM"
import { newConnection } from "./nm"

// VPNs, like GNOME Settings: NetworkManager's VPN plugins (OpenVPN,
// openconnect, vpnc, SSH...) bring their own GTK 4 editors; WireGuard is
// built into NetworkManager, so its form lives here.

export type VpnType = {
  name: string
  description: string
  create: () => NM.Connection
}

function pluginInfos() {
  try {
    return NM.VpnPluginInfo.list_load()
  } catch {
    return []
  }
}

function editorPlugin(info: NM.VpnPluginInfo) {
  try {
    return info.get_editor_plugin() ?? info.load_editor_plugin()
  } catch (err) {
    console.error(`VPN plugin ${info.get_name()}`, err)
    return null
  }
}

// The list in "Add VPN": every installed plugin, WireGuard, then import
export function vpnTypes(): VpnType[] {
  const types: VpnType[] = []
  for (const info of pluginInfos()) {
    const plugin = editorPlugin(info)
    if (!plugin) continue
    const name = (plugin as any).name ?? info.get_name()
    const description = (plugin as any).description ?? ""
    types.push({
      name,
      description,
      create: () => {
        const conn = newConnection("vpn", name)
        conn.add_setting(new NM.SettingVpn({ serviceType: info.get_service()! }))
        conn.add_setting(new NM.SettingIP4Config({ method: "auto" }))
        conn.add_setting(new NM.SettingIP6Config({ method: "auto" }))
        return conn
      },
    })
  }
  types.sort((a, b) => a.name.localeCompare(b.name))
  types.push({
    name: "WireGuard",
    description: "Free and open-source VPN solution designed for ease of use, high speed performance and low attack surface.",
    create: () => {
      const conn = newConnection("wireguard", "WireGuard")
      conn.get_setting_connection()!.set_property("interface-name", "wg0")
      conn.add_setting(new NM.SettingWireGuard())
      conn.add_setting(new NM.SettingIP4Config({ method: "manual" }))
      conn.add_setting(new NM.SettingIP6Config({ method: "disabled" }))
      return conn
    },
  })
  return types
}

// "Import from file…": WireGuard .conf, or any plugin that can import the file
export function importVpn(file: Gio.File): NM.Connection {
  const path = file.get_path()!
  if (path.endsWith(".conf")) {
    try {
      return NM.conn_wireguard_import(path)
    } catch {
      // not a WireGuard config; try the plugins
    }
  }
  for (const info of pluginInfos()) {
    const plugin = editorPlugin(info)
    if (!plugin) continue
    try {
      const conn = plugin.import(path)
      if (conn) return conn
    } catch {
      // this plugin doesn't understand the file
    }
  }
  throw new Error("No VPN plugin could import this file")
}

// The VPN part of the connection editor (Identity tab)
export function vpnEditor(edit: NM.Connection): { widget: Gtk.Widget; collect: (c: NM.Connection) => void } | null {
  if (edit.get_connection_type() === "wireguard") return wireguardEditor(edit)
  const service = edit.get_setting_vpn()?.get_service_type()
  if (!service) return null
  const info = NM.VpnPluginInfo.list_find_by_service(pluginInfos(), service)
  const plugin = info ? editorPlugin(info) : null
  if (!plugin) return null
  const editor = plugin.get_editor(edit)
  const widget = editor.get_widget() as Gtk.Widget
  return {
    widget,
    collect: (c) => {
      editor.update_connection(c)
    },
  }
}

// WireGuard: the interface's private key and port, and one peer
function wireguardEditor(edit: NM.Connection) {
  let wg = edit.get_setting(NM.SettingWireGuard.$gtype) as NM.SettingWireGuard | null
  if (!wg) {
    wg = new NM.SettingWireGuard()
    edit.add_setting(wg)
  }
  const setting = wg
  const peer = setting.get_peers_len() > 0 ? setting.get_peer(0) : null
  const allowed: string[] = []
  for (let i = 0; peer && i < peer.get_allowed_ips_len(); i++) allowed.push(peer.get_allowed_ip(i, null)!)

  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 18 })
  const iface = new Adw.PreferencesGroup({ title: "WireGuard" })
  const ifname = new Adw.EntryRow({ title: "Interface Name", text: edit.get_interface_name() ?? "wg0" })
  const privateKey = new Adw.PasswordEntryRow({ title: "Private Key", text: setting.get_private_key() ?? "" })
  const port = new Adw.EntryRow({ title: "Listen Port (optional)", text: setting.get_listen_port() ? `${setting.get_listen_port()}` : "" })
  iface.add(ifname)
  iface.add(privateKey)
  iface.add(port)

  const peerGroup = new Adw.PreferencesGroup({ title: "Peer" })
  const publicKey = new Adw.EntryRow({ title: "Public Key", text: peer?.get_public_key() ?? "" })
  const endpoint = new Adw.EntryRow({ title: "Endpoint (host:port)", text: peer?.get_endpoint() ?? "" })
  const allowedIps = new Adw.EntryRow({ title: "Allowed IPs (separate with commas)", text: allowed.join(", ") })
  const psk = new Adw.PasswordEntryRow({ title: "Preshared Key (optional)", text: peer?.get_preshared_key() ?? "" })
  const keepalive = new Adw.EntryRow({
    title: "Persistent Keepalive (seconds)",
    text: peer?.get_persistent_keepalive() ? `${peer.get_persistent_keepalive()}` : "",
  })
  for (const r of [publicKey, endpoint, allowedIps, psk, keepalive]) peerGroup.add(r)
  box.append(iface)
  box.append(peerGroup)

  return {
    widget: box,
    collect: (c: NM.Connection) => {
      c.get_setting_connection()!.set_property("interface-name", ifname.text.trim() || "wg0")
      const s = c.get_setting(NM.SettingWireGuard.$gtype) as NM.SettingWireGuard
      s.set_property("private-key", privateKey.text.trim() || null)
      s.set_property("listen-port", Number(port.text) || 0)
      s.clear_peers()
      if (publicKey.text.trim()) {
        const p = NM.WireGuardPeer.new()
        p.set_public_key(publicKey.text.trim(), false)
        if (endpoint.text.trim()) p.set_endpoint(endpoint.text.trim(), false)
        for (const ip of allowedIps.text.split(",").map((x) => x.trim()).filter(Boolean)) p.append_allowed_ip(ip, false)
        if (psk.text.trim()) p.set_preshared_key(psk.text.trim(), false)
        p.set_persistent_keepalive(Number(keepalive.text) || 0)
        p.seal()
        s.append_peer(p)
      }
    },
  }
}
