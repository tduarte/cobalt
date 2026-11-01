import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import AstalHyprland from "gi://AstalHyprland"
import { For, createState } from "ags"
import { closeMenus } from "../lib/menus"

// Keyboard shortcut cheat sheet (Super+/), generated from Hyprland's live
// binds: every bind with a "Category: Label" desc in hyprland.lua shows up,
// so the sheet can't drift from the config.

type Bind = { modmask: number; key: string; description: string }
type Row = { label: string; keys: string[][] }
type Section = { title: string; rows: Row[] }

const ORDER = ["System", "Windows", "Workspaces"]

const MODS: Array<[number, string]> = [
  [64, "Super"],
  [4, "Ctrl"],
  [8, "Alt"],
  [1, "Shift"],
]

const KEY_NAMES: Record<string, string> = {
  SUPER_L: "",
  Return: "Enter",
  slash: "/",
  Page_Up: "Page Up",
  Page_Down: "Page Down",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  "mouse:272": "Left drag",
  "mouse:273": "Right drag",
  mouse_down: "Scroll",
  mouse_up: "Scroll",
  Tab: "Tab",
}

function keyCaps(b: Bind): string[] {
  const caps = MODS.filter(([bit]) => b.modmask & bit).map(([, name]) => name)
  const key = b.key in KEY_NAMES ? KEY_NAMES[b.key] : b.key.length === 1 ? b.key.toUpperCase() : b.key
  if (key) caps.push(key)
  return caps
}

// Merge binds that share a label: digits become "1…9", arrows "Arrows",
// identical combos (scroll up/down) collapse
function mergeKeys(combos: string[][]): string[][] {
  const unique = [...new Map(combos.map((c) => [c.join("+"), c])).values()]
  const byMods = new Map<string, string[][]>()
  for (const c of unique) {
    const mods = c.slice(0, -1).join("+")
    byMods.set(mods, [...(byMods.get(mods) ?? []), c])
  }
  const out: string[][] = []
  for (const group of byMods.values()) {
    const lasts = group.map((c) => c[c.length - 1])
    const mods = group[0].slice(0, -1)
    if (lasts.length > 2 && lasts.every((k) => /^[0-9]$/.test(k))) out.push([...mods, "1…9"])
    else if (lasts.length > 2 && lasts.every((k) => "←→↑↓".includes(k))) out.push([...mods, "Arrows"])
    else out.push(...group)
  }
  return out
}

function toSections(binds: Bind[]): Section[] {
  const sections = new Map<string, Map<string, string[][]>>()
  for (const b of binds) {
    if (!b.description) continue
    const [cat, label] = b.description.includes(": ")
      ? (b.description.split(/: (.*)/s) as [string, string])
      : ["Other", b.description]
    const rows = sections.get(cat) ?? new Map<string, string[][]>()
    rows.set(label, [...(rows.get(label) ?? []), keyCaps(b)])
    sections.set(cat, rows)
  }
  return [...sections.entries()]
    .sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))
    .map(([title, rows]) => ({
      title,
      rows: [...rows.entries()].map(([label, keys]) => ({ label, keys: mergeKeys(keys) })),
    }))
}

const [visible, setVisible] = createState(false)
const [sections, setSections] = createState<Section[]>([])

export function toggleShortcuts() {
  if (visible.get()) {
    setVisible(false)
    return
  }
  closeMenus()
  AstalHyprland.get_default().message_async("j/binds", (_, res) => {
    try {
      const binds = JSON.parse(AstalHyprland.get_default().message_finish(res)) as Bind[]
      setSections(toSections(binds))
      setVisible(true)
    } catch (err) {
      console.error("shortcuts", err)
    }
  })
}

function Combo({ caps }: { caps: string[] }) {
  return (
    <box spacing={4}>
      {caps.map((c) => (
        <label class="keycap" label={c} />
      ))}
    </box>
  )
}

export default function Shortcuts() {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      name="shortcuts"
      namespace="cobalt-shortcuts"
      class="shortcuts-window"
      application={app}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      visible={visible}
      $={(self) => {
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            setVisible(false)
            return true
          }
          return false
        })
        self.add_controller(keys)
        const click = new Gtk.GestureClick()
        click.connect("released", () => setVisible(false))
        self.add_controller(click)
      }}
    >
      <box class="shortcuts-backdrop" hexpand vexpand>
        <box
          class="shortcuts"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={16}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          hexpand
          vexpand
        >
          <label class="shortcuts-title" label="Keyboard Shortcuts" />
          <box spacing={40} homogeneous>
            <For each={sections}>
              {(section: Section) => (
                <box orientation={Gtk.Orientation.VERTICAL} spacing={6} valign={Gtk.Align.START}>
                  <label class="section-title" label={section.title} xalign={0} />
                  {section.rows.map((row) => (
                    <box class="shortcut-row" spacing={16}>
                      <label label={row.label} xalign={0} hexpand wrap maxWidthChars={22} />
                      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} halign={Gtk.Align.END}>
                        {row.keys.map((caps) => (
                          <Combo caps={caps} />
                        ))}
                      </box>
                    </box>
                  ))}
                </box>
              )}
            </For>
          </box>
          <label class="shortcuts-hint" label="Press Esc or click anywhere to close" />
        </box>
      </box>
    </window>
  )
}
