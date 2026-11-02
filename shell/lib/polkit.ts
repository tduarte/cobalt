import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Polkit from "gi://Polkit"
import PolkitAgent from "gi://PolkitAgent"
import { prompt } from "../widget/PromptDialog"

// The polkit authentication agent ("Authentication Required"), like GNOME
// Shell's. GJS can't subclass PolkitAgent.Listener (its vfunc takes a
// callback), so we export polkit's AuthenticationAgent D-Bus interface on the
// system bus ourselves and register it for our login session. Checking the
// password is still polkit's job: PolkitAgent.Session runs its setuid helper.

const PATH = "/io/github/tduarte/cobalt/PolkitAgent"
const XML = `<node>
  <interface name="org.freedesktop.PolicyKit1.AuthenticationAgent">
    <method name="BeginAuthentication">
      <arg type="s" name="action_id" direction="in"/>
      <arg type="s" name="message" direction="in"/>
      <arg type="s" name="icon_name" direction="in"/>
      <arg type="a{ss}" name="details" direction="in"/>
      <arg type="s" name="cookie" direction="in"/>
      <arg type="a(sa{sv})" name="identities" direction="in"/>
    </method>
    <method name="CancelAuthentication">
      <arg type="s" name="cookie" direction="in"/>
    </method>
  </interface>
</node>`

type Identity = [string, Record<string, GLib.Variant>]
type Request = { cancel: () => void }

const requests = new Map<string, Request>()
let exported: Gio.DBusExportedObject | null = null

// AccountsService's name and picture for a uid (GNOME shows both)
function account(uid: number): { name: string; avatar?: string } {
  const fallback = Polkit.UnixUser.new(uid).get_name() ?? String(uid)
  try {
    const [path] = Gio.DBus.system
      .call_sync("org.freedesktop.Accounts", "/org/freedesktop/Accounts", "org.freedesktop.Accounts",
        "FindUserById", new GLib.Variant("(x)", [uid]), new GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, 2000, null)
      .deepUnpack() as [string]
    const get = (prop: string) =>
      (Gio.DBus.system
        .call_sync("org.freedesktop.Accounts", path, "org.freedesktop.DBus.Properties", "Get",
          new GLib.Variant("(ss)", ["org.freedesktop.Accounts.User", prop]), new GLib.VariantType("(v)"),
          Gio.DBusCallFlags.NONE, 2000, null)
        .recursiveUnpack() as [string])[0]
    return { name: get("RealName") || fallback, avatar: get("IconFile") || undefined }
  } catch {
    return { name: fallback }
  }
}

// Prefer the logged-in user when they're allowed (an admin), like GNOME
function pickIdentity(identities: Identity[]): Polkit.Identity {
  const users = identities
    .filter(([kind]) => kind === "unix-user")
    .map(([, d]) => d.uid.deepUnpack() as number)
  const me = new Gio.Credentials().get_unix_user()
  const uid = users.includes(me) ? me : users[0]
  if (uid !== undefined) return Polkit.UnixUser.new(uid)
  const [, d] = identities[0]
  return Polkit.UnixGroup.new(d.gid.deepUnpack() as number)
}

function begin(
  [, message, , , cookie, identities]: [string, string, string, Record<string, string>, string, Identity[]],
  invocation: Gio.DBusMethodInvocation,
) {
  console.log(`polkit: authentication requested (${message})`)
  const identity = pickIdentity(identities)
  const uid = identity instanceof Polkit.UnixUser ? identity.get_uid() : -1
  let session: PolkitAgent.Session | null = null
  let waiting = false // the helper asked for the password
  let pending: string | null = null // the user typed it before the helper asked
  let done = false

  const reply = (ok: boolean) => {
    if (done) return
    done = true
    requests.delete(cookie)
    if (ok) invocation.return_value(null)
    else invocation.return_dbus_error("org.freedesktop.PolicyKit1.Error.Cancelled", "Authentication dismissed")
  }

  const start = () => {
    session = new PolkitAgent.Session({ identity, cookie })
    waiting = false
    session.connect("request", (_s, request: string) => {
      // Usually "Password: "; other PAM modules can ask other things
      const label = request.replace(/:\s*$/, "") || "Password"
      handle.setField("password", label)
      if (pending !== null) {
        session?.response(pending)
        pending = null
      } else waiting = true
    })
    session.connect("show-error", (_s, text: string) => handle.fail(text))
    session.connect("completed", (_s, gained: boolean) => {
      if (done) return
      if (gained) {
        handle.close()
        reply(true)
      } else {
        handle.fail("Sorry, that didn’t work. Please try again.")
        start()
      }
    })
    session.initiate()
  }

  const handle = prompt({
    title: "Authentication Required",
    body: message,
    user: uid >= 0 ? account(uid) : { name: identity.to_string() },
    fields: [{ key: "password", label: "Password", secret: true }],
    action: "Authenticate",
    onSubmit: ({ password }) => {
      handle.busy()
      if (waiting) {
        waiting = false
        session?.response(password)
      } else pending = password
    },
    onCancel: () => {
      session?.cancel()
      reply(false)
    },
  })

  requests.set(cookie, {
    cancel: () => {
      session?.cancel()
      handle.close()
      reply(false)
    },
  })
  start()
}

export function startPolkitAgent() {
  const agent = {
    BeginAuthenticationAsync: begin,
    CancelAuthentication([cookie]: [string]) {
      requests.get(cookie)?.cancel()
    },
  }
  try {
    // Kept in a module variable: a collected export disappears from the bus
    exported = Gio.DBusExportedObject.wrapJSObject(XML, agent)
    exported.export(Gio.DBus.system, PATH)
    // Our login session: the shell runs as a user service, so it isn't in the
    // session's scope itself; hyprland.lua imports XDG_SESSION_ID
    const id = GLib.getenv("XDG_SESSION_ID")
    const subject = id
      ? Polkit.UnixSession.new(id)
      : Polkit.UnixSession.new_for_process_sync(new Gio.Credentials().get_unix_pid(), null)
    Polkit.Authority.get_sync(null).register_authentication_agent_sync(subject!, GLib.getenv("LANG") ?? "", PATH, null)
    console.log(`polkit: agent registered for session ${id ?? "(from pid)"}`)
  } catch (err) {
    // Another agent is registered for the session, or polkit is missing
    console.error("polkit agent", err)
  }
}
