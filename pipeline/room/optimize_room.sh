#!/bin/sh
# Compress the exported room for the web: WebP textures, meshopt geometry.
#   sh optimize_room.sh            out/room_v2_raw.glb      -> public/assets/room/room_v2.glb
#   sh optimize_room.sh evening    out/room_evening_raw.glb -> public/assets/room/room_evening.glb
set -e
cd "$(dirname "$0")/out"
MOOD="${1:-day}"
if [ "$MOOD" = "day" ]; then IN=room_v2_raw.glb; NAME=room_v2.glb
else IN="room_${MOOD}_raw.glb"; NAME="room_${MOOD}.glb"; fi
G="npx -y @gltf-transform/cli@4"
if [ "$MOOD" = "day" ]; then
  # Day (2026-11-27): export_room.py already sized the colour textures, and
  # the light maps keep their baked size (the floor's is 4096). Colour
  # textures: lossy WebP; light maps (RGBM, in the emissive slot): lossless,
  # since lossy blocks show up as blotches in smooth light. The plant's
  # baked light is a vertex colour: keep 16 bits of it.
  $G webp "$IN" t1.glb --slots "baseColorTexture" --quality 90
  $G webp t1.glb t2.glb --slots "emissiveTexture" --lossless true
  $G meshopt t2.glb "../../../public/assets/room/$NAME" --quantize-color 16
else
  $G resize "$IN" t1.glb --width 2048 --height 2048
  $G webp t1.glb t2.glb --quality 88
  $G meshopt t2.glb "../../../public/assets/room/$NAME"
fi
rm -f t1.glb t2.glb
