"""Grade the downloaded textures to the room's palette.

Run with plain Python (opencv-python, numpy):
    python pipeline/room/prepare_textures.py

Each colour map is scaled (in linear light) so its average matches a target
colour, keeping its own variation; contrast can be softened. The results go
to out/tex/<name>.jpg; normal and roughness maps are used as downloaded.
"""
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache", "tex")
OUT = os.path.join(HERE, "out", "tex")

# name: (source, target average sRGB, contrast 0..1)
GRADES = {
    # Light natural oak, a warm honey tone (reference renders).
    "floor_oak": ("laminate_floor_02", (184, 158, 130), 0.95),
    # Heathered greige wool rug.
    # Smoked walnut for the credenza: dark grey-brown, strong figure.
    "walnut": ("american_walnut_veneer", (76, 60, 48), 1.4),
    # Sheer off-white voile and a heavier greige linen drape.
    "sheer": ("rough_linen", (236, 233, 227), 0.35),
    "linen": ("rough_linen", (196, 186, 170), 0.7),
    # Warm white wall paint (plaster texture, very soft).
    "paint": ("white_plaster_02", (214, 203, 188), 0.3),
    # Light grey concrete: planter pots and the terrace outside.
    "concrete": ("white_plaster_02", (178, 174, 168), 0.6),
    # Warm grey stone paving outside the window.
    "terrace": ("white_plaster_02", (140, 135, 126), 0.7),
    # White marble with grey veins (credenza top, stand-in table top).
    "marble": ("marble_01", (226, 224, 221), 1.0),
}


def to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (src, target, contrast) in GRADES.items():
        img = cv2.imread(os.path.join(CACHE, src, "diff.jpg"))[:, :, ::-1].astype(np.float32)
        lin = to_lin(img)
        mean = lin.reshape(-1, 3).mean(0)
        # Soften contrast around the mean (on luminance-ish ratio), then
        # scale each channel to the target.
        lin = mean + (lin - mean) * contrast
        lin = lin / np.maximum(mean, 1e-4) * to_lin(np.array(target, np.float32))
        out = to_srgb(lin)[:, :, ::-1]
        cv2.imwrite(os.path.join(OUT, f"{name}.jpg"), out.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])
        print(name, "from", src, "mean ->", target)


def make_rug(size=2048, tile_m=1.0, target=(132, 124, 114)):
    """A heathered wool rug, 1 m tile: fine loop pile from the hessian weave
    (repeated at its real 0.27 m scale), blended fibre colours, soft cloudy
    variation and a few darker flecks. Writes colour and a pile normal map."""
    rng = np.random.default_rng(3)
    weave = cv2.imread(os.path.join(CACHE, "hessian_380", "diff.jpg"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    reps = max(int(round(tile_m / 0.274)), 1)
    weave = cv2.resize(weave, (size // reps, size // reps), interpolation=cv2.INTER_AREA)
    weave = np.tile(weave, (reps, reps))[:size, :size]
    weave = cv2.resize(weave, (size, size))
    weave = (weave - weave.mean()) / (weave.std() + 1e-6)

    def noise(scale, octaves=3):
        acc = np.zeros((size, size), np.float32)
        amp = 1.0
        for o in range(octaves):
            n = rng.standard_normal((size // scale + 2, size // scale + 2)).astype(np.float32)
            # Wrap so the tile repeats seamlessly.
            n[-2:, :] = n[:2, :]
            n[:, -2:] = n[:, :2]
            n = cv2.resize(n, (size + 2 * scale, size + 2 * scale), interpolation=cv2.INTER_CUBIC)[scale:scale + size, scale:scale + size]
            acc += amp * n
            amp *= 0.5
            scale = max(scale // 2, 1)
        return (acc - acc.mean()) / (acc.std() + 1e-6)

    cloud = noise(256)
    fibre = rng.standard_normal((size, size)).astype(np.float32)
    fibre = cv2.GaussianBlur(fibre, (0, 0), 0.8)
    fibre = (fibre - fibre.mean()) / (fibre.std() + 1e-6)
    flecks = (rng.random((size, size)) > 0.996).astype(np.float32)
    flecks = cv2.GaussianBlur(flecks, (0, 0), 1.2)
    flecks /= flecks.max() + 1e-6

    # Loom streaks: yarn tone varies along the weft (x).
    streak = rng.standard_normal((size, size)).astype(np.float32)
    streak = np.tile(cv2.GaussianBlur(np.tile(streak, (1, 3)), (0, 0), sigmaX=14, sigmaY=1.1)[:, size:2 * size], 1)
    streak = (streak - streak.mean()) / (streak.std() + 1e-6)
    lum = 1 + 0.08 * weave + 0.05 * cloud + 0.16 * streak + 0.08 * fibre - 0.3 * flecks
    # Heather: some fibres warmer, some cooler.
    hue = cv2.GaussianBlur(rng.standard_normal((size, size)).astype(np.float32), (0, 0), 1.0)
    hue = hue / (hue.std() + 1e-6)
    tgt = to_lin(np.array(target, np.float32))
    warm = np.array([1.04, 1.0, 0.95], np.float32)
    col = tgt[None, None, :] * lum[..., None] * (1 + 0.05 * hue[..., None] * (warm - 1) / 0.05)
    col = to_srgb(np.clip(col, 0, 1))
    cv2.imwrite(os.path.join(OUT, "rug_wool.jpg"), col[:, :, ::-1].astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])

    # Normal map (OpenGL, +Y up) from a pile height field.
    height = 0.6 * weave + 0.5 * fibre + 0.3 * cloud + 0.6 * streak
    # Central differences that wrap, so the tile stays seamless.
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 2
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 2
    k = 0.6
    n = np.dstack([-gx * k, gy * k, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    nrm = ((n * 0.5 + 0.5) * 255).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, "rug_wool_nor.png"), nrm[:, :, ::-1])
    print("rug_wool generated")


def make_rug_pile(src="Carpet013", dark=(84, 78, 70), light=(176, 168, 156)):
    """ambientCG carpet scan recoloured: its fibre tones mapped onto a greige
    two-tone heather, with its ambient occlusion folded in for depth."""
    p = os.path.join(CACHE, "acg", src, f"{src}_2K-JPG_")
    col = cv2.imread(p + "Color.jpg")[:, :, ::-1].astype(np.float32)
    ao = cv2.imread(p + "AmbientOcclusion.jpg", 0).astype(np.float32) / 255
    lum = to_lin(col).mean(2)
    lo, hi = np.percentile(lum, 2), np.percentile(lum, 98)
    t = np.clip((lum - lo) / (hi - lo), 0, 1)[..., None]
    c = to_lin(np.array(dark, np.float32)) * (1 - t) + to_lin(np.array(light, np.float32)) * t
    c = c * ao[..., None] ** 0.6
    cv2.imwrite(os.path.join(OUT, "rug_pile.jpg"), to_srgb(c)[:, :, ::-1].astype(np.uint8),
                [cv2.IMWRITE_JPEG_QUALITY, 92])
    print("rug_pile from", src)


def make_leaf(w=512, h=1024):
    """Fiddle-leaf fig leaf (UV: u across, v base to tip): deep glossy green,
    a pale midrib and curved lateral veins, slight mottling. Colour + normal."""
    rng = np.random.default_rng(5)
    u = np.linspace(-1, 1, w)[None, :].repeat(h, 0)
    v = np.linspace(0, 1, h)[:, None].repeat(w, 1)
    mid = np.exp(-(u / 0.018) ** 2)
    # Lateral veins rise from the midrib towards the tip, curving.
    phase = (v * 9.0 - np.abs(u) * 2.2) * 2 * np.pi
    lateral = np.clip(np.cos(phase), 0, 1) ** 40 * (np.abs(u) > 0.02) * (1 - np.abs(u) ** 2)
    mottle = cv2.GaussianBlur(rng.standard_normal((h, w)).astype(np.float32), (0, 0), 18)
    mottle /= mottle.std() + 1e-6
    base = to_lin(np.array((38, 66, 30), np.float32))
    vein = to_lin(np.array((120, 150, 80), np.float32))
    c = base[None, None] * (1 + 0.12 * mottle[..., None] - 0.15 * np.abs(u)[..., None])
    c = c * (1 - 0.7 * mid[..., None]) + vein * 0.7 * mid[..., None]
    c = c * (1 - 0.35 * lateral[..., None]) + vein * 0.35 * lateral[..., None]
    cv2.imwrite(os.path.join(OUT, "fig_leaf.jpg"), to_srgb(c)[:, :, ::-1].astype(np.uint8),
                [cv2.IMWRITE_JPEG_QUALITY, 92])
    height = -0.8 * mid - 0.5 * lateral + 0.05 * mottle
    height = cv2.GaussianBlur(height.astype(np.float32), (0, 0), 1.5)
    gx = np.gradient(height, axis=1) * 40
    gy = np.gradient(height, axis=0) * 40
    n = np.dstack([-gx, gy, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    cv2.imwrite(os.path.join(OUT, "fig_leaf_nor.png"), ((n * 0.5 + 0.5) * 255).astype(np.uint8)[:, :, ::-1])
    print("fig_leaf generated")


def _pblur(img, sx, sy):
    """Gaussian blur that wraps around (periodic), so tiles stay seamless."""
    h, w = img.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * ((fx * sx) ** 2 + (fy * sy) ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(img) * g)).astype(np.float32)


def _norm(a):
    return (a - a.mean()) / (a.std() + 1e-6)


def make_loomed_rug(size=2048, tile_m=1.0, dark=(80, 78, 74), light=(180, 175, 166)):
    """A hand-loomed wool rug as a seamless tile (1 m at 2048 px, about
    0.5 mm per pixel), rows along u: yarn rows about 4 mm apart, each with
    its own tone; soft streaks along the rows (abrash) 5-25 cm long;
    heathered fibres from the Carpet013 scan; loose fibre tips. Colour and a
    pile normal map. Every layer wraps, so the tile repeats without seams."""
    rng = np.random.default_rng(21)
    S = size
    row_px = 8
    n_rows = S // row_px
    yy = np.arange(S)[:, None]
    row_id = (yy // row_px) % n_rows
    row_tone = _norm(_pblur(rng.standard_normal((n_rows, 1)).astype(np.float32).repeat(1, 1), 0.0001, 1.0))
    rows = row_tone[row_id, 0]
    # Streaks: per row band, tone drifting along the row.
    streak = _norm(_pblur(rng.standard_normal((S, S)).astype(np.float32), sx=60, sy=3))
    cloud = _norm(_pblur(rng.standard_normal((S, S)).astype(np.float32), sx=300, sy=300))
    fib = cv2.imread(os.path.join(CACHE, "acg", "Carpet013", "Carpet013_2K-JPG_Color.jpg")).astype(np.float32).mean(2)
    half = S // 2
    fib = cv2.resize(fib, (half, half), interpolation=cv2.INTER_AREA)
    fib = _norm(np.tile(fib, (2, 2)))
    jitter = rng.uniform(0, 1, n_rows)[row_id[:, 0]][:, None]
    wob = _norm(_pblur(rng.standard_normal((S, S)).astype(np.float32), sx=10, sy=1.5))
    ridge = np.cos(2 * np.pi * ((yy % row_px) / row_px + jitter + 0.12 * wob)).astype(np.float32)
    tips = _norm(_pblur(rng.standard_normal((S, S)).astype(np.float32), sx=1.2, sy=1.2))

    t = 0.5 + 0.06 * rows + 0.07 * streak + 0.04 * cloud + 0.16 * fib + 0.06 * ridge + 0.08 * tips
    t = np.clip(t, 0, 1)[..., None]
    c = to_lin(np.array(dark, np.float32)) * (1 - t) + to_lin(np.array(light, np.float32)) * t
    c *= (0.9 + 0.1 * (ridge * 0.5 + 0.5))[..., None]
    cv2.imwrite(os.path.join(OUT, "rug_loomed.jpg"), to_srgb(c)[:, :, ::-1].astype(np.uint8),
                [cv2.IMWRITE_JPEG_QUALITY, 92])

    height = 0.8 * ridge + 0.6 * fib + 0.4 * tips + 0.2 * streak
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.3
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.3
    n = np.dstack([-gx, gy, np.ones_like(gx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    cv2.imwrite(os.path.join(OUT, "rug_loomed_nor.jpg"), ((n * 0.5 + 0.5) * 255).astype(np.uint8)[:, :, ::-1],
                [cv2.IMWRITE_JPEG_QUALITY, 95])
    print("rug_loomed tile", S)


def make_rug_fuzz(size=1024, tile_m=0.25, dark=(80, 78, 74), light=(180, 175, 166)):
    """Loose wool fibres for the rug's fuzz layers and edge fringe (RGBA, 1
    tile = 0.25 m): thousands of short curved strokes, alpha = fibre."""
    rng = np.random.default_rng(9)
    alpha = np.zeros((size, size), np.float32)
    tone = np.zeros((size, size), np.float32)
    n = 9000
    for _ in range(n):
        x, y = rng.uniform(0, size, 2)
        ang = rng.uniform(0, np.pi)
        ln = rng.uniform(4, 12)
        bend = rng.uniform(-0.6, 0.6)
        pts = []
        for k in range(5):
            t = k / 4
            a = ang + bend * t
            pts.append((x + np.cos(a) * ln * t, y + np.sin(a) * ln * t))
        pts = np.array(pts, np.int32)
        v = float(rng.uniform(0.2, 1.0))
        for dx in (-size, 0, size):
            for dy in (-size, 0, size):
                cv2.polylines(alpha, [pts + (dx, dy)], False, 1.0, 1, cv2.LINE_AA)
                cv2.polylines(tone, [pts + (dx, dy)], False, v, 1, cv2.LINE_AA)
    t = np.clip(tone / np.maximum(alpha, 1e-3), 0, 1)[..., None]
    c = to_lin(np.array(dark, np.float32)) * (1 - t) + to_lin(np.array(light, np.float32)) * t
    rgb = to_srgb(c).astype(np.uint8)
    a = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, "rug_fuzz.png"), np.dstack([rgb[:, :, ::-1], a]))
    print("rug_fuzz generated")


if __name__ == "__main__":
    make_rug_fuzz()
    main()
    make_rug()
    make_rug_pile()
    make_loomed_rug()
    make_leaf()
