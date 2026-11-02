import app from "ags/gtk4/app"
import { Astal, Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { showOverview } from "./overview"

const DWELL_MS = 120

// Like the GNOME "Hot Edge" extension: pushing the pointer against the bottom
// edge opens the overview. A 1 px strip on the TOP layer, so fullscreen
// windows (games, video) cover it and it can't fire while playing. It needs a
// tiny background alpha (style.scss): fully transparent surfaces aren't mapped.
export default function HotEdge() {
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  let timer: number | null = null
  const cancel = () => {
    if (timer !== null) GLib.source_remove(timer)
    timer = null
  }

  return (
    <window
      name="hot-edge"
      namespace="cobalt-hot-edge"
      class="hot-edge"
      application={app}
      layer={Astal.Layer.TOP}
      exclusivity={Astal.Exclusivity.IGNORE}
      anchor={BOTTOM | LEFT | RIGHT}
      heightRequest={1}
      visible
      $={(self) => {
        const motion = new Gtk.EventControllerMotion()
        // Wait a moment so sweeping past the edge doesn't trigger it
        motion.connect("enter", () => {
          cancel()
          timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DWELL_MS, () => {
            timer = null
            showOverview()
            return GLib.SOURCE_REMOVE
          })
        })
        motion.connect("leave", cancel)
        self.add_controller(motion)
      }}
    >
      <box heightRequest={1} />
    </window>
  )
}
