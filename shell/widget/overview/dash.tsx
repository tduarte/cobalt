import AstalApps from "gi://AstalApps"
import Gtk from "gi://Gtk?version=4.0"
import { Win, apps, desktopIdFor, favorites } from "./model"

type DashApp = { app: AstalApps.Application; windows: Win[] }

// GNOME's dash: favorites first, then a separator and running apps that
// aren't favorites. A dot marks apps with open windows. (No Show Apps
// button: the launcher is the app grid.)
export function dashItems(allWindows: Win[]): { favorites: DashApp[]; running: DashApp[] } {
  const byApp = new Map<string, Win[]>()
  for (const w of allWindows) {
    const id = desktopIdFor(w.class)
    if (id) byApp.set(id, [...(byApp.get(id) ?? []), w])
  }
  const favs = favorites()
  const favIds = new Set(favs.map((a) => a.entry))
  const running = [...byApp.entries()]
    .filter(([id]) => !favIds.has(id))
    .map(([id, windows]) => ({ app: apps.get_list().find((a) => a.entry === id)!, windows }))
    .filter((d) => d.app)
  return {
    favorites: favs.map((app) => ({ app, windows: byApp.get(app.entry) ?? [] })),
    running,
  }
}

function DashIcon({
  item,
  onActivate,
}: {
  item: DashApp
  onActivate: (item: DashApp) => void
}) {
  return (
    <button class="dash-item" tooltipText={item.app.name} onClicked={() => onActivate(item)}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={3}>
        <image iconName={item.app.iconName || "application-x-executable"} pixelSize={48} />
        <box class={item.windows.length > 0 ? "running-dot" : "running-dot hidden"} halign={Gtk.Align.CENTER} />
      </box>
    </button>
  )
}

export function Dash({
  items,
  onActivate,
}: {
  items: { favorites: DashApp[]; running: DashApp[] }
  onActivate: (item: DashApp) => void
}) {
  return (
    <box class="dash" halign={Gtk.Align.CENTER} spacing={6}>
      {items.favorites.map((item) => (
        <DashIcon item={item} onActivate={onActivate} />
      ))}
      {items.running.length > 0 && <box class="dash-separator" />}
      {items.running.map((item) => (
        <DashIcon item={item} onActivate={onActivate} />
      ))}
    </box>
  )
}

export type { DashApp }
