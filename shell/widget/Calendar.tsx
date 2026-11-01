import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { Accessor, For, createComputed, createState } from "ags"

type Day = { date: GLib.DateTime; key: string }

const keyOf = (d: GLib.DateTime) => d.format("%Y-%m-%d")!

// The 6x7 grid for a month, starting on Sunday like GNOME's US layout
function monthGrid(year: number, month: number): Day[] {
  const first = GLib.DateTime.new_local(year, month, 1, 0, 0, 0)
  const start = first.add_days(-(first.get_day_of_week() % 7))
  return Array.from({ length: 42 }, (_, i) => {
    const date = start.add_days(i)
    return { date, key: keyOf(date) }
  })
}

// GNOME-style month calendar: month with arrows, weekday initials, bold
// weekdays and dim weekends, today in an accent circle, the selected day ringed
export default function Calendar({ now }: { now: Accessor<GLib.DateTime | null> }) {
  const today = GLib.DateTime.new_now_local()
  const [view, setView] = createState({ year: today.get_year(), month: today.get_month() })
  const [selected, setSelected] = createState(keyOf(today))
  const todayKey = now((n) => (n ? keyOf(n) : keyOf(today)))

  const days = createComputed(() => monthGrid(view().year, view().month))
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
            setSelected(keyOf(today))
          }}
        >
          <label label={title} />
        </button>
        <button class="nav" valign={Gtk.Align.CENTER} onClicked={() => shift(1)}>
          <image iconName="go-next-symbolic" />
        </button>
      </box>
      <box homogeneous>
        {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
          <label class="weekday" label={d} />
        ))}
      </box>
      <For each={rows}>
        {(week: Day[]) => (
          <box homogeneous>
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
              return (
                <button class={cls} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} onClicked={() => setSelected(key)}>
                  <label label={date.format("%d")!} />
                </button>
              )
            })}
          </box>
        )}
      </For>
    </box>
  )
}
