#!/bin/bash
# Replace Fedora's kernel with Bazzite's OGC kernel and the kmods Bazzite ships.
# Everything here comes prebuilt and signed by Universal Blue (Secure Boot rule:
# never build kernel code ourselves). Ported from Bazzite's install-kernel-akmods.

set -ouex pipefail

# Keep kernel-install from running dracut/rpm-ostree while we swap kernels;
# finalize.sh builds the initramfs once at the end.
pushd /usr/lib/kernel/install.d
mv 05-rpmostree.install 05-rpmostree.install.bak
mv 50-dracut.install 50-dracut.install.bak
printf '%s\n' '#!/bin/sh' 'exit 0' > 05-rpmostree.install
printf '%s\n' '#!/bin/sh' 'exit 0' > 50-dracut.install
chmod +x 05-rpmostree.install 50-dracut.install
popd

for pkg in kernel kernel{-core,-modules,-modules-core,-modules-extra,-tools-libs,-tools}; do
    rpm --erase "${pkg}" --nodeps || true
done
rm -rf /usr/lib/modules

dnf5 -y install \
    /tmp/kernel-rpms/kernel-[0-9]*.rpm \
    /tmp/kernel-rpms/kernel-core-*.rpm \
    /tmp/kernel-rpms/kernel-modules-*.rpm \
    /tmp/kernel-rpms/kernel-devel-*.rpm

dnf5 versionlock add kernel kernel-devel kernel-devel-matched kernel-core kernel-modules

# Install whichever of these kmods exist in the akmods images (names shift
# between releases, so missing ones are skipped rather than failing the build).
install_kmods() {
    local rpms=() pattern rpm
    for pattern in "$@"; do
        for rpm in $pattern; do
            [[ -f "$rpm" ]] && rpms+=("$rpm") || echo "SKIPPED: $rpm"
        done
    done
    if [[ ${#rpms[@]} -gt 0 ]]; then
        dnf5 -y install "${rpms[@]}"
    fi
}

# Only what this hardware uses. Bazzite ships more (Xbox dongle, racing wheels,
# Razer, Looking Glass, MSI sensors...); add them back here if needed.
# v4l2loopback: virtual webcam (OBS Virtual Camera)
install_kmods \
    /tmp/rpms/{common,kmods}/*v4l2loopback*.rpm

# zenergy: Zen CPU power readings for MangoHud and sensors
install_kmods \
    /tmp/rpms/{extra,kmods-extra}/*zenergy*.rpm

pushd /usr/lib/kernel/install.d
mv -f 05-rpmostree.install.bak 05-rpmostree.install
mv -f 50-dracut.install.bak 50-dracut.install
popd
