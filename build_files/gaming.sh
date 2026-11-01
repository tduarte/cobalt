#!/bin/bash
# Steam, gamescope and the tuning Bazzite adds for games.

set -ouex pipefail

# sched_ext CPU schedulers; scx_loader stays disabled until chosen (as on Bazzite)
dnf5 -y copr enable bieszczaders/kernel-cachyos-addons
dnf5 -y install scx-scheds scx-tools
dnf5 -y copr disable bieszczaders/kernel-cachyos-addons

# Prioritise the focused app's GPU memory, and network/IO tuning for games
dnf5 -y install dmemcg-booster bpftune-gaming
dnf5 -y swap --repo terra-extras uresourced uresourced-dmemcg

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

# Bazzite drops gamemode in favour of its own tuning
dnf5 -y remove gamemode || true

# Better Bluetooth controller support (userspace HID)
sed -i 's/#UserspaceHID.*/UserspaceHID=true/' /etc/bluetooth/input.conf

systemctl enable dmemcg-booster-system.service
systemctl --global enable dmemcg-booster-user.service
systemctl disable scx_loader.service || true
