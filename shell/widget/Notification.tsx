import AstalNotifd from "gi://AstalNotifd"
import GLib from "gi://GLib"
import Gdk from "gi://Gdk?version=4.0"
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
  // The "default" action is clicking the notification itself, like GNOME;
  // the others are buttons
  const hasDefault = n.actions.some((a) => a.id === "default")
  const buttons = n.actions.filter((a) => a.id !== "default")

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
      <box
        class="content"
        spacing={10}
        cursor={hasDefault ? Gdk.Cursor.new_from_name("pointer", null) : null}
        $={(self) => {
          if (!hasDefault) return
          const click = new Gtk.GestureClick()
          click.connect("released", () => {
            n.invoke("default")
            n.dismiss()
          })
          self.add_controller(click)
        }}
      >
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
      {buttons.length > 0 && (
        <box class="actions" spacing={6} homogeneous>
          {buttons.map(({ label, id }) => (
            <button onClicked={() => n.invoke(id)}>
              <label label={label} />
            </button>
          ))}
        </box>
      )}
    </box>
  )
}
