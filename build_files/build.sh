#!/bin/bash
# Copy the repo's system_files/ into the image (configs, scripts, session).
# Packages are installed by the other scripts in build_files/.

set -ouex pipefail

# Copy the repo's system_files/ (mounted at /sysfiles) to /
cp -avf /sysfiles/. /
rm -f /etc/.gitkeep /usr/.gitkeep

# Apply the GNOME settings defaults in zz1-cobalt.gschema.override
glib-compile-schemas /usr/share/glib-2.0/schemas
