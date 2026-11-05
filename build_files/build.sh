#!/bin/bash
# Copy the repo's system_files/ into the image (configs, scripts, session).
# Packages are installed by the other scripts in build_files/.

set -ouex pipefail

# Copy the repo's system_files/ (mounted at /ctx/system_files) to /
cp -avf /ctx/system_files/. /
rm -f /etc/.gitkeep /usr/.gitkeep

# Apply the GNOME settings defaults in zz1-cobalt.gschema.override
glib-compile-schemas /usr/share/glib-2.0/schemas

# Our own icons (e.g. cobalt-caffeine-symbolic) in hicolor
gtk-update-icon-cache -f /usr/share/icons/hicolor

# Brand the OS as cobalt (About in Settings, boot menu entries). ID stays
# fedora so dnf, toolbox and friends keep working.
VERSION_ID="$(. /usr/lib/os-release && echo "$VERSION_ID")"
sed -i \
    -e 's/^NAME=.*/NAME="cobalt"/' \
    -e "s/^PRETTY_NAME=.*/PRETTY_NAME=\"cobalt (Fedora Linux ${VERSION_ID})\"/" \
    -e 's|^HOME_URL=.*|HOME_URL="https://github.com/tduarte/cobalt"|' \
    /usr/lib/os-release
grep -q '^VARIANT_ID=' /usr/lib/os-release && sed -i 's/^VARIANT_ID=.*/VARIANT_ID=cobalt/' /usr/lib/os-release \
    || echo 'VARIANT_ID=cobalt' >> /usr/lib/os-release

# Flathub apps from /usr/share/cobalt/flatpaks.list, installed at boot
systemctl enable cobalt-flatpaks.service

# SSH agent for the session (gcr-ssh-agent; cobalt-session sets SSH_AUTH_SOCK
# to its socket)
systemctl --global enable gcr-ssh-agent.socket
