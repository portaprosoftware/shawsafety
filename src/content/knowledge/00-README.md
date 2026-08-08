# Shaw Safety RAG Knowledge Base — Index and Ingestion Guide

## Purpose

This knowledge base powers the Shaw Safety chat assistant on shaw.portaprosoftware.com. Every file is written to be chunked on H2 (`##`) headings and embedded as independent, self-contained answers. Each section stands alone — no cross-references that depend on adjacent chunks being retrieved together.

## File index

- 00-README.md — this file, ingestion notes only, not intended as chat context
- 01-products-and-specs.md — SKU line, mechanical spec, materials, temperature, humidity, flammability
- 02-compliance-and-standards.md — UL 21S, UL 62275, DOT compliance, ISO 17712 boundaries, documentation
- 03-use-cases.md — intermodal, trailer, DOT inspection, yard, LTL, color-coding strategies, adjacent industries, limitations
- 04-pricing-and-ordering.md — retail vs wholesale, tier structure, mixed colors, payment methods, net terms, custom quotes
- 05-shipping-and-fulfillment.md — ship cutoff, transit times by state, carriers, backorders, damaged shipments
- 06-custom-printing-and-bulk.md — logo, serial, artwork, minimums, lead times, private label, custom colors
- 07-returns-warranty-guarantees.md — 30-day return, failure-to-spec replacement, damage claims, restocking, warranty scope
- 08-seal-comparisons.md — vs generic ties, bolt seals, cable seals, pull-tight seals, padlocks; selection quick reference
- 09-practical-usage.md — install, remove, temperature, chemical resistance, storage, VVTT inspection, tampering signs
- 10-safety-vests.md — ANSI/ISEA 107 Class 2 Type R, OSHA 1926.201, sizing, colors, care, lifecycle, custom printing
- 11-company-and-support.md — what Shaw Safety is, ziptie.com relationship, contact channels, hours, docs, privacy
- 12-faq-and-overflow.md — the existing on-site FAQ mirrored plus every reasonable overflow question

## Chunking recommendations

- Chunk boundary: split on `##` H2 headings.
- Chunk metadata to attach: file name (e.g. `03-use-cases.md`), heading text, sequential position.
- Typical chunk length: 100–400 tokens. Deliberately kept short so retrieval returns focused answers.
- No chunk should be split further unless it exceeds the target embedding context; each `##` section is a semantic unit.

## Retrieval hints for the assistant

- When a user's question mentions C-TPAT, ISO 17712, international, ocean freight, or CBP — retrieve chunks from 02-compliance and 08-seal-comparisons and be prepared to refer to ziptie.com.
- When a user's question is about pricing, discounts, or minimums — retrieve from 04-pricing.
- When a user asks "what's the difference between the colors" — retrieve from 01-products and 03-use-cases; the answer is "pigment only, workflow strategies attached."
- When a user asks about vests — retrieve from 10-safety-vests. Do not conflate vest and tie return policies (they're the same terms but the wording differs slightly).
- When a user asks how to install or remove — retrieve from 09-practical-usage.

## Voice and tone

The knowledge base is written in the same voice the site uses: direct, specific, no marketing puffery. The assistant should mirror this voice — short answers, concrete numbers, no hedging on facts that are already documented. When a question falls outside the documented catalog, the assistant should say so and direct the user to the Contact page or, when appropriate, to ziptie.com.

## What is deliberately not included

- Marketing copy that isn't answering a real customer question.
- Pricing on the ziptie.com parent catalog (redirect only, do not quote parent prices).
- Legal boilerplate (terms of service, privacy policy in full) — those are on their own site pages and don't need to be in the chat context.
- Sales-team internal notes on specific accounts.

## Update cadence

Refresh this knowledge base when:
- A product SKU is added, retired, or has a spec change.
- A pricing tier changes.
- A shipping policy changes (carrier, cutoff, transit times).
- A common customer question comes in that isn't already answered.
- A compliance standard the product references is revised.
