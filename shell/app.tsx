import app from "ags/gtk4/app"
import { For, This, createBinding } from "ags"
import { describeMenu, menuNames, toggleMenu } from "./lib/menus"
import style from "./style.scss"
import Bar from "./widget/Bar"
import DateMenu from "./widget/DateMenu"
import { MenuBackdrop } from "./widget/PanelMenu"
import QuickSettings from "./widget/QuickSettings"
import NotificationBanners from "./widget/NotificationBanners"

app.start({
  instanceName: "cobalt",
  css: style,
  // Build on Adwaita rather than whatever GTK theme is set
  gtkTheme: "Adwaita",
  // `ags request -i cobalt toggle <menu> [sub-menu]` opens/closes a panel menu
  requestHandler(argv: string[], response: (response: string) => void) {
    const [command, name, subMenu] = argv
    if (command === "css") {
      // Dev: try CSS live, e.g. ags request -i cobalt css "button { color: red; }"
      app.apply_css(argv.slice(1).join(" "))
      response("ok")
    } else if (command === "describe" && name) {
      response(describeMenu(name))
    } else if (command === "toggle" && name) {
      response(toggleMenu(name, subMenu) ? "ok" : `unknown menu: ${name} (${menuNames().join(", ")})`)
    } else {
      response("usage: toggle <menu>")
    }
  },
  main() {
    const monitors = createBinding(app, "monitors")

    NotificationBanners()
    MenuBackdrop()
    DateMenu()
    QuickSettings()

    return (
      <For each={monitors}>
        {(monitor) => (
          <This this={app}>
            <Bar gdkmonitor={monitor} />
          </This>
        )}
      </For>
    )
  },
})
