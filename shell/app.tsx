import app from "ags/gtk4/app"
import { For, This, createBinding } from "ags"
import { describeMenu, menuNames, toggleMenu } from "./lib/menus"
import { followAccent } from "./lib/accent"
import { startNightLight } from "./lib/nightlight"
import { syncDoNotDisturb } from "./lib/notifications"
import { checkUpdates, watchUpdates } from "./lib/updates"
import style from "./style.scss"
import Bar from "./widget/Bar"
import HotEdge from "./widget/HotEdge"
import DateMenu from "./widget/DateMenu"
import EndSession, { endSession, type EndKind } from "./widget/EndSession"
import { MenuBackdrop } from "./widget/PanelMenu"
import QuickSettings from "./widget/QuickSettings"
import ScreenshotUI, { setRecordingState, syncRecording, toggleScreenshotUI } from "./widget/ScreenshotUI"
import Shortcuts, { toggleShortcuts } from "./widget/Shortcuts"
import Switcher, { switcher } from "./widget/Switcher"
import NotificationBanners from "./widget/NotificationBanners"
import { expandNotifications } from "./widget/NotificationList"
import Overview, { debugOverview, openFolderOverview, searchOverview, toggleOverview } from "./widget/overview"

app.start({
  instanceName: "cobalt",
  css: style,
  // Build on Adwaita rather than whatever GTK theme is set
  gtkTheme: "Adwaita",
  // `ags request -i cobalt toggle <menu> [sub-menu]` opens/closes a panel menu
  requestHandler(argv: string[], response: (response: string) => void) {
    const [command, name, subMenu] = argv
    if (command === "session" && ["logout", "restart", "poweroff"].includes(name)) {
      // Log Out / Restart / Power Off dialog (keybinds, power button)
      endSession(name as EndKind)
      response("ok")
    } else if (command === "screenshot") {
      // Print: GNOME's screenshot UI (stops a running screencast instead)
      toggleScreenshotUI()
      response("ok")
    } else if (command === "recording") {
      // From cobalt-screenrecord: recording start | stop
      setRecordingState(name === "start")
      response("ok")
    } else if (command === "updates") {
      // QA: look for a staged OS update now
      checkUpdates(() => endSession("restart"))
      response("ok")
    } else if (command === "switcher") {
      // Alt+Tab: switcher next | prev | app-window
      switcher(name ?? "next")
      response("ok")
    } else if (command === "shortcuts") {
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
    } else if (command === "notifications") {
      // QA: notifications expand <app> | collapse
      expandNotifications(name === "expand" ? argv.slice(2).join(" ") : null)
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
    syncDoNotDisturb()
    watchUpdates(() => endSession("restart"))
    const monitors = createBinding(app, "monitors")

    NotificationBanners()
    MenuBackdrop()
    DateMenu()
    QuickSettings()
    Overview()
    HotEdge()
    Shortcuts()
    EndSession()
    Switcher()
    ScreenshotUI()
    syncRecording()

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
