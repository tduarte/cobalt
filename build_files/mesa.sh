#!/bin/bash
# Valve-patched Mesa and WirePlumber from Terra, as Bazzite ships them.
# Xwayland stays Fedora's: Hyprland requires xorg-x11-server-Xwayland(x86-64),
# which terra-xorg-x11-server-Xwayland doesn't provide, and Bazzite's Xwayland
# patches target the gamescope Gaming Mode session we don't use.

set -ouex pipefail

dnf5 -y remove mesa-va-drivers || true

# Fedora/negativo17 Mesa is excluded in repos.sh, so this syncs every installed
# Mesa package to terra-mesa (a downgrade when negativo17 is ahead).
dnf5 -y --enable-repo=terra-mesa distro-sync --allowerasing 'mesa-*'

dnf5 -y swap --allowerasing --repo terra-extras \
    wireplumber terra-wireplumber

dnf5 versionlock add \
    mesa-dri-drivers \
    mesa-filesystem \
    mesa-libEGL \
    mesa-libGL \
    mesa-libgbm \
    mesa-vulkan-drivers

# 32-bit GL for Steam and older games
dnf5 -y --enable-repo=terra-mesa install mesa-libEGL.i686
