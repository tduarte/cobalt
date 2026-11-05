#!/bin/bash
# Disable third-party repos, build the initramfs for the OGC kernel, clean up.

set -ouex pipefail

dnf5 config-manager setopt keepcache=0 max_parallel_downloads=3

dnf5 -y config-manager setopt terra.enabled=0 terra-extras.enabled=0 terra-mesa.enabled=0
for copr in ublue-os/bazzite ublue-os/bazzite-multilib ublue-os/packages scottames/ghostty pm4rcin/Hyprland sinomor/astalRPM; do
    dnf5 -y copr disable "$copr"
done

# Works around a possible device settle regression at boot (as on Bazzite);
# dracut copies this into the initramfs.
sed -i 's/^DeviceTimeout=.*/DeviceTimeout=15/' /usr/share/plymouth/plymouthd.defaults

KERNEL="$(dnf5 repoquery --installed --queryformat='%{evr}.%{arch}' kernel)"
/usr/bin/dracut --no-hostonly --kver "$KERNEL" --reproducible --zstd -v \
    --add ostree --add fido2 -f "/usr/lib/modules/$KERNEL/initramfs.img"
chmod 0600 "/usr/lib/modules/$KERNEL/initramfs.img"

rm -rf /tmp/* /var/log/dnf5.log /boot/* /boot/.* 2>/dev/null || true

# rpm-ostree-base-db still holds the base image's package list. Hardlink it to
# the real database (no symlinks: rpm-ostree needs a hardlink) so it reflects
# this image and updates don't carry two copies. Must run after every RPM
# transaction. See https://github.com/coreos/rpm-ostree/issues/4554
for file in rpmdb.sqlite rpmdb.sqlite-shm rpmdb.sqlite-wal; do
    target="/usr/share/rpm/${file}"
    link_path="/usr/lib/sysimage/rpm-ostree-base-db/${file}"
    if [[ -f "${target}" && -f "${link_path}" ]]; then
        ln -f "${target}" "${link_path}"
    fi
done
