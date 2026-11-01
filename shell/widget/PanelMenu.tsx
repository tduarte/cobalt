import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { closeMenus, openMenu, registerMenu } from "../lib/menus"

// A GNOME-style panel menu: its own layer-shell window under the bar
// (right edge for quick settings, centered for the date menu). The content
// sits in a fixed-width scroller, so long labels or opened sub-menus can't
// widen the menu, and very tall content scrolls instead of leaving the screen.
export default function PanelMenu({
  name,
  align,
  width,
  children,
}: {
  name: string
  align: "center" | "end"
  width: number
  children: JSX.Element
}) {
  const { TOP, BOTTOM, RIGHT } = Astal.WindowAnchor
  const monitorHeight = () => {
    const monitors = app.get_monitors()
    return monitors.length > 0 ? monitors[0].geometry.height : 800
  }

  // The window spans from under the bar to the bottom of the screen, so it
  // never has to resize when an inline menu opens (layer-shell windows keep
  // their first size). The empty area below the panel closes the menu.
  return (
    <window
      name={name}
      namespace="cobalt-menu"
      class="panel-menu-window"
      application={app}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={align === "end" ? TOP | BOTTOM | RIGHT : TOP | BOTTOM}
      marginTop={32}
      visible={openMenu((m) => m === name)}
      $={(self) => {
        registerMenu(name, self)
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            closeMenus()
            return true
          }
          return false
        })
        self.add_controller(keys)
      }}
    >
      <box orientation={Gtk.Orientation.VERTICAL}>
        <box class={`panel-menu ${name}`} valign={Gtk.Align.START}>
          <scrolledwindow
            widthRequest={width}
            hscrollbarPolicy={Gtk.PolicyType.NEVER}
            vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
            propagateNaturalHeight
            maxContentHeight={monitorHeight() - 110}
          >
            {children}
          </scrolledwindow>
        </box>
        <box
          vexpand
          $={(self) => {
            const click = new Gtk.GestureClick()
            click.connect("pressed", () => closeMenus())
            self.add_controller(click)
          }}
        />
      </box>
    </window>
  )
}

// Transparent click-catcher over the work area (not the bar, so other bar
// buttons stay clickable); clicking it closes the open menu.
export function MenuBackdrop() {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      name="menu-backdrop"
      namespace="cobalt-backdrop"
      class="menu-backdrop"
      application={app}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.NORMAL}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      visible={openMenu((m) => m !== null)}
      $={(self) => {
        const click = new Gtk.GestureClick()
        click.connect("pressed", () => closeMenus())
        self.add_controller(click)
      }}
    >
      <box hexpand vexpand />
    </window>
  )
}
