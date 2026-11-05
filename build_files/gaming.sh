#!/bin/bash
# Steam, gamescope and the tuning Bazzite adds for games.

set -ouex pipefail

# sched_ext CPU schedulers; scx_loader stays disabled until chosen (as on Bazzite)
dnf5 -y install scx-scheds scx-tools

# Prioritise the focused app's GPU memory, and network/IO tuning for games.
# bpfrag stays disabled until chosen (optional on Bazzite too).
dnf5 -y install dmemcg-booster bpftune-gaming bpfrag
dnf5 -y swap --repo terra-extras uresourced uresourced-dmemcg

# Controller udev rules
dnf5 -y install game-devices-udev

# --exclude: the Bazzite COPR's mangohud would otherwise be pulled in as a
# dependency and conflict with terra-mangohud.
dnf5 --enable-repo=terra-mesa --enable-repo=terra --enable-repo=terra-extras -y install \
    --exclude=mangohud \
    terra-gamescope.x86_64 \
    terra-gamescope-libs.x86_64 \
    terra-gamescope-libs.i686 \
    terra-mangohud.x86_64 \
    terra-mangohud.i686 \
    vkBasalt.x86_64 \
    vkBasalt.i686 \
    libFAudio.x86_64 \
    libFAudio.i686 \
    umu-launcher \
    vulkan-tools \
    xdg-user-dirs \
    evtest

dnf5 -y --enable-repo=terra-mesa --enable-repo=terra --setopt=install_weak_deps=False install \
    --exclude=mangohud \
    steam

# extest makes Steam Input's keyboard and mouse work on Wayland. Terra's
# steam.desktop preloads only the 32-bit library, which 64-bit Steam can't load;
# cobalt-steam (system_files) preloads the right one for each. Terra only
# recommends extest, and weak dependencies are off above.
dnf5 -y install extest.x86_64 extest.i686
sed -i 's|^Exec=.*/usr/bin/steam|Exec=/usr/bin/cobalt-steam|' /usr/share/applications/steam.desktop
grep -q '^Exec=/usr/bin/cobalt-steam' /usr/share/applications/steam.desktop

# Bazzite drops gamemode in favour of its own tuning
dnf5 -y remove gamemode || true

# Better Bluetooth controller support (userspace HID)
sed -i 's/#UserspaceHID.*/UserspaceHID=true/' /etc/bluetooth/input.conf

systemctl enable dmemcg-booster-system.service
systemctl --global enable dmemcg-booster-user.service
systemctl disable scx_loader.service || true
systemctl disable bpfrag.service || true
