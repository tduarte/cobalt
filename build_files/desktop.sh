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
    hyprland-guiutils \
    hyprsunset

# Shell toolkit: AGS (packaged as aylurs-gtk-shell; Fedora's "ags" is the
# unrelated Adventure Game Studio) and the Astal service libraries. dart-sass
# compiles the shell's SCSS when it's bundled. AGS preloads the unversioned
# libgtk4-layer-shell.so, which only the -devel package provides.
dnf5 -y install \
    aylurs-gtk-shell \
    dart-sass \
    gjs \
    gtk4-layer-shell-devel \
    libadwaita \
    libastal-4 \
    libastal-io \
    libastal-apps \
    libastal-battery \
    libastal-bluetooth \
    libastal-hyprland \
    libastal-mpris \
    libastal-network \
    libastal-notifd \
    libastal-powerprofiles \
    libastal-tray \
    libastal-wireplumber

# Login screen, files, portals and keyring
dnf5 -y install \
    gdm \
    nautilus \
    gvfs \
    xdg-desktop-portal-gtk \
    gnome-keyring

# Screenshots, clipboard, media keys, brightness (brightnessctl for laptop
# panels, ddcutil for external monitors over DDC/CI) and a temporary launcher (fuzzel is
# replaced by the AGS overview/launcher in M3/M4)
dnf5 -y install \
    grim \
    slurp \
    wl-clipboard \
    cliphist \
    brightnessctl \
    ddcutil \
    playerctl \
    fuzzel

# Adwaita look for GTK3/GTK4 apps and the shell
dnf5 -y install \
    adw-gtk3-theme \
    adwaita-icon-theme \
    adwaita-sans-fonts \
    adwaita-mono-fonts

# Icons: Adwair (WhiteSur/Adwaita blend, no RPM; pinned release, blue folders)
# and Bibata Modern Ice cursors (Terra)
ADWAIR_VERSION=1.0.0
curl -fsSL --retry 3 "https://github.com/kusaida/Adwair/archive/refs/tags/v${ADWAIR_VERSION}.tar.gz" \
    | tar -xz -C /tmp
bash "/tmp/Adwair-${ADWAIR_VERSION}/install.sh" --path /usr/share/icons
gtk-update-icon-cache -f /usr/share/icons/Adwair || true
dnf5 -y install bibata-cursor-theme

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
