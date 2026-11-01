import app from "ags/gtk4/app"
import { Astal, Gdk } from "ags/gtk4"
import { onCleanup } from "ags"
import { DateMenuButton } from "./DateMenu"
import { QuickSettingsButton } from "./QuickSettings"
import Workspaces from "./Workspaces"

// GNOME-style top bar: Activities/workspaces left, clock center, quick
// settings right (tray apps are listed under Background Apps instead)
export default function Bar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  let win: Astal.Window
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

  // Bars aren't destroyed automatically when their monitor goes away
  onCleanup(() => win.destroy())

  return (
    <window
      $={(self) => (win = self)}
      visible
      name={`bar-${gdkmonitor.connector}`}
      namespace="cobalt-bar"
      class="bar"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
    >
      <centerbox class="bar-content">
        <box $type="start">
          <Workspaces monitor={gdkmonitor.connector} />
        </box>
        <box $type="center">
          <DateMenuButton />
        </box>
        <box $type="end" spacing={4}>
          <QuickSettingsButton />
        </box>
      </centerbox>
    </window>
  )
}
