import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { call, properties, report } from "../lib/dbus"
import { dialog, dialogBox, every, group, navRow, page, pickDialog, prefsPage } from "../lib/ui"

// GNOME Settings > System > Date & Time: automatic time (timedate1 NTP),
// automatic time zone (gnome-settings-daemon's datetime plugin, our session
// runs it), time zone, 12/24 hours, first weekday and the top bar clock
// options (GNOME's keys; the shell honors them).

const TIMEDATE = ["org.freedesktop.timedate1", "/org/freedesktop/timedate1", "org.freedesktop.timedate1"] as const
const iface = new Gio.Settings({ schemaId: "org.gnome.desktop.interface" })
const calendar = new Gio.Settings({ schemaId: "org.gnome.desktop.calendar" })
const datetime = new Gio.Settings({ schemaId: "org.gnome.desktop.datetime" })

const timedate = () => properties(...TIMEDATE)

// "America/Los_Angeles" → "PST (Los Angeles, America)", like GNOME's row
function zoneLabel(tz: string) {
  const zone = GLib.TimeZone.new_identifier(tz)
  const abbr = zone ? GLib.DateTime.new_now(zone).format("%Z") : ""
  const parts = tz.split("/")
  const city = parts[parts.length - 1].replace(/_/g, " ")
  const region = parts.length > 1 ? parts[0].replace(/_/g, " ") : ""
  return `${abbr} (${[city, region].filter(Boolean).join(", ")})`
}

function nowLabel() {
  const twelve = iface.get_string("clock-format") === "12h"
  return GLib.DateTime.new_now_local().format(twelve ? "%-d %B %Y, %-I:%M %p" : "%-d %B %Y, %H:%M")!
}

// Manual date and time (only when automatic time is off)
function setTimeDialog(parent: Gtk.Widget, done: () => void) {
  const now = GLib.DateTime.new_now_local()
  const spin = (lower: number, upper: number, value: number) =>
    new Gtk.SpinButton({
      orientation: Gtk.Orientation.VERTICAL,
      adjustment: new Gtk.Adjustment({ lower, upper, stepIncrement: 1, value }),
      numeric: true,
      wrap: true,
    })
  const day = spin(1, 31, now.get_day_of_month())
  const month = spin(1, 12, now.get_month())
  const year = spin(1970, 2100, now.get_year())
  const hour = spin(0, 23, now.get_hour())
  const minute = spin(0, 59, now.get_minute())
  const row = new Gtk.Box({ spacing: 8, halign: Gtk.Align.CENTER })
  for (const [w, sep] of [
    [day, "/"],
    [month, "/"],
    [year, ""],
    [hour, ":"],
    [minute, ""],
  ] as [Gtk.SpinButton, string][]) {
    row.append(w)
    if (sep) row.append(new Gtk.Label({ label: sep }))
    if (w === year) row.append(new Gtk.Box({ widthRequest: 24 }))
  }
  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const set = new Gtk.Button({ label: "_Set", useUnderline: true })
  set.add_css_class("suggested-action")
  const dlg = dialog({ title: "Date & Time", content: dialogBox(row), width: 460, start: cancel, end: set })
  cancel.connect("clicked", () => dlg.close())
  set.connect("clicked", () => {
    const when = GLib.DateTime.new_local(year.value, month.value, day.value, hour.value, minute.value, 0)
    call(...TIMEDATE, "SetTime", new GLib.Variant("(xbb)", [when.to_unix() * 1_000_000, false, true]))
      .then(done)
      .catch(report(parent, "Could Not Set the Time"))
    dlg.close()
  })
  dlg.present(parent)
}

function timezoneDialog(parent: Gtk.Widget, current: string, done: () => void) {
  call(...TIMEDATE, "ListTimezones", null, "(as)")
    .then(([zones]) => {
      pickDialog({
        parent,
        title: "Select Time Zone",
        items: (zones as string[]).map((tz) => ({ id: tz, label: zoneLabel(tz), detail: tz })),
        current,
        onPick: (tz) =>
          call(...TIMEDATE, "SetTimezone", new GLib.Variant("(sb)", [tz, true]))
            .then(done)
            .catch(report(parent, "Could Not Set the Time Zone")),
      })
    })
    .catch(report(parent, "Could Not List Time Zones"))
}

const WEEKDAYS: [string, string][] = [
  ["default", "Locale Default"],
  ["monday", "Monday"],
  ["tuesday", "Tuesday"],
  ["wednesday", "Wednesday"],
  ["thursday", "Thursday"],
  ["friday", "Friday"],
  ["saturday", "Saturday"],
  ["sunday", "Sunday"],
]

export default function DateTimePage() {
  const time = group()
  const auto = new Adw.SwitchRow({ title: "Automatic Date &amp; Time", subtitle: "Requires internet access" })
  const manual = navRow("Date & Time", () => setTimeDialog(manual, refresh), "")

  const zone = group()
  const autoZone = new Adw.SwitchRow({
    title: "Automatic Time Zone",
    subtitle: "Requires location services enabled and internet access",
  })
  datetime.bind("automatic-timezone", autoZone, "active", Gio.SettingsBindFlags.DEFAULT)
  const zoneRow = navRow("Time Zone", () => timezoneDialog(zoneRow, String(timedate().Timezone ?? ""), refresh), "")

  const refresh = () => {
    const td = timedate()
    auto.active = Boolean(td.NTP)
    auto.sensitive = td.CanNTP !== false
    manual.sensitive = !td.NTP
    manual.valueLabel!.label = nowLabel()
    zoneRow.valueLabel!.label = zoneLabel(String(td.Timezone ?? "UTC"))
    zoneRow.sensitive = !autoZone.active
  }
  auto.connect("notify::active", () => {
    if (auto.active === Boolean(timedate().NTP)) return
    call(...TIMEDATE, "SetNTP", new GLib.Variant("(bb)", [auto.active, true]))
      .then(refresh)
      .catch((err) => {
        report(auto, "Could Not Change Automatic Time")(err)
        refresh()
      })
  })
  autoZone.connect("notify::active", refresh)
  time.add(auto)
  time.add(manual)
  zone.add(autoZone)
  zone.add(zoneRow)

  const format = group()
  const formatRow = new Adw.ActionRow({ title: "Time Format" })
  const toggles = new Adw.ToggleGroup({ valign: Gtk.Align.CENTER })
  toggles.add(new Adw.Toggle({ name: "24h", label: "24-hour" }))
  toggles.add(new Adw.Toggle({ name: "12h", label: "AM / PM" }))
  toggles.activeName = iface.get_string("clock-format")
  toggles.connect("notify::active-name", () => {
    iface.set_string("clock-format", toggles.activeName)
    refresh()
  })
  formatRow.add_suffix(toggles)
  const weekStart = new Adw.ComboRow({ title: "First Day of the Week", model: Gtk.StringList.new(WEEKDAYS.map(([, l]) => l)) })
  weekStart.selected = Math.max(0, WEEKDAYS.findIndex(([v]) => v === calendar.get_string("week-start-day")))
  weekStart.connect("notify::selected", () => calendar.set_string("week-start-day", WEEKDAYS[weekStart.selected][0]))
  format.add(formatRow)
  format.add(weekStart)

  const clock = group("Clock & Calendar", "Control how the time and date is shown in the top bar")
  const switches: [Gio.Settings, string, string, string?][] = [
    [iface, "clock-show-weekday", "Week Day"],
    [iface, "clock-show-date", "Date"],
    [iface, "clock-show-seconds", "Seconds"],
    [calendar, "show-weekdate", "Week Numbers", "Shown in the dropdown calendar"],
  ]
  for (const [settings, key, title, subtitle] of switches) {
    const row = new Adw.SwitchRow({ title, subtitle: subtitle ?? "" })
    settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT)
    clock.add(row)
  }

  refresh()
  every(30_000, refresh)
  return page({ title: "Date & Time", content: prefsPage(time, zone, format, clock) })
}
