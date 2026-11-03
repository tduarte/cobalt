import AstalApps from "gi://AstalApps"
import Gdk from "gi://Gdk?version=4.0"
import GObject from "gi://GObject"
import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango"
import { Accessor, Setter, With } from "ags"
import { Folder, GridItem, appById, createFolder, moveToFolder, removeFromFolder, renameFolder } from "./model"

// Real tile width: CSS min-width 128px + 10px padding on each side
export const TILE = 148
export const TILE_GAP = 24

export function AppTile({
  app,
  onLaunch,
  setup,
}: {
  app: AstalApps.Application
  onLaunch: (a: AstalApps.Application) => void
  setup?: (self: Gtk.Button) => void
}) {
  return (
    <button class="app-tile" onClicked={() => onLaunch(app)} $={setup}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={10} valign={Gtk.Align.CENTER}>
        <image iconName={app.iconName || "application-x-executable"} pixelSize={72} />
        <label label={app.name} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={13} justify={Gtk.Justification.CENTER} />
      </box>
    </button>
  )
}

// ---- Drag and drop, like GNOME's app grid: drop an app on a folder to move
// it there, on another app to make a folder of the two, or out of an open
// folder to take it out. The grid stays alphabetical. ----

// The app being dragged (desktop id), so drops from other programs are ignored
let dragging: string | null = null

function dragSource(tile: Gtk.Widget, app: AstalApps.Application) {
  const source = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE })
  source.connect("prepare", () => {
    const value = new GObject.Value()
    value.init(GObject.TYPE_STRING)
    value.set_string(app.entry)
    return Gdk.ContentProvider.new_for_value(value)
  })
  source.connect("drag-begin", () => {
    dragging = app.entry
    const theme = Gtk.IconTheme.get_for_display(tile.get_display())
    const icon = theme.lookup_icon(app.iconName || "application-x-executable", null, 72, tile.get_scale_factor(), Gtk.TextDirection.NONE, 0)
    source.set_icon(icon, 36, 36)
    tile.add_css_class("dragging")
  })
  source.connect("drag-end", () => {
    dragging = null
    tile.remove_css_class("dragging")
  })
  tile.add_controller(source)
}

// Accepts an app from the grid; onDrop returns whether it did something
function dropTarget(widget: Gtk.Widget, onDrop: (appId: string, x: number, y: number) => boolean) {
  const target = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE)
  target.connect("accept", () => dragging !== null)
  target.connect("drop", (_t, value: string, x: number, y: number) => {
    if (value !== dragging || !appById(value)) return false
    return onDrop(value, x, y)
  })
  widget.add_controller(target)
}

// An app tile in the grid (folder = null) or inside an open folder
function GridAppTile({
  app,
  folder,
  onLaunch,
}: {
  app: AstalApps.Application
  folder: Folder | null
  onLaunch: (a: AstalApps.Application) => void
}) {
  return (
    <AppTile
      app={app}
      onLaunch={onLaunch}
      setup={(self) => {
        dragSource(self, app)
        if (!folder)
          dropTarget(self, (id) => {
            if (id === app.entry) return false
            createFolder([app.entry, id])
            return true
          })
      }}
    />
  )
}

// GNOME folder tile: up to four app icons in a rounded square
function FolderTile({ folder, onOpen }: { folder: Folder; onOpen: (f: Folder) => void }) {
  const icons = folder.apps.slice(0, 4)
  return (
    <button
      class="app-tile folder-tile"
      onClicked={() => onOpen(folder)}
      $={(self) =>
        dropTarget(self, (id) => {
          if (folder.apps.some((a) => a.entry === id)) return false
          moveToFolder(id, folder.id)
          return true
        })
      }
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={10} valign={Gtk.Align.CENTER}>
        <box class="folder-icon" halign={Gtk.Align.CENTER}>
          <box orientation={Gtk.Orientation.VERTICAL} spacing={6} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} hexpand vexpand>
            {[icons.slice(0, 2), icons.slice(2, 4)].map((row) => (
              <box spacing={6} halign={Gtk.Align.CENTER}>
                {row.map((a) => (
                  <image iconName={a.iconName || "application-x-executable"} pixelSize={30} />
                ))}
              </box>
            ))}
          </box>
        </box>
        <label label={folder.name} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={13} />
      </box>
    </button>
  )
}

function Rows({ items, cols, render }: { items: GridItem[]; cols: number; render: (i: GridItem) => JSX.Element }) {
  const rows: GridItem[][] = []
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols))
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={TILE_GAP} halign={Gtk.Align.CENTER} valign={Gtk.Align.START}>
      {rows.map((row) => (
        <box spacing={TILE_GAP} halign={Gtk.Align.START}>
          {row.map(render)}
        </box>
      ))}
    </box>
  )
}

// GNOME's paged app grid: fixed pages of cols x rows, page dots, side
// arrows, mouse wheel to flip pages, folders open in a popup
export function PagedGrid({
  items,
  cols,
  rows,
  onLaunch,
  openFolder,
  setOpenFolder,
  pageState,
}: {
  items: GridItem[]
  cols: number
  rows: number
  onLaunch: (a: AstalApps.Application) => void
  openFolder: Accessor<Folder | null>
  setOpenFolder: Setter<Folder | null>
  // Kept by the caller so a rebuilt grid (after a drop) stays on its page
  pageState: [Accessor<number>, Setter<number>]
}) {
  const perPage = cols * rows
  const pages: GridItem[][] = []
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage))
  const [page, setPage] = pageState
  const go = (p: number) => setPage(Math.max(0, Math.min(pages.length - 1, p)))
  if (page.get() > pages.length - 1) go(pages.length - 1)

  const render = (item: GridItem) =>
    item.kind === "app" ? (
      <GridAppTile app={item.app} folder={null} onLaunch={onLaunch} />
    ) : (
      <FolderTile folder={item.folder} onOpen={setOpenFolder} />
    )

  return (
    <overlay vexpand hexpand>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={16}>
        <box vexpand>
          <button class="page-arrow" valign={Gtk.Align.CENTER} sensitive={page((p) => p > 0)} onClicked={() => go(page.get() - 1)}>
            <image iconName="go-previous-symbolic" />
          </button>
          <stack
            hexpand
            vexpand
            transitionType={Gtk.StackTransitionType.SLIDE_LEFT_RIGHT}
            transitionDuration={250}
            visibleChildName={page((p) => `page-${p}`)}
            $={(stack) => {
              // Mouse wheel / touchpad flips pages, like GNOME
              const scroll = new Gtk.EventControllerScroll({ flags: Gtk.EventControllerScrollFlags.BOTH_AXES })
              let lock = false
              scroll.connect("scroll", (_, dx, dy) => {
                if (lock) return true
                const d = Math.abs(dx) > Math.abs(dy) ? dx : dy
                if (Math.abs(d) < 0.5) return true
                go(page.get() + (d > 0 ? 1 : -1))
                lock = true
                setTimeout(() => (lock = false), 350)
                return true
              })
              stack.add_controller(scroll)
            }}
          >
            {pages.map((items, i) => (
              <box $type="named" name={`page-${i}`} halign={Gtk.Align.CENTER} valign={Gtk.Align.START}>
                <Rows items={items} cols={cols} render={render} />
              </box>
            ))}
          </stack>
          <button
            class="page-arrow"
            valign={Gtk.Align.CENTER}
            sensitive={page((p) => p < pages.length - 1)}
            onClicked={() => go(page.get() + 1)}
          >
            <image iconName="go-next-symbolic" />
          </button>
        </box>
        <box class="page-dots" halign={Gtk.Align.CENTER} spacing={10} visible={pages.length > 1}>
          {pages.map((_, i) => (
            <button class={page((p) => (p === i ? "page-dot active" : "page-dot"))} onClicked={() => go(i)} />
          ))}
        </box>
      </box>
      <box
        $type="overlay"
        class="folder-backdrop"
        visible={openFolder((f) => f !== null)}
        $={(self) => {
          const click = new Gtk.GestureClick()
          click.connect("released", (_g, _n, x, y) => {
            const target = self.pick(x, y, Gtk.PickFlags.DEFAULT)
            if (target === self) setOpenFolder(null)
          })
          self.add_controller(click)
          const keys = new Gtk.EventControllerKey()
          keys.connect("key-pressed", (_, keyval) => {
            if (keyval === Gdk.KEY_Escape) {
              setOpenFolder(null)
              return true
            }
            return false
          })
          self.add_controller(keys)
          // Dropping an app outside the popup takes it out of the folder
          dropTarget(self, (id, x, y) => {
            const f = openFolder.get()
            if (!f || self.pick(x, y, Gtk.PickFlags.DEFAULT) !== self) return false
            removeFromFolder(id, f.id)
            return true
          })
        }}
      >
        <box
          class="folder-popup"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={20}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          hexpand
          vexpand
        >
          <With value={openFolder}>
            {(f: Folder | null) =>
              f ? (
                // Click the name to rename the folder, like GNOME
                <Gtk.EditableLabel
                  class="folder-title"
                  halign={Gtk.Align.CENTER}
                  xalign={0.5}
                  widthChars={20}
                  text={f.name}
                  tooltipText="Rename"
                  $={(self) =>
                    self.connect("notify::editing", () => {
                      if (!self.editing && self.text !== f.name) renameFolder(f.id, self.text)
                    })
                  }
                />
              ) : (
                <box />
              )
            }
          </With>
          <With value={openFolder}>
            {(f: Folder | null) =>
              f ? (
                <Rows
                  items={f.apps.map((app) => ({ kind: "app" as const, app }))}
                  cols={Math.min(4, Math.max(1, f.apps.length))}
                  render={(item) => (item.kind === "app" ? <GridAppTile app={item.app} folder={f} onLaunch={onLaunch} /> : <box />)}
                />
              ) : (
                <box />
              )
            }
          </With>
        </box>
      </box>
    </overlay>
  )
}
