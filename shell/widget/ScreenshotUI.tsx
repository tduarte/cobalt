import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { createComputed, createState } from "ags"
import { execAsync } from "ags/process"
import { closeMenus } from "../lib/menus"

// GNOME's screenshot UI (Print): a panel at the bottom of the screen to pick
// Selection / Screen / Window, screenshot or screencast, and whether to show
// the pointer. Capturing hides the panel and hands over to cobalt-screenshot
// or cobalt-screenrecord (slurp does the selecting). While a screencast runs,
// the bar shows a red stop button with the elapsed time (RecordingIndicator).

type Mode = "area" | "screen" | "window"

const MODES: [Mode, string, string][] = [
  ["area", "Selection", "screenshot-ui-area-symbolic"],
  ["screen", "Screen", "screenshot-ui-display-symbolic"],
  ["window", "Window", "screenshot-ui-window-symbolic"],
]

// GNOME's own icons live in the shell's resources; fall back to Adwaita's
const FALLBACK_ICONS: Record<string, string> = {
  "screenshot-ui-area-symbolic": "cobalt-screenshot-area-symbolic",
  "screenshot-ui-display-symbolic": "video-single-display-symbolic",
  "screenshot-ui-window-symbolic": "focus-windows-symbolic",
}

function icon(name: string) {
  const theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default()!)
  return theme.has_icon(name) ? name : FALLBACK_ICONS[name] ?? name
}

const [visible, setVisible] = createState(false)
const [mode, setMode] = createState<Mode>("area")
const [video, setVideo] = createState(false)
const [pointer, setPointer] = createState(false)

const [recording, setRecording] = createState(false)
const [started, setStarted] = createState(0)
const [now, setNow] = createState(0)
let tick = 0

export function setRecordingState(on: boolean) {
  setRecording(on)
  if (tick) GLib.source_remove(tick)
  tick = 0
  if (!on) return
  setStarted(GLib.get_monotonic_time())
  setNow(GLib.get_monotonic_time())
  tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
    setNow(GLib.get_monotonic_time())
    return GLib.SOURCE_CONTINUE
  })
}

// A recording may already be running when the shell (re)starts
export function syncRecording() {
  // Spawning a missing program throws synchronously (AGENTS.md)
  if (!GLib.find_program_in_path("cobalt-screenrecord")) return
  execAsync(["cobalt-screenrecord", "status"])
    .then((out) => setRecordingState(out.trim() === "recording"))
    .catch(() => {})
}

export function stopRecording() {
  if (!GLib.find_program_in_path("cobalt-screenrecord")) return
  execAsync(["cobalt-screenrecord", "stop"]).catch(console.error)
}

export function toggleScreenshotUI() {
  if (visible.get()) return setVisible(false)
  if (recording.get()) return stopRecording()
  closeMenus()
  setVisible(true)
}

let pendingCapture: string[] | null = null

function capture() {
  const cursor = pointer.get() ? ["--cursor"] : []
  pendingCapture = video.get()
    ? ["cobalt-screenrecord", "start", mode.get(), ...cursor]
    : ["cobalt-screenshot", mode.get(), ...cursor]
  setVisible(false)
}

function ModeButton({ m, label, iconName }: { m: Mode; label: string; iconName: string }) {
  return (
    <button
      class={mode((x) => (x === m ? "screenshot-mode selected" : "screenshot-mode"))}
      onClicked={() => setMode(m)}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        <image iconName={icon(iconName)} pixelSize={24} />
        <label label={label} />
      </box>
    </button>
  )
}

export default function ScreenshotUI() {
  const { BOTTOM } = Astal.WindowAnchor
  return (
    <window
      name="screenshot-ui"
      namespace="cobalt-screenshot-ui"
      class="screenshot-ui-window"
      application={app}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      anchor={BOTTOM}
      $={(self) => {
        // Capture phase: otherwise Enter activates the focused button (Close)
        const keys = new Gtk.EventControllerKey({ propagationPhase: Gtk.PropagationPhase.CAPTURE })
        keys.connect("key-pressed", (_, keyval) => {
          // GNOME's keys: Esc closes, Enter/Space captures, S/C/W pick the
          // mode, V toggles screencast, P the pointer
          if (keyval === Gdk.KEY_Escape) setVisible(false)
          else if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_space || keyval === Gdk.KEY_KP_Enter) capture()
          else if (keyval === Gdk.KEY_s) setMode("area")
          else if (keyval === Gdk.KEY_c) setMode("screen")
          else if (keyval === Gdk.KEY_w) setMode("window")
          else if (keyval === Gdk.KEY_v) setVideo((v) => !v)
          else if (keyval === Gdk.KEY_p) setPointer((p) => !p)
          else return false
          return true
        })
        self.add_controller(keys)
        // Capture once the panel is off screen, so it isn't in the picture
        self.connect("unmap", () => {
          const argv = pendingCapture
          pendingCapture = null
          if (argv)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
              execAsync(argv).catch((err) => console.error(argv[0], err))
              return GLib.SOURCE_REMOVE
            })
        })
      }}
      visible={visible}
    >
      <box class="screenshot-ui" orientation={Gtk.Orientation.VERTICAL} spacing={16}>
        <box>
          <box hexpand />
          <button class="screenshot-close" valign={Gtk.Align.CENTER} onClicked={() => setVisible(false)}>
            <image iconName="window-close-symbolic" />
          </button>
        </box>
        <box class="screenshot-modes" spacing={8} homogeneous halign={Gtk.Align.CENTER}>
          {MODES.map(([m, label, iconName]) => (
            <ModeButton m={m} label={label} iconName={iconName} />
          ))}
        </box>
        <centerbox>
          <button
            $type="start"
            class={pointer((p) => (p ? "screenshot-toggle checked" : "screenshot-toggle"))}
            tooltipText="Show Pointer"
            valign={Gtk.Align.CENTER}
            onClicked={() => setPointer((p) => !p)}
          >
            <image iconName="input-mouse-symbolic" />
          </button>
          <button
            $type="center"
            class={video((v) => (v ? "screenshot-capture video" : "screenshot-capture"))}
            tooltipText={video((v) => (v ? "Record Screencast" : "Take Screenshot"))}
            onClicked={capture}
          >
            <box class="inner" />
          </button>
          <box $type="end" class="screenshot-type" valign={Gtk.Align.CENTER}>
            <button
              class={video((v) => (v ? "" : "checked"))}
              tooltipText="Screenshot"
              onClicked={() => setVideo(false)}
            >
              <image iconName="camera-photo-symbolic" />
            </button>
            <button
              class={video((v) => (v ? "checked" : ""))}
              tooltipText="Screencast"
              onClicked={() => setVideo(true)}
            >
              <image iconName="camera-video-symbolic" />
            </button>
          </box>
        </centerbox>
      </box>
    </window>
  )
}

// GNOME's red screencast indicator in the bar: elapsed time, click to stop
export function RecordingIndicator() {
  const elapsed = createComputed(() => {
    const s = Math.max(0, Math.floor((now() - started()) / 1_000_000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  })
  return (
    <button class="recording-indicator" visible={recording} tooltipText="Stop Recording" onClicked={stopRecording}>
      <box spacing={6}>
        <image iconName="media-playback-stop-symbolic" />
        <label label={elapsed} />
      </box>
    </button>
  )
}
