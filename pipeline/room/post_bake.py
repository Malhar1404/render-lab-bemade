"""Turn baked light maps into the viewer's JPEGs, and publish the probe.

python pipeline/room/post_bake.py

out/bake/lm_<group>.exr (linear diffuse light) -> out/bake/lm_<group>.jpg:
light / LIGHT_SCALE, sRGB-encoded, lightly denoised. Room.tsx multiplies
back by LIGHT_SCALE (its LIGHT_MAP_INTENSITY). The 360 probe goes to
public/env/room_2k.hdr, its colour cast mostly neutralised.
"""
import glob
import os

os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2  # noqa: E402
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
BAKE = os.path.join(HERE, "out", "bake")
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
# Light maps hold light / 4, so 8 bits can hold the bright sun patches
# (Room.tsx: LIGHT_MAP_INTENSITY).
LIGHT_SCALE = 4.0
# How far the probe's colour cast is pulled to neutral (0 none, 1 fully).
NEUTRALIZE = 0.7


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def main():
    for path in sorted(glob.glob(os.path.join(BAKE, "lm_*.exr"))):
        lin = cv2.imread(path, cv2.IMREAD_UNCHANGED)[:, :, :3].astype(np.float32)
        img = (to_srgb(lin / LIGHT_SCALE) * 255).astype(np.uint8)
        # Light touch: the bake is clean at 512 samples, and walls go soft fast.
        img = cv2.fastNlMeansDenoisingColored(img, None, 2, 2, 5, 11)
        out = path.replace(".exr", ".jpg")
        cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print(os.path.basename(out), img.shape, "mean light", float(lin.mean()))
    probe = os.path.join(BAKE, "room_probe.hdr")
    if os.path.exists(probe):
        # Pull the probe's overall colour most of the way to neutral, so the
        # warm room doesn't tint white tops; brightness and contrast stay.
        hdr = cv2.imread(probe, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR).astype(np.float32)
        mean = hdr.reshape(-1, 3).mean(0)
        gain = 1 + NEUTRALIZE * (mean.mean() / mean - 1)
        hdr *= gain[None, None, :]
        cv2.imwrite(os.path.join(REPO, "public", "env", "room_2k.hdr"), hdr)
        print("probe -> public/env/room_2k.hdr, white balance gain (BGR)", gain.round(3))


if __name__ == "__main__":
    main()
