import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { createState } from "ags"
import { execAsync } from "ags/process"

// Night Light, GNOME-style: the Settings app writes GNOME's color plugin keys
// (enabled, from/to hours, temperature) and the shell applies them through
// hyprsunset's IPC (hyprsunset.service runs with --identity all session).
// The quick settings toggle overrides the schedule until its next change,
// like GNOME's "until tomorrow".

const color = new Gio.Settings({ schemaId: "org.gnome.settings-daemon.plugins.color" })

const [active, setActive] = createState(false)
export { active as nightLightActive }

// Manual override from quick settings, valid until the next schedule edge
let override: { on: boolean; until: number } | null = null
let applied: string | null = null

function hoursNow() {
  const now = GLib.DateTime.new_now_local()
  return now.get_hour() + now.get_minute() / 60
}

function inSchedule(h: number) {
  const from = color.get_double("night-light-schedule-from")
  const to = color.get_double("night-light-schedule-to")
  return from > to ? h >= from || h < to : h >= from && h < to
}

// Seconds until the clock next crosses `from` or `to`
function secondsToNextEdge() {
  const h = hoursNow()
  const next = [color.get_double("night-light-schedule-from"), color.get_double("night-light-schedule-to")]
    .map((edge) => (edge - h + 24) % 24 || 24)
    .reduce((a, b) => Math.min(a, b))
  return next * 3600
}

function evaluate() {
  const now = GLib.get_real_time() / 1e6
  if (override && now >= override.until) override = null
  const on = override ? override.on : color.get_boolean("night-light-enabled") && inSchedule(hoursNow())
  setActive(on)
  const cmd = on ? `temperature ${color.get_uint("night-light-temperature")}` : "identity"
  if (cmd === applied) return
  execAsync(["hyprctl", "hyprsunset", ...cmd.split(" ")])
    .then(() => (applied = cmd))
    .catch(() => (applied = null)) // hyprsunset not up yet; next tick retries
}

export function toggleNightLight() {
  const on = !active.get()
  // Turning it on in Settings terms when it's off entirely
  if (on && !color.get_boolean("night-light-enabled")) color.set_boolean("night-light-enabled", true)
  override = on === (color.get_boolean("night-light-enabled") && inSchedule(hoursNow()))
    ? null
    : { on, until: GLib.get_real_time() / 1e6 + secondsToNextEdge() }
  evaluate()
}

export function startNightLight() {
  for (const key of ["night-light-enabled", "night-light-schedule-from", "night-light-schedule-to", "night-light-temperature"])
    color.connect(`changed::${key}`, () => {
      override = null
      evaluate()
    })
  GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
    evaluate()
    return GLib.SOURCE_CONTINUE
  })
  evaluate()
}
