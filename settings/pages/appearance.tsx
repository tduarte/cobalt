import Adw from "gi://Adw?version=1"
import Gdk from "gi://Gdk?version=4.0"
import GdkPixbuf from "gi://GdkPixbuf"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import GObject from "gi://GObject"
import Gtk from "gi://Gtk?version=4.0"
import { group, page, prefsPage, watch } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Appearance: accent color and background. cobalt is dark
// only (docs/BRIEF.md), so there's no Style section. Both write GNOME's keys:
// libadwaita apps follow the accent through the settings portal, the shell
// reads it too, and cobalt-wallpaper follows picture-uri.

Gio._promisify(GdkPixbuf.Pixbuf, "new_from_stream_at_scale_async", "new_from_stream_finish")

const iface = new Gio.Settings({ schemaId: "org.gnome.desktop.interface" })
const background = new Gio.Settings({ schemaId: "org.gnome.desktop.background" })

// libadwaita's accent colors, in GNOME's order
export const ACCENTS: [string, string, string][] = [
  ["blue", "Blue", "#3584e4"],
  ["teal", "Teal", "#2190a4"],
  ["green", "Green", "#3a944a"],
  ["yellow", "Yellow", "#c88800"],
  ["orange", "Orange", "#ed5b00"],
  ["red", "Red", "#e62d42"],
  ["pink", "Pink", "#d56199"],
  ["purple", "Purple", "#9141ac"],
  ["slate", "Slate", "#6f8396"],
]

const THUMB_W = 160
const THUMB_H = 100
const USER_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), "backgrounds"])

function accentGroup() {
  const g = group("Accent Color")
  const box = new Gtk.Box({ halign: Gtk.Align.CENTER, spacing: 12, marginTop: 12, marginBottom: 12 })
  box.add_css_class("accent-colors")
  let first: Gtk.ToggleButton | null = null
  const buttons = ACCENTS.map(([id, name]) => {
    const b = new Gtk.ToggleButton({ tooltipText: name, valign: Gtk.Align.CENTER })
    b.add_css_class("accent-swatch")
    b.add_css_class(id)
    if (first) b.set_group(first)
    else first = b
    b.connect("toggled", () => {
      if (b.active && iface.get_string("accent-color") !== id) iface.set_string("accent-color", id)
    })
    box.append(b)
    return [id, b] as const
  })
  const sync = () => {
    const current = iface.get_string("accent-color")
    for (const [id, b] of buttons) if (id === current) b.active = true
  }
  watch(iface, "changed::accent-color", sync)
  sync()
  // A boxed row, like GNOME's swatch card
  const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE })
  list.add_css_class("boxed-list")
  const row = new Gtk.ListBoxRow({ child: box, activatable: false })
  list.append(row)
  g.add(list)
  return g
}

// ---- Backgrounds ----

type Wallpaper = { name: string; path: string; removable: boolean }

const decoder = new TextDecoder()

function systemWallpapers(): Wallpaper[] {
  const out: Wallpaper[] = []
  for (const dir of GLib.get_system_data_dirs()) {
    const props = Gio.File.new_for_path(GLib.build_filenamev([dir, "gnome-background-properties"]))
    let it: Gio.FileEnumerator
    try {
      it = props.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
    } catch {
      continue
    }
    for (let info = it.next_file(null); info; info = it.next_file(null)) {
      if (!info.get_name().endsWith(".xml")) continue
      const [, data] = props.get_child(info.get_name()).load_contents(null)
      const xml = decoder.decode(data)
      for (const block of xml.match(/<wallpaper[\s\S]*?<\/wallpaper>/g) ?? []) {
        if (/deleted="true"/.test(block)) continue
        const path = block.match(/<filename>([^<]+)<\/filename>/)?.[1]
        const name = block.match(/<name>([^<]+)<\/name>/)?.[1] ?? ""
        if (path && GLib.file_test(path, GLib.FileTest.EXISTS) && !out.some((w) => w.path === path))
          out.push({ name, path, removable: false })
      }
    }
  }
  return out
}

function userWallpapers(): Wallpaper[] {
  const dir = Gio.File.new_for_path(USER_DIR)
  const out: Wallpaper[] = []
  try {
    const it = dir.enumerate_children("standard::name,standard::content-type", Gio.FileQueryInfoFlags.NONE, null)
    for (let info = it.next_file(null); info; info = it.next_file(null)) {
      if (!info.get_content_type()?.startsWith("image/")) continue
      out.push({ name: info.get_name(), path: dir.get_child(info.get_name()).get_path()!, removable: true })
    }
  } catch {
    // no user backgrounds yet
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function currentPath() {
  const uri = background.get_string("picture-uri-dark") || background.get_string("picture-uri")
  return uri ? Gio.File.new_for_uri(uri).get_path() : null
}

function setWallpaper(path: string) {
  const uri = Gio.File.new_for_path(path).get_uri()
  background.set_string("picture-uri", uri)
  background.set_string("picture-uri-dark", uri)
  background.set_string("picture-options", "zoom")
}

// Thumbnails decode at display size, off the main thread (4K JPEGs)
const thumbCache = new Map<string, Gdk.Texture>()

async function thumbnail(path: string, scale: number) {
  const key = `${path}@${scale}`
  const cached = thumbCache.get(key)
  if (cached) return cached
  const stream = Gio.File.new_for_path(path).read(null)
  const pixbuf = (await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
    stream,
    -1,
    THUMB_H * scale * 1.6,
    true,
    null,
  )) as unknown as GdkPixbuf.Pixbuf
  const texture = Gdk.Texture.new_for_pixbuf(pixbuf)
  thumbCache.set(key, texture)
  return texture
}

// A thumbnail that asks for its tile size, not the image's (a Gtk.Picture's
// natural size is its texture's size)
const Thumb = GObject.registerClass(
  class Thumb extends Gtk.Picture {
    vfunc_measure(orientation: Gtk.Orientation): [number, number, number, number] {
      const size = orientation === Gtk.Orientation.HORIZONTAL ? THUMB_W : THUMB_H
      return [size, size, -1, -1]
    }
  },
)

function backgroundTile(w: Wallpaper, selected: boolean, onRemove: () => void) {
  const picture = new Thumb({ contentFit: Gtk.ContentFit.COVER })
  picture.add_css_class("background-thumb")
  thumbnail(w.path, picture.get_scale_factor() || 1)
    .then((t) => picture.set_paintable(t))
    .catch((err) => console.error("thumbnail", w.path, err))

  const overlay = new Gtk.Overlay({
    child: picture,
    tooltipText: w.name,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
  })
  overlay.add_css_class("background-tile")
  if (selected) overlay.add_css_class("selected")
  if (w.removable) {
    const remove = new Gtk.Button({
      iconName: "window-close-symbolic",
      tooltipText: "Remove Background",
      halign: Gtk.Align.END,
      valign: Gtk.Align.START,
      marginTop: 6,
      marginEnd: 6,
    })
    remove.add_css_class("circular")
    remove.add_css_class("osd")
    remove.connect("clicked", onRemove)
    overlay.add_overlay(remove)
  }
  return overlay
}

function backgroundGroup() {
  const g = group("Background")
  const add = new Gtk.Button({ child: new Adw.ButtonContent({ iconName: "list-add-symbolic", label: "Add Picture…" }) })
  add.add_css_class("flat")
  g.headerSuffix = add

  const flow = new Gtk.FlowBox({
    selectionMode: Gtk.SelectionMode.NONE,
    homogeneous: true,
    columnSpacing: 12,
    rowSpacing: 12,
    minChildrenPerLine: 2,
    maxChildrenPerLine: 3,
    marginTop: 12,
    marginBottom: 12,
    marginStart: 12,
    marginEnd: 12,
    activateOnSingleClick: true,
  })
  let items: Wallpaper[] = []
  const render = () => {
    flow.remove_all()
    items = [...userWallpapers(), ...systemWallpapers()]
    const current = currentPath()
    for (const w of items) {
      flow.append(
        backgroundTile(w, w.path === current, () => {
          Gio.File.new_for_path(w.path).delete_async(GLib.PRIORITY_DEFAULT, null, () => render())
        }),
      )
    }
  }
  flow.connect("child-activated", (_, child: Gtk.FlowBoxChild) => setWallpaper(items[child.get_index()].path))
  watch(background, "changed::picture-uri-dark", render)
  render()

  add.connect("clicked", () => {
    const filter = new Gtk.FileFilter({ name: "Images" })
    filter.add_mime_type("image/*")
    const filters = new Gio.ListStore({ itemType: Gtk.FileFilter.$gtype })
    filters.append(filter)
    const chooser = new Gtk.FileDialog({ title: "Select a picture", filters })
    chooser.open(g.get_root() as Gtk.Window, null, (_, res) => {
      let file: Gio.File
      try {
        file = chooser.open_finish(res)!
      } catch {
        return // cancelled
      }
      // GNOME keeps added pictures in ~/.local/share/backgrounds
      GLib.mkdir_with_parents(USER_DIR, 0o755)
      const dest = Gio.File.new_for_path(GLib.build_filenamev([USER_DIR, file.get_basename()!]))
      file.copy_async(dest, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (_s, r) => {
        try {
          file.copy_finish(r)
          setWallpaper(dest.get_path()!)
        } catch (err) {
          console.error("add background", err)
        }
      })
    })
  })

  const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE })
  list.add_css_class("boxed-list")
  list.append(new Gtk.ListBoxRow({ child: flow, activatable: false }))
  g.add(list)
  return g
}

export default function AppearancePage(_ctx: PageContext) {
  return page({ title: "Appearance", content: prefsPage(accentGroup(), backgroundGroup()) })
}
