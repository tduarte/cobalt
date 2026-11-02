import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { createState } from "ags"

// Calendar events for the date menu, from GNOME Shell's own calendar server
// (gnome-shell-calendar-server, D-Bus activated; it reads Evolution Data
// Server, so it has every calendar GNOME Calendar and Online Accounts set
// up). We tell it which days the calendar shows and it streams the events.

export type CalendarEvent = { id: string; summary: string; start: number; end: number; allDay: boolean }

const [events, setEvents] = createState<CalendarEvent[]>([])
export { events }

const byId = new Map<string, CalendarEvent>()
let proxy: Gio.DBusProxy | null = null
let range: [number, number] | null = null

// The server gives all-day events as midnight to midnight
function isAllDay(start: number, end: number) {
  const s = GLib.DateTime.new_from_unix_local(start)
  const e = GLib.DateTime.new_from_unix_local(end)
  return end > start && s.get_hour() === 0 && s.get_minute() === 0 && e.get_hour() === 0 && e.get_minute() === 0
}

function publish() {
  setEvents([...byId.values()].sort((a, b) => a.start - b.start || a.summary.localeCompare(b.summary)))
}

function connect() {
  Gio.DBusProxy.new_for_bus(
    Gio.BusType.SESSION,
    Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
    null,
    "org.gnome.Shell.CalendarServer",
    "/org/gnome/Shell/CalendarServer",
    "org.gnome.Shell.CalendarServer",
    null,
    (_s, res) => {
      try {
        proxy = Gio.DBusProxy.new_for_bus_finish(res)
      } catch (err) {
        console.error("calendar server", err)
        return
      }
      proxy.connect("g-signal", (_p, _sender, signal: string, params: GLib.Variant) => {
        if (signal === "EventsAddedOrUpdated") {
          const [list] = params.deepUnpack() as [[string, string, number, number, unknown][]]
          for (const [id, summary, start, end] of list)
            byId.set(id, { id, summary, start, end, allDay: isAllDay(start, end) })
        } else if (signal === "EventsRemoved") {
          const [ids] = params.deepUnpack() as [string[]]
          for (const id of ids) byId.delete(id)
        } else if (signal === "ClientDisappeared") {
          // Event ids start with their calendar's source id
          const [source] = params.deepUnpack() as [string]
          for (const id of [...byId.keys()]) if (id.startsWith(`${source}\n`)) byId.delete(id)
        } else return
        publish()
      })
      // A fresh connection loads everything, like GNOME Shell
      if (range) setRange(range[0], range[1], true)
    },
  )
}

// The days the calendar shows (unix seconds); GNOME asks for the month grid
export function setRange(since: number, until: number, force = false) {
  range = [since, until]
  if (!proxy) {
    connect()
    return
  }
  // Events outside the new range go away; the server sends the ones inside
  for (const [id, e] of byId) if (e.end <= since || e.start >= until) byId.delete(id)
  publish()
  proxy.call("SetTimeRange", new GLib.Variant("(xxb)", [since, until, force]), Gio.DBusCallFlags.NONE, -1, null, null)
}

// The date menu opened: pick up calendars and events added meanwhile
export function reloadEvents() {
  if (range) setRange(range[0], range[1], true)
}

// Events on a day ("YYYY-MM-DD"), all-day ones first
export function eventsOn(list: CalendarEvent[], day: GLib.DateTime) {
  const start = GLib.DateTime.new_local(day.get_year(), day.get_month(), day.get_day_of_month(), 0, 0, 0)
  const since = start.to_unix()
  const until = start.add_days(1).to_unix()
  return list
    .filter((e) => e.start < until && (e.end > since || (e.end === e.start && e.start >= since)))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)
}
