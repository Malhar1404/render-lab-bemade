"""Bake the room's light into light maps, and render its reflection probe.

blender -b -P pipeline/room/bake_room.py -- <repo> [samples] [only] [mood=evening]

Opens out/room.blend (from build_room.py), joins the room's parts into bake
groups, gives each a second UV layer ("lightmap"), and bakes its diffuse
light (direct + indirect, no surface colour) with the room's morning light
to out/bake/lm_<group>.exr. The table and chairs are not in the file, so
no furniture shadows are baked: the viewer draws those live.

Each group's materials are copied as <group>_<material>, so every material
has one light map. Also renders a 360 panorama from the table to
out/bake/room_probe.hdr (the room's reflections in the viewer).

Saves out/room_baked.blend for export_room.py. `only` = comma list of
groups to rebake (the others are skipped). mood=evening reads
out/room_evening.blend and writes out/bake_evening/ and
out/room_evening_baked.blend.
"""
import math
import os
import sys
import traceback

import bmesh
import bpy

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
# mood=day|evening anywhere in the arguments picks the lighting and the
# output names (day keeps the original names).
MOOD = next((a.split("=", 1)[1] for a in ARGS if a.startswith("mood=")), "day")
ARGS = [a for a in ARGS if not a.startswith("mood=")]
SUFFIX = "" if MOOD == "day" else f"_{MOOD}"
REPO = ARGS[0]
SAMPLES = int(ARGS[1]) if len(ARGS) > 1 else 256
ONLY = set(ARGS[2].split(",")) if len(ARGS) > 2 and ARGS[2] else None
# This folder; the repo root is two levels up (pipeline/room).
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
BAKE = os.path.join(OUT, f"bake{SUFFIX}")
LOG = os.path.join(OUT, f"bake{SUFFIX}.log")
_log = []


def log(*a):
    _log.append(" ".join(str(x) for x in a))
    with open(LOG, "w") as f:
        f.write("\n".join(_log))


def starts(*prefixes, exclude=()):
    return lambda n: n.startswith(prefixes) and not n.startswith(exclude)


# group: (object-name test, light map size)
GROUPS = {
    # Sizes by how big each part is and how sharp its light is (2026-11-26):
    # sun stripes need pixels, soft bounce light does not.
    "floor": (lambda n: n == "floor", 4096),
    "rug": (lambda n: n == "rug", 2048),
    "wall_window": (starts("wall_window", "reveal_", "skirting_window", "curtain_track"), 2048),
    "wall_right": (starts("wall_right", "skirting_right"), 2048),
    "wall_left": (starts("wall_left", "skirting_left"), 1024),
    "wall_front": (starts("wall_front", "skirting_front"), 1024),
    "ceiling": (lambda n: n == "ceiling", 1024),
    "curtains": (starts("curtain_", exclude=("curtain_track",)), 1024),
    "credenza": (starts("credenza_", "decor_"), 1024),
    "plants": (starts("potted_plant_01"), 1024),
    "fig": (starts("fig_"), 1024),
    "art": (starts("art_"), 512),
    "door": (starts("door_"), 512),
    "painting": (starts("painting_"), 512),
    "window": (starts("frame_"), 512),
    "terrace": (lambda n: n == "terrace", 512),
    "lamp": (starts("lamp_"), 256),
    "sconces": (starts("sconce_"), 256),
}


RUG_BOUNDS = {}

# Groups whose light goes into the mesh's points (a colour attribute per face
# corner), not a light-map image (2026-11-27). The potted plant is 176,000
# small leaf faces: packed into one image each leaf got a few pixels (1% of
# the map used), which read as crayon blobs. Its points are dense enough to
# carry the light themselves. Saved to lm_<group>_points.npy, since every run
# rebuilds the groups from room.blend.
POINT_GROUPS = {"plants"}
POINT_ATTR = "baked_light"


def point_light_path(group):
    return os.path.join(BAKE, f"lm_{group}_points.npy")


def add_point_light(obj):
    me = obj.data
    attr = me.color_attributes.get(POINT_ATTR) or me.color_attributes.new(POINT_ATTR, "FLOAT_COLOR", "CORNER")
    me.color_attributes.active_color = attr
    return attr


def bake_points(group, obj):
    import numpy as np
    attr = add_point_light(obj)
    select_only([obj], obj)
    sc = bpy.context.scene
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    bpy.ops.object.bake(type="DIFFUSE", target="VERTEX_COLORS")
    data = np.empty(len(attr.data) * 4, dtype=np.float32)
    attr.data.foreach_get("color", data)
    np.save(point_light_path(group), data)
    log("baked points", group, len(attr.data), "corners, mean", float(data.reshape(-1, 4)[:, :3].mean()))


def restore_points(group, obj):
    """Put a previous run's baked point light back (for export)."""
    import numpy as np
    path = point_light_path(group)
    if not os.path.exists(path):
        return
    attr = add_point_light(obj)
    data = np.load(path)
    if len(data) != len(attr.data) * 4:
        log("point light size mismatch", group, len(data), len(attr.data) * 4)
        return
    attr.data.foreach_set("color", data)
    log("restored points", group)


def planar_uv(me, lm, verts, matrix):
    """Light map UVs straight down over the rug's area (the rug, its fuzz
    layers and fringe all share the rug's light map)."""
    x0, x1, y0, y1 = RUG_BOUNDS["xy"]
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = verts[me.loops[li].vertex_index].co
            if matrix is not None:
                co = matrix @ co
            lm.data[li].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))


def setup_cycles():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = "GPU"
                log("device", kind)
                break
        except Exception:
            continue
    sc.cycles.samples = SAMPLES
    # Every pixel gets all the samples: adaptive sampling stopped early on
    # dim faces, so raising SAMPLES did not reduce their noise (2026-11-27).
    sc.cycles.use_adaptive_sampling = False
    log("samples", SAMPLES, "adaptive", sc.cycles.use_adaptive_sampling)
    sc.cycles.max_bounces = 8
    sc.cycles.sample_clamp_indirect = 10
    sc.cycles.caustics_refractive = False
    sc.cycles.caustics_reflective = False


def select_only(objs, active):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def join_group(name, objs):
    """Unparent, apply modifiers and transforms, join into one mesh."""
    for o in objs:
        o.hide_set(False)
    select_only(objs, objs[0])
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = f"room_{name}"
    return obj


def own_materials(group, obj):
    """Copy each material as <group>_<name>: one light map per material."""
    for slot in obj.material_slots:
        m = slot.material
        if m is None:
            continue
        copy = m.copy()
        copy.name = f"{group}_{m.name}"
        slot.material = copy


def add_lightmap_uv(group, obj):
    me = obj.data
    if "lightmap" not in me.uv_layers:
        me.uv_layers.new(name="lightmap")
    lm = me.uv_layers["lightmap"]
    me.uv_layers.active = lm
    # Colour textures keep using the first layer.
    me.uv_layers[0].active_render = True
    if group == "rug":
        # Planar over the top, matching the fuzz layers (export_room.py);
        # the bottom is never seen and would overlap the top, so it goes.
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.5], context="FACES")
        bm.to_mesh(me)
        bm.free()
        lm = me.uv_layers["lightmap"]
        planar_uv(me, lm, me.vertices, None)
        return
    select_only([obj], obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0,
                             scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    # Packing keeps islands square-scaled, so a long wall fills half its
    # map. Light maps may stretch: fill the whole map on both axes.
    lm = me.uv_layers["lightmap"]
    us = [d.uv.x for d in lm.data]
    vs = [d.uv.y for d in lm.data]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    m = 0.004
    for d in lm.data:
        d.uv = (m + (d.uv.x - u0) / (u1 - u0) * (1 - 2 * m), m + (d.uv.y - v0) / (v1 - v0) * (1 - 2 * m))


def bake_group(group, obj, size):
    img = bpy.data.images.new(f"lm_{group}", size, size, float_buffer=True)
    for slot in obj.material_slots:
        m = slot.material
        nt = m.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.name = "bake_target"
        node.image = img
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node
    select_only([obj], obj)
    sc = bpy.context.scene
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    sc.render.bake.margin = 16
    bpy.ops.object.bake(type="DIFFUSE")
    img.filepath_raw = os.path.join(BAKE, f"lm_{group}.exr")
    img.file_format = "OPEN_EXR"
    img.save()
    # Leave the target node out of the material graph for export.
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get("bake_target")
        if n:
            nt.nodes.remove(n)


def render_probe():
    """360 panorama from the table (eye height over the top): the room's
    reflections. The camera's rotation matches the world's equirect layout,
    which is also three.js's."""
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("probe")
    cam_data.type = "PANO"
    try:
        cam_data.panorama_type = "EQUIRECTANGULAR"
    except Exception:
        cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("probe", cam_data)
    sc.collection.objects.link(cam)
    # Just above the top, where its reflections are seen from.
    cam.location = (0, 0, 0.85)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    sc.camera = cam
    # 2K: sharp enough for a polished top's reflections.
    sc.render.resolution_x, sc.render.resolution_y = 2048, 1024
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "HDR"
    sc.cycles.use_denoising = True
    sc.render.filepath = os.path.join(BAKE, "room_probe.hdr")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


def main():
    os.makedirs(BAKE, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, f"room{SUFFIX}.blend"))
    setup_cycles()
    # The stand-in table and chairs (live preview) must not shadow the bake.
    # Excluding its layer collection takes it out of the scene entirely.
    for lc in bpy.context.view_layer.layer_collection.children:
        if lc.name == "Preview":
            lc.exclude = True
            log("preview collection excluded")
    rug = bpy.data.objects["rug"]
    xs = [(rug.matrix_world @ v.co).x for v in rug.data.vertices]
    ys = [(rug.matrix_world @ v.co).y for v in rug.data.vertices]
    RUG_BOUNDS["xy"] = (min(xs), max(xs), min(ys), max(ys))
    for group, (test, size) in GROUPS.items():
        objs = [o for o in bpy.data.objects if o.type == "MESH" and test(o.name)]
        if not objs:
            log("no objects for", group)
            continue
        obj = join_group(group, objs)
        own_materials(group, obj)
        if group in POINT_GROUPS:
            if ONLY and group not in ONLY:
                restore_points(group, obj)
                log("skip bake", group)
            else:
                bake_points(group, obj)
            continue
        add_lightmap_uv(group, obj)
        if ONLY and group not in ONLY:
            log("skip bake", group)
            continue
        bake_group(group, obj, size)
        log("baked", group, len(objs), "objects", size)
    # Fuzz and fringe share the rug's light map through the same planar UVs.
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name.startswith(("rug_fuzz_", "rug_fringe_")):
            me = o.data
            if "lightmap" not in me.uv_layers:
                me.uv_layers.new(name="lightmap")
            lm = me.uv_layers["lightmap"]
            me.uv_layers[0].active_render = True
            planar_uv(me, lm, me.vertices, o.matrix_world)
    if not ONLY or "probe" in ONLY:
        render_probe()
        log("probe rendered")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"room{SUFFIX}_baked.blend"))
    log("saved", f"room{SUFFIX}_baked.blend")


if __name__ == "__main__":
    try:
        main()
        log("OK")
    except Exception:
        log(traceback.format_exc())
