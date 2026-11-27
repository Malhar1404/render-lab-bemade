#!/bin/sh
# Headless: bake the saved room (out/room.blend, or out/room_<mood>.blend),
# encode light maps and the probe, export and compress the viewer GLB.
# Stops at the first failure.
#   sh pipeline/room/run_bake.sh [samples] [mood]     mood: day (default) | evening
# On success it adds an entry to the dev log (devlog/add.mjs).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
# Windows paths for Blender (Git Bash's /m/... paths mean nothing to it).
HERE_W="$(cd "$HERE" && pwd -W)"
REPO_W="$(cd "$HERE/../.." && pwd -W)"
REPO="$(cd "$HERE/../.." && pwd)"
B=/c/Users/malha/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe
MOOD="${2:-day}"
if [ "$MOOD" = "day" ]; then S=""; GLB=room_v2.glb; else S="_$MOOD"; GLB="room_$MOOD.glb"; fi
mkdir -p "$HERE/out/bake$S"
rm -f "$HERE/out/bake$S/lm_"* "$HERE/out/bake$S/room_probe.hdr" "$HERE/out/bake$S.log" "$HERE/out/export$S.log"
"$B" -b -P "$HERE_W/bake_room.py" -- "$REPO_W" "${1:-512}" "" "mood=$MOOD"
tail -1 "$HERE/out/bake$S.log" | grep -q "OK" || { cat "$HERE/out/bake$S.log"; exit 1; }
python "$HERE/post_bake.py" "mood=$MOOD"
"$B" -b -P "$HERE_W/export_room.py" -- "$REPO_W" "mood=$MOOD"
tail -1 "$HERE/out/export$S.log" | grep -q "OK" || { cat "$HERE/out/export$S.log"; exit 1; }
sh "$HERE/optimize_room.sh" "$MOOD"
ls -la "$HERE/../../public/assets/room/$GLB"
# Dev log entry (only reached if every step above succeeded). A failure here
# must not fail the bake.
SAMPLES="${1:-512}"
# File it under the matching bake step on the dev log board, if that step exists.
case "$MOOD" in
  day) PARENT=2026-11-26-morning-bake-light-maps-probe-and-glb ;;
  evening) PARENT=2026-11-26-evening-mood-late-dusk-with-lamps-baked-and-wired ;;
  *) PARENT="" ;;
esac
PARENT_ARGS=""
[ -n "$PARENT" ] && [ -f "$REPO/devlog/entries/$PARENT.json" ] && PARENT_ARGS="--parent $PARENT"
(cd "$REPO" && node devlog/add.mjs --kind sub $PARENT_ARGS --title "Bake: $MOOD, $SAMPLES samples" --area pipeline --outcome worked --tags "bake,$MOOD"   --what "Baked the $MOOD room in Blender Cycles and published its light maps, probe and GLB ($GLB)."   --why "Automatic entry from run_bake.sh"   --how "pipeline/room/run_bake.sh ran bake_room.py ($SAMPLES samples), post_bake.py, export_room.py and optimize_room.sh with mood=$MOOD."   --image "pipeline/room/out/probe_${MOOD}_preview.jpg::Probe preview ($MOOD), tonemapped::render"   --meta "{\"samples\": $SAMPLES, \"mood\": \"$MOOD\"}") || echo "dev log entry failed (the bake itself is fine)"
