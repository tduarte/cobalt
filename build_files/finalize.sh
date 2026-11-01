#!/bin/bash
# Disable third-party repos, build the initramfs for the OGC kernel, clean up.

set -ouex pipefail

for repo in terra terra-extras terra-mesa; do
    [[ -f /etc/yum.repos.d/$repo.repo ]] && sed -i 's@enabled=1@enabled=0@g' "/etc/yum.repos.d/$repo.repo"
done
for copr in ublue-os/bazzite ublue-os/bazzite-multilib ublue-os/packages scottames/ghostty; do
    dnf5 -y copr disable "$copr"
done

KERNEL="$(dnf5 repoquery --installed --queryformat='%{evr}.%{arch}' kernel)"
/usr/bin/dracut --no-hostonly --kver "$KERNEL" --reproducible --zstd -v \
    --add ostree --add fido2 -f "/usr/lib/modules/$KERNEL/initramfs.img"
chmod 0600 "/usr/lib/modules/$KERNEL/initramfs.img"

rm -rf /tmp/* /var/log/dnf5.log /boot/* /boot/.* 2>/dev/null || true
