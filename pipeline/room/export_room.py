"""Export the baked room for the viewer.

blender -b -P pipeline/room/export_room.py -- <repo> [mood=evening]

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
# mood=day|evening anywhere in the arguments picks the lighting and the
# output names (day keeps the original names).
MOOD = next((a.split("=", 1)[1] for a in ARGS if a.startswith("mood=")), "day")
ARGS = [a for a in ARGS if not a.startswith("mood=")]
SUFFIX = "" if MOOD == "day" else f"_{MOOD}"
REPO = ARGS[0]
# This folder; the repo root is two levels up (pipeline/room).
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
BAKE = os.path.join(OUT, f"bake{SUFFIX}")
LOG = os.path.join(OUT, f"export{SUFFIX}.log")
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


# The plant's light is baked into its points (bake_room.py POINT_GROUPS),
# held as light / LIGHT_SCALE like the light maps (post_bake.py), so Room.tsx
# scales both the same way. glTF vertex colours stop at 1.
LIGHT_SCALE = {"day": 4.0, "evening": 2.0}[MOOD]
POINT_GROUPS = {"plants"}
POINT_ATTR = "baked_light"


def wire_point_light(o, group):
    import numpy as np
    path = os.path.join(BAKE, f"lm_{group}_points.npy")
    me = o.data
    attr = me.color_attributes.get(POINT_ATTR)
    if attr is None or not os.path.exists(path):
        log("no point light for", o.name)
        return
    data = np.load(path).reshape(-1, 4)
    data[:, :3] = np.clip(data[:, :3] / LIGHT_SCALE, 0.0, 1.0)
    data[:, 3] = 1.0
    attr.data.foreach_set("color", data.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    log("point light", group, "->", o.name, len(attr.data), "corners")


# Colour textures: 1024 is plenty for most of the room; the floor and rug are
# big and seen up close, so they keep 2048 (2026-11-26). Light maps keep
# their baked size (bake_room.py GROUPS).
COLOUR_MAX = 1024
COLOUR_MAX_BIG = 2048
BIG_TEXTURES = ("floor_oak", "rug_")


def shrink_colour_textures(light_maps):
    for im in bpy.data.images:
        if im in light_maps or im.size[0] == 0:
            continue
        cap = COLOUR_MAX_BIG if im.name.startswith(BIG_TEXTURES) else COLOUR_MAX
        w, h = im.size
        if max(w, h) > cap:
            k = cap / max(w, h)
            im.scale(max(1, round(w * k)), max(1, round(h * k)))
            log("texture", im.name, (w, h), "->", tuple(im.size))


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, f"room{SUFFIX}_baked.blend"))
    images = {}
    done = set()
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name.startswith("room_") and o.name[len("room_"):] in POINT_GROUPS:
            wire_point_light(o, o.name[len("room_"):])
            continue
        if o.type != "MESH" or "lightmap" not in o.data.uv_layers:
            continue
        group = o.name[len("room_"):] if o.name.startswith("room_") else "rug"
        # Day: RGBM PNG (post_bake.py); evening: still the old JPEG.
        path = os.path.join(BAKE, f"lm_{group}.png" if MOOD == "day" else f"lm_{group}.jpg")
        if not os.path.exists(path):
            log("no light map for", o.name)
            continue
        if group not in images:
            images[group] = bpy.data.images.load(path)
            # Encoded light, not a colour: no colour conversion on the way.
            images[group].colorspace_settings.name = "Non-Color"
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

    shrink_colour_textures(set(images.values()))

    room = bpy.data.collections["Room"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in room.all_objects:
        o.select_set(True)
    path = os.path.join(OUT, "room_v2_raw.glb" if MOOD == "day" else f"room{SUFFIX}_raw.glb")
    options = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    # Vertex colours (the plant's baked light): the option's name changed
    # across Blender versions.
    try:
        bpy.ops.export_scene.gltf(**options, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**options, export_colors=True)
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
