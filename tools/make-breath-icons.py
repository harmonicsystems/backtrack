"""Render the Breathe-mode home-screen icons into icons/b/{name}.png: one breath cycle drawn as a curve (the same
shape as the guide under the circle), with the pattern's name. Run from the repo root: python3 tools/make-breath-icons.py"""
import math
from PIL import Image, ImageDraw, ImageFont

# name: (pattern in·hold·out·hold, label, background) — muted, distinct from the Groove icons' tempo colours
BREATHS = {'box': ([4, 4, 4, 4], 'Box', '#3E6E78'), '478': ([4, 7, 8, 0], '4·7·8', '#4F5F86'),
           'coherent': ([5.5, 0, 5.5, 0], 'Coherent', '#3F7A66'), 'exhale': ([4, 0, 8, 0], 'Long out', '#5E6A7E'),
           'custom': ([4, 2, 6, 1], 'Breathe', '#56697A')}
S = 4
W = 180 * S
bold = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 36 * S, index=1)
ease = lambda t: .5 - .5 * math.cos(math.pi * t)

def curve(d, x0, x1, ytop, ybot, n=240):
    total, pts = sum(d), []
    for i in range(n + 1):
        t, p = i / n * total, 0
        while p < 3 and t > d[p]: t -= d[p]; p += 1
        f = min(1, t / d[p]) if d[p] else 0
        h = [ease(f), 1, 1 - ease(f), 0][p]
        pts.append((x0 + i / n * (x1 - x0), ybot - h * (ybot - ytop)))
    return pts

for name, (d, label, bg) in BREATHS.items():
    im = Image.new('RGB', (W, W), bg); dr = ImageDraw.Draw(im)
    pts = curve(d, 26 * S, 154 * S, 34 * S, 104 * S)
    tide = tuple(int(int(bg[i:i + 2], 16) * .78 + 255 * .22) for i in (1, 3, 5))   # a soft tide under the curve
    dr.polygon(pts + [(154 * S, 104 * S), (26 * S, 104 * S)], fill=tide)
    dr.line(pts, fill='white', width=int(4 * S), joint='curve')
    r = 7 * S; x, y = pts[0]; dr.ellipse((x - r, y - r, x + r, y + r), fill='white')   # the dot, at the start of the breath
    size, font = 36, bold
    while dr.textlength(label, font=font) > 150 * S:                   # long names shrink to fit
        size -= 2; font = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', size * S, index=1)
    w = dr.textlength(label, font=font)
    dr.text(((W - w) / 2, 150 * S), label, font=font, fill='white', anchor='ls')
    im.resize((180, 180), Image.LANCZOS).save(f'icons/b/{name}.png', optimize=True)
print('ok')
