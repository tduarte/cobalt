#!/bin/bash

set -ouex pipefail

# Copy the contents of system_files/ of the git repo to /
cp -avf "/ctx/system_files"/. /

### Install packages
# Gaming stack (kernel, Mesa, Steam, gamescope) and Hyprland get added here
# as separate scripts.
