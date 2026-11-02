#!/bin/bash
# Bundle the AGS shell (repo's shell/, mounted at /ctx/shell) into
# /usr/bin/cobalt-shell, and the Settings app into /usr/bin/cobalt-settings. The SCSS is compiled into the bundle, so only gjs and
# the Astal libraries are needed at runtime.

set -ouex pipefail

# ags writes next to the sources while bundling; the mount is read-only
cp -a /ctx/shell /tmp/shell
cd /tmp/shell
ags bundle app.tsx /usr/bin/cobalt-shell
chmod 0755 /usr/bin/cobalt-shell

# The Settings app (repo's settings/), a libadwaita app built the same way
cp -a /ctx/settings /tmp/settings
cd /tmp/settings
ags bundle --gtk 4 app.ts /usr/bin/cobalt-settings
chmod 0755 /usr/bin/cobalt-settings
