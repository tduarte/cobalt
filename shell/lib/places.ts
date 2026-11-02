import Gio from "gi://Gio"
import GLib from "gi://GLib"
import GWeather from "gi://GWeather?version=4.0"
import { createState } from "ags"

// World clocks and the weather location for the date menu, from the apps that
// manage them: GNOME Clocks and GNOME Weather. Installed as Flatpaks (as on
// cobalt) they keep their settings in a keyfile in their sandbox, which is
// where GNOME Shell reads them too; host installs use GNOME Shell's own keys
// (org.gnome.shell.world-clocks / org.gnome.shell.weather).

const CLOCKS = { app: "org.gnome.clocks", group: "org/gnome/clocks", key: "world-clocks", type: "aa{sv}" }
const WEATHER = { app: "org.gnome.Weather", group: "org/gnome/Weather", key: "locations", type: "av" }

const [clocks, setClocks] = createState<GWeather.Location[]>([])
const [weatherLocation, setWeatherLocation] = createState<GWeather.Location | null>(null)
export { clocks, weatherLocation }

const keyfilePath = (app: string) => `${GLib.get_home_dir()}/.var/app/${app}/config/glib-2.0/settings/keyfile`

function readKeyfile(spec: typeof CLOCKS): GLib.Variant | null {
  const kf = new GLib.KeyFile()
  try {
    kf.load_from_file(keyfilePath(spec.app), GLib.KeyFileFlags.NONE)
    return GLib.Variant.parse(new GLib.VariantType(spec.type), kf.get_value(spec.group, spec.key), null, null)
  } catch {
    return null
  }
}

function shellKey(schema: string, key: string): GLib.Variant | null {
  if (!Gio.SettingsSchemaSource.get_default()?.lookup(schema, true)) return null
  return new Gio.Settings({ schemaId: schema }).get_value(key)
}

function deserialize(v: GLib.Variant | null) {
  if (!v) return null
  try {
    return GWeather.Location.get_world()?.deserialize(v) ?? null
  } catch {
    return null
  }
}

function loadClocks() {
  const fromApp = readKeyfile(CLOCKS)
  const list: GWeather.Location[] = []
  if (fromApp) {
    // Each clock is {"location": <serialized GWeather location>}
    for (let i = 0; i < fromApp.n_children(); i++) {
      const loc = deserialize(fromApp.get_child_value(i).lookup_value("location", null))
      if (loc) list.push(loc)
    }
  } else {
    const v = shellKey("org.gnome.shell.world-clocks", "locations")
    for (let i = 0; v && i < v.n_children(); i++) {
      const loc = deserialize(v.get_child_value(i).get_variant())
      if (loc) list.push(loc)
    }
  }
  setClocks(list)
}

function loadWeather() {
  // The first saved location, like GNOME Shell
  const v = readKeyfile(WEATHER) ?? shellKey("org.gnome.shell.weather", "locations")
  setWeatherLocation(v && v.n_children() > 0 ? deserialize(v.get_child_value(0).get_variant()) : null)
}

const monitors: Gio.FileMonitor[] = []

function watch(app: string, reload: () => void) {
  // Watch the directory (the keyfile is replaced, not edited) when the app
  // has one; otherwise the date menu reloads when it opens (reloadPlaces)
  const dir = Gio.File.new_for_path(GLib.path_get_dirname(keyfilePath(app)))
  if (!dir.query_exists(null)) return
  try {
    const m = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null)
    m.connect("changed", reload)
    monitors.push(m)
  } catch (err) {
    console.error(`watch ${app}`, err)
  }
}

export function reloadPlaces() {
  loadClocks()
  loadWeather()
}

export function watchPlaces() {
  loadClocks()
  loadWeather()
  watch(CLOCKS.app, loadClocks)
  watch(WEATHER.app, loadWeather)
}
