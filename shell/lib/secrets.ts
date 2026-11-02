import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { prompt, type Field, type PromptHandle } from "../widget/PromptDialog"

// NetworkManager's secret agent, like GNOME Shell's network agent: NM asks
// us for passwords it doesn't have (a Wi-Fi network whose key is wrong or not
// saved, enterprise 802.1X, PPPoE, mobile broadband, VPNs that ask every
// time), and we show the shared password dialog. GJS can't subclass
// NM.SecretAgentOld (its vfuncs take callbacks), so we export the D-Bus
// interface on the system bus and register with NM's AgentManager.
//
// VPNs: the plugin's auth dialog describes its fields in --external-ui-mode
// (a key file), we show them in our dialog and return them to NM, like GNOME
// Shell. Plugins without that mode get their own auth dialog window.

const PATH = "/org/freedesktop/NetworkManager/SecretAgent"
const XML = `<node>
  <interface name="org.freedesktop.NetworkManager.SecretAgent">
    <method name="GetSecrets">
      <arg type="a{sa{sv}}" name="connection" direction="in"/>
      <arg type="o" name="connection_path" direction="in"/>
      <arg type="s" name="setting_name" direction="in"/>
      <arg type="as" name="hints" direction="in"/>
      <arg type="u" name="flags" direction="in"/>
      <arg type="a{sa{sv}}" name="secrets" direction="out"/>
    </method>
    <method name="CancelGetSecrets">
      <arg type="o" name="connection_path" direction="in"/>
      <arg type="s" name="setting_name" direction="in"/>
    </method>
    <method name="SaveSecrets">
      <arg type="a{sa{sv}}" name="connection" direction="in"/>
      <arg type="o" name="connection_path" direction="in"/>
    </method>
    <method name="DeleteSecrets">
      <arg type="a{sa{sv}}" name="connection" direction="in"/>
      <arg type="o" name="connection_path" direction="in"/>
    </method>
  </interface>
</node>`

const FLAG_ALLOW_INTERACTION = 0x1
const FLAG_REQUEST_NEW = 0x2
const ERR_NO_SECRETS = "org.freedesktop.NetworkManager.SecretAgent.NoSecrets"
const ERR_CANCELED = "org.freedesktop.NetworkManager.SecretAgent.UserCanceled"

type Settings = Record<string, Record<string, unknown>>
type Pending = { cancel: () => void }

const pending = new Map<string, Pending>()
let exported: Gio.DBusExportedObject | null = null
const decoder = new TextDecoder()

function ssidOf(settings: Settings) {
  const ssid = settings["802-11-wireless"]?.ssid as number[] | Uint8Array | undefined
  return ssid ? decoder.decode(new Uint8Array(ssid)) : ""
}

// What to ask for each kind of setting, GNOME's wording
function describe(settings: Settings, setting: string): { title: string; body: string; fields: Field[] } | null {
  const conn = settings.connection ?? {}
  const name = String(conn.id ?? "")
  const s = settings[setting] ?? {}
  const value = (key: string) => (typeof s[key] === "string" ? (s[key] as string) : "")

  if (setting === "802-11-wireless-security") {
    const ssid = ssidOf(settings) || name
    const keyMgmt = value("key-mgmt")
    const fields: Field[] =
      keyMgmt === "none" || keyMgmt === "ieee8021x"
        ? [{ key: `wep-key${Number(s["wep-tx-keyidx"] ?? 0)}`, label: "Key", secret: true }]
        : keyMgmt === "owe"
          ? []
          : [{ key: "psk", label: "Password", secret: true }]
    if (fields.length === 0) return null
    return {
      title: "Authentication Required",
      body: `Passwords or encryption keys are required to access the Wi-Fi network “${ssid}”.`,
      fields,
    }
  }
  if (setting === "802-1x") {
    const eap = (s.eap as string[] | undefined) ?? []
    const wifi = settings["802-11-wireless"] !== undefined
    const fields: Field[] = eap.includes("tls")
      ? [
          { key: "identity", label: "Identity", value: value("identity") },
          { key: "private-key-password", label: "Private Key Password", secret: true },
        ]
      : [
          { key: "identity", label: "Username", value: value("identity") },
          { key: "password", label: "Password", secret: true },
        ]
    return {
      title: wifi ? "Authentication Required" : "Wired 802.1X Authentication",
      body: wifi
        ? `Passwords or encryption keys are required to access the Wi-Fi network “${ssidOf(settings) || name}”.`
        : `A password is required to connect to “${name}”.`,
      fields,
    }
  }
  if (setting === "pppoe") {
    return {
      title: "DSL Authentication",
      body: `A password is required to connect to “${name}”.`,
      fields: [
        { key: "username", label: "Username", value: value("username") },
        { key: "service", label: "Service", value: value("service") },
        { key: "password", label: "Password", secret: true },
      ],
    }
  }
  if (setting === "gsm" || setting === "cdma") {
    return {
      title: "Mobile Broadband Network Password",
      body: `A password is required to connect to “${name}”.`,
      fields: [{ key: "password", label: "Password", secret: true }],
    }
  }
  return null
}

// a{sa{sv}} with string values, for NM
function reply(setting: string, values: Record<string, string>) {
  const inner: Record<string, GLib.Variant> = {}
  for (const [k, v] of Object.entries(values)) inner[k] = new GLib.Variant("s", v)
  return new GLib.Variant("(a{sa{sv}})", [{ [setting]: inner }])
}

// ---- VPN ----

function vpnPlugin(service: string) {
  const dirs = ["/usr/lib/NetworkManager/VPN", "/etc/NetworkManager/VPN"]
  for (const dir of dirs) {
    let it: Gio.FileEnumerator
    try {
      it = Gio.File.new_for_path(dir).enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
    } catch {
      continue
    }
    for (let info = it.next_file(null); info; info = it.next_file(null)) {
      if (!info.get_name().endsWith(".name")) continue
      const kf = new GLib.KeyFile()
      try {
        kf.load_from_file(`${dir}/${info.get_name()}`, GLib.KeyFileFlags.NONE)
        if (kf.get_string("VPN Connection", "service") !== service) continue
        const get = (k: string) => {
          try {
            return kf.get_string("GNOME", k)
          } catch {
            return ""
          }
        }
        return { authDialog: get("auth-dialog"), external: get("supports-external-ui-mode") === "true", hints: get("supports-hints") === "true" }
      } catch {
        continue
      }
    }
  }
  return null
}

// The auth dialog's stdin: the connection's data and saved secrets
function vpnInput(vpn: Record<string, unknown>) {
  const data = (vpn.data as Record<string, string> | undefined) ?? {}
  const secrets = (vpn.secrets as Record<string, string> | undefined) ?? {}
  let out = ""
  for (const [k, v] of Object.entries(data)) out += `DATA_KEY=${k}\nDATA_VAL=${v}\n\n`
  for (const [k, v] of Object.entries(secrets)) out += `SECRET_KEY=${k}\nSECRET_VAL=${v}\n\n`
  return out + "DONE\n\n"
}

function vpnSecrets(values: Record<string, string>) {
  return new GLib.Variant("(a{sa{sv}})", [{ vpn: { secrets: new GLib.Variant("a{ss}", values) } }])
}

function getVpnSecrets(
  settings: Settings,
  hints: string[],
  flags: number,
  invocation: Gio.DBusMethodInvocation,
  key: string,
) {
  const conn = settings.connection ?? {}
  const vpn = settings.vpn ?? {}
  const service = String(vpn["service-type"] ?? "")
  const plugin = vpnPlugin(service)
  if (!plugin?.authDialog) return invocation.return_dbus_error(ERR_NO_SECRETS, `No auth dialog for ${service}`)

  const argv = [plugin.authDialog, "-u", String(conn.uuid), "-n", String(conn.id), "-s", service]
  if (flags & FLAG_ALLOW_INTERACTION) argv.push("-i")
  if (flags & FLAG_REQUEST_NEW) argv.push("-r")
  if (plugin.hints) for (const h of hints) argv.push("-t", h)
  if (plugin.external) argv.push("--external-ui-mode")

  let proc: Gio.Subprocess
  try {
    proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE)
  } catch (err) {
    return invocation.return_dbus_error(ERR_NO_SECRETS, String(err))
  }
  let handle: PromptHandle | null = null
  let done = false
  const finish = (fn: () => void) => {
    if (done) return
    done = true
    pending.delete(key)
    handle?.close()
    fn()
  }
  pending.set(key, { cancel: () => finish(() => { proc.force_exit(); invocation.return_dbus_error(ERR_CANCELED, "Canceled") }) })

  // Closing stdin after the data ends the plugin's own window mode too
  proc.communicate_utf8_async(vpnInput(vpn), null, (_p, res) => {
    let stdout = ""
    try {
      ;[, stdout] = proc.communicate_utf8_finish(res)
    } catch (err) {
      return finish(() => invocation.return_dbus_error(ERR_NO_SECRETS, String(err)))
    }
    if (!plugin.external) {
      // "key\nvalue\n" pairs, ending with a blank line
      const lines = stdout.split("\n")
      const values: Record<string, string> = {}
      for (let i = 0; i + 1 < lines.length && lines[i] !== ""; i += 2) values[lines[i]] = lines[i + 1]
      return finish(() =>
        Object.keys(values).length
          ? invocation.return_value(vpnSecrets(values))
          : invocation.return_dbus_error(ERR_CANCELED, "Canceled"),
      )
    }
    // External UI: a key file describing what to ask
    const kf = new GLib.KeyFile()
    try {
      kf.load_from_data(stdout, stdout.length, GLib.KeyFileFlags.NONE)
    } catch {
      return finish(() => invocation.return_dbus_error(ERR_NO_SECRETS, "Bad auth dialog output"))
    }
    const str = (g: string, k: string) => {
      try {
        return kf.get_string(g, k)
      } catch {
        return ""
      }
    }
    const fields: Field[] = []
    const known: Record<string, string> = {}
    for (const group of kf.get_groups()[0]) {
      if (group === "VPN Plugin UI") continue
      const ask = str(group, "ShouldAsk") === "true"
      const value = str(group, "Value")
      if (!ask) {
        if (value) known[group] = value
        continue
      }
      fields.push({
        key: group,
        label: str(group, "Label").replace(/[:_]/g, "").trim() || group,
        secret: str(group, "IsSecret") === "true",
        value,
      })
    }
    if (fields.length === 0) return finish(() => invocation.return_value(vpnSecrets(known)))
    if (!(flags & FLAG_ALLOW_INTERACTION)) return finish(() => invocation.return_dbus_error(ERR_NO_SECRETS, "Needs interaction"))
    handle = prompt({
      title: str("VPN Plugin UI", "Title") || "VPN Password",
      body: str("VPN Plugin UI", "Description") || `A password is required to connect to “${conn.id}”.`,
      fields,
      action: "Connect",
      onSubmit: (values) => finish(() => invocation.return_value(vpnSecrets({ ...known, ...values }))),
      onCancel: () => finish(() => invocation.return_dbus_error(ERR_CANCELED, "Canceled")),
    })
  })
}

// ---- The agent ----

function getSecrets(
  [connection, path, setting, hints, flags]: [Record<string, Record<string, GLib.Variant>>, string, string, string[], number],
  invocation: Gio.DBusMethodInvocation,
) {
  const settings: Settings = Object.fromEntries(
    Object.entries(connection).map(([name, props]) => [
      name,
      Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.recursiveUnpack()])),
    ]),
  )
  const key = `${path}/${setting}`
  console.log(`network agent: secrets requested for ${settings.connection?.id} (${setting})`)
  pending.get(key)?.cancel()

  if (setting === "vpn") return getVpnSecrets(settings, hints, flags, invocation, key)

  const what = describe(settings, setting)
  if (!what) return invocation.return_dbus_error(ERR_NO_SECRETS, `Can't ask for ${setting}`)
  if (!(flags & FLAG_ALLOW_INTERACTION)) return invocation.return_dbus_error(ERR_NO_SECRETS, "Needs interaction")

  let done = false
  const finish = (fn: () => void) => {
    if (done) return
    done = true
    pending.delete(key)
    handle.close()
    fn()
  }
  const handle = prompt({
    ...what,
    action: "Connect",
    onSubmit: (values) => finish(() => invocation.return_value(reply(setting, values))),
    onCancel: () => finish(() => invocation.return_dbus_error(ERR_CANCELED, "Canceled")),
  })
  pending.set(key, { cancel: () => finish(() => invocation.return_dbus_error(ERR_CANCELED, "Canceled")) })
}

export function startNetworkAgent() {
  const agent = {
    GetSecretsAsync: getSecrets,
    CancelGetSecrets([path, setting]: [string, string]) {
      pending.get(`${path}/${setting}`)?.cancel()
    },
    // Secrets the user chose to keep are saved by NM with the connection
    // (system-owned); agent-owned secrets aren't stored by cobalt yet
    SaveSecrets() {},
    DeleteSecrets() {},
  }
  try {
    // Kept in a module variable: a collected export disappears from the bus
    exported = Gio.DBusExportedObject.wrapJSObject(XML, agent)
    exported.export(Gio.DBus.system, PATH)
    // Capability 1: we understand VPN hints
    Gio.DBus.system.call_sync(
      "org.freedesktop.NetworkManager",
      "/org/freedesktop/NetworkManager/AgentManager",
      "org.freedesktop.NetworkManager.AgentManager",
      "RegisterWithCapabilities",
      new GLib.Variant("(su)", ["io.github.tduarte.cobalt.NetworkAgent", 1]),
      null,
      Gio.DBusCallFlags.NONE,
      5000,
      null,
    )
    console.log("network agent: registered")
  } catch (err) {
    console.error("network agent", err)
  }
}
