import AstalNotifd from "gi://AstalNotifd"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango"

function relativeTime(unix: number) {
  const then = GLib.DateTime.new_from_unix_local(unix)
  const minutes = Math.floor(
    GLib.DateTime.new_now_local().difference(then) / 60_000_000,
  )
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min ago`
  return then.format("%H:%M")!
}

function appIcon(n: AstalNotifd.Notification) {
  if (n.appIcon) return n.appIcon
  if (n.desktopEntry) return n.desktopEntry
  return "dialog-information-symbolic"
}

// One notification card, used by both the banners and the date menu list
export default function Notification({
  notification: n,
  onClose,
}: {
  notification: AstalNotifd.Notification
  onClose?: () => void
}) {
  const urgent = n.urgency === AstalNotifd.Urgency.CRITICAL

  return (
    <box
      class={urgent ? "notification critical" : "notification"}
      orientation={Gtk.Orientation.VERTICAL}
      widthRequest={360}
    >
      <box class="header" spacing={6}>
        <image class="app-icon" iconName={appIcon(n)} pixelSize={16} />
        <label class="app-name" label={n.appName || "Notification"} xalign={0} />
        <label class="time" hexpand xalign={1} label={relativeTime(n.time)} />
        <button
          class="close"
          valign={Gtk.Align.CENTER}
          onClicked={() => (onClose ? onClose() : n.dismiss())}
        >
          <image iconName="window-close-symbolic" />
        </button>
      </box>
      <box class="content" spacing={10}>
        {n.image && GLib.file_test(n.image, GLib.FileTest.EXISTS) && (
          <image class="picture" file={n.image} pixelSize={48} valign={Gtk.Align.START} />
        )}
        <box orientation={Gtk.Orientation.VERTICAL} hexpand>
          <label
            class="summary"
            label={n.summary}
            xalign={0}
            ellipsize={Pango.EllipsizeMode.END}
          />
          {n.body && (
            <label
              class="body"
              label={n.body}
              useMarkup
              wrap
              wrapMode={Pango.WrapMode.WORD_CHAR}
              lines={3}
              ellipsize={Pango.EllipsizeMode.END}
              xalign={0}
              maxWidthChars={40}
            />
          )}
        </box>
      </box>
      {n.actions.length > 0 && (
        <box class="actions" spacing={6} homogeneous>
          {n.actions.map(({ label, id }) => (
            <button onClicked={() => n.invoke(id)}>
              <label label={label} />
            </button>
          ))}
        </box>
      )}
    </box>
  )
}
