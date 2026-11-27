"""Denoise baked light maps with Blender's OIDN (compositor Denoise node).

blender -b --factory-startup -P pipeline/room/denoise_lm.py -- <in.exr> [<in.exr> ...]

Cycles does not denoise bakes, and a general image filter (OpenCV
fastNlMeans, used before 2026-11-26) smeared the noise into painterly
blotches. OIDN is made for path-traced noise and keeps edges (sun stripes,
window-frame shadows). Writes <name>_dn.exr beside each input.
"""
import os
import sys
import traceback

import bpy

PATHS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def compositor_tree(sc):
    """The scene's compositor node tree (Blender 5 keeps it as a node group)."""
    if hasattr(sc, "compositing_node_group"):
        ng = bpy.data.node_groups.new("denoise", "CompositorNodeTree")
        sc.compositing_node_group = ng
        return ng
    sc.use_nodes = True
    return sc.node_tree


def denoise(path):
    sc = bpy.context.scene
    img = bpy.data.images.load(path)
    # Read as scene-linear light (Blender may guess a display space).
    for name in ("Linear Rec.709", "Linear", "Non-Color"):
        try:
            img.colorspace_settings.name = name
            break
        except Exception:
            continue
    w, h = img.size
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    # Write the light exactly as computed (scene linear), no display transform.
    try:
        sc.render.image_settings.color_management = "OVERRIDE"
        sc.render.image_settings.linear_colorspace_settings.name = "Linear Rec.709"
    except Exception:
        pass
    # Light, not a picture: no view transform on the way out.
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0
    sc.view_settings.gamma = 1
    nt = compositor_tree(sc)
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    src = nt.nodes.new("CompositorNodeImage")
    src.image = img
    dn = nt.nodes.new("CompositorNodeDenoise")
    for attr, val in (("prefilter", "ACCURATE"), ("use_hdr", True), ("quality", "HIGH")):
        try:
            setattr(dn, attr, val)
        except Exception:
            pass
    nt.links.new(src.outputs[0], dn.inputs[0])
    out = nt.nodes.new("CompositorNodeComposite") if hasattr(bpy.types, "CompositorNodeComposite") \
        else nt.nodes.new("NodeGroupOutput")
    if out.bl_idname == "NodeGroupOutput":
        nt.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    nt.links.new(dn.outputs[0], out.inputs[0])
    # Nothing to render but the compositor: hide every object.
    for o in sc.objects:
        o.hide_render = True
    if sc.camera is None:  # a render needs a camera, even an empty one
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
        sc.camera = cam
    target = path[:-4] + "_dn.exr"
    sc.render.filepath = target
    bpy.ops.render.render(write_still=True)
    print("DENOISED", target)


try:
    for p in PATHS:
        denoise(p)
    print("OK")
except Exception:
    traceback.print_exc()
    sys.exit(1)
