import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango"
import { Accessor, Setter } from "ags"

// Which inline menu is open (GNOME shows one at a time, below its row)
export type OpenMenu = { get: Accessor<string | null>; set: Setter<string | null> }

// GNOME quick settings toggle. With `menu`, it splits into the toggle and an
// arrow that opens the inline menu with that id.
export function Toggle({
  icon,
  label,
  subtitle,
  active,
  onToggled,
  menu,
  open,
}: {
  icon: string | Accessor<string>
  label: string
  subtitle?: string | Accessor<string>
  active: Accessor<boolean>
  onToggled: () => void
  menu?: string
  open?: OpenMenu
}) {
  const main = (
    <button
      class={menu ? "qs-toggle-main" : "qs-toggle-main solo"}
      hexpand
      onClicked={onToggled}
    >
      <box spacing={10}>
        <image iconName={icon} />
        <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER}>
          <label class="title" label={label} xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={12} />
          {subtitle && (
            <label class="subtitle" label={subtitle} xalign={0} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={14} />
          )}
        </box>
      </box>
    </button>
  )

  return (
    <box class={active((on) => (on ? "qs-toggle active" : "qs-toggle"))} hexpand>
      {main}
      {menu && open && (
        <button
          class="qs-toggle-arrow"
          onClicked={() => open.set(open.get.get() === menu ? null : menu)}
        >
          <image iconName={open.get((m) => (m === menu ? "go-down-symbolic" : "go-next-symbolic"))} />
        </button>
      )}
    </box>
  )
}

// The inline panel: round icon, title, items, optional footer
// `active` colors the round header icon with the accent, like GNOME does when
// the feature is on (Wi-Fi, Bluetooth...); otherwise it stays gray.
export function MenuPanel({
  icon,
  title,
  active,
  children,
}: {
  icon: string | Accessor<string>
  title: string
  active?: Accessor<boolean>
  children?: JSX.Element | Array<JSX.Element>
}) {
  return (
    <box class="qs-menu" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
      <box class="qs-menu-header" spacing={12}>
        {/* The image is the circle (CSS min size): GTK centers the icon in it */}
        <image
          class={active ? active((on) => (on ? "qs-menu-icon active" : "qs-menu-icon")) : "qs-menu-icon"}
          iconName={icon}
          valign={Gtk.Align.CENTER}
        />
        <label class="qs-menu-title" label={title} xalign={0} halign={Gtk.Align.START} hexpand />
      </box>
      {children}
    </box>
  )
}

export function MenuItem({
  icon,
  label,
  checked,
  onClicked,
}: {
  icon?: string | Accessor<string>
  label: string | Accessor<string>
  checked?: boolean | Accessor<boolean>
  onClicked: () => void
}) {
  return (
    <button class="qs-menu-item" onClicked={onClicked}>
      <box spacing={10}>
        {icon && <image iconName={icon} />}
        <label label={label} xalign={0} hexpand ellipsize={Pango.EllipsizeMode.END} maxWidthChars={34} />
        {checked !== undefined && <image iconName="object-select-symbolic" visible={checked} />}
      </box>
    </button>
  )
}

export function MenuRevealer({ id, open, children }: { id: string; open: OpenMenu; children: JSX.Element }) {
  return (
    <revealer
      revealChild={open.get((m) => m === id)}
      transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
      transitionDuration={180}
    >
      {children}
    </revealer>
  )
}

export type ToggleSpec = {
  toggle: () => JSX.Element | null
  menu?: { id: string; panel: () => JSX.Element }
}
