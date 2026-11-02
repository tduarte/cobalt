import Adw from "gi://Adw?version=1"
import AstalWp from "gi://AstalWp"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import GObject from "gi://GObject"
import Gtk from "gi://Gtk?version=4.0"
import { dialog, dialogBox, group, navRow, page, prefsPage, setRows, track, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Sound: output and input device, profile ("Configuration"),
// volume, balance, a speaker test, and Volume Levels per app. All through
// WirePlumber (AstalWp).

const wp = AstalWp.get_default()!
const audio = wp.audio
const sound = new Gio.Settings({ schemaId: "org.gnome.desktop.sound" })

// PipeWire channel names → the freedesktop test sounds GNOME plays
const CHANNELS: Record<string, [string, string]> = {
  FL: ["Front Left", "front-left"],
  FR: ["Front Right", "front-right"],
  FC: ["Front Center", "front-center"],
  RL: ["Rear Left", "rear-left"],
  RR: ["Rear Right", "rear-right"],
  RC: ["Rear Center", "rear-center"],
  SL: ["Side Left", "side-left"],
  SR: ["Side Right", "side-right"],
  MONO: ["Mono", "front-center"],
}

function maxVolume() {
  return sound.get_boolean("allow-volume-above-100-percent") ? 1.5 : 1
}

// Device dropdown: every speaker/microphone, the default selected
function deviceRow(title: string, list: () => AstalWp.Endpoint[], current: () => AstalWp.Endpoint | null) {
  const row = new Adw.ComboRow({ title })
  let endpoints: AstalWp.Endpoint[] = []
  let quiet = false
  const render = () => {
    quiet = true
    endpoints = list()
    row.model = Gtk.StringList.new(endpoints.map((e) => e.description || e.name || ""))
    const def = current()
    row.selected = Math.max(0, endpoints.findIndex((e) => e.id === def?.id))
    row.sensitive = endpoints.length > 1
    quiet = false
  }
  row.connect("notify::selected", () => {
    const e = endpoints[row.selected]
    if (!quiet && e && !e.isDefault) e.set_is_default(true)
  })
  return { row, render }
}

// "Configuration": the sound card profiles (Stereo, Surround 5.1, Pro Audio...)
function profileRow(endpoint: () => AstalWp.Endpoint | null) {
  const row = new Adw.ComboRow({ title: "Configuration" })
  let profiles: AstalWp.Profile[] = []
  let device: AstalWp.Device | null = null
  let quiet = false
  const render = () => {
    quiet = true
    device = endpoint()?.get_device() ?? null
    profiles = (device?.get_profiles() ?? []).filter((p) => p.available !== AstalWp.Available.NO)
    row.model = Gtk.StringList.new(profiles.map((p) => p.description))
    row.selected = Math.max(0, profiles.findIndex((p) => p.index === device?.activeProfileId))
    row.visible = profiles.length > 1
    quiet = false
  }
  row.connect("notify::selected", () => {
    const p = profiles[row.selected]
    if (!quiet && device && p && p.index !== device.activeProfileId) device.set_active_profile_id(p.index)
  })
  return { row, render }
}

// Volume slider with a mute button, following the endpoint
function volumeRow(title: string, endpoint: () => AstalWp.Endpoint | null, mic: boolean) {
  const row = new Adw.ActionRow({ title })
  const mute = new Gtk.Button({ valign: Gtk.Align.CENTER, tooltipText: "Mute" })
  mute.add_css_class("flat")
  mute.add_css_class("circular")
  const scale = new Gtk.Scale({
    hexpand: true,
    valign: Gtk.Align.CENTER,
    drawValue: false,
    adjustment: new Gtk.Adjustment({ lower: 0, upper: maxVolume(), stepIncrement: 0.02, pageIncrement: 0.1 }),
  })
  scale.widthRequest = 280
  if (maxVolume() > 1) scale.add_mark(1, Gtk.PositionType.BOTTOM, null)
  row.add_suffix(mute)
  row.add_suffix(scale)
  let current: AstalWp.Endpoint | null = null
  let ids: number[] = []
  let quiet = false
  const sync = () => {
    if (!current) return
    quiet = true
    scale.set_value(current.volume)
    mute.iconName = current.mute
      ? mic
        ? "microphone-sensitivity-muted-symbolic"
        : "audio-volume-muted-symbolic"
      : mic
        ? "audio-input-microphone-symbolic"
        : current.volumeIcon
    quiet = false
  }
  const render = () => {
    for (const id of ids) if (current) GObject.signal_handler_disconnect(current, id)
    current = endpoint()
    row.sensitive = current !== null
    if (!current) return
    ids = [current.connect("notify::volume", sync), current.connect("notify::mute", sync)]
    sync()
  }
  scale.connect("value-changed", () => {
    if (!quiet && current) current.set_volume(scale.get_value())
  })
  mute.connect("clicked", () => current?.set_mute(!current.mute))
  return { row, render }
}

// Balance: left/right channel volumes around the endpoint's volume
function balanceRow(endpoint: () => AstalWp.Endpoint | null) {
  const row = new Adw.ActionRow({ title: "Balance" })
  const scale = new Gtk.Scale({
    hexpand: true,
    valign: Gtk.Align.CENTER,
    drawValue: false,
    adjustment: new Gtk.Adjustment({ lower: -1, upper: 1, stepIncrement: 0.05 }),
  })
  scale.widthRequest = 320
  scale.add_mark(0, Gtk.PositionType.BOTTOM, null)
  row.add_suffix(scale)
  let quiet = false
  const lr = () => {
    const chans = endpoint()?.get_channels() ?? []
    return [chans.find((c) => c.name === "FL"), chans.find((c) => c.name === "FR")] as const
  }
  const render = () => {
    const [l, r] = lr()
    row.visible = !!(l && r)
    if (!l || !r) return
    quiet = true
    const top = Math.max(l.volume, r.volume) || 1
    scale.set_value(r.volume / top - l.volume / top)
    quiet = false
  }
  scale.connect("value-changed", () => {
    const e = endpoint()
    const [l, r] = lr()
    if (quiet || !e || !l || !r) return
    const b = scale.get_value()
    e.lockChannels = false
    l.volume = e.volume * Math.min(1, 1 - b)
    r.volume = e.volume * Math.min(1, 1 + b)
  })
  return { row, render }
}

function speakerTest(parent: Gtk.Widget) {
  const speaker = audio.defaultSpeaker
  if (!speaker) return
  const grid = new Gtk.FlowBox({ selectionMode: Gtk.SelectionMode.NONE, maxChildrenPerLine: 3, columnSpacing: 12, rowSpacing: 12 })
  for (const ch of speaker.get_channels()) {
    const [label, file] = CHANNELS[ch.name] ?? [ch.name, "front-center"]
    const b = new Gtk.Button({ label })
    b.add_css_class("pill")
    b.connect("clicked", () =>
      Gio.Subprocess.new(
        ["pw-play", `--target=${speaker.serial}`, `/usr/share/sounds/freedesktop/stereo/audio-channel-${file}.oga`],
        Gio.SubprocessFlags.NONE,
      ),
    )
    grid.append(b)
  }
  const hint = new Gtk.Label({ label: `Click a speaker to play a test sound on “${speaker.description}”.`, wrap: true })
  hint.add_css_class("dim-label")
  dialog({ title: "Speaker Test", content: dialogBox(hint, grid), width: 460 }).present(parent)
}

// ---- Volume Levels sub-page: one slider per app stream ----

function volumeLevelsPage() {
  const outputs = group("Outputs")
  const inputs = group("Inputs")
  let outRows: Gtk.Widget[] = []
  let inRows: Gtk.Widget[] = []
  const render = () => {
    const make = (list: AstalWp.Endpoint[], mic: boolean) =>
      list.map((s) => {
        const v = volumeRow(GLib.markup_escape_text(s.description || s.name || "Unknown", -1), () => s, mic)
        v.row.add_prefix(new Gtk.Image({ iconName: s.icon || "application-x-executable", pixelSize: 32 }))
        v.render()
        return v.row
      })
    const streams = audio.get_streams()
    const recorders = audio.get_recorders()
    outRows = setRows(outputs, make(streams, false), outRows)
    inRows = setRows(inputs, make(recorders, true), inRows)
    outputs.description = streams.length ? "" : "No apps are playing sound"
    inputs.description = recorders.length ? "" : "No apps are recording"
  }
  watch(audio, "notify::streams", render)
  watch(audio, "notify::recorders", render)
  render()
  return page({ title: "Volume Levels", content: prefsPage(outputs, inputs) })
}

// ---- The page ----

export default function SoundPage(ctx: PageContext) {
  const output = group("Output")
  const test = new Gtk.Button({ label: "Test…", valign: Gtk.Align.CENTER })
  test.connect("clicked", () => speakerTest(output))
  output.headerSuffix = test

  const speaker = () => audio.defaultSpeaker
  const mic = () => audio.defaultMicrophone

  const outDevice = deviceRow("Output Device", () => audio.get_speakers(), speaker)
  const outProfile = profileRow(speaker)
  const outVolume = volumeRow("Output Volume", speaker, false)
  const balance = balanceRow(speaker)
  for (const r of [outDevice, outProfile, outVolume, balance]) output.add(r.row)

  const input = group("Input")
  const inDevice = deviceRow("Input Device", () => audio.get_microphones(), mic)
  const inProfile = profileRow(mic)
  const inVolume = volumeRow("Input Volume", mic, true)
  for (const r of [inDevice, inProfile, inVolume]) input.add(r.row)

  const sounds = group("Sounds")
  sounds.add(navRow("Volume Levels", () => ctx.push(volumeLevelsPage)))
  const boost = new Adw.SwitchRow({
    title: "Over-Amplification",
    subtitle: "Allow volume above 100%, which can reduce sound quality",
  })
  sound.bind("allow-volume-above-100-percent", boost, "active", Gio.SettingsBindFlags.DEFAULT)
  sounds.add(boost)

  const renderOut = () => [outDevice, outProfile, outVolume, balance].forEach((r) => r.render())
  const renderIn = () => [inDevice, inProfile, inVolume].forEach((r) => r.render())
  track(audio, ["default-speaker", "speakers"], renderOut)
  track(audio, ["default-microphone", "microphones"], renderIn)
  watch(audio, "notify::devices", () => {
    renderOut()
    renderIn()
  })

  ctx.action("volume-levels", () => ctx.push(volumeLevelsPage))
  ctx.action("test", () => speakerTest(output))
  return page({ title: "Sound", content: prefsPage(output, input, sounds) })
}
