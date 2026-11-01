#!/bin/bash
# Valve-patched Mesa, Xwayland and WirePlumber from Terra, as Bazzite ships them.

set -ouex pipefail

dnf5 -y remove mesa-va-drivers || true

# Fedora/negativo17 Mesa is excluded in repos.sh, so this syncs every installed
# Mesa package to terra-mesa (a downgrade when negativo17 is ahead).
dnf5 -y --enable-repo=terra-mesa distro-sync --allowerasing 'mesa-*'

dnf5 -y swap --allowerasing --repo terra-extras \
    xorg-x11-server-Xwayland terra-xorg-x11-server-Xwayland
dnf5 -y swap --allowerasing --repo terra-extras \
    wireplumber terra-wireplumber

dnf5 versionlock add \
    terra-xorg-x11-server-Xwayland \
    mesa-dri-drivers \
    mesa-filesystem \
    mesa-libEGL \
    mesa-libGL \
    mesa-libgbm \
    mesa-vulkan-drivers

# 32-bit GL for Steam and older games
dnf5 -y --enable-repo=terra-mesa install mesa-libEGL.i686
