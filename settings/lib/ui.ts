import Adw from "gi://Adw?version=1"
import GLib from "gi://GLib"
import GObject from "gi://GObject"
import Gtk from "gi://Gtk?version=4.0"
import { onCleanup } from "ags"

// Small builders for GNOME Settings' building blocks. Pages are built inside
// a gnim root (window.tsx), so signal handlers registered with `watch` are
// disconnected when the user switches to another page.

// Connect a signal and disconnect it when the page goes away. (Not
// obj.disconnect(): NM.Device has its own disconnect() method.)
export function watch<T extends GObject.Object>(obj: T, signal: string, fn: (...args: any[]) => void) {
  const id = obj.connect(signal, fn)
  onCleanup(() => GObject.signal_handler_disconnect(obj, id))
  return fn
}

// Run fn now and whenever one of the properties changes
export function track<T extends GObject.Object>(obj: T, props: string[], fn: () => void) {
  for (const p of props) watch(obj, `notify::${p}`, fn)
  fn()
}

// Repeat fn every `ms` while the page is shown
export function every(ms: number, fn: () => void) {
  const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    fn()
    return GLib.SOURCE_CONTINUE
  })
  onCleanup(() => GLib.source_remove(id))
}

// A page: header bar with title (and subtitle), and its preferences page
export function page({
  title,
  content,
  headerEnd,
}: {
  title: string
  content: Gtk.Widget
  headerEnd?: Gtk.Widget
}) {
  const windowTitle = new Adw.WindowTitle({ title })
  const header = new Adw.HeaderBar({ titleWidget: windowTitle })
  if (headerEnd) header.pack_end(headerEnd)
  const view = new Adw.ToolbarView({ content })
  view.add_top_bar(header)
  const nav = new Adw.NavigationPage({ title, child: view })
  return Object.assign(nav, { windowTitle })
}

export function prefsPage(...groups: Gtk.Widget[]) {
  const p = new Adw.PreferencesPage()
  for (const g of groups) p.add(g as Adw.PreferencesGroup)
  return p
}

// Titles are markup in libadwaita ("&" would blank them), so escape
export function group(title = "", description = "") {
  return new Adw.PreferencesGroup({
    title: GLib.markup_escape_text(title, -1),
    description: GLib.markup_escape_text(description, -1),
  })
}

// A row that opens something else (sub-page, dialog): title and a chevron,
// with an optional dimmed value before the chevron ("Off >")
export function navRow(title: string, onActivate: () => void, value?: string) {
  const row = new Adw.ActionRow({ title: GLib.markup_escape_text(title, -1), activatable: true })
  if (value !== undefined) {
    const label = new Gtk.Label({ label: value })
    label.add_css_class("dim-label")
    row.add_suffix(label)
    Object.assign(row, { valueLabel: label })
  }
  row.add_suffix(new Gtk.Image({ iconName: "go-next-symbolic" }))
  row.connect("activated", onActivate)
  return row as Adw.ActionRow & { valueLabel?: Gtk.Label }
}

// Round flat icon button used inside rows (QR, gear, trash)
export function iconButton(iconName: string, tooltipText: string, onClicked: () => void) {
  const button = new Gtk.Button({ iconName, tooltipText, valign: Gtk.Align.CENTER })
  button.add_css_class("flat")
  button.add_css_class("circular")
  button.connect("clicked", onClicked)
  return button
}

// A dialog with a header bar (title + close button) and scrollable content
export function dialog({
  title,
  content,
  width = 560,
  height = -1,
  start,
  end,
}: {
  title: string
  content: Gtk.Widget
  width?: number
  height?: number
  start?: Gtk.Widget
  end?: Gtk.Widget
}) {
  const header = new Adw.HeaderBar({ titleWidget: new Adw.WindowTitle({ title }) })
  // A dialog with its own buttons (Cancel / Connect) has no close button
  if (start || end) {
    header.showStartTitleButtons = false
    header.showEndTitleButtons = false
  }
  if (start) header.pack_start(start)
  if (end) header.pack_end(end)
  const view = new Adw.ToolbarView({ content })
  view.add_top_bar(header)
  return new Adw.Dialog({ title, child: view, contentWidth: width, contentHeight: height })
}

// Content for short dialogs: groups in a box that sizes to its content (a
// PreferencesPage scrolls, so it has no natural height)
export function dialogBox(...groups: Gtk.Widget[]) {
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 24,
    marginTop: 12,
    marginBottom: 24,
    marginStart: 24,
    marginEnd: 24,
  })
  for (const g of groups) box.append(g)
  return box
}

// Content that grows with the dialog and scrolls once it gets tall. Not for
// rows with wrapping text: propagating the natural height breaks GTK's
// height-for-width there and the dialog collapses (Add VPN did).
export function scrollingBox(...groups: Gtk.Widget[]) {
  return new Gtk.ScrolledWindow({
    child: dialogBox(...groups),
    propagateNaturalHeight: true,
    maxContentHeight: 640,
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
  })
}

// Replace all rows of a group (simple list rendering for NM/BlueZ objects)
export function setRows(g: Adw.PreferencesGroup, rows: Gtk.Widget[], previous: Gtk.Widget[]) {
  for (const r of previous) g.remove(r)
  for (const r of rows) g.add(r)
  return rows
}

// A searchable list in a dialog (time zones, languages, formats): pick one
// and press the action button, or double-click a row
export function pickDialog(opts: {
  parent: Gtk.Widget
  title: string
  items: { id: string; label: string; detail?: string }[]
  current?: string
  action?: string
  onPick: (id: string) => void
}) {
  const search = new Gtk.SearchEntry({ placeholderText: "Search", marginBottom: 6 })
  const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.SINGLE })
  list.add_css_class("boxed-list")
  for (const item of opts.items) {
    const row = new Adw.ActionRow({
      title: GLib.markup_escape_text(item.label, -1),
      subtitle: GLib.markup_escape_text(item.detail ?? "", -1),
    })
    if (item.id === opts.current) row.add_suffix(new Gtk.Image({ iconName: "object-select-symbolic" }))
    list.append(row)
  }
  list.set_filter_func((row) => {
    const q = search.text.trim().toLowerCase()
    const item = opts.items[row.get_index()]
    return !q || item.label.toLowerCase().includes(q) || (item.detail ?? "").toLowerCase().includes(q)
  })
  search.connect("search-changed", () => list.invalidate_filter())

  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, marginTop: 6, marginBottom: 12, marginStart: 12, marginEnd: 12 })
  box.append(search)
  box.append(new Gtk.ScrolledWindow({ child: list, vexpand: true, hscrollbarPolicy: Gtk.PolicyType.NEVER }))

  const cancel = new Gtk.Button({ label: "_Cancel", useUnderline: true })
  const ok = new Gtk.Button({ label: opts.action ?? "_Select", useUnderline: true, sensitive: false })
  ok.add_css_class("suggested-action")
  const dlg = dialog({ title: opts.title, content: box, width: 460, height: 560, start: cancel, end: ok })
  list.connect("row-selected", (_, row) => (ok.sensitive = row !== null))
  list.connect("row-activated", () => ok.activate())
  cancel.connect("clicked", () => dlg.close())
  search.connect("stop-search", () => {
    if (!search.text) dlg.close()
  })
  ok.connect("clicked", () => {
    const row = list.get_selected_row()
    if (!row) return
    dlg.close()
    opts.onPick(opts.items[row.get_index()].id)
  })
  dlg.present(opts.parent)
  search.grab_focus()
  return dlg
}
