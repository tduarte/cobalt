# cobalt — project brief

A bootc image that will replace Bazzite on the main PC: Hyprland with a
GNOME-style shell and libadwaita apps, on Universal Blue's desktop-less base,
keeping Bazzite's gaming stack.

**Goal: the GNOME experience with Hyprland's tiling and personalization.**

**Principle: reuse GNOME first.** GNOME is three layers, and only the last
one is tied to GNOME Shell/Mutter:

1. Apps (Files, Calendar, Weather...): use them as they are, including their
   search providers.
2. Services and storage under them (GSettings keys, portals, GVfs/udisks,
   gnome-keyring, Flatpak's permission store, NetworkManager, UPower,
   power-profiles-daemon...): use them as they are; settings are written to
   GNOME's own keys and files so apps behave exactly as on GNOME.
3. GNOME Shell, Mutter and the parts of gnome-settings-daemon that need them
   (banners, search UI, automount/autorun, idle, Night Light, display
   config): this is the only layer we rebuild, in our shell and small
   session daemons, following GNOME's keys and behavior.

Before building something, check whether a GNOME component already does it
outside the shell.

Hardware it targets first: ASUS ROG Strix B850-I, Ryzen 9 9900X, Radeon
RX 9070 (games, desktop, dev VM), Radeon 610M iGPU, Secure Boot on with the
Universal Blue key enrolled.

## Base image

- `FROM ghcr.io/ublue-os/base-main:latest`. It follows the newest Fedora, so a
  failed build on a Fedora bump just pauses updates.
- Gaming stack ported from Bazzite's `Containerfile`, one script per piece:
  - OGC kernel from `ghcr.io/ublue-os/akmods:ogc-<fedora>`, version picked to
    match the base image
  - Valve-patched Mesa from Terra (`terra-mesa`), Fedora's Mesa excluded
  - `terra-gamescope`, Steam from Terra
  - `scx-scheds` / `scx-tools`
  - Kmods: only `v4l2loopback` and `zenergy` (what this hardware uses)
  - Xwayland stays Fedora's, not Terra's: Hyprland needs the arch-tagged
    `xorg-x11-server-Xwayland(x86-64)` that Terra's doesn't provide, and
    Bazzite's Xwayland patches target the gamescope Gaming Mode session
  - Firmware, udev rules and helpers from `ublue-os/bazzite` and
    `ublue-os/packages` COPRs, chosen package by package
- Also in the image: ROCm (`rocm-hip`, `rocm-runtime`), ghostty, distrobox,
  podman, Homebrew.
- **Secure Boot rule:** kernel and kernel modules only from Fedora or
  Universal Blue's prebuilt, signed images, always matching versions. Never
  build kernel code ourselves.

## Session

- Login: **GDM**. Its greeter is gnome-shell, so gnome-shell, mutter and
  gnome-session are in the image (hard dependencies), but the GNOME session
  entry is removed: GDM only offers **Cobalt**.
- Compositor: **Hyprland** from the `pm4rcin/Hyprland` COPR (maintained fork of
  solopasha's; Fedora 44 itself doesn't ship Hyprland), **dwindle** layout.
- Portals: `xdg-desktop-portal-hyprland` (screenshots, screencast) and
  `xdg-desktop-portal-gtk` (file chooser, settings/appearance).
- Config is **Lua** (Hyprland 0.55+). `cobalt.desktop` runs
  `cobalt-session` → `start-hyprland -- --config /usr/share/cobalt/hypr/hyprland.lua`.
  The system config loads `~/.config/cobalt/hyprland.lua` last for personal
  overrides, so image updates still reach existing users.
  - API reference: `/usr/share/hypr/stubs/hl.meta.lua` in the image.
  - Validate with `Hyprland --verify-config -c <file>` (as a normal user).
- hypridle/hyprlock still use the classic hyprlang format; their configs are
  in `/usr/share/cobalt/hypr/` too and are passed by path.
- **Decision (M4.6):** session daemons (hypridle, hyprpaper/`cobalt-wallpaper`,
  cliphist, the shell) run as **systemd user services** bound
  to the graphical session, so a crash restarts them instead of leaving them
  dead until logout. Evaluate `uwsm` (same COPR) to manage the session vs.
  our own units started from `hyprland.lua`.

## Shell: AGS v3 + Astal (TypeScript, GTK4)

GNOME-style top bar:
- Left: Activities button and workspaces
- Center: clock, notification center
- Right: tray, quick settings

Astal provides the backends: Hyprland, network, Bluetooth, WirePlumber
(audio), battery, MPRIS (media), notifd (notifications), tray.

## Our apps

All in **TypeScript/GJS with GTK4 + libadwaita**, sharing code and the Astal
libraries with the shell.

**Packaging (decision):** built into the image from source. The
Containerfile's `shell-step` runs `ags bundle` on `shell/` and `settings/`
(one gjs-run file each: `/usr/bin/cobalt-shell`, `/usr/bin/cobalt-settings`);
runtime libraries come from Fedora/COPR packages, and `.desktop` files,
units and rules from `system_files/`. No RPMs or Flatpaks: the apps need
direct system access (NetworkManager, systemd, Hyprland, polkit) and ship
and roll back with the image.

| App | What it does |
|---|---|
| Settings | **Full GNOME Settings parity** (decision): every GNOME Settings page, as close to a real DE as possible, including everything quick settings does (Wi-Fi, Network/VPN, Bluetooth, Sound, Power) with the full detail pages, plus Displays, Appearance/Background, Notifications, Search, Multitasking, Apps, Privacy, Online Accounts, Sharing, Mouse & Touchpad, Keyboard, Color, Printers, Accessibility, System (region, date & time, users, about). Layout and pages copied from the user's GNOME Settings screenshots (kept locally in `~/.cache/cobalt-refs/settings/`, not in the repo: they show personal network names). **Dark only** (decision): Appearance has no light style for now; it offers accent colors and backgrounds. Keyboard shortcuts are **editable** (saved to a generated file the Hyprland config loads). Pages without a backend outside GNOME Shell (Remote Desktop, Online Accounts, Printers, Sharing, Color Management) are **hidden** until we build replacements; Wellbeing is out of scope. `AdwNavigationSplitView` + preference pages. Writes the same GSettings keys GNOME uses (`org.gnome.desktop.*`), so libadwaita apps follow it through the settings portal; Hyprland-specific settings (monitors, input, keybindings) go to a generated file the Lua config loads. Opened from the quick settings gear. Opens **floating** by default (Hyprland window rule on its app id), like a GNOME window. |
| Date menu | Media player cards (MPRIS) and notifications on the left with Clear; date heading and a custom GNOME-style calendar on the right. Later: events (Evolution Data Server), world clocks, weather. |
| Launcher (was "Activities overview") | Super / Activities dots / Super+A open a full-screen launcher: search on top (one row of app results), GNOME's paged app grid with folders (GNOME's `app-folders`), and the dash with favorites (GNOME's `favorite-apps`) and running dots. **Decision (M4.5):** no workspace cards, strip or window thumbnails; window management stays with Hyprland (keybindings, Alt+Tab, workspace dots in the bar). **Hot Edge** (bottom edge) opens it too. |
| Quick settings | GNOME 48's menu: screenshot / lock / power (inline power menu); volume + Sound Output, microphone + Sound Input, brightness (backlight or DDC/CI); toggles Wi-Fi (networks + password), Wired, VPN, Bluetooth (devices), Power Mode, Night Light (hyprsunset), Do Not Disturb, Caffeine, Airplane Mode. Toggles with an arrow open their menu inline below the row, one at a time. Orange mic indicator in the bar while recording. Not yet: Settings gear (M5), Background Apps (M4), Dark Style (removed by choice). |
| Shortcut cheat sheet | Overlay listing all keybindings, generated from the Hyprland config. |
| OSD | **SwayOSD** (Terra) for the volume, mic mute and brightness keys (M4.6); close enough to GNOME's, nothing for us to maintain. |
| Welcome | **Decision:** a first-boot checklist script, not a full app: Flatpak picks, Secure Boot key enrollment, dotfiles, basics of tiling (points at the shortcut cheat sheet). |

## Apps from elsewhere

- **In the image:** Nautilus (with gvfs), ghostty, system tools that need host
  integration.
- **Flatpak (Flathub):** Text Editor, Loupe, Papers, Calculator, ProtonPlus,
  and everything else.

## Gaming

- Steam runs as a normal window inside Hyprland. No separate gamescope session.
- VRR on, tearing allowed for fullscreen games through window rules, direct
  scanout.
- Blur and animations turned off for fullscreen games.

## Look

Adwaita with extras: Adwaita colors and accent color, rounded corners, small
gaps, blur and translucency on shell surfaces, livelier animations.

- Icons: [Adwair](https://github.com/kusaida/Adwair) (WhiteSur/Adwaita blend,
  blue folders), installed from its pinned release. `Adwair-dark` (dark app
  icons) is also installed. Note: the repo has no license file yet.
- Cursor: Bibata Modern Ice (Terra's `bibata-cursor-theme`).
- Wallpapers: Unsplash photos in `/usr/share/backgrounds/cobalt/` (credits
  there), listed for GNOME tools in `gnome-background-properties/cobalt.xml`.
  hyprpaper draws them; `cobalt-wallpaper` follows GNOME's
  `org.gnome.desktop.background` keys, so the Settings app only writes those.

## Keybindings (draft, GNOME-flavored)

| Keys | Action |
|---|---|
| Super (tap) | Activities overview |
| Super+A | App grid / launcher |
| Super+Return | Terminal (ghostty) |
| Super+E | Files (Nautilus) |
| Super+Q, Alt+F4 | Close window |
| Super+Up | Maximize toggle |
| Super+F | Toggle floating |
| Super+Arrows | Move focus |
| Super+Shift+Arrows | Move window |
| Super+1…9 | Go to workspace |
| Super+Shift+1…9 | Move window to workspace |
| Super+Page Up/Down | Previous / next workspace |
| Alt+Tab | Window switcher |
| Super+V | Notification center |
| Super+L | Lock screen |
| Super+Space | Switch input source |
| Super+/ | Shortcut cheat sheet |
| Print | Screenshot UI |

## Development setup

- Day-to-day image changes stay local: `just vm-push` builds and pushes
  `cobalt:dev` to the `cobalt-registry` podman container (127.0.0.1:5000,
  `10.0.2.2:5000` from the VM), then `just vm-update` switches/upgrades the
  VM and reboots it. Only changed layers move.
- Config-only tweaks skip the image: copy the file into the VM over SSH and
  reload Hyprland.
- GitHub Actions builds and signs `ghcr.io/tduarte/cobalt` when a milestone is
  pushed (and nightly); that's what real installs follow.
- VM: GNOME Boxes VM `silverblue43`, switched to cobalt with `bootc switch`.
  Start it with `just vm-start` (not Boxes' play button), then open it in
  Boxes to view; `just vm-ssh` / `just vm-stop` for the rest.
  - virgl is pinned to the RX 9070 (`pci-0000:03:00.0-render`). The 610M
    iGPU is too slow at 4K, and Boxes drawing on a different GPU than the
    VM renders on garbles the display.
  - Boxes drops the render-node pin when it starts a VM (libvirt then picks
    the iGPU), which is why `vm-start` re-applies it on every start.
  - SSH: `127.0.0.1:2222` → VM port 22 through a QEMU `hostfwd` NIC (Boxes'
    Flatpak has no `passt`), key `~/.ssh/cobalt-vm`.
  - Hyprland needs `no_hardware_cursors` in the VM.
- Shell and apps: develop in a `cobalt` distrobox, then package them into the
  image once stable.

## Milestones

1. Gaming base: kernel, Mesa, Steam, ROCm on base-main. Boots to a TTY in the
   VM with Secure Boot rules respected.
2. Desktop basics: Hyprland, GDM, portals, Nautilus, default config,
   keybindings.
3. AGS top bar and quick settings.
4. Background Apps in quick settings (built from tray/StatusNotifierItem apps;
   the bar gets no tray icons, like stock GNOME), Activities overview (with
   Hot Edge), shortcut cheat sheet.
   - **4.5:** launcher (app grid, search, dash), wallpapers via hyprpaper.
   - **4.6:** session daemons as systemd user services; volume/brightness OSD
     (SwayOSD).
5. Settings app (full GNOME Settings parity), shipped in batches in GNOME's
   sidebar order, each tested before the next:
   - Wi-Fi (saved/hidden networks, hotspot, QR share), Network (wired, VPN
     with NetworkManager's VPN editors, proxy), Bluetooth
   - Displays (resolution, refresh/VRR, HDR, scale, orientation, Night Light
     schedule), Sound (devices, profiles, balance, volume levels), Power
     (devices' batteries, power mode, power button, dim/blank/suspend via
     hypridle), Multitasking (Hot Edge, workspaces), Appearance (accent,
     backgrounds)
   - Apps (Default Apps only), Notifications (DND, per-app list; the shell honors GNOME's notification
     keys; no lock screen option), Search page dropped (see below)
   - Mouse & Touchpad (Hyprland input), Keyboard (layouts from GNOME's xkb
     list, Super+Space, alternate characters and compose keys, shortcut
     editor), Privacy & Security (screen lock, location / camera /
     microphone with per-app permissions, file history and trash)
   - System: About (cobalt logo, device name, hardware, details), Date & Time
     (automatic time and zone, zone picker, clock format, first weekday, top
     bar clock options), Secure Shell, Region & Language (your language and
     formats, and the login screen's), Users (all accounts: add/remove, admin, autologin, fingerprint)
   - Before batch 3, regardless of pages: run XDG autostart and GNOME's
     session services (localsearch, evolution-alarm-notify), the working
     gnome-settings-daemon plugins, and test xdg-desktop-portal-gnome's
     dialogs (reuse audit)
   - **Descoped (decision 2026-11-01):** per-app pages, Removable Media
     (page and handler; drives mount when opened in Files), the whole
     Accessibility page, launcher search providers
     and the Search page, IBus input methods, per-window layouts, Device
     Security, Thunderbolt, problem reporting, Printers, Sharing, Color
     Management, Online Accounts, Wellbeing
6. **Everyday shell** (from the DE gap review, decision 2026-11-01). Done:
   - End session dialog: GNOME's Log Out / Restart / Power Off confirmation
     with a 60 s countdown; apps are asked to close first and any still open
     are listed with "<Action> Anyway" (these used to act immediately).
     Super+Shift+E and Ctrl+Alt+Del open Log Out; the power button's
     "interactive" action opens Power Off
   - Alt+Tab app switcher (most recent first, switches on Alt release),
     Alt+Shift+Tab back, Super+` cycles an app's windows
   - Updates: rpm-ostreed-automatic already stages images and flatpak's timer
     updates apps; the shell notifies once per staged version ("Update
     Ready", Restart…), the power menu says "Restart & Update…", and the
     dialog says the update will be installed. GNOME Software (with its
     rpm-ostree plugin) is the store; its own downloads/notifications are off
   - No notification banners over fullscreen windows (still listed)
   - Screenshot UI like GNOME's on Print (Selection / Screen / Window,
     screenshot or screencast, pointer; S/C/W/V/P keys), Shift+Print screen,
     Alt+Print window, Ctrl+Alt+Shift+R screencast. Recording with
     **gpu-screen-recorder** in a transient user unit, red stop/elapsed pill
     in the bar, "Screenshot captured" / "Screencast recorded" notifications
   - Screen sharing: our GTK picker (`cobalt-share-picker`) as
     xdg-desktop-portal-hyprland's custom picker, orange indicator in the
     bar. **Decision:** GNOME's ScreenCast portal can't be used: it captures
     through Mutter's private D-Bus API
   - Lock screen (hyprlock): clock at the top, avatar and name above the
     password, what's playing (click to play/pause), Restart / Power Off that
     only go ahead if every app closes
   - gnome-keyring (unlocked by GDM's PAM, gcr's prompter) checked; SSH agent
     is gcr-ssh-agent (`SSH_AUTH_SOCK`)
   - **Mission Center** with Ctrl+Shift+Esc, installed from
     `/usr/share/cobalt/flatpaks.list` by `cobalt-flatpaks.service`

   - Password prompts in the shell, GNOME's modal dialog: the polkit agent
     ("Authentication Required", replaces hyprpolkitagent) and the
     NetworkManager secret agent (Wi-Fi, 802.1X, PPPoE, mobile broadband,
     VPNs through their plugin's external UI mode). **Decision:** both export
     their D-Bus interfaces directly; GJS can't subclass PolkitAgent.Listener
     or NM.SecretAgentOld (vfuncs with callbacks), and no GTK4 agent is
     packaged
   - Date menu cards: the selected day's events from GNOME Shell's own
     `gnome-shell-calendar-server` (Evolution Data Server; dots on busy
     days), world clocks from GNOME Clocks and the weather (libgweather)
     for GNOME Weather's location. The Flatpak apps keep these in their
     sandbox keyfile, which we read like GNOME Shell does. Calendar, Clocks
     and Weather are in the Flathub list
7. **Hyprland personalization:** a Windows & Tiling page (layout, gaps,
   borders, rounding, blur, opacity, animations), a window rules editor
   (per-app float, workspace, opacity, size), Auto accent color (done: an
   Auto swatch in Appearance; our own `io.github.tduarte.cobalt
   accent-color-auto` key, and the shell picks GNOME's `accent-color` from
   the background).
8. Welcome (first-boot checklist script).
9. Switch the main PC with `bootc switch` (rollback to Bazzite available).

## Extras

- **Handy** (local speech-to-text, MIT, https://github.com/cjpais/Handy):
  install the release RPM in the image (pinned version, like Adwair) plus
  `wtype` for typing into apps on Wayland. Push-to-talk on **hold Alt+Space**
  via Hyprland, since Handy's own global shortcut is unreliable on Wayland:
  press runs `handy --toggle-transcription` to start, a `release = true` bind
  on the same keys runs it again to stop. Handy itself autostarts with the
  session.

## Backlog (polish)

- **Reuse audit:** done 2026-11-01; findings and decisions in "Reuse audit"
  below.
- SSH agent: gnome-keyring's SSH component is GNOME-only and gcr-ssh-agent
  isn't wired up (SSH_AUTH_SOCK); decide whether the session should provide
  an agent.
- Default Apps: GNOME's "Other" content types sub-page.
- Remote viewing of the dev VM (and later Settings > Remote Desktop): wayvnc in
  the image, port forwarded to the PC's LAN address, a host firewall rule
  (user's call); macOS Screen Sharing can't use wayvnc's auth.
- Displays: arrangement of several monitors (drag to position, primary
  display); today each monitor is configured on its own.
- Sound: alert sound picker and System Sounds volume (nothing plays alert
  sounds yet); input level meter.
- Multitasking: GNOME's multi-monitor workspaces and app switching options.
- Hyprland's active window border could follow the accent color.

- Background Apps hover states (compare GNOME 48): the "N Background Apps ›"
  row should highlight as a full-width pill; an app row should highlight as one
  rounded rectangle covering the icon, name and ✕, not just the name part.
- App grid: drag and drop moves apps into, out of and between folders (and
  makes folders), writing GNOME's app-folders keys; folder names are
  editable. The grid stays alphabetical by choice: no custom order
  (`app-picker-layout`).
- Launcher search providers like GNOME's result sections: Settings pages (with the M5 Settings app), files (localsearch), maybe Flathub apps.
- `build-disk.yml`: migrate to `osbuild/image-builder-action` before we need
  an installer ISO.

## Reuse audit (2026-11-01)

Tested in the dev VM under Hyprland.

- **gnome-settings-daemon plugins that run as-is:** housekeeping (disk space
  warnings, trash/temp cleanup), datetime (automatic time zone), print
  notifications, sharing (Sharing page backend), a11y-settings, rfkill,
  smartcard, usb-protection, wwan, sound. Their units refuse manual start
  (tied to gnome-session), so run the binaries from our own units.
- **Need Mutter/Shell, replaced by ours:** power, color (Night Light),
  media-keys, keyboard, screensaver-proxy. xsettings runs but can't read the
  scale from Mutter (maybe useful for X11 apps like Steam; to test).
- **XDG autostart doesn't run in our session** (a gap): nothing from
  /etc/xdg/autostart or ~/.config/autostart starts (apps set to start at
  login, Orca). GNOME's own services ship systemd units instead
  (localsearch-3 for file search, evolution-alarm-notify for reminders),
  which GNOME starts from its session; ours should start them too, plus
  systemd's xdg-desktop-autostart.target.
- **Libraries/services to use directly:** Goa (Online Accounts), ECal/EDS and
  GNOME Shell's calendar server (date menu events), GNOME Shell's
  hotplug-sniffer (what's on a USB drive, for autorun), localsearch (file
  search provider), gcr (keyring prompts).
- **xdg-desktop-portal-gnome** also offers FileChooser (GTK 4), AppChooser,
  Access (camera/mic prompts), Account, Print, Wallpaper; to test as
  replacements for the GTK 3 ones from xdg-desktop-portal-gtk.
- **GNOME Settings itself (gnome-control-center 50, already installed as a
  GDM dependency) runs under Hyprland** with `XDG_CURRENT_DESKTOP=GNOME`. All
  panels load except Displays (needs Mutter's DisplayConfig API; Night Light
  is inside it). Online Accounts, Printers, Sharing (with gsd-sharing),
  Color, Wellbeing, Users, Region all load without errors. Its pages write the
  same GNOME keys our adapters already follow (power/idle, wallpaper, accent,
  hot edge, Night Light keys).

**Decision (after the audit): keep our own Settings app (option C).** One
Settings app with the full experience (displays included), not two; GNOME
Settings isn't used, even though it runs; the audit's other findings still
apply (gsd plugins, autostart, portals, libraries). **Online Accounts is out
of scope.**

## Open questions

- Which Bazzite helpers (`ujust` recipes, media automount, etc.) to carry over.
- Dotfiles: managed by the image defaults alone, or also a personal dotfiles
  repo.
