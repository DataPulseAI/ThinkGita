import sys, glob, os
from PIL import Image, ImageDraw
out = sys.argv[1]
files = []
for pat in sys.argv[2:]: files += sorted(glob.glob(f"tests/help/out/{pat}.png"))
W = 600; cols = 3; tiles = []
for f in files:
    im = Image.open(f).convert("RGB"); r = W / im.width; im = im.resize((W, max(1, int(im.height * r))))
    if im.height > 400: im = im.crop((0, 0, W, 400))
    d = Image.new("RGB", (W, im.height + 18), "white"); d.paste(im, (0, 18)); ImageDraw.Draw(d).text((4, 3), os.path.basename(f), fill=(200, 0, 0)); tiles.append(d)
rows = [tiles[i:i+cols] for i in range(0, len(tiles), cols)]
H = sum(max(t.height for t in r) + 6 for r in rows)
sh = Image.new("RGB", (cols * (W + 6), H), (225, 225, 225)); y = 0
for r in rows:
    x = 0
    for t in r: sh.paste(t, (x, y)); x += W + 6
    y += max(t.height for t in r) + 6
sh.save(out)
