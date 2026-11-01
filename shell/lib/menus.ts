import Gtk from "gi://Gtk?version=4.0"
import { createState } from "ags"

// Panel menus (quick settings, date menu) are their own layer-shell windows,
// shown one at a time. Bar buttons, the click-outside backdrop, Escape, the CLI
// (`ags request -i cobalt toggle quick-settings`) and keybindings all go
// through this state.
const [openMenu, setOpenMenu] = createState<string | null>(null)
export { openMenu }

const windows = new Map<string, Gtk.Window>()

export function registerMenu(name: string, window: Gtk.Window) {
  windows.set(name, window)
}

export function closeMenus() {
  setOpenMenu(null)
}

// Inline sub-menus inside a panel menu (quick settings: "wifi", "sound-output"...)
const subMenuSetters = new Map<string, (id: string | null) => void>()

export function registerSubMenus(name: string, open: (id: string | null) => void) {
  subMenuSetters.set(name, open)
}

export function toggleMenu(name: string, subMenu?: string): boolean {
  if (!windows.has(name)) return false
  if (subMenu) {
    setOpenMenu(name)
    subMenuSetters.get(name)?.(subMenu)
  } else {
    setOpenMenu(openMenu.get() === name ? null : name)
  }
  return true
}

export function menuNames() {
  return [...windows.keys()]
}

// Debug: CSS classes of every button inside a menu window
export function describeMenu(name: string): string {
  const window = windows.get(name)
  if (!window) return "no such menu"
  const out: string[] = []
  const walk = (w: Gtk.Widget | null) => {
    for (let c = w?.get_first_child() ?? null; c; c = c.get_next_sibling()) {
      if (c instanceof Gtk.Button) out.push(c.get_css_classes().join("."))
      walk(c)
    }
  }
  walk(window)
  return out.join("\n")
}
