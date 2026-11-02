import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import Gio from "gi://Gio"
import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import { For, createComputed, createState } from "ags"
import { closeMenus } from "../lib/menus"
import { hyprDispatch } from "../lib/system"
import { desktopIdFor, iconFor } from "./overview/model"

// GNOME's app switcher: Alt+Tab shows the open apps, most recently used
// first, and switches to the selected one when Alt is released. Hyprland
// keeps the binds (Alt+Tab, Alt+Shift+Tab → `switcher next|prev`), so the
// popup only sees Alt's release, Escape and the arrow keys. Super+` cycles
// the windows of the focused app (`switcher app-window`) without a popup.

type Win = { address: string; cls: string; title: string; focusHistoryID: number }
type AppEntry = { cls: string; name: string; icon: Gio.Icon; windows: Win[] }

const [visible, setVisible] = createState(false)
const [entries, setEntries] = createState<AppEntry[]>([])
const [selected, setSelected] = createState(0)

function clients(): Win[] {
  try {
    const all = JSON.parse(AstalHyprland.get_default().message("j/clients")) as (Win & {
      class: string
      initialClass: string
      mapped: boolean
    })[]
    return all
      .filter((c) => c.mapped && (c.class || c.initialClass))
      .map((c) => ({ address: c.address, cls: c.class || c.initialClass, title: c.title, focusHistoryID: c.focusHistoryID }))
      .sort((a, b) => a.focusHistoryID - b.focusHistoryID)
  } catch (err) {
    console.error("switcher", err)
    return []
  }
}

// Windows grouped by app, apps in the order their newest window was used
function group(wins: Win[]): AppEntry[] {
  const byCls = new Map<string, AppEntry>()
  for (const w of wins) {
    let e = byCls.get(w.cls)
    if (!e) {
      const id = desktopIdFor(w.cls)
      const name = (id && Gio.DesktopAppInfo.new(id)?.get_name()) || w.cls
      e = { cls: w.cls, name, icon: iconFor(w.cls), windows: [] }
      byCls.set(w.cls, e)
    }
    e.windows.push(w)
  }
  return [...byCls.values()]
}

function focus(w: Win) {
  hyprDispatch(`hl.dsp.focus({ window = "address:${w.address}" })`)
  hyprDispatch("hl.dsp.window.bring_to_top()")
}

// Focus changes wait until the popup is gone: while it holds the keyboard,
// Hyprland would hand focus back to the previous window when it unmaps
let pending: Win | null = null

function commit() {
  if (!visible.get()) return
  pending = entries.get()[selected.get()]?.windows[0] ?? null
  setVisible(false)
}

function cancel() {
  setVisible(false)
}

function move(step: number) {
  const n = entries.get().length
  if (n) setSelected((i) => (i + step + n) % n)
}

// Alt may already be up by the time the popup maps (a quick Alt+Tab): check
// the keyboard's modifiers once the popup has focus and switch right away
let altCheck = 0
function checkAltHeld() {
  if (altCheck) GLib.source_remove(altCheck)
  altCheck = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
    altCheck = 0
    const keyboard = Gdk.Display.get_default()?.get_default_seat()?.get_keyboard()
    if (keyboard && !(keyboard.get_modifier_state() & Gdk.ModifierType.ALT_MASK)) commit()
    return GLib.SOURCE_REMOVE
  })
}

export function switcher(cmd: string) {
  if (cmd === "app-window") {
    // Next window of the focused app (Super+`)
    const wins = clients()
    const current = wins[0]
    if (!current) return
    const same = wins.filter((w) => w.cls === current.cls)
    // Oldest-used window of the app comes next, so repeated presses cycle
    if (same.length > 1) focus(same[same.length - 1])
    return
  }
  const step = cmd === "prev" ? -1 : 1
  if (visible.get()) {
    move(step)
    return
  }
  const list = group(clients())
  if (list.length === 0) return
  closeMenus()
  setEntries(list)
  // The current app is first; start on the previous one, like GNOME
  setSelected(list.length > 1 ? (step > 0 ? 1 : list.length - 1) : 0)
  setVisible(true)
  checkAltHeld()
}

export default function Switcher() {
  const name = createComputed(() => entries()[selected()]?.name ?? "")
  return (
    <window
      name="switcher"
      namespace="cobalt-switcher"
      class="switcher-window"
      application={app}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      $={(self) => {
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval === Gdk.KEY_Escape) cancel()
          else if (keyval === Gdk.KEY_Left) move(-1)
          else if (keyval === Gdk.KEY_Right) move(1)
          else if (keyval === Gdk.KEY_Return) commit()
          else return false
          return true
        })
        keys.connect("key-released", (_, keyval) => {
          if (keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R || keyval === Gdk.KEY_Meta_L) commit()
        })
        // Some keyboards (virtual ones) only report Alt as a modifier change
        keys.connect("modifiers", (_, state) => {
          if (!(state & Gdk.ModifierType.ALT_MASK)) commit()
          return false
        })
        self.add_controller(keys)
        // Lost focus (clicked elsewhere): switch, like releasing Alt
        self.connect("notify::is-active", () => !self.isActive && commit())
        self.connect("unmap", () => {
          const w = pending
          pending = null
          if (w)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
              focus(w)
              return GLib.SOURCE_REMOVE
            })
        })
      }}
      visible={visible}
    >
      <box class="switcher" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <box class="switcher-apps" spacing={8} halign={Gtk.Align.CENTER}>
          <For each={entries}>
            {(e: AppEntry, index) => (
              <button
                class={createComputed(() => (selected() === index() ? "switcher-app selected" : "switcher-app"))}
                tooltipText={e.name}
                onClicked={() => {
                  setSelected(index.get())
                  commit()
                }}
              >
                <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                  <image gicon={e.icon} pixelSize={96} />
                  {/* GNOME marks apps with several windows with an arrow */}
                  <image
                    class="switcher-more"
                    iconName="pan-down-symbolic"
                    pixelSize={12}
                    opacity={e.windows.length > 1 ? 1 : 0}
                  />
                </box>
              </button>
            )}
          </For>
        </box>
        <label class="switcher-name" label={name} ellipsize={3} maxWidthChars={40} />
      </box>
    </window>
  )
}
