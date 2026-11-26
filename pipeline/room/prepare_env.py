"""Turn the garden HDRI into the room's sky: no sun, garden behind the window.

Run with plain Python (needs opencv-python, numpy):
    python pipeline/room/prepare_env.py

- Rolls the panorama so the shrub border and tree sit behind the window
  wall (+Y in Blender, -Z in three.js; both sample u = 0.25 there).
- Paints the sun out. The room gets its sun from a separate sun light, at an
  angle we choose, so the HDRI's own sun must not light it twice.
- Measures the sun it removed (irradiance, in the HDRI's units) and writes it
  to env.json: the sun light's strength, so sun and sky stay in balance.
"""
import json
import math
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, ".cache", "hdri", "suburban_garden_8k.hdr")
OUT = os.path.join(HERE, "out", "env")

# The source column that should face the window's centre.
WINDOW_CENTRE_U = 0.27
WINDOW_U = 0.25
# Radius painted out around the sun, in degrees (disk plus lens flare).
SUN_RADIUS_DEG = 4.0
# Radius of the flare glow, blended out into the surrounding sky.
GLOW_RADIUS_DEG = 14.0


def main():
    os.makedirs(OUT, exist_ok=True)
    im = cv2.imread(SRC, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR).astype(np.float32)
    h, w, _ = im.shape

    shift = int(round((WINDOW_U - WINDOW_CENTRE_U) * w))
    im = np.roll(im, shift, axis=1)

    lum = im.mean(axis=2)
    blur = cv2.GaussianBlur(lum, (31, 31), 0)
    sy, sx = np.unravel_index(np.argmax(blur), lum.shape)
    sun_u, sun_v = (sx + 0.5) / w, (sy + 0.5) / h
    elevation = 90 - 180 * sun_v

    # Pixel solid angles (equirect): dphi * dtheta * sin(polar).
    polar = (np.arange(h) + 0.5) / h * math.pi
    d_omega = (2 * math.pi / w) * (math.pi / h) * np.sin(polar)

    r_px = int(math.ceil(SUN_RADIUS_DEG / 180 * h))
    y0, y1 = max(sy - r_px, 0), min(sy + r_px + 1, h)
    yy, xx = np.mgrid[y0:y1, 0:w]
    dx = np.minimum(abs(xx - sx), w - abs(xx - sx)) * math.sin(polar[sy])
    mask_band = (dx ** 2 + (yy - sy) ** 2) <= r_px ** 2
    mask = np.zeros((h, w), np.uint8)
    mask[y0:y1][mask_band] = 1

    # The sky just outside the disk, to fill it with.
    ring = cv2.dilate(mask, np.ones((25, 25), np.uint8)) - mask
    sky = np.median(im[ring > 0], axis=0)

    removed = (im - sky) * mask[..., None]
    removed = np.clip(removed, 0, None)
    # Irradiance on a surface facing the sun: sum of L * d_omega.
    irr = (removed * d_omega[:, None, None]).sum(axis=(0, 1))

    # Fill the glow region with the sky around it (normalized convolution:
    # blur of the image outside the glow / blur of the outside mask), blended
    # in with a feathered edge.
    g_px = int(math.ceil(GLOW_RADIUS_DEG / 180 * h))
    gy0, gy1 = max(sy - 2 * g_px, 0), min(sy + 2 * g_px + 1, h)
    gyy, gxx = np.mgrid[gy0:gy1, 0:w]
    gdx = np.minimum(abs(gxx - sx), w - abs(gxx - sx)) * math.sin(polar[sy])
    dist = np.sqrt(gdx ** 2 + (gyy - sy) ** 2) / g_px
    crop = im[gy0:gy1].copy()
    outside = (dist > 1).astype(np.float32)
    sigma = g_px / 2
    num = cv2.GaussianBlur(crop * outside[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(outside, (0, 0), sigma)[..., None] + 1e-6
    smooth = num / den
    # Repeat so the centre (far from any outside pixel) fills in too.
    for _ in range(4):
        num = cv2.GaussianBlur(smooth * (1 - outside[..., None]) + crop * outside[..., None], (0, 0), sigma)
        smooth = num
    weight = np.clip((1.3 - dist) / 0.3, 0, 1)[..., None]
    crop = crop * (1 - weight) + smooth * weight
    filled = im.copy()
    filled[gy0:gy1] = crop
    # Any remaining flare streaks: cap at the brightest normal sky.
    cap = np.percentile(lum, 99.5) * 1.5
    filled = np.minimum(filled, cap)

    for size, name in ((w, "8k"), (4096, "4k"), (2048, "2k"), (1024, "1k")):
        img = filled if size == w else cv2.resize(filled, (size, size // 2), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(OUT, f"garden_{name}.hdr"), img)

    rgb_irr = irr[::-1].tolist()  # BGR -> RGB
    info = {
        "source": os.path.basename(SRC),
        "roll_u": shift / w,
        "hdri_sun_u": sun_u,
        "hdri_sun_elevation_deg": elevation,
        "sun_irradiance_rgb": rgb_irr,
        "sky_median": float(np.median(lum)),
    }
    with open(os.path.join(OUT, "env.json"), "w") as f:
        json.dump(info, f, indent=2)
    print(json.dumps(info, indent=2))

    prev = filled / (np.median(filled) * 4)
    prev = np.clip(prev / (1 + prev), 0, 1) ** (1 / 2.2)
    cv2.imwrite(os.path.join(HERE, "out", "garden_prev.jpg"), (cv2.resize(prev, (1600, 800)) * 255).astype(np.uint8))


if __name__ == "__main__":
    main()
