"""Render Cycles previews of the room with a stand-in table and chairs.

blender -b -P pipeline/room/preview_room.py -- <repo> [samples] [views] [exposure]

Opens out/room.blend, places the real table (oblong top, Moon base) and six
Aria chairs, and renders the reference camera angles to out/preview_<view>.png.
views: comma list of a (corner, eye level), b (low), c (high), default all.
"""
import math
import os
import random
import sys
import traceback

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REPO = ARGS[0] if ARGS else os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SAMPLES = int(ARGS[1]) if len(ARGS) > 1 else 128
VIEWS = ARGS[2].split(",") if len(ARGS) > 2 else ["a", "b", "c"]
EXPOSURE = float(ARGS[3]) if len(ARGS) > 3 else 0.0
MOOD = ARGS[4] if len(ARGS) > 4 else "base"  # base = the room as built (morning)

# Lighting moods: sun height/heading/colour/strength (x env.json irradiance),
# sky strength, overhead fill (W), exposure, leaf shadows from the garden.
MOODS = {
    "base": None,
    # Daylight only (2026-11-26): no fill, chandelier off (build_room.py).
    "sun_only": dict(elev=30, heading=(-0.5, 0.85), color=(1.0, 0.96, 0.9), sun=0.85,
                     sky=0.0, fill=0.0, exposure=0.55, leaves=False),
    "sun_sky": dict(elev=30, heading=(-0.5, 0.85), color=(1.0, 0.96, 0.9), sun=0.85,
                    sky=1.8, fill=0.0, exposure=1.3, leaves=False),
    "sun_sky23": dict(elev=30, heading=(-0.5, 0.85), color=(1.0, 0.96, 0.9), sun=0.85,
                      sky=2.3, fill=0.0, exposure=1.3, leaves=False),
    "sun_sky45": dict(elev=30, heading=(-0.5, 0.85), color=(1.0, 0.96, 0.9), sun=0.85,
                      sky=4.5, fill=0.0, exposure=1.3, leaves=False),
    "sun65_sky45": dict(elev=30, heading=(-0.5, 0.85), color=(1.0, 0.96, 0.9), sun=0.65,
                        sky=4.5, fill=0.0, exposure=1.3, leaves=False),
    "morning": dict(elev=30, heading=(-0.5, 0.85), color=(1.0, 0.96, 0.9), sun=0.85,
                    sky=0.9, fill=6.0, exposure=0.55, leaves=False),
    "afternoon": dict(elev=17, heading=(-0.55, 0.83), color=(1.0, 0.76, 0.52), sun=1.0,
                      sky=0.65, fill=4.0, exposure=0.6, leaves=True),
}
# This folder; the repo root is two levels up (pipeline/room).
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "out")
LOG = os.path.join(OUT, "preview.log")
_log = []


def log(*a):
    _log.append(" ".join(str(x) for x in a))


# name: (location, target, focal length mm)
CAMERAS = {
    "a": ((-3.2, -2.5, 1.3), (0.9, 0.9, 0.55), 28),
    # The credenza wall, straight on.
    "k": ((0.6, -0.6, 1.4), (4.2, 0.3, 1.05), 26),
    # The wall opposite the window: door, painting, sconces.
    "w": ((0.6, 2.4, 1.45), (-0.6, -3.1, 1.3), 22),
    "b": ((-1.8, -2.55, 0.8), (0.6, 0.7, 0.5), 28),
    # Low close-up across the rug corner (like the rug reference crops).
    "r": ((-2.3, -2.4, 0.6), (-0.6, -0.6, 0.05), 40),
    "c": ((-2.6, -2.3, 2.8), (0.35, 0.35, 0.2), 18),
}


def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def new_mat(name, base, rough, metal=0.0, coat=0.0, sheen=0.0, tex=None, normal=None, nstrength=0.5):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    p = principled(m)
    p.inputs["Base Color"].default_value = (*base, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if coat:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = 0.04
    if sheen:
        p.inputs["Sheen Weight"].default_value = sheen
    nt = m.node_tree
    if tex or normal:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        nt.links.new(tc.outputs["Generated" if not tex else "UV"], mp.inputs["Vector"])
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(tex, check_existing=True)
        nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    if normal:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(normal, check_existing=True)
        t.image.colorspace_settings.name = "Non-Color"
        t.projection = "BOX"
        tc2 = nt.nodes.new("ShaderNodeTexCoord")
        mp2 = nt.nodes.new("ShaderNodeMapping")
        mp2.inputs["Scale"].default_value = (12, 12, 12)
        nt.links.new(tc2.outputs["Object"], mp2.inputs["Vector"])
        nt.links.new(mp2.outputs["Vector"], t.inputs["Vector"])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstrength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    return m


def import_glb(rel):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, rel))
    return [o for o in bpy.data.objects if o not in before]


def group(name, objs):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    return root


def place_furniture():
    marble = new_mat("table_marble", (0.86, 0.85, 0.83), 0.12, coat=0.8)
    lacquer = new_mat("base_lacquer", (0.74, 0.66, 0.54), 0.38, coat=0.2)
    fabric = new_mat("chair_fabric", (0.36, 0.32, 0.28), 0.95, sheen=0.8,
                     normal=os.path.join(CACHE, "tex", "hessian_380", "nor.jpg"), nstrength=0.6)
    steel = new_mat("chair_steel", (0.04, 0.04, 0.04), 0.35, metal=0.8)

    top = import_glb("public/assets/images/top-shape/oblong/model.glb")
    for o in top:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(marble)
    base = import_glb("public/assets/images/base-shape/moon/model.glb")
    for o in base:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(lacquer)

    # Chairs: find which way the back faces (the high vertices), then turn
    # each chair to face the table.
    proto = import_glb("public/assets/images/accessories/aria/model.glb")
    ys = []
    for o in proto:
        if o.type != "MESH":
            continue
        o.data.materials.clear()
        o.data.materials.append(fabric if o.name.lower().startswith("top") else steel)
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            if w.z > 0.6:
                ys.append(w.y)
    back_y = sum(ys) / max(len(ys), 1)
    log("chair back mean y", round(back_y, 3))
    proto_root = group("chair_0", proto)
    seats = [(-1.0, -1), (0.0, -1), (1.0, -1), (-1.0, 1), (0.0, 1), (1.0, 1)]
    roots = [proto_root]
    for i in range(1, len(seats)):
        r = proto_root.copy()
        bpy.context.scene.collection.objects.link(r)
        for ch in proto_root.children:
            c = ch.copy()
            bpy.context.scene.collection.objects.link(c)
            c.parent = r
        roots.append(r)
    for r, (x, side) in zip(roots, seats):
        # side -1: chair at -y, its back must point to -y.
        want_back = side
        flip = (back_y > 0) != (want_back > 0)
        # Pulled out and turned a little, as people leave them.
        jitter = random.Random(int(x * 10) + side * 7)
        r.rotation_euler = (0, 0, (math.pi if flip else 0) + math.radians(jitter.uniform(-6, 6)))
        r.location = (x + jitter.uniform(-0.05, 0.05), side * (0.78 + jitter.uniform(0.0, 0.08)), 0)
    # Centrepiece: a wide stoneware bowl on the table.
    bowl = new_mat("centre_bowl", (0.55, 0.5, 0.44), 0.55)
    import bmesh
    bm = bmesh.new()
    prof = [(0.0, 0.0), (0.09, 0.0), (0.2, 0.035), (0.24, 0.07), (0.232, 0.072), (0.19, 0.04), (0.0, 0.025)]
    vs = [bm.verts.new((r_, 0, z)) for r_, z in prof]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=64, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new("centre_bowl")
    bm.to_mesh(me)
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new("centre_bowl", me)
    ob.data.materials.append(bowl)
    ob.location = (0.25, -0.05, 0.705)
    bpy.context.scene.collection.objects.link(ob)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = "GPU"
                log("device", kind, [d.name for d in gpus])
                break
        except Exception:
            continue
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.cycles.transmission_bounces = 8
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.caustics_refractive = False
    sc.cycles.caustics_reflective = False
    sc.cycles.sample_clamp_indirect = 10
    sc.render.resolution_x, sc.render.resolution_y = 1376, 768
    sc.render.image_settings.file_format = "PNG"
    vs = sc.view_settings
    try:
        vs.view_transform = "AgX"
        # The look list is filled per view transform at run time, so try
        # the names rather than reading the enum.
        for want in ("AgX - Medium High Contrast", "Medium High Contrast"):
            try:
                vs.look = want
                break
            except TypeError:
                continue
    except Exception as e:
        log("view transform", e)
    vs.exposure = EXPOSURE
    log("view", vs.view_transform, vs.look, "exposure", vs.exposure, "args", ARGS)


def apply_mood():
    m = MOODS.get(MOOD)
    if not m:
        return
    sc = bpy.context.scene
    sun = bpy.data.objects["sun"]
    import json
    env = json.load(open(os.path.join(OUT, "env", "env.json")))
    sun.data.energy = sum(env["sun_irradiance_rgb"]) / 3 * m["sun"]
    sun.data.color = m["color"]
    e = math.radians(m["elev"])
    h = Vector((*m["heading"], 0)).normalized()
    to_sun = Vector((h.x * math.cos(e), h.y * math.cos(e), math.sin(e)))
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Strength"].default_value = m["sky"]
    bpy.data.objects["table_fill"].data.energy = m["fill"]
    sc.view_settings.exposure = m["exposure"]
    if m["leaves"]:
        add_leaf_shadows(to_sun)
    log("mood", MOOD, m)


def add_leaf_shadows(to_sun):
    """Foliage outside the window, seen only by shadow rays: dappled light
    through leaves on the floor and walls."""
    mat = bpy.data.materials.new("leaf_gobo")
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    for n in list(nt.nodes):
        if n != out:
            nt.nodes.remove(n)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 2.2
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.65
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.5
    ramp.color_ramp.elements[1].position = 0.54
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    df = nt.nodes.new("ShaderNodeBsdfDiffuse")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    nt.links.new(df.outputs["BSDF"], mix.inputs[1])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    me = bpy.data.meshes.new("leaf_gobo")
    me.from_pydata([(-5, -3, 0), (5, -3, 0), (5, 3, 0), (-5, 3, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("leaf_gobo", me)
    ob.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    # Facing the sun, a few metres out from the glass.
    centre = Vector((-0.8, 2.7, 1.4)) + to_sun * 3.5
    ob.location = centre
    ob.rotation_euler = to_sun.to_track_quat("Z", "Y").to_euler()
    for attr in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter"):
        setattr(ob, attr, False)


def render_views():
    sc = bpy.context.scene
    for key in VIEWS:
        loc, target, lens = CAMERAS[key]
        cam_data = bpy.data.cameras.new(f"cam_{key}")
        cam_data.lens = lens
        cam_data.sensor_width = 36
        cam = bpy.data.objects.new(f"cam_{key}", cam_data)
        sc.collection.objects.link(cam)
        cam.location = loc
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.camera = cam
        name = f"preview_{key}.png" if MOOD == "base" else f"mood_{MOOD}_{key}.png"
        sc.render.filepath = os.path.join(OUT, name)
        bpy.ops.render.render(write_still=True)
        log("rendered", key)


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(OUT, "room.blend"))
    place_furniture()
    setup_render()
    apply_mood()
    render_views()


if __name__ == "__main__":
    try:
        main()
        log("OK")
    except Exception:
        log(traceback.format_exc())
    finally:
        with open(LOG, "w") as f:
            f.write("\n".join(_log))
