import AstalApps from "gi://AstalApps"
import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import Gio from "gi://Gio"

// Data for the launcher: open windows (for the dash's running dots), and
// GNOME's own dash favorites and app folders, read from the same GSettings
// keys GNOME Shell uses so a user's GNOME setup carries over.

export type Win = {
  address: string
  class: string
  focusHistoryID: number
}

export const apps = new AstalApps.Apps()

export function hypr(command: string): Promise<string> {
  const h = AstalHyprland.get_default()
  return new Promise((resolve, reject) =>
    h.message_async(command, (_, res) => {
      try {
        resolve(h.message_finish(res))
      } catch (err) {
        reject(err)
      }
    }),
  )
}

export async function loadWindows(): Promise<Win[]> {
  return JSON.parse(await hypr("j/clients"))
    .filter((c: any) => c.mapped && !c.hidden)
    .map((c: any) => ({ address: c.address, class: c.class, focusHistoryID: c.focusHistoryID }))
}

// A window's class is normally its app id, i.e. the .desktop file name
export function desktopIdFor(cls: string): string | null {
  for (const id of [cls, cls.toLowerCase()]) {
    if (Gio.DesktopAppInfo.new(`${id}.desktop`)) return `${id}.desktop`
  }
  const match = apps.get_list().find(
    (a) => (a.wmClass || "").toLowerCase() === cls.toLowerCase() || (a.entry || "").toLowerCase() === `${cls.toLowerCase()}.desktop`,
  )
  return match?.entry ?? null
}

export function iconFor(cls: string): Gio.Icon {
  const id = desktopIdFor(cls)
  const icon = id ? Gio.DesktopAppInfo.new(id)?.get_icon() : null
  return icon ?? Gio.ThemedIcon.new(apps.fuzzy_query(cls)[0]?.iconName || "application-x-executable")
}

export const appById = (id: string) => apps.get_list().find((a) => a.entry === id) ?? null

// ---- GNOME settings: dash favorites and app folders ----

const shellSettings = new Gio.Settings({ schema_id: "org.gnome.shell" })
const folderSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.app-folders" })

export function favorites(): AstalApps.Application[] {
  return shellSettings
    .get_strv("favorite-apps")
    .map(appById)
    .filter((a): a is AstalApps.Application => a !== null)
}

export function onFavoritesChanged(cb: () => void) {
  shellSettings.connect("changed::favorite-apps", cb)
}

export type Folder = { id: string; name: string; apps: AstalApps.Application[] }

// Folder names may point at a .directory file (X-GNOME-Shell-Utilities.directory)
function folderName(raw: string): string {
  if (!raw.endsWith(".directory")) return raw
  for (const dir of GLib.get_system_data_dirs()) {
    const kf = new GLib.KeyFile()
    try {
      kf.load_from_file(`${dir}/desktop-directories/${raw}`, GLib.KeyFileFlags.NONE)
      return kf.get_locale_string("Desktop Entry", "Name", null)
    } catch {
      // try the next data dir
    }
  }
  return raw.replace(/^X-GNOME-Shell-/, "").replace(/\.directory$/, "")
}

// Folder changes (ours or anyone's), for the launcher to rebuild its grid
const folderListeners: (() => void)[] = []
const foldersChanged = () => folderListeners.forEach((cb) => cb())
export const onFoldersChanged = (cb: () => void) => folderListeners.push(cb)
folderSettings.connect("changed::folder-children", foldersChanged)

// One Settings object per folder, so our own writes read back at once
const folderCache = new Map<string, Gio.Settings>()
function folderKeys(id: string) {
  let s = folderCache.get(id)
  if (!s) {
    s = new Gio.Settings({
      schema_id: "org.gnome.desktop.app-folders.folder",
      path: `/org/gnome/desktop/app-folders/folders/${id}/`,
    })
    s.connect("changed", foldersChanged)
    folderCache.set(id, s)
  }
  return s
}

const byName = (a: AstalApps.Application, b: AstalApps.Application) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" })

export function folders(): Folder[] {
  const all = apps.get_list()
  return folderSettings
    .get_strv("folder-children")
    .map((id) => {
      const s = folderKeys(id)
      const listed = new Set(s.get_strv("apps"))
      const categories = s.get_strv("categories")
      const excluded = new Set(s.get_strv("excluded-apps"))
      const members = all.filter(
        (a) =>
          !excluded.has(a.entry) &&
          (listed.has(a.entry) || (categories.length > 0 && categories.some((c) => (a.categories ?? []).includes(c)))),
      )
      return { id, name: folderName(s.get_string("name")), apps: members.sort(byName) }
    })
    .filter((f) => f.apps.length > 0)
}

// ---- Editing folders (drag and drop), the way GNOME Shell writes them ----

const without = (list: string[], item: string) => list.filter((x) => x !== item)

function deleteFolder(id: string) {
  folderSettings.set_strv("folder-children", without(folderSettings.get_strv("folder-children"), id))
  const s = folderKeys(id)
  for (const key of ["name", "apps", "categories", "excluded-apps", "translate"]) s.reset(key)
}

export function removeFromFolder(appId: string, folderId: string) {
  const s = folderKeys(folderId)
  const listed = s.get_strv("apps")
  // Listed apps are dropped from the list; apps there by category are excluded
  if (listed.includes(appId)) s.set_strv("apps", without(listed, appId))
  else s.set_strv("excluded-apps", [...without(s.get_strv("excluded-apps"), appId), appId])
  // GNOME deletes a folder once it's empty
  if (!folders().some((f) => f.id === folderId)) deleteFolder(folderId)
}

function leaveFolders(appId: string, except?: string) {
  for (const f of folders()) if (f.id !== except && f.apps.some((a) => a.entry === appId)) removeFromFolder(appId, f.id)
}

export function moveToFolder(appId: string, folderId: string) {
  leaveFolders(appId, folderId)
  const s = folderKeys(folderId)
  s.set_strv("excluded-apps", without(s.get_strv("excluded-apps"), appId))
  if (!s.get_strv("apps").includes(appId)) s.set_strv("apps", [...s.get_strv("apps"), appId])
}

// Folder names for categories, when the new folder's apps share one
const CATEGORY_NAMES: [string, string][] = [
  ["Game", "Games"],
  ["Development", "Development"],
  ["Graphics", "Graphics"],
  ["Office", "Office"],
  ["AudioVideo", "Sound & Video"],
  ["Network", "Internet"],
  ["Education", "Education"],
  ["Science", "Science"],
  ["Settings", "Settings"],
  ["System", "System"],
  ["Utility", "Utilities"],
]

// Dropping an app on another makes a folder of the two, like GNOME
export function createFolder(appIds: string[]): string {
  for (const id of appIds) leaveFolders(id)
  const shared = appIds
    .map((id) => new Set(appById(id)?.categories ?? []))
    .reduce((a, b) => new Set([...a].filter((c) => b.has(c))))
  // A name no other folder has, so two folders never look the same
  const taken = new Set(folders().map((f) => f.name))
  const name = CATEGORY_NAMES.find(([c, n]) => shared.has(c) && !taken.has(n))?.[1] ?? "Unnamed Folder"
  const id = GLib.uuid_string_random()
  const s = folderKeys(id)
  s.set_string("name", name)
  s.set_boolean("translate", false)
  s.set_strv("apps", appIds)
  folderSettings.set_strv("folder-children", [...folderSettings.get_strv("folder-children"), id])
  return id
}

export function renameFolder(id: string, name: string) {
  if (name.trim()) folderKeys(id).set_string("name", name.trim())
}

export function folderOf(appId: string): string | null {
  return folders().find((f) => f.apps.some((a) => a.entry === appId))?.id ?? null
}

// App grid items: folders and the apps not in a folder, always alphabetical
// (drag and drop moves apps in and out of folders but doesn't reorder)
export type GridItem = { kind: "app"; app: AstalApps.Application } | { kind: "folder"; folder: Folder }

export function gridItems(): GridItem[] {
  const fs = folders()
  const inFolder = new Set(fs.flatMap((f) => f.apps.map((a) => a.entry)))
  const items: GridItem[] = [
    ...fs.map((folder) => ({ kind: "folder" as const, folder })),
    ...apps
      .get_list()
      .filter((a) => !inFolder.has(a.entry))
      .map((app) => ({ kind: "app" as const, app })),
  ]
  const name = (i: GridItem) => (i.kind === "app" ? i.app.name : i.folder.name)
  return items.sort((a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: "base" }))
}

// GNOME-like search ranking: name starts with the text, then a word in the
// name does, then the name contains it, then keywords/executable do
export function searchApps(text: string): AstalApps.Application[] {
  const q = text.trim().toLowerCase()
  if (!q) return []
  const rank = (a: AstalApps.Application) => {
    const name = (a.name || "").toLowerCase()
    if (name.startsWith(q)) return 0
    if (name.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 1
    if (name.includes(q)) return 2
    const extra = [...(a.keywords ?? []), a.executable ?? "", a.entry ?? ""].join(" ").toLowerCase()
    if (extra.split(/[\s;/\-_.]+/).some((w) => w.startsWith(q))) return 3
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
