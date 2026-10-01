"""Render the Noise-mode home-screen icons into icons/n/{color}.png: a muted tile per noise color, its spectrum's slope
drawn as a line over a soft fill (low frequencies on the left, as on the EQ panel), and the color's name.
Run from the repo root: python3 tools/make-noise-icons.py"""
import math, os
from PIL import Image, ImageDraw, ImageFont

# color: (label, dB per octave, background) — muted, distinct from the Groove/Breathe/Tune icons
COLORS = {'white': ('White', 0, '#8E979F'), 'pink': ('Pink', -3, '#A8727F'), 'brown': ('Brown', -6, '#765A47'),
          'grey': ('Grey', None, '#686D74'), 'blue': ('Blue', 3, '#4B6A90'), 'violet': ('Violet', 6, '#66568A')}
S = 4
W = 180 * S
bold = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 34 * S, index=1)
small = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 20 * S, index=0)

def level(color, slope, f):                       # dB relative to 1 kHz at f (grey: pink with the lows and highs lifted)
    if slope is not None: return slope * math.log2(f / 1000)
    lift = 6 * max(0, math.log2(250 / f)) / 2 + 3 * max(0, math.log2(f / 5000))
    return -3 * math.log2(f / 1000) + lift

os.makedirs('icons/n', exist_ok=True)
for name, (label, slope, bg) in COLORS.items():
    im = Image.new('RGB', (W, W), bg)
    d = ImageDraw.Draw(im, 'RGBA')
    x0, x1, span = 18 * S, W - 18 * S, 1.3 * S                        # one dB scale for every color, so slopes compare
    L = [level(name, slope, 20 * 1000 ** (i / 120)) for i in range(121)]
    mid = (max(L) + min(L)) / 2                                          # each curve centred in the space under the label
    pts = [(x0 + (x1 - x0) * i / 120, 122 * S - (L[i] - mid) * span) for i in range(121)]
    d.polygon(pts + [(x1, W - 14 * S), (x0, W - 14 * S)], fill=(255, 255, 255, 46))
    d.line(pts, fill=(255, 255, 255, 235), width=4 * S, joint='curve')
    d.text((18 * S, 16 * S), label, font=bold, fill=(255, 255, 255, 245))
    d.text((18 * S, 54 * S), 'noise', font=small, fill=(255, 255, 255, 190))
    im.resize((180, 180), Image.LANCZOS).save(f'icons/n/{name}.png')
    print('icons/n/%s.png' % name)
