#!/bin/sh
# Compress the exported room for the web: textures at most 2048, WebP,
# meshopt geometry. out/room_v2_raw.glb -> public/assets/room/room_v2.glb
set -e
cd "$(dirname "$0")/out"
G="npx -y @gltf-transform/cli@4"
$G resize room_v2_raw.glb t1.glb --width 2048 --height 2048
$G webp t1.glb t2.glb --quality 88
$G meshopt t2.glb ../../../public/assets/room/room_v2.glb
rm -f t1.glb t2.glb
