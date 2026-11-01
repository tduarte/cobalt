# cobalt — project brief

A bootc image that will replace Bazzite on the main PC: Hyprland with a
GNOME-style shell and libadwaita apps, on Universal Blue's desktop-less base,
keeping Bazzite's gaming stack.

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

| App | What it does |
|---|---|
| Settings | GNOME Settings-like app (`AdwNavigationSplitView` + preference pages). Writes the same GSettings keys GNOME uses (`org.gnome.desktop.interface`: color scheme, accent color, fonts), so every libadwaita app follows it through the settings portal. |
| Date menu | Media player cards (MPRIS) and notifications on the left with Clear; date heading and a custom GNOME-style calendar on the right. Later: events (Evolution Data Server), world clocks, weather. |
| Activities overview | Super opens open windows and workspaces plus app search. **Hot Edge** (like the GNOME extension): pushing the mouse against the bottom edge opens it too, via a thin invisible layer-shell strip. |
| Quick settings | GNOME 48's menu: screenshot / lock / power (inline power menu); volume + Sound Output, microphone + Sound Input, brightness (backlight or DDC/CI); toggles Wi-Fi (networks + password), Wired, VPN, Bluetooth (devices), Power Mode, Night Light (hyprsunset), Do Not Disturb, Caffeine, Airplane Mode. Toggles with an arrow open their menu inline below the row, one at a time. Orange mic indicator in the bar while recording. Not yet: Settings gear (M5), Background Apps (M4), Dark Style (removed by choice). |
| Shortcut cheat sheet | Overlay listing all keybindings, generated from the Hyprland config. |
| Welcome | First-boot app: Flatpak picks, Secure Boot key enrollment, dotfiles, basics of tiling. |

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
5. Settings app.
6. Welcome app.
7. Switch the main PC with `bootc switch` (rollback to Bazzite available).

## Extras

- **Handy** (local speech-to-text, MIT, https://github.com/cjpais/Handy):
  install the release RPM in the image (pinned version, like Adwair) plus
  `wtype` for typing into apps on Wayland. Push-to-talk on **hold Alt+Space**
  via Hyprland, since Handy's own global shortcut is unreliable on Wayland:
  press runs `handy --toggle-transcription` to start, a `release = true` bind
  on the same keys runs it again to stop. Handy itself autostarts with the
  session.

## Open questions

- How our apps are packaged into the image: a build stage in the
  Containerfile, or RPMs built in CI.
- Which Bazzite helpers (`ujust` recipes, media automount, etc.) to carry over.
- Dotfiles: managed by the image defaults alone, or also a personal dotfiles
  repo.
