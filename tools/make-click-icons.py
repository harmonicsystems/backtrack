"""Render the 201 home-screen icons for click presets (40–240 bpm) into icons/c/{bpm}.png: one colour, the bpm,
the word click, and the four beat dots the groove icons carry. The meter and key live in the shortcut's name.
Run from the repo root: python3 tools/make-click-icons.py"""
import os
from PIL import Image, ImageDraw, ImageFont

BG = '#326AB2'
S = 4          # draw at 4x, downsample for clean edges
W = 180 * S
num = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 70 * S, index=1)    # bold
word = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 30 * S, index=0)

os.makedirs('icons/c', exist_ok=True)
for bpm in range(40, 241):
    im = Image.new('RGB', (W, W), BG); d = ImageDraw.Draw(im)
    d.text((W / 2, 92 * S), str(bpm), font=num, fill='white', anchor='ms')
    d.text((W / 2, 128 * S), 'click', font=word, fill='white', anchor='ms')
    for i in range(4):                      # the four beats; beat one solid
        cx, cy, r = (48 + i * 28) * S, 156 * S, (7 if i == 0 else 5) * S
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill='white' if i == 0 else None, outline='white', width=int(1.5 * S))
    im.resize((180, 180), Image.LANCZOS).save(f'icons/c/{bpm}.png', optimize=True)
print('ok')
