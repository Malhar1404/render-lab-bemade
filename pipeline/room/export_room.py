"""Export the baked room for the viewer.

blender -b -P pipeline/room/export_room.py -- <repo>

Opens out/room_baked.blend (bake_room.py) and puts each group's light map
(out/bake/lm_<group>.jpg, from post_bake.py) in its materials' emissive slot
on the "lightmap" UV layer: glTF has no light map slot, and Room.tsx reads it
from there. Writes out/room_v2_raw.glb; optimize_room.sh compresses it into
public/assets/room/room_v2.glb.
"""
import os
import sys
import traceback

import bpy

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REPO = ARGS[0]
# This folder; the repo root is two levels up (pipeline/room).
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
BAKE = os.path.join(OUT, "bake")
LOG = os.path.join(OUT, "export.log")
_log = []


def log(*a):
    _log.append(" ".join(str(x) for x in a))


def wire_lightmap(mat, image):
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "lightmap"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, "room_baked.blend"))
    images = {}
    done = set()
    for o in bpy.data.objects:
        if o.type != "MESH" or "lightmap" not in o.data.uv_layers:
            continue
        group = o.name[len("room_"):] if o.name.startswith("room_") else "rug"
        path = os.path.join(BAKE, f"lm_{group}.jpg")
        if not os.path.exists(path):
            log("no light map for", o.name)
            continue
        if group not in images:
            images[group] = bpy.data.images.load(path)
        for slot in o.material_slots:
            m = slot.material
            if m and m.name not in done:
                wire_lightmap(m, images[group])
                done.add(m.name)
        log("light map", group, "->", o.name)

    # The viewer draws the baked room unlit (Room.tsx): normal and roughness
    # maps would only add download. (The path tracer will want them.)
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        for name in ("Normal", "Roughness"):
            for link in list(bsdf.inputs[name].links):
                m.node_tree.links.remove(link)

    room = bpy.data.collections["Room"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in room.all_objects:
        o.select_set(True)
    path = os.path.join(OUT, "room_v2_raw.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    log("exported", path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    try:
        main()
        log("OK")
    except Exception:
        log(traceback.format_exc())
    finally:
        with open(LOG, "w") as f:
            f.write("\n".join(_log))
