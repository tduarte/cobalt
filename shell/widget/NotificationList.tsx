import app from "ags/gtk4/app"
import AstalNotifd from "gi://AstalNotifd"
import Gtk from "gi://Gtk?version=4.0"
import { For, createBinding, createComputed, createState } from "ags"
import Notification from "./Notification"

// The date menu's notification list, GNOME 48 style: notifications from the
// same app stack into one group (the newest card, slivers of the others and
// "Show N more"); an expanded group lists them all with "Show less" and a
// clear button. The list scrolls once it's taller than the space the menu
// has, so any number of notifications fits.

type Group = { key: string; appName: string; items: AstalNotifd.Notification[] }

// QA hook (app.tsx: `notifications expand <app> | collapse`): expand a
// group by app name or desktop entry
let expandHook: ((key: string | null) => void) | null = null
export function expandNotifications(app: string | null) {
  expandHook?.(app)
}

function groupKey(n: AstalNotifd.Notification) {
  return n.desktopEntry || n.appName || "notification"
}

function groups(ns: AstalNotifd.Notification[]): Group[] {
  const byKey = new Map<string, Group>()
  // Newest first; ids only grow, so they break ties within the same second
  for (const n of [...ns].sort((a, b) => b.time - a.time || b.id - a.id)) {
    const key = groupKey(n)
    let g = byKey.get(key)
    if (!g) {
      g = { key, appName: n.appName || "Notifications", items: [] }
      byKey.set(key, g)
    }
    g.items.push(n)
  }
  // Groups ordered by their newest notification (Map keeps insertion order)
  return [...byKey.values()]
}

// Room for the list: the screen minus the bar, menu padding, the media
// players and the Clear button
function maxListHeight() {
  const monitor = app.get_monitors()[0]
  const height = monitor ? monitor.geometry.height : 800
  return Math.max(260, height - 32 - 260)
}

function CollapsedStack({ group, onExpand }: { group: Group; onExpand: () => void }) {
  const more = group.items.length - 1
  return (
    <box class="notification-stack" orientation={Gtk.Orientation.VERTICAL}>
      <Notification notification={group.items[0]} />
      {/* Slivers of the cards behind, like a deck */}
      <box class="stack-edge first" />
      {more > 1 && <box class="stack-edge second" />}
      <button class="stack-more" halign={Gtk.Align.CENTER} onClicked={onExpand}>
        <box spacing={4}>
          <label label={`Show ${more} more`} />
          <image iconName="pan-down-symbolic" />
        </box>
      </button>
    </box>
  )
}

function ExpandedGroup({ group, onCollapse }: { group: Group; onCollapse: () => void }) {
  return (
    <box class="notification-group" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box class="group-header" spacing={6}>
        <label class="group-title" label={`${group.appName} · ${group.items.length}`} xalign={0} hexpand />
        <button class="stack-more" onClicked={onCollapse}>
          <box spacing={4}>
            <label label="Show less" />
            <image iconName="pan-up-symbolic" />
          </box>
        </button>
        <button
          class="close"
          valign={Gtk.Align.CENTER}
          tooltipText={`Clear ${group.appName}`}
          onClicked={() => group.items.forEach((n) => n.dismiss())}
        >
          <image iconName="window-close-symbolic" />
        </button>
      </box>
      {group.items.map((n) => (
        <Notification notification={n} />
      ))}
    </box>
  )
}

export default function NotificationList() {
  const notifd = AstalNotifd.get_default()
  const notifications = createBinding(notifd, "notifications")
  const [expanded, setExpanded] = createState(new Set<string>())
  const toggle = (key: string, open: boolean) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })

  expandHook = (name) => {
    if (!name) return setExpanded(new Set())
    const g = groups(notifd.notifications).find((x) => x.key === name || x.appName === name)
    if (g) toggle(g.key, true)
  }

  // Re-render when notifications or the expanded set change
  const items = createComputed(() => {
    const open = expanded()
    return groups(notifications()).map((g) => ({ group: g, open: open.has(g.key) }))
  })

  return (
    <Gtk.ScrolledWindow
      class="notification-scroller"
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      propagateNaturalHeight
      maxContentHeight={maxListHeight()}
      visible={notifications((ns) => ns.length > 0)}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <For each={items}>
          {({ group, open }: { group: Group; open: boolean }) =>
            group.items.length === 1 ? (
              <Notification notification={group.items[0]} />
            ) : open ? (
              <ExpandedGroup group={group} onCollapse={() => toggle(group.key, false)} />
            ) : (
              <CollapsedStack group={group} onExpand={() => toggle(group.key, true)} />
            )
          }
        </For>
      </box>
    </Gtk.ScrolledWindow>
  )
}
