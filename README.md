# Shaw Safety

Storefront for Shaw Safety — fluorescent security zip ties and ANSI Class 2
hi-vis vests, sold direct at published wholesale pricing.

Built with [Astro 7](https://astro.build), Tailwind CSS v4, and
[Preline UI](https://preline.co). Static output, deployed on Vercel.

## Getting started

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # astro check → astro build → HTML minify
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

`src/images/products/*.svg` are generated placeholders
(`node scripts/generate-placeholder-images.mjs`) standing in until real
photography is served from Cloudflare R2. When the bucket is live, update the
hostname in **both** `astro.config.mjs` (`image.domains`) and the `img-src`
directive in `vercel.json`.
