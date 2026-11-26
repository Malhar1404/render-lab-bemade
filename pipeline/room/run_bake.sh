#!/bin/sh
# Headless: bake the saved room (out/room.blend), encode light maps and the
# probe, export and compress the viewer GLB. Stops at the first failure.
#   sh pipeline/room/run_bake.sh [samples]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
# Windows paths for Blender (Git Bash's /m/... paths mean nothing to it).
HERE_W="$(cd "$HERE" && pwd -W)"
REPO_W="$(cd "$HERE/../.." && pwd -W)"
B=/c/Users/malha/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe
rm -f "$HERE/out/bake/lm_"* "$HERE/out/bake/room_probe.hdr" "$HERE/out/bake.log" "$HERE/out/export.log"
"$B" -b -P "$HERE_W/bake_room.py" -- "$REPO_W" "${1:-512}"
tail -1 "$HERE/out/bake.log" | grep -q "OK" || { cat "$HERE/out/bake.log"; exit 1; }
python "$HERE/post_bake.py"
"$B" -b -P "$HERE_W/export_room.py" -- "$REPO_W"
tail -1 "$HERE/out/export.log" | grep -q "OK" || { cat "$HERE/out/export.log"; exit 1; }
sh "$HERE/optimize_room.sh"
ls -la "$REPO_W/public/assets/room/room_v2.glb"
