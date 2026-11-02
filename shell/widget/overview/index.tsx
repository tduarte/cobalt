import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import AstalApps from "gi://AstalApps"
import Graphene from "gi://Graphene"
import { With, createComputed, createState } from "ags"
import { closeMenus } from "../../lib/menus"
import { hyprDispatch } from "../../lib/system"
import { Dash, DashApp, dashItems } from "./dash"
import { AppTile, PagedGrid, TILE, TILE_GAP } from "./grid"
import { Folder, Win, folders, gridItems, loadWindows, onFavoritesChanged, searchApps } from "./model"

// The launcher (Super / Activities dots / Super+A): search on top, GNOME's
// paged app grid with folders, and the dash with favorites and running apps.
// Window management stays in Hyprland (keybindings, Alt+Tab); the launcher
// deliberately has no workspace cards or window thumbnails.

const BAR = 32

const [visible, setVisible] = createState(false)
const [query, setQuery] = createState("")
const [windows, setWindows] = createState<Win[]>([])
const [openFolder, setOpenFolder] = createState<Folder | null>(null)
const [favoritesVersion, setFavoritesVersion] = createState(0)
let entry: Gtk.SearchEntry | null = null

export function showOverview() {
  closeMenus()
  setOpenFolder(null)
  setQuery("")
  if (entry) entry.text = ""
  setVisible(true)
  entry?.grab_focus()
  // Only for the dash's running dots: a single cheap IPC call
  loadWindows().then(setWindows).catch(console.error)
}

export function hideOverview() {
  setVisible(false)
  setOpenFolder(null)
}

export function toggleOverview() {
  if (visible.get()) hideOverview()
  else showOverview()
}

// Dev/QA: open the launcher with text in the search field
export function searchOverview(text: string) {
  showOverview()
  if (entry) entry.text = text
}

// Dev/QA: open the launcher with a folder open (by folder id)
export function openFolderOverview(id: string) {
  showOverview()
  setOpenFolder(folders().find((f) => f.id === id) ?? null)
}

// Debug: allocated geometry of the launcher's main parts
export function debugOverview(): string {
  const win = app.get_window("overview")
  if (!win) return "no overview window"
  const out: string[] = [`window ${win.get_width()}x${win.get_height()}`]
  const walk = (w: Gtk.Widget) => {
    for (let c = w.get_first_child(); c; c = c.get_next_sibling()) {
      const cls = c.get_css_classes().join(".")
      if (/overview-search|dash|page-dots/.test(cls) || c instanceof Gtk.Stack) {
        const [ok, p] = c.compute_point(win, new Graphene.Point({ x: 0, y: 0 }))
        out.push(`${c.constructor.name} .${cls} at ${ok ? `${Math.round(p.x)},${Math.round(p.y)}` : "?"} size ${c.get_width()}x${c.get_height()}`)
      }
      walk(c)
    }
  }
  walk(win)
  return out.join("\n")
}

function launch(a: AstalApps.Application) {
  hideOverview()
  a.launch()
}

function activateDash(item: DashApp) {
  if (item.windows.length > 0) {
    // Focus the app's most recently used window
    const recent = [...item.windows].sort((a, b) => a.focusHistoryID - b.focusHistoryID)[0]
    hideOverview()
    hyprDispatch(`hl.dsp.focus({ window = "address:${recent.address}" })`)
  } else launch(item.app)
}

onFavoritesChanged(() => setFavoritesVersion((v) => v + 1))

export default function Overview() {
  const monitor = app.get_monitors()[0]
  const W = monitor?.geometry.width ?? 1280
  const H = monitor?.geometry.height ?? 800
  const contentH = H - BAR

  // Vertical budget: search (top) + page dots + dash (bottom); the grid gets the rest
  const SEARCH = 16 + 40 + 28
  const DOTS = 16 + 10
  const DASH = 20 + 82 + 20
  const gridH = contentH - SEARCH - DOTS - DASH
  // Page arrows take 2 x (48px + 2 x 36px margin) = 240px of the width
  const cols = Math.max(3, Math.min(8, Math.floor((W - 240 + TILE_GAP) / (TILE + TILE_GAP))))
  const rows = Math.max(2, Math.min(4, Math.floor((gridH + TILE_GAP) / (TILE + TILE_GAP))))

  const results = query((q) => searchApps(q))
  const view = createComputed(() => (query().trim() ? "search" : "apps"))
  const dashModel = createComputed(() => [windows(), favoritesVersion()] as const)

  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      name="overview"
      namespace="cobalt-overview"
      class="overview"
      application={app}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      // Below the top bar, which stays visible and usable like in GNOME
      marginTop={BAR}
      visible={visible}
      $={(self) => {
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval !== Gdk.KEY_Escape) return false
          if (openFolder.get()) setOpenFolder(null)
          else if (query.get()) {
            if (entry) entry.text = ""
          } else hideOverview()
          return true
        })
        self.add_controller(keys)
      }}
    >
      <box class="overview-content" orientation={Gtk.Orientation.VERTICAL}>
        <Gtk.SearchEntry
          class="overview-search"
          placeholderText="Type to search"
          halign={Gtk.Align.CENTER}
          widthRequest={480}
          $={(self) => {
            entry = self as Gtk.SearchEntry
            self.connect("search-changed", () => setQuery(self.text))
            self.connect("activate", () => {
              const first = results.get()[0]
              if (first) launch(first)
            })
          }}
        />
        <stack vexpand transitionType={Gtk.StackTransitionType.CROSSFADE} transitionDuration={150} visibleChildName={view}>
          <box $type="named" name="apps" vexpand>
            <PagedGrid
              items={gridItems()}
              cols={cols}
              rows={rows}
              onLaunch={launch}
              openFolder={openFolder}
              setOpenFolder={setOpenFolder}
            />
          </box>
          <box $type="named" name="search" valign={Gtk.Align.START} halign={Gtk.Align.CENTER}>
            <With value={results}>
              {(list: AstalApps.Application[]) =>
                list.length > 0 ? (
                  // GNOME shows a single row of matching apps at the top
                  <box spacing={TILE_GAP} marginTop={4} halign={Gtk.Align.CENTER}>
                    {list.slice(0, cols).map((a) => (
                      <AppTile app={a} onLaunch={launch} />
                    ))}
                  </box>
                ) : (
                  <label class="overview-hint" label="No results" marginTop={40} />
                )
              }
            </With>
          </box>
        </stack>
        <box halign={Gtk.Align.CENTER}>
          <With value={dashModel}>
            {([wins]: readonly [Win[], number]) => <Dash items={dashItems(wins)} onActivate={activateDash} />}
          </With>
        </box>
      </box>
    </window>
  )
}
