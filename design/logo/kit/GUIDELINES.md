# Patchwork — Logo Guidelines

## 1. The logo
**Idea:** four patches turn around one odd piece. It reads as a quilt block (*patchwork*) and as cards laid out on a canvas. The diamond in the middle is the piece that's yours.

| Version | Files |
|---|---|
| Horizontal (primary) | `patchwork-horizontal-light.svg` · `-dark.svg` · `-black.svg` · `-white.svg` |
| Stacked | `patchwork-stacked-light.svg` · `-dark.svg` |
| Symbol | `patchwork-symbol-light.svg` · `-dark.svg` · `-black.svg` · `-white.svg` · `-mono-24261f.svg` |
| Small-size symbol (≤ 32 px) | `patchwork-symbol-small-light.svg` · `-dark.svg` |
| Wordmark only | `patchwork-wordmark-light.svg` · `-dark.svg` |
| App icon | `patchwork-app-icon.svg` (≥ 64 px) · `patchwork-app-icon-small.svg` (≤ 48 px) · `patchwork-app-icon-1024.png` |
| Web | `web/` — favicon.svg (adapts to dark mode), favicon.ico, PNG icons, webmanifest, `head-snippet.html` |

`-light` files are for light backgrounds and `-dark` files are for dark backgrounds.

## 2. Clear space
Leave space equal to **one short side of a patch** (the 64-unit width of the side pieces, which is ⅓ of the symbol's height) on every side. It scales with the logo.

## 3. Minimum size
| Version | Screen | Print |
|---|---|---|
| Horizontal | 96 px wide | 25 mm wide |
| Symbol | 24 px; below that use the small-size cut | 6 mm |
| Small-size cut | 16 px | — |

## 4. Colour
The palette comes from the app's own UI colours. Each patch keeps its position: yellow at the top, orange on the right, green at the bottom, blue on the left. The diamond is always the neutral colour (cream or ink).

**On dark (the app, app icon)**

| Name | HEX | RGB | CMYK (approx.) |
|---|---|---|---|
| Yellow | `#dbbc7f` | 219 188 127 | 0 14 42 14 |
| Orange | `#e69875` | 230 152 117 | 0 34 49 10 |
| Green | `#83c092` | 131 192 146 | 32 0 24 25 |
| Blue | `#80a8cc` | 128 168 204 | 37 18 0 20 |
| Cream (diamond, wordmark) | `#e2ddd1` | 226 221 209 | 0 2 8 11 |
| Canvas (tile background) | `#282c2f` | 40 44 47 | 15 6 0 82 |

**On light**

| Name | HEX | RGB | CMYK (approx.) |
|---|---|---|---|
| Yellow deep | `#c4963c` | 196 150 60 | 0 23 69 23 |
| Orange deep | `#d06e44` | 208 110 68 | 0 47 67 18 |
| Green deep | `#4d9a66` | 77 154 102 | 50 0 34 40 |
| Blue deep | `#4a7fb0` | 74 127 176 | 58 28 0 31 |
| Ink (diamond, wordmark) | `#24261f` | 36 38 31 | 5 0 18 85 |

The CMYK values are simple conversions. Ask the printer for a proof before a print run; Pantone matches are not set yet.

**Approved pairs:** full colour (light) on white or `#f2f2ef` · full colour (dark) on `#282c2f` · ink on light · white on dark or photos · black for single-colour print.

## 5. Typography
The wordmark is **Inter Bold** (optical size 32) with −1.5 % tracking and hand-tuned kerning on "Pa". It has been converted to outlines, so don't retype it. Inter is licensed under the SIL Open Font License and can be used in a logo. Use Inter for the UI and marketing text too.

## 6. Don'ts
- Don't change which colour sits in which position, and don't make all four patches the same colour in the full-colour version. If you need one colour, use the mono files.
- Don't rotate, mirror, stretch or put a shadow on the mark. The pinwheel turns clockwise; a mirrored version is a different mark.
- Don't remove the diamond, close the gaps or change the corner radius.
- Don't use the large symbol below 24 px. Use the small-size cut.
- Don't use the light-palette colours on dark backgrounds, or the dark-palette colours on light ones.

## 7. Notes
- The master geometry is on a 256 grid: pieces 64 × 112, 12-unit gaps, 12-unit radius, and a 45° centre piece with a 21-unit half-diagonal. The small cut uses a 16-px grid with 1-px gaps.
- The audit flags 5 colours, which is above the usual ≤ 3. That's deliberate here: the patchwork idea needs several colours. The mono files cover cases where colour can't be used.
- Trademark clearance hasn't been checked. Run a search before public launch.
