import AstalTray from "gi://AstalTray"
import Gtk from "gi://Gtk?version=4.0"
import { For, createBinding } from "ags"

// App indicators (Steam, Discord, ...) next to the quick settings, like
// GNOME's AppIndicator extension
export default function Tray() {
  const tray = AstalTray.get_default()
  const items = createBinding(tray, "items")

  const init = (btn: Gtk.MenuButton, item: AstalTray.TrayItem) => {
    btn.menuModel = item.menuModel
    btn.insert_action_group("dbusmenu", item.actionGroup)
    item.connect("notify::action-group", () => {
      btn.insert_action_group("dbusmenu", item.actionGroup)
    })
  }

  return (
    <box class="tray" spacing={2} visible={items((i) => i.length > 0)}>
      <For each={items}>
        {(item: AstalTray.TrayItem) => (
          <menubutton
            class="panel-button tray-item"
            tooltipMarkup={createBinding(item, "tooltipMarkup")}
            $={(self) => init(self, item)}
          >
            <image gicon={createBinding(item, "gicon")} />
          </menubutton>
        )}
      </For>
    </box>
  )
}
