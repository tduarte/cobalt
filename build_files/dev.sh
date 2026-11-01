#!/bin/bash
# Dev and AI tooling that is layered on the current Bazzite install today.

set -ouex pipefail

# ghostty comes from its COPR (Terra's older build is excluded in repos.sh)
dnf5 -y install \
    ghostty \
    rocm-hip \
    rocm-runtime

# Homebrew files are copied from ghcr.io/ublue-os/brew in the Containerfile
systemctl enable brew-setup.service
systemctl --global enable podman.socket
