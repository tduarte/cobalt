import Adw from "gi://Adw?version=1"
import AstalNetwork from "gi://AstalNetwork"
import AppearancePage from "./appearance"
import AppsPage from "./apps"
import BluetoothPage from "./bluetooth"
import DisplaysPage from "./displays"
import KeyboardPage from "./keyboard"
import MousePage from "./mouse"
import MultitaskingPage from "./multitasking"
import NetworkPage from "./network"
import NotificationsPage from "./notifications"
import PowerPage from "./power"
import PrivacyPage from "./privacy"
import SoundPage from "./sound"
import SystemPage from "./system"
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

// GNOME Settings' sidebar, in its order. Descoped pages (docs/BRIEF.md) are
// left out: Search, Online Accounts, Sharing, Wellbeing, Color Management,
// Printers, Accessibility (and Remote Desktop under System).
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
  {
    id: "applications",
    title: "Apps",
    icon: "org.gnome.Settings-applications-symbolic",
    group: 2,
    keywords: ["default apps", "browser", "mail", "music", "video", "photos"],
    build: AppsPage,
  },
  {
    id: "notifications",
    title: "Notifications",
    icon: "org.gnome.Settings-notifications-symbolic",
    group: 2,
    keywords: ["do not disturb", "banners", "popups"],
    build: NotificationsPage,
  },
  {
    id: "mouse",
    title: "Mouse & Touchpad",
    icon: "org.gnome.Settings-mouse-symbolic",
    group: 3,
    keywords: ["pointer", "speed", "acceleration", "scroll", "touchpad", "tap", "left handed"],
    build: MousePage,
  },
  {
    id: "keyboard",
    title: "Keyboard",
    icon: "org.gnome.Settings-keyboard-symbolic",
    group: 3,
    keywords: ["layout", "input source", "shortcuts", "keybindings", "compose"],
    build: KeyboardPage,
  },
  {
    id: "privacy",
    title: "Privacy & Security",
    icon: "org.gnome.Settings-privacy-symbolic",
    group: 4,
    keywords: ["lock", "location", "camera", "microphone", "history", "trash"],
    build: PrivacyPage,
  },
  {
    id: "system",
    title: "System",
    icon: "org.gnome.Settings-system-symbolic",
    group: 4,
    keywords: ["about", "users", "date", "time", "time zone", "language", "region", "ssh", "hostname", "device name"],
    build: SystemPage,
  },
]
