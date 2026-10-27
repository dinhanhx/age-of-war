#!/usr/bin/env python3
"""Build-time asset packer. Reads references/age_of_war_decompiled (per-frame PNG renders of the
original Flash game) and writes trimmed, de-duplicated, frame-decimated WebP atlases + assets/meta.json.

Usage: python3 -I tools/pack.py
"""
import glob
import hashlib
import json
import math
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "references", "age_of_war_decompiled")
SPR = os.path.join(REF, "sprites")
SCR = os.path.join(REF, "scripts")
OUT = os.path.join(ROOT, "assets")

sys.path.insert(0, os.path.join(ROOT, "tools"))
from unitmap import UNITS  # noqa: E402

# max frames kept per state (frames are decimated by an integer step; sim timing keeps original ticks)
LIMIT = dict(idle=10, walk=20, attack=30, die=16, shoot=20, shootwalk=20)
AGE_UNITS = {1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12], 5: [13, 14, 15]}
ATLAS_W = 2048


def frames_of(sid):
    g = glob.glob(os.path.join(SPR, "DefineSprite_%s" % sid, "*.png"))
    g += glob.glob(os.path.join(SPR, "DefineSprite_%s_*" % sid, "*.png"))
    return sorted(g, key=lambda p: int(os.path.basename(p)[:-4]))


def load(p):
    return Image.open(p).convert("RGBA")


class Atlas:
    """Shelf packer. add() returns an id; save() writes the image and returns rect list."""

    def __init__(self):
        self.items = []  # (img, key)
        self.keys = {}

    def add(self, img, key=None):
        if key is not None and key in self.keys:
            return self.keys[key]
        i = len(self.items)
        self.items.append(img)
        if key is not None:
            self.keys[key] = i
        return i

    def _shelf(self, width):
        order = sorted(range(len(self.items)), key=lambda i: -self.items[i].height)
        rects = [None] * len(self.items)
        x = y = shelf = 0
        for i in order:
            w, h = self.items[i].size
            if x + w + 1 > width:
                x, y, shelf = 0, y + shelf + 1, 0
            rects[i] = [x, y, w, h]
            x += w + 1
            shelf = max(shelf, h)
        used_w = max((r[0] + r[2] for r in rects), default=1)
        return rects, (used_w, y + shelf)

    def save(self, path):
        widest = max((im.width for im in self.items), default=1) + 1
        best = None
        for width in (512, 640, 768, 896, 1024, 1280, 1536, 1792, ATLAS_W):
            if width < widest:
                continue
            rects, (w, h) = self._shelf(width)
            if best is None or w * h < best[1][0] * best[1][1]:
                best = (rects, (w, h))
        rects, (used_w, H) = best
        sheet = Image.new("RGBA", (used_w, max(H, 1)), (0, 0, 0, 0))
        for i, (rx, ry, _, _) in enumerate(rects):
            sheet.paste(self.items[i], (rx, ry))
        sheet.save(path, "WEBP", lossless=True, quality=100, method=6)
        return rects, (used_w, H)


def trim(img):
    bb = img.getbbox()
    if not bb:
        return None, (0, 0)
    return img.crop(bb), (bb[0], bb[1])


def feet_x(img):
    """Horizontal centroid of the lowest rows of opaque pixels (where the unit stands)."""
    bb = img.getbbox()
    if not bb:
        return img.width / 2
    a = img.split()[3]
    top = max(bb[1], bb[3] - 6)
    xs = tot = 0
    px = a.load()
    for yy in range(top, bb[3]):
        for xx in range(bb[0], bb[2]):
            v = px[xx, yy]
            if v > 40:
                xs += xx * v
                tot += v
    return xs / tot if tot else img.width / 2


def strip_icon(img):
    """Death clips contain a small yellow angry-face icon (every 7th frame) below the feet. It is a
    separate blob of ~24x24 px, so remove connected components of that size that are mostly yellow."""
    import numpy as np
    from scipy import ndimage
    a = np.array(img)
    mask = a[..., 3] > 0
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n < 2:
        return img
    changed = False
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if not (18 <= w <= 30 and 18 <= h <= 30):
            continue
        comp = lab[sl] == i
        px = a[sl][comp]
        yellow = ((px[:, 0] > 230) & (px[:, 1] > 200) & (px[:, 2] < 90)).mean()
        if yellow > 0.35:
            a[sl][comp] = 0
            changed = True
    return Image.fromarray(a) if changed else img


def hit_frames(sid):
    out = []
    for p in glob.glob(os.path.join(SCR, "DefineSprite_%s" % sid, "frame_*", "DoAction*.as")):
        f = int(re.search(r"frame_(\d+)", p).group(1))
        s = open(p).read()
        if re.search(r"ranged_hit\(\)", s):
            out.append([f, "r"])
        if re.search(r"(?<!ranged_)hit\(\)", s):
            out.append([f, "m"])
    return sorted(out)


def pack_clip(atlas, sid, state, cache):
    """Pack one animation clip into atlas; return clip meta (cached by sprite id + limit)."""
    key = (sid, state)
    if key in cache:
        return cache[key]
    fs = frames_of(sid)
    n = len(fs)
    step = max(1, math.ceil(n / LIMIT[state]))
    die = state == "die"
    first = load(fs[0])
    if die:
        first = strip_icon(first)
    ax = feet_x(first)
    ay = first.height
    if die:
        # canvas bottom is not the ground (the icon sat below the feet); use the lowest body pixel
        ay = 0
        for f in fs:
            bb = strip_icon(load(f)).getbbox()
            if bb:
                ay = max(ay, bb[3])
    picks = list(range(0, n, step))
    if die and picks[-1] != n - 1:
        picks.append(n - 1)  # always keep the real final (lying) frame
    idx = []
    seen = {}
    for i in picks:
        im = load(fs[i])
        if die:
            im = strip_icon(im)
        t, (ox, oy) = trim(im)
        if t is None:
            idx.append(None)
            continue
        h = hashlib.md5(t.tobytes() + bytes((ox & 255, oy & 255, t.width & 255, t.height & 255))).hexdigest()
        if h not in seen:
            seen[h] = [atlas.add(t), ox, oy]
        idx.append(seen[h])
    meta = dict(n=n, step=step, ax=round(ax, 1), ay=ay, f=idx, hit=hit_frames(sid))
    if die:
        meta["last"] = 1
    cache[key] = meta
    return meta


def pack_units(meta):
    meta["units"] = {}
    meta["atlases"] = {}
    cache = {}
    for age, ids in AGE_UNITS.items():
        atlas = Atlas()
        clips = {}
        for u in ids:
            states = UNITS[u]
            st = {}
            for s, sid in states.items():
                st[s] = pack_clip(atlas, sid, s, cache)
            if "walk" not in st:
                st["walk"] = st["idle"]
            if "shoot" not in st and u in (2, 5, 8, 11, 14):
                st["shoot"] = st["attack"]
            clips[u] = st
        name = "units%d.webp" % age
        rects, size = atlas.save(os.path.join(OUT, name))
        meta["atlases"]["units%d" % age] = dict(file=name, size=size, rects=rects)
        for u in ids:
            meta["units"][str(u)] = dict(age=age, atlas="units%d" % age, clips=clips[u])
    # unit 16 (Super Soldier) reuses unit 14 art
    meta["units"]["16"] = dict(meta["units"]["14"])
    meta["hit_units"] = {}


def pack_hitzones(meta):
    hz = {}
    for i in range(1, 17):
        im = load(os.path.join(SPR, "DefineSprite_695", "%d.png" % i))
        bb = im.getbbox()
        hz[str(i)] = [bb[2] - bb[0], 69 - bb[1]]  # width, height (bottom edge is ground)
    meta["hitzone"] = hz


def pack_world(meta):
    atlas = Atlas()
    w = {}

    def single(name, sid, frame=1):
        t, off = trim(load(os.path.join(SPR, glob.glob(os.path.join(SPR, "DefineSprite_%s*" % sid))[0], "%d.png" % frame)))
        w[name] = [atlas.add(t, name), off[0], off[1]]

    def seq(name, sid, step=1):
        fs = frames_of(sid)
        out = []
        for f in fs[::step]:
            t, off = trim(load(f))
            out.append(None if t is None else [atlas.add(t), off[0], off[1]])
        w[name] = out

    def exact(sid, frame):
        return os.path.join(SPR, "DefineSprite_%s" % sid, "%d.png" % frame)

    # bases (231x168 canvas), add-ons: sizes constant per sprite, so one offset per sprite
    for a in range(1, 6):
        t, off = trim(load(exact(8, a)))
        w["base%d" % a] = [atlas.add(t), off[0], off[1]]
        for k, sid in ((1, 14), (2, 20), (3, 26)):
            t, off = trim(load(exact(sid, a)))
            w["add%d_%d" % (k, a)] = [atlas.add(t), off[0], off[1]]
    for i in range(1, 16):
        t, off = trim(load(exact(881, i)))
        w["tur%d" % i] = [atlas.add(t), off[0], off[1]]
    for i, sid in enumerate((917, 888, 915, 902, 901, 913, 911, 909, 907, 905, 904, 903), 1):
        if i != 5:  # bullet 5 (oil) has no art of its own
            single("bul%d" % i, sid)
    single("sp1", 896)
    single("sp2", 894)
    single("sp4", 892)
    single("plane", 973)
    for n, sid in (("blood", 949), ("dust", 929), ("chip", 923), ("spark", 899), ("fire", 948), ("p9", 925), ("p10", 927), ("p11", 898)):
        single(n, sid)
    seq("boomS", 931, step=2)
    seq("boomL", 930, step=2)
    single("aura", 698)
    rects, size = atlas.save(os.path.join(OUT, "world.webp"))
    meta["atlases"]["world"] = dict(file="world.webp", size=size, rects=rects)
    meta["world"] = w
    meta["canvas"] = dict(base=[231, 168], tur=[165, 62])


def strips(sid, frame):
    """Split an icon strip render into icon images (runs of non-empty columns)."""
    im = load(exact_path(sid, frame))
    a = im.split()[3]
    W, H = im.size
    cols = [any(a.getpixel((x, y)) > 8 for y in range(H)) for x in range(W)]
    runs, s = [], None
    for x, c in enumerate(cols + [False]):
        if c and s is None:
            s = x
        if not c and s is not None:
            if x - s >= 12:
                runs.append((s, x))
            s = None
    return [im.crop((a0, 0, b0, H)) for a0, b0 in runs]


def exact_path(sid, frame):
    return os.path.join(SPR, "DefineSprite_%s" % sid, "%d.png" % frame)


def pack_ui(meta):
    atlas = Atlas()
    ui = {"unit": {}, "turret": {}, "menu": [], "special": []}
    for age, ids in AGE_UNITS.items():
        icons = strips(142, age)
        icons = icons[:-1]  # the red "back" arrow is always the last icon of a strip
        want = ids + ([16] if age == 5 else [])
        assert len(icons) == len(want), ("unit icons", age, len(icons), want)
        for u, ic in zip(want, icons):
            ui["unit"][str(u)] = atlas.add(ic)
        ticons = strips(177, age)
        ticons = ticons[:-1]
        tids = [(age - 1) * 3 + k for k in (1, 2, 3)]
        assert len(ticons) == 3, ("turret icons", age, len(ticons))
        for t, ic in zip(tids, ticons):
            ui["turret"][str(t)] = atlas.add(ic)
    mi = strips(189, 1)
    assert len(mi) == 5, ("menu icons", len(mi))
    ui["menu"] = [atlas.add(i) for i in mi]
    for a in range(1, 6):
        ui["special"].append(atlas.add(load(exact_path(78, a))))
    rects, size = atlas.save(os.path.join(OUT, "ui.webp"))
    meta["atlases"]["ui"] = dict(file="ui.webp", size=size, rects=rects)
    meta["ui"] = ui


def pack_bg(meta):
    im = load(os.path.join(SPR, "DefineSprite_50_bg", "1.png"))
    top = 270
    # sky is a vertical gradient; the image has 19px of transparent margin on the left
    sky0 = im.getpixel((300, 0))[:3]
    sky1 = im.getpixel((300, top))[:3]
    crop = im.crop((20, top, 1030, 450)).convert("RGB")
    crop.save(os.path.join(OUT, "bg.webp"), "WEBP", quality=90, method=6)
    hx = lambda c: "#%02x%02x%02x" % c
    meta["bg"] = dict(file="bg.webp", top=top, sky0=hx(sky0), sky1=hx(sky1))


# sound ids used by the game (decompiled sounds/). Which sound belongs to which event is my guess,
# see js/audio.js. The 110 s music track is the only large file (2.2 MB).
SOUNDS = [234, 235, 239, 240, 241, 242, 243, 269, 314, 342, 347, 382, 451, 470, 480, 496, 524, 591, 656,
          680, 733, 745, 843, 972, 1002, 1035]


def copy_sounds(meta):
    import shutil
    snd = os.path.join(OUT, "snd")
    os.makedirs(snd, exist_ok=True)
    files = {}
    for sid in SOUNDS:
        for ext in ("mp3", "wav"):
            src = os.path.join(REF, "sounds", "%d.%s" % (sid, ext))
            if os.path.exists(src):
                shutil.copyfile(src, os.path.join(snd, "%d.%s" % (sid, ext)))
                files[str(sid)] = "snd/%d.%s" % (sid, ext)
                break
    meta["sounds"] = files


def hash_names(meta):
    """Rename images to <name>.<content hash>.webp so a browser can never pair a new meta.json with an
    old cached image (the HTTP server sends no cache headers). meta.json itself is fetched with no-cache."""
    def rename(fn):
        path = os.path.join(OUT, fn)
        with open(path, "rb") as f:
            h = hashlib.md5(f.read()).hexdigest()[:8]
        new = fn.replace(".webp", ".%s.webp" % h)
        os.replace(path, os.path.join(OUT, new))
        return new
    for a in meta["atlases"].values():
        a["file"] = rename(a["file"])
    meta["bg"]["file"] = rename(meta["bg"]["file"])


def main():
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, "*.webp")):
        os.remove(old)
    meta = {}
    pack_hitzones(meta)
    pack_units(meta)
    pack_world(meta)
    pack_ui(meta)
    pack_bg(meta)
    copy_sounds(meta)
    hash_names(meta)
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    for fn in sorted(os.listdir(OUT)):
        print("%-14s %7.1f KB" % (fn, os.path.getsize(os.path.join(OUT, fn)) / 1024))
    for k, a in meta["atlases"].items():
        print(k, a["size"], "decoded %.1f MB" % (a["size"][0] * a["size"][1] * 4 / 1e6))


if __name__ == "__main__":
    main()
