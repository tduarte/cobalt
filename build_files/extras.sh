#!/bin/bash
# Extra apps from docs/BRIEF.md "Extras", in their own step so changing them
# doesn't rebuild the desktop step.

set -ouex pipefail

# Handy: local speech-to-text (hold Alt+Space, bound in hyprland.lua). Pinned
# release RPM, checked against the SHA-256 GitHub publishes for the asset.
# wtype lets it type the transcription into the focused app on Wayland.
HANDY_VERSION=0.9.8
HANDY_SHA256=7038045edb560bb5497503541b1c43ce6b467b796169d20accd4e17210c60baf
HANDY_RPM="/tmp/Handy-${HANDY_VERSION}-1.x86_64.rpm"
curl -fsSL --retry 3 -o "$HANDY_RPM" \
    "https://github.com/cjpais/Handy/releases/download/v${HANDY_VERSION}/Handy-${HANDY_VERSION}-1.x86_64.rpm"
echo "${HANDY_SHA256}  ${HANDY_RPM}" | sha256sum -c -
dnf5 -y install "$HANDY_RPM" wtype
rpm -ql handy | grep -E "^/usr/bin/"
