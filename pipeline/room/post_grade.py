"""Photographic finish for preview renders: soft bloom on the brightest
parts (window, sun patches) and a gentle vignette.

python pipeline/room/post_grade.py <png> [<png> ...]   -> <name>_graded.png
"""
import sys

import cv2
import numpy as np

for path in sys.argv[1:]:
    img = cv2.imread(path).astype(np.float32) / 255
    h, w, _ = img.shape
    lum = img.mean(2, keepdims=True)
    bright = img * np.clip((lum - 0.75) / 0.25, 0, 1)
    bloom = cv2.GaussianBlur(bright, (0, 0), w / 60) * 0.6 + cv2.GaussianBlur(bright, (0, 0), w / 200) * 0.3
    out = 1 - (1 - img) * (1 - bloom)  # screen
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    out *= (1 - 0.22 * np.clip(r - 0.45, 0, 1) ** 1.6)[..., None]
    cv2.imwrite(path.replace(".png", "_graded.png"), np.clip(out * 255, 0, 255).astype(np.uint8))
