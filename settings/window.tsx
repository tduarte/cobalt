import Adw from "gi://Adw?version=1"
import Gio from "gi://Gio"
import GObject from "gi://GObject"
import Gtk from "gi://Gtk?version=4.0"
import { createRoot } from "ags"
import { PAGES, PageDef } from "./pages"

// GNOME Settings' window: a sidebar of pages in groups (separators between
// them) and the selected page on the right. Sub-pages (Night Light, Volume
// Levels...) are pushed onto the content's navigation view with a back arrow.

let select: ((id: string, action?: string) => void) | null = null

// `cobalt-settings <page> [action]`, like `gnome-control-center wifi`
export function showPage(id: string, action?: string) {
  select?.(id, action)
}

function sidebarRow(page: PageDef) {
  return (
    <Gtk.ListBoxRow name={page.id} tooltipText={page.title}>
      <box spacing={12} marginStart={6} marginTop={8} marginBottom={8}>
        <image iconName={page.icon} />
        <label label={page.title} xalign={0} hexpand />
      </box>
    </Gtk.ListBoxRow>
  ) as Gtk.ListBoxRow
}

export default function SettingsWindow({ app }: { app: Adw.Application }) {
  const pages = PAGES.filter((p) => p.available?.() ?? true)
  const nav = new Adw.NavigationView()
  const content = new Adw.NavigationPage({ title: "Settings", child: nav })
  let disposePage: (() => void) | null = null
  let actions = new Map<string, () => void>()

  // Sidebar list with search
  const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.SINGLE })
  list.add_css_class("navigation-sidebar")
  const rows = pages.map((p) => {
    const row = sidebarRow(p)
    list.append(row)
    return row
  })
  // A separator above the first page of each group, like GNOME
  list.set_header_func((row, before) => {
    const page = pages[row.get_index()]
    const prev = before ? pages[before.get_index()] : null
    row.set_header(prev && prev.group !== page.group ? new Gtk.Separator({ marginTop: 6, marginBottom: 6 }) : null)
  })

  const search = new Gtk.SearchEntry({ placeholderText: "Search settings", hexpand: true })
  const searchBar = new Gtk.SearchBar({ child: search, showCloseButton: false })
  searchBar.connect_entry(search)
  list.set_filter_func((row) => {
    const q = search.text.trim().toLowerCase()
    if (!q) return true
    const page = pages[row.get_index()]
    return [page.title, ...(page.keywords ?? [])].some((k) => k.toLowerCase().includes(q))
  })
  search.connect("search-changed", () => list.invalidate_filter())

  const split = new Adw.NavigationSplitView({
    minSidebarWidth: 260,
    maxSidebarWidth: 300,
    content,
  })

  // Sub-pages get their own scope, disposed when popped
  const subPages = new Map<Adw.NavigationPage, () => void>()
  nav.connect("popped", (_, p: Adw.NavigationPage) => {
    subPages.get(p)?.()
    subPages.delete(p)
  })
  const pushSubPage = (build: () => Adw.NavigationPage) => {
    let dispose: () => void = () => {}
    const p = createRoot((d) => {
      dispose = d
      return build()
    })
    subPages.set(p, dispose)
    nav.push(p)
  }

  const open = (page: PageDef) => {
    for (const dispose of subPages.values()) dispose()
    subPages.clear()
    disposePage?.()
    actions = new Map()
    const root = createRoot((dispose) => {
      disposePage = dispose
      return page.build({ push: pushSubPage, action: (name, run) => actions.set(name, run) })
    })
    nav.replace([root])
    content.title = page.title
    split.showContent = true
  }

  list.connect("row-selected", (_, row) => {
    if (row) open(pages[row.get_index()])
  })
  // Clicking the selected row again still shows it on a narrow window
  list.connect("row-activated", () => (split.showContent = true))

  select = (id, action) => {
    const i = pages.findIndex((p) => p.id === id)
    if (i < 0) return
    list.select_row(rows[i])
    // Dialogs need the window on screen first
    if (action) setTimeout(() => actions.get(action)?.(), 300)
  }

  const searchButton = new Gtk.ToggleButton({ iconName: "system-search-symbolic", tooltipText: "Search" })
  searchButton.bind_property(
    "active",
    searchBar,
    "search-mode-enabled",
    GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE,
  )

  const sidebarHeader = new Adw.HeaderBar({ showEndTitleButtons: false })
  sidebarHeader.pack_start(searchButton)
  const menu = new Gtk.MenuButton({ iconName: "open-menu-symbolic", tooltipText: "Main Menu", primary: true })
  const menuModel = new Gio.Menu()
  menuModel.append("About Settings", "app.about")
  menu.set_menu_model(menuModel)
  sidebarHeader.pack_end(menu)

  const sidebarView = new Adw.ToolbarView()
  sidebarView.add_top_bar(sidebarHeader)
  sidebarView.add_top_bar(searchBar)
  sidebarView.content = new Gtk.ScrolledWindow({ child: list, hscrollbarPolicy: Gtk.PolicyType.NEVER })
  split.sidebar = new Adw.NavigationPage({ title: "Settings", child: sidebarView })

  const win = new Adw.ApplicationWindow({
    application: app,
    title: "Settings",
    defaultWidth: 980,
    defaultHeight: 720,
    widthRequest: 360,
    heightRequest: 294,
    content: split,
  })

  // Narrow windows show one pane at a time
  const bp = new Adw.Breakpoint({ condition: Adw.BreakpointCondition.parse("max-width: 550sp") })
  bp.add_setter(split, "collapsed", true)
  win.add_breakpoint(bp)

  const about = new Gio.SimpleAction({ name: "about" })
  about.connect("activate", () =>
    new Adw.AboutDialog({
      applicationName: "Settings",
      applicationIcon: "org.gnome.Settings",
      developerName: "cobalt",
      website: "https://github.com/tduarte/cobalt",
      licenseType: Gtk.License.APACHE_2_0,
    }).present(win),
  )
  app.add_action(about)

  // Type anywhere in the window to search, like GNOME
  searchBar.set_key_capture_widget(win)

  list.select_row(rows[0])
  return win
}
