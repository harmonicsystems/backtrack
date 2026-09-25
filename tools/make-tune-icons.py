"""Render the Tune-mode home-screen icons into icons/t/{concertKey}.png (concert pitch) and
icons/t/{concertKey}-{Bb|Eb|F}.png (transposing): the root, fifth and octave lines with a sung line settling onto
the fifth, and the key the player reads. Run from the repo root: python3 tools/make-tune-icons.py"""
import math, os
from PIL import Image, ImageDraw, ImageFont

KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
# instrument: (semitones from concert up to written, tag, background) — muted violets, one shade per instrument so
# a row of them on the home screen still sorts itself; distinct from the Groove tempo colours and Breathe's slate/teal
INSTS = {'': (0, None, '#6D5C7E'), 'Bb': (2, 'B♭', '#5E5A82'), 'Eb': (9, 'E♭', '#7A5A78'), 'F': (7, 'F', '#5A4F6E')}
S = 4
W = 180 * S
HN = '/System/Library/Fonts/HelveticaNeue.ttc'
UNI = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'   # Helvetica Neue has no ♭
LINES = [(104, 5), (74, 3), (44, 3)]                           # root, fifth, octave: (y, width)

def trace(x0=32, x1=130, y0=114, y1=74, z=.3, n=240):
    """A voice finding the fifth: it rises from below the root, overshoots, wobbles and settles — the step response
    of a lightly damped spring (damping z), which is roughly how a pitch lands. The last bit lands exactly on the line."""
    q = math.sqrt(1 - z * z); wd = math.pi / .3                 # the first overshoot peaks 30% of the way along
    miss = lambda t: math.exp(-z * wd / q * t) * (math.cos(wd * t) + z / q * math.sin(wd * t))   # 1 at onset → 0
    a = .02                                                     # start just after onset, already on the way up
    return [((x0 + u * (x1 - x0)) * S, (y1 + (y0 - y1) * miss(a + u * (1 - a)) / miss(a) * (1 - u ** 6)) * S)
            for u in (i / n for i in range(n + 1))]

def label(key, tag):
    """[(text, font, stroke)] for the written key, then the smaller instrument tag, shrunk together to fit 150 px."""
    for size in range(36, 18, -1):
        big, flat = ImageFont.truetype(HN, size * S, index=1), ImageFont.truetype(UNI, size * S)
        parts = [(key[0], big, 0)] + ([('♭', flat, S)] if key.endswith('b') else [])   # stroke: Arial's ♭ is thin next to bold
        if tag:
            ts = round(size * .6)
            small, sflat = ImageFont.truetype(HN, ts * S, index=1), ImageFont.truetype(UNI, ts * S)
            parts += [(' ', big, 0), (tag[0], small, 0)] + ([('♭', sflat, S // 2)] if tag.endswith('♭') else []) + [(' inst.', small, 0)]
        if sum(ImageDraw.Draw(Image.new('RGB', (1, 1))).textlength(t, font=f) + 2 * s for t, f, s in parts) <= 150 * S:
            return parts
    return parts

os.makedirs('icons/t', exist_ok=True)
for inst, (T, tag, bg) in INSTS.items():
    soft = tuple(int(int(bg[i:i + 2], 16) * .4 + 255 * .6) for i in (1, 3, 5))   # white at 60% over the background
    for k in KEYS:
        im = Image.new('RGB', (W, W), bg); dr = ImageDraw.Draw(im)
        for y, w in LINES:                                         # rounded ends, like a pen stroke
            dr.rounded_rectangle((26 * S, (y - w / 2) * S, 154 * S, (y + w / 2) * S), radius=w / 2 * S, fill=soft)
        pts = trace()
        dr.line(pts, fill='white', width=4 * S, joint='curve')
        r = 2 * S; x, y = pts[0]; dr.ellipse((x - r, y - r, x + r, y + r), fill='white')   # round off where the line starts
        r = 7 * S; x, y = pts[-1]; dr.ellipse((x - r, y - r, x + r, y + r), fill='white')   # the pen, resting on the fifth
        parts = label(KEYS[(KEYS.index(k) + T) % 12], tag)
        widths = [dr.textlength(t, font=f) + 2 * s for t, f, s in parts]
        x = (W - sum(widths)) / 2
        for (t, f, s), w in zip(parts, widths):
            dr.text((x + s, 150 * S), t, font=f, fill='white', anchor='ls', stroke_width=s, stroke_fill='white'); x += w
        im.resize((180, 180), Image.LANCZOS).save(f'icons/t/{k}-{inst}.png' if inst else f'icons/t/{k}.png', optimize=True)
print('ok')
