import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import AstalApps from "gi://AstalApps"
import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import Pango from "gi://Pango"
import { For, createState } from "ags"
import { execAsync } from "ags/process"
import { closeMenus } from "../lib/menus"
import { hyprDispatch } from "../lib/system"

// GNOME-style Activities overview: search at the top, the current workspace's
// windows as live-captured thumbnails (grim -T on Hyprland's stableId), and an
// app grid (Super+A). Typing switches to app search.

type Win = {
  address: string
  stableId: string
  title: string
  class: string
  width: number
  height: number
  workspace: number
  focusHistoryID: number
}
type Mode = "windows" | "apps"

const apps = new AstalApps.Apps()
const captureDir = `${GLib.get_user_runtime_dir()}/cobalt-overview`
GLib.mkdir_with_parents(captureDir, 0o700)

const [visible, setVisible] = createState(false)
const [mode, setMode] = createState<Mode>("windows")
const [windows, setWindows] = createState<Win[]>([])
const [thumbs, setThumbs] = createState<Record<string, string>>({})
const [query, setQuery] = createState("")
let entry: Gtk.SearchEntry | null = null

function hypr(command: string): Promise<string> {
  return new Promise((resolve, reject) =>
    AstalHyprland.get_default().message_async(command, (_, res) => {
      try {
        resolve(AstalHyprland.get_default().message_finish(res))
      } catch (err) {
        reject(err)
      }
    }),
  )
}

async function refreshWindows() {
  const [clientsJson, activeJson] = await Promise.all([hypr("j/clients"), hypr("j/activeworkspace")])
  const active = JSON.parse(activeJson).id as number
  const wins: Win[] = JSON.parse(clientsJson)
    .filter((c: any) => c.mapped && !c.hidden && c.workspace.id === active)
    .map((c: any) => ({
      address: c.address,
      stableId: c.stableId,
      title: c.title,
      class: c.class,
      width: c.size[0],
      height: c.size[1],
      workspace: c.workspace.id,
      focusHistoryID: c.focusHistoryID,
    }))
  setWindows(wins)

  // Fresh thumbnails (~40 ms each); unique names so GTK doesn't reuse a cached image
  const stamp = Date.now()
  await Promise.all(
    wins.map(async (w) => {
      const path = `${captureDir}/${w.stableId}-${stamp}.jpg`
      try {
        await execAsync(["grim", "-T", w.stableId, "-s", "0.5", "-t", "jpeg", "-q", "80", path])
        setThumbs((t) => {
          const old = t[w.stableId]
          if (old) GLib.unlink(old)
          return { ...t, [w.stableId]: path }
        })
      } catch (err) {
        console.error("capture", w.class, err)
      }
    }),
  )
}

export function showOverview(m: Mode = "windows") {
  closeMenus()
  setMode(m)
  setQuery("")
  if (entry) entry.text = ""
  setVisible(true)
  if (m === "windows") refreshWindows().catch(console.error)
  entry?.grab_focus()
}

// Dev/QA: open the overview with text in the search field
export function searchOverview(text: string) {
  showOverview("windows")
  if (entry) entry.text = text
}

export function hideOverview() {
  setVisible(false)
}

export function toggleOverview(m: Mode = "windows") {
  if (visible.get() && mode.get() === m) hideOverview()
  else showOverview(m)
}

function launch(a: AstalApps.Application) {
  hideOverview()
  a.launch()
}

function focusWindow(w: Win) {
  hideOverview()
  hyprDispatch(`hl.dsp.focus({ window = "address:${w.address}" })`)
}

// ---- Window thumbnails ----

// Fit every window of the workspace into the available area: rows of up to
// ceil(sqrt(n)) windows, each scaled to the same height-limited cell
function layout(wins: Win[], areaW: number, areaH: number) {
  if (wins.length === 0) return []
  const cols = Math.ceil(Math.sqrt(wins.length))
  const rows: Win[][] = []
  for (let i = 0; i < wins.length; i += cols) rows.push(wins.slice(i, i + cols))
  const gap = 32
  const cellW = (areaW - gap * (cols - 1)) / cols
  const cellH = (areaH - gap * (rows.length - 1)) / rows.length - 40 // room for title
  return rows.map((row) =>
    row.map((w) => {
      const scale = Math.min(cellW / w.width, cellH / w.height, 1)
      return { win: w, width: Math.round(w.width * scale), height: Math.round(w.height * scale) }
    }),
  )
}

// A window's class is normally its app id, i.e. the .desktop file name
// (org.gnome.Nautilus, com.mitchellh.ghostty); fall back to a name search
function iconFor(cls: string): Gio.Icon {
  for (const id of [cls, cls.toLowerCase()]) {
    const info = Gio.DesktopAppInfo.new(`${id}.desktop`)
    const icon = info?.get_icon()
    if (icon) return icon
  }
  const match = apps.fuzzy_query(cls)[0]
  return Gio.ThemedIcon.new(match?.iconName || "application-x-executable")
}

function WindowPreview({ win, width, height }: { win: Win; width: number; height: number }) {
  const thumb = thumbs((t) => t[win.stableId] ?? "")
  return (
    <button class="window-preview" valign={Gtk.Align.CENTER} onClicked={() => focusWindow(win)}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={10}>
        <overlay>
          <box class="thumb-frame" widthRequest={width} heightRequest={height} overflow={Gtk.Overflow.HIDDEN}>
            <Gtk.Picture
              file={thumb((p) => (p ? Gio.File.new_for_path(p) : null))}
              contentFit={Gtk.ContentFit.COVER}
              hexpand
              vexpand
            />
          </box>
          <image
            $type="overlay"
            class="window-app-icon"
            gicon={iconFor(win.class)}
            pixelSize={48}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.END}
          />
        </overlay>
        <label
          class="window-title"
          halign={Gtk.Align.CENTER}
          label={win.title || win.class}
          ellipsize={Pango.EllipsizeMode.END}
          maxWidthChars={Math.max(10, Math.floor(width / 9))}
        />
      </box>
    </button>
  )
}

// ---- App search and grid ----

// GNOME-like ranking: name starts with the text, then a word in the name
// does, then the name contains it, then keywords/executable do
function searchApps(text: string): AstalApps.Application[] {
  const q = text.trim().toLowerCase()
  if (!q) return []
  const rank = (a: AstalApps.Application) => {
    const name = (a.name || "").toLowerCase()
    if (name.startsWith(q)) return 0
    if (name.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 1
    if (name.includes(q)) return 2
    const extra = [...(a.keywords ?? []), a.executable ?? "", a.entry ?? ""].join(" ").toLowerCase()
    if (extra.split(/[\s;\/\-_.]+/).some((w) => w.startsWith(q))) return 3
    return -1
  }
  return apps
    .get_list()
    .map((a) => ({ a, r: rank(a) }))
    .filter(({ r }) => r >= 0)
    .sort((x, y) => x.r - y.r || x.a.name.localeCompare(y.a.name))
    .slice(0, 18)
    .map(({ a }) => a)
}

function AppTile({ app: a }: { app: AstalApps.Application }) {
  return (
    <button class="app-tile" onClicked={() => launch(a)}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <image iconName={a.iconName || "application-x-executable"} pixelSize={72} />
        <label
          label={a.name}
          ellipsize={Pango.EllipsizeMode.END}
          maxWidthChars={12}
          justify={Gtk.Justification.CENTER}
        />
      </box>
    </button>
  )
}

function AppGrid({ list, perRow }: { list: AstalApps.Application[]; perRow: number }) {
  const rows: AstalApps.Application[][] = []
  for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow))
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={12} halign={Gtk.Align.CENTER}>
      {rows.map((row) => (
        <box spacing={12} halign={Gtk.Align.CENTER}>
          {row.map((a) => (
            <AppTile app={a} />
          ))}
        </box>
      ))}
    </box>
  )
}

export default function Overview() {
  const monitor = app.get_monitors()[0]
  const geo = monitor?.geometry ?? { width: 1280, height: 800 }
  const areaW = geo.width - 160
  const areaH = geo.height - 32 - 120 - 100

  const results = query((q) => searchApps(q))
  const allApps = () =>
    apps.get_list().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
  const perRow = Math.max(4, Math.floor((geo.width - 200) / 140))

  // What fills the middle: search results while typing, else windows or app grid
  const view = mode((m) => m)
  const content = query((q) => (q.trim() ? "search" : view.get()))

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
      marginTop={32}
      visible={visible}
      $={(self) => {
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            if (query.get()) {
              if (entry) entry.text = ""
            } else hideOverview()
            return true
          }
          return false
        })
        self.add_controller(keys)
      }}
    >
      <box
        class="overview-content"
        orientation={Gtk.Orientation.VERTICAL}
        $={(self) => {
          // Clicking empty space closes the overview, like GNOME
          const click = new Gtk.GestureClick()
          click.connect("released", (gesture, _n, x, y) => {
            const target = self.pick(x, y, Gtk.PickFlags.DEFAULT)
            if (target === self || target?.get_css_classes().includes("overview-empty")) hideOverview()
          })
          self.add_controller(click)
        }}
      >
        <Gtk.SearchEntry
          class="overview-search"
          placeholderText="Type to search"
          halign={Gtk.Align.CENTER}
          widthRequest={420}
          $={(self) => {
            entry = self as Gtk.SearchEntry
            self.connect("search-changed", () => setQuery(self.text))
            self.connect("activate", () => {
              const first = results.get()[0]
              if (first) launch(first)
            })
          }}
        />
        <stack
          vexpand
          transitionType={Gtk.StackTransitionType.CROSSFADE}
          visibleChildName={content}
        >
          <box $type="named" name="windows" class="overview-empty" halign={Gtk.Align.FILL} valign={Gtk.Align.FILL}>
            <box orientation={Gtk.Orientation.VERTICAL} spacing={32} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} hexpand vexpand>
              <For each={windows((ws) => layout(ws, areaW, areaH))}>
                {(row: Array<{ win: Win; width: number; height: number }>) => (
                  <box spacing={32} halign={Gtk.Align.CENTER}>
                    {row.map((cell) => (
                      <WindowPreview win={cell.win} width={cell.width} height={cell.height} />
                    ))}
                  </box>
                )}
              </For>
              <label
                class="overview-hint"
                label="No open windows"
                visible={windows((ws) => ws.length === 0)}
              />
            </box>
          </box>
          <scrolledwindow $type="named" name="apps" hscrollbarPolicy={Gtk.PolicyType.NEVER}>
            <box class="overview-empty" marginTop={24}>
              <AppGrid list={allApps()} perRow={perRow} />
            </box>
          </scrolledwindow>
          <box $type="named" name="search" class="overview-empty" valign={Gtk.Align.START}>
            <box hexpand marginTop={24}>
              <For each={results((r) => [r])}>
                {(list: AstalApps.Application[]) =>
                  list.length > 0 ? (
                    <box hexpand halign={Gtk.Align.CENTER}>
                      <AppGrid list={list} perRow={perRow} />
                    </box>
                  ) : (
                    <label class="overview-hint" label="No results" hexpand />
                  )
                }
              </For>
            </box>
          </box>
        </stack>
      </box>
    </window>
  )
}
