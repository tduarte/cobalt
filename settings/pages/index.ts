import Adw from "gi://Adw?version=1"
import AstalNetwork from "gi://AstalNetwork"
import AppearancePage from "./appearance"
import BluetoothPage from "./bluetooth"
import DisplaysPage from "./displays"
import MultitaskingPage from "./multitasking"
import NetworkPage from "./network"
import Placeholder from "./placeholder"
import PowerPage from "./power"
import SoundPage from "./sound"
import WifiPage from "./wifi"

export type PageContext = {
  // Show a sub-page (with a back arrow) in the content pane; it's built in its
  // own scope, cleaned up when the user goes back
  push: (build: () => Adw.NavigationPage) => void
  // A deep link: `cobalt-settings <page> <action>` (e.g. `network add-vpn`)
  action: (name: string, run: () => void) => void
}

export type PageDef = {
  id: string
  title: string
  icon: string
  // Sidebar group; a separator goes between groups
  group: number
  keywords?: string[]
  // Hide the page when its hardware or backend is missing (GNOME hides Wi-Fi
  // without a Wi-Fi adapter)
  available?: () => boolean
  build: (ctx: PageContext) => Adw.NavigationPage
}

const soon = (title: string, icon: string) => () => Placeholder({ title, icon })

// GNOME Settings' sidebar, in its order. Pages with no backend outside GNOME
// Shell (Online Accounts, Sharing, Color Management, Printers, Remote Desktop)
// and Wellbeing are left out for now (docs/BRIEF.md).
export const PAGES: PageDef[] = [
  {
    id: "wifi",
    title: "Wi-Fi",
    icon: "network-wireless-symbolic",
    group: 0,
    keywords: ["wireless", "network", "hotspot", "internet"],
    available: () => AstalNetwork.get_default().wifi !== null,
    build: WifiPage,
  },
  {
    id: "network",
    title: "Network",
    icon: "org.gnome.Settings-network-symbolic",
    group: 0,
    keywords: ["wired", "ethernet", "vpn", "proxy", "wireguard", "openvpn"],
    build: NetworkPage,
  },
  {
    id: "bluetooth",
    title: "Bluetooth",
    icon: "org.gnome.Settings-bluetooth-symbolic",
    group: 0,
    keywords: ["devices", "pair", "headphones"],
    build: BluetoothPage,
  },
  {
    id: "display",
    title: "Displays",
    icon: "org.gnome.Settings-display-symbolic",
    group: 1,
    keywords: ["monitor", "screen", "resolution", "refresh", "scale", "hdr", "vrr", "night light"],
    build: DisplaysPage,
  },
  {
    id: "sound",
    title: "Sound",
    icon: "org.gnome.Settings-sound-symbolic",
    group: 1,
    keywords: ["audio", "volume", "speakers", "headphones", "microphone", "balance"],
    build: SoundPage,
  },
  {
    id: "power",
    title: "Power",
    icon: "org.gnome.Settings-power-symbolic",
    group: 1,
    keywords: ["battery", "suspend", "sleep", "power mode", "performance", "screen blank", "idle"],
    build: PowerPage,
  },
  {
    id: "multitasking",
    title: "Multitasking",
    icon: "org.gnome.Settings-multitasking-symbolic",
    group: 1,
    keywords: ["workspaces", "hot edge", "hot corner"],
    build: MultitaskingPage,
  },
  {
    id: "appearance",
    title: "Appearance",
    icon: "org.gnome.Settings-appearance-symbolic",
    group: 1,
    keywords: ["accent", "color", "background", "wallpaper", "theme"],
    build: AppearancePage,
  },
  { id: "applications", title: "Apps", icon: "org.gnome.Settings-applications-symbolic", group: 2, build: soon("Apps", "org.gnome.Settings-applications-symbolic") },
  { id: "notifications", title: "Notifications", icon: "org.gnome.Settings-notifications-symbolic", group: 2, build: soon("Notifications", "org.gnome.Settings-notifications-symbolic") },
  { id: "search", title: "Search", icon: "org.gnome.Settings-search-symbolic", group: 2, build: soon("Search", "org.gnome.Settings-search-symbolic") },
  { id: "mouse", title: "Mouse & Touchpad", icon: "org.gnome.Settings-mouse-symbolic", group: 3, build: soon("Mouse & Touchpad", "org.gnome.Settings-mouse-symbolic") },
  { id: "keyboard", title: "Keyboard", icon: "org.gnome.Settings-keyboard-symbolic", group: 3, build: soon("Keyboard", "org.gnome.Settings-keyboard-symbolic") },
  { id: "universal-access", title: "Accessibility", icon: "org.gnome.Settings-accessibility-symbolic", group: 4, build: soon("Accessibility", "org.gnome.Settings-accessibility-symbolic") },
  { id: "privacy", title: "Privacy & Security", icon: "org.gnome.Settings-privacy-symbolic", group: 4, build: soon("Privacy & Security", "org.gnome.Settings-privacy-symbolic") },
  { id: "system", title: "System", icon: "org.gnome.Settings-system-symbolic", group: 4, build: soon("System", "org.gnome.Settings-system-symbolic") },
]
