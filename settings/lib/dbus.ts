import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"

// System D-Bus helpers for the System pages (hostname1, timedate1, locale1,
// AccountsService, systemd). Calls that change the system let polkit ask for
// a password (hyprpolkitagent shows the prompt).

Gio._promisify(Gio.DBusConnection.prototype, "call", "call_finish")

export async function call(
  name: string,
  path: string,
  iface: string,
  method: string,
  params: GLib.Variant | null = null,
  reply: string | null = null,
): Promise<unknown[]> {
  const result = (await Gio.DBus.system.call(
    name,
    path,
    iface,
    method,
    params,
    reply ? new GLib.VariantType(reply) : null,
    Gio.DBusCallFlags.ALLOW_INTERACTIVE_AUTHORIZATION,
    -1,
    null,
  )) as unknown as GLib.Variant | null
  return result ? (result.deepUnpack() as unknown[]) : []
}

export function properties(name: string, path: string, iface: string): Record<string, unknown> {
  try {
    const result = Gio.DBus.system.call_sync(
      name,
      path,
      "org.freedesktop.DBus.Properties",
      "GetAll",
      new GLib.Variant("(s)", [iface]),
      new GLib.VariantType("(a{sv})"),
      Gio.DBusCallFlags.NONE,
      -1,
      null,
    )
    return result.recursiveUnpack()[0] as Record<string, unknown>
  } catch (err) {
    console.error(`${iface} properties`, err)
    return {}
  }
}

// Show a failed system change (e.g. polkit refused) instead of failing silently
export function report(parent: Gtk.Widget, heading: string) {
  return (err: unknown) => {
    console.error(heading, err)
    const msg = `${err}`.replace(/^.*GDBus\.Error:[^:]+:\s*/, "")
    if (/dismissed|cancel/i.test(msg)) return
    const alert = new Adw.AlertDialog({ heading, body: msg })
    alert.add_response("ok", "_OK")
    alert.present(parent)
  }
}
