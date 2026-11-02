import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { evalLua, hyprJson, lua, saveLua, SETTINGS_DIR } from "../lib/hypr"
import { group, navRow, page, prefsPage, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Displays, for Hyprland: changes apply live (hyprctl eval
// hl.monitor), then GNOME's "Keep these display settings?" countdown; kept
// settings go to ~/.config/cobalt/settings/monitors.lua.

type Monitor = {
  name: string
  description: string
  width: number
  height: number
  refreshRate: number
  x: number
  y: number
  scale: number
  transform: number
  availableModes: string[]
  colorManagementPreset?: string
  disabled: boolean
  hardwareDetails?: { hdr?: boolean; vrrCapable?: boolean }
}

// What we write to hl.monitor, plus the switches Hyprland doesn't report back
type Spec = {
  output: string
  mode: string
  position: string
  scale: number
  transform: number
  vrr: number
  cm: string
  bitdepth?: number
}

const STATE_FILE = GLib.build_filenamev([SETTINGS_DIR, "monitors.json"])
const REVERT_SECONDS = 20

const ORIENTATIONS: [number, string][] = [
  [0, "Landscape"],
  [1, "Portrait Right"],
  [3, "Portrait Left"],
  [2, "Landscape (Flipped)"],
]

const SCALES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function loadSaved(): Record<string, Spec> {
  try {
    const [, data] = GLib.file_get_contents(STATE_FILE)
    return JSON.parse(new TextDecoder().decode(data))
  } catch {
    return {}
  }
}

function saveAll(specs: Record<string, Spec>) {
  GLib.mkdir_with_parents(SETTINGS_DIR, 0o755)
  GLib.file_set_contents(STATE_FILE, JSON.stringify(specs, null, 2))
  saveLua(
    "monitors",
    "Displays",
    Object.values(specs)
      .map((s) => `hl.monitor(${lua(s)})`)
      .join("\n"),
  )
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

function aspect(w: number, h: number) {
  const g = gcd(w, h)
  const [a, b] = [w / g, h / g]
  // GNOME names these by their marketing ratio
  if (a === 8 && b === 5) return "16:10"
  if (a === 64 && b === 27) return "21:9"
  if (a === 43 && b === 18) return "21:9"
  return `${a}:${b}`
}

type Mode = { w: number; h: number; hz: number; text: string }

function parseModes(m: Monitor): Mode[] {
  return m.availableModes
    .map((text) => {
      const match = text.match(/^(\d+)x(\d+)@([\d.]+)Hz$/)
      return match ? { w: +match[1], h: +match[2], hz: +match[3], text: text.replace(/Hz$/, "") } : null
    })
    .filter((x): x is Mode => x !== null)
}

function specFor(m: Monitor, saved?: Spec): Spec {
  return {
    output: m.name,
    mode: `${m.width}x${m.height}@${m.refreshRate.toFixed(2)}`,
    position: saved?.position ?? `${m.x}x${m.y}`,
    scale: m.scale,
    transform: m.transform,
    // VRR on = in fullscreen games and video (Hyprland's 2), like our default
    vrr: saved?.vrr ?? 2,
    cm: m.colorManagementPreset === "hdr" ? "hdr" : saved?.cm ?? "srgb",
    bitdepth: saved?.bitdepth,
  }
}

function applySpec(s: Spec) {
  return evalLua(`hl.monitor(${lua(s)})`)
}

// GNOME's confirmation: revert automatically unless the user keeps it
function confirm(parent: Gtk.Widget, onKeep: () => void, onRevert: () => void) {
  let left = REVERT_SECONDS
  const body = () => `Settings changes will revert in ${left} seconds`
  const alert = new Adw.AlertDialog({ heading: "Keep Display Settings?", body: body() })
  alert.add_response("revert", "_Revert Settings")
  alert.add_response("keep", "_Keep Changes")
  alert.set_response_appearance("keep", Adw.ResponseAppearance.SUGGESTED)
  alert.closeResponse = "revert"
  const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
    left -= 1
    if (left <= 0) {
      alert.close()
      return GLib.SOURCE_REMOVE
    }
    alert.body = body()
    return GLib.SOURCE_CONTINUE
  })
  alert.connect("response", (_, id: string) => {
    GLib.source_remove(timer)
    if (id === "keep") onKeep()
    else onRevert()
  })
  alert.present(parent)
}

function comboRow<T>(title: string, options: [T, string][], current: T) {
  const row = new Adw.ComboRow({ title, model: Gtk.StringList.new(options.map(([, l]) => l)) })
  row.selected = Math.max(0, options.findIndex(([v]) => v === current))
  return Object.assign(row, { value: () => options[row.selected][0] })
}

function monitorGroup(m: Monitor, saved: Record<string, Spec>, change: (s: Spec) => void) {
  const spec = specFor(m, saved[m.name])
  const g = group()
  const modes = parseModes(m)

  const orientation = comboRow("Orientation", ORIENTATIONS, spec.transform)

  // One entry per resolution, largest first, with its aspect ratio
  const resolutions: [string, string][] = []
  for (const md of [...modes].sort((a, b) => b.w * b.h - a.w * a.h || b.w - a.w)) {
    const key = `${md.w}x${md.h}`
    if (!resolutions.some(([k]) => k === key)) resolutions.push([key, `${md.w} × ${md.h} (${aspect(md.w, md.h)})`])
  }
  const resolution = comboRow("Resolution", resolutions, `${m.width}x${m.height}`)

  const ratesFor = (res: string) =>
    modes
      .filter((md) => `${md.w}x${md.h}` === res)
      .sort((a, b) => b.hz - a.hz)
      .map((md): [string, string] => [md.text, `${md.hz.toFixed(2)} Hz`])
  let rates = ratesFor(`${m.width}x${m.height}`)
  const rate = new Adw.ComboRow({ title: "Refresh Rate", model: Gtk.StringList.new(rates.map(([, l]) => l)) })
  rate.selected = Math.max(0, rates.findIndex(([v]) => v === spec.mode))

  const vrr = new Adw.SwitchRow({
    title: "Variable Refresh Rate",
    subtitle: "Used by fullscreen games and video",
    active: spec.vrr !== 0,
  })

  // GNOME folds VRR and the rate into an expander when the display has VRR
  const vrrCapable = m.hardwareDetails?.vrrCapable ?? false
  let rateRow: Gtk.Widget = rate
  if (vrrCapable) {
    const expander = new Adw.ExpanderRow({ title: "Refresh Rate" })
    const summary = new Gtk.Label({})
    summary.add_css_class("dim-label")
    expander.add_suffix(summary)
    const sync = () =>
      (summary.label = vrr.active
        ? `Variable (up to ${rates[rate.selected]?.[1] ?? ""})`
        : rates[rate.selected]?.[1] ?? "")
    vrr.connect("notify::active", sync)
    rate.connect("notify::selected", sync)
    sync()
    expander.add_row(vrr)
    expander.add_row(rate)
    rateRow = expander
  }

  const hdr = new Adw.SwitchRow({ title: "HDR (High Dynamic Range)", active: spec.cm === "hdr" })

  const scale = comboRow(
    "Scale",
    SCALES.map((s): [number, string] => [s, `${Math.round(s * 100)} %`]),
    SCALES.reduce((best, s) => (Math.abs(s - m.scale) < Math.abs(best - m.scale) ? s : best), 1),
  )

  g.add(orientation)
  g.add(resolution)
  g.add(rateRow)
  if (m.hardwareDetails?.hdr) g.add(hdr)
  g.add(scale)
  // QA deep link (`display next-scale`): change the scale like a click would
  Object.assign(g, { nextScale: () => (scale.selected = (scale.selected + 1) % SCALES.length) })

  const build = (): Spec => ({
    ...spec,
    mode: rates[rate.selected]?.[0] ?? spec.mode,
    transform: orientation.value(),
    scale: scale.value(),
    vrr: vrr.active ? 2 : 0,
    cm: hdr.active ? "hdr" : "srgb",
    bitdepth: hdr.active ? 10 : undefined,
  })

  let quiet = false
  const changed = () => !quiet && change(build())
  resolution.connect("notify::selected", () => {
    quiet = true
    rates = ratesFor(resolution.value())
    rate.model = Gtk.StringList.new(rates.map(([, l]) => l))
    rate.selected = 0
    quiet = false
    changed()
  })
  for (const row of [orientation, rate, scale]) row.connect("notify::selected", changed)
  vrr.connect("notify::active", changed)
  hdr.connect("notify::active", changed)
  return g
}

// ---- Night Light sub-page (GNOME's color plugin keys; the shell applies them) ----

const color = new Gio.Settings({ schemaId: "org.gnome.settings-daemon.plugins.color" })
const iface = new Gio.Settings({ schemaId: "org.gnome.desktop.interface" })

// GNOME's range: warmer to the right
const TEMP_MIN = 1700
const TEMP_MAX = 4700

function timeSpinner(hours: () => number, set: (h: number) => void) {
  const twelve = iface.get_string("clock-format") === "12h"
  const box = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER })
  const h = new Gtk.SpinButton({
    orientation: Gtk.Orientation.VERTICAL,
    adjustment: new Gtk.Adjustment({ lower: twelve ? 1 : 0, upper: twelve ? 12 : 23, stepIncrement: 1 }),
    wrap: true,
    numeric: true,
  })
  const m = new Gtk.SpinButton({
    orientation: Gtk.Orientation.VERTICAL,
    adjustment: new Gtk.Adjustment({ lower: 0, upper: 59, stepIncrement: 1 }),
    wrap: true,
    numeric: true,
  })
  m.connect("output", () => {
    m.text = String(m.value).padStart(2, "0")
    return true
  })
  const ampm = new Gtk.Button({ valign: Gtk.Align.CENTER, visible: twelve })
  ampm.add_css_class("flat")
  let pm = false
  const load = () => {
    const value = hours()
    const hh = Math.floor(value)
    m.value = Math.round((value - hh) * 60)
    pm = hh >= 12
    h.value = twelve ? ((hh + 11) % 12) + 1 : hh
    ampm.label = pm ? "PM" : "AM"
  }
  const store = () => {
    let hh = h.value
    if (twelve) hh = (hh % 12) + (pm ? 12 : 0)
    set(hh + m.value / 60)
  }
  load()
  h.connect("value-changed", store)
  m.connect("value-changed", store)
  ampm.connect("clicked", () => {
    pm = !pm
    ampm.label = pm ? "PM" : "AM"
    store()
  })
  box.append(h)
  box.append(new Gtk.Label({ label: ":" }))
  box.append(m)
  box.append(ampm)
  return box
}

function nightLightPage() {
  const intro = new Gtk.Label({
    label: "Night light makes the screen color warmer. This can help to prevent eye strain and sleeplessness.",
    wrap: true,
    xalign: 0,
  })
  intro.add_css_class("dim-label")
  const introGroup = group()
  introGroup.add(intro)

  const g = group()
  const enabled = new Adw.SwitchRow({ title: "Night Light" })
  color.bind("night-light-enabled", enabled, "active", Gio.SettingsBindFlags.DEFAULT)

  const times = new Adw.ActionRow({ title: "Times" })
  const from = new Gtk.Label({ label: "From" })
  from.add_css_class("dim-label")
  const to = new Gtk.Label({ label: "To" })
  to.add_css_class("dim-label")
  const fromSpin = timeSpinner(
    () => color.get_double("night-light-schedule-from"),
    (v) => color.set_double("night-light-schedule-from", v),
  )
  const toSpin = timeSpinner(
    () => color.get_double("night-light-schedule-to"),
    (v) => color.set_double("night-light-schedule-to", v),
  )
  for (const w of [from, fromSpin, to, toSpin]) times.add_suffix(w)

  const tempRow = new Adw.PreferencesRow({ activatable: false })
  const tempBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, marginTop: 12, marginBottom: 12, marginStart: 12, marginEnd: 12 })
  const tempLabel = new Gtk.Label({ label: "Color Temperature", xalign: 0 })
  const slider = new Gtk.Scale({
    adjustment: new Gtk.Adjustment({ lower: TEMP_MIN, upper: TEMP_MAX, stepIncrement: 100 }),
    inverted: true,
    drawValue: false,
  })
  slider.add_css_class("night-light-temperature")
  for (const mark of [TEMP_MIN, 2700, TEMP_MAX]) slider.add_mark(mark, Gtk.PositionType.BOTTOM, null)
  slider.set_value(color.get_uint("night-light-temperature"))
  slider.connect("value-changed", () => color.set_uint("night-light-temperature", Math.round(slider.get_value())))
  tempBox.append(tempLabel)
  tempBox.append(slider)
  tempRow.child = tempBox

  const sync = () => (times.sensitive = tempRow.sensitive = enabled.active)
  enabled.connect("notify::active", sync)
  sync()

  g.add(enabled)
  g.add(times)
  g.add(tempRow)
  return page({ title: "Night Light", content: prefsPage(introGroup, g) })
}

// ---- The page ----

export default function DisplaysPage(ctx: PageContext) {
  const content = new Adw.PreferencesPage()
  const nightGroup = group()
  const nightRow = navRow("Night Light", () => ctx.push(nightLightPage), "")
  nightRow.add_prefix(new Gtk.Image({ iconName: "night-light-symbolic" }))
  const syncNight = () => (nightRow.valueLabel!.label = color.get_boolean("night-light-enabled") ? "On" : "Off")
  watch(color, "changed::night-light-enabled", syncNight)
  syncNight()
  nightGroup.add(nightRow)

  let groups: Gtk.Widget[] = []
  let monitors: Monitor[] = []
  const render = async () => {
    monitors = (await hyprJson<Monitor[]>("monitors", "all")).filter((m) => !m.disabled)
    const saved = loadSaved()
    for (const g of groups) content.remove(g as Adw.PreferencesGroup)
    groups = []
    for (const m of monitors) {
      const g = monitorGroup(m, saved, (next) => {
        const before = specFor(m, saved[m.name])
        applySpec(next).then(() =>
          confirm(
            content,
            () => {
              saveAll({ ...Object.fromEntries(monitors.map((x) => [x.name, specFor(x, saved[x.name])])), [m.name]: next })
              render()
            },
            () => applySpec(before).then(render),
          ),
        )
      })
      // Several displays: name each one, like GNOME's display list
      if (monitors.length > 1) g.title = `${m.description || m.name}`
      content.add(g)
      groups.push(g)
    }
    // Night Light stays last
    content.remove(nightGroup)
    content.add(nightGroup)
  }
  content.add(nightGroup)
  render().catch(console.error)
  ctx.action("night-light", () => ctx.push(nightLightPage))
  ctx.action("next-scale", () => (groups[0] as unknown as { nextScale?: () => void })?.nextScale?.())
  return page({ title: "Displays", content })
}
