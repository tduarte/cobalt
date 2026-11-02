import app from "ags/gtk4/app"
import { For, This, createBinding } from "ags"
import { describeMenu, menuNames, toggleMenu } from "./lib/menus"
import { followAccent } from "./lib/accent"
import { startNightLight } from "./lib/nightlight"
import style from "./style.scss"
import Bar from "./widget/Bar"
import HotEdge from "./widget/HotEdge"
import DateMenu from "./widget/DateMenu"
import { MenuBackdrop } from "./widget/PanelMenu"
import QuickSettings from "./widget/QuickSettings"
import Shortcuts, { toggleShortcuts } from "./widget/Shortcuts"
import NotificationBanners from "./widget/NotificationBanners"
import Overview, { debugOverview, openFolderOverview, searchOverview, toggleOverview } from "./widget/overview"

app.start({
  instanceName: "cobalt",
  css: style,
  // Build on Adwaita rather than whatever GTK theme is set
  gtkTheme: "Adwaita",
  // `ags request -i cobalt toggle <menu> [sub-menu]` opens/closes a panel menu
  requestHandler(argv: string[], response: (response: string) => void) {
    const [command, name, subMenu] = argv
    if (command === "shortcuts") {
      toggleShortcuts()
      response("ok")
    } else if (command === "overview") {
      // `overview` toggles the launcher (`overview apps` is the same, for the
      // Super+A bind); `search <text>`, `folder <id>`, `debug` are for QA
      if (name === "search") searchOverview(argv.slice(2).join(" "))
      else if (name === "debug") return response(debugOverview())
      else if (name === "folder") openFolderOverview(argv[2] ?? "")
      else toggleOverview()
      response("ok")
    } else if (command === "css") {
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
    followAccent()
    startNightLight()
    const monitors = createBinding(app, "monitors")

    NotificationBanners()
    MenuBackdrop()
    DateMenu()
    QuickSettings()
    Overview()
    HotEdge()
    Shortcuts()

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
