# AGENTS.md — working on cobalt

cobalt is a bootc image (Universal Blue `base-main` + Bazzite's gaming stack +
Hyprland with a GNOME-style AGS shell) meant to replace Bazzite on the
maintainer's PC. **Product decisions live in [docs/BRIEF.md](docs/BRIEF.md)**;
this file is the practical knowledge for building and testing it. Add to it
whenever you learn something the hard way.

The host is Bazzite (immutable Fedora Atomic). The user's global rules apply:
no `sudo`, `rpm-ostree` or `dnf` on the host, toolchains in a distrobox,
services in podman, CLIs via Homebrew.

## Working with the user

- **Reuse GNOME first** (docs/BRIEF.md, "Principle"): use GNOME's apps,
  services and settings keys as they are; only rebuild what GNOME Shell,
  Mutter or Mutter-dependent gnome-settings-daemon parts would do. Check for
  an existing GNOME component before writing a backend.

- Put anything you need from the user (a decision, an action, an answer) at the
  **end** of the message, restated even if mentioned earlier.
- Commit and push only when asked; a push to `main` triggers the GitHub image
  build. Milestones (docs/BRIEF.md) are the usual commit points.
- The user tests things in the VM by hand (keybindings, anything needing real
  input); you verify the rest yourself (SSH, `hyprctl`, screenshots).

## Repo layout

| Path | What |
|---|---|
| `Containerfile` | Stages: akmods/brew sources, one `*-step` scratch stage per build step, then `base-main` + one `RUN` per step |
| `build_files/` | `kernel.sh`, `repos.sh` + `mesa.sh`, `gaming.sh`, `dev.sh`, `desktop.sh`, `build.sh` (copies `system_files/`), `finalize.sh` |
| `system_files/` | Copied to `/` in the image: Hyprland/hypridle/hyprlock configs in `/usr/share/cobalt/hypr/`, `cobalt-session`, `cobalt-screenshot`, GDM session, gschema overrides |
| `shell/` | The AGS v3 shell (TypeScript/JSX, GTK4): `app.tsx`, `widget/`, `lib/`, `style.scss` |
| `settings/` | The Settings app (`Adw.Application` `io.github.tduarte.cobalt.Settings`, gnim JSX), bundled by `ags bundle` into `/usr/bin/cobalt-settings` in `shell.sh`: `window.tsx` (sidebar + content), `pages/`, `lib/` (NM helpers, connection editor, VPN) |
| `Justfile` | Build recipes (template) + `[Dev VM]` recipes (ours) |
| `docs/BRIEF.md` | Product brief, decisions, milestones |

## Building the image

- **Fedora and the kernel are pinned** by `FEDORA_VERSION` and `KERNEL_VERSION`
  at the top of the `Containerfile`. Bump them on purpose and test in the VM:
  F45 built fine and still silently broke the Terra repo cleanup and the
  keyring. `KERNEL_VERSION` follows the kernel in Bazzite's stable release notes
  (`gh release view -R ublue-os/bazzite`), and the `fc<NN>` part must match.
- To inspect an image offline: `podman run --rm --network=none <image> bash -c
  '...'`, including `rpm -q`, `dnf5 repolist --enabled` and
  `Hyprland --verify-config` as a non-root user.
- **Caching:** each step mounts only its own stage (`kernel-step`,
  `mesa-step`, ...). Editing one script reruns that step and everything after
  it; editing `system_files/` only reruns the last steps (~30 s). Never go back
  to one shared context stage: any change would rebuild everything (~15 min).
- `repos.sh` sets `keepcache=1` so RPMs stay in the `/var/cache` cache mount
  between builds; `finalize.sh` resets it. Downloads are the slow part of a
  build (COPR/Terra mirrors are ~3–7 MB/s), not CPU.
- CI (`.github/workflows/build.yml`) builds, rechunks and signs
  `ghcr.io/tduarte/cobalt` on push and nightly. Rechunking is `just rechunk`
  (chunkah, pinned by digest). On two consecutive builds with a small change,
  the update download was 0.44 GiB vs 0.52 GiB with `just ostree-rechunk`,
  which also needs `--privileged` and drops labels. Verify with
  `cosign verify --key cosign.pub ghcr.io/tduarte/cobalt:latest`.
  `cosign.key` is gitignored and lives in the `SIGNING_SECRET` repo secret.
- `bootc container lint` warns about `/run/dnf` and `/run/setrans`; harmless.
- The kernel step's `error: package kernel-tools... is not installed` and
  grub2 errors in the build log are expected.

## Package sources and their traps

| What | Source | Notes |
|---|---|---|
| Kernel + kmods | `ghcr.io/ublue-os/akmods{,-extra}:ogc-<fedora>-<kver>` | Signed with the Universal Blue key (enrolled on the PC). **Secure Boot rule: never build kernel code ourselves.** Only `v4l2loopback` and `zenergy` kmods are installed (what this hardware uses). |
| Mesa, Steam, gamescope, MangoHud, WirePlumber | Terra (priority 1) | `terra-mesa` repo is disabled and enabled per command; Fedora/negativo17 Mesa excluded. negativo17's repo id is `fedora-multimedia`. |
| Xwayland | **Fedora**, not Terra | Hyprland requires `xorg-x11-server-Xwayland(x86-64)`; `terra-xorg-x11-server-Xwayland` only provides the unqualified name. |
| ghostty | COPR `scottames/ghostty` | Terra's older ghostty is excluded (its add-on packages conflict). |
| Hyprland 0.57 + tools | COPR `pm4rcin/Hyprland` | Fedora 45 doesn't ship Hyprland; `solopasha/hyprland` is Rawhide-only now. |
| Secret Service | Fedora `oo7-daemon` + `oo7-portal`, `gcr3`'s `gcr-prompter` for the unlock dialog, `gcr` for the SSH agent | Since F45; GDM's PAM config starts and unlocks it on a password login, and `cobalt-session.target` starts it on autologin (no D-Bus activation). **Don't install `gnome-keyring` alongside it:** its D-Bus file for `org.freedesktop.secrets` starts `gnome-keyring-daemon`. Test prompts from inside the session (`hyprctl dispatch 'hl.dsp.exec_cmd(...)'`): over SSH oo7 uses its CLI prompter and fails with `NameHasNoOwner`. |
| AGS + Astal | COPR `sinomor/astalRPM` | AGS is `aylurs-gtk-shell` (Fedora's `ags` is Adventure Game Studio). Terra's partial `astal*` is excluded. `libastal-notifd` lacks its gschema, so we ship `io.astal.notifd.gschema.xml` ourselves. AGS preloads unversioned `libgtk4-layer-shell.so` → needs `gtk4-layer-shell-devel`. |
| GDM | Fedora | Hard-depends on gnome-shell/gnome-session; `desktop.sh` deletes the GNOME and stock Hyprland session files so GDM only offers **Cobalt**. |

Add new COPRs to the loops in both `repos.sh` (enable) and `finalize.sh`
(disable), and to Terra's exclude list if Terra has a same-named package.

Since F45, packaged repo files live in `/usr/share/dnf5/repos.d`, not
`/etc/yum.repos.d`. Change them with `dnf5 config-manager setopt` (it writes
`/etc/dnf/repos.override.d/`), never `sed` on a path.

## Hyprland (0.55+ uses Lua)

- System config: `/usr/share/cobalt/hypr/hyprland.lua`, started by
  `cobalt-session` → `start-hyprland -- --config <path>`. It loads
  `~/.config/cobalt/hyprland.lua` last for personal overrides.
- API reference: `/usr/share/hypr/stubs/hl.meta.lua` in the image; wiki source
  in `hyprwm/hyprland-wiki` (`content/configuring/...`).
- **Validate** before shipping: `Hyprland --verify-config -c <file>` as a
  normal user with `XDG_RUNTIME_DIR` set (it refuses to run as root). It
  catches unknown keys.
- **Colors are `0xAARRGGBB`.** `0x1e1e1e` is fully transparent.
- Dispatch from outside is Lua too:
  `hyprctl dispatch 'hl.dsp.exec_cmd("ghostty")'`. AstalHyprland's
  `dispatch(name, args)` sends the legacy syntax; use
  `message_async("dispatch hl.dsp....")` instead (see `shell/lib/system.ts`).
- hypridle/hyprlock still use the classic hyprlang format; pass their config
  paths explicitly.
- Prefer stock Hypr tools over shell code for things that must survive a shell
  crash (lock: hyprlock, idle: hypridle, wallpaper: hyprpaper). The wallpaper
  was once a shell window and ended up above all apps.
- **Session services (systemd user units in `system_files/usr/lib/systemd/user/`).**
  `hyprland.lua` imports the environment and starts `cobalt-session.target`,
  which wants `cobalt-shell`, `hypridle`, `hyprpaper` + `cobalt-wallpaper`,
  and `cobalt-clipboard`; each restarts on failure. Packaged
  units (hypridle, hyprpaper, hyprsunset) get our flags through `*.service.d/`
  drop-ins. Hyprland itself activates `hyprland-session.target`, and
  everything stops with it. Inspect with
  `systemctl --user status cobalt-session.target` /
  `journalctl --user -u cobalt-shell`.
- The shell launches apps in their own scopes (`systemd-run --user --scope`,
  `launchApp` in `lib/system.ts`), so a shell restart never kills apps. Keep
  the shell service's default `KillMode`: `/usr/bin/cobalt-shell` is a
  wrapper that runs `gjs` as a child, and `KillMode=process` left that child
  alive after a crash, so the restarted copy found the old instance and quit. Toggles with state (Night Light =
  `hyprsunset.service`, Caffeine = `cobalt-caffeine.service`) live in systemd,
  not in the shell, so they survive restarts.
- Wallpaper: `hyprpaper.service` runs `cobalt-wallpaper --write-config`
  first (config in `$XDG_RUNTIME_DIR/cobalt/hyprpaper.conf` with the current
  picture), and `cobalt-wallpaper.service` re-applies over IPC
  (`hyprctl hyprpaper wallpaper ', <path>, cover'`) when GNOME's background
  keys change. Check with `hyprctl hyprpaper listactive`.
- OSD: SwayOSD (Terra). `cobalt-osd.service` runs `swayosd-server`; the
  media key binds call `swayosd-client` (it changes the value and shows the
  OSD). The caps-lock libinput backend isn't used.

## Dev VM (GNOME Boxes)

The VM `silverblue43` runs cobalt (`10.0.2.2:5000/cobalt:dev` from the local
registry). Boxes is a Flatpak: run libvirt tools as
`flatpak run --command=virsh org.gnome.Boxes -c qemu:///session ...`
(write temp XML under `~/.cache`, since the sandbox has its own `/tmp`).

| Recipe | Does |
|---|---|
| `just vm-start` | Re-pins virgl to the RX 9070 and starts the VM. Boxes' play button also works now (see GPU below). |
| `just vm-stop` | Graceful shutdown |
| `just vm-ssh '<cmd>'` | SSH (127.0.0.1:2222, key `~/.ssh/cobalt-vm`); a quoted command runs entirely in the VM, pipes included |
| `just registry` | Starts the `cobalt-registry` podman container (127.0.0.1:5000) |
| `just vm-push` | `just build cobalt dev` + push to the local registry |
| `just vm-update` | `bootc switch`/`upgrade` in the VM, then power off and cold-start |
| `just shell-dev` | Stops `cobalt-shell.service`, copies `shell/` into the VM and runs it with `ags run` inside Hyprland (no image rebuild); log at `/tmp/cobalt-shell.log` in the VM. A VM restart brings the service back |
| `just settings-dev [page]` | Copies `settings/` into the VM and (re)starts the Settings app from it (quits the running one over D-Bus); log at `/tmp/cobalt-settings.log` |
| `just vm-screenshot <path>` | `grim` screenshot of the VM session to a local file |

Hard-won facts:

- **GPU:** virgl must render on the **RX 9070** (`pci-0000:03:00.0-render`).
  The 610M iGPU is far too slow at 4K, and if QEMU renders on one GPU while
  Boxes draws on the other, the display is garbled. **Boxes drops the
  `rendernode` attribute of `<gl>` whenever it starts the VM** (libvirt then
  passes `renderD129`, the iGPU), but it keeps `<qemu:commandline>`, and QEMU
  uses the last `-spice rendernode=`. So the VM's XML ends that block with
  `-spice` + `rendernode=/dev/dri/by-path/pci-0000:03:00.0-render`, and Boxes'
  play button works. To check, see which `renderD*` the `qemu-system-x86`
  process has open in `/proc/<pid>/fd`; the qemu line itself lists both nodes.
- Don't pipe `just vm-start` or `vm-update` (`| tail`): the VM's processes
  inherit the pipe, so the reader never gets EOF and the command hangs. Redirect
  to a file. A QEMU started under `timeout flatpak run` also outlives the timeout.
- **The VM's power button suspends it** (Settings > Power > Power Button
  Behavior, default Suspend), so `virsh shutdown` puts it to sleep instead of
  off; `just vm-stop` powers off over SSH. Wake a suspended guest with
  `virsh send-key silverblue43 KEY_SPACE`.
- **Never reboot the guest** while GL is on: QEMU's SPICE aborts
  (`gl_draw_cookie` assertion). Power off and cold-start (`vm-update` does).
- **Close Boxes before the VM restarts** and reopen it after; a Boxes window
  attached to the old QEMU instance just spins.
- `virsh screenshot` fails with GL on ("no surface"), so use `grim` inside
  the session.
- SSH uses an extra QEMU user-mode NIC with `hostfwd` (Boxes' Flatpak has no
  `passt`). It must sit at an explicit PCI address (`addr=0x0a`), or it takes
  slot 1 from the GPU and the VM won't start.
- The VM user has passwordless sudo (`/etc/sudoers.d/90-dev`) and GDM
  autologin (from Boxes' express install); neither exists on real installs.
- In the VM, Hyprland uses software cursors, and ghostty uses
  `LIBGL_ALWAYS_SOFTWARE=1` (its GL renderer garbles on virgl). Both are
  switched on by the config's QEMU check, not needed on hardware.
- Session env for commands over SSH: `XDG_RUNTIME_DIR=/run/user/1000`,
  `WAYLAND_DISPLAY=wayland-1`,
  `HYPRLAND_INSTANCE_SIGNATURE=$(ls -t /run/user/1000/hypr | head -1)`.

## Shell (AGS v3)

- Docs/examples: `Aylur/ags` repo `docs/guide/*.md` and `examples/gtk4/`.
  JSX via Gnim: `createBinding`, `createState`, `createComputed`,
  `createPoll`, `<For>`, `<With>`; `class=` for CSS, `$=` for the widget
  instance. Components that return fragments (e.g. `<With>`) aren't
  `Gtk.Widget`s, so wrap them in a `<box>` before treating them as widgets.
- Style: SCSS compiled by dart-sass; use `sass:color` functions
  (`lighten()` is deprecated).
- **Adwaita paints buttons and slider knobs with a `background-image` on top
  of `background-color`**, so custom colors only show at the corners. Every
  button we style needs `background-image: none` (done globally in
  `style.scss` for our windows/popovers).
- Debug CSS live without restarting:
  `ags request -i cobalt css "<css>"`; inspect widget classes with
  `ags request -i cobalt describe <menu>`; open menus with
  `ags request -i cobalt toggle quick-settings|date-menu`.
- Spawning a program that isn't installed (`execAsync`, `Gio.Subprocess`)
  **throws synchronously** and takes down the whole widget tree it's in.
  Check `GLib.find_program_in_path()` first and hide the feature instead
  (see `widget/qs/extra.tsx`).
- `ags request -i cobalt toggle quick-settings <sub-menu>` opens an inline
  quick-settings menu (`wifi`, `bluetooth`, `vpn`, `power-mode`,
  `sound-output`, `sound-input`, `power`) for screenshots.
- GTK CSS has no `max-width`/`max-height`; size with `min-*` and alignment.
- GTK tries Vulkan first; in the VM it logs `radv`/`vdrm_device_connect`
  errors and falls back to GL. Harmless noise.
- AstalHyprland logs `Json-CRITICAL` / `get_client: address != NULL` with
  Hyprland 0.57; its workspace/monitor state is still correct.
- The shell writes/reads GNOME's GSettings (`org.gnome.desktop.interface`) so
  libadwaita apps and the future Settings app stay in sync.
- Settings GNOME has no key for go in our own schema
  `io.github.tduarte.cobalt` (`system_files/usr/share/glib-2.0/schemas/`;
  so far `accent-color-auto`). Code must check it exists
  (`SettingsSchemaSource.lookup`), since `new Gio.Settings` on a missing
  schema aborts the process. In the VM, install a changed schema with
  `sudo bootc usr-overlay` + `glib-compile-schemas`.

## Settings app

- Pages are registered in `settings/pages/index.ts` (GNOME's sidebar order;
  `available()` hides a page without hardware, like Wi-Fi). Each page builds
  inside a gnim root; use `watch`/`track`/`every` from `lib/ui.ts` so signal
  handlers and timers go away when the user switches pages.
- Deep links: `cobalt-settings <page> [action]` (e.g. `network add-vpn`,
  `network proxy`, `network wired`, `wifi saved|hidden|hotspot`). A second
  invocation goes to the running instance, so QA screenshots of dialogs are
  `cobalt-settings ... && grim`.
- **Don't call `obj.disconnect(id)` on NM objects**: `NM.Device.disconnect()`
  is NetworkManager's "disconnect device" method. Use
  `GObject.signal_handler_disconnect(obj, id)`.
- GList properties (AstalNetwork `wifi.accessPoints`) can fail to convert in
  GJS ("Can't convert non-null pointer"); use the getter
  (`get_access_points()`).
- A `PreferencesPage` scrolls, so a dialog made of one has no natural height
  and collapses; short dialogs use `dialogBox()` (sizes to content). A
  `ScrolledWindow` with `propagateNaturalHeight` collapses too when rows have
  wrapping text (height-for-width); `scrollingBox()` is only for dialogs
  without it (Proxy).
- `Adw.ViewSwitcher` needs an icon per page; text tabs are
  `Gtk.StackSwitcher`.
- **Settings → Hyprland:** apply live with `hyprctl eval '<lua>'` and save to
  `~/.config/cobalt/settings/<name>.lua` (`lib/hypr.ts`); `hyprland.lua` loads
  those files (monitors, workspaces, input, binds) before personal overrides.
  Displays keeps its UI state in `monitors.json` next to it and asks GNOME's
  "Keep Display Settings?" with a 20 s revert.
- **Settings → GNOME keys → small daemons**: the app writes GNOME's keys and
  something in the session applies them: `cobalt-wallpaper` (background),
  `cobalt-idle` (hypridle config from idle-delay, lock, idle-dim, automatic
  suspend), `cobalt-power-button` + `cobalt-power-key.service` (logind
  inhibitor; Power Button Behavior), the shell (accent color, Night Light via
  hyprsunset IPC, Hot Edge via `enable-hot-corners`).
- GNOME sets some defaults only for its own desktop (`[org.gnome.mutter:GNOME]`
  in `00_org.gnome.shell.gschema.override`); our session isn't "GNOME", so
  set those in `zz1-cobalt.gschema.override` (e.g. dynamic workspaces).
- **Accent color:** `xdg-desktop-portal-gtk` doesn't expose `accent-color`, so
  `/etc/xdg-desktop-portal/hyprland-portals.conf` takes the Settings portal
  from `xdg-desktop-portal-gnome` (installed with GDM). Check with
  `gdbus call --session --dest org.freedesktop.portal.Desktop --object-path
  /org/freedesktop/portal/desktop --method
  org.freedesktop.portal.Settings.ReadOne org.freedesktop.appearance accent-color`.
  The shell gets it as `var(--cobalt-accent)` (`lib/accent.ts`).
- Sub-pages are pushed with `ctx.push(() => page)`: the builder runs in its own
  gnim root, disposed when the user goes back (building in a click handler
  otherwise logs "out of tracking context").
- A `Gtk.Picture`'s natural size is its texture's; thumbnails subclass it and
  override `vfunc_measure` (Appearance backgrounds).
- **Keyboard shortcuts:** binds made with `bind(id, keys, action, opts)` in
  `hyprland.lua` are editable. The config reads
  `~/.config/cobalt/settings/binds.lua` (written by Settings from
  `binds.json` next to it) before binding, keeps actions in the global
  `cobalt` registry, writes `$XDG_RUNTIME_DIR/cobalt/binds.json` for Settings,
  and `cobalt.rebind(id, keys|false)` / `cobalt.set_custom({...})` change
  binds live over `hyprctl eval`. Mouse binds, media keys and the two-bind
  Handy shortcut stay plain `hl.bind`. `Hyprland --verify-config` runs the
  Lua, so it also rewrites the registry JSON.
- The Set Shortcut dialog inhibits system shortcuts
  (`Gdk.Toplevel.inhibit_system_shortcuts`) so Hyprland doesn't act on the
  combo being captured.
- **Mouse/keyboard:** Settings writes GNOME's peripherals and input-sources
  keys and turns them into `settings/input.lua` (`lib/input.ts`).
- **Notifications:** the shell follows GNOME's keys (`lib/notifications.ts`):
  DND = `show-banners` off, per-app `org.gnome.desktop.notifications.application`
  at `/org/gnome/desktop/notifications/application/<canonical id>/` (id =
  desktop id, lowercase, non `[a-z0-9-]` → `-`); apps that notify are added
  to `application-children`.
- **Session services from GNOME:** `cobalt-session.target` pulls in
  `xdg-desktop-autostart.target` (it refuses manual starts), localsearch,
  evolution-alarm-notify, and gnome-settings-daemon plugins through
  `cobalt-gsd@<plugin>.service` (their own units are tied to gnome-session).
  `localsearch-3` needs `XDG_SESSION_CLASS` in systemd's environment.
- **Portals:** dialogs (file chooser, app chooser, access, account, print,
  wallpaper, lockdown) come from xdg-desktop-portal-gnome: GNOME's Files-based
  file chooser floats as a dialog when an app passes its window.
- Libadwaita titles (rows, groups) are markup: escape `&` (`lib/ui.ts` does
  it for `group()`/`navRow()`).
- **System pages:** hostname1, timedate1, locale1, AccountsService and
  systemd over D-Bus with `ALLOW_INTERACTIVE_AUTHORIZATION` (polkit prompts
  through the shell's polkit agent); passwords are hashed with `openssl passwd -6`.
  `cobalt-session` exports `LC_*` from GNOME's `region` key like
  gnome-session. `os-release` is branded cobalt in `build.sh` (ID stays
  fedora).
- Simulated Wi-Fi in the VM: `sudo modprobe mac80211_hwsim radios=3`, mark
  `wlan1`/`wlan2` unmanaged, run hostapd from an Alpine podman container
  (`--net=host --privileged --security-opt label=disable`). There's no DHCP,
  so give the client connection a manual IPv4 address. Connect from SSH with
  `sudo nmcli` (no polkit agent over SSH).

## Shell UI rules (learned the hard way)

- **Panel menus are layer-shell windows, not GTK popovers.** Popovers on a
  layer-shell bar size to their content and aren't kept on screen, so they
  widened and ran off the right edge. `widget/PanelMenu.tsx` anchors each
  menu under the bar with a fixed-width scroller.
- **Set `visible` last on `<window>`.** Props apply in order and a layer
  surface keeps the layer it was first mapped with; `visible` before `layer=`
  mapped it on TOP.
- **Layer-shell windows keep their first size.** A menu window that grew when
  an inline sub-menu opened got clipped instead. Menu windows therefore span
  the full height (panel at the top, a transparent click-to-close area below).
- **`hexpand` propagates to parents.** An expanding icon inside the menu
  header made its box take half the row. Don't set `hexpand` to center things;
  make the image itself the sized element (GTK centers icons in their size).
- **Round buttons need `valign={Gtk.Align.CENTER}`** (and equal min
  width/height); in a taller row they stretch vertically and hover becomes an
  oval.
- **A fully transparent layer surface is never mapped** (it doesn't show up
  in `hyprctl layers` at any size). Invisible strips like the Hot Edge need a
  sliver of alpha (`rgba(0,0,0,0.01)`).
- Window thumbnails: `grim -T <stableId>` captures one window (~40 ms);
  `stableId` comes from `hyprctl clients -j` (the window address doesn't work).
- Tray items' `id` is often generic (Tauri apps: `tray-icon tray app <pid>-1`)
  and `title` a lowercase name; match both against `.desktop` entries for the
  real app name (`widget/qs/background.tsx`). Inspect an item over D-Bus with
  `busctl --user get-property <service> <path> org.kde.StatusNotifierItem Id`.
- Pointer-driven features can be tested over SSH by warping the cursor:
  `hyprctl dispatch 'hl.dsp.cursor.move({ x = 640, y = 799 })'`.
- **Real mouse input (clicks, drags) can be injected through QEMU's monitor**,
  e.g. for launcher drag and drop: `virsh qemu-monitor-command silverblue43
  '{"execute":"input-send-event","arguments":{"events":[...]}}'` with `abs`
  x/y events (0–32767 across the 1920×1080 screen) and `btn` left
  down/up. Move in several steps while the button is down so GTK sees a drag.
  Run virsh through Boxes' Flatpak as in "Dev VM".
- **A layer window whose content is wider/taller than the monitor gets scaled
  down by Hyprland**, so everything looks squeezed. Gtk.Fixed counts children
  placed off-screen (the overview's neighbor cards), and fixed tile math must
  include CSS padding. Clip overflow with a `scrolledwindow` using
  `hscrollbarPolicy={Gtk.PolicyType.EXTERNAL}`. Check with
  `ags request -i cobalt overview debug`: the stack must be exactly the monitor
  width.
- **Each `<With>` needs its own container box** when it has siblings: a
  re-render re-appends its widget at the end (the strip jumped below the grid).
- Create JSX widgets during render, not inside `$=` callbacks or
  `.subscribe()` handlers ("out of tracking context: will not be able to
  cleanup" = they leak). Build them in the component body and only `put()` /
  `append()` them in the callback, or use `<With>`.
- Overview QA hooks: `ags request -i cobalt overview [apps | search <text> |
  folder <id> | debug]`.
- Only one menu is open at a time (`lib/menus.ts` state); a backdrop window
  covers the work area *below* the bar so outside clicks close the menu but
  bar buttons still work.

- **Overlay popups that take the keyboard** (`keymode EXCLUSIVE`): when one
  unmaps, Hyprland gives focus back to the window that had it, so focus
  another window only after the popup's `unmap` (Alt+Tab switcher).
- Key handlers on popups with buttons need
  `propagationPhase: Gtk.PropagationPhase.CAPTURE`, or Enter activates the
  focused button (Close) before the handler sees it.
- A layer window without anchors is exactly as big as its content, so a CSS
  `box-shadow` is clipped into a square; give the card a `margin`.
- libnotify's `notify-send --icon` sends an image, not the app icon; use
  `--app-icon` for the header icon and `--hint=string:image-path:<file>` for
  a picture. A notification with `--action` blocks until it's answered, so
  never leave one inside a unit whose state means something (the screencast
  unit hands it to its own transient unit).
- The "default" action is clicking the notification (GNOME); our cards don't
  show it as a button.
- QA hooks: `ags request -i cobalt session logout|restart|poweroff`,
  `switcher next|prev|app-window`, `screenshot`, `updates`.
  `wtype -M alt` only changes modifiers (no key release), so Alt+Tab's
  release path can't be tested over SSH; the quick-tap path can.
- **Screen sharing:** xdg-desktop-portal-hyprland only reads
  `$XDG_CONFIG_HOME/hypr/xdph.conf`, so its service gets
  `XDG_CONFIG_HOME=/usr/share/cobalt/xdph` (drop-in) for our picker. While a
  share runs, PipeWire has a Video/Source node `xdph-streaming-<n>`
  (AstalWp `video.sources`). Test the whole chain with a ScreenCast portal
  client (CreateSession → SelectSources → Start).
- `grim` can't capture the lock screen; hyprlock unlocks on `SIGUSR1`
  (`pkill -USR1 -x hyprlock`).
- To try scripts in the VM without a rebuild: `sudo bootc usr-overlay`
  (a writable /usr until reboot), then copy them over.

- **Agents (polkit, NetworkManager secrets) live in the shell**
  (`lib/polkit.ts`, `lib/secrets.ts`, one `PromptDialog`). GJS can't
  implement vfuncs that take a callback ("VFunc ... accepts another callback
  as a parameter. This is not supported"), so they export the D-Bus
  interfaces on the system bus with `Gio.DBusExportedObject` and register
  themselves. **Keep the exported object in a module variable**: a local one
  gets garbage-collected and the agent silently disappears after the first
  request. The polkit subject is `XDG_SESSION_ID` (the shell runs as a user
  service, outside the session scope); `PolkitAgent.Session` works fine.
- Test the agents: `pkexec true` started from the session (a script run
  with `hyprctl dispatch 'hl.dsp.exec_cmd("/tmp/x.sh")'`), a VPN with
  `password-flags=2`, and mac80211_hwsim with an NM hotspot on `wlan1` plus a
  `psk-flags=2` client connection on `wlan0` (no hostapd needed). Wait for
  the dialog's layer before typing with wtype, or the keys go to the focused
  window.
- Date menu events come from `gnome-shell-calendar-server` (D-Bus activated):
  call `SetTimeRange` with `force_reload` on a new connection, or nothing
  arrives. Seed events with ECal (`create_object_sync` on the builtin
  calendar).
- Flatpak GNOME apps (Clocks, Weather) have no dconf access; their settings
  are in `~/.var/app/<id>/config/glib-2.0/settings/keyfile`.
- **The VM blanks its display when idle** (hypridle, DPMS off) and `grim`
  then hangs waiting for a frame. Check `hyprctl monitors -j` (`dpmsStatus`),
  wake it with `hyprctl dispatch 'hl.dsp.dpms({ action = "on" })'`, and stop
  `hypridle` for long QA sessions.

## Visual QA (do this before handing UI to the user)

- Check the **desktop with app windows open** after any change to layer
  windows (`hyprctl layers` shows each namespace's level), and that every
  expected layer (`cobalt-bar`, `cobalt-hot-edge`, `hyprpaper`) is listed.
- In the VM, start test apps as `env LIBGL_ALWAYS_SOFTWARE=1 ghostty` (plain
  `ghostty` crashes on virgl) and `flatpak run org.gnome.TextEditor`.
- Capture **full screen** for every state, never just crops: each menu, each
  inline sub-menu (`toggle quick-settings <sub-menu>`), plus the closed bar.
  Combine with `magick montage` into a labeled contact sheet and check edges,
  alignment and clipping.
- Test long content: e.g. a null sink with a very long name
  (`pactl load-module module-null-sink sink_name=qa_long_sink
  "sink_properties=device.description=<long name>"`), then unload it.
- Hover/shape can't be triggered over SSH: temporarily paint elements with
  `ags request -i cobalt css "button.x { background-color: rgba(255,0,0,.6); }"`
  to see their real bounds, then restart the shell to clear it.
- Then zoom into details at full resolution (icon centering, spacing).

## Gotchas for agents

- `just vm-ssh` passes arguments intact; when building commands, keep the
  whole remote command in one quoted string. An earlier unquoted version let a
  `| sudo tee` run **on the host**. Never let VM commands reach the host shell.
- `pgrep -f`/`pkill -f '<pattern>'` match your own shell's command line if it
  contains the pattern (`pkill -f` over SSH killed its own session, even with
  the `[c]obalt` bracket trick). Kill by a recorded `$!`, or loop over
  `pgrep -x gjs` and check `/proc/<pid>/cmdline`. Use
  `pgrep -x`/`pkill -x` with exact process names (`gjs`, `cobalt-shell`).
- Never `rm -f $VAR/*`; use `"${VAR:?}"/*` so an empty variable can't expand
  to `/`.
- For long builds, run the build itself in the background (so completion is
  reported) instead of a polling loop.
