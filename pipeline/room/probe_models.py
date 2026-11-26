"""Log bounding boxes and material names of the furniture GLBs (debug helper).

blender -b --factory-startup -P probe_models.py -- <repo> <log>
"""
import sys

import bpy
from mathutils import Vector

repo, log = sys.argv[sys.argv.index("--") + 1:][:2]
paths = [
    "public/assets/images/top-shape/oblong/model.glb",
    "public/assets/images/base-shape/moon/model.glb",
    "public/assets/images/accessories/aria/model.glb",
    "public/assets/images/accessories/siena/model.glb",
]
out = []
for p in paths:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=f"{repo}/{p}")
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    mats = sorted({s.material.name for o in bpy.context.scene.objects if o.type == "MESH" for s in o.material_slots if s.material})
    meshes = [(o.name, len(o.data.polygons)) for o in bpy.context.scene.objects if o.type == "MESH"]
    out.append(f"{p}\n  lo {tuple(round(v, 3) for v in lo)} hi {tuple(round(v, 3) for v in hi)}\n  mats {mats}\n  meshes {meshes}")
open(log, "w").write("\n".join(out))
