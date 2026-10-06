"""JUMPER: pixel jumping-spider mascot, logo lockups and X header.

The spider is drawn as a sprite grid so it stays crisp at any scale and can be
re-posed by editing the grid rather than redrawing art. A jumping spider reads
as itself through three things: two huge forward eyes, a fuzzy square body and
short thick front legs held up like fists.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, random

import os
FONTS = Path(os.environ.get("JUMPER_FONTS", Path(__file__).parent / "fonts"))
OUT = Path(os.environ.get("JUMPER_BRAND_OUT", Path(__file__).parent)); OUT.mkdir(exist_ok=True)

# palette, carried from the crawler terminal
BG      = (7, 6, 10)
PANEL   = (17, 13, 24)
LN      = (36, 27, 51)
AC      = (180, 124, 255)     # silk violet
AC_D    = (108, 68, 170)
AC_L    = (214, 180, 255)
GR      = (125, 240, 200)
CY      = (110, 208, 255)
YE      = (255, 209, 102)
RD      = (255, 93, 122)
INK     = (216, 210, 228)
DIM     = (126, 116, 144)
DIM2    = (74, 66, 89)
EYE     = (255, 255, 255)
PUP     = (16, 10, 26)

# ---------------------------------------------------------------- the sprite
# A jumping spider reads as itself through four things: a wide flat head, two
# enormous forward eyes, thick angular legs held close to the body, and a small
# round abdomen behind. Built from explicit cells so every pixel is deliberate.

GW, GH = 24, 24

def _cells(legs="med", eyes="big", body="med"):
    """Returns {(x,y): colour_key} for one spider, facing the viewer.
    legs: short | med | long | wide     eyes: big | huge | narrow | wide
    body: slim | med | fat"""
    g = {}

    def rect(x0, y0, x1, y1, k):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                g[(x, y)] = k

    def leg(path, k="L"):
        """Thick leg: paint the cell and the one below it, so it reads as a limb."""
        for i, (x, y) in enumerate(path):
            g[(x, y)] = k
            if i < len(path) - 1:
                nx, ny = path[i + 1]
                if ny == y:                      # horizontal run gets depth
                    g[(x, y + 1)] = k
                else:                            # diagonal gets a corner cell
                    g[(x, ny)] = k

    # ---- legs first, so the body paints over their roots
    R = {"short": 0, "med": 1, "long": 2, "wide": 2}[legs]
    SPRD = 1 if legs == "wide" else 0
    feet = []

    def pair(ly, dy, reach, lift):
        """Mirrored pair of legs leaving the body at row ly."""
        out = []
        for side in (-1, 1):
            x = 7 if side < 0 else 16
            path = [(x, ly)]
            cx, cy = x, ly
            for step in range(reach + R):
                cx += side * (1 + (1 if step and SPRD else 0))
                cy += dy if step else lift
                cx = max(0, min(GW - 1, cx)); cy = max(0, min(GH - 1, cy))
                path.append((cx, cy))
            leg(path)
            feet.append(path[-1])
        return out

    pair(6,  -1, 3, -1)    # front pair, raised like fists
    pair(8,   0, 3,  0)    # second, straight out
    pair(11,  1, 3,  0)    # third, out and down
    pair(14,  1, 3,  1)    # back pair, down and wide
    for f in feet:
        g[f] = "F"

    # ---- cephalothorax: wide and flat
    rect(7, 5, 16, 13, "M")
    rect(8, 4, 15, 4, "M")
    rect(6, 7, 6, 11, "M")
    rect(17, 7, 17, 11, "M")
    # top shading
    rect(8, 4, 15, 5, "H")
    # outline
    for x in range(8, 16): g[(x, 3)] = "B"
    for x in range(7, 17): g[(x, 14)] = "B"
    for y in range(5, 14): g[(5, y)] = "B" if 6 <= y <= 12 else g.get((5, y), "B")
    for y in range(5, 14): g[(18, y)] = "B" if 6 <= y <= 12 else g.get((18, y), "B")
    rect(6, 6, 6, 12, "M"); rect(17, 6, 17, 12, "M")

    # ---- the two forward eyes
    EY = {"big":   (7, 7, 11, 12, 8, 8, 10, 11),
          "huge":  (6, 6, 11, 12, 7, 7, 10, 11),
          "narrow":(8, 7, 11, 11, 9, 8, 10, 10),
          "wide":  (6, 8, 11, 11, 7, 9, 10, 10)}[eyes]
    a0, b0, a1, b1, p0, q0, p1, q1 = EY
    rect(a0, b0, a1, b1, "E")
    rect(GW - 1 - a1, b0, GW - 1 - a0, b1, "E")
    rect(p0, q0, p1, q1, "P")
    rect(GW - 1 - p1, q0, GW - 1 - p0, q1, "P")
    g[(p0, q0)] = "E"; g[(GW - 1 - p1, q0)] = "E"
    rect(6, 5, 7, 6, "P"); rect(16, 5, 17, 6, "P")

    # ---- abdomen
    AB = {"slim": (10, 13, 20), "med": (9, 14, 21), "fat": (8, 15, 22)}[body]
    ax0, ax1, ay1 = AB
    rect(ax0, 15, ax1, ay1, "M")
    rect(ax0 + 1, ay1 + 1, ax1 - 1, ay1 + 1, "M")
    rect(ax0 - 1, 16, ax0 - 1, ay1 - 2, "M")
    rect(ax1 + 1, 16, ax1 + 1, ay1 - 2, "M")
    for x in range(ax0, ax1 + 1): g[(x, ay1 + 2)] = "B"
    for y in range(16, ay1 - 1): g[(ax0 - 2, y)] = "B"; g[(ax1 + 2, y)] = "B"
    rect(11, 16, 12, ay1 - 1, "H")
    return g


COLORS = {
    "B": (22, 14, 36),
    "M": (64, 42, 98),
    "H": (112, 74, 170),
    "E": (255, 255, 255),
    "P": (14, 8, 22),
    "L": (46, 30, 72),
    "F": (180, 124, 255),
}


def draw_sprite(px=8, glow=True, accent=None, grid=None,
                legs="med", eyes="big", body="med", palette=None):
    cells = _cells(legs, eyes, body)
    COL = dict(COLORS)
    if palette:
        COL.update(palette)
    im = Image.new("RGBA", (GW * px, GH * px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for (x, y), k in cells.items():
        c = COL[k]
        d.rectangle([x * px, y * px, x * px + px - 1, y * px + px - 1], fill=c + (255,))
    if glow:
        g = im.filter(ImageFilter.GaussianBlur(px * .55))
        out = Image.new("RGBA", im.size, (0, 0, 0, 0))
        out.alpha_composite(g)
        out.alpha_composite(im)
        return out
    return im


def tiny(s): return ImageFont.truetype(str(FONTS / "Tiny5-Regular.ttf"), s)
def mono(s, w="Regular"):
    f = ImageFont.truetype(str(FONTS / "JetBrainsMono[wght].ttf"), s)
    f.set_variation_by_name(w); return f


def web_bg(W, H, seed=4, density=30, alpha=26):
    """Faint silk net behind everything."""
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im, "RGBA")
    rnd = random.Random(seed)
    pts = [(rnd.uniform(0, W), rnd.uniform(0, H)) for _ in range(density)]
    for i, a in enumerate(pts):
        for b in pts[i + 1:]:
            dist = math.hypot(a[0] - b[0], a[1] - b[1])
            if dist > W * .22:
                continue
            k = 1 - dist / (W * .22)
            d.line([a, b], fill=AC + (int(alpha * k),), width=1)
    for p in pts:
        d.rectangle([p[0], p[1], p[0] + 1, p[1] + 1], fill=AC + (90,))
    return im


def wordmark(d, x, y, size, split=3, col=INK, accent=AC):
    """JUM in ink, PER in silk."""
    f = tiny(size)
    a, b = "JUM", "PER"
    d.text((x, y), a, font=f, fill=col)
    w = d.textlength(a, font=f)
    d.text((x + w, y), b, font=f, fill=accent)
    return w + d.textlength(b, font=f)


def corners(d, x0, y0, x1, y1, L=28, col=INK, w=3):
    for (x, y, sx, sy) in [(x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)]:
        d.line([(x, y), (x + sx * L, y)], fill=col, width=w)
        d.line([(x, y), (x, y + sy * L)], fill=col, width=w)


# ------------------------------------------------------------------ avatar
def avatar(S=1000, framed=True):
    im = web_bg(S, S, density=22, alpha=20)
    d = ImageDraw.Draw(im, "RGBA")
    sp = draw_sprite(px=max(2, S // 46))
    sp.thumbnail((int(S * .70), int(S * .70)), Image.NEAREST)
    im.paste(sp, ((S - sp.width) // 2, int(S * .14)), sp)
    d = ImageDraw.Draw(im, "RGBA")
    if framed:
        m = int(S * .055)
        d.rectangle([m, m, S - m, S - m], outline=LN + (255,), width=2)
        corners(d, m, m, S - m, S - m, L=int(S * .045), col=INK, w=5)
    f = tiny(int(S * .105))
    ww = d.textlength("JUM", font=f) + d.textlength("PER", font=f)
    wordmark(d, (S - ww) / 2, int(S * .845), int(S * .105))
    return im


def avatar_tight(S=1000):
    """Face only. Survives a 48px circle."""
    im = web_bg(S, S, density=16, alpha=16)
    sp = draw_sprite(px=max(3, S // 20))
    # crop the sprite to the head block
    w, h = sp.size
    head = sp.crop((0, int(h * .12), w, int(h * .62)))
    head.thumbnail((int(S * 1.02), int(S * 1.02)), Image.NEAREST)
    im.paste(head, ((S - head.width) // 2, (S - head.height) // 2), head)
    d = ImageDraw.Draw(im, "RGBA")
    d.rectangle([0, 0, S - 1, S - 1], outline=AC + (255,), width=int(S * .02))
    return im


# ------------------------------------------------------------------ header
def header(W=1500, H=500):
    im = web_bg(W, H, density=34, alpha=24)
    d = ImageDraw.Draw(im, "RGBA")

    # ---- the spider: big, and vertically centred against the text block
    sp = draw_sprite(px=14)
    target = int(H * 0.92)
    sp.thumbnail((target, target), Image.NEAREST)

    text_x = int(W * .40)                    # where the type column starts
    gap_l = 56                               # breathing room from the left edge
    sx = gap_l + ((text_x - gap_l) - sp.width) // 2      # centred in the left column
    sy = (H - sp.height) // 2 + 6            # centred on the plate

    # silk line down to the body, stopping where the head begins
    hx = sx + sp.width // 2
    d.line([(hx, 0), (hx, sy + int(sp.height * .18))], fill=AC + (120,), width=2)
    im.paste(sp, (sx, sy), sp)
    d = ImageDraw.Draw(im, "RGBA")

    # ---- type block, centred on the same midline as the spider
    x0 = text_x
    block_h = 250
    top = (H - block_h) // 2 - 6

    wordmark(d, x0, top, 92)
    d.text((x0 + 3, top + 112), "IT CAN JUMP OVER ANY TOKEN", font=mono(28, "Bold"), fill=INK)
    d.text((x0 + 3, top + 150), "eight crawlers walk every holder. you read one card.",
           font=mono(19), fill=DIM)

    ry = top + 196
    cells = [("CRAWLERS", "8", INK), ("HOLDERS", "2 187", INK),
             ("SNIPERS", "11%", YE), ("SMART", "19", CY), ("SCORE", "84", GR)]
    cw = (W - 44 - x0) / len(cells)
    for i, (k, v, col) in enumerate(cells):
        cx = x0 + 3 + i * cw
        d.text((cx, ry), k, font=mono(14), fill=DIM2)
        d.text((cx, ry + 20), v, font=mono(28), fill=col)
        if i:
            d.line([(cx - 20, ry - 4), (cx - 20, ry + 56)], fill=LN + (255,), width=2)

    d.text((40, H - 42), "JUMPER · PONS V2 · ROBINHOOD CHAIN 4663", font=mono(18), fill=DIM)
    t = "reads the chain, never writes"
    d.text((W - 40 - d.textlength(t, font=mono(18)), H - 42), t, font=mono(18), fill=DIM2)
    corners(d, 16, 16, W - 16, H - 16, L=32, col=INK, w=4)
    return im


# ------------------------------------------------------------------ lockups
def lockups(W=1500, H=900):
    im = web_bg(W, H, density=26, alpha=18)
    d = ImageDraw.Draw(im, "RGBA")
    d.text((44, 34), "JUMPER · LOGO", font=tiny(40), fill=INK)
    d.text((46, 86), "horizontal, stacked, mark only, one colour, and the palette",
           font=mono(18), fill=DIM)
    d.line([(44, 122), (W - 44, 122)], fill=LN + (255,), width=2)

    sp = draw_sprite(px=5)

    # horizontal
    y = 168
    s1 = sp.copy(); s1.thumbnail((150, 150), Image.NEAREST)
    im.paste(s1, (56, y), s1)
    d = ImageDraw.Draw(im, "RGBA")
    wordmark(d, 230, y + 36, 74)
    d.text((232, y + 122), "CRAWLER TERMINAL", font=mono(18), fill=DIM)
    d.text((W - 320, y + 60), "horizontal lockup", font=mono(18), fill=DIM2)

    # stacked
    y = 380
    s2 = sp.copy(); s2.thumbnail((150, 150), Image.NEAREST)
    im.paste(s2, (56, y), s2)
    d = ImageDraw.Draw(im, "RGBA")
    wordmark(d, 230, y + 18, 58)
    d.text((232, y + 88), "IT CAN JUMP OVER ANY TOKEN", font=mono(19, "Bold"), fill=INK)
    d.text((232, y + 116), "pons v2 · chain 4663", font=mono(16), fill=DIM)
    d.text((W - 320, y + 60), "stacked lockup", font=mono(18), fill=DIM2)

    # mark only + one colour
    y = 600
    s3 = sp.copy(); s3.thumbnail((120, 120), Image.NEAREST)
    im.paste(s3, (56, y), s3)
    d = ImageDraw.Draw(im, "RGBA")
    d.text((60, y + 132), "mark only", font=mono(16), fill=DIM2)

    bx = 230
    d.rectangle([bx, y, bx + 330, y + 120], fill=INK + (255,))
    f = tiny(46)
    tw = d.textlength("JUMPER", font=f)
    d.text((bx + (330 - tw) / 2, y + 36), "JUMPER", font=f, fill=BG)
    d.text((bx, y + 132), "one colour, for stamps and merch", font=mono(16), fill=DIM2)

    # palette
    sw = 620
    sy = y - 54
    pal = [("silk", AC), ("silk light", AC_L), ("silk dark", AC_D),
           ("holding", GR), ("smart", CY), ("sniper", YE), ("gone", RD), ("ink", INK)]
    for i, (name, col) in enumerate(pal):
        sx = sw + (i % 4) * 150
        yy = sy + (i // 4) * 108
        d.rectangle([sx, yy, sx + 126, yy + 60], fill=col + (255,), outline=LN + (255,), width=2)
        d.text((sx, yy + 68), name, font=mono(15), fill=DIM)
        d.text((sx, yy + 88), "#%02X%02X%02X" % col, font=mono(14), fill=DIM2)
    return im



# ---------------------------------------------------------------- the crew
def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)

CREW = [
    # name,     role,                     legs,    eyes,     body,   base colour
    ("WEAVER",  "maps the holder graph",  "long",  "big",    "med",  (180, 124, 255)),
    ("TRACKER", "follows who left",       "med",   "narrow", "slim", (255, 93, 122)),
    ("SNARE",   "catches snipers",        "wide",  "wide",   "med",  (255, 209, 102)),
    ("SCOUT",   "finds smart money",      "long",  "huge",   "slim", (110, 208, 255)),
    ("KNOT",    "spots bundles",          "short", "big",    "fat",  (255, 168, 90)),
    ("LEDGER",  "rebuilds every book",    "med",   "big",    "fat",  (125, 240, 200)),
    ("SIEVE",   "throws out the noise",   "short", "narrow", "slim", (150, 142, 170)),
    ("ORACLE",  "writes the card",        "wide",  "huge",   "med",  (214, 180, 255)),
]


def crew_palette(base):
    """Body colours derived from one hue so each crawler reads as a species."""
    return {
        "B": shade(base, .20),
        "M": shade(base, .46),
        "H": shade(base, .80),
        "L": shade(base, .34),
        "F": base,
        "E": (255, 255, 255),
        "P": shade(base, .10),
    }


def crew_sprite(i, px=8, glow=True):
    nm, role, legs, eyes, body, base = CREW[i]
    return draw_sprite(px=px, glow=glow, legs=legs, eyes=eyes, body=body,
                       palette=crew_palette(base))


def crew_sheet(W=1500, H=760):
    im = web_bg(W, H, density=26, alpha=18)
    d = ImageDraw.Draw(im, "RGBA")
    d.text((44, 32), "JUMPER · EIGHT CRAWLERS", font=tiny(40), fill=INK)
    d.text((46, 84), "one species per pass. legs, eyes and body change with the job.",
           font=mono(18), fill=DIM)
    d.line([(44, 120), (W - 44, 120)], fill=LN + (255,), width=2)

    cols, cw, ch = 4, (W - 88) // 4, 300
    for i, (nm, role, legs, eyes, body, base) in enumerate(CREW):
        x = 44 + (i % cols) * cw
        y = 150 + (i // cols) * ch
        d.rectangle([x, y, x + cw - 16, y + ch - 28], outline=LN + (255,), width=1)
        sp = crew_sprite(i, px=6)
        sp.thumbnail((int(cw * .58), int(cw * .58)), Image.NEAREST)
        im.paste(sp, (x + (cw - 16 - sp.width) // 2, y + 18), sp)
        d = ImageDraw.Draw(im, "RGBA")
        d.text((x + 16, y + ch - 118), nm, font=tiny(30), fill=base)
        d.text((x + 17, y + ch - 84), role, font=mono(14), fill=DIM)
        d.text((x + 17, y + ch - 60), "legs " + legs + " · eyes " + eyes + " · body " + body,
               font=mono(12), fill=DIM2)
    return im


if __name__ == "__main__":
    avatar().save(OUT / "avatar-framed.png")
    avatar_tight().save(OUT / "avatar-tight.png")
    header().save(OUT / "header-1500x500.png")
    lockups().save(OUT / "logo-lockups.png")
    draw_sprite(px=12).save(OUT / "mark-transparent.png")
    draw_sprite(px=12, glow=False).save(OUT / "mark-flat.png")
    # one pixel per cell: the card and the site scale these up without blur
    draw_sprite(px=1, glow=False).save(OUT / "mark-cells.png")
    for i in range(len(CREW)):
        crew_sprite(i, px=1, glow=False).save(OUT / ("cells-%d-%s.png" % (i + 1, CREW[i][0].lower())))
    for i in range(len(CREW)):
        crew_sprite(i, px=10).save(OUT / ("crawler-%d-%s.png" % (i + 1, CREW[i][0].lower())))
    crew_sheet().save(OUT / "crawlers.png")
    a = avatar_tight(1000)
    for s in (512, 400, 180, 64, 32):
        a.resize((s, s), Image.LANCZOS).save(OUT / f"icon-{s}.png")
    print("ok")
