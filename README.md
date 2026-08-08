# Shaw Safety

Storefront for Shaw Safety — fluorescent security zip ties and ANSI Class 2
hi-vis vests, sold direct at published wholesale pricing.

Built with [Astro 7](https://astro.build), Tailwind CSS v4, and
[Preline UI](https://preline.co). Static output, deployed on Vercel.

## Getting started

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # check → build → minify → report missing product photos
pnpm test:smoke # serves dist/ and asserts every route resolves
pnpm format:fix # CI fails on unformatted files — run before committing
```

## Structure

| Path                           | Purpose                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `src/pages/`                   | File-based routes. One page per file; `products/[id].astro` is the only dynamic route. |
| `src/content/products/`        | Product data as Markdown frontmatter. Schema in `src/content.config.ts`.               |
| `src/assets/scripts/`          | Cart store, pricing math, and the checkout adapter.                                    |
| `src/assets/styles/global.css` | The entire theme. Tailwind v4 `@theme` block — there is no `tailwind.config.js`.       |
| `src/data_files/constants.ts`  | Site metadata, trust marks, marquee copy.                                              |
| `src/utils/navigation.ts`      | Nav and footer links.                                                                  |

## Theming

The palette is deliberately reset (`--color-*: initial`), so any color family
used in markup must be declared in the `@theme` block of
`src/assets/styles/global.css` first.

The brand is one maroon scale anchored on `#9B1C2E`, plus semantic aliases
(`--color-brand`, `--color-brand-grad-from`/`-to`). To retune the brand, edit
those tokens — no component markup references a raw hex.

`--color-fluoro-*` are _product_ colors (the actual tie pigments) and should
never be used for UI chrome.

## Pricing

All price math lives in `src/assets/scripts/pricing.ts` and is shared between
the server-rendered tier tables and the client cart, so the PDP and the cart
can never disagree.

Volume tiers are authored per product in content frontmatter, ascending, with
the last tier open-ended (`maxQty: null`). A variant may override the product's
default ladder — fluorescent yellow does this as the lead-in SKU.

## Cart and checkout

The cart (`src/assets/scripts/cart.ts`) is a localStorage-backed UI ledger. It
is **not** the source of truth for money.

`src/assets/scripts/checkout.ts` is the single seam to a payment processor and
currently ships as a stub. To go live with Stripe, edit only that file — the
CSP in `vercel.json` is already open for `js.stripe.com`, `hooks.stripe.com`,
and `api.stripe.com`. Never trust a client-supplied amount; resolve real Price
IDs server-side.

## Product images

Images live in `src/images/products/` and are committed to the repo. They go
through Astro's build pipeline, which resizes, converts, and content-hashes
them — each source image becomes several optimized variants (160px thumbnail,
720px gallery, 1600px zoom).

**Do not put product images in `public/`.** Files there are served
byte-for-byte with no optimization, so a 4MB photo would be downloaded in full
just to render a 72px cart thumbnail. `public/` is only for files that must
keep an exact, unhashed path.

**Adding a photo is one step: drop the file in `src/images/products/`.** No
content edit. Frontmatter references an extension-less stem
(`tie-fluorescent-pink-1`), and `src/utils/productImages.ts` matches it against
whatever real file exists in any supported format.

**A missing photo does not break the build.** It renders a placeholder naming
the file to add. (The collection used to use Astro's `image()` helper, which
resolves at build time and hard-fails with `[ImageNotFound]` — deleting a photo
broke the deploy.)

Every build prints what is still outstanding:

```
Product photos: 3/14 present
  Missing 11 — add to src/images/products/:
    tie-fluorescent-pink-1.jpg
    ...
```

Run it on its own with `node scripts/check-images.mjs`. It also flags images
present but unreferenced, which usually means a typo in a filename.

Shoot square-ish on a white background: the gallery and cards use
`object-contain`, so off-ratio images letterbox rather than crop. Don't
pre-resize or compress — upload the largest version you have, since the zoom
lightbox renders at 1600px. Use JPG for photographs; PNG or WebP are fine too.

### Filename manifest

14 files. `-1` is the primary shot — it appears on product cards and as the
cart thumbnail, so it should be the cleanest one.

| File                                           | Shows                   |
| ---------------------------------------------- | ----------------------- |
| `tie-fluorescent-{yellow,pink,green,orange}-1` | Single tie, straight    |
| `tie-fluorescent-{yellow,pink,green,orange}-2` | Tie cinched into a loop |
| `tie-fluorescent-{yellow,pink,green,orange}-3` | The 100-count bag       |
| `vest-hi-vis-{lime,orange}-1`                  | Vest, front             |

Three per color is not a rule — add or remove entries in the `images:` array in
`src/content/products/*.md` and the thumbnail rail follows. Counts need not
match across colors.

### Hero image

Optional. Drop any `hero-image.{jpg,png,webp,avif}` into `src/images/` and the
landing page picks it up; with no file the hero falls back to the brand
gradient, which stands on its own.

## Brand assets

`src/images/` holds the icon set and the social share image. There is **no
`favicon.ico` in the repo** — it is generated at build time by
`src/pages/favicon.ico.ts`, which reads `icon.png` and encodes 16px and 32px
into a real `.ico`.

| File                | Size      | Feeds                                                    |
| ------------------- | --------- | -------------------------------------------------------- |
| `icon.png`          | square    | Generated `/favicon.ico`, Apple touch icon, PWA manifest |
| `icon-maskable.png` | 1024×1024 | Android adaptive icon                                    |
| `social.png`        | 1200×600  | Open Graph / Twitter link previews                       |

`icon.png` is the only one to hand-edit. Replace it, then run
`node scripts/generate-brand-assets.mjs` to re-derive the maskable icon and the
social card from it — otherwise those two silently keep the old logo, and
neither is visible on the site (the maskable icon only shows when a phone
installs the PWA, and `social.png` only when a link is shared).

Two gotchas:

- **Do not add a `favicon.ico` to `public/`.** It collides with the generated
  `/favicon.ico` route.
- Android crops the maskable icon to a circle. The generator already insets the
  mark to ~62% for this; keep that in mind if you hand-author a replacement.

There is no SVG favicon. Modern browsers are served the PNG, which is
universally supported — one less file to keep in sync.
