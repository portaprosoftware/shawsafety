# TeX Gyre Heros (self-hosted)

The site's typeface. It is not on Google Fonts or any CDN we use, so the files
are vendored here and served from our own origin.

|          |                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| Family   | TeX Gyre Heros 2.004 (30 X 2009)                                                                                     |
| Authors  | Bogusław Jackowski and Janusz M. Nowacki, on behalf of the TeX Users Groups (Vietnamese characters by Hàn Thế Thành) |
| Upstream | https://www.gust.org.pl/projects/e-foundry/tex-gyre/heros                                                            |
| License  | GUST Font License. See `GUST-FONT-LICENSE.txt`, an instance of the LaTeX Project Public License                      |

Heros is GUST's extension of URW Nimbus Sans, itself a Helvetica clone, which is
why the CSS fallback stack in `../styles/global.css` names Helvetica and Arial
first. They are metrically close, so the swap barely moves the page.

## What is checked in

Four faces, all normal-width:

- `texgyreheros-regular.woff2`
- `texgyreheros-italic.woff2`
- `texgyreheros-bold.woff2`
- `texgyreheros-bolditalic.woff2`

The upstream condensed cuts (`texgyreheroscn-*`) are not vendored; nothing on
the site asks for them, and each one is another ~50 kB nobody downloads.

## How they were produced

The upstream OTFs were converted to WOFF2 and nothing else. No subsetting, no
renaming, no glyph or metric edits, so all 1053 mapped codepoints (Latin,
Latin Extended, Greek, Cyrillic, Vietnamese) survive intact. Keeping the files
unmodified also keeps us clear of the GFL's request that derived works be
renamed.

```sh
pip install fonttools brotli
python - <<'PY'
from fontTools.ttLib import TTFont
for f in ('regular', 'italic', 'bold', 'bolditalic'):
    ft = TTFont(f'texgyreheros-{f}.otf')
    ft.flavor = 'woff2'
    ft.save(f'texgyreheros-{f}.woff2')
PY
```

## How they are wired up

`../styles/global.css` declares the `@font-face` rules and points Tailwind's
`--font-sans` at the family, so body copy and every `font-sans` utility pick it
up with no per-component changes. `MainLayout.astro` preloads the regular and
bold cuts.

Heros ships two weights, not nine. The `@font-face` weight ranges map 100-500
onto the regular cut and 600-900 onto the bold one, so `font-semibold`,
`font-extrabold`, and `font-black` all render as real bold rather than a
browser-synthesised smear, at the cost of `font-medium` being
indistinguishable from `font-normal`.
