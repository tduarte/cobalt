import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { closeMenus } from "../lib/menus"

// GNOME Shell's modal password dialog, shared by the polkit agent
// ("Authentication Required") and the NetworkManager secret agent ("Wi-Fi
// Network Authentication Required"). One prompt shows at a time; others wait
// in a queue. The caller drives it: `busy()` while checking, `fail()` to
// show an error and ask again, `close()` when done.

export type Field = { key: string; label: string; secret?: boolean; value?: string }

export type PromptSpec = {
  title: string
  body: string
  // The account being authenticated (polkit): name and avatar file
  user?: { name: string; avatar?: string }
  fields: Field[]
  action: string
  onSubmit: (values: Record<string, string>) => void
  onCancel: () => void
}

export type PromptHandle = {
  busy: () => void
  fail: (message: string) => void
  setField: (key: string, label: string) => void
  close: () => void
}

type Active = { spec: PromptSpec; handle: PromptHandle }

const queue: Active[] = []
let current: Active | null = null

// Widgets of the dialog, collected by PromptDialog(); prompt() fills them in
type Refs = {
  window: Astal.Window
  title: Gtk.Label
  body: Gtk.Label
  userBox: Gtk.Box
  avatar: Gtk.Image
  userName: Gtk.Label
  fields: Gtk.Box
  error: Gtk.Label
  ok: Gtk.Button
  okLabel: Gtk.Label
  spinner: Gtk.Spinner
}
const r = {} as Refs
let refs: Refs | null = null

let entries: Map<string, Gtk.Editable> = new Map()

function values() {
  return Object.fromEntries([...entries].map(([k, e]) => [k, e.text]))
}

function setBusy(on: boolean) {
  if (!refs) return
  refs.ok.sensitive = !on
  refs.spinner.visible = on
  refs.spinner.spinning = on
  for (const e of entries.values()) (e as unknown as Gtk.Widget).sensitive = !on
}

function submit() {
  if (!current || !refs?.ok.sensitive) return
  current.spec.onSubmit(values())
}

function cancel() {
  if (!current) return
  const c = current
  finish(c)
  c.spec.onCancel()
}

function finish(a: Active) {
  if (current !== a) {
    const i = queue.indexOf(a)
    if (i >= 0) queue.splice(i, 1)
    return
  }
  current = null
  entries = new Map()
  const next = queue.shift()
  if (next) show(next)
  else refs?.window.set_visible(false)
}

function buildFields(spec: PromptSpec) {
  if (!refs) return
  let child = refs.fields.get_first_child()
  while (child) {
    const next = child.get_next_sibling()
    refs.fields.remove(child)
    child = next
  }
  entries = new Map()
  for (const f of spec.fields) {
    const entry = f.secret
      ? new Gtk.PasswordEntry({ showPeekIcon: true, placeholderText: f.label, hexpand: true })
      : new Gtk.Entry({ placeholderText: f.label, hexpand: true, text: f.value ?? "" })
    if (f.secret && f.value) entry.text = f.value
    entry.add_css_class("prompt-entry")
    entry.connect("activate", submit)
    refs.fields.append(entry)
    entries.set(f.key, entry as unknown as Gtk.Editable)
  }
}

function show(a: Active) {
  if (!refs) return
  current = a
  const { spec } = a
  refs.title.label = spec.title
  refs.body.label = spec.body
  refs.body.visible = spec.body !== ""
  refs.userBox.visible = !!spec.user
  if (spec.user) {
    refs.userName.label = spec.user.name
    if (spec.user.avatar && GLib.file_test(spec.user.avatar, GLib.FileTest.EXISTS)) refs.avatar.file = spec.user.avatar
    else refs.avatar.iconName = "avatar-default-symbolic"
  }
  refs.okLabel.label = spec.action
  refs.error.visible = false
  buildFields(spec)
  setBusy(false)
  closeMenus()
  refs.window.set_visible(true)
  // Focus the first empty field
  const first = [...entries.values()].find((e) => e.text === "") ?? [...entries.values()][0]
  ;(first as unknown as Gtk.Widget | undefined)?.grab_focus()
}

export function prompt(spec: PromptSpec): PromptHandle {
  const active = {} as Active
  const handle: PromptHandle = {
    busy: () => current === active && setBusy(true),
    fail: (message) => {
      if (current !== active || !refs) return
      setBusy(false)
      refs.error.label = message
      refs.error.visible = true
      // Clear the secrets and try again, like GNOME
      for (const [key, e] of entries) if (spec.fields.find((f) => f.key === key)?.secret) e.text = ""
      ;([...entries.values()][0] as unknown as Gtk.Widget | undefined)?.grab_focus()
    },
    setField: (key, label) => {
      const e = entries.get(key)
      if (e && current === active) (e as unknown as Gtk.Entry).placeholderText = label
    },
    close: () => finish(active),
  }
  active.spec = spec
  active.handle = handle
  if (current) queue.push(active)
  else show(active)
  return handle
}

export default function PromptDialog() {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  refs = r
  return (
    <window
      name="prompt-dialog"
      namespace="cobalt-prompt-dialog"
      class="end-session-window"
      application={app}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      $={(self) => {
        r.window = self
        const keys = new Gtk.EventControllerKey({ propagationPhase: Gtk.PropagationPhase.CAPTURE })
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval !== Gdk.KEY_Escape) return false
          cancel()
          return true
        })
        self.add_controller(keys)
      }}
      visible={false}
    >
      <box class="end-session-backdrop" hexpand vexpand>
        <box
          class="end-session prompt-dialog"
          orientation={Gtk.Orientation.VERTICAL}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          hexpand
          vexpand
        >
          <box class="end-session-content" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
            <label class="end-session-title" $={(w) => (r.title = w)} />
            <label
              class="end-session-body"
              wrap
              justify={Gtk.Justification.CENTER}
              maxWidthChars={44}
              $={(w) => (r.body = w)}
            />
            <box class="prompt-user" spacing={12} halign={Gtk.Align.CENTER} $={(w) => (r.userBox = w)}>
              <image class="prompt-avatar" pixelSize={48} $={(w) => (r.avatar = w)} />
              <label class="prompt-user-name" $={(w) => (r.userName = w)} />
            </box>
            <box orientation={Gtk.Orientation.VERTICAL} spacing={8} $={(w) => (r.fields = w)} />
            <box spacing={8} halign={Gtk.Align.CENTER}>
              <Gtk.Spinner visible={false} $={(w: Gtk.Spinner) => (r.spinner = w)} />
              <label class="prompt-error" wrap maxWidthChars={44} visible={false} $={(w) => (r.error = w)} />
            </box>
          </box>
          <box class="end-session-buttons" spacing={12} homogeneous>
            <button onClicked={cancel}>
              <label label="Cancel" />
            </button>
            <button class="suggested" onClicked={submit} $={(w) => (r.ok = w)}>
              <label $={(w) => (r.okLabel = w)} />
            </button>
          </box>
        </box>
      </box>
    </window>
  )
}
