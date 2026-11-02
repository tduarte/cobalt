import GioUnix from "gi://GioUnix"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import GWeather from "gi://GWeather?version=4.0"
import { Accessor, For, With, createComputed, createState } from "ags"
import { CalendarEvent, events, eventsOn } from "../lib/calendar"
import { closeMenus } from "../lib/menus"
import { clocks, weatherLocation } from "../lib/places"
import { interfaceSettings, sh } from "../lib/system"
import { selectedDay } from "./Calendar"

// The cards under the date menu's calendar, like GNOME 48: the selected day's
// events, world clocks (GNOME Clocks) and the weather (GNOME Weather). Each
// card opens its app.

// Open a Flatpak or host app by desktop id, in its own scope like the launcher
function openApp(id: string) {
  closeMenus()
  const info = GioUnix.DesktopAppInfo.new(`${id}.desktop`)
  if (!info) return
  sh(`systemd-run --user --scope --quiet --collect --slice=app-graphical.slice gio launch '${info.get_filename()}'`)
}

const hasApp = (id: string) => GioUnix.DesktopAppInfo.new(`${id}.desktop`) !== null

function timeFormat() {
  return interfaceSettings.get_string("clock-format") === "12h" ? "%-I:%M %p" : "%H:%M"
}

function Card({ onClicked, children }: { onClicked: () => void; children: JSX.Element | JSX.Element[] }) {
  return (
    <button class="date-card" hexpand onClicked={onClicked}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        {children}
      </box>
    </button>
  )
}

// ---- Events ----

function dayTitle(day: GLib.DateTime) {
  const today = GLib.DateTime.new_now_local()
  const diff = Math.round(
    (GLib.DateTime.new_local(day.get_year(), day.get_month(), day.get_day_of_month(), 12, 0, 0).to_unix() -
      GLib.DateTime.new_local(today.get_year(), today.get_month(), today.get_day_of_month(), 12, 0, 0).to_unix()) /
      86400,
  )
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff === -1) return "Yesterday"
  return day.get_year() === today.get_year() ? day.format("%A, %B %-d")! : day.format("%A, %B %-d %Y")!
}

function eventTime(e: CalendarEvent, day: GLib.DateTime) {
  if (e.allDay) return "All Day"
  const start = GLib.DateTime.new_from_unix_local(e.start)
  // Started on an earlier day: GNOME shows where it continues from
  if (start.format("%F") !== day.format("%F")) return "…"
  return start.format(timeFormat())!
}

export function EventsCard() {
  const items = createComputed(() => {
    const day = selectedDay()
    return { day, list: eventsOn(events(), day) }
  })
  return (
    <Card onClicked={() => openApp("org.gnome.Calendar")}>
      <label class="date-card-title" xalign={0} label={selectedDay(dayTitle)} />
      <With value={items}>
        {({ day, list }: { day: GLib.DateTime; list: CalendarEvent[] }) => (
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            {list.length === 0 ? (
              <label class="date-card-dim" xalign={0} label="No Events" />
            ) : (
              list.slice(0, 6).map((e) => (
                <box spacing={12}>
                  <label class="event-time" xalign={0} widthChars={8} label={eventTime(e, day)} />
                  <label class="event-summary" xalign={0} hexpand ellipsize={3} maxWidthChars={28} label={e.summary} />
                </box>
              ))
            )}
            {list.length > 6 && <label class="date-card-dim" xalign={0} label={`${list.length - 6} more`} />}
          </box>
        )}
      </With>
    </Card>
  )
}

// ---- World clocks ----

// A city's name; for a weather station (an airport), the nearest city's
function cityName(loc: GWeather.Location) {
  if (loc.get_level() === GWeather.LocationLevel.WEATHER_STATION && loc.has_coords()) {
    const [lat, lon] = loc.get_coords()
    const city = GWeather.Location.get_world()?.find_nearest_city(lat, lon)
    if (city) return city.get_city_name() ?? city.get_name() ?? ""
  }
  return loc.get_city_name() ?? loc.get_name() ?? ""
}

function clockRow(loc: GWeather.Location, now: GLib.DateTime) {
  const tz = loc.get_timezone()
  const there = tz ? now.to_timezone(tz) : now
  const here = now.to_local()
  // "+3h", "−5h30" relative to here, like GNOME
  const offset = (there.get_utc_offset() - here.get_utc_offset()) / 1_000_000 / 60
  const sign = offset < 0 ? "−" : "+"
  const h = Math.floor(Math.abs(offset) / 60)
  const m = Math.abs(offset) % 60
  const diff = offset === 0 ? "" : `${sign}${h}h${m ? String(m).padStart(2, "0") : ""}`
  const dayDiff = there.get_day_of_year() !== here.get_day_of_year() ? ` ${there.format("%a")}` : ""
  return { city: cityName(loc), time: there.format(timeFormat())! + dayDiff, diff }
}

export function ClocksCard({ now }: { now: Accessor<GLib.DateTime | null> }) {
  const rows = createComputed(() => {
    const n = now() ?? GLib.DateTime.new_now_local()
    return clocks().map((loc) => clockRow(loc, n))
  })
  return (
    <box visible={hasApp("org.gnome.clocks")}>
      <Card onClicked={() => openApp("org.gnome.clocks")}>
        <label class="date-card-title" xalign={0} label="World Clocks" />
        <label class="date-card-dim" xalign={0} label="Add world clocks…" visible={clocks((c) => c.length === 0)} />
        <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
          <For each={rows}>
            {(r: { city: string; time: string; diff: string }) => (
              <box spacing={12}>
                <label xalign={0} hexpand ellipsize={3} label={r.city} />
                <label class="date-card-dim" label={r.diff} />
                <label class="clock-time" xalign={1} label={r.time} />
              </box>
            )}
          </For>
        </box>
      </Card>
    </box>
  )
}

// ---- Weather ----

type Forecast = { time: string; icon: string; temp: string }
type Weather = { place: string; items: Forecast[]; status: string }

const [weather, setWeather] = createState<Weather | null>(null)
let info: GWeather.Info | null = null

function temperature(i: GWeather.Info) {
  const [ok, value] = i.get_value_temp(GWeather.TemperatureUnit.DEFAULT)
  return ok ? `${Math.round(value)}°` : ""
}

function updateWeather() {
  if (!info) return
  const loc = weatherLocation.get()
  const place = loc ? cityName(loc) : ""
  if (!info.is_valid()) {
    setWeather({ place, items: [], status: info.network_error() ? "Go online for weather information" : "Loading…" })
    return
  }
  // Now, then every 2 hours, like GNOME (5 slots)
  const items: Forecast[] = [{ time: "Now", icon: info.get_symbolic_icon_name(), temp: temperature(info) }]
  const now = GLib.DateTime.new_now_local().to_unix()
  const hourly = info
    .get_forecast_list()
    .map((f) => ({ f, when: f.get_value_update()[1] }))
    .filter(({ when }) => when > now)
    .sort((a, b) => a.when - b.when)
  const first = hourly[0]?.when ?? now
  for (const { f, when } of hourly) {
    if (items.length >= 5) break
    // 2, 4, 6, 8 hours after the next full hour
    if ((when - first) / 3600 !== (items.length - 1) * 2 + 1) continue
    items.push({
      time: GLib.DateTime.new_from_unix_local(when).format(timeFormat().includes("%p") ? "%-I %p" : "%H:%M")!,
      icon: f.get_symbolic_icon_name(),
      temp: temperature(f),
    })
  }
  setWeather({ place, items, status: "" })
}

function followWeather(loc: GWeather.Location | null) {
  if (!loc) {
    info = null
    setWeather(null)
    return
  }
  info = new GWeather.Info({ location: loc, applicationId: "io.github.tduarte.cobalt", contactInfo: "https://github.com/tduarte/cobalt" })
  info.set_enabled_providers(GWeather.Provider.METAR | GWeather.Provider.MET_NO)
  info.connect("updated", updateWeather)
  info.update()
  updateWeather()
}

let started = false
function startWeather() {
  if (started) return
  started = true
  weatherLocation.subscribe(() => followWeather(weatherLocation.get()))
  followWeather(weatherLocation.get())
  // GNOME Weather's own refresh interval is about half an hour
  GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 30 * 60, () => {
    info?.update()
    return GLib.SOURCE_CONTINUE
  })
}

export function WeatherCard() {
  startWeather()
  return (
    <box visible={hasApp("org.gnome.Weather")}>
      <Card onClicked={() => openApp("org.gnome.Weather")}>
        <box spacing={6}>
          <label class="date-card-title" xalign={0} label="Weather" />
          <label class="date-card-dim" xalign={0} hexpand ellipsize={3} label={weather((w) => w?.place ?? "")} />
        </box>
        <label
          class="date-card-dim"
          xalign={0}
          visible={weather((w) => !w || w.status !== "")}
          label={weather((w) => (w ? w.status : "Select weather location…"))}
        />
        <box homogeneous visible={weather((w) => (w?.items.length ?? 0) > 0)}>
          <For each={weather((w) => w?.items ?? [])}>
            {(f: Forecast) => (
              <box orientation={Gtk.Orientation.VERTICAL} spacing={4} class="forecast">
                <label class="date-card-dim forecast-time" label={f.time} />
                <image iconName={f.icon} pixelSize={24} />
                <label class="forecast-temp" label={f.temp} />
              </box>
            )}
          </For>
        </box>
      </Card>
    </box>
  )
}
