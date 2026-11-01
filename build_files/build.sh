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
