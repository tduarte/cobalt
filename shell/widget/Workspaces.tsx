import AstalHyprland from "gi://AstalHyprland"
import Gtk from "gi://Gtk?version=4.0"
import { For, createBinding, createComputed } from "ags"
import { toggleOverview } from "./overview"

// GNOME 45+ style Activities button: a dot per workspace, the active one
// stretched into a pill. Like GNOME, the whole button opens the overview;
// the dots are indicators, not separate buttons.
export default function Workspaces({ monitor }: { monitor: string }) {
  const hypr = AstalHyprland.get_default()
  const workspaces = createBinding(hypr, "workspaces")
  const focused = createBinding(hypr, "focusedWorkspace")

  const sorted = createComputed(() =>
    workspaces()
      .filter((ws) => ws.id > 0 && (!ws.monitor || ws.monitor.name === monitor))
      .sort((a, b) => a.id - b.id),
  )

  return (
    <button class="panel-button activities" onClicked={() => toggleOverview()}>
      <box class="workspace-dots" valign={Gtk.Align.CENTER} spacing={6}>
        <For each={sorted}>
          {(ws: AstalHyprland.Workspace) => (
            <box
              class={focused((f) => (f?.id === ws.id ? "dot active" : "dot"))}
              valign={Gtk.Align.CENTER}
            />
          )}
        </For>
      </box>
    </button>
  )
}
