#!/bin/sh
# Guest-only boot preparation. This file belongs in a pinned, reviewed rootfs.
set -eu
mount -t ext4 -o rw,nosuid,nodev /dev/vdb /scratch
mkdir -p /run/forge-config
mount -t ext4 -o ro,nosuid,nodev,noexec /dev/vdc /run/forge-config
mkdir -p /scratch/source /scratch/build /scratch/home /scratch/tmp
chmod 0755 /scratch/source
chown 1000:1000 /scratch/build /scratch/home /scratch/tmp
chmod 0700 /scratch/build /scratch/home /scratch/tmp
# No NIC exists. This additionally rejects non-loopback IPv4/IPv6 if guest
# configuration changes; app units lack CAP_NET_ADMIN and AF_VSOCK.
/usr/sbin/nft -f /opt/forge/guest.nft
