import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GObject from "gi://GObject"
import Gtk from "gi://Gtk?version=4.0"
import { group, page, prefsPage } from "../lib/ui"
import type { PageContext } from "."

// GNOME Settings > Apps > Default Apps. Same logic as GNOME: each category is
// a "main" content type to list candidates; picking one makes it the default
// for that type and the related types it supports (mimeapps.list).
// (The per-app pages are descoped, docs/BRIEF.md.)

type Category = {
  title: string
  // Listed apps handle this type
  main: string
  // Also set as default for these, or every supported type with this prefix
  also?: string[]
  prefix?: string
}

const CATEGORIES: Category[] = [
  {
    title: "Web",
    main: "x-scheme-handler/http",
    also: ["x-scheme-handler/https", "text/html", "application/xhtml+xml", "x-scheme-handler/about", "x-scheme-handler/unknown"],
  },
  { title: "Mail", main: "x-scheme-handler/mailto" },
  { title: "Calendar", main: "text/calendar" },
  { title: "Music", main: "audio/x-vorbis+ogg", prefix: "audio/" },
  { title: "Video", main: "video/x-ogm+ogg", prefix: "video/" },
  { title: "Photos", main: "image/jpeg", prefix: "image/" },
]

function setDefault(app: Gio.AppInfo, c: Category) {
  const types = new Set([c.main, ...(c.also ?? [])])
  if (c.prefix) for (const t of app.get_supported_types() ?? []) if (t.startsWith(c.prefix)) types.add(t)
  for (const t of types) {
    try {
      app.set_as_default_for_type(t)
    } catch (err) {
      console.error(`default ${t}`, err)
    }
  }
}

// A dropdown of apps with icons, like GNOME's app chooser button
const AppItem = GObject.registerClass(
  { Properties: {} },
  class AppItem extends GObject.Object {
    app!: Gio.AppInfo
  },
)

function categoryRow(c: Category) {
  const apps = Gio.AppInfo.get_all_for_type(c.main)
    .filter((a) => a.should_show())
    .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()))
  const current = Gio.AppInfo.get_default_for_type(c.main, false)
  const row = new Adw.ComboRow({ title: c.title })
  if (apps.length === 0) {
    row.subtitle = "No apps installed"
    row.sensitive = false
    return row
  }
  const store = new Gio.ListStore({ itemType: AppItem.$gtype })
  for (const a of apps) {
    const item = new AppItem()
    item.app = a
    store.append(item)
  }
  const factory = new Gtk.SignalListItemFactory()
  factory.connect("setup", (_, li: Gtk.ListItem) => {
    const box = new Gtk.Box({ spacing: 8 })
    box.append(new Gtk.Image({ pixelSize: 16 }))
    box.append(new Gtk.Label({ xalign: 0 }))
    li.child = box
  })
  factory.connect("bind", (_, li: Gtk.ListItem) => {
    const app = (li.item as InstanceType<typeof AppItem>).app
    const box = li.child as Gtk.Box
    ;(box.get_first_child() as Gtk.Image).gicon = app.get_icon()
    ;(box.get_last_child() as Gtk.Label).label = app.get_display_name()
  })
  row.model = store
  row.factory = factory
  row.expression = Gtk.ClosureExpression.new(GObject.TYPE_STRING, (item: InstanceType<typeof AppItem>) => item.app.get_display_name(), null)
  row.selected = Math.max(0, apps.findIndex((a) => a.get_id() === current?.get_id()))
  row.sensitive = apps.length > 1
  row.connect("notify::selected", () => setDefault(apps[row.selected], c))
  return row
}

export default function AppsPage(_ctx: PageContext) {
  const g = group("Default Apps")
  for (const c of CATEGORIES) g.add(categoryRow(c))
  return page({ title: "Apps", content: prefsPage(g) })
}
