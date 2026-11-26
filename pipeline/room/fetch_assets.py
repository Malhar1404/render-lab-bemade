"""Download the CC0 Poly Haven assets the room uses into .cache/.

Run with plain Python (not Blender):  python pipeline/room/fetch_assets.py
Files already in the cache are skipped.
"""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
UA = {"User-Agent": "asset-fetch/1.0"}

# id -> resolution. Texture maps: diffuse, OpenGL normal, roughness.
TEXTURES = {
    "laminate_floor_02": "4k",  # oak floor planks, 1.7 m tile
    "hessian_380": "2k",  # rug weave, 0.27 m tile
    "white_plaster_02": "2k",  # wall paint texture, 1 m tile
    "american_walnut_veneer": "2k",  # credenza, 1 m tile
    "marble_01": "2k",  # credenza top + stand-in table top, 1.5 m tile
    "rough_linen": "2k",  # curtains
}
MODELS = {"potted_plant_01": "2k"}
HDRIS = {"suburban_garden": "8k"}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        return json.load(r)


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print("get", os.path.relpath(path, CACHE))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        data = r.read()
    with open(path, "wb") as f:
        f.write(data)


def main():
    for asset, res in TEXTURES.items():
        files = get_json(f"https://api.polyhaven.com/files/{asset}")
        for key, name in (("Diffuse", "diff"), ("nor_gl", "nor"), ("Rough", "rough")):
            if key in files:
                url = files[key][res]["jpg"]["url"]
                download(url, os.path.join(CACHE, "tex", asset, f"{name}.jpg"))
    for asset, res in MODELS.items():
        files = get_json(f"https://api.polyhaven.com/files/{asset}")
        g = files["gltf"][res]["gltf"]
        base = os.path.join(CACHE, "models", asset)
        download(g["url"], os.path.join(base, os.path.basename(g["url"])))
        for rel, inc in g.get("include", {}).items():
            download(inc["url"], os.path.join(base, rel))
    for asset, res in HDRIS.items():
        files = get_json(f"https://api.polyhaven.com/files/{asset}")
        download(files["hdri"][res]["hdr"]["url"], os.path.join(CACHE, "hdri", f"{asset}_{res}.hdr"))
    print("done")


if __name__ == "__main__":
    main()
