import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { call, properties, report } from "../lib/dbus"
import { dialog, dialogBox, group, page, prefsPage, setRows } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > System > Users, on AccountsService (the service GNOME
// uses): your account and other users, picture, name, administrator,
// password, automatic login (GDM reads it), add and remove users, and
// fingerprint login when a reader is present (fprintd).

Gio._promisify(Gio.Subprocess.prototype, "communicate_utf8_async", "communicate_utf8_finish")

const ACCOUNTS = ["org.freedesktop.Accounts", "/org/freedesktop/Accounts", "org.freedesktop.Accounts"] as const
const USER_IFACE = "org.freedesktop.Accounts.User"
const FACES = "/usr/share/pixmaps/faces"

type User = {
  path: string
  uid: number
  userName: string
  realName: string
  iconFile: string
  accountType: number // 0 standard, 1 administrator
  automaticLogin: boolean
  localAccount: boolean
}

function loadUser(path: string): User {
  const p = properties("org.freedesktop.Accounts", path, USER_IFACE)
  return {
    path,
    uid: Number(p.Uid),
    userName: String(p.UserName ?? ""),
    realName: String(p.RealName ?? ""),
    iconFile: String(p.IconFile ?? ""),
    accountType: Number(p.AccountType ?? 0),
    automaticLogin: Boolean(p.AutomaticLogin),
    localAccount: p.LocalAccount !== false,
  }
}

async function users(): Promise<User[]> {
  const [paths] = (await call(...ACCOUNTS, "ListCachedUsers", null, "(ao)")) as [string[]]
  return paths.map(loadUser).filter((u) => u.localAccount)
}

const userCall = (u: User, method: string, params: GLib.Variant) =>
  call("org.freedesktop.Accounts", u.path, USER_IFACE, method, params)

// AccountsService takes a crypt(3) hash; openssl makes a SHA-512 one
async function hashPassword(password: string) {
  const proc = Gio.Subprocess.new(
    ["openssl", "passwd", "-6", "-stdin"],
    Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
  )
  const [out] = (await proc.communicate_utf8_async(`${password}\n`, null)) as unknown as [string]
  return out.trim()
}

function avatar(u: User, size: number) {
  const a = new Adw.Avatar({ size, text: u.realName || u.userName, showInitials: true })
  if (u.iconFile && GLib.file_test(u.iconFile, GLib.FileTest.EXISTS)) {
    try {
      a.customImage = Gtk.IconPaintable.new_for_file(Gio.File.new_for_path(u.iconFile), size, 1) as never
    } catch {
      // keep the initials
    }
  }
  return a
}

// GNOME's avatar picker: stock faces plus "Select a File…"
function pictureDialog(parent: Gtk.Widget, u: User, done: () => void) {
  const flow = new Gtk.FlowBox({ selectionMode: Gtk.SelectionMode.NONE, maxChildrenPerLine: 5, columnSpacing: 8, rowSpacing: 8 })
  const set = (file: string) =>
    userCall(u, "SetIconFile", new GLib.Variant("(s)", [file]))
      .then(done)
      .catch(report(parent, "Could Not Change the Picture"))
  let dlg: Adw.Dialog | null = null
  const dir = Gio.File.new_for_path(FACES)
  try {
    const it = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
    for (let info = it.next_file(null); info; info = it.next_file(null)) {
      const path = dir.get_child(info.get_name()).get_path()!
      const b = new Gtk.Button({ child: new Gtk.Picture({ file: Gio.File.new_for_path(path), widthRequest: 64, heightRequest: 64, contentFit: Gtk.ContentFit.COVER }) })
      b.add_css_class("flat")
      b.connect("clicked", () => {
        dlg?.close()
        set(path)
      })
      flow.append(b)
    }
  } catch {
    // no stock faces installed
  }
  const pick = new Gtk.Button({ label: "Select a File…", halign: Gtk.Align.CENTER })
  pick.add_css_class("pill")
  pick.connect("clicked", () => {
    const filter = new Gtk.FileFilter({ name: "Images" })
    filter.add_mime_type("image/*")
    const filters = new Gio.ListStore({ itemType: Gtk.FileFilter.$gtype })
    filters.append(filter)
    const chooser = new Gtk.FileDialog({ title: "Select a Picture", filters })
    chooser.open(parent.get_root() as Gtk.Window, null, (_, res) => {
      try {
        const file = chooser.open_finish(res)
        dlg?.close()
        if (file?.get_path()) set(file.get_path()!)
      } catch {
        // cancelled
      }
    })
  })
  dlg = dialog({ title: "Select a Picture", content: dialogBox(flow, pick), width: 440 })
  dlg.present(parent)
}

function passwordDialog(parent: Gtk.Widget, u: User) {
  const g = new Adw.PreferencesGroup({ description: "Your current password is asked for by the system before the change." })
  const next = new Adw.PasswordEntryRow({ title: "New Password" })
  const confirm = new Adw.PasswordEntryRow({ title: "Confirm New Password" })
  g.add(next)
  g.add(confirm)
  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const change = new Gtk.Button({ label: "C_hange", useUnderline: true, sensitive: false })
  change.add_css_class("suggested-action")
  const valid = () => (change.sensitive = next.text.length > 0 && next.text === confirm.text)
  next.connect("changed", valid)
  confirm.connect("changed", valid)
  const dlg = dialog({ title: "Change Password", content: dialogBox(g), width: 440, start: cancel, end: change })
  cancel.connect("clicked", () => dlg.close())
  change.connect("clicked", async () => {
    dlg.close()
    try {
      const hash = await hashPassword(next.text)
      await userCall(u, "SetPassword", new GLib.Variant("(ss)", [hash, ""]))
    } catch (err) {
      report(parent, "Could Not Change the Password")(err)
    }
  })
  dlg.present(parent)
}

// The account's controls, for you or another user
function accountGroups(u: User, me: boolean, refresh: () => void, onRemoved?: () => void) {
  const header = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12, halign: Gtk.Align.CENTER, marginBottom: 12 })
  const pic = new Gtk.Button({ child: avatar(u, 96), halign: Gtk.Align.CENTER, tooltipText: "Change Picture" })
  pic.add_css_class("flat")
  pic.add_css_class("circular")
  pic.connect("clicked", () => pictureDialog(pic, u, refresh))
  header.append(pic)

  const g = group()
  const name = new Adw.EntryRow({ title: "Name", text: u.realName, showApplyButton: true })
  name.connect("apply", () =>
    userCall(u, "SetRealName", new GLib.Variant("(s)", [name.text.trim()]))
      .then(refresh)
      .catch(report(name, "Could Not Change the Name")),
  )
  const admin = new Adw.SwitchRow({ title: "Administrator", active: u.accountType === 1 })
  admin.connect("notify::active", () => {
    if (admin.active === (u.accountType === 1)) return
    userCall(u, "SetAccountType", new GLib.Variant("(i)", [admin.active ? 1 : 0]))
      .then(refresh)
      .catch((err) => {
        report(admin, "Could Not Change the Account Type")(err)
        admin.active = u.accountType === 1
      })
  })
  const password = new Adw.ActionRow({ title: "Password", activatable: true })
  const dots = new Gtk.Label({ label: "●●●●●" })
  dots.add_css_class("dim-label")
  password.add_suffix(dots)
  password.add_suffix(new Gtk.Image({ iconName: "go-next-symbolic" }))
  password.connect("activated", () => passwordDialog(password, u))
  const autologin = new Adw.SwitchRow({ title: "Automatic Login", subtitle: "Log in without asking for a password", active: u.automaticLogin })
  autologin.connect("notify::active", () => {
    if (autologin.active === u.automaticLogin) return
    userCall(u, "SetAutomaticLogin", new GLib.Variant("(b)", [autologin.active]))
      .then(refresh)
      .catch((err) => {
        report(autologin, "Could Not Change Automatic Login")(err)
        autologin.active = u.automaticLogin
      })
  })
  for (const r of [name, admin, password, autologin]) g.add(r)
  const groups: Gtk.Widget[] = [header, g]

  if (me) {
    const fp = fingerprintRow()
    if (fp) {
      const fg = group()
      fg.add(fp)
      groups.push(fg)
    }
  } else {
    const removeGroup = group()
    const remove = new Adw.ButtonRow({ title: "Remove User…" })
    remove.add_css_class("destructive-action")
    remove.connect("activated", () => removeUser(remove, u, onRemoved ?? refresh))
    removeGroup.add(remove)
    groups.push(removeGroup)
  }
  return groups
}

function removeUser(parent: Gtk.Widget, u: User, done: () => void) {
  const alert = new Adw.AlertDialog({
    heading: `Remove ${u.realName || u.userName}?`,
    body: "Their files can be kept in their home folder or deleted with the account.",
  })
  alert.add_response("cancel", "_Cancel")
  alert.add_response("keep", "_Keep Files")
  alert.add_response("delete", "_Delete Files")
  alert.set_response_appearance("delete", Adw.ResponseAppearance.DESTRUCTIVE)
  alert.connect("response", (_, id: string) => {
    if (id === "cancel") return
    call(...ACCOUNTS, "DeleteUser", new GLib.Variant("(xb)", [u.uid, id === "delete"]))
      .then(done)
      .catch(report(parent, "Could Not Remove the User"))
  })
  alert.present(parent)
}

function addUserDialog(parent: Gtk.Widget, done: () => void) {
  const g = new Adw.PreferencesGroup()
  const fullName = new Adw.EntryRow({ title: "Name" })
  const userName = new Adw.EntryRow({ title: "Username" })
  // GNOME suggests a username from the name
  let edited = false
  userName.connect("changed", () => (edited = userName.text !== suggestion()))
  const suggestion = () => fullName.text.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9_-]/g, "") ?? ""
  fullName.connect("changed", () => {
    if (!edited) userName.text = suggestion()
  })
  const admin = new Adw.SwitchRow({ title: "Administrator" })
  const pwGroup = new Adw.PreferencesGroup({ title: "Password" })
  const later = new Gtk.CheckButton({ valign: Gtk.Align.CENTER, active: true })
  const now = new Gtk.CheckButton({ valign: Gtk.Align.CENTER, group: later })
  const laterRow = new Adw.ActionRow({ title: "Allow User to Set a Password When They Next Login", activatableWidget: later })
  laterRow.add_prefix(later)
  const nowRow = new Adw.ActionRow({ title: "Set a Password Now", activatableWidget: now })
  nowRow.add_prefix(now)
  const pw = new Adw.PasswordEntryRow({ title: "Password", sensitive: false })
  now.connect("toggled", () => (pw.sensitive = now.active))
  for (const r of [fullName, userName, admin]) g.add(r)
  for (const r of [laterRow, nowRow, pw]) pwGroup.add(r)

  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const add = new Gtk.Button({ label: "_Add", useUnderline: true })
  add.add_css_class("suggested-action")
  const dlg = dialog({ title: "Add User", content: dialogBox(g, pwGroup), width: 480, start: cancel, end: add })
  cancel.connect("clicked", () => dlg.close())
  add.connect("clicked", async () => {
    if (!fullName.text.trim() || !userName.text.trim()) return
    dlg.close()
    try {
      const [path] = (await call(
        ...ACCOUNTS,
        "CreateUser",
        new GLib.Variant("(ssi)", [userName.text.trim(), fullName.text.trim(), admin.active ? 1 : 0]),
        "(o)",
      )) as [string]
      const u = loadUser(path)
      if (now.active && pw.text) {
        await userCall(u, "SetPassword", new GLib.Variant("(ss)", [await hashPassword(pw.text), ""]))
      } else {
        // "Set at next login" (AccountsService password mode 1)
        await userCall(u, "SetPasswordMode", new GLib.Variant("(i)", [1]))
      }
      done()
    } catch (err) {
      report(parent, "Could Not Add the User")(err)
    }
  })
  dlg.present(parent)
}

// ---- Fingerprint (only with a reader, via fprintd) ----

function fingerprintRow(): Adw.ActionRow | null {
  let devices: string[] = []
  try {
    const r = Gio.DBus.system.call_sync(
      "net.reactivated.Fprint",
      "/net/reactivated/Fprint/Manager",
      "net.reactivated.Fprint.Manager",
      "GetDevices",
      null,
      new GLib.VariantType("(ao)"),
      Gio.DBusCallFlags.NONE,
      2000,
      null,
    )
    devices = r.deepUnpack()[0] as string[]
  } catch {
    return null // no fprintd or no reader
  }
  if (devices.length === 0) return null
  const row = new Adw.ActionRow({ title: "Fingerprint Login", subtitle: "Enroll a finger with the reader", activatable: true })
  row.add_suffix(new Gtk.Image({ iconName: "go-next-symbolic" }))
  row.connect("activated", () => enrollDialog(row))
  return row
}

// Runs fprintd-enroll and shows its prompts ("Place your finger…")
function enrollDialog(parent: Gtk.Widget) {
  const status = new Gtk.Label({ label: "Place your finger on the reader", wrap: true, justify: Gtk.Justification.CENTER })
  const icon = new Gtk.Image({ iconName: "fingerprint-detection-symbolic", pixelSize: 96 })
  const dlg = dialog({ title: "Fingerprint Login", content: dialogBox(icon, status), width: 400 })
  const proc = Gio.Subprocess.new(["fprintd-enroll"], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE)
  const stream = new Gio.DataInputStream({ baseStream: proc.get_stdout_pipe()! })
  const read = () =>
    stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (_, res) => {
      const [line] = stream.read_line_finish_utf8(res)
      if (line === null) return
      if (/enroll-completed/.test(line)) status.label = "Fingerprint enrolled"
      else if (/enroll-stage-passed/.test(line)) status.label = "Lift and place your finger again"
      else if (/retry|swipe-too-short|finger-not-centered/.test(line)) status.label = "Try again"
      else if (/fail|error/i.test(line)) status.label = line
      read()
    })
  read()
  dlg.connect("closed", () => proc.force_exit())
  dlg.present(parent)
}

// ---- The page ----

export default function UsersPage(ctx: PageContext) {
  const content = new Adw.PreferencesPage()
  let added: Gtk.Widget[] = []
  const others = group("Other Users")
  const addRow = new Adw.ButtonRow({ title: "Add User…", startIconName: "list-add-symbolic" })
  let otherRows: Gtk.Widget[] = []

  const render = async () => {
    const all = await users()
    const me = all.find((u) => u.userName === GLib.get_user_name())
    for (const w of added) content.remove(w as Adw.PreferencesGroup)
    added = []
    if (me) {
      const groups = accountGroups(me, true, () => render())
      for (const g of groups) {
        const pg = g instanceof Adw.PreferencesGroup ? g : (() => {
          const wrap = new Adw.PreferencesGroup()
          wrap.add(g)
          return wrap
        })()
        content.add(pg)
        added.push(pg)
      }
    }
    content.remove(others)
    content.add(others)
    others.remove(addRow)
    otherRows = setRows(
      others,
      all
        .filter((u) => u !== me)
        .map((u) => {
          const row = new Adw.ActionRow({
            title: GLib.markup_escape_text(u.realName || u.userName, -1),
            subtitle: u.accountType === 1 ? "Administrator" : "",
            activatable: true,
          })
          row.add_prefix(avatar(u, 32))
          row.add_suffix(new Gtk.Image({ iconName: "go-next-symbolic" }))
          row.connect("activated", () =>
            ctx.push(() => {
              const sub = new Adw.PreferencesPage()
              let shown: Adw.PreferencesGroup[] = []
              const reload = () => {
                for (const g of shown) sub.remove(g)
                shown = accountGroups(loadUser(u.path), false, reload, () => render()).map((g) => {
                  if (g instanceof Adw.PreferencesGroup) return g
                  const w = new Adw.PreferencesGroup()
                  w.add(g)
                  return w
                })
                for (const g of shown) sub.add(g)
              }
              reload()
              return page({ title: u.realName || u.userName, content: sub })
            }),
          )
          return row
        }),
      otherRows,
    )
    others.add(addRow)
  }
  addRow.connect("activated", () => addUserDialog(addRow, () => render()))
  content.add(others)
  others.add(addRow)
  render().catch(console.error)
  return page({ title: "Users", content })
}
