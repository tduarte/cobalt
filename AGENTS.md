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
| `Justfile` | Build recipes (template) + `[Dev VM]` recipes (ours) |
| `docs/BRIEF.md` | Product brief, decisions, milestones |

## Building the image

- `just build <name> <tag>` resolves `FEDORA_VERSION` from
  `base-main:latest` and `KERNEL_VERSION` from `akmods:ogc-<fedora>`, and pins
  the base and both kernel images to them. `FROM base-main:latest` alone would
  let them drift mid-build.
- **Caching:** each step mounts only its own stage (`kernel-step`,
  `mesa-step`, ...). Editing one script reruns that step and everything after
  it; editing `system_files/` only reruns the last steps (~30 s). Never go back
  to one shared context stage: any change would rebuild everything (~15 min).
- `repos.sh` sets `keepcache=1` so RPMs stay in the `/var/cache` cache mount
  between builds; `finalize.sh` resets it. Downloads are the slow part of a
  build (COPR/Terra mirrors are ~3–7 MB/s), not CPU.
- CI (`.github/workflows/build.yml`) builds, rechunks and signs
  `ghcr.io/tduarte/cobalt` on push and nightly. Rechunking drops the image
  labels (expected). Verify with
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
| Hyprland 0.57 + tools | COPR `pm4rcin/Hyprland` | Fedora 44 doesn't ship Hyprland; `solopasha/hyprland` is Rawhide-only now. |
| AGS + Astal | COPR `sinomor/astalRPM` | AGS is `aylurs-gtk-shell` (Fedora's `ags` is Adventure Game Studio). Terra's partial `astal*` is excluded. `libastal-notifd` lacks its gschema, so we ship `io.astal.notifd.gschema.xml` ourselves. AGS preloads unversioned `libgtk4-layer-shell.so` → needs `gtk4-layer-shell-devel`. |
| GDM | Fedora | Hard-depends on gnome-shell/gnome-session; `desktop.sh` deletes the GNOME and stock Hyprland session files so GDM only offers **Cobalt**. |

Add new COPRs to the loops in both `repos.sh` (enable) and `finalize.sh`
(disable), and to Terra's exclude list if Terra has a same-named package.

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

## Dev VM (GNOME Boxes)

The VM `silverblue43` runs cobalt (`10.0.2.2:5000/cobalt:dev` from the local
registry). Boxes is a Flatpak: run libvirt tools as
`flatpak run --command=virsh org.gnome.Boxes -c qemu:///session ...`
(write temp XML under `~/.cache`, since the sandbox has its own `/tmp`).

| Recipe | Does |
|---|---|
| `just vm-start` | Re-pins virgl to the RX 9070 and starts the VM. **Use this, not Boxes' play button.** |
| `just vm-stop` | Graceful shutdown |
| `just vm-ssh '<cmd>'` | SSH (127.0.0.1:2222, key `~/.ssh/cobalt-vm`); a quoted command runs entirely in the VM, pipes included |
| `just registry` | Starts the `cobalt-registry` podman container (127.0.0.1:5000) |
| `just vm-push` | `just build cobalt dev` + push to the local registry |
| `just vm-update` | `bootc switch`/`upgrade` in the VM, then power off and cold-start |
| `just shell-dev` | Copies `shell/` into the VM and runs it with `ags run` inside Hyprland (no image rebuild); log at `/tmp/cobalt-shell.log` in the VM |
| `just vm-screenshot <path>` | `grim` screenshot of the VM session to a local file |

Hard-won facts:

- **GPU:** virgl must render on the **RX 9070** (`pci-0000:03:00.0-render`).
  The 610M iGPU is far too slow at 4K, and if QEMU renders on one GPU while
  Boxes draws on the other, the display is garbled. **Boxes drops the
  `rendernode` pin whenever it starts the VM** (libvirt then picks
  `renderD129`, the iGPU), so always start with `just vm-start`.
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

## Shell UI rules (learned the hard way)

- **Panel menus are layer-shell windows, not GTK popovers.** Popovers on a
  layer-shell bar size to their content and aren't kept on screen, so they
  widened and ran off the right edge. `widget/PanelMenu.tsx` anchors each
  menu under the bar with a fixed-width scroller.
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
- Only one menu is open at a time (`lib/menus.ts` state); a backdrop window
  covers the work area *below* the bar so outside clicks close the menu but
  bar buttons still work.

## Visual QA (do this before handing UI to the user)

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
  contains the pattern (`pkill -f` over SSH killed its own session). Use
  `pgrep -x`/`pkill -x` with exact process names (`gjs`, `cobalt-shell`).
- Never `rm -f $VAR/*`; use `"${VAR:?}"/*` so an empty variable can't expand
  to `/`.
- For long builds, run the build itself in the background (so completion is
  reported) instead of a polling loop.
