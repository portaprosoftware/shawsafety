# Knowledge corpus — ingestion notes

This directory is the whole retrieval corpus for the site assistant. Everything
in it is embedded at build time by `scripts/build-rag-index.mjs` and served from
`/api/ask`. There is no vector database and no external store: the index is a
generated JSON file read in-process by the API route.

This file starts with an underscore, so both the Astro content collection
(`**/[^_]*.md`) and the build script skip it. Notes belong here; anything you
want the assistant to be able to say does not.

## Two shapes of file

**Page-anchored chunks** — one topic per file, embedded whole. These are drawn
from live site copy and each one cites the page it came from. They are the
authority for anything the site publishes as a promise: prices, tier
breakpoints, cutoffs, policy.

**Reference documents** — long-form treatments set to `chunkBy: 'section'`,
split into one retrieval chunk per `## ` heading. These carry depth the site
pages do not: use cases, seal-class comparisons, installation and inspection
practice, standards explainers.

Where the two disagree, the page-anchored chunk wins. A reference document must
never restate a price or a cutoff in terms that conflict with the site.

## Frontmatter

    title:        required. For a section document, the document title.
    topic:        product | pricing | shipping | ordering | policy | company
    url:          required. Page cited back to the visitor.
    sourceLabel:  label shown on the citation chip. Defaults to title.
    questions:    how a buyer would actually ask. Embedded, so it matters.
    keywords:     buyer vocabulary that does not appear in the prose.
    chunkBy:      'section' to split on H2. Omit to embed the file whole.

`questions` and `keywords` are the vocabulary bridge. The site says "dispatch";
a buyer types "how fast do you ship". The embedding only closes that gap if the
buyer's phrasing is somewhere in the chunk.

## Editing

    pnpm rag:index --dry-run     parse and report, no API call, nothing written
    pnpm rag:index               embed and write the index
    pnpm rag:test                run the retrieval checks in scripts/rag-test.mjs

`pnpm build` runs the index step first, so deploying with `OPENAI_API_KEY` set
is the entire procedure. A missing key leaves the assistant switched off rather
than failing the build.

## Standing content rules

- **Never reference ziptie.com, or route a visitor there.** It is not affiliated
  with Shaw Safety. This applies to corpus prose, the system prompt, and any
  asset metadata.
- Do not claim C-TPAT, ISO 17712, or CBP conformance. The tie is an
  indicative-class seal; UL 21S is a cable-management listing, not a security
  seal certification. See `02-compliance-and-standards.md`.
- Custom-print lead times are unverified and deliberately absent from this
  corpus. Do not add one without confirming it.
- Times are US Eastern.
