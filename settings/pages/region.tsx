import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import GnomeDesktop from "gi://GnomeDesktop?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { call, properties, report } from "../lib/dbus"
import { group, navRow, page, pickDialog, prefsPage } from "../lib/ui"

// GNOME Settings > System > Region & Language. Your language goes to
// AccountsService (GDM sets LANG from it at login), formats to GNOME's region
// key (cobalt-session exports LC_* from it, like gnome-session), and the
// login screen's language and formats to systemd-localed. Locale names come
// from GNOME's own library (libgnome-desktop).

const locale = new Gio.Settings({ schemaId: "org.gnome.system.locale" })
const LOCALE1 = ["org.freedesktop.locale1", "/org/freedesktop/locale1", "org.freedesktop.locale1"] as const

function userPath() {
  return call(
    "org.freedesktop.Accounts",
    "/org/freedesktop/Accounts",
    "org.freedesktop.Accounts",
    "FindUserByName",
    new GLib.Variant("(s)", [GLib.get_user_name()]),
    "(o)",
  ).then(([path]) => path as string)
}

function languageName(id: string) {
  return GnomeDesktop.get_language_from_locale(id, null) ?? id
}

// Formats are shown by country, like GNOME (the language is in the details)
function formatsName(id: string) {
  return GnomeDesktop.get_country_from_locale(id, null) ?? languageName(id)
}

function locales(name: (id: string) => string) {
  return GnomeDesktop.get_all_locales()
    .map((id) => ({ id, label: name(id), detail: `${languageName(id)} · ${id}` }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function logoutNotice(g: Adw.PreferencesGroup) {
  const banner = new Adw.ActionRow({ title: "Log out for the changes to take effect" })
  banner.add_css_class("property")
  const button = new Gtk.Button({ label: "Log Out…", valign: Gtk.Align.CENTER })
  button.connect("clicked", () =>
    Gio.Subprocess.new(["hyprctl", "dispatch", "hl.dsp.exit()"], Gio.SubprocessFlags.NONE),
  )
  banner.add_suffix(button)
  banner.visible = false
  g.add(banner)
  return () => (banner.visible = true)
}

export default function RegionPage() {
  const yours = group("Your Account", "Your language and formats; changes apply after you log out")
  const showNotice = logoutNotice(yours)

  const langRow = navRow("Language", () => {}, "")
  const fmtRow = navRow("Formats", () => {}, "")
  yours.add(langRow)
  yours.add(fmtRow)

  let accountPath: string | null = null
  const refreshAccount = () => {
    if (!accountPath) return
    const props = properties("org.freedesktop.Accounts", accountPath, "org.freedesktop.Accounts.User")
    const lang = String(props.Language || GLib.getenv("LANG") || "en_US.UTF-8")
    langRow.valueLabel!.label = languageName(lang)
    const region = locale.get_string("region")
    fmtRow.valueLabel!.label = region ? formatsName(region) : formatsName(lang)
  }
  userPath()
    .then((p) => {
      accountPath = p
      refreshAccount()
    })
    .catch(console.error)

  langRow.connect("activated", () =>
    pickDialog({
      parent: langRow,
      title: "Language",
      items: locales(languageName),
      action: "_Select",
      onPick: (id) => {
        if (!accountPath) return
        call("org.freedesktop.Accounts", accountPath, "org.freedesktop.Accounts.User", "SetLanguage", new GLib.Variant("(s)", [id]))
          .then(() => {
            refreshAccount()
            showNotice()
          })
          .catch(report(langRow, "Could Not Change the Language"))
      },
    }),
  )
  fmtRow.connect("activated", () =>
    pickDialog({
      parent: fmtRow,
      title: "Formats",
      items: locales(formatsName),
      current: locale.get_string("region"),
      onPick: (id) => {
        locale.set_string("region", id)
        refreshAccount()
        showNotice()
      },
    }),
  )

  // Login screen: the system locale (systemd-localed)
  const login = group("Login Screen", "Language and formats used by the login screen and new users")
  const sysLang = navRow("Language", () => {}, "")
  const sysFmt = navRow("Formats", () => {}, "")
  login.add(sysLang)
  login.add(sysFmt)
  const systemLocale = () => {
    const entries = (properties(...LOCALE1).Locale as string[] | undefined) ?? []
    return Object.fromEntries(entries.map((e) => e.split("=") as [string, string]))
  }
  const refreshSystem = () => {
    const l = systemLocale()
    sysLang.valueLabel!.label = languageName(l.LANG ?? "en_US.UTF-8")
    sysFmt.valueLabel!.label = formatsName(l.LC_TIME ?? l.LANG ?? "en_US.UTF-8")
  }
  const setSystem = (changes: Record<string, string>) => {
    const next = { ...systemLocale(), ...changes }
    const list = Object.entries(next).map(([k, v]) => `${k}=${v}`)
    call(...LOCALE1, "SetLocale", new GLib.Variant("(asb)", [list, true]))
      .then(refreshSystem)
      .catch(report(login, "Could Not Change the Login Screen"))
  }
  sysLang.connect("activated", () =>
    pickDialog({ parent: sysLang, title: "Login Screen Language", items: locales(languageName), current: systemLocale().LANG, onPick: (id) => setSystem({ LANG: id }) }),
  )
  sysFmt.connect("activated", () =>
    pickDialog({
      parent: sysFmt,
      title: "Login Screen Formats",
      items: locales(formatsName),
      current: systemLocale().LC_TIME,
      onPick: (id) =>
        setSystem(Object.fromEntries(["LC_NUMERIC", "LC_TIME", "LC_MONETARY", "LC_PAPER", "LC_MEASUREMENT"].map((k) => [k, id]))),
    }),
  )
  refreshSystem()

  return page({ title: "Region & Language", content: prefsPage(yours, login) })
}
