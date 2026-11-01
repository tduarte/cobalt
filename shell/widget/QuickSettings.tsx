import AstalBattery from "gi://AstalBattery"
import AstalBluetooth from "gi://AstalBluetooth"
import AstalNetwork from "gi://AstalNetwork"
import AstalNotifd from "gi://AstalNotifd"
import AstalPowerProfiles from "gi://AstalPowerProfiles"
import AstalWp from "gi://AstalWp"
import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango"
import { For, With, createBinding, createState } from "ags"
import { closeMenus, openMenu, registerSubMenus, toggleMenu } from "../lib/menus"
import PanelMenu from "./PanelMenu"
import { power, sh } from "../lib/system"
import {
  BrightnessSlider,
  MicIndicator,
  airplaneSpec,
  caffeineSpec,
  nightLightSpec,
  vpnSpec,
} from "./qs/extra"
import { MenuItem, MenuPanel, MenuRevealer, OpenMenu, Toggle, ToggleSpec } from "./qs/parts"

// Fixed menu width; inline menus and long labels must fit inside it
const QS_WIDTH = 400

// ---- Sound ----

function endpointIcon(ep: AstalWp.Endpoint, kind: "speaker" | "microphone") {
  const name = `${ep.description} ${ep.name}`.toLowerCase()
  if (/headset/.test(name)) return "audio-headset-symbolic"
  if (kind === "microphone") return "audio-input-microphone-symbolic"
  if (/hdmi|displayport/.test(name)) return "video-display-symbolic"
  if (/headphone/.test(name)) return "audio-headphones-symbolic"
  return "audio-speakers-symbolic"
}

function SoundSlider({ kind, open }: { kind: "speaker" | "microphone"; open: OpenMenu }) {
  const wp = AstalWp.get_default()
  if (!wp) return <box />
  const audio = wp.audio
  const id = kind === "speaker" ? "sound-output" : "sound-input"
  const endpoint = createBinding(audio, kind === "speaker" ? "defaultSpeaker" : "defaultMicrophone")
  const endpoints = createBinding(audio, kind === "speaker" ? "speakers" : "microphones")

  return (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <With value={endpoint}>
        {(ep: AstalWp.Endpoint) =>
          ep && (
            <box class="qs-slider" spacing={6}>
              <button class="slider-icon" valign={Gtk.Align.CENTER} onClicked={() => ep.set_mute(!ep.mute)}>
                <image
                  iconName={
                    kind === "speaker"
                      ? createBinding(ep, "volumeIcon")
                      : createBinding(ep, "mute")((m) =>
                          m ? "microphone-disabled-symbolic" : "audio-input-microphone-symbolic",
                        )
                  }
                />
              </button>
              <slider
                hexpand
                value={createBinding(ep, "volume")}
                onChangeValue={({ value }) => ep.set_volume(value)}
              />
              <button
                class="slider-arrow"
                valign={Gtk.Align.CENTER}
                onClicked={() => open.set(open.get.get() === id ? null : id)}
              >
                <image iconName={open.get((m) => (m === id ? "go-down-symbolic" : "go-next-symbolic"))} />
              </button>
            </box>
          )
        }
      </With>
      <MenuRevealer id={id} open={open}>
        <MenuPanel
          icon={kind === "speaker" ? "audio-headphones-symbolic" : "audio-input-microphone-symbolic"}
          title={kind === "speaker" ? "Sound Output" : "Sound Input"}
        >
          <For each={endpoints}>
            {(ep: AstalWp.Endpoint) => (
              <MenuItem
                icon={endpointIcon(ep, kind)}
                label={createBinding(ep, "description")}
                checked={createBinding(ep, "isDefault")}
                onClicked={() => ep.set_is_default(true)}
              />
            )}
          </For>
        </MenuPanel>
      </MenuRevealer>
    </box>
  )
}

// ---- Toggles and their menus ----

function networkSpec(open: OpenMenu): ToggleSpec {
  const network = AstalNetwork.get_default()
  const wifi = network.wifi

  if (wifi) {
    const [passwordFor, setPasswordFor] = createState<AstalNetwork.AccessPoint | null>(null)
    const accessPoints = createBinding(wifi, "accessPoints")((aps) => {
      // One entry per network name, strongest first
      const best = new Map<string, AstalNetwork.AccessPoint>()
      for (const ap of aps) {
        if (!ap.ssid) continue
        const prev = best.get(ap.ssid)
        if (!prev || ap.strength > prev.strength) best.set(ap.ssid, ap)
      }
      return [...best.values()].sort((a, b) => b.strength - a.strength).slice(0, 8)
    })

    const connect = (ap: AstalNetwork.AccessPoint, password: string | null) => {
      ap.activate(password, (_, res) => {
        try {
          ap.activate_finish(res)
          setPasswordFor(null)
        } catch (err) {
          // No saved connection for a secured network: ask for the password
          if (ap.requiresPassword) setPasswordFor(ap)
          else console.error(err)
        }
      })
    }

    return {
      toggle: () => (
        <Toggle
          icon={createBinding(wifi, "iconName")}
          label="Wi-Fi"
          subtitle={createBinding(wifi, "ssid")((s) => s || "Not connected")}
          active={createBinding(wifi, "enabled")}
          onToggled={() => wifi.set_enabled(!wifi.enabled)}
          menu="wifi"
          open={open}
        />
      ),
      menu: {
        id: "wifi",
        panel: () => (
          <MenuPanel icon="network-wireless-symbolic" title="Wi-Fi" active={createBinding(wifi, "enabled")}>
            <For each={accessPoints}>
              {(ap: AstalNetwork.AccessPoint) => (
                <MenuItem
                  icon={createBinding(ap, "iconName")}
                  label={ap.ssid}
                  checked={createBinding(wifi, "activeAccessPoint")((a) => a?.ssid === ap.ssid)}
                  onClicked={() => connect(ap, null)}
                />
              )}
            </For>
            <With value={passwordFor}>
              {(ap) =>
                ap && (
                  <box class="qs-password" spacing={8}>
                    <Gtk.PasswordText
                      hexpand
                      placeholderText={`Password for ${ap.ssid}`}
                      showPeekIcon
                      onActivate={(self) => connect(ap, self.text)}
                    />
                  </box>
                )
              }
            </With>
          </MenuPanel>
        ),
      },
    }
  }

  return {
    toggle: () => (
      <Toggle
        icon={network.wired ? createBinding(network.wired, "iconName") : "network-wired-symbolic"}
        label="Wired"
        subtitle={createBinding(network, "connectivity")((c) =>
          c === AstalNetwork.Connectivity.FULL ? "Connected" : "Limited",
        )}
        active={createBinding(network, "connectivity")((c) => c === AstalNetwork.Connectivity.FULL)}
        onToggled={() => {}}
      />
    ),
  }
}

function bluetoothSpec(open: OpenMenu): ToggleSpec | null {
  const bt = AstalBluetooth.get_default()
  if (!bt.adapter) return null
  const paired = createBinding(bt, "devices")((ds) =>
    ds.filter((d) => d.paired).sort((a, b) => Number(b.connected) - Number(a.connected)),
  )

  const toggleDevice = (d: AstalBluetooth.Device) => {
    const done = (_: unknown, res: unknown) => {
      try {
        if (d.connected) d.disconnect_device_finish(res as never)
        else d.connect_device_finish(res as never)
      } catch (err) {
        console.error(err)
      }
    }
    if (d.connected) d.disconnect_device(done)
    else d.connect_device(done)
  }

  return {
    toggle: () => (
      <Toggle
        icon="bluetooth-active-symbolic"
        label="Bluetooth"
        subtitle={createBinding(bt, "isConnected")((c) => (c ? "Connected" : ""))}
        active={createBinding(bt, "isPowered")}
        onToggled={() => bt.toggle()}
        menu="bluetooth"
        open={open}
      />
    ),
    menu: {
      id: "bluetooth",
      panel: () => (
        <MenuPanel icon="bluetooth-active-symbolic" title="Bluetooth" active={createBinding(bt, "isPowered")}>
          <For each={paired}>
            {(d: AstalBluetooth.Device) => (
              <MenuItem
                icon={`${d.icon || "bluetooth"}-symbolic`}
                label={createBinding(d, "alias")}
                checked={createBinding(d, "connected")}
                onClicked={() => toggleDevice(d)}
              />
            )}
          </For>
          <label
            class="qs-menu-empty"
            label="No paired devices"
            visible={paired((ds) => ds.length === 0)}
          />
        </MenuPanel>
      ),
    },
  }
}

function powerModeSpec(open: OpenMenu): ToggleSpec | null {
  const pp = AstalPowerProfiles.get_default()
  if (!pp || pp.get_profiles().length === 0) return null
  const info: Record<string, [string, string]> = {
    performance: ["Performance", "power-profile-performance-symbolic"],
    balanced: ["Balanced", "power-profile-balanced-symbolic"],
    "power-saver": ["Power Saver", "power-profile-power-saver-symbolic"],
  }
  const order = ["performance", "balanced", "power-saver"].filter((p) =>
    pp.get_profiles().some((x) => x.profile === p),
  )
  const profile = createBinding(pp, "activeProfile")

  return {
    toggle: () => (
      <Toggle
        icon={profile((p) => info[p]?.[1] ?? "power-profile-balanced-symbolic")}
        label="Power Mode"
        subtitle={profile((p) => info[p]?.[0] ?? p)}
        active={profile((p) => p !== "balanced")}
        onToggled={() => pp.set_active_profile(pp.activeProfile === "balanced" ? "performance" : "balanced")}
        menu="power-mode"
        open={open}
      />
    ),
    menu: {
      id: "power-mode",
      panel: () => (
        <MenuPanel
          icon={profile((p) => info[p]?.[1] ?? "power-profile-balanced-symbolic")}
          title="Power Mode"
          active={profile((p) => p !== "balanced")}
        >
          {order.map((p) => (
            <MenuItem
              icon={info[p][1]}
              label={info[p][0]}
              checked={profile((a) => a === p)}
              onClicked={() => pp.set_active_profile(p)}
            />
          ))}
        </MenuPanel>
      ),
    },
  }
}

function dndSpec(): ToggleSpec {
  const notifd = AstalNotifd.get_default()
  return {
    toggle: () => (
      <Toggle
        icon="notifications-disabled-symbolic"
        label="Do Not Disturb"
        active={createBinding(notifd, "dontDisturb")}
        onToggled={() => notifd.set_dont_disturb(!notifd.dontDisturb)}
      />
    ),
  }
}

// Two equal columns of toggles; an open menu slides in below its row
function ToggleGrid({ specs, open }: { specs: Array<ToggleSpec | null>; open: OpenMenu }) {
  const items = specs.filter((s): s is ToggleSpec => s !== null)
  const rows = []
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2)
    rows.push(
      <box orientation={Gtk.Orientation.VERTICAL}>
        <box class="qs-row" spacing={10} homogeneous>
          {pair.map((s) => (
            <box hexpand>{s.toggle()}</box>
          ))}
          {pair.length === 1 && <box hexpand />}
        </box>
        {pair
          .filter((s) => s.menu)
          .map((s) => (
            <MenuRevealer id={s.menu!.id} open={open}>
              <box class="qs-menu-spacer">{s.menu!.panel()}</box>
            </MenuRevealer>
          ))}
      </box>,
    )
  }
  return (
    <box class="qs-grid" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
      {rows}
    </box>
  )
}

// ---- Top row and power ----

function PowerMenu({ open }: { open: OpenMenu }) {
  return (
    <MenuRevealer id="power" open={open}>
      <MenuPanel icon="system-shutdown-symbolic" title="Power Off">
        <MenuItem icon="weather-clear-night-symbolic" label="Suspend" onClicked={power.suspend} />
        <MenuItem icon="system-reboot-symbolic" label="Restart…" onClicked={power.restart} />
        <MenuItem icon="system-shutdown-symbolic" label="Power Off…" onClicked={power.powerOff} />
        <Gtk.Separator />
        <MenuItem icon="system-log-out-symbolic" label="Log Out…" onClicked={power.logOut} />
      </MenuPanel>
    </MenuRevealer>
  )
}

function BatteryLabel() {
  const battery = AstalBattery.get_default()
  return (
    <box spacing={6} visible={createBinding(battery, "isPresent")}>
      <image iconName={createBinding(battery, "batteryIconName")} />
      <label label={createBinding(battery, "percentage")((p) => `${Math.round(p * 100)}%`)} />
    </box>
  )
}

// Status icons on the right of the top bar; clicking opens quick settings
export function QuickSettingsButton() {
  const network = AstalNetwork.get_default()
  const wp = AstalWp.get_default()
  const battery = AstalBattery.get_default()

  const networkIcon = createBinding(network, "primary")((p) =>
    p === AstalNetwork.Primary.WIFI && network.wifi
      ? network.wifi.iconName
      : network.wired?.iconName ?? "network-wired-disconnected-symbolic",
  )

  return (
    <button
      class={openMenu((m) =>
        m === "quick-settings"
          ? "panel-button quick-settings-button active"
          : "panel-button quick-settings-button",
      )}
      onClicked={() => toggleMenu("quick-settings")}
    >
      <box spacing={8}>
        <MicIndicator />
        <image iconName={networkIcon} />
        {wp && <image iconName={createBinding(wp.defaultSpeaker, "volumeIcon")} />}
        <image
          iconName={createBinding(battery, "batteryIconName")}
          visible={createBinding(battery, "isPresent")}
        />
        <image iconName="system-shutdown-symbolic" />
      </box>
    </button>
  )
}

// GNOME's quick settings menu: system buttons, sound and brightness sliders,
// toggles with inline menus. Its own window, anchored top-right.
export default function QuickSettings() {
  const [openId, setOpenId] = createState<string | null>(null)
  const open: OpenMenu = { get: openId, set: setOpenId }
  registerSubMenus("quick-settings", setOpenId)
  // Collapse inline menus whenever quick settings closes
  openMenu.subscribe(() => {
    if (openMenu.get() !== "quick-settings") setOpenId(null)
  })

  return (
    <PanelMenu name="quick-settings" align="end" width={QS_WIDTH}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
        <box class="system-row" spacing={8}>
          <button class="icon-button" tooltipText="Take Screenshot" onClicked={() => {
            closeMenus()
            sh("sleep 0.4 && cobalt-screenshot area")
          }}>
            <image iconName="camera-photo-symbolic" />
          </button>
          <BatteryLabel />
          <box hexpand />
          <button class="icon-button" tooltipText="Lock" onClicked={() => {
            closeMenus()
            power.lock()
          }}>
            <image iconName="system-lock-screen-symbolic" />
          </button>
          <button
            class={openId((m) => (m === "power" ? "icon-button active" : "icon-button"))}
            tooltipText="Power Off / Log Out"
            onClicked={() => setOpenId(openId.get() === "power" ? null : "power")}
          >
            <image iconName="system-shutdown-symbolic" />
          </button>
        </box>
        <PowerMenu open={open} />
        <SoundSlider kind="speaker" open={open} />
        <SoundSlider kind="microphone" open={open} />
        <BrightnessSlider />
        <ToggleGrid
          open={open}
          specs={[
            networkSpec(open),
            vpnSpec(open),
            bluetoothSpec(open),
            powerModeSpec(open),
            nightLightSpec(),
            dndSpec(),
            caffeineSpec(),
            airplaneSpec(),
          ]}
        />
      </box>
    </PanelMenu>
  )
}
