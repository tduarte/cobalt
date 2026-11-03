import app from "ags/gtk4/app"
import { execAsync } from "ags/process"
import GdkPixbuf from "gi://GdkPixbuf"
import Gio from "gi://Gio"
import { interfaceSettings } from "./system"

// The accent color picked in Settings > Appearance (GNOME's accent-color),
// for the shell's toggles and highlights, like GNOME Shell (style.scss reads
// it as var(--cobalt-accent)), and Hyprland's active window border. The
// lock screen gets it from cobalt-lock.
const ACCENTS: Record<string, string> = {
  blue: "#3584e4",
  teal: "#2190a4",
  green: "#3a944a",
  yellow: "#c88800",
  orange: "#ed5b00",
  red: "#e62d42",
  pink: "#d56199",
  purple: "#9141ac",
  slate: "#6f8396",
}

// ---- Auto: the accent follows the background ----
// GNOME has no "auto" accent, so the switch is our own key
// (io.github.tduarte.cobalt accent-color-auto); the shell then writes GNOME's
// accent-color, which apps follow as usual.

const cobaltSettings = Gio.SettingsSchemaSource.get_default()?.lookup("io.github.tduarte.cobalt", true)
  ? new Gio.Settings({ schemaId: "io.github.tduarte.cobalt" })
  : null
const background = new Gio.Settings({ schemaId: "org.gnome.desktop.background" })

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const c = max - Math.min(r, g, b)
  let h = 0
  if (c > 0) {
    if (max === r) h = ((g - b) / c) % 6
    else if (max === g) h = (b - r) / c + 2
    else h = (r - g) / c + 4
  }
  return [(h * 60 + 360) % 360, max ? c / max : 0, max / 255]
}

const hue = (hex: string) => hsv(...([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]))[0]
const HUES = Object.entries(ACCENTS)
  .filter(([id]) => id !== "slate")
  .map(([id, hex]) => [id, hue(hex)] as const)

// The accent closest to the picture's most prominent vivid hue: every pixel
// votes for its nearest accent hue, weighted by how colorful it is; a mostly
// gray picture gets slate
export function accentFor(pixbuf: GdkPixbuf.Pixbuf): string {
  const px = pixbuf.get_pixels()
  const n = pixbuf.get_n_channels()
  const stride = pixbuf.get_rowstride()
  const votes = new Map<string, number>()
  let total = 0
  let count = 0
  for (let y = 0; y < pixbuf.get_height(); y++) {
    for (let x = 0; x < pixbuf.get_width(); x++) {
      const i = y * stride + x * n
      const [h, s, v] = hsv(px[i], px[i + 1], px[i + 2])
      count++
      // Near-black and washed-out pixels say little about the color
      const weight = s * s * Math.min(1, v * 2)
      if (weight < 0.04) continue
      total += weight
      let best = HUES[0][0]
      let dist = 360
      for (const [id, ah] of HUES) {
        const d = Math.min(Math.abs(h - ah), 360 - Math.abs(h - ah))
        if (d < dist) [best, dist] = [id, d]
      }
      votes.set(best, (votes.get(best) ?? 0) + weight)
    }
  }
  if (count === 0 || total / count < 0.05) return "slate"
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function backgroundFile() {
  const uri = background.get_string("picture-uri-dark") || background.get_string("picture-uri")
  return uri ? Gio.File.new_for_uri(uri) : null
}

function pickFromBackground() {
  if (!cobaltSettings?.get_boolean("accent-color-auto")) return
  const file = backgroundFile()
  if (!file) return
  file.read_async(0, null, (_f, res) => {
    let stream: Gio.FileInputStream
    try {
      stream = file.read_finish(res)
    } catch (err) {
      console.error("auto accent", err)
      return
    }
    // A small copy is plenty for the dominant color, and fast to decode
    GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 64, 64, true, null, (_s, r) => {
      try {
        const id = accentFor(GdkPixbuf.Pixbuf.new_from_stream_finish(r))
        if (interfaceSettings.get_string("accent-color") !== id) interfaceSettings.set_string("accent-color", id)
      } catch (err) {
        console.error("auto accent", err)
      }
    })
  })
}

export function followAccent() {
  const apply = () => {
    const color = ACCENTS[interfaceSettings.get_string("accent-color")] ?? ACCENTS.blue
    app.apply_css(`:root { --cobalt-accent: ${color}; }`)
    const border = `rgba(${color.slice(1)}ee)`
    execAsync(["hyprctl", "eval", `hl.config({ general = { col = { active_border = "${border}" } } })`]).catch(console.error)
  }
  interfaceSettings.connect("changed::accent-color", apply)
  apply()

  cobaltSettings?.connect("changed::accent-color-auto", pickFromBackground)
  background.connect("changed::picture-uri", pickFromBackground)
  background.connect("changed::picture-uri-dark", pickFromBackground)
  pickFromBackground()
}
