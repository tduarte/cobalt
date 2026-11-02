import AstalBluetooth from "gi://AstalBluetooth"
import AstalNetwork from "gi://AstalNetwork"
import AstalWp from "gi://AstalWp"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import Gtk from "gi://Gtk?version=4.0"
import NM from "gi://NM"
import { For, createBinding, createState } from "ags"
import { execAsync } from "ags/process"
import { nightLightActive, toggleNightLight } from "../../lib/nightlight"
import { sh, userUnit } from "../../lib/system"
import { MenuItem, MenuPanel, OpenMenu, Toggle, ToggleSpec } from "./parts"

// ---- VPN (NetworkManager VPN and WireGuard connections) ----

const isVpn = (type: string | null) => type === "vpn" || type === "wireguard"

export function vpnSpec(open: OpenMenu): ToggleSpec | null {
  const client: NM.Client = AstalNetwork.get_default().client
  if (!client) return null

  const vpns = () => client.get_connections().filter((c) => isVpn(c.get_connection_type()))
  const activeVpns = () =>
    client.get_active_connections().filter((ac) => isVpn(ac.get_connection_type()))
  if (vpns().length === 0) return null

  const [connections, setConnections] = createState(vpns())
  const [active, setActive] = createState(activeVpns())
  client.connect("connection-added", () => setConnections(vpns()))
  client.connect("connection-removed", () => setConnections(vpns()))
  client.connect("notify::active-connections", () => setActive(activeVpns()))

  const activate = (conn: NM.RemoteConnection) =>
    client.activate_connection_async(conn, null, null, null, (_, res) => {
      try {
        client.activate_connection_finish(res)
      } catch (err) {
        console.error(err)
      }
    })
  const deactivate = (ac: NM.ActiveConnection) =>
    client.deactivate_connection_async(ac, null, (_, res) => {
      try {
        client.deactivate_connection_finish(res)
      } catch (err) {
        console.error(err)
      }
    })
  const toggleConnection = (conn: NM.RemoteConnection) => {
    const ac = active.get().find((a) => a.get_uuid() === conn.get_uuid())
    if (ac) deactivate(ac)
    else activate(conn)
  }

  return {
    toggle: () => (
      <Toggle
        icon="network-vpn-symbolic"
        label="VPN"
        subtitle={active((acs) => acs[0]?.get_id() ?? connections.get()[0]?.get_id() ?? "")}
        active={active((acs) => acs.length > 0)}
        onToggled={() => {
          const acs = active.get()
          if (acs.length > 0) acs.forEach(deactivate)
          else activate(connections.get()[0])
        }}
        menu="vpn"
        open={open}
      />
    ),
    menu: {
      id: "vpn",
      panel: () => (
        <MenuPanel icon="network-vpn-symbolic" title="VPN" active={active((acs) => acs.length > 0)}>
          <For each={connections}>
            {(conn: NM.RemoteConnection) => (
              <MenuItem
                label={conn.get_id()}
                checked={active((acs) => acs.some((a) => a.get_uuid() === conn.get_uuid()))}
                onClicked={() => toggleConnection(conn)}
              />
            )}
          </For>
        </MenuPanel>
      ),
    },
  }
}

// ---- Night Light (schedule and override in lib/nightlight.ts) ----

export function nightLightSpec(): ToggleSpec | null {
  if (!GLib.find_program_in_path("hyprsunset")) return null
  return {
    toggle: () => (
      <Toggle icon="night-light-symbolic" label="Night Light" active={nightLightActive} onToggled={toggleNightLight} />
    ),
  }
}

// A toggle backed by a systemd user unit: the state lives in systemd, so it
// survives shell restarts
function unitToggle(icon: string, label: string, unit: string, start: () => Promise<unknown>): ToggleSpec {
  const [on, setOn] = createState(false)
  const refresh = () => userUnit.isActive(unit).then(setOn)
  refresh()
  return {
    toggle: () => (
      <Toggle
        icon={icon}
        label={label}
        active={on}
        onToggled={() => {
          const action = on.get() ? userUnit.stop(unit) : start()
          action.catch(console.error).finally(refresh)
        }}
      />
    ),
  }
}

// ---- Caffeine: keep the screen awake (hypridle honors systemd inhibitors) ----

export function caffeineSpec(): ToggleSpec {
  const unit = "cobalt-caffeine.service"
  return unitToggle("cobalt-caffeine-symbolic", "Caffeine", unit, () =>
    execAsync([
      "systemd-run", "--user", `--unit=${unit}`, "--collect", "--quiet",
      "systemd-inhibit", "--what=idle", "--who=Cobalt", "--why=Caffeine", "sleep", "infinity",
    ]),
  )
}

// ---- Airplane Mode: all radios off (Wi-Fi/WWAN through NetworkManager, Bluetooth) ----

export function airplaneSpec(): ToggleSpec | null {
  const network = AstalNetwork.get_default()
  const bt = AstalBluetooth.get_default()
  if (!network.wifi && !bt.adapter) return null

  const radiosOff = () => !network.client.wireless_enabled && (!bt.adapter || !bt.isPowered)
  const [on, setOn] = createState(radiosOff())
  network.client.connect("notify::wireless-enabled", () => setOn(radiosOff()))
  if (bt.adapter) bt.connect("notify::is-powered", () => setOn(radiosOff()))

  return {
    toggle: () => (
      <Toggle
        icon="airplane-mode-symbolic"
        label="Airplane Mode"
        active={on}
        onToggled={() => {
          const enable = on.get()
          sh(`nmcli radio all ${enable ? "on" : "off"}`)
          if (bt.adapter && bt.isPowered === !enable) bt.toggle()
        }}
      />
    ),
  }
}

// ---- Brightness: laptop backlight (brightnessctl) or external monitor (DDC/CI) ----

function hasBacklight() {
  const dir = Gio.File.new_for_path("/sys/class/backlight")
  try {
    const it = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
    return it.next_file(null) !== null
  } catch {
    return false
  }
}

export function BrightnessSlider() {
  const [value, setValue] = createState(0.5)
  const [available, setAvailable] = createState(false)
  let setter: (v: number) => void = () => {}
  let pending: number | null = null

  const has = (program: string) => GLib.find_program_in_path(program) !== null

  if (hasBacklight() && has("brightnessctl")) {
    execAsync(["brightnessctl", "-m"]).then((out) => {
      // name,class,current,percent%,max
      const percent = Number(out.split(",")[3]?.replace("%", ""))
      if (!Number.isNaN(percent)) setValue(percent / 100)
      setAvailable(true)
    })
    setter = (v) => sh(`brightnessctl -q set ${Math.round(v * 100)}%`)
  } else if (has("ddcutil")) {
    // DDC/CI is slow (~100 ms per call), so read once and debounce writes
    execAsync(["ddcutil", "getvcp", "10", "--brief"])
      .then((out) => {
        const [, , , cur, max] = out.trim().split(/\s+/)
        if (cur && max) {
          setValue(Number(cur) / Number(max))
          setAvailable(true)
        }
      })
      .catch(() => {})
    setter = (v) => {
      if (pending !== null) GLib.source_remove(pending)
      pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        pending = null
        sh(`ddcutil setvcp 10 ${Math.round(v * 100)} --noverify`)
        return GLib.SOURCE_REMOVE
      })
    }
  }

  return (
    <box class="qs-slider" spacing={6} visible={available}>
      <image class="slider-icon" iconName="display-brightness-symbolic" />
      <slider
        hexpand
        value={value}
        onChangeValue={({ value }) => {
          setValue(value)
          setter(value)
        }}
      />
    </box>
  )
}

// ---- Privacy: orange microphone in the bar while an app records ----

export function MicIndicator() {
  const wp = AstalWp.get_default()
  if (!wp) return <box />
  const recorders = createBinding(wp.audio, "recorders")
  return (
    <image
      class="privacy-indicator"
      iconName="audio-input-microphone-symbolic"
      tooltipText="Microphone in use"
      visible={recorders((r) => r.length > 0)}
    />
  )
}
