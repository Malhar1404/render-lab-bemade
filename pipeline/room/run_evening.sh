#!/bin/sh
# Headless: build the evening room (late dusk, lamps on), then bake, encode,
# export and compress it (run_bake.sh). Day files are not touched.
#   sh pipeline/room/run_evening.sh [samples]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
HERE_W="$(cd "$HERE" && pwd -W)"
REPO_W="$(cd "$HERE/../.." && pwd -W)"
B=/c/Users/malha/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe
echo "build $(date +%T)"
"$B" -b --factory-startup -P "$HERE_W/build_room.py" -- "$REPO_W" mood=evening
cat "$HERE/out/build_evening.log"
tail -1 "$HERE/out/build_evening.log" | grep -q "OK" || exit 1
echo "bake $(date +%T)"
sh "$HERE/run_bake.sh" "${1:-1024}" evening
echo "done $(date +%T)"
