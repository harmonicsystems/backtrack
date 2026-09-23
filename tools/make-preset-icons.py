"""Render the 84 home-screen icons (7 tempos x 12 keys) into icons/p/{bpm}-{key}.png.
Run from the repo root: python3 tools/make-preset-icons.py"""
from PIL import Image, ImageDraw, ImageFont

TEMPOS = {60: '#56698C', 72: '#6A5A8C', 88: '#8A5A78', 96: '#326AB2', 108: '#2E7773', 120: '#4D7A3A', 128: '#96662E'}
KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
S = 4          # draw at 4x, downsample for clean edges
W = 180 * S
num = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 70 * S, index=1)    # bold
key = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 46 * S, index=0)
flat = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 48 * S)

def centered(d, y, parts):
    """parts: [(text, font)] drawn side by side, centred on the icon, baseline-aligned at y."""
    widths = [d.textlength(t, font=f) for t, f in parts]
    x = (W - sum(widths)) / 2
    for (t, f), w in zip(parts, widths):
        d.text((x, y), t, font=f, fill='white', anchor='ls'); x += w

for bpm, bg in TEMPOS.items():
    for k in KEYS:
        im = Image.new('RGB', (W, W), bg); d = ImageDraw.Draw(im)
        centered(d, 88 * S, [(str(bpm), num)])
        centered(d, 134 * S, [(k[0], key)] + ([('♭', flat)] if k.endswith('b') else []))
        for i in range(4):                      # the four beats; beat one solid
            cx, cy, r = (48 + i * 28) * S, 156 * S, (7 if i == 0 else 5) * S
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill='white' if i == 0 else None,
                      outline='white', width=int(1.5 * S))
        im.resize((180, 180), Image.LANCZOS).save(f'icons/p/{bpm}-{k}.png', optimize=True)
print('ok')
