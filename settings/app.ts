import Adw from "gi://Adw?version=1"
import Gdk from "gi://Gdk?version=4.0"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { createRoot } from "ags"
import SettingsWindow, { showPage } from "./window"
import style from "./style.css"

// cobalt's Settings app (M5): GNOME Settings' layout and pages, backed by
// NetworkManager, BlueZ, WirePlumber, Hyprland and GNOME's GSettings keys.
// `cobalt-settings [page]` opens a page, like `gnome-control-center wifi`.

export const APP_ID = "io.github.tduarte.cobalt.Settings"

const app = new Adw.Application({
  applicationId: APP_ID,
  flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
})

app.connect("startup", () => {
  const quit = new Gio.SimpleAction({ name: "quit" })
  quit.connect("activate", () => app.quit())
  app.add_action(quit)
  app.set_accels_for_action("app.quit", ["<Control>q"])
  app.set_accels_for_action("window.close", ["<Control>w"])

  const css = new Gtk.CssProvider()
  css.load_from_string(style)
  Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default()!,
    css,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  )
})

// Single instance: a second `cobalt-settings wifi` lands here in the running app
app.connect("command-line", (_, cmdline: Gio.ApplicationCommandLine) => {
  const [, page, action] = cmdline.get_arguments()
  const win = app.get_active_window() ?? createRoot(() => SettingsWindow({ app }))
  win.present()
  if (page) showPage(page, action)
  return 0
})

app.runAsync([GLib.get_prgname() ?? "cobalt-settings", ...ARGV])
