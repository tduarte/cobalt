import app from "ags/gtk4/app"
import { execAsync } from "ags/process"
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

export function followAccent() {
  const apply = () => {
    const color = ACCENTS[interfaceSettings.get_string("accent-color")] ?? ACCENTS.blue
    app.apply_css(`:root { --cobalt-accent: ${color}; }`)
    const border = `rgba(${color.slice(1)}ee)`
    execAsync(["hyprctl", "eval", `hl.config({ general = { col = { active_border = "${border}" } } })`]).catch(console.error)
  }
  interfaceSettings.connect("changed::accent-color", apply)
  apply()
}
