import AstalNetwork from "gi://AstalNetwork"
import Gdk from "gi://Gdk?version=4.0"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import NM from "gi://NM"

// libnm helpers shared by the Wi-Fi and Network pages. AstalNetwork gives the
// devices and access points; the NM.Client underneath gives saved
// connections, secrets and editing.

Gio._promisify(NM.Client.prototype, "add_and_activate_connection_async", "add_and_activate_connection_finish")
Gio._promisify(NM.Client.prototype, "add_connection_async", "add_connection_finish")
Gio._promisify(NM.Client.prototype, "activate_connection_async", "activate_connection_finish")
Gio._promisify(NM.Client.prototype, "deactivate_connection_async", "deactivate_connection_finish")
Gio._promisify(NM.RemoteConnection.prototype, "delete_async", "delete_finish")
Gio._promisify(NM.RemoteConnection.prototype, "commit_changes_async", "commit_changes_finish")
Gio._promisify(NM.RemoteConnection.prototype, "get_secrets_async", "get_secrets_finish")
Gio._promisify(NM.Device.prototype, "disconnect_async", "disconnect_finish")
Gio._promisify(Gio.Subprocess.prototype, "communicate_async", "communicate_finish")

export const network = AstalNetwork.get_default()
export const client: NM.Client = network.client

const decoder = new TextDecoder()

export function ssidToString(ssid: GLib.Bytes | null) {
  if (!ssid) return ""
  const data = ssid.get_data()
  return data ? decoder.decode(data) : ""
}

export function connectionsOfType(type: string) {
  return client.get_connections().filter((c) => c.get_connection_type() === type) as NM.RemoteConnection[]
}

export function connectionSsid(conn: NM.Connection) {
  return ssidToString(conn.get_setting_wireless()?.get_ssid() ?? null)
}

export function activeConnectionFor(conn: NM.Connection) {
  return client.get_active_connections().find((a) => a.get_uuid() === conn.get_uuid()) ?? null
}

export function isActivated(conn: NM.Connection) {
  return activeConnectionFor(conn)?.get_state() === NM.ActiveConnectionState.ACTIVATED
}

// Saved Wi-Fi password (asks NetworkManager for the secret; polkit may prompt)
export async function wifiPassword(conn: NM.RemoteConnection): Promise<string | null> {
  try {
    const secrets = (await conn.get_secrets_async("802-11-wireless-security", null)) as unknown as GLib.Variant
    const unpacked = secrets.deepUnpack() as Record<string, Record<string, GLib.Variant>>
    const sec = unpacked["802-11-wireless-security"] ?? {}
    return (sec["psk"]?.deepUnpack() as string) ?? (sec["wep-key0"]?.deepUnpack() as string) ?? null
  } catch (err) {
    console.error("wifi secrets", err)
    return null
  }
}

export function wifiSecurityLabel(conn: NM.Connection) {
  const mgmt = conn.get_setting_wireless_security()?.get_key_mgmt()
  switch (mgmt) {
    case undefined:
    case null:
      return "None"
    case "none":
      return "WEP"
    case "wpa-psk":
      return "WPA/WPA2 Personal"
    case "sae":
      return "WPA3 Personal"
    case "owe":
      return "Enhanced Open"
    case "wpa-eap":
      return "WPA/WPA2 Enterprise"
    default:
      return mgmt
  }
}

// The text a phone camera understands for joining a Wi-Fi network
export function wifiQrText(ssid: string, conn: NM.Connection, password: string | null) {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1")
  const mgmt = conn.get_setting_wireless_security()?.get_key_mgmt()
  const type = !mgmt ? "nopass" : mgmt === "none" ? "WEP" : mgmt === "sae" ? "SAE" : "WPA"
  return `WIFI:S:${esc(ssid)};T:${type};${password ? `P:${esc(password)};` : ""};`
}

// QR code as a texture (qrencode renders it)
export async function qrTexture(text: string) {
  const proc = Gio.Subprocess.new(
    ["qrencode", "-t", "PNG", "-s", "8", "-m", "1", "-o", "-", text],
    Gio.SubprocessFlags.STDOUT_PIPE,
  )
  const [stdout] = (await proc.communicate_async(null, null)) as unknown as [GLib.Bytes, GLib.Bytes]
  return Gdk.Texture.new_from_bytes(stdout)
}

export function formatSpeed(mbps: number) {
  if (mbps <= 0) return ""
  return mbps >= 1000 ? `${mbps / 1000} Gb/s` : `${mbps} Mb/s`
}

// A new, unsaved connection of a type with a fresh UUID
export function newConnection(type: string, id: string) {
  const conn = NM.SimpleConnection.new()
  const s = new NM.SettingConnection({ id, uuid: NM.utils_uuid_generate(), type, autoconnect: true })
  conn.add_setting(s)
  return conn
}
