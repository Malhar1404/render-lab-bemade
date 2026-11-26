"""Build the dining room (reference look: daylight, glass wall, oak, rug).

blender -b --factory-startup -P pipeline/room/build_room.py -- <repo>

Needs fetch_assets.py, prepare_env.py and prepare_textures.py run first.
Writes out/room.blend (for previews and bakes) and
public/assets/room/room_v2.glb (physical materials, no baked light).

Blender is Z-up; the GLB is Y-up: three.js (x, y, z) = Blender (x, z, -y).
The table stands at the origin, its length along x. The window wall is at
Blender +Y (three.js -Z), the credenza on the +X wall.
"""
import math
import os
import random
import sys
import traceback

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REPO = ARGS[0] if ARGS else os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
# This folder; the repo root is two levels up (pipeline/room).
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "out")
TEX = os.path.join(OUT, "tex")
LOG = os.path.join(OUT, "build.log")

# Room: inner faces of the walls, metres.
# Sized for the largest table (3.18 x 1.58 m) with chairs pulled out on a
# 5 x 3.5 m rug, and walking room round it.
RX, RY, H = 4.3, 3.1, 3.2
# Rug, centred under the table: half length (x) and half width (y).
RUG_HX, RUG_HY = 2.5, 1.75
# Glazing in the window wall (+Y): x range and head height.
GLASS_X0, GLASS_X1, GLASS_TOP = -3.9, 2.4, 2.95
GLASS_PANELS = 4
# Credenza on the +X wall, centred at this y.
CRED_Y = 0.3
# Preview/bake lights (Blender watts): overhead fill and each chandelier bulb.
FILL_POWER = 6.0
# Morning light (chosen 2026-11-25): sun height and heading (towards the sun,
# from the room), colour, strength against the measured sun, sky strength.
SUN_ELEVATION = 30.0
SUN_HEADING = (-0.5, 0.85)
SUN_COLOR = (1.0, 0.96, 0.9)
SUN_SCALE = 0.85
SKY_STRENGTH = 0.9
BULB_POWER = 6.0

random.seed(7)
_log = []


def log(*a):
    _log.append(" ".join(str(x) for x in a))


# --------------------------------------------------------------------------
# Materials

def _img(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def material(name, base=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, color_tex=None,
             normal_tex=None, rough_tex=None, normal_strength=1.0, sheen=0.0,
             coat=0.0, coat_rough=0.05, alpha=1.0, transmission=0.0, ior=1.5,
             emission=None, emission_strength=0.0, double_sided=False, alpha_clip=False):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    inp = bsdf.inputs
    inp["Base Color"].default_value = (*base, 1)
    inp["Roughness"].default_value = rough
    inp["Metallic"].default_value = metal
    inp["IOR"].default_value = ior
    if color_tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _img(color_tex)
        nt.links.new(t.outputs["Color"], inp["Base Color"])
        if alpha_clip:
            # Alpha > 0.5 -> opaque, else cut: exported as glTF alphaMode MASK.
            gt = nt.nodes.new("ShaderNodeMath")
            gt.operation = "GREATER_THAN"
            gt.inputs[1].default_value = 0.5
            nt.links.new(t.outputs["Alpha"], gt.inputs[0])
            nt.links.new(gt.outputs["Value"], inp["Alpha"])
            for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
                try:
                    setattr(m, attr, val)
                except Exception:
                    pass
    if rough_tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _img(rough_tex, True)
        nt.links.new(t.outputs["Color"], inp["Roughness"])
    if normal_tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _img(normal_tex, True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], inp["Normal"])
    if sheen:
        inp["Sheen Weight"].default_value = sheen
        inp["Sheen Roughness"].default_value = 0.5
    if coat:
        inp["Coat Weight"].default_value = coat
        inp["Coat Roughness"].default_value = coat_rough
    if transmission:
        inp["Transmission Weight"].default_value = transmission
    if alpha < 1:
        inp["Alpha"].default_value = alpha
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    if emission:
        inp["Emission Color"].default_value = (*emission, 1)
        inp["Emission Strength"].default_value = emission_strength
    m.use_backface_culling = not double_sided
    return m


def tex(name):
    return os.path.join(TEX, f"{name}.jpg")


def tex_png(name):
    return os.path.join(TEX, f"{name}.png")


def src(asset, kind):
    return os.path.join(CACHE, "tex", asset, f"{kind}.jpg")


def make_materials():
    M = {}
    M["floor"] = material("floor_oak", rough=0.55, color_tex=tex("floor_oak"),
                          normal_tex=src("laminate_floor_02", "nor"),
                          rough_tex=src("laminate_floor_02", "rough"), normal_strength=0.6)
    M["wall"] = material("walls_paint", rough=0.9, color_tex=tex("paint"),
                         normal_tex=src("white_plaster_02", "nor"), normal_strength=0.12)
    M["ceiling"] = material("ceiling_paint", base=(0.86, 0.85, 0.82), rough=0.95)
    M["skirting"] = material("trim_white", base=(0.82, 0.8, 0.76), rough=0.45)
    M["frame"] = material("window_frame", base=(0.035, 0.035, 0.035), rough=0.4)
    # Thin panes as see-through surfaces (alpha), not refractive solids:
    # refraction would block the sun and sky (caustic paths) and costs the
    # path tracer far more. They keep a faint reflection.
    M["glass"] = material("window_glass", base=(0.9, 0.93, 0.92), rough=0.0,
                          alpha=0.06, double_sided=True)
    M["terrace"] = material("terrace_stone", rough=0.85, color_tex=tex("terrace"),
                            normal_tex=src("white_plaster_02", "nor"), normal_strength=0.4)
    # Hand-loomed wool rug: one texture over the whole rug (yarn rows,
    # streaks, heathered fibres), made by prepare_textures.make_loomed_rug.
    M["rug"] = material("rug_wool", rough=1.0, color_tex=tex("rug_loomed"),
                        normal_tex=tex("rug_loomed_nor"), normal_strength=1.0, sheen=0.8)
    M["rug_fuzz"] = material("rug_fuzz", rough=1.0, color_tex=tex_png("rug_fuzz"), sheen=0.8,
                             alpha_clip=True, double_sided=True)
    M["sheer"] = material("curtain_sheer", rough=0.9, color_tex=tex("sheer"),
                          alpha=0.42, sheen=0.4, double_sided=True)
    M["linen"] = material("curtain_linen", rough=0.95, color_tex=tex("linen"),
                          normal_tex=src("rough_linen", "nor"), normal_strength=0.5,
                          sheen=0.5, double_sided=True)
    M["walnut"] = material("credenza_walnut", rough=0.42, color_tex=tex("walnut"),
                           normal_tex=src("american_walnut_veneer", "nor"), normal_strength=0.4,
                           coat=0.25, coat_rough=0.3)
    M["marble"] = material("credenza_marble", rough=0.12, color_tex=tex("marble"),
                           coat=0.6, coat_rough=0.04)
    M["black_metal"] = material("black_metal", base=(0.03, 0.03, 0.03), rough=0.38, metal=0.6)
    M["brass"] = material("brass", base=(0.78, 0.6, 0.36), rough=0.28, metal=1.0)
    M["canvas"] = material("art_canvas", base=(0.86, 0.84, 0.8), rough=0.95,
                           normal_tex=src("white_plaster_02", "nor"), normal_strength=0.6)
    M["art_a"] = material("art_paper_light", base=(0.8, 0.77, 0.71), rough=0.95,
                          normal_tex=src("white_plaster_02", "nor"), normal_strength=0.8)
    M["art_b"] = material("art_paper_stone", base=(0.62, 0.57, 0.5), rough=0.95,
                          normal_tex=src("white_plaster_02", "nor"), normal_strength=0.8)
    M["art_frame"] = material("art_frame_oak", base=(0.55, 0.42, 0.28), rough=0.5)
    # Smoked glass globes: real thin-shell glass (transmission), so their
    # rims catch reflections like the reference fixture.
    M["globe"] = material("chandelier_glass", base=(0.78, 0.72, 0.64), rough=0.02,
                          transmission=1.0, ior=1.5)
    M["bulb"] = material("chandelier_bulb", base=(1, 1, 1), rough=0.5,
                         emission=(1.0, 0.62, 0.32), emission_strength=60.0)
    M["concrete"] = material("planter_concrete", rough=0.85, color_tex=tex("concrete"),
                             normal_tex=src("white_plaster_02", "nor"), normal_strength=0.5)
    M["reveal"] = material("credenza_reveal", base=(0.02, 0.018, 0.016), rough=0.8)
    M["vase_glass"] = material("vase_glass", base=(0.85, 0.88, 0.86), rough=0.02, alpha=0.18,
                               double_sided=True)
    M["olive_leaf"] = material("olive_leaf", base=(0.16, 0.24, 0.12), rough=0.45, double_sided=True)
    M["soil"] = material("planter_soil", base=(0.08, 0.06, 0.045), rough=0.95)
    M["bark"] = material("fig_bark", base=(0.24, 0.2, 0.16), rough=0.8)
    M["leaf"] = material("fig_leaf", rough=0.38, color_tex=tex("fig_leaf"),
                         normal_tex=os.path.join(TEX, "fig_leaf_nor.png"), normal_strength=0.6,
                         coat=0.2, coat_rough=0.2, double_sided=True)
    M["shade"] = material("lamp_shade_linen", rough=0.95, color_tex=tex("linen"), sheen=0.4,
                          double_sided=True)
    M["ceramic"] = material("decor_ceramic", base=(0.42, 0.36, 0.3), rough=0.6)
    M["stone_bowl"] = material("decor_stone", base=(0.7, 0.66, 0.6), rough=0.7)
    M["book_a"] = material("decor_book_cream", base=(0.82, 0.79, 0.72), rough=0.8)
    M["book_b"] = material("decor_book_taupe", base=(0.45, 0.4, 0.35), rough=0.8)
    return M


# --------------------------------------------------------------------------
# Geometry helpers. Everything is built in world space (identity transforms).

_collection = None


def link(obj):
    _collection.objects.link(obj)
    return obj


def mesh_obj(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    obj.data.materials.append(mat)
    return link(obj)


def project_uv(obj, tile, rot=False, offset=(0.0, 0.0)):
    """Box-project UVs from world coordinates: tile metres per texture."""
    me = obj.data
    uv = me.uv_layers.new(name="UVMap") if not me.uv_layers else me.uv_layers[0]
    tu, tv = (tile, tile) if not isinstance(tile, tuple) else tile
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                a, b = co.x, co.y
            elif ax == 0:
                a, b = co.y, co.z
            else:
                a, b = co.x, co.z
            if rot:
                a, b = b, a
            uv.data[li].uv = ((a + offset[0]) / tu, (b + offset[1]) / tv)


def box(name, x0, x1, y0, y1, z0, z1, mat, tile=1.0, rot=False, bevel=0.0):
    bm = bmesh.new()
    v = [bm.verts.new((x, y, z)) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    for f in faces:
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_obj(name, bm, mat)
    project_uv(obj, tile, rot)
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.harden_normals = False
    return obj


def plane(name, corners, mat, tile=1.0, rot=False):
    """A quad from four corners (counter-clockwise seen from its front)."""
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in corners]
    bm.faces.new(vs)
    obj = mesh_obj(name, bm, mat)
    project_uv(obj, tile, rot)
    return obj


def cylinder(name, a, b, r, mat, segments=16, smooth=True):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r, radius2=r, depth=d.length)
    rot = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    obj = mesh_obj(name, bm, mat, smooth)
    return obj


def sphere(name, c, r, mat, shell=0.0, seg=32):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    obj = mesh_obj(name, bm, mat, smooth=True)
    if shell:
        mod = obj.modifiers.new("shell", "SOLIDIFY")
        mod.thickness = shell
        mod.offset = -1
    return obj


def lathe(name, profile, c, mat, steps=48):
    """Revolve a profile [(r, z), ...] (bottom to top) around a vertical axis."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=2 * math.pi, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return mesh_obj(name, bm, mat, smooth=True)


# --------------------------------------------------------------------------
# Room parts

def build_shell(M):
    floor = plane("floor", [(-RX, -RY, 0), (RX, -RY, 0), (RX, RY, 0), (-RX, RY, 0)],
                  M["floor"], tile=1.7, rot=True)
    plane("ceiling", [(-RX, -RY, H), (-RX, RY, H), (RX, RY, H), (RX, -RY, H)], M["ceiling"], tile=2.0)
    # Walls face into the room.
    plane("wall_left", [(-RX, -RY, 0), (-RX, RY, 0), (-RX, RY, H), (-RX, -RY, H)], M["wall"])
    plane("wall_right", [(RX, RY, 0), (RX, -RY, 0), (RX, -RY, H), (RX, RY, H)], M["wall"])
    plane("wall_front", [(RX, -RY, 0), (-RX, -RY, 0), (-RX, -RY, H), (RX, -RY, H)], M["wall"])
    # Window wall: solid parts around the glazing.
    plane("wall_window_r", [(-RX, RY, 0), (GLASS_X0, RY, 0), (GLASS_X0, RY, H), (-RX, RY, H)], M["wall"])
    plane("wall_window_l", [(GLASS_X1, RY, 0), (RX, RY, 0), (RX, RY, H), (GLASS_X1, RY, H)], M["wall"])
    plane("wall_window_head", [(GLASS_X0, RY, GLASS_TOP), (GLASS_X1, RY, GLASS_TOP),
                               (GLASS_X1, RY, H), (GLASS_X0, RY, H)], M["wall"])
    # (Their corners already wind to face -Y, into the room.)
    # Reveal: the wall's thickness around the glazing opening.
    T = 0.2
    plane("reveal_head", [(GLASS_X0, RY, GLASS_TOP), (GLASS_X0, RY + T, GLASS_TOP),
                          (GLASS_X1, RY + T, GLASS_TOP), (GLASS_X1, RY, GLASS_TOP)], M["wall"])
    plane("reveal_l", [(GLASS_X0, RY, 0), (GLASS_X0, RY + T, 0), (GLASS_X0, RY + T, GLASS_TOP), (GLASS_X0, RY, GLASS_TOP)], M["wall"])
    plane("reveal_r", [(GLASS_X1, RY + T, 0), (GLASS_X1, RY, 0), (GLASS_X1, RY, GLASS_TOP), (GLASS_X1, RY + T, GLASS_TOP)], M["wall"])

    # Skirting along the solid walls.
    s, t = 0.08, 0.012
    box("skirting_left", -RX, -RX + t, -RY, RY, 0, s, M["skirting"])
    box("skirting_right", RX - t, RX, -RY, RY, 0, s, M["skirting"])
    box("skirting_front", -RX, RX, -RY, -RY + t, 0, s, M["skirting"])
    box("skirting_window", GLASS_X1, RX, RY - t, RY, 0, s, M["skirting"])
    return floor


def build_window(M):
    """Floor-to-ceiling glazing: slim black frames, single panes."""
    y = RY + 0.05  # glass plane, set into the opening
    d = 0.06  # frame depth
    w = 0.045  # frame face width
    box("frame_sill", GLASS_X0, GLASS_X1, y - d, y + d, 0, 0.035, M["frame"])
    box("frame_head", GLASS_X0, GLASS_X1, y - d, y + d, GLASS_TOP - w, GLASS_TOP, M["frame"])
    xs = [GLASS_X0 + i * (GLASS_X1 - GLASS_X0) / GLASS_PANELS for i in range(GLASS_PANELS + 1)]
    for i, x in enumerate(xs):
        x0 = max(x - w / 2, GLASS_X0)
        x1 = min(x + w / 2, GLASS_X1)
        if i == 0:
            x1 = GLASS_X0 + w
        if i == GLASS_PANELS:
            x0 = GLASS_X1 - w
        box(f"frame_mullion_{i}", x0, x1, y - d, y + d, 0.035, GLASS_TOP - w, M["frame"])
    for i in range(GLASS_PANELS):
        box(f"glass_{i}", xs[i], xs[i + 1], y - 0.004, y + 0.004, 0.035, GLASS_TOP - w, M["glass"])
    # Terrace outside: grounds the garden view.
    plane("terrace", [(-9, RY + 0.2, -0.02), (9, RY + 0.2, -0.02), (9, RY + 2.2, -0.02), (-9, RY + 2.2, -0.02)],
          M["terrace"], tile=1.0)


def curtain(name, x0, x1, mat, y=RY - 0.1, amp=0.045, wave=0.13, top=H - 0.02):
    """Pleated fabric hanging from the ceiling: a sine fold across its width."""
    nx = max(int((x1 - x0) / 0.008), 8)
    nz = 28
    bm = bmesh.new()
    grid = []
    phase = random.random() * 6.28
    for j in range(nz + 1):
        z = 0.01 + (top - 0.01) * j / nz
        row = []
        flare = 1.0 + 0.35 * (1 - j / nz)  # folds open out towards the hem
        for i in range(nx + 1):
            u = i / nx
            x = x0 + (x1 - x0) * u
            a = amp * flare * (0.8 + 0.2 * math.sin(u * 9 + phase))
            yy = y + a * math.sin(2 * math.pi * (x - x0) / wave)
            row.append(bm.verts.new((x, yy, z)))
        grid.append(row)
    for j in range(nz):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_obj(name, bm, mat, smooth=True)
    project_uv(obj, 0.5)
    return obj


def build_curtains(M):
    curtain("curtain_sheer_l", -RX + 0.02, GLASS_X0 + 0.55, M["sheer"])
    curtain("curtain_sheer_r", GLASS_X1 - 0.45, GLASS_X1 + 0.25, M["sheer"])
    curtain("curtain_linen_r", GLASS_X1 + 0.25, GLASS_X1 + 0.85, M["linen"], amp=0.055, wave=0.16, y=RY - 0.16)
    # Ceiling track, a slim recessed line.
    box("curtain_track", -RX, GLASS_X1 + 0.9, RY - 0.2, RY - 0.06, H - 0.015, H, M["skirting"])


def build_rug(M):
    X, Y = RUG_HX, RUG_HY
    # Seamless 1 m wool tile (prepare_textures.make_loomed_rug), rows along x.
    box("rug", -X, X, -Y, Y, 0.0, 0.02, M["rug"], tile=1.0, bevel=0.008)
    # Fuzz: two thin layers of loose fibres just above the pile, and a fringe
    # of fibres standing round the edge, so the rug's surface and outline are
    # soft (alpha-cut, cheap in the viewer and the path tracer).
    top = 0.02
    for i, dz in enumerate((0.0012, 0.0028)):
        plane(f"rug_fuzz_{i}", [(-X, -Y, top + dz), (X, -Y, top + dz), (X, Y, top + dz), (-X, Y, top + dz)],
              M["rug_fuzz"], tile=0.25 + 0.031 * i)
    o, hgt = 0.002, top + 0.004
    edges = [((-X - o, -Y - o), (X + o, -Y - o)), ((X + o, -Y - o), (X + o, Y + o)),
             ((X + o, Y + o), (-X - o, Y + o)), ((-X - o, Y + o), (-X - o, -Y - o))]
    for i, ((x0, y0), (x1, y1)) in enumerate(edges):
        plane(f"rug_fringe_{i}", [(x0, y0, 0), (x1, y1, 0), (x1, y1, hgt), (x0, y0, hgt)], M["rug_fuzz"], tile=0.25)


def build_credenza(M):
    """Reference credenza: smoked walnut, push-to-open fronts (door, two
    stacked drawers, door) with fine dark reveals, a white marble top with
    low lips at the back and ends, on slim black sled legs."""
    c = CRED_Y
    L = 1.15  # half length (along y)
    xb = RX - 0.02  # back, off the wall
    xf = xb - 0.46  # front
    z0, z1 = 0.14, 0.72  # carcass bottom and top
    t = 0.018  # front thickness
    box("credenza_body", xf + t, xb, c - L, c + L, z0, z1, M["walnut"], bevel=0.002)
    # Dark reveal behind the fronts, showing in the gaps.
    box("credenza_reveal", xf + t - 0.002, xf + t, c - L + 0.004, c + L - 0.004, z0 + 0.004, z1 - 0.004,
        M["reveal"])
    gap = 0.005
    widths = [0.74, 0.8, 0.74]
    scale = (2 * L - 4 * gap) / sum(widths)
    y = c - L + gap
    for i, w in enumerate(widths):
        w *= scale
        if i == 1:
            zm = (z0 + z1) / 2
            box("credenza_drawer_lo", xf, xf + t, y, y + w, z0 + gap, zm - gap / 2, M["walnut"], bevel=0.0015)
            box("credenza_drawer_hi", xf, xf + t, y, y + w, zm + gap / 2, z1 - gap, M["walnut"], bevel=0.0015)
        else:
            box(f"credenza_door_{i}", xf, xf + t, y, y + w, z0 + gap, z1 - gap, M["walnut"], bevel=0.0015)
        y += w + gap
    # Marble top with low lips at the back and both ends.
    zt = z1 + 0.03
    box("credenza_top", xf - 0.008, xb, c - L - 0.008, c + L + 0.008, z1, zt, M["marble"], tile=1.5, bevel=0.002)
    lip = 0.05
    box("credenza_lip_back", xb - 0.02, xb, c - L - 0.008, c + L + 0.008, zt, zt + lip, M["marble"],
        tile=1.5, bevel=0.002)
    for k, sgn in enumerate((-1, 1)):
        ye = c + sgn * (L + 0.008)
        box(f"credenza_lip_end_{k}", xf - 0.008, xb - 0.02, min(ye, ye - sgn * 0.02), max(ye, ye - sgn * 0.02),
            zt, zt + lip, M["marble"], tile=1.5, bevel=0.002)
    # Sled legs: a slim black frame under each end.
    for k, sgn in enumerate((-1, 1)):
        yl = c + sgn * (L - 0.1)
        w = 0.012
        box(f"credenza_leg_{k}_front", xf + 0.04, xf + 0.065, yl - w, yl + w, 0.0, z0, M["black_metal"])
        box(f"credenza_leg_{k}_back", xb - 0.065, xb - 0.04, yl - w, yl + w, 0.0, z0, M["black_metal"])
        box(f"credenza_leg_{k}_foot", xf + 0.04, xb - 0.04, yl - w, yl + w, 0.0, 0.012, M["black_metal"])
    build_credenza_decor(M, xf, xb, c, zt)


def build_credenza_decor(M, xf, xb, c, z):
    """As in the reference: a book stack with a small stone block, a little
    cup, and a glass vase of leafy olive branches."""
    xm = (xf + xb) / 2
    box("decor_book_1", xm - 0.13, xm + 0.13, c - 0.88, c - 0.58, z, z + 0.03, M["book_a"], bevel=0.002)
    box("decor_book_2", xm - 0.12, xm + 0.115, c - 0.86, c - 0.6, z + 0.03, z + 0.052, M["book_b"], bevel=0.002)
    box("decor_block", xm - 0.035, xm + 0.035, c - 0.77, c - 0.7, z + 0.052, z + 0.1, M["ceramic"], bevel=0.006)
    lathe("decor_cup", [(0.0, 0.0), (0.035, 0.0), (0.045, 0.02), (0.05, 0.075), (0.045, 0.075),
                        (0.04, 0.02), (0.0, 0.01)], (xm - 0.02, c + 0.32, z), M["stone_bowl"])
    vx, vy = xm + 0.02, c + 0.75
    lathe("decor_vase", [(0.0, 0.0), (0.055, 0.0), (0.06, 0.01), (0.06, 0.24), (0.055, 0.24),
                         (0.054, 0.012), (0.0, 0.006)], (vx, vy, z), M["vase_glass"], steps=48)
    rnd = random.Random(31)
    root = bpy.data.objects.new("decor_branches", None)
    link(root)
    parts = []
    for b in range(6):
        yaw = b * 1.05 + rnd.uniform(-0.3, 0.3)
        tilt = math.radians(rnd.uniform(8, 28))
        length = rnd.uniform(0.38, 0.55)
        base = Vector((vx, vy, z + 0.03))
        d = Vector((math.sin(tilt) * math.cos(yaw), math.sin(tilt) * math.sin(yaw), math.cos(tilt)))
        tip = base + d * length
        parts.append(cylinder(f"decor_stem_{b}", base, tip, 0.0025, M["bark"], 6))
        for k in range(9):
            tt = 0.35 + 0.65 * k / 8
            at = base.lerp(tip, tt)
            parts.append(leaf(f"decor_leaf_{b}_{k}", at, yaw + rnd.uniform(-1.2, 1.2) + (k % 2) * math.pi,
                              math.radians(rnd.uniform(20, 60)), rnd.uniform(0.05, 0.08), M["olive_leaf"], rnd))
    for p_ in parts:
        p_.parent = root


def build_art(M):
    """A large layered-paper abstract above the credenza, in a slim oak frame."""
    c = CRED_Y
    x = RX - 0.005
    w, h, zc = 1.3, 1.6, 1.85
    y0, y1, z0, z1 = c - w / 2, c + w / 2, zc - h / 2, zc + h / 2
    f, d = 0.022, 0.045
    box("art_frame_t", x - d, x, y0 - f, y1 + f, z1, z1 + f, M["art_frame"])
    box("art_frame_b", x - d, x, y0 - f, y1 + f, z0 - f, z0, M["art_frame"])
    box("art_frame_l", x - d, x, y0 - f, y0, z0, z1, M["art_frame"])
    box("art_frame_r", x - d, x, y1, y1 + f, z0, z1, M["art_frame"])
    box("art_canvas", x - 0.03, x, y0 + 0.01, y1 - 0.01, z0 + 0.01, z1 - 0.01, M["canvas"], tile=0.8)
    layers = [
        (0.15, 0.62, 0.12, 0.7, "art_a"),
        (0.45, 0.88, 0.35, 0.95, "art_b"),
        (0.08, 0.4, 0.55, 0.92, "art_a"),
        (0.55, 0.8, 0.05, 0.4, "art_a"),
        (0.3, 0.52, 0.3, 0.58, "art_b"),
    ]
    for i, (a, b, p, q, m) in enumerate(layers):
        t = 0.003 + 0.002 * i
        box(f"art_layer_{i}", x - 0.03 - t, x - 0.03, y0 + w * a, y0 + w * b, z0 + h * p, z0 + h * q,
            M[m], tile=0.8)


def build_chandelier(M):
    """A brass bar with glass globes on short arms (reference style)."""
    root = bpy.data.objects.new("chandelier", None)
    link(root)
    parts = []
    zb = 2.12
    parts.append(cylinder("ch_canopy", (0, 0, H - 0.025), (0, 0, H), 0.07, M["brass"], 32))
    parts.append(cylinder("ch_rod", (0, 0, zb), (0, 0, H - 0.02), 0.006, M["brass"]))
    parts.append(cylinder("ch_bar", (-0.62, 0, zb), (0.62, 0, zb), 0.009, M["brass"]))
    arms = [
        (-0.6, (-0.12, 0.08, 0.06)), (-0.45, (0.0, -0.17, -0.1)), (-0.3, (0.04, 0.13, 0.15)),
        (-0.16, (0.0, 0.06, -0.2)), (0.0, (0.0, -0.15, 0.1)), (0.13, (0.03, 0.15, -0.08)),
        (0.27, (0.0, -0.07, 0.2)), (0.4, (0.0, 0.16, 0.03)), (0.5, (0.05, -0.14, -0.12)),
        (0.61, (0.12, 0.05, 0.07)),
    ]
    for i, (x, d) in enumerate(arms):
        a = Vector((x, 0, zb))
        dv = Vector(d)
        b = a + dv
        r = 0.075 + 0.015 * random.random()
        parts.append(cylinder(f"ch_arm_{i}", a, b, 0.005, M["brass"], 12))
        parts.append(cylinder(f"ch_socket_{i}", b, b + dv.normalized() * 0.025, 0.014, M["brass"], 16))
        centre = b + dv.normalized() * (0.02 + r)
        parts.append(sphere(f"ch_globe_{i}", centre, r, M["globe"], shell=0.003))
        parts.append(sphere(f"ch_bulb_{i}", centre, 0.016, M["bulb"], seg=16))
    for p in parts:
        p.parent = root
    return root


def build_plants(M):
    path = os.path.join(CACHE, "models", "potted_plant_01", "potted_plant_01_2k.gltf")
    placements = [((-RX + 0.55, RY - 0.5), 1.15, 160.0)]
    for k, (pos, scale, rot) in enumerate(placements):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        root = bpy.data.objects.new(f"plant_{k}", None)
        link(root)
        for o in new:
            for col in list(o.users_collection):
                col.objects.unlink(o)
            link(o)
            if o.parent is None:
                o.parent = root
            if o.type == "MESH":
                for slot in o.material_slots:
                    if slot.material and "pot" in slot.material.name.lower():
                        slot.material = M["concrete"]
        root.location = (pos[0], pos[1], 0)
        root.scale = (scale,) * 3
        root.rotation_euler = (0, 0, math.radians(rot))
        log("plant", k, [o.name for o in new])


def build_fig(M, pos, height=1.95, seed=11, name="fig"):
    """A fiddle-leaf fig in a tall concrete planter: a slim trunk with large
    violin-shaped leaves, spiralling up the top two thirds."""
    rnd = random.Random(seed)
    root = bpy.data.objects.new(name, None)
    link(root)
    parts = []
    x0, y0 = pos
    pot_h, pot_r = 0.52, 0.21
    parts.append(lathe(f"{name}_pot", [(0.0, 0.0), (pot_r - 0.03, 0.0), (pot_r - 0.015, 0.02),
                                       (pot_r, pot_h), (pot_r - 0.018, pot_h), (pot_r - 0.03, 0.08),
                                       (0.0, 0.08)], (x0, y0, 0), M["concrete"], steps=64))
    parts.append(lathe(f"{name}_soil", [(0.0, pot_h - 0.04), (pot_r - 0.02, pot_h - 0.04)],
                       (x0, y0, 0), M["soil"], steps=48))
    # Trunk: a gentle S-curve.
    pts = []
    for i in range(9):
        t = i / 8
        pts.append(Vector((x0 + 0.04 * math.sin(t * 3.1), y0 + 0.03 * math.sin(t * 2.0 + 1),
                           pot_h - 0.04 + t * (height - pot_h - 0.25))))
    for i in range(8):
        parts.append(cylinder(f"{name}_trunk_{i}", pts[i], pts[i + 1], 0.02 - 0.009 * i / 8, M["bark"], 10))
    top = pts[-1]
    n = 38
    for k in range(n):
        t = k / (n - 1)
        # Attach along the upper trunk, denser near the top.
        idx = 3 + t * 5
        i0 = min(int(idx), 7)
        a = pts[i0].lerp(pts[i0 + 1], idx - i0) if i0 < 8 else top
        yaw = k * 2.4 + rnd.uniform(-0.3, 0.3)  # golden-angle spiral
        up = math.radians(rnd.uniform(5, 45) * (0.6 + 0.6 * t))
        length = rnd.uniform(0.28, 0.4) * (0.8 + 0.3 * (1 - abs(t - 0.6)))
        parts.append(leaf(f"{name}_leaf_{k}", a, yaw, up, length, M["leaf"], rnd))
    for p in parts:
        p.parent = root
    return root


def leaf(name, base, yaw, up, length, mat, rnd):
    """One fiddle leaf: narrow base, waist, broad rounded tip; folded along
    the midrib and drooping along its length."""
    width = length * rnd.uniform(0.72, 0.85)
    nl, nw = 14, 6
    fold = math.radians(rnd.uniform(12, 26))
    droop = rnd.uniform(0.25, 0.6)
    bm = bmesh.new()
    grid = []
    for i in range(nl + 1):
        t = i / nl
        # Fiddle outline half-width along the length.
        w = (0.25 + 0.55 * math.sin(math.pi * min(t / 0.82, 1) ** 0.9)) * (1 - 0.35 * math.exp(-((t - 0.38) / 0.12) ** 2))
        if t > 0.82:
            w *= math.sqrt(max(1 - ((t - 0.82) / 0.18) ** 2, 0.02))
        row = []
        for j in range(nw + 1):
            s = j / nw * 2 - 1  # -1..1 across
            x = s * w * width / 2
            z = abs(x) * math.tan(fold)
            # Droop: the leaf curves down towards its tip.
            yy = t * length
            z -= droop * (t ** 2) * length * 0.5
            row.append(bm.verts.new((x, yy, z)))
        grid.append(row)
    for i in range(nl):
        for j in range(nw):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = (0.5 + co.x / width, co.y / length)
    # Petiole offset, then orient: tilt up, turn around the trunk.
    m = (Matrix.Translation(base) @ Matrix.Rotation(yaw, 4, "Z")
         @ Matrix.Rotation(-up, 4, "X") @ Matrix.Translation((0, 0.03, 0)))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    obj = mesh_obj(name, bm, mat, smooth=True)
    return obj


def build_floor_lamp(M, pos):
    """A slim black floor lamp with a linen drum shade (off by day)."""
    x, y = pos
    root = bpy.data.objects.new("floor_lamp", None)
    link(root)
    parts = [
        cylinder("lamp_base", (x, y, 0), (x, y, 0.02), 0.15, M["black_metal"], 48),
        cylinder("lamp_stem", (x, y, 0.02), (x, y, 1.42), 0.01, M["black_metal"], 12),
        lathe("lamp_shade", [(0.2, 1.3), (0.2, 1.62), (0.197, 1.62), (0.197, 1.3)], (x, y, 0), M["shade"], 64),
    ]
    for p in parts:
        p.parent = root


# --------------------------------------------------------------------------
# Lighting for previews and bakes (not exported).

def build_lighting():
    import json
    env = json.load(open(os.path.join(OUT, "env", "env.json")))
    irr = sum(env["sun_irradiance_rgb"]) / 3

    world = bpy.data.worlds.new("garden")
    bpy.context.scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    et = nt.nodes.new("ShaderNodeTexEnvironment")
    et.image = bpy.data.images.load(os.path.join(OUT, "env", "garden_4k.hdr"))
    nt.links.new(et.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = SKY_STRENGTH

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = irr * SUN_SCALE
    sun_data.color = SUN_COLOR
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("sun", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    elev = math.radians(SUN_ELEVATION)
    horiz = Vector((*SUN_HEADING, 0)).normalized()
    to_sun = Vector((horiz.x * math.cos(elev), horiz.y * math.cos(elev), math.sin(elev)))
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    log("sun irradiance", irr, "dir", tuple(round(v, 3) for v in to_sun))

    # Soft overhead fill above the table, hidden from the camera: what a
    # photographer's bounce does, and what keeps the product bright. The
    # viewer gets the same as a RectAreaLight.
    fill_data = bpy.data.lights.new("table_fill", "AREA")
    fill_data.shape = "RECTANGLE"
    fill_data.size, fill_data.size_y = 3.0, 1.6
    fill_data.energy = FILL_POWER
    fill_data.color = (1.0, 0.96, 0.9)
    fill = bpy.data.objects.new("table_fill", fill_data)
    bpy.context.scene.collection.objects.link(fill)
    fill.location = (0, 0, H - 0.05)
    fill.visible_camera = False

    # Chandelier bulbs light the room too (the emissive bulbs alone sit
    # inside refractive globes, which block direct light in Cycles); the
    # globes don't cast shadows of their own.
    for o in bpy.data.objects:
        if o.name.startswith("ch_globe_"):
            o.visible_shadow = False
        if o.name.startswith("ch_bulb_"):
            o.visible_shadow = False
            ld = bpy.data.lights.new(o.name + "_light", "POINT")
            ld.energy = BULB_POWER
            ld.color = (1.0, 0.72, 0.45)
            ld.shadow_soft_size = 0.015
            lo = bpy.data.objects.new(o.name + "_light", ld)
            bpy.context.scene.collection.objects.link(lo)
            lo.location = sum((o.matrix_world @ Vector(c) for c in o.bound_box), Vector()) / 8


# --------------------------------------------------------------------------

def export_glb():
    bpy.ops.object.select_all(action="DESELECT")
    for o in _collection.all_objects:
        o.select_set(True)
    # The unbaked room (physical materials only); the viewer gets the baked
    # one from bake_room.py + export_room.py.
    path = os.path.join(OUT, "room_unbaked.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_image_format="JPEG",
    )
    log("exported", path, os.path.getsize(path) // 1024, "KB")


def reset_scene():
    """Start from an empty scene. Headless: factory settings. In an open
    Blender (live build): remove the data instead, which keeps the UI and
    add-ons (and the MCP connection) running."""
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        return
    for col in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                bpy.data.cameras, bpy.data.worlds, bpy.data.images, bpy.data.collections):
        bpy.data.batch_remove(list(col))


def main():
    global _collection
    reset_scene()
    _collection = bpy.data.collections.new("Room")
    bpy.context.scene.collection.children.link(_collection)
    M = make_materials()
    build_shell(M)
    build_window(M)
    build_curtains(M)
    build_rug(M)
    build_credenza(M)
    build_art(M)
    build_chandelier(M)
    build_plants(M)
    build_fig(M, (RX - 0.55, RY - 0.55), height=2.2)
    build_floor_lamp(M, (RX - 0.35, CRED_Y - 1.75))
    build_lighting()
    bpy.context.scene.unit_settings.system = "METRIC"
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "room.blend"))
    log("saved room.blend")
    export_glb()


if __name__ == "__main__":
    try:
        main()
        log("OK")
    except Exception:
        log(traceback.format_exc())
    finally:
        os.makedirs(OUT, exist_ok=True)
        with open(LOG, "w") as f:
            f.write("\n".join(_log))
