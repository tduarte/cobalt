import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, For, With, createComputed, createState } from "ags"
import { events, eventsOn, setRange } from "../lib/calendar"

type Day = { date: GLib.DateTime; key: string }

const keyOf = (d: GLib.DateTime) => d.format("%Y-%m-%d")!

// The selected day, shared with the date menu's events card
const [selectedDay, setSelectedDay] = createState(GLib.DateTime.new_now_local())
export { selectedDay }

// Settings > System > Date & Time: first day of the week and week numbers
// (GNOME's calendar keys)
const calendarSettings = new Gio.Settings({ schemaId: "org.gnome.desktop.calendar" })
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

// 0 = Sunday. "default" follows the formats locale: Sunday for the US-style
// calendars, Monday elsewhere
function weekStart() {
  const day = calendarSettings.get_string("week-start-day")
  if (day !== "default") return WEEKDAYS.indexOf(day)
  const locale = GLib.getenv("LC_TIME") || GLib.getenv("LANG") || "en_US"
  return /^(en_US|en_CA|en_PH|pt_BR|ja|ko|zh_TW|he|ar_SA|es_MX|hi)/.test(locale) ? 0 : 1
}

// The 6x7 grid for a month, from the first day of the week
function monthGrid(year: number, month: number, start: number): Day[] {
  const first = GLib.DateTime.new_local(year, month, 1, 0, 0, 0)
  const offset = (first.get_day_of_week() % 7 - start + 7) % 7
  const startDay = first.add_days(-offset)
  return Array.from({ length: 42 }, (_, i) => {
    const date = startDay.add_days(i)
    return { date, key: keyOf(date) }
  })
}

// GNOME-style month calendar: month with arrows, weekday initials, bold
// weekdays and dim weekends, today in an accent circle, the selected day ringed
export default function Calendar({ now }: { now: Accessor<GLib.DateTime | null> }) {
  const today = GLib.DateTime.new_now_local()
  const [view, setView] = createState({ year: today.get_year(), month: today.get_month() })
  const selected = selectedDay((d) => keyOf(d))
  const setSelected = (date: GLib.DateTime) => setSelectedDay(date)
  const [start, setStart] = createState(weekStart())
  const [weekNumbers, setWeekNumbers] = createState(calendarSettings.get_boolean("show-weekdate"))
  calendarSettings.connect("changed::week-start-day", () => setStart(weekStart()))
  calendarSettings.connect("changed::show-weekdate", () => setWeekNumbers(calendarSettings.get_boolean("show-weekdate")))
  const todayKey = now((n) => (n ? keyOf(n) : keyOf(today)))

  const days = createComputed(() => monthGrid(view().year, view().month, start()))
  // Ask GNOME's calendar server for the events in the visible grid
  days.subscribe(() => {
    const ds = days.get()
    setRange(ds[0].date.to_unix(), ds[ds.length - 1].date.add_days(1).to_unix())
  })
  {
    const ds = days.get()
    setRange(ds[0].date.to_unix(), ds[ds.length - 1].date.add_days(1).to_unix())
  }
  // Weekday initials from the first day of the week; an empty first column
  // lines up with the week numbers
  const initials = createComputed(() => [
    ...(weekNumbers() ? [""] : []),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => "SMTWTFS"[(i + start()) % 7]),
  ])
  const title = view(({ year, month }) => {
    const d = GLib.DateTime.new_local(year, month, 1, 0, 0, 0)
    return year === today.get_year() ? d.format("%B")! : d.format("%B %Y")!
  })

  const shift = (delta: number) =>
    setView(({ year, month }) => {
      const m = month - 1 + delta
      return { year: year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 + 1 }
    })

  const rows = createComputed(() => {
    const ds = days()
    return [0, 1, 2, 3, 4, 5].map((r) => ds.slice(r * 7, r * 7 + 7))
  })

  return (
    <box class="calendar" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
      <box class="calendar-header">
        <button class="nav" valign={Gtk.Align.CENTER} onClicked={() => shift(-1)}>
          <image iconName="go-previous-symbolic" />
        </button>
        <button
          class="month"
          hexpand
          onClicked={() => {
            setView({ year: today.get_year(), month: today.get_month() })
            setSelected(GLib.DateTime.new_now_local())
          }}
        >
          <label label={title} />
        </button>
        <button class="nav" valign={Gtk.Align.CENTER} onClicked={() => shift(1)}>
          <image iconName="go-next-symbolic" />
        </button>
      </box>
      <box>
        <With value={initials}>
          {(letters: string[]) => (
            <box homogeneous hexpand>
              {letters.map((d) => (
                <label class={d ? "weekday" : "weekday week-number"} label={d} />
              ))}
            </box>
          )}
        </With>
      </box>
      <For each={rows}>
        {(week: Day[]) => (
          <box homogeneous>
            <label class="weekday week-number" visible={weekNumbers} label={week[3].date.format("%V")!} />
            {week.map(({ date, key }) => {
              const dow = date.get_day_of_week() % 7
              const base = ["day"]
              if (date.get_month() !== view.get().month) base.push("other-month")
              if (dow === 0 || dow === 6) base.push("weekend")
              const cls = createComputed(() => {
                const c = [...base]
                if (key === todayKey()) c.push("today")
                if (key === selected() && key !== todayKey()) c.push("selected")
                return c.join(" ")
              })
              // GNOME marks days that have events with a dot
              const busy = events((list) => eventsOn(list, date).length > 0)
              return (
                <button class={cls} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} onClicked={() => setSelected(date)}>
                  <overlay>
                    <label label={date.format("%d")!} />
                    <box $type="overlay" class="event-dot" halign={Gtk.Align.CENTER} valign={Gtk.Align.END} visible={busy} />
                  </overlay>
                </button>
              )
            })}
          </box>
        )}
      </For>
    </box>
  )
}
