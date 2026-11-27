"""Turn baked light maps into the viewer's images, and publish the probe.

python pipeline/room/post_bake.py [mood=evening]

Day (since 2026-11-27): out/bake/lm_<group>_dn.exr (the OIDN-denoised bake,
denoise_lm.py; the raw lm_<group>.exr if there is none) -> lm_<group>.png,
RGBM-encoded (see encode_rgbm), lossless. 8-bit light / 4 in sRGB left few
steps in the dark corners, and JPEG / lossy WebP and an OpenCV denoise on
top gave the walls a smudgy "crayon" look. Room.tsx decodes it (rgbm).
Evening (still the old way until it is rebaked): lm_<group>.exr ->
lm_<group>.jpg, light / LIGHT_SCALE, sRGB, lightly denoised. The 360 probe goes to
public/env/room_2k.hdr, its colour cast mostly neutralised, and a small
tonemapped JPG of it for the dev log: out/probe_<mood>_preview.jpg.
"""
import glob
import os
import sys

os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2  # noqa: E402
import numpy as np  # noqa: E402

MOOD = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("mood=")), "day")
SUFFIX = "" if MOOD == "day" else f"_{MOOD}"
HERE = os.path.dirname(os.path.abspath(__file__))
BAKE = os.path.join(HERE, "out", f"bake{SUFFIX}")
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
# Light maps hold light / 4, so 8 bits can hold the bright sun patches
# (Room.tsx: LIGHT_MAP_INTENSITY).
# Evening is dimmer: light / 2 keeps more 8-bit steps in its shadows
# (the viewer's mood config carries the matching scale).
LIGHT_SCALE = {"day": 4.0, "evening": 2.0}[MOOD]
# How far the probe's colour cast is pulled to neutral (0 none, 1 fully).
# Evening keeps more of its lamp-warm cast: that is the mood.
NEUTRALIZE = {"day": 0.7, "evening": 0.35}[MOOD]
PROBE_OUT = "room_2k.hdr" if MOOD == "day" else f"room{SUFFIX}_2k.hdr"
PREVIEW_WIDTH = 1024
ENCODING = {"day": "rgbm", "evening": "srgb"}[MOOD]
# Brightest light an RGBM map holds (must match Room.tsx RGBM_RANGE).
RGBM_RANGE = 4.0


def encode_rgbm(lin):
    """Linear light (BGR floats) -> 8-bit BGRA, RGBM in gamma 2.2:
    g = (light / RANGE) ^ (1 / 2.2); alpha = max(g) rounded up to 1/255;
    colour = g / alpha. Decode: (colour * alpha) ^ 2.2 * RANGE. The shared
    multiplier gives dark pixels as many steps as bright ones."""
    g = np.clip(lin / RGBM_RANGE, 0, 1) ** (1 / 2.2)
    m = np.clip(np.ceil(g.max(axis=2, keepdims=True) * 255) / 255, 1 / 255, 1)
    rgb = np.clip(np.round(g / m * 255), 0, 255)
    return np.concatenate([rgb, np.round(m * 255)], axis=2).astype(np.uint8)


def light_map_sources():
    """Each group's best bake: the denoised one, else the raw one."""
    found = {}
    for path in sorted(glob.glob(os.path.join(BAKE, "lm_*.exr"))):
        name = os.path.basename(path)[3:-4]
        if name.endswith(("_old", "_old_dn", "_2048s", "_2048s_dn")):
            continue
        if name.endswith("_dn"):
            found[name[:-3]] = path
        else:
            found.setdefault(name, path)
    return found


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def write_probe_preview(hdr, path, width=PREVIEW_WIDTH):
    """Tonemapped JPG of a linear HDR (BGR floats), for looking at in the dev log:
    simple Reinhard (c / (1 + c)), then gamma 2.2, about `width` px wide."""
    h, w = hdr.shape[:2]
    small = cv2.resize(hdr, (width, max(1, round(h * width / w))), interpolation=cv2.INTER_AREA)
    c = np.maximum(small, 0)
    ldr = (c / (1 + c)) ** (1 / 2.2)
    cv2.imwrite(path, (np.clip(ldr, 0, 1) * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])


def main():
    for group, path in light_map_sources().items():
        lin = cv2.imread(path, cv2.IMREAD_UNCHANGED)[:, :, :3].astype(np.float32)
        if ENCODING == "rgbm":
            out = os.path.join(BAKE, f"lm_{group}.png")
            cv2.imwrite(out, encode_rgbm(lin), [cv2.IMWRITE_PNG_COMPRESSION, 6])
            print(os.path.basename(out), "from", os.path.basename(path), lin.shape,
                  "mean light", round(float(lin.mean()), 4), "max", round(float(lin.max()), 3),
                  "clipped above", RGBM_RANGE)
            continue
        img = (to_srgb(lin / LIGHT_SCALE) * 255).astype(np.uint8)
        # Light touch: the bake is clean at 512 samples, and walls go soft fast.
        img = cv2.fastNlMeansDenoisingColored(img, None, 2, 2, 5, 11)
        out = path.replace(".exr", ".jpg")
        cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print(os.path.basename(out), img.shape, "mean light", round(float(lin.mean()), 4),
              "p99.5", round(float(np.percentile(lin, 99.5)), 3), "clipped above", LIGHT_SCALE)
    probe = os.path.join(BAKE, "room_probe.hdr")
    if os.path.exists(probe):
        # Pull the probe's overall colour most of the way to neutral, so the
        # warm room doesn't tint white tops; brightness and contrast stay.
        hdr = cv2.imread(probe, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR).astype(np.float32)
        mean = hdr.reshape(-1, 3).mean(0)
        gain = 1 + NEUTRALIZE * (mean.mean() / mean - 1)
        hdr *= gain[None, None, :]
        cv2.imwrite(os.path.join(REPO, "public", "env", PROBE_OUT), hdr)
        print("probe -> public/env/" + PROBE_OUT, "mean", mean.round(4),
              "white balance gain (BGR)", gain.round(3))
        preview = os.path.join(HERE, "out", f"probe_{MOOD}_preview.jpg")
        write_probe_preview(hdr, preview)
        print("preview -> pipeline/room/out/" + os.path.basename(preview))


if __name__ == "__main__":
    main()
