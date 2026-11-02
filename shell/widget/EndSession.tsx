import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import Gio from "gi://Gio"
import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import { For, createComputed, createState } from "ags"
import { execAsync } from "ags/process"
import { closeMenus } from "../lib/menus"
import { hyprDispatch } from "../lib/system"
import { pending, type Pending } from "../lib/updates"
import { desktopIdFor, iconFor } from "./overview/model"

// GNOME's end session dialog for Log Out, Restart and Power Off: it counts
// down 60 seconds, then asks every app to close (like gnome-session does) so
// unsaved work gets its "Save changes?" prompt instead of being killed. Apps
// still open after a few seconds are listed, with "<Action> Anyway".

export type EndKind = "logout" | "restart" | "poweroff"

const KINDS: Record<EndKind, { title: string; action: string; body: (s: number) => string }> = {
  logout: {
    title: "Log Out",
    action: "Log Out",
    body: (s) => `${userName()} will be logged out automatically in ${s} seconds.`,
  },
  restart: {
    title: "Restart",
    action: "Restart",
    body: (s) => `The system will restart automatically in ${s} seconds.`,
  },
  poweroff: {
    title: "Power Off",
    action: "Power Off",
    body: (s) => `The system will power off automatically in ${s} seconds.`,
  },
}

// GLib says "Unknown" when the account has no full name
function userName() {
  const real = GLib.get_real_name()
  return real && real !== "Unknown" ? real : GLib.get_user_name()
}

const COUNTDOWN = 60
// How long apps get to close before we list the ones still open
const CLOSE_WAIT = 5

type Phase = "confirm" | "closing" | "blocked"
type OpenWindow = { title: string; app: string; icon: Gio.Icon }

const [visible, setVisible] = createState(false)
const [kind, setKind] = createState<EndKind>("poweroff")
const [phase, setPhase] = createState<Phase>("confirm")
const [seconds, setSeconds] = createState(COUNTDOWN)
const [error, setError] = createState("")
const [stillOpen, setStillOpen] = createState<OpenWindow[]>([])

let timer = 0

function stopTimer() {
  if (timer) GLib.source_remove(timer)
  timer = 0
}

function describe(c: AstalHyprland.Client): OpenWindow {
  const cls = c.class || c.initialClass || ""
  const id = desktopIdFor(cls)
  return {
    title: c.title || cls,
    app: (id && Gio.DesktopAppInfo.new(id)?.get_name()) || cls,
    icon: iconFor(cls),
  }
}

function cancel() {
  stopTimer()
  setVisible(false)
}

// The action itself, once apps are closed (or the user said "Anyway")
function finish() {
  stopTimer()
  const k = kind.get()
  if (k === "logout") {
    setVisible(false)
    hyprDispatch("hl.dsp.exit()")
    return
  }
  execAsync(["systemctl", k === "restart" ? "reboot" : "poweroff"]).catch((err) => {
    // e.g. blocked by an inhibitor (an update in progress)
    setPhase("blocked")
    setError(String(err).split("\n").pop() ?? String(err))
  })
}

// Ask every window to close, then wait for them to go
function closeApps() {
  stopTimer()
  setPhase("closing")
  setError("")
  const hypr = AstalHyprland.get_default()
  for (const c of hypr.get_clients()) hyprDispatch(`hl.dsp.window.close({ window = "address:0x${c.address}" })`)
  let waited = 0
  timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
    const left = hypr.get_clients()
    if (left.length === 0) {
      timer = 0
      finish()
      return GLib.SOURCE_REMOVE
    }
    waited += 0.25
    if (waited >= CLOSE_WAIT) {
      timer = 0
      setStillOpen(left.map(describe))
      setPhase("blocked")
      return GLib.SOURCE_REMOVE
    }
    return GLib.SOURCE_CONTINUE
  })
}

export function endSession(k: EndKind) {
  closeMenus()
  stopTimer()
  setKind(k)
  setPhase("confirm")
  setError("")
  setSeconds(COUNTDOWN)
  setVisible(true)
  timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
    const left = seconds.get() - 1
    setSeconds(left)
    if (left > 0) return GLib.SOURCE_CONTINUE
    timer = 0
    closeApps()
    return GLib.SOURCE_REMOVE
  })
}

function body(k: EndKind, p: Phase, s: number, err: string, open: OpenWindow[], update: Pending) {
  // A staged OS update is finished by any restart or power off
  if (p === "confirm")
    return KINDS[k].body(s) + (update && k !== "logout" ? `\nThe update to cobalt ${update.version} will be installed.` : "")
  if (p === "closing") return "Closing apps…"
  if (err) return err
  return open.length === 1
    ? "An app is still open. Save your work in it and try again, or continue anyway."
    : "Some apps are still open. Save your work in them and try again, or continue anyway."
}

export default function EndSession() {
  const bodyText = createComputed(() => body(kind(), phase(), seconds(), error(), stillOpen(), pending()))
  const actionText = createComputed(() => KINDS[kind()].action + (phase() === "blocked" ? " Anyway" : ""))
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  return (
    <window
      name="end-session"
      namespace="cobalt-end-session"
      class="end-session-window"
      application={app}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      $={(self) => {
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            cancel()
            return true
          }
          return false
        })
        self.add_controller(keys)
      }}
      visible={visible}
    >
      <box class="end-session-backdrop" hexpand vexpand>
        <box
          class="end-session"
          orientation={Gtk.Orientation.VERTICAL}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          hexpand
          vexpand
        >
          <box class="end-session-content" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
            <label class="end-session-title" label={kind((k) => KINDS[k].title)} />
            <label
              class="end-session-body"
              wrap
              justify={Gtk.Justification.CENTER}
              maxWidthChars={40}
              label={bodyText}
            />
            <box
              class="end-session-apps"
              orientation={Gtk.Orientation.VERTICAL}
              spacing={6}
              visible={phase((p) => p === "blocked")}
            >
              <For each={stillOpen}>
                {(w: OpenWindow) => (
                  <box class="end-session-app" spacing={12}>
                    <image gicon={w.icon} pixelSize={32} />
                    <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER}>
                      <label class="app-name" label={w.app} xalign={0} ellipsize={3} maxWidthChars={34} />
                      <label class="window-title" label={w.title} xalign={0} ellipsize={3} maxWidthChars={34} />
                    </box>
                  </box>
                )}
              </For>
            </box>
          </box>
          <box class="end-session-buttons" spacing={12} homogeneous>
            <button onClicked={cancel} sensitive={phase((p) => p !== "closing")}>
              <label label="Cancel" />
            </button>
            <button
              class="destructive"
              sensitive={phase((p) => p !== "closing")}
              onClicked={() => (phase.get() === "confirm" ? closeApps() : finish())}
              $={(self) => {
                // The default action, like GNOME (Enter confirms)
                visible.subscribe(() => visible.get() && self.grab_focus())
              }}
            >
              <label label={actionText} />
            </button>
          </box>
        </box>
      </box>
    </window>
  )
}
