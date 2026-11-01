import AstalTray from "gi://AstalTray"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango"
import { For, createBinding } from "ags"
import { closeMenus } from "../../lib/menus"
import { MenuPanel, MenuRevealer, OpenMenu } from "./parts"

// GNOME's Background Apps, built from tray apps (StatusNotifierItem): Hyprland
// has no background-apps portal, but Discord, Steam, 1Password... all expose a
// tray item, and the bar shows no tray icons (like stock GNOME).

type QuitAction = { action: string; target: GLib.Variant | null }

const STRING = new GLib.VariantType("s")

// Find the app's own "Quit"/"Exit" entry in its tray menu (tray apps have no
// standard quit call, so this is how ✕ closes them, as GNOME's ✕ does)
function findQuit(model: Gio.MenuModel): QuitAction | null {
  for (let i = 0; i < model.get_n_items(); i++) {
    const label = model.get_item_attribute_value(i, "label", STRING)?.unpack() as string | undefined
    const action = model.get_item_attribute_value(i, "action", STRING)?.unpack() as string | undefined
    if (label && action && /^(quit|exit)\b/i.test(label.replace(/_/g, "").trim())) {
      return { action, target: model.get_item_attribute_value(i, "target", null) }
    }
    for (const link of ["section", "submenu"]) {
      const sub = model.get_item_link(i, link)
      const found = sub && findQuit(sub)
      if (found) return found
    }
  }
  return null
}

function showMenu(item: AstalTray.TrayItem, anchor: Gtk.Widget) {
  const popover = Gtk.PopoverMenu.new_from_model(item.menuModel)
  popover.insert_action_group("dbusmenu", item.actionGroup)
  popover.set_parent(anchor)
  popover.connect("closed", () => popover.unparent())
  popover.popup()
}

function quit(item: AstalTray.TrayItem, anchor: Gtk.Widget) {
  item.about_to_show()
  const found = item.menuModel && findQuit(item.menuModel)
  if (found) {
    // Menu actions are exported as "dbusmenu.<id>"
    const name = found.action.replace(/^dbusmenu\./, "")
    item.actionGroup.activate_action(name, found.target)
  } else if (item.menuModel) {
    showMenu(item, anchor)
  }
}

const appName = (item: AstalTray.TrayItem) => item.title || item.tooltipMarkup || item.id

function BackgroundApp({ item }: { item: AstalTray.TrayItem }) {
  return (
    <box class="background-app" spacing={10}>
      <button
        class="qs-menu-item"
        hexpand
        tooltipText="Open"
        onClicked={() => {
          closeMenus()
          item.activate(0, 0)
        }}
      >
        <box spacing={12}>
          <image gicon={createBinding(item, "gicon")} pixelSize={24} />
          <label
            class="app-title"
            label={createBinding(item, "title")((t) => t || appName(item))}
            xalign={0}
            hexpand
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={22}
          />
        </box>
      </button>
      <button
        class="close-app"
        valign={Gtk.Align.CENTER}
        tooltipText="Quit"
        $={(self) => self.connect("clicked", () => quit(item, self))}
      >
        <image iconName="window-close-symbolic" />
      </button>
    </box>
  )
}

// "N Background Apps ›" at the bottom of quick settings, plus its inline list
export default function BackgroundApps({ open }: { open: OpenMenu }) {
  const items = createBinding(AstalTray.get_default(), "items")
  const id = "background-apps"
  const summary = items((is) => `${is.length} Background App${is.length === 1 ? "" : "s"}`)

  return (
    <box orientation={Gtk.Orientation.VERTICAL} visible={items((is) => is.length > 0)}>
      <button
        class="background-apps-row"
        onClicked={() => open.set(open.get.get() === id ? null : id)}
      >
        <box>
          <label label={summary} xalign={0} hexpand />
          <image iconName={open.get((m) => (m === id ? "go-down-symbolic" : "go-next-symbolic"))} />
        </box>
      </button>
      <MenuRevealer id={id} open={open}>
        <box class="qs-menu-spacer">
          <MenuPanel icon="cobalt-background-apps-symbolic" title="Background Apps">
            <label class="qs-menu-subtitle" label="Apps known to be running without a window" xalign={0} wrap />
            <For each={items}>{(item: AstalTray.TrayItem) => <BackgroundApp item={item} />}</For>
          </MenuPanel>
        </box>
      </MenuRevealer>
    </box>
  )
}
