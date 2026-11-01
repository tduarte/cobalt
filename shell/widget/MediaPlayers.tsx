import AstalApps from "gi://AstalApps"
import AstalMpris from "gi://AstalMpris"
import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango"
import { For, createBinding } from "ags"

const apps = new AstalApps.Apps()

function appFor(player: AstalMpris.Player) {
  return apps.exact_query(player.entry)[0] ?? null
}

// One GNOME-style media card: app header, cover art, title/artist, controls
function PlayerCard({ player }: { player: AstalMpris.Player }) {
  const app = appFor(player)
  const playing = createBinding(player, "playbackStatus")((s) => s === AstalMpris.PlaybackStatus.PLAYING)
  const cover = createBinding(player, "coverArt")

  return (
    <box class="media-card" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box class="header" spacing={6}>
        <image iconName={app?.iconName ?? "audio-x-generic-symbolic"} pixelSize={16} />
        <label class="app-name" label={app?.name ?? player.identity ?? "Media"} xalign={0} />
      </box>
      <box spacing={12}>
        <box class="cover" overflow={Gtk.Overflow.HIDDEN} valign={Gtk.Align.CENTER}>
          <image
            file={cover((c) => c ?? "")}
            pixelSize={60}
            visible={cover((c) => !!c)}
          />
          <image
            class="cover-placeholder"
            iconName="folder-music-symbolic"
            pixelSize={36}
            visible={cover((c) => !c)}
            hexpand
            halign={Gtk.Align.CENTER}
          />
        </box>
        <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER} hexpand>
          <label
            class="title"
            label={createBinding(player, "title")((t) => t || "Unknown")}
            xalign={0}
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={20}
          />
          <label
            class="artist"
            label={createBinding(player, "artist")((a) => a || "")}
            xalign={0}
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={20}
            visible={createBinding(player, "artist")((a) => !!a)}
          />
        </box>
        <box class="controls" valign={Gtk.Align.CENTER} spacing={4}>
          <button
            sensitive={createBinding(player, "canGoPrevious")}
            onClicked={() => player.previous()}
          >
            <image iconName="media-skip-backward-symbolic" />
          </button>
          <button sensitive={createBinding(player, "canControl")} onClicked={() => player.play_pause()}>
            <image
              iconName={playing((p) => (p ? "media-playback-pause-symbolic" : "media-playback-start-symbolic"))}
            />
          </button>
          <button sensitive={createBinding(player, "canGoNext")} onClicked={() => player.next()}>
            <image iconName="media-skip-forward-symbolic" />
          </button>
        </box>
      </box>
    </box>
  )
}

// All MPRIS players (browsers, Spotify, mpv...), at the top of the date menu
export default function MediaPlayers() {
  const players = createBinding(AstalMpris.get_default(), "players")
  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={10} visible={players((ps) => ps.length > 0)}>
      <For each={players}>{(p: AstalMpris.Player) => <PlayerCard player={p} />}</For>
    </box>
  )
}
