import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { call, properties, report } from "../lib/dbus"
import { hyprJson } from "../lib/hypr"
import { network } from "../lib/nm"
import { dialog, dialogBox, group, navRow, page, prefsPage } from "../lib/ui"
import DateTimePage from "./datetime"
import RegionPage from "./region"
import UsersPage from "./users"
import type { PageContext } from "."

// GNOME Settings > System: Region & Language, Date & Time, Users, Secure
// Shell and About. (Remote Desktop needs Mutter and is descoped.)

const HOSTNAME = ["org.freedesktop.hostname1", "/org/freedesktop/hostname1", "org.freedesktop.hostname1"] as const
const SYSTEMD = ["org.freedesktop.systemd1", "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager"] as const
const decoder = new TextDecoder()

function readFile(path: string) {
  try {
    return decoder.decode(GLib.file_get_contents(path)[1])
  } catch {
    return ""
  }
}

function run(argv: string[]) {
  try {
    const [, out] = GLib.spawn_sync(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null)
    return out ? decoder.decode(out).trim() : ""
  } catch {
    return ""
  }
}

function osRelease(): Record<string, string> {
  return Object.fromEntries(
    readFile("/etc/os-release")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=")
        return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]
      }),
  )
}

function processor() {
  const info = readFile("/proc/cpuinfo")
  const model = info.match(/model name\s*:\s*(.+)/)?.[1]?.replace(/\s+/g, " ").replace(/\(R\)|\(TM\)/g, (m) => (m === "(R)" ? "®" : "™")) ?? "Unknown"
  const count = (info.match(/^processor\s*:/gm) ?? []).length
  return count > 1 ? `${model.replace(/ \d+-Core Processor$/, "")} × ${count}` : model
}

function memory() {
  const kb = Number(readFile("/proc/meminfo").match(/MemTotal:\s*(\d+)/)?.[1] ?? 0)
  return GLib.format_size_full(kb * 1024, GLib.FormatSizeFlags.IEC_UNITS)
}

// Sum of the non-removable disks, like GNOME
function disks() {
  let bytes = 0
  const dir = Gio.File.new_for_path("/sys/block")
  try {
    const it = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
    for (let info = it.next_file(null); info; info = it.next_file(null)) {
      const name = info.get_name()
      if (/^(loop|ram|zram|sr|dm-)/.test(name)) continue
      if (readFile(`/sys/block/${name}/removable`).trim() === "1") continue
      bytes += Number(readFile(`/sys/block/${name}/size`).trim() || 0) * 512
    }
  } catch {
    // no /sys/block
  }
  return bytes ? GLib.format_size(bytes) : "Unknown"
}

function graphics() {
  return run(["lspci", "-mm"])
    .split("\n")
    .filter((l) => /VGA|Display|3D/.test(l))
    .map((l) => {
      const f = [...l.matchAll(/"([^"]*)"/g)].map((m) => m[1])
      return f[2]?.replace(/\[|\]/g, "") ?? f[1] ?? ""
    })
    .filter(Boolean)
    .join(", ")
}

function infoRow(title: string, value: string) {
  const row = new Adw.ActionRow({ title, subtitle: GLib.markup_escape_text(value, -1), subtitleSelectable: true })
  row.add_css_class("property")
  return row
}

// ---- About ----

function renameDialog(parent: Gtk.Widget, current: string, done: () => void) {
  const g = new Adw.PreferencesGroup({ description: "The device name is used to identify this device when it is viewed over the network or when pairing Bluetooth devices." })
  const entry = new Adw.EntryRow({ title: "Device Name", text: current })
  g.add(entry)
  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const rename = new Gtk.Button({ label: "_Rename", useUnderline: true })
  rename.add_css_class("suggested-action")
  const dlg = dialog({ title: "Rename Device", content: dialogBox(g), width: 440, start: cancel, end: rename })
  cancel.connect("clicked", () => dlg.close())
  rename.connect("clicked", async () => {
    const pretty = entry.text.trim()
    if (!pretty) return
    dlg.close()
    // GNOME sets the pretty name and a hostname-safe static name
    const statik = pretty.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "localhost"
    try {
      await call(...HOSTNAME, "SetPrettyHostname", new GLib.Variant("(sb)", [pretty, true]))
      await call(...HOSTNAME, "SetStaticHostname", new GLib.Variant("(sb)", [statik, true]))
      done()
    } catch (err) {
      report(parent, "Could Not Rename the Device")(err)
    }
  })
  dlg.present(parent)
}

function detailsPage() {
  const os = osRelease()
  const host = properties(...HOSTNAME)
  const g = group("Software")
  g.add(infoRow("OS Name", os.PRETTY_NAME ?? "cobalt"))
  g.add(infoRow("OS Type", run(["uname", "-m"]).endsWith("64") ? "64-bit" : "32-bit"))
  g.add(infoRow("Kernel Version", run(["uname", "-r"])))
  g.add(infoRow("Windowing System", "Wayland (Hyprland)"))
  const hyprVersion = infoRow("Hyprland Version", "…")
  hyprJson<{ tag?: string; version?: string }>("version")
    .then((v) => (hyprVersion.subtitle = v.tag ?? v.version ?? "Unknown"))
    .catch(() => (hyprVersion.subtitle = "Unknown"))
  g.add(hyprVersion)
  const image = run(["bash", "-c", "rpm-ostree status --booted --json 2>/dev/null | grep -o '\"container-image-reference\" *: *\"[^\"]*' | head -1 | sed 's/.*\"//'"])
  if (image) g.add(infoRow("Image", image.replace(/^ostree-[a-z-]+:(docker:\/\/)?/, "")))

  const hw = group("Hardware")
  hw.add(infoRow("Hardware Model", [host.HardwareVendor, host.HardwareModel].filter(Boolean).join(" ") || "Unknown"))
  if (host.FirmwareVersion) hw.add(infoRow("Firmware Version", String(host.FirmwareVersion)))
  hw.add(infoRow("Processor", processor()))
  hw.add(infoRow("Memory", memory()))
  hw.add(infoRow("Disk Capacity", disks()))
  hw.add(infoRow("Graphics", graphics() || "Unknown"))
  return page({ title: "System Details", content: prefsPage(g, hw) })
}

function aboutPage(ctx: PageContext) {
  const os = osRelease()
  const logo = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, halign: Gtk.Align.CENTER, marginTop: 12, marginBottom: 12 })
  const name = new Gtk.Label({ label: os.NAME ?? "cobalt" })
  name.add_css_class("os-logo")
  logo.append(name)
  const top = group()
  top.add(logo)

  const device = group()
  const deviceRow = new Adw.ActionRow({ title: "Device Name", activatable: true })
  deviceRow.add_css_class("property")
  const edit = new Gtk.Image({ iconName: "document-edit-symbolic" })
  deviceRow.add_suffix(edit)
  const refresh = () => {
    const host = properties(...HOSTNAME)
    deviceRow.subtitle = GLib.markup_escape_text(String(host.PrettyHostname || host.StaticHostname || GLib.get_host_name()), -1)
  }
  deviceRow.connect("activated", () => renameDialog(deviceRow, deviceRow.subtitle, refresh))
  refresh()
  device.add(deviceRow)

  const host = properties(...HOSTNAME)
  const info = group()
  info.add(infoRow("Operating System", os.PRETTY_NAME ?? "cobalt"))
  info.add(infoRow("Hardware Model", [host.HardwareVendor, host.HardwareModel].filter(Boolean).join(" ") || "Unknown"))
  info.add(infoRow("Processor", processor()))
  info.add(infoRow("Memory", memory()))
  info.add(infoRow("Disk Capacity", disks()))
  info.add(navRow("System Details", () => ctx.push(detailsPage)))
  return page({ title: "About", content: prefsPage(top, device, info) })
}

// ---- Secure Shell ----

function sshPage() {
  const g = group("", "Allow remote connections to this device with SSH")
  const toggle = new Adw.SwitchRow({ title: "Secure Shell" })
  const how = new Adw.ActionRow({ title: "Connect With" })
  how.add_css_class("property")
  const unitState = () => run(["systemctl", "is-active", "sshd.service"]) === "active"
  const refresh = () => {
    toggle.active = unitState()
    const ip4 = network.client
      .get_active_connections()
      .flatMap((ac) => ac.get_ip4_config()?.get_addresses() ?? [])
      .map((a) => a.get_address())
      .filter((a, i, all) => !a.startsWith("127.") && all.indexOf(a) === i)
    how.subtitle = GLib.markup_escape_text(
      [GLib.get_host_name(), ...ip4].map((h) => `ssh ${GLib.get_user_name()}@${h}`).join("\n"),
      -1,
    )
    how.visible = toggle.active
  }
  toggle.connect("notify::active", async () => {
    if (toggle.active === unitState()) return
    try {
      if (toggle.active) {
        await call(...SYSTEMD, "EnableUnitFiles", new GLib.Variant("(asbb)", [["sshd.service"], false, false]))
        await call(...SYSTEMD, "StartUnit", new GLib.Variant("(ss)", ["sshd.service", "replace"]))
      } else {
        await call(...SYSTEMD, "StopUnit", new GLib.Variant("(ss)", ["sshd.service", "replace"]))
        await call(...SYSTEMD, "DisableUnitFiles", new GLib.Variant("(asb)", [["sshd.service"], false]))
      }
    } catch (err) {
      report(toggle, "Could Not Change Secure Shell")(err)
    }
    // systemd needs a moment to report the new state
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
      refresh()
      return GLib.SOURCE_REMOVE
    })
  })
  g.add(toggle)
  g.add(how)
  refresh()
  return page({ title: "Secure Shell", content: prefsPage(g) })
}

// ---- The page ----

export default function SystemPage(ctx: PageContext) {
  const g = group()
  const rows: [string, string, string, () => Adw.NavigationPage][] = [
    ["Region & Language", "System language and localization", "org.gnome.Settings-region-symbolic", RegionPage],
    ["Date & Time", "Time zone and clock settings", "org.gnome.Settings-time-symbolic", DateTimePage],
    ["Users", "Add and remove accounts, change password", "org.gnome.Settings-users-symbolic", () => UsersPage(ctx)],
    ["Secure Shell", "SSH network access", "org.gnome.Settings-secure-shell-symbolic", sshPage],
    ["About", "Hardware details and software versions", "org.gnome.Settings-about-symbolic", () => aboutPage(ctx)],
  ]
  for (const [title, subtitle, icon, build] of rows) {
    const row = navRow(title, () => ctx.push(build))
    row.subtitle = subtitle
    row.add_prefix(new Gtk.Image({ iconName: icon }))
    g.add(row)
  }
  ctx.action("region", () => ctx.push(RegionPage))
  ctx.action("datetime", () => ctx.push(DateTimePage))
  ctx.action("users", () => ctx.push(() => UsersPage(ctx)))
  ctx.action("ssh", () => ctx.push(sshPage))
  ctx.action("about", () => ctx.push(() => aboutPage(ctx)))
  ctx.action("details", () => ctx.push(detailsPage))
  return page({ title: "System", content: prefsPage(g) })
}
