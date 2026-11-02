import Adw from "gi://Adw?version=1"
import Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib"
import GnomeDesktop from "gi://GnomeDesktop?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { applyInput, inputSources } from "../lib/input"
import {
  Custom,
  Shortcut,
  keysFromEvent,
  keysLabel,
  loadState,
  resetAll,
  sameKeys,
  setCustom,
  setShortcut,
  shortcuts,
} from "../lib/shortcuts"
import { dialog, dialogBox, group, iconButton, navRow, page, prefsPage, setRows, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Keyboard: input sources (GNOME's layout list from
// libgnome-desktop), alternate characters and compose keys, and the
// shortcut editor. Layouts and options are GNOME's keys, applied to
// Hyprland by lib/input.ts; shortcuts by lib/shortcuts.ts.

const xkb = new GnomeDesktop.XkbInfo()

function layoutName(id: string) {
  const [ok, name] = xkb.get_layout_info(id)
  return ok ? name : id
}

function sources(): string[] {
  return (inputSources.get_value("sources").deepUnpack() as [string, string][])
    .filter(([type]) => type === "xkb")
    .map(([, id]) => id)
}

function setSources(ids: string[]) {
  inputSources.set_value("sources", new GLib.Variant("a(ss)", ids.map((id) => ["xkb", id])))
}

// ---- Add Input Source ----

function addSourceDialog(parent: Gtk.Widget) {
  const current = new Set(sources())
  const all = xkb
    .get_all_layouts()
    // "custom" is xkb's placeholder for a user-defined layout file
    .filter((id) => !current.has(id) && id !== "custom")
    .map((id) => ({ id, name: layoutName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const search = new Gtk.SearchEntry({ placeholderText: "Search languages or countries", marginBottom: 6 })
  const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.SINGLE })
  list.add_css_class("boxed-list")
  for (const l of all) list.append(new Adw.ActionRow({ title: GLib.markup_escape_text(l.name, -1) }))
  list.set_filter_func((row) => {
    const q = search.text.trim().toLowerCase()
    return !q || all[row.get_index()].name.toLowerCase().includes(q)
  })
  search.connect("search-changed", () => list.invalidate_filter())
  // Esc clears the search first, then closes, like GNOME
  search.connect("stop-search", () => {
    if (!search.text) dlg.close()
  })

  const scroller = new Gtk.ScrolledWindow({ child: list, vexpand: true, hscrollbarPolicy: Gtk.PolicyType.NEVER })
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, marginTop: 6, marginBottom: 12, marginStart: 12, marginEnd: 12 })
  box.append(search)
  box.append(scroller)

  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const add = new Gtk.Button({ label: "_Add", useUnderline: true, sensitive: false })
  add.add_css_class("suggested-action")
  const dlg = dialog({ title: "Add Input Source", content: box, width: 420, height: 520, start: cancel, end: add })
  list.connect("row-selected", (_, row) => (add.sensitive = row !== null))
  list.connect("row-activated", () => add.activate())
  cancel.connect("clicked", () => dlg.close())
  add.connect("clicked", () => {
    const row = list.get_selected_row()
    if (!row) return
    setSources([...sources(), all[row.get_index()].id])
    dlg.close()
  })
  dlg.present(parent)
  search.grab_focus()
}

function sourceRow(id: string, index: number, count: number) {
  const row = new Adw.ActionRow({ title: GLib.markup_escape_text(layoutName(id), -1) })
  const menu = new Gtk.MenuButton({ iconName: "view-more-symbolic", valign: Gtk.Align.CENTER, tooltipText: "More" })
  menu.add_css_class("flat")
  const pop = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  const item = (label: string, sensitive: boolean, run: () => void) => {
    const b = new Gtk.Button({ label, sensitive })
    b.add_css_class("flat")
    ;(b.get_child() as Gtk.Label).xalign = 0
    b.connect("clicked", () => {
      menu.popdown()
      run()
    })
    pop.append(b)
  }
  const move = (delta: number) => {
    const ids = sources()
    const [moved] = ids.splice(index, 1)
    ids.splice(index + delta, 0, moved)
    setSources(ids)
  }
  item("Move Up", index > 0, () => move(-1))
  item("Move Down", index < count - 1, () => move(1))
  item("Remove", count > 1, () => setSources(sources().filter((s) => s !== id)))
  menu.popover = new Gtk.Popover({ child: pop })
  row.add_suffix(menu)
  return row
}

// ---- Special Character Entry: radio lists on xkb-options ----

const ALTERNATE: [string, string][] = [
  ["", "Layout Default"],
  ["lv3:lalt_switch", "Left Alt"],
  ["lv3:ralt_switch", "Right Alt"],
  ["lv3:lwin_switch", "Left Super"],
  ["lv3:rwin_switch", "Right Super"],
  ["lv3:menu_switch", "Menu Key"],
  ["lv3:switch", "Right Ctrl"],
]

const COMPOSE: [string, string][] = [
  ["", "Disabled"],
  ["compose:lalt", "Left Alt"],
  ["compose:ralt", "Right Alt"],
  ["compose:lwin", "Left Super"],
  ["compose:rwin", "Right Super"],
  ["compose:menu", "Menu Key"],
  ["compose:lctrl", "Left Ctrl"],
  ["compose:rctrl", "Right Ctrl"],
  ["compose:caps", "Caps Lock"],
  ["compose:sclk", "Scroll Lock"],
  ["compose:prsc", "Print Screen"],
]

function optionValue(prefix: string, choices: [string, string][]) {
  const current = inputSources.get_strv("xkb-options").find((o) => o.startsWith(prefix)) ?? ""
  return choices.find(([v]) => v === current) ?? [current, current]
}

function setOption(prefix: string, value: string) {
  const options = inputSources.get_strv("xkb-options").filter((o) => !o.startsWith(prefix))
  inputSources.set_strv("xkb-options", value ? [...options, value] : options)
}

function optionPage(title: string, description: string, prefix: string, choices: [string, string][]) {
  const g = group("", description)
  const current = optionValue(prefix, choices)[0]
  let first: Gtk.CheckButton | null = null
  for (const [value, label] of choices) {
    const check = new Gtk.CheckButton({ valign: Gtk.Align.CENTER, active: value === current })
    if (first) check.set_group(first)
    else first = check
    const row = new Adw.ActionRow({ title: label, activatableWidget: check })
    row.add_prefix(check)
    check.connect("toggled", () => check.active && setOption(prefix, value))
    g.add(row)
  }
  return page({ title, content: prefsPage(g) })
}

// ---- Shortcuts ----

// GNOME's "Set Shortcut" capture: Esc cancels, Backspace disables
function captureDialog(parent: Gtk.Widget, name: string, onSet: (keys: string | null) => void) {
  const heading = new Gtk.Label({ useMarkup: true, wrap: true, justify: Gtk.Justification.CENTER })
  heading.label = `Enter new shortcut to change <b>${GLib.markup_escape_text(name, -1)}</b>`
  const icon = new Gtk.Image({ iconName: "input-keyboard-symbolic", pixelSize: 96, marginTop: 12, marginBottom: 12 })
  icon.add_css_class("dim-label")
  const hint = new Gtk.Label({ label: "Press Esc to cancel or Backspace to disable the keyboard shortcut", wrap: true, justify: Gtk.Justification.CENTER })
  hint.add_css_class("dim-label")
  const dlg = dialog({ title: "Set Shortcut", content: dialogBox(heading, icon, hint), width: 420 })
  const keys = new Gtk.EventControllerKey({ propagationPhase: Gtk.PropagationPhase.CAPTURE })
  keys.connect("key-pressed", (_c, keyval: number, keycode: number, state: Gdk.ModifierType) => {
    const mods = state & Gtk.accelerator_get_default_mod_mask()
    if (keyval === Gdk.KEY_Escape && !mods) {
      dlg.close()
      return true
    }
    if (keyval === Gdk.KEY_BackSpace && !mods) {
      dlg.close()
      onSet(null)
      return true
    }
    const combo = keysFromEvent(keycode, mods)
    if (!combo) return true
    dlg.close()
    onSet(combo)
    return true
  })
  dlg.add_controller(keys)
  dlg.present(parent)
  // Let the dialog see combos Hyprland has bound (Super+Q would close the
  // window otherwise), like GNOME: inhibit system shortcuts while capturing
  const toplevel = (parent.get_root() as Gtk.Window | null)?.get_surface() as Gdk.Toplevel | null
  toplevel?.inhibit_system_shortcuts(null)
  dlg.connect("closed", () => toplevel?.restore_system_shortcuts())
}

function shortcutRow(s: Shortcut, all: Shortcut[], refresh: () => void) {
  const row = new Adw.ActionRow({ title: GLib.markup_escape_text(s.name, -1) })
  const label = new Gtk.Label({ label: keysLabel(s.keys) })
  label.add_css_class("dim-label")
  row.add_suffix(label)
  if (s.keys !== s.default) {
    row.add_suffix(
      iconButton("edit-undo-symbolic", "Reset to Default", () => setShortcut(s, s.default).then(refresh)),
    )
  }
  row.add_suffix(
    iconButton("document-edit-symbolic", "Set Shortcut", () =>
      captureDialog(row, s.name, (keys) => {
        const clash = keys ? all.find((o) => o.id !== s.id && sameKeys(o.keys, keys)) : null
        if (!clash) {
          setShortcut(s, keys).then(refresh)
          return
        }
        // GNOME asks before taking a shortcut from another action
        const alert = new Adw.AlertDialog({
          heading: `Replace ${keysLabel(keys)}?`,
          body: `${keysLabel(keys)} is already used for “${clash.name}”. Replacing it will disable “${clash.name}”.`,
        })
        alert.add_response("cancel", "_Cancel")
        alert.add_response("replace", "_Replace")
        alert.set_response_appearance("replace", Adw.ResponseAppearance.DESTRUCTIVE)
        alert.connect("response", async (_, id: string) => {
          if (id !== "replace") return
          await setShortcut(clash, null)
          await setShortcut(s, keys)
          refresh()
        })
        alert.present(row)
      }),
    ),
  )
  return row
}

function customPage(nav: Adw.NavigationView, refreshAll: () => void) {
  const g = group()
  let rows: Gtk.Widget[] = []
  const render = () => {
    const custom = loadState().custom
    rows = setRows(
      g,
      custom.map((c, i) => {
        const row = new Adw.ActionRow({
          title: GLib.markup_escape_text(c.name, -1),
          subtitle: GLib.markup_escape_text(c.command, -1),
          activatable: true,
        })
        const label = new Gtk.Label({ label: keysLabel(c.keys || null) })
        label.add_css_class("dim-label")
        row.add_suffix(label)
        row.add_suffix(
          iconButton("user-trash-symbolic", "Remove", () => {
            setCustom(custom.filter((_, j) => j !== i)).then(() => {
              render()
              refreshAll()
            })
          }),
        )
        row.connect("activated", () => editCustom(row, custom, i, () => (render(), refreshAll())))
        return row
      }),
      rows,
    )
  }
  render()
  const add = new Adw.ButtonRow({ title: "Add Shortcut", startIconName: "list-add-symbolic" })
  add.connect("activated", () => editCustom(g, loadState().custom, -1, () => (render(), refreshAll())))
  const addGroup = group()
  addGroup.add(add)
  return page({ title: "Custom Shortcuts", content: prefsPage(g, addGroup) })
}

function editCustom(parent: Gtk.Widget, custom: Custom[], index: number, done: () => void) {
  const existing = custom[index] ?? { name: "", command: "", keys: "" }
  let keys = existing.keys
  const g = new Adw.PreferencesGroup()
  const name = new Adw.EntryRow({ title: "Name", text: existing.name })
  const command = new Adw.EntryRow({ title: "Command", text: existing.command })
  const shortcut = new Adw.ActionRow({ title: "Shortcut", activatable: true })
  const keysText = new Gtk.Label({ label: keys ? keysLabel(keys) : "Set Shortcut…" })
  keysText.add_css_class("dim-label")
  shortcut.add_suffix(keysText)
  shortcut.connect("activated", () =>
    captureDialog(shortcut, name.text || "Custom Shortcut", (k) => {
      keys = k ?? ""
      keysText.label = k ? keysLabel(k) : "Set Shortcut…"
    }),
  )
  for (const r of [name, command, shortcut]) g.add(r)
  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const save = new Gtk.Button({ label: index < 0 ? "_Add" : "_Save", useUnderline: true })
  save.add_css_class("suggested-action")
  const dlg = dialog({ title: index < 0 ? "Add Custom Shortcut" : "Edit Custom Shortcut", content: dialogBox(g), width: 440, start: cancel, end: save })
  cancel.connect("clicked", () => dlg.close())
  save.connect("clicked", () => {
    if (!name.text.trim() || !command.text.trim()) return
    const next = [...custom]
    const entry = { name: name.text.trim(), command: command.text.trim(), keys }
    if (index < 0) next.push(entry)
    else next[index] = entry
    setCustom(next).then(done)
    dlg.close()
  })
  dlg.present(parent)
}

// GNOME's "Keyboard Shortcuts" dialog: search, categories, then shortcuts
function shortcutsDialog(parent: Gtk.Widget) {
  const nav = new Adw.NavigationView()
  let all = shortcuts()
  const categories = [...new Set(all.map((s) => s.category))].sort()

  const search = new Gtk.SearchEntry({ placeholderText: "Search shortcuts", marginBottom: 12, marginStart: 24, marginEnd: 24 })
  const catGroup = new Adw.PreferencesGroup()
  const results = new Adw.PreferencesGroup()
  const content = prefsPage(catGroup, results)
  let catRows: Gtk.Widget[] = []
  let resultRows: Gtk.Widget[] = []

  const categoryPage = (cat: string) => {
    const g = new Adw.PreferencesGroup()
    let rows: Gtk.Widget[] = []
    const render = () => {
      all = shortcuts()
      rows = setRows(g, all.filter((s) => s.category === cat).map((s) => shortcutRow(s, all, render)), rows)
      renderTop()
    }
    render()
    const view = new Adw.ToolbarView({ content: prefsPage(g) })
    view.add_top_bar(new Adw.HeaderBar())
    return new Adw.NavigationPage({ title: cat, child: view })
  }

  const renderTop = () => {
    all = shortcuts()
    const q = search.text.trim().toLowerCase()
    catGroup.visible = !q
    results.visible = !!q
    catRows = setRows(
      catGroup,
      [...categories, "Custom Shortcuts"].map((cat) => {
        const modified = all.filter((s) => s.category === cat && s.keys !== s.default).length
        const count = cat === "Custom Shortcuts" ? loadState().custom.length : 0
        const value = cat === "Custom Shortcuts" ? (count ? `${count}` : "") : modified ? `${modified} modified` : ""
        return navRow(
          cat,
          () =>
            nav.push(
              cat === "Custom Shortcuts" ? (customPage(nav, renderTop) as Adw.NavigationPage) : categoryPage(cat),
            ),
          value,
        )
      }),
      catRows,
    )
    if (q) {
      resultRows = setRows(
        results,
        all
          .filter((s) => s.name.toLowerCase().includes(q) || keysLabel(s.keys).toLowerCase().includes(q))
          .map((s) => shortcutRow(s, all, renderTop)),
        resultRows,
      )
    }
  }
  search.connect("search-changed", renderTop)
  renderTop()

  const reset = new Adw.ButtonRow({ title: "Reset All…" })
  reset.add_css_class("destructive-action")
  reset.connect("activated", () => {
    const alert = new Adw.AlertDialog({
      heading: "Reset All Shortcuts?",
      body: "All changes to keyboard shortcuts will be lost.",
    })
    alert.add_response("cancel", "_Cancel")
    alert.add_response("reset", "_Reset All")
    alert.set_response_appearance("reset", Adw.ResponseAppearance.DESTRUCTIVE)
    alert.connect("response", (_, id: string) => id === "reset" && resetAll(shortcuts()).then(renderTop))
    alert.present(content)
  })
  const resetGroup = new Adw.PreferencesGroup()
  resetGroup.add(reset)
  content.add(resetGroup)

  const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  body.append(search)
  content.vexpand = true
  body.append(content)
  const view = new Adw.ToolbarView({ content: body })
  view.add_top_bar(new Adw.HeaderBar())
  nav.add(new Adw.NavigationPage({ title: "Keyboard Shortcuts", child: view }))
  const dlg = new Adw.Dialog({ title: "Keyboard Shortcuts", child: nav, contentWidth: 640, contentHeight: 640 })
  dlg.present(parent)
  search.grab_focus()
}

// ---- The page ----

export default function KeyboardPage(ctx: PageContext) {
  const sourcesGroup = group("Input Sources", "Includes keyboard layouts and input methods")
  let rows: Gtk.Widget[] = []
  const add = new Adw.ButtonRow({ title: "Add Input Source", startIconName: "list-add-symbolic" })
  add.connect("activated", () => addSourceDialog(sourcesGroup))
  const render = () => {
    const ids = sources()
    sourcesGroup.remove(add)
    rows = setRows(sourcesGroup, ids.map((id, i) => sourceRow(id, i, ids.length)), rows)
    sourcesGroup.add(add)
  }
  sourcesGroup.add(add)
  render()

  const switching = group(
    "Input Source Switching",
    "Input sources can be switched using the Super+Space keyboard shortcut. This can be changed in the keyboard shortcut settings.",
  )

  const special = group("Special Character Entry", "Methods for entering symbols and letter variants using the keyboard")
  const alternate = navRow(
    "Alternate Characters Key",
    () => ctx.push(() => optionPage("Alternate Characters Key", "The Alternate Characters Key can be used to enter additional characters. These are sometimes printed as a third option on your keyboard.", "lv3:", ALTERNATE)),
    optionValue("lv3:", ALTERNATE)[1],
  )
  const compose = navRow(
    "Compose Key",
    () => ctx.push(() => optionPage("Compose Key", "The compose key allows a wide variety of characters to be entered: press it, then a sequence of characters.", "compose:", COMPOSE)),
    optionValue("compose:", COMPOSE)[1],
  )
  special.add(alternate)
  special.add(compose)

  const shortcutsGroup = group("Keyboard Shortcuts")
  shortcutsGroup.add(navRow("View and Customize Shortcuts", () => shortcutsDialog(shortcutsGroup)))

  watch(inputSources, "changed", () => {
    render()
    alternate.valueLabel!.label = optionValue("lv3:", ALTERNATE)[1]
    compose.valueLabel!.label = optionValue("compose:", COMPOSE)[1]
    applyInput()
  })

  ctx.action("add-source", () => addSourceDialog(sourcesGroup))
  ctx.action("shortcuts", () => shortcutsDialog(shortcutsGroup))
  return page({ title: "Keyboard", content: prefsPage(sourcesGroup, switching, special, shortcutsGroup) })
}
