#!/bin/bash
# Enable the repos the gaming stack and desktop come from, with the same
# priorities and excludes Bazzite uses so Terra's Mesa/Steam win over Fedora and
# negativo17. Hyprland comes from pm4rcin/Hyprland (the maintained fork of
# solopasha/hyprland); AGS and the Astal libraries from sinomor/astalRPM
# (Terra only has a partial Astal). finalize.sh disables the third-party ones again.

set -ouex pipefail

# Keep downloaded RPMs in the /var/cache build-cache mount so rebuilds reuse
# them instead of downloading again (finalize.sh turns this back off).
dnf5 config-manager setopt keepcache=1 max_parallel_downloads=10

for copr in ublue-os/bazzite ublue-os/bazzite-multilib ublue-os/packages scottames/ghostty pm4rcin/Hyprland sinomor/astalRPM; do
    dnf5 -y copr enable "$copr"
    dnf5 -y config-manager setopt "copr:copr.fedorainfracloud.org:${copr////:}.priority=98"
done
dnf5 -y config-manager setopt "*bazzite*".priority=2

dnf5 -y install --nogpgcheck \
    --repofrompath 'terra,https://repos.fyralabs.com/terra$releasever' \
    terra-release{,-extras,-mesa}
dnf5 -y config-manager setopt "*terra*".priority=1 \
    "*terra*".exclude="nerd-fonts ghostty* hypr* aquamarine* astal* ags"
dnf5 -y config-manager setopt "terra-mesa".enabled=false

# negativo17 (repo id fedora-multimedia) is disabled in base-main but its Mesa
# is installed; keep it from ever pulling Mesa back in if enabled.
dnf5 -y config-manager setopt fedora-multimedia.priority=4 \
    fedora-multimedia.exclude="mesa-* *xone*"
dnf5 -y config-manager setopt "*fedora*".exclude="mesa-* kernel-core-* kernel-modules-* kernel-uki-virt-* steam noopenh264"
dnf5 -y config-manager setopt "updates*".exclude="mesa-* kernel-core-* kernel-modules-* kernel-uki-virt-* steam noopenh264"
