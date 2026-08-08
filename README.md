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
| `src/content/knowledge/`       | RAG corpus. One Markdown file per retrieval chunk.                                     |
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

| Variable                                               | Required | Purpose                                     |
| ------------------------------------------------------ | -------- | ------------------------------------------- |
| `STRIPE_SECRET_KEY`                                    | yes      | Creates the Checkout Session. Server-only.  |
| `STRIPE_PRICE_YELLOW` / `_PINK` / `_GREEN` / `_ORANGE` | —        | Price ID per tie colour. All four are live. |
| `STRIPE_PRICE_VEST_LIME` / `_VEST_ORANGE`              | —        | The vests.                                  |
| `STRIPE_CHECKOUT_WEBHOOK_SECRET`                       | yes      | Verifies order webhooks. Server-only.       |

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

### Order notifications

`/api/stripe-webhook` listens for `checkout.session.completed` and emails the
order — customer, phone, shipping address, line items, total — to `CONTACT_TO`
via Resend, so fulfilment does not depend on watching the Stripe dashboard.

Configure the webhook in Stripe against
`https://shawsafety.com/api/stripe-webhook` with only that event enabled, and
put its signing secret in `STRIPE_CHECKOUT_WEBHOOK_SECRET`. The payload is
verified with `constructEventAsync`, which covers both the signature and
Stripe's five-minute replay window.

Two behaviours worth knowing:

- **A failed notification returns 500 on purpose**, so Stripe retries rather
  than the order being silently lost. The payment itself is unaffected.
- **Duplicate suppression is best-effort.** Event ids are remembered in memory,
  which only catches an immediate retry landing on the same warm instance.
  Proper idempotency needs a datastore. Ids are recorded only after the email
  actually sends, so a genuine failure still gets retried.

### CSRF

Astro rejects cross-site form POSTs, so `/api/contact` and `/api/transcribe`
both require a matching `Origin` header — browsers send one, `curl` does not.
That protection is a side effect of their content type (form-encoded and
multipart respectively), not something either route asks for. JSON endpoints
(`/api/checkout`, `/api/stripe-webhook`, `/api/ask`) are exempt, which is why
Stripe can post to the webhook.

## Forms and email

The contact form and the wholesale quote form both POST to `/api/contact`,
which sends the enquiry via [Resend](https://resend.com).

This is why the project has the Vercel adapter. Pages are still fully
prerendered — `output: 'static'` — and only the routes under `src/pages/api/`
opt out with `export const prerender = false` and run as serverless functions.
A server is unavoidable here: the Resend and Stripe secrets must never reach
the browser.

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

## Dictation

Every `<textarea>` gets a **Speak** button that records audio and transcribes it
into the field. Single-line inputs deliberately do not: a name or an email is
faster to type than to speak and correct.

`src/components/ui/blocks/VoiceInput.astro` finds the textareas itself, so
adding a field needs no wiring — drop the component on the page once and every
multi-line field on it is covered, including ones added later.

The browser posts the recording to `/api/transcribe`, which forwards it to
ElevenLabs' `scribe_v1` model. The route exists solely to keep the key server-
side; calling ElevenLabs from the page would publish a billable credential to
anyone who opens devtools.

### Audio is normalised to WAV before upload

`src/assets/scripts/wavEncoder.ts` converts every recording to **16 kHz mono
16-bit PCM WAV** in the browser before it is sent. This is not cosmetic — it
fixed a total failure of the feature.

MediaRecorder hands back whatever container the browser prefers, and that type
string rides along with the upload: Chrome produces `audio/webm;codecs=opus`,
Safari `audio/mp4`. An upstream validator matching content types against an
allowlist compares the whole string, so the codec parameter turned an otherwise
accepted `audio/webm` into a rejection — every transcription came back
`400 {"detail":…}` with nothing in it naming the offending field.

WAV has one canonical type, no codec parameter, and is accepted everywhere. 16
kHz mono is also what speech models resample to anyway, so sending 48 kHz
stereo pays for bytes that get thrown away. The cost is size: PCM is roughly ten
times Opus, about 32 KB per second, so the two-minute cap is under 4 MB.

The server re-wraps the upload rather than forwarding the received `File`, which
would carry its original type through, and strips any parameters as a second
line of defence. If the browser cannot decode its own recording, the original
blob is sent unconverted — a failed conversion is no reason to discard audio.

| Variable             | Required | Purpose                                              |
| -------------------- | -------- | ---------------------------------------------------- |
| `ELEVENLABS_API_KEY` | no       | Transcription. Server-only — never prefix `PUBLIC_`. |

Behaviour worth knowing:

- **Text is inserted at the caret**, not appended, and spaced off surrounding
  text. Dictation adds to a draft rather than replacing it.
- **Nothing is stored.** The audio blob is discarded once the text returns; it
  is never written to disk on either side.
- **Recording stops itself after two minutes.** A forgotten open mic is both a
  bill and a privacy problem.
- **The microphone is released on every exit path** — stop, error, or leaving
  the page — so the browser's recording indicator always clears.
- **An unusable button is never shown.** Where `MediaRecorder` or `getUserMedia`
  is missing (notably any plain-HTTP origin, since getUserMedia requires a
  secure context) nothing is rendered and the form works by typing.
- **With no API key the button reports that dictation is unavailable** and tells
  the visitor to type. It never fails silently.
- **`GET /api/transcribe` answers 405** rather than falling through to the
  router's 404. Opening the endpoint in a browser is the first thing anyone does
  when dictation misbehaves, and an unhandled GET logs a warning that reads like
  a routing fault. The response also reports whether the key is configured —
  never the key itself — which is the one setting worth checking from outside.
- **An upstream rejection logs what was sent** (filename, content type, size,
  model) next to the response body. The body alone does not say which field was
  objected to, which is what made the content-type bug above so slow to place.

`Permissions-Policy` in `vercel.json` must keep `microphone=(self)`. Dropping it
is the non-obvious way to break this — the button renders and the permission
prompt never appears.

Like `/api/contact`, this endpoint is unauthenticated and unthrottled, and it
spends money per call. Rate limiting matters more here than on the mail form.

## RAG assistant

`POST /api/ask` answers questions about the store from a hand-written knowledge
corpus, using OpenAI for retrieval and generation. `AskWidget.astro` is the chat
UI on top of it; the route is also callable directly, by an agent or anything
else.

```bash
curl -s localhost:4321/api/ask -X POST -H 'Content-Type: application/json' \
  -d '{"question":"do mixed colors count toward the volume tier?"}'
```

```jsonc
{
  "ok": true,
  "answer": "Yes — quantity totals across every color and SKU … [1][2]",
  "sources": [
    {
      "n": 1,
      "title": "Wholesale Pricing",
      "url": "/wholesale",
      "score": 0.612,
    },
  ],
}
```

`history` may be passed alongside `question` as an array of
`{ role: 'user' | 'assistant', content }` turns; the last six are kept.
Retrieval always runs against the current question.

### The corpus is written, not scraped

`src/content/knowledge/` holds one Markdown file per chunk, typed by the
`knowledge` collection in `src/content.config.ts`. Thirty chunks of 100–300
words cover the products, specs, compliance marks, price ladders, shipping,
returns, ordering, and both legal pages.

They are authored rather than extracted from the rendered pages for two
reasons. The pages interleave copy with markup and price math, so a scraper
yields fragments that read as fragments. And a retrieved chunk arrives at the
model with no surrounding page — so each one names the product it is about
instead of relying on a heading three sections up.

Frontmatter carries a `questions` list: the questions that chunk answers,
phrased the way a buyer would ask them. These are embedded alongside the prose
and close the vocabulary gap between "how fast do you ship?" and the site's
word for it, "dispatch". They are never shown to the model as content.

**Editing a chunk means re-running the index.** Prices and tiers appear in the
corpus as prose and are not derived from `src/content/products/`, so a price
change has to be made in both places — grep the corpus for the old number.

### Building the index

```bash
pnpm rag:index --dry-run   # parse and report the corpus, no API call
pnpm rag:index             # embed and write src/data_files/rag-index.json
```

The index is a single JSON file and is **committed**. At thirty chunks a linear
cosine scan in the route is microseconds, so a vector database would add a
network hop, a second credential, and an operational dependency to lose to an
in-process loop. Vectors are truncated to 512 dimensions — the
`text-embedding-3` models are trained so a prefix is still a usable embedding —
which thirds the file for no measurable retrieval difference at this size.

Indexing is deliberately not part of `pnpm build`: the corpus changes far less
often than the site deploys, and a billable call inside the build means a
rotated key fails a deploy. The route reads the model and vector width back out
of the index rather than pinning them separately, since a query is only
comparable to vectors from the same model at the same width.

| Variable                 | Required | Purpose                               |
| ------------------------ | -------- | ------------------------------------- |
| `OPENAI_API_KEY`         | no       | Embeddings and answers. Server-only.  |
| `OPENAI_EMBEDDING_MODEL` | no       | Defaults to `text-embedding-3-small`. |
| `OPENAI_CHAT_MODEL`      | no       | Defaults to `gpt-4o-mini`.            |

Behaviour worth knowing:

- **The answer is grounded or refused.** The system prompt forbids answering
  outside the retrieved passages, and passages scoring below 0.25 similarity are
  dropped before the model sees them. A question that retrieves nothing is
  answered with the phone number and email, without spending a completion call —
  a storefront assistant inventing a return window is the failure mode this is
  built to avoid.
- **Nothing is derived at answer time.** Prices, SKUs, and tier breakpoints are
  quoted from the corpus verbatim; the model is told never to compute or adjust
  one.
- **Sources come back numbered** in citation order, so `[2]` in the answer maps
  to a real page. Similarity scores ride along — the only signal available for
  tuning the threshold against real questions.
- **With no key, or no index built, the route answers 503** and points the
  visitor at sales@shawsafety.com. Neither the key nor the corpus is echoed.
- **`GET /api/ask` answers 405** and reports whether the key is set and what
  index is deployed, matching `/api/transcribe`.
- **The index is globbed, not imported**, so a fresh clone with no index builds
  and deploys fine — same reasoning as the product photos.

Like `/api/contact` and `/api/transcribe`, this endpoint is unauthenticated and
unthrottled, and it spends money per call — two OpenAI calls per question. Rate
limiting matters here.

### The chat widget

`src/components/ask/AskWidget.astro` sits in `MainLayout`, so the launcher is on
every page. **It renders nothing unless `OPENAI_API_KEY` is set _and_ an index is
present** — the same rule the dictation button follows, since a chat button that
can only apologise is worse than no chat button. That check runs at build time
because the pages are prerendered, so adding the key in Vercel needs a redeploy
before the launcher appears.

Behaviour worth knowing:

- **Non-modal on purpose.** No backdrop, no scroll lock, no focus trap. Half the
  questions are about something on the page behind it ("is that price per tie or
  per pack?"), and a modal that hides the page to discuss the page is
  self-defeating. Escape and the close button dismiss it.
- **The closed panel is `inert`, not just `aria-hidden`.** It is only faded and
  translated, so without `inert` its composer stays in the tab order and a
  keyboard visitor tabs from the footer into an invisible chat box.
- **The transcript lives in `sessionStorage`,** and a panel left open reopens
  itself after a navigation. Following a cited link is the thing the answers are
  built to encourage, and on a multi-page site that would otherwise discard the
  conversation. Per-tab, dies with it, never written to disk. Focus is not
  stolen on restore.
- **Citations become links.** `[2]` in an answer is rendered as a superscript
  link to the page that passage came from, and distinct sources are listed as
  chips beneath. Only numbers the API actually returned are linked — a model
  citing `[7]` with five passages in hand gets plain text, and every href comes
  from our own index rather than from the answer.
- **Answers are escaped before anything else.** What survives is a deliberately
  small subset — bold, bullets, paragraphs — because a full Markdown renderer
  here is a dependency and an attack surface bought for two formatting features.
- **Error bubbles are never sent back as history.** A network failure is UI, not
  something the model said; feeding it back invites the next answer to apologise
  for it.
- **Enter sends, Shift+Enter is a newline,** and composition events are checked
  so an IME candidate accepted with Enter does not fire the question.
- **The composer opts out of dictation** via `data-no-dictation`. `VoiceInput`
  attaches to every textarea on its page, and it is only on two pages — without
  the opt-out the chat box would sprout a Speak button on the contact and
  wholesale pages and nowhere else.

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

The `products/` subfolder is not optional. `src/images/` itself holds brand
assets and is not scanned, so a product photo landing there is invisible — the
page keeps showing the placeholder and the build still reports the file as
missing. That report is the tell: if a photo you just added is still listed as
missing, check which folder it is in before anything else.

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
pre-resize or compress — upload the largest version you have. The main photo is
served at 1100px into a ~560px box so the in-place magnifier (1.75x, following
the cursor) reveals real detail rather than upscaled pixels. Change `ZOOM` in
`src/components/ui/blocks/ImageZoom.astro` to adjust the magnification. Use JPG for photographs; PNG or WebP are fine too.

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

### Spec sheets

Each tie colour has a dimensioned drawing behind a **View Spec** link on the
product page, opened in a modal with an "Open full size" escape hatch — the
annotation is too fine to read at fitted size on a phone.

Add one by putting the image in `src/images/products/` and setting `spec:` on
the variant in frontmatter, alongside `images:`. It resolves the same way, so
the extension is not referenced. A variant without a `spec` simply shows no
link, which is why the vests have none.

### Ground delivery map

`src/images/Shipping.png` backs the **Ground Delivery Times** section above the
footer on the landing page and both product pages
(`src/components/sections/misc/GroundDeliveryTimes.astro`). Like the hero, it is
globbed rather than imported, so replacing or removing it cannot break the
build — with no file the section still renders its text key.

The five-band colour key beside the map is real HTML, with swatch hex values
sampled from the legend baked into the artwork. **Replacing the map with one
using different colours means updating `bands` in that component**, or the key
and the map will disagree. The map also links to a 3000px render, because at
phone width the state labels are a few pixels tall.

## Hero video

The landing page hero is a Gumlet-hosted background video, embedded as an
iframe in `src/components/sections/landing/HeroSection.astro`. The video id
lives in `VIDEO_SRC` at the top of that file; `background=true` is what makes
the player chromeless, muted and looping.

Three things will each break it on their own:

- **`frame-src` in `vercel.json` must list `https://play.gumlet.io`.** The CSP
  otherwise blocks the frame outright and the hero drops to the gradient with
  only a console message to say why. Changing video host means changing both
  files.
- **The frame is sized to cover, not fit.** The hero is a wide, short band and
  the video is 16:9, so a frame filling the box would letterbox. The `max()`
  expressions take the larger of "full width" and "the width a full-height 16:9
  frame needs", in container-query units against the `[container-type:size]`
  wrapper. A different aspect ratio means changing the `16/9` and `9/16` in
  those two expressions.
- **The iframe is injected by script, not rendered in the markup**, and only
  when the visitor has not asked for reduced motion. A cross-origin player
  cannot be paused from this page, so not starting it is the only way to honour
  that preference. Reduced motion, or no JavaScript, gets the brand gradient —
  which the hero was designed to stand on.

There is no longer a `hero-image.*` fallback; the gradient is the fallback. The
previous photo was deleted rather than left behind as an unreferenced asset.

## Brand assets

### The logo

Drop the file at **`src/images/logo.png`** and both the navbar and the footer
pick it up — no code change. Any of `.png .jpg .webp .avif` works; the
extension is not referenced anywhere.

With no file present, `BrandLogo.astro` renders a drawn SVG wordmark instead,
so the header is never empty and a missing or renamed file cannot break the
build.

What the artwork wants:

- **Transparent background.** It sits on white in the navbar and on
  `neutral-50` in the footer, so a baked-in white box will show as a pale
  rectangle against the footer.
- **A dark or maroon mark.** Both placements are light backgrounds. A white
  or light logo will disappear.
- **Roughly 3:1 to 5:1, wide.** Any ratio renders correctly — width follows the
  source and nothing is squashed — but a tall or square logo will come out
  small, since both placements are height-constrained to 28–32px.
- **At least 320px tall**, ideally 400–600. It is displayed at 32px but
  rendered at 160 so it stays sharp on retina; a small source cannot be
  recovered. Do not pre-compress — Astro converts it to WebP and hashes it.

Two things the raster logo cannot do that the drawn fallback could:

- It does not inherit `currentColor`, so the `text-maroon-700` on the footer
  usage now only tints the fallback. Recolouring means a new file.
- It is a separate asset from `icon.png`. Replacing the logo does **not**
  change the favicon, the Apple touch icon, or the PWA icon — see below.

### Icons and social card

There is **no `favicon.ico` in the repo** — it is generated at build time by
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
