import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { evalLua, lua, saveLua } from "./hypr"

// Mouse, touchpad and keyboard settings live in GNOME's keys (what GNOME
// Settings writes, so they match GNOME); this turns them into Hyprland's
// input config, applied live and saved to settings/input.lua for next login.

export const mouse = new Gio.Settings({ schemaId: "org.gnome.desktop.peripherals.mouse" })
export const touchpad = new Gio.Settings({ schemaId: "org.gnome.desktop.peripherals.touchpad" })
export const inputSources = new Gio.Settings({ schemaId: "org.gnome.desktop.input-sources" })

// [("xkb", "us+intl"), ...] → layouts and variants, comma-separated
export function xkbLayouts() {
  const sources = inputSources.get_value("sources").deepUnpack() as [string, string][]
  const xkb = sources.filter(([type]) => type === "xkb").map(([, id]) => id)
  if (xkb.length === 0) xkb.push("us")
  const layouts = xkb.map((id) => id.split("+")[0])
  const variants = xkb.map((id) => id.split("+")[1] ?? "")
  return { layouts: layouts.join(","), variants: variants.join(",") }
}

function accelProfile(profile: string) {
  return profile === "flat" ? "flat" : profile === "adaptive" ? "adaptive" : ""
}

export function inputConfig() {
  const { layouts, variants } = xkbLayouts()
  const clickMethod = touchpad.get_string("click-method")
  return {
    input: {
      kb_layout: layouts,
      kb_variant: variants,
      kb_options: inputSources.get_strv("xkb-options").join(","),
      sensitivity: mouse.get_double("speed"),
      accel_profile: accelProfile(mouse.get_string("accel-profile")),
      natural_scroll: mouse.get_boolean("natural-scroll"),
      left_handed: mouse.get_boolean("left-handed"),
      scroll_method: touchpad.get_boolean("edge-scrolling-enabled") ? "edge" : "2fg",
      touchpad: {
        natural_scroll: touchpad.get_boolean("natural-scroll"),
        tap_to_click: touchpad.get_boolean("tap-to-click"),
        disable_while_typing: touchpad.get_boolean("disable-while-typing"),
        // GNOME's "fingers" = two-finger secondary click (clickfinger)
        clickfinger_behavior: clickMethod === "fingers",
      },
    },
  }
}

function toLua(value: unknown): string {
  if (value && typeof value === "object") {
    return `{ ${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} = ${toLua(v)}`)
      .join(", ")} }`
  }
  return lua(value)
}

let pending: number | null = null

// Apply and save, batched (a slider moves many times)
export function applyInput() {
  if (pending !== null) GLib.source_remove(pending)
  pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
    pending = null
    const config = `hl.config(${toLua(inputConfig())})`
    evalLua(config).catch(console.error)
    saveLua("input", "Mouse & Touchpad, Keyboard (from GNOME's keys)", config)
    return GLib.SOURCE_REMOVE
  })
}
