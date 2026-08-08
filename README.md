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

Checkout hands off to Stripe Checkout. The browser sends only variant ids and
quantities to `/api/checkout`; that route resolves the real Stripe Price for
each variant server-side, so a tampered cart cannot choose what it pays. The
decision logic sits in `src/utils/checkoutSession.ts`, free of Astro and Stripe
imports so it can be tested directly.

### Environment variables

| Variable                                   | Required | Purpose                                    |
| ------------------------------------------ | -------- | ------------------------------------------ |
| `STRIPE_SECRET_KEY`                        | yes      | Creates the Checkout Session. Server-only. |
| `STRIPE_PRICE_YELLOW`                      | —        | Price ID for the yellow tie.               |
| `STRIPE_PRICE_PINK` / `_GREEN` / `_ORANGE` | —        | The other tie colors.                      |
| `STRIPE_PRICE_VEST_LIME` / `_VEST_ORANGE`  | —        | The vests.                                 |

The variant-to-variable mapping is `src/utils/stripePrices.ts`. **A variant
with no Price ID cannot be bought**: checkout refuses the whole order and names
the item, rather than quietly dropping it and charging for the rest. Adding a
colour is one environment variable — no code change.

### Volume tiers must be configured in Stripe

This is the easiest thing to get wrong. The site advertises a volume ladder
(**$2.69 → $2.39 at 100 → $2.19 at 200**), but a _flat_ Stripe Price charges the
same unit amount at every quantity. Point a flat Price at a product whose page
promises a discount and the customer is charged full price at every quantity,
while the page says otherwise.

Set the Stripe Price to **graduated or volume tiers** matching the ladder in the
product frontmatter. On every checkout the endpoint retrieves the Price and logs
an error if the two disagree — either because the Price is flat while the site
advertises tiers, or because the unit amount does not match the listed price.
Check the Vercel function log after the first live order.

That check does not block the sale: a pricing mistake should be loud, not take
the storefront offline, and Stripe shows the real total before the customer
pays.

### What the checkout page collects

`shipping_address_collection` (US only, matching the free-shipping promise),
`phone_number_collection`, and billing address. Email is always collected by
Stripe. An explicit zero-cost shipping rate is attached so the customer sees
"Free U.S. shipping" rather than a blank line. Promotion codes are enabled.

On return, `/checkout/success` clears the cart — deliberately not at redirect
time, so abandoning Stripe keeps the basket intact.

There is no order webhook. Fulfilment currently means watching the Stripe
dashboard; a `checkout.session.completed` webhook would be the way to automate
it.

## Forms and email

The contact form and the wholesale quote form both POST to `/api/contact`,
which sends the enquiry via [Resend](https://resend.com).

This is why the project has the Vercel adapter. Pages are still fully
prerendered — `output: 'static'` — and only `src/pages/api/contact.ts` opts out
with `export const prerender = false` and runs as a serverless function. A server is unavoidable here: the Resend API key must
never reach the browser.

### Environment variables

Set in Vercel → Project → Settings → Environment Variables. See `.env.example`.

| Variable         | Required | Purpose                                                                                                    |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` | yes      | Authenticates the send. Server-only — never prefix with `PUBLIC_`.                                         |
| `RESEND_FROM`    | yes      | From address. Must be on a domain verified in Resend, or the send is rejected.                             |
| `CONTACT_TO`     | no       | Where enquiries are delivered. Comma-separated for several recipients. Defaults to `sales@shawsafety.com`. |

Read through `src/utils/env.ts`, which prefers `process.env` over
`import.meta.env`. Vite can inline `import.meta.env` at build time, which would
freeze a secret into the bundle — rotating the key in Vercel would then have no
effect until the next deploy.

### Behaviour worth knowing

- **Reply-To is the customer**, so replying to a notification reaches them
  directly. Addresses containing newlines are dropped rather than sanitised —
  a newline in a header lets an attacker append their own.
- **A hidden honeypot field** catches basic bots. They get a 200 so they cannot
  tell they were filtered.
- **Misconfiguration fails loudly.** With no API key the endpoint returns 503
  and tells the visitor to call instead — it never fakes a success.
- **Upstream errors stay server-side.** Resend's reason is logged; the visitor
  sees a generic message.
- **No JavaScript still works.** The forms carry a real `action`/`method`, and
  the endpoint returns a styled HTML page rather than raw JSON when the request
  asks for HTML.

There is no rate limiting — a public endpoint will eventually attract abuse.
Adding it needs shared state (Vercel KV, Upstash, or Resend's own limits).

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
