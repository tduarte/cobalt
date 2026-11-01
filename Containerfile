## Fedora and kernel versions are resolved by `just build` from base-main:latest
## and the matching OGC kernel image, so a new Fedora release is picked up
## automatically. When building with plain `podman build`, FEDORA_VERSION falls
## back to 44 and the kernel to the newest ogc-<fedora> image.
ARG FEDORA_VERSION=44
ARG KERNEL_VERSION=""

# Bazzite's OGC kernel and kmods, prebuilt and signed by Universal Blue
FROM ghcr.io/ublue-os/akmods:ogc-${FEDORA_VERSION}${KERNEL_VERSION:+-${KERNEL_VERSION}} AS akmods
FROM ghcr.io/ublue-os/akmods-extra:ogc-${FEDORA_VERSION}${KERNEL_VERSION:+-${KERNEL_VERSION}} AS akmods-extra
FROM ghcr.io/ublue-os/brew:latest AS brew

# Build scripts and files are mounted into the steps that use them, never copied
# into the image. Each step gets its own stage holding only its script(s), so
# editing one script reruns that step and the ones after it, not every step.
FROM scratch AS kernel-step
COPY build_files/kernel.sh /

FROM scratch AS mesa-step
COPY build_files/repos.sh build_files/mesa.sh /

FROM scratch AS gaming-step
COPY build_files/gaming.sh /

FROM scratch AS dev-step
COPY build_files/dev.sh /

FROM scratch AS desktop-step
COPY build_files/desktop.sh /

FROM scratch AS shell-step
COPY build_files/shell.sh /
COPY shell /shell

FROM scratch AS files-step
COPY build_files/build.sh /
COPY system_files /system_files

FROM scratch AS finalize-step
COPY build_files/finalize.sh /

# Base Image
## Universal Blue's desktop-less base: Fedora Atomic + codecs + ublue tooling.
## Hyprland and Bazzite's gaming stack are layered on top in build_files/.
FROM ghcr.io/ublue-os/base-main:${FEDORA_VERSION}

### [IM]MUTABLE /opt
## Some bootable images, like Fedora, have /opt symlinked to /var/opt, in order to
## make it mutable/writable for users. However, some packages write files to this directory,
## thus its contents might be wiped out when bootc deploys an image, making it troublesome for
## some packages. Eg, google-chrome, docker-desktop.
##
## Uncomment the following line if one desires to make /opt immutable and be able to be used
## by the package manager.

# RUN rm /opt && mkdir /opt

### MODIFICATIONS
## Each step is its own RUN so local rebuilds reuse the cached layers.

COPY --from=brew /system_files/ /

RUN --mount=type=bind,from=kernel-step,source=/,target=/ctx \
    --mount=type=bind,from=akmods,src=/kernel-rpms,dst=/tmp/kernel-rpms \
    --mount=type=bind,from=akmods,src=/rpms/common,dst=/tmp/rpms/common \
    --mount=type=bind,from=akmods,src=/rpms/kmods,dst=/tmp/rpms/kmods \
    --mount=type=bind,from=akmods-extra,src=/rpms/extra,dst=/tmp/rpms/extra \
    --mount=type=bind,from=akmods-extra,src=/rpms/kmods,dst=/tmp/rpms/kmods-extra \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    /ctx/kernel.sh

RUN --mount=type=bind,from=mesa-step,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/repos.sh && /ctx/mesa.sh

RUN --mount=type=bind,from=gaming-step,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/gaming.sh

RUN --mount=type=bind,from=dev-step,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/dev.sh

RUN --mount=type=bind,from=desktop-step,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/desktop.sh

RUN --mount=type=bind,from=shell-step,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/shell.sh

## system_files/ last among the package steps, so config-only changes rebuild fast
RUN --mount=type=bind,from=files-step,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/build.sh

RUN --mount=type=bind,from=finalize-step,source=/,target=/ctx \
    --mount=type=cache,dst=/var/cache \
    --mount=type=cache,dst=/var/log \
    --mount=type=tmpfs,dst=/tmp \
    /ctx/finalize.sh

### LINTING
## Verify final image and contents are correct.
RUN bootc container lint
