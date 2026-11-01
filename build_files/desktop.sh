#!/bin/bash
# M2 desktop: Hyprland session behind GDM, portals, Nautilus, and the small
# tools the default config binds to. Config files live in system_files/.

set -ouex pipefail

# Hyprland and its tools (pm4rcin/Hyprland, enabled in repos.sh)
dnf5 -y install \
    hyprland \
    xdg-desktop-portal-hyprland \
    hyprlock \
    hypridle \
    hyprpolkitagent \
    hyprland-guiutils

# Login screen, files, portals and keyring
dnf5 -y install \
    gdm \
    nautilus \
    gvfs \
    xdg-desktop-portal-gtk \
    gnome-keyring

# Screenshots, clipboard, media keys and a temporary launcher (fuzzel is
# replaced by the AGS overview/launcher in M3/M4)
dnf5 -y install \
    grim \
    slurp \
    wl-clipboard \
    cliphist \
    brightnessctl \
    playerctl \
    fuzzel

# Adwaita look for GTK3/GTK4 apps and the shell
dnf5 -y install \
    adw-gtk3-theme \
    adwaita-icon-theme \
    adwaita-sans-fonts \
    adwaita-mono-fonts

# GDM needs gnome-shell and gnome-session for its greeter, which also brings
# a GNOME session entry; only offer cobalt.desktop (system_files) at login.
rm -f \
    /usr/share/wayland-sessions/gnome.desktop \
    /usr/share/wayland-sessions/gnome-wayland.desktop \
    /usr/share/wayland-sessions/hyprland.desktop \
    /usr/share/wayland-sessions/hyprland-uwsm.desktop \
    /usr/share/xsessions/gnome*.desktop

systemctl enable gdm.service
systemctl set-default graphical.target
